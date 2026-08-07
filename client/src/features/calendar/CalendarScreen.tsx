import { useState, useMemo, useEffect } from "react";
import type { PersonKey, CalendarEventV2 as CalendarEvent, CalendarEventStatus, CalendarEventResponse, CalendarResponseKind } from "../../types";
import { PERSONS } from "../../constants/themes";
import { HOUSEHOLD_TZ } from "../../lib/buildMeta";
import { todayKey, toLocalKey as toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";
import { uid } from "../../shared/utils/helpers";
import { expandTemplateForMonthDublin, getDublinHourMinuteFromIso, shouldSuppressGeneratedOccurrence } from "../../lib/recurrence";
import { upsertCalendarSeries, upsertCalendarOverride } from "../../lib/normalized";
import { AddEventForm } from "./EventEditor";

function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose:()=>void; title?: any; children:any }){
  if(!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose}/>
      <div className="relative w-full max-w-[480px] rounded-t-[24px] border bg-[var(--card-bg)] p-4 max-h-[88vh] overflow-auto" style={{borderColor:"var(--border)"}}>
        <div className="flex items-center justify-between mb-2"><div className="text-[14px] font-semibold">{title||""}</div><button onClick={onClose} className="h-[32px] w-[32px] grid place-items-center rounded-full border" style={{borderColor:"var(--border)"}}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function CalendarPageV2(props: any) {
  let { events, setEvents, currentUser, nowMs, chores, setCurrentUser, onCelebrate } = props as {
    events: CalendarEvent[]; setEvents: (up: CalendarEvent[] | ((p: CalendarEvent[]) => CalendarEvent[])) => void;
    currentUser: PersonKey; nowMs: number; chores?: any; setCurrentUser?: any; onCelebrate?: any;
  };
  // v120 defensive defaults
  if (!Array.isArray(events)) events = [] as any;
  if (!Array.isArray(chores)) chores = [] as any;
  if (typeof setEvents !== 'function') setEvents = (()=>{}) as any;
  if (!currentUser) currentUser = "aisling" as any;
  if (typeof setCurrentUser !== 'function') setCurrentUser = (()=>{}) as any;
  if (typeof onCelebrate !== 'function') onCelebrate = (()=>{}) as any;
  if (typeof nowMs !== 'number') nowMs = Date.now();
  // --- Dublin constants ---
  const tz = HOUSEHOLD_TZ;
  const todayDublin = todayKey(tz);

  // --- helpers (pure, no UTC slicing) ---
  function localKeyFromIso(iso?: string): string | null {
    if (!iso) return null;
    const k = toLocalKeyDublin(iso, tz);
    return k || null;
  }
  function daysInMonthDublin(year: number, month0: number): number {
    return new Date(year, month0 + 1, 0).getDate();
  }
  function addDaysKey(base: string, delta: number): string {
    // base YYYY-MM-DD -> add delta calendar days (Dublin wall, using local)
    try {
      const [y,m,d] = base.split("-").map(Number);
      const dt = new Date(y, m-1, d);
      dt.setDate(dt.getDate()+delta);
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth()+1).padStart(2,"0");
      const dd = String(dt.getDate()).padStart(2,"0");
      return `${yy}-${mm}-${dd}`;
    } catch { return base; }
  }
  function toTimeDublin(iso?: string): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", timeZone: tz, hour12:false });
    } catch { return ""; }
  }
  function toLongDateDublin(key: string): string {
    try {
      const [y,m,d] = key.split("-").map(Number);
      const dn = new Date(y, m-1, d).toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric", timeZone: tz });
      return dn;
    } catch { return key; }
  }

  // migration: swipes -> responses
  function getResponses(ev: CalendarEvent): CalendarEventResponse[] {
    // Pure: only actual responses + legacy swipes migration. No invented proposer yes.
    if (ev.responses && ev.responses.length) return ev.responses as any;
    const res: CalendarEventResponse[] = [];
    if (ev.swipes) {
      if (ev.swipes?.aisling) {
        const v = ev.swipes.aisling as any;
        if (v === "yes" || v === "no" || v === "discuss") res.push({ eventId: ev.id, memberId: "aisling", response: v, respondedAt: ev.updatedAt || ev.createdAt });
      }
      if (ev.swipes?.ciaran) {
        const v = (ev.swipes as any).ciaran as any;
        if (v === "yes" || v === "no" || v === "discuss") res.push({ eventId: ev.id, memberId: "ciaran", response: v, respondedAt: ev.updatedAt || ev.createdAt });
      }
    }
    return res;
  }

  function computeStatusFromResponses(ev: CalendarEvent, responses: CalendarEventResponse[]): CalendarEventStatus {
    // Keep cancelled/completed/draft stable
    if ((ev as any).status === "cancelled" || (ev as any).status === "completed" || (ev as any).status === "draft") return ev.status as any;
    if ((ev as any).status === "dismissed") return "cancelled" as any;

    const attendees: string[] = (ev as any).attendees && (ev as any).attendees.length ? (ev as any).attendees : ["aisling","ciaran"];
    const proposer = (ev as any).proposer as PersonKey | undefined;

    // Single attendee - who it's FOR
    if (attendees.length === 1) {
      const sole = attendees[0] as PersonKey;
      // Personal event: I create for me => agreed immediately
      if (proposer && proposer === sole) return "agreed" as any;
      const soleResp = responses.find(r => r.memberId === sole);
      if (!soleResp) return (`awaiting_${sole}` as any) as any; // awaiting owner
      if (soleResp.response === "yes") return "agreed" as any;
      if (soleResp.response === "no") return "declined" as any;
      if (soleResp.response === "discuss") return "needs_discussion" as any;
      return (`awaiting_${sole}` as any) as any;
    }

    // Both attendees (or undefined -> both)
    const hasA = responses.find(r => r.memberId === "aisling");
    const hasC = responses.find(r => r.memberId === "ciaran");

    // Inject proposer yes implicitly for both-events when no explicit response from proposer yet
    const effectiveHasA = hasA ? hasA : (proposer === "aisling" && !hasA ? { memberId:"aisling", response:"yes" } as any : undefined);
    const effectiveHasC = hasC ? hasC : (proposer === "ciaran" && !hasC ? { memberId:"ciaran", response:"yes" } as any : undefined);

    const eA = effectiveHasA;
    const eC = effectiveHasC;

    if (!eA && !eC) return "proposed" as any;
    if (!eA) {
      if ((eC as any).response === "discuss") return "needs_discussion" as any;
      return "awaiting_aisling" as any;
    }
    if (!eC) {
      if ((eA as any).response === "discuss") return "needs_discussion" as any;
      return "awaiting_ciaran" as any;
    }
    const aR = (eA as any).response as string;
    const cR = (eC as any).response as string;
    if (aR === "yes" && cR === "yes") return "agreed" as any;
    if (aR === "no" && cR === "no") return "declined" as any;
    // mixed yes/no/discuss => needs discussion
    return "needs_discussion" as any;
  }

  function isEventOnDate(ev: CalendarEvent, dateKey: string): boolean {
    const startIso = ev.start || ev.dueAt;
    if (!startIso) return false;
    const sKey = localKeyFromIso(startIso);
    if (!sKey) return false;
    const eKey = ev.end || ev.endAt ? localKeyFromIso(ev.end || ev.endAt) : sKey;
    if (!eKey || sKey === eKey) return sKey === dateKey;
    return sKey <= dateKey && dateKey <= eKey;
  }

  // recurrence — FIXED: Dublin TZ, multi-weekday weekly, biweekly parity, monthly semantic, overrides aware
  function expandTemplateForMonth(template: CalendarEvent, y: number, m0: number): CalendarEvent[] {
    try {
      const tz = HOUSEHOLD_TZ;
      return expandTemplateForMonthDublin(template as any, y, m0, tz) as any;
    } catch (e) {
      console.warn("[calendar] expandTemplateForMonth fallback", e);
      return [];
    }
  }


  // --- state ---
  const [viewMonth, setViewMonth] = useState(() => {
    const ref = nowMs ? new Date(nowMs) : new Date();
    try {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year:"numeric", month:"numeric"});
      const parts = fmt.formatToParts(ref);
      const y = Number(parts.find(p=> p.type==="year")?.value || ref.getFullYear());
      const m = Number(parts.find(p=> p.type==="month")?.value || ref.getMonth()+1)-1;
      return new Date(y, m, 1);
    } catch { return new Date(ref.getFullYear(), ref.getMonth(), 1); }
  });
  const [selected, setSelected] = useState(() => {
    try{
      const saved = localStorage.getItem("couple_v1_calendar_selected");
      if(saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
    }catch{}
    return todayDublin;
  });
  const [mode, setMode] = useState<"month"|"agenda">(()=> {
    try { const s = localStorage.getItem("couple_v1_calendar_mode"); if(s==="agenda"||s==="month") return s as any; } catch {}
    return "month";
  });
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(()=> viewMonth.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(()=> viewMonth.getMonth());
  const [showHistory, setShowHistory] = useState(false);

  const [calFilter, setCalFilter] = useState<"all"|"both"|"aisling"|"ciaran"|"chores">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent|null>(null);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent|null>(null);
  const [showEditSeriesAsk, setShowEditSeriesAsk] = useState<{ ev: CalendarEvent, draft: CalendarEvent }|null>(null);
  const [menuFor, setMenuFor] = useState<string|null>(null);
  const [commentInputs, setCommentInputs] = useState<Record<string,string>>({});
  const [confirmDialog, setConfirmDialog] = useState<null | {title:string; msg?:string; onConfirm:()=>void}>(null);

  useEffect(()=> {
    try { localStorage.setItem("couple_v1_calendar_mode", mode); } catch {}
  }, [mode]);

  useEffect(()=>{
    // keep picker synced when month changes externally
    setPickerYear(viewMonth.getFullYear());
    setPickerMonth(viewMonth.getMonth());
  }, [viewMonth]);

  useEffect(()=>{
    try{
      const vm = localStorage.getItem("couple_v1_calendar_viewMonth");
      if(vm && /^\d{4}-\d{2}$/.test(vm)){
        const [y,m] = vm.split("-").map(Number);
        setViewMonth(new Date(y, m-1, 1));
        localStorage.removeItem("couple_v1_calendar_viewMonth");
      }
      const sel = localStorage.getItem("couple_v1_calendar_selected");
      if(sel && /^\d{4}-\d{2}-\d{2}$/.test(sel)){
        if(sel!==selected){
          setSelected(sel);
          const [yy,mm] = sel.split("-").map(Number);
          setViewMonth(new Date(yy, mm-1, 1));
        }
        localStorage.removeItem("couple_v1_calendar_selected");
      }
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // month occurrences — fixed to suppress overridden dates to avoid duplication
  const monthOccurrences = useMemo(()=> {
    const y = viewMonth.getFullYear();
    const m0 = viewMonth.getMonth();
    const all: CalendarEvent[] = [];
    const tmplRecurring = events.filter(ev=> !ev.deletedAt && (ev.isTemplate || (ev.type==="repeat" && ev.frequency && ev.frequency!=="once")));
    for (const tmpl of tmplRecurring) {
      const occs = expandTemplateForMonth(tmpl, y, m0);
      // filter out those that have an override stored
      for (const o of occs) {
        if (shouldSuppressGeneratedOccurrence(o.templateId, o.occurrenceId, events)) continue;
        all.push(o);
      }
    }
    // also need next month for agenda later-this-week that may cross month boundary
    const nextM = m0===11 ? 0 : m0+1;
    const nextY = m0===11 ? y+1 : y;
    for (const tmpl of tmplRecurring) {
      const occs = expandTemplateForMonth(tmpl, nextY, nextM);
      for (const o of occs) {
        if (shouldSuppressGeneratedOccurrence(o.templateId, o.occurrenceId, events)) continue;
        all.push(o);
      }
    }
    return all;
  }, [events, viewMonth]);

  const visEvents = useMemo(()=> events.filter(ev=> !(ev as any).deletedAt && !(ev as any).isTemplate), [events]);
  const combinedForMonth = useMemo(()=> [...visEvents, ...monthOccurrences], [visEvents, monthOccurrences]);

  // month grid Mon-start
  const y = viewMonth.getFullYear();
  const m0 = viewMonth.getMonth();
  const firstDayDate = new Date(y, m0, 1);
  const jsWeekday = firstDayDate.getDay();
  const firstWdMon = (jsWeekday + 6) % 7;
  const dim = daysInMonthDublin(y, m0);
  const cells: Array<{ key:string|null, day:number|null, isToday:boolean, isSelected:boolean }> = [];
  for (let i=0;i<firstWdMon;i++) cells.push({key:null, day:null, isToday:false, isSelected:false});
  for (let d=1; d<=dim; d++) {
    const key = y+"-"+String(m0+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    cells.push({key, day:d, isToday:key===todayDublin, isSelected:key===selected});
  }
  while (cells.length % 7 !== 0) cells.push({key:null, day:null, isToday:false, isSelected:false});

  const byDay = useMemo(()=> {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of combinedForMonth) {
      for (let d=1; d<=dim; d++) {
        const dayKey = y+"-"+String(m0+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
        if (isEventOnDate(ev, dayKey)) {
          if (!map.has(dayKey)) map.set(dayKey, []);
          map.get(dayKey)!.push(ev);
        }
      }
    }
    return map;
  }, [combinedForMonth, y, m0, dim]);

  const selectedEvents = useMemo(()=> {
    const arr = combinedForMonth.filter(ev=> isEventOnDate(ev, selected));
    return arr.sort((a,b)=> {
      const ta = a.start ? new Date(a.start).getTime() : new Date(a.dueAt||a.createdAt).getTime();
      const tb = b.start ? new Date(b.start).getTime() : new Date(b.dueAt||b.createdAt).getTime();
      return ta-tb;
    });
  }, [combinedForMonth, selected]);

  const choreOverlay = useMemo(()=> {
    if (!chores) return [];
    return (chores as any[]).filter((c:any)=> {
      if (c.deletedAt) return false;
      const k = c.dueAt ? toLocalKeyDublin(c.dueAt, tz) : null;
      return k===selected;
    }).slice(0,3);
  }, [chores, selected]);

  const filteredSelected = useMemo(()=> {
    if (calFilter === "all") return selectedEvents;
    if (calFilter === "chores") return [] as CalendarEvent[];
    if (calFilter === "both") return selectedEvents.filter(ev => !ev.attendees || ev.attendees.length===2);
    if (calFilter === "aisling") return selectedEvents.filter(ev => ev.attendees?.length===1 && ev.attendees[0]==='aisling');
    if (calFilter === "ciaran") return selectedEvents.filter(ev => ev.attendees?.length===1 && ev.attendees[0]==='ciaran');
    return selectedEvents;
  }, [selectedEvents, calFilter]);

  function updateEvent(id:string, patch: Partial<CalendarEvent>) {
    setEvents((prev:any)=> prev.map((ev: CalendarEvent)=> ev.id===id ? { ...ev, ...patch, updatedAt:new Date().toISOString(), updatedBy: currentUser, mutationId: (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()) } : ev));
  }
  function removeEvent(id:string) {
    setEvents((prev:any)=> prev.map((ev: CalendarEvent)=> ev.id===id ? { ...ev, deletedAt:new Date().toISOString(), updatedAt:new Date().toISOString(), updatedBy: currentUser } : ev));
  }
  function handleResponse(ev: CalendarEvent, kind: CalendarResponseKind, comment?: string) {
    const existing = getResponses(ev);
    const otherComment = commentInputs[ev.id]?.trim();
    const finalComment = comment || otherComment || undefined;
    const nowIso = new Date().toISOString();
    const upserted = [...existing.filter(r=> r.memberId!==currentUser), { eventId: ev.id, memberId: currentUser, response: kind, comment: finalComment, respondedAt: nowIso }];
    const newSwipes = { aisling: null as any, ciaran: null as any };
    upserted.forEach(r=> {
      if (r.memberId==="aisling") newSwipes.aisling = r.response === "discuss" ? null : r.response;
      if (r.memberId==="ciaran") newSwipes.ciaran = r.response === "discuss" ? null : r.response;
    });
    // Single source of truth — no special-case overriding
    const derived = computeStatusFromResponses(ev, upserted as any);
    const patch: any = { responses: upserted, swipes: newSwipes, status: derived, mutationId: (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()) };
    const notiKey = ev.id+":"+derived+":"+upserted.map(r=> r.memberId+":"+r.response).join("|");
    if (ev.lastNotifiedState !== notiKey) {
      patch.lastNotifiedState = notiKey;
      try { if (onCelebrate && derived==="agreed") onCelebrate({ kind:"calendar-agreed", id:ev.id }); } catch {}
    }
    updateEvent(ev.id, patch);
    setCommentInputs(c=> ({...c, [ev.id]:""}));
    setActiveEvent(prev=> prev && prev.id===ev.id ? { ...prev, ...patch } as any : prev);
  }

  // pinned + ahead counts
  const pinnedEvent = useMemo(()=> (events as any[]).find((ev:any)=> ev.pinned), [events]);
  const scheduledAhead = useMemo(()=>{
    const now = nowMs || Date.now();
    return (events as any[]).filter((ev:any)=> !ev.deletedAt && ev.status==="agreed" && (new Date(ev.start || ev.dueAt || ev.createdAt).getTime() > now)).sort((a:any,b:any)=> new Date(a.start||a.dueAt||a.createdAt).getTime() - new Date(b.start||b.dueAt||b.createdAt).getTime()).slice(0,20);
  }, [events, nowMs]);
  const proposedAhead = useMemo(()=>{
    const now = nowMs || Date.now();
    return (events as any[]).filter((ev:any)=> !ev.deletedAt && ["proposed","awaiting_aisling","awaiting_ciaran","needs_discussion"].includes(ev.status) && (new Date(ev.start || ev.dueAt || ev.createdAt).getTime() > now)).sort((a:any,b:any)=> new Date(a.start||a.dueAt||a.createdAt).getTime() - new Date(b.start||b.dueAt||b.createdAt).getTime()).slice(0,20);
  }, [events, nowMs]);

  function countdownFor(iso?: string){
    if(!iso) return null;
    const ms = new Date(iso).getTime() - (nowMs || Date.now());
    if (ms <= 0) return { days:0, hours:0, mins:0, past:true, label:"today"};
    const days = Math.floor(ms/86400000);
    const hours = Math.floor((ms % 86400000)/3600000);
    const mins = Math.floor((ms % 3600000)/60000);
    return { days, hours, mins, past:false, label: days>1 ? `${days} days` : days===1 ? "1 day" : `${hours}h ${mins}m` };
  }
  function togglePin(ev: any){
    if(ev.pinned) updateEvent(ev.id, { pinned:false, pinnedAt: undefined } as any);
    else setEvents((prev:any)=> prev.map((x:any)=> x.id===ev.id ? {...x, pinned:true, pinnedAt:new Date().toISOString(), updatedAt:new Date().toISOString()} : {...x, pinned:false, pinnedAt:undefined}));
  }

  // Agenda sections (no declined/cancelled unless history)
  const todayKeyStr = todayDublin;
  const tomorrowKeyStr = addDaysKey(todayKeyStr, 1);
  const laterKeys = [2,3,4,5,6].map(n=> addDaysKey(todayKeyStr, n));

  function eventsForKey(key: string): CalendarEvent[] {
    let arr = combinedForMonth.filter(ev=> isEventOnDate(ev, key));
    if (!showHistory) arr = arr.filter(ev=> !["declined","cancelled"].includes(ev.status as any));
    return arr.sort((a,b)=> {
      const ta = a.start ? new Date(a.start).getTime() : new Date(a.dueAt||a.createdAt).getTime();
      const tb = b.start ? new Date(b.start).getTime() : new Date(b.dueAt||b.createdAt).getTime();
      return ta-tb;
    });
  }

  const todayEvents = useMemo(()=> eventsForKey(todayKeyStr), [combinedForMonth, todayKeyStr, showHistory]);
  const tomorrowEvents = useMemo(()=> eventsForKey(tomorrowKeyStr), [combinedForMonth, tomorrowKeyStr, showHistory]);
  const laterEventsFlat = useMemo(()=> {
    const all: { key:string, ev:CalendarEvent}[] = [];
    for (const k of laterKeys) {
      for (const ev of eventsForKey(k)) all.push({key:k, ev});
    }
    return all;
  }, [combinedForMonth, laterKeys.join("|"), showHistory]);

  function goPrevMonth(){
    const nm = new Date(viewMonth); nm.setMonth(nm.getMonth()-1);
    setViewMonth(new Date(nm.getFullYear(), nm.getMonth(), 1));
  }
  function goNextMonth(){
    const nm = new Date(viewMonth); nm.setMonth(nm.getMonth()+1);
    setViewMonth(new Date(nm.getFullYear(), nm.getMonth(), 1));
  }
  function goToday(){
    try {
      const fmt = new Intl.DateTimeFormat("en-US",{timeZone: tz, year:"numeric", month:"numeric"});
      const p = fmt.formatToParts(new Date());
      const yN = Number(p.find(x=> x.type==="year")?.value);
      const mN = Number(p.find(x=> x.type==="month")?.value)-1;
      setViewMonth(new Date(yN,mN,1));
      setSelected(todayDublin);
    } catch {
      const d=new Date(); setViewMonth(new Date(d.getFullYear(), d.getMonth(),1)); setSelected(todayDublin);
    }
  }

  // --- row components inline - V70 ownership clarity ---
  const AgendaRow = ({ ev, dateKey, compact }: { ev: CalendarEvent, dateKey?: string, compact?: boolean }) => {
    const isPending = ["proposed","awaiting_aisling","awaiting_ciaran","needs_discussion"].includes(ev.status as any);
    const timeStr = ev.allDay ? "All day" : toTimeDublin(ev.start || ev.dueAt);
    const loc = (ev as any).location;
    const attendees = (ev as any).attendees || ["aisling","ciaran"];
    const proposer = (ev as any).proposer as PersonKey | undefined;
    const isBoth = attendees.length!==1;
    // V105 boutique left-rule 3px
    const leftRuleColor = isBoth ? "#8B7357" : (attendees[0]==="aisling" ? "#A89FDA" : "#E07A5F");
    const timeMono = ev.allDay ? "All day" : timeStr;
    // dot pulse check — due within 24h urgent only (premium cut)
    let diffDays = 99;
    try { diffDays = Math.round((new Date(ev.start||ev.dueAt).getTime() - Date.now())/86400000); } catch {}
    const isSoon = Math.abs(diffDays)<=2;
    const forLabel = attendees.length===2 ? "Both" : attendees[0]==="aisling" ? "for Aisling" : "for Ciaran";
    const subStatus = (()=> {
      if (ev.status==="agreed") return "Agreed";
      if ((ev.status as any)==="declined") return "Declined";
      if (ev.status==="needs_discussion") return "Needs reply";
      if ((ev.status as any)==="awaiting_aisling") return "Awaiting Á";
      if ((ev.status as any)==="awaiting_ciaran") return "Awaiting C";
      if (ev.status==="proposed") return proposer ? `by ${PERSONS[proposer as any]?.name||proposer}` : "Proposed";
      return ev.status;
    })();
    const sub = [loc, subStatus].filter(Boolean).join(" · ");
    return (
      <button
        onClick={()=> setActiveEvent(ev)}
        className="w-full text-left flex items-stretch gap-0 rounded-[18px] border bg-[var(--card-bg)] overflow-hidden active:scale-[0.98] transition min-h-[64px] relative"
        style={{ borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.86)", paddingLeft:3 }}
      >
        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[18px]" style={{ background: leftRuleColor }} aria-hidden="true" />
        <span className="flex flex-1 items-center gap-3 px-3.5 py-3 min-w-0 ml-[3px]">
          <span className="flex flex-col items-center gap-1.5 shrink-0">
            {/* time mono 12px Inter Tight */}
            <span className="tabular-nums text-[12px] font-medium tracking-[0.02em] rounded-full px-2 py-0.5 border" style={{fontFamily:'Inter Tight, var(--font-ui)', color:'var(--muted)', background:'var(--chip-bg)', border:'1px solid var(--border)'}}>{timeMono}</span>
            <span style={{background:leftRuleColor, boxShadow: isSoon?`0 0 0 4px ${leftRuleColor}22, 0 0 10px ${leftRuleColor}55`:'none'}} className={`h-[7px] w-[7px] rounded-full ${isSoon?"nylah-dot nylah-dot--urgent":""}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block text-[14px] font-semibold tracking-tight truncate" style={{color:'var(--text)', fontFamily:'var(--font-ui)'}}>{ev.title}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className="block text-[11px] truncate max-w-[150px]" style={{color:'var(--muted)'}}>{sub || forLabel}</span>
              {isPending && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border" style={{background:'var(--chip-bg)', color:'var(--text)', borderColor:'var(--border)'}}><span style={{color:'var(--accent)'}}>✦</span> Needs you</span>}
            </span>
          </span>
          <span className="shrink-0 rounded-full h-8 w-8 grid place-items-center border text-[12px]" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--muted)'}} aria-hidden="true">›</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Minimal pinned countdown (kept, adapted) */}
      {pinnedEvent && (
        <div className="rounded-[14px] border bg-[var(--card-bg)] px-3 py-2 flex items-center justify-between" style={{borderColor:"var(--border)"}}>
          <div className="min-w-0 flex items-center gap-2">
            <span className="h-6 w-6 grid place-items-center rounded-full bg-[#0A0A0A] text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><path d="M12 3v14"/><path d="M5 11l7-8 7 8"/><path d="M5 21h14"/></svg></span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium truncate">{pinnedEvent.title}</div>
              <div className="text-[11px] text-[var(--muted)] truncate">{toLocalKeyDublin(pinnedEvent.start||pinnedEvent.dueAt||"", tz)?.slice(5)} {(pinnedEvent as any).location ? " • "+(pinnedEvent as any).location : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(()=>{ const cd=countdownFor(pinnedEvent.start||pinnedEvent.dueAt); return cd ? <span className="rounded-full bg-[#0A0A0A] text-white px-2.5 py-1 text-[11px] font-medium min-h-[28px] grid place-items-center">{cd.past ? "today" : cd.days>0 ? `${cd.days}d ${cd.hours}h` : `${cd.hours}h ${cd.mins}m`}</span> : null})()}
            <button onClick={()=> togglePin(pinnedEvent)} className="h-[32px] w-[32px] grid place-items-center rounded-full border bg-[var(--card-bg)] text-[11px]" style={{borderColor:"var(--border)"}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
        </div>
      )}

      {/* Header: ‹ August 2026 › Today — tappable month opens picker, no Europe/Dublin badge */}
      <div className="flex items-center justify-between px-1">
        <button onClick={goPrevMonth} className="h-[44px] w-[44px] grid place-items-center rounded-full border bg-[var(--card-bg)] active:scale-[0.96] transition text-[16px]" style={{ borderColor:"var(--border)" }} aria-label="Previous month">‹</button>
        <button
          onClick={()=> setShowMonthPicker(v=> !v)}
          className="h-[44px] rounded-full border bg-[var(--card-bg)] px-4 font-display text-[18px] tracking-tight active:scale-[0.98] transition"
          style={{ borderColor:"var(--border)" }}
          aria-expanded={showMonthPicker}
          aria-haspopup="dialog"
        >
          {viewMonth.toLocaleDateString("en-GB", { month:"long", year:"numeric", timeZone: tz })}
        </button>
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="h-[44px] px-3 rounded-full border bg-[var(--card-bg)] text-[11px] font-medium active:scale-[0.96]" style={{borderColor:"var(--border)"}}>Today</button>
          <button onClick={goNextMonth} className="h-[44px] w-[44px] grid place-items-center rounded-full border bg-[var(--card-bg)] text-[16px]" style={{ borderColor:"var(--border)" }} aria-label="Next month">›</button>
        </div>
      </div>

      {/* Month/Year picker sheet inline (pills, type scale) */}
      {showMonthPicker && (
        <div className="rounded-[16px] border bg-[var(--card-bg)] p-3 space-y-2" style={{borderColor:"var(--border)"}}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Jump to</span>
            <button onClick={()=> setShowMonthPicker(false)} className="h-[32px] rounded-full border bg-[var(--chip-bg)] px-3 text-[11px]" style={{borderColor:"var(--border)"}}>Done</button>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <select value={pickerMonth} onChange={e=> setPickerMonth(Number(e.target.value))} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                {Array.from({length:12}).map((_,i)=> <option key={i} value={i}>{new Date(2020,i,1).toLocaleDateString("en-GB",{month:"long"})}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
            <div className="relative w-[110px]">
              <select value={pickerYear} onChange={e=> setPickerYear(Number(e.target.value))} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                {Array.from({length:9}).map((_,i)=> { const yr = new Date().getFullYear()-3+i; return <option key={yr} value={yr}>{yr}</option>; })}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
            <button onClick={()=> { setViewMonth(new Date(pickerYear, pickerMonth, 1)); setShowMonthPicker(false); }} className="h-[44px] min-h-[44px] rounded-[12px] bg-[#0A0A0A] px-4 text-[12px] font-medium text-white">Go</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({length:12}).map((_,i)=> (
              <button key={i} onClick={()=> setPickerMonth(i)} className={"h-[36px] rounded-full border text-[11px] transition "+(pickerMonth===i ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--chip-bg)] border-[var(--border)]")}>{new Date(2020,i,1).toLocaleDateString("en-GB",{month:"short"})}</button>
            ))}
          </div>
        </div>
      )}

      {/* Segmented — V101 Linear pill classy */}
      <div className="px-1">
        <div className="nylah-seg">
          {(["month","agenda"] as const).map(m=> (
            <button
              key={m}
              onClick={()=> setMode(m)}
              className={mode===m ? "active" : ""}
              style={{fontFamily:'var(--font-ui)'}}
            >
              {m==="month" ? "Month" : "Agenda"}
            </button>
          ))}
        </div>
      </div>

      {mode==="month" ? (
        <>
          {/* V107 boutique calendar — Hume charcoal + linen, Fraunces numbers, orange today */}
          <div className="nylah-arena rounded-[24px] px-5 pt-5 pb-4 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.28] pointer-events-none nylah-arena" style={{}} />
            <div className="relative">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] mb-2 px-1" style={{fontFamily:'var(--font-ui)'}}><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
              <div className="grid grid-cols-7 gap-1.5">
                {cells.map((c,i)=>{
                  if (!c.key) return <div key={"empty-"+i} className="min-h-[44px] min-w-[44px]" />;
                  const dayEvs = (byDay.get(c.key!) || []) as any[];
                  const evCount = dayEvs.length;
                  const hasEv = evCount>0;
                  const isSel = c.isSelected;
                  const isToday = c.isToday;
                  return (
                    <button
                      key={c.key}
                      onClick={()=> setSelected(c.key!)}
                      aria-label={c.key + (hasEv ? " has "+evCount+" events" : "")}
                      className={"relative min-h-[44px] w-full rounded-[14px] grid place-items-center border transition-all active:scale-[0.96] py-2.5 " + (isSel ? "" : isToday ? "" : "")}
                      style={{
                        minHeight:44,
                        background: isSel ? 'var(--text)' : isToday ? 'rgba(255,107,38,0.14)' : 'var(--card-bg)',
                        color: isSel ? 'var(--app-bg)' : 'var(--text)',
                        borderColor: isSel ? 'var(--text)' : isToday ? 'rgba(255,107,38,0.28)' : 'var(--border)',
                        boxShadow: isSel ? '0 8px 20px rgba(0,0,0,0.22), 0 0 0 1px #121214 inset' : isToday ? '0 0 0 4px rgba(255,107,38,0.10), 0 4px 16px rgba(255,107,38,0.12)' : '0 1px 0 rgba(255,255,255,0.86) inset',
                        fontFamily: 'Fraunces, var(--font-display)',
                        fontWeight: isSel || isToday ? 600 : 500,
                        fontSize: '13px'
                      }}
                    >
                      <span className="leading-none">{c.day}</span>
                      {hasEv && (
                        <span className="absolute bottom-[5px] left-1/2 -translate-x-1/2 flex gap-[2.5px] justify-center items-center">
                          {dayEvs.slice(0,3).map((ev:any,j:number)=> {
                            const at = (ev as any).attendees || ["aisling","ciaran"];
                            const col = at.length===1 ? (at[0]==="aisling" ? "#A89FDA" : "#E07A5F") : "#8B7357";
                            const pulse = isToday;
                            return <span key={j} className="rounded-full" style={{ width:'5px', height:'5px', background:col, boxShadow: pulse?`0 0 6px ${col}88`: undefined, animation: pulse?'nylah-dot-subtle 2.8s infinite':undefined }} />;
                          })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Color key - who the dot is for */}
              <div className="mt-3 flex items-center justify-center gap-3 text-[11px] font-medium text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#A89FDA"}}/> Aisling</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#E07A5F"}}/> Ciaran</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#8B7357"}}/> Both</span>
              </div>
            </div>
          </div>

          <div className="px-1 flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="font-display text-[14px]">{toLongDateDublin(selected) || selected}</span>{selected===todayDublin && <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2 py-0.5">Today</span>}</div>
            <button onClick={()=> setShowAdd(true)} className="h-[36px] rounded-full bg-[#0A0A0A] px-3 text-[11px] text-white">+ Add</button>
          </div>

          <div className="px-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--muted)]">Filter</span>
              <span className="text-[11px] text-[var(--muted)]">as {(PERSONS[currentUser]?.name||currentUser||'You')}</span>
            </div>
            <div className="relative">
              <select value={calFilter} onChange={e=> setCalFilter(e.target.value as any)} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                <option value="all">All</option>
                <option value="both">Both</option>
                <option value="aisling">Aisling</option>
                <option value="ciaran">Ciarán</option>
                <option value="chores">Chores</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
          </div>

          {/* Compact selected-day list */}
          <div className="space-y-2">
            {calFilter==="chores" ? (
              <div className="space-y-1">
                <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Chores • {choreOverlay.length}</div>
                {choreOverlay.length>0 ? choreOverlay.map((c:any)=> <div key={c.id} className="rounded-[12px] border bg-[var(--card-bg)] px-3 py-2 text-[11px]" style={{borderColor:"var(--border)"}}>{c.title}</div>) : <div className="rounded-[16px] border-dashed border bg-[var(--card-bg)] px-4 py-6 text-center text-[12px] text-[var(--muted)]">No chores that day</div>}
              </div>
            ) : filteredSelected.length===0 ? (
              <div className="rounded-[16px] border border-dashed bg-[var(--card-bg)] px-6 py-6 text-center" style={{borderColor:"var(--border)"}}>
                <div className="font-display text-[13px]">No plans</div>
                <div className="text-[11px] text-[var(--muted)] mt-1">{selected}</div>
                <button onClick={()=> setShowAdd(true)} className="mt-3 h-[36px] rounded-full bg-[#0A0A0A] px-4 text-[11px] text-white">Add event</button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">{filteredSelected.length} events</div>
                {filteredSelected.map(ev=> <AgendaRow key={ev.id} ev={ev} compact />)}
              </div>
            )}
          </div>
        </>
      ) : (
        // --- AGENDA MODE ---
        <div className="space-y-4">
          {/* Counts row (inside Agenda, not top hero) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[12px] border bg-[var(--card-bg)] px-3 py-2.5" style={{borderColor:"var(--border)"}}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Scheduled • {scheduledAhead.length}</div>
              <div className="mt-1 text-[11px] font-medium">{scheduledAhead.length===0 ? <span className="text-[var(--muted)] font-normal">No agreed dates ahead</span> : `${scheduledAhead[0].title} • ${toLocalKeyDublin(scheduledAhead[0].start||scheduledAhead[0].dueAt,"")?.slice(5)}`}</div>
            </div>
            <div className="rounded-[12px] border bg-[var(--chip-bg)] px-3 py-2.5" style={{borderColor:"var(--border)"}}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Proposed • {proposedAhead.length}</div>
              <div className="mt-1 text-[11px]">{proposedAhead.length===0 ? <span className="text-[var(--muted)]">Nothing waiting</span> : <span className="truncate">{proposedAhead[0].title} • needs you</span>}</div>
            </div>
          </div>

          {/* Today */}
          <div>
            <div className="px-1 flex items-center justify-between mb-1">
              <span className="font-display text-[13px]">Today • {todayKeyStr.slice(5)}</span>
              <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2 py-0.5">{todayEvents.length}</span>
            </div>
            <div className="space-y-1.5">
              {todayEvents.length===0 ? <div className="text-[11px] text-[var(--muted)] px-1">No plans today</div> : todayEvents.map(ev=> <AgendaRow key={ev.id} ev={ev} dateKey={todayKeyStr} />)}
            </div>
          </div>

          <div>
            <div className="px-1 flex items-center justify-between mb-1"><span className="font-display text-[13px]">Tomorrow • {tomorrowKeyStr.slice(5)}</span><span className="text-[11px] text-[var(--muted)] border rounded-full px-2 py-0.5">{tomorrowEvents.length}</span></div>
            <div className="space-y-1.5">
              {tomorrowEvents.length===0 ? <div className="text-[11px] text-[var(--muted)] px-1">Free</div> : tomorrowEvents.map(ev=> <AgendaRow key={ev.id} ev={ev} dateKey={tomorrowKeyStr} />)}
            </div>
          </div>

          <div>
            <div className="px-1 mb-1"><span className="font-display text-[13px]">Later this week</span><span className="ml-2 text-[11px] text-[var(--muted)]">{laterEventsFlat.length} upcoming</span></div>
            <div className="space-y-1.5">
              {laterEventsFlat.length===0 ? <div className="text-[11px] text-[var(--muted)] px-1">Nothing else this week</div> : laterEventsFlat.slice(0,10).map(({key,ev})=> <AgendaRow key={ev.id+"-"+key} ev={ev} dateKey={key} />)}
            </div>
          </div>

          {/* Pending decisions */}
          <div className="rounded-[14px] border bg-[var(--card-bg)] p-2.5" style={{borderColor:"var(--border)"}}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Pending decisions • {proposedAhead.length}</span>
              <button onClick={()=> setShowHistory(v=>!v)} className="text-[11px] underline text-[var(--muted)]">{showHistory ? "Hide history" : "History"}</button>
            </div>
            {proposedAhead.length===0 ? (
              <div className="text-[11px] text-[var(--muted)]">Nothing waiting</div>
            ) : (
              <div className="space-y-1.5 max-h-[240px] overflow-auto no-scrollbar">
                {proposedAhead.slice(0,8).map(ev=> (
                  <button key={ev.id} onClick={()=> setActiveEvent(ev)} className="w-full text-left flex items-center justify-between gap-2 rounded-[10px] bg-[var(--chip-bg)] px-3 py-2 min-h-[44px]">
                    <span className="text-[11px] truncate font-medium">{ev.title}</span>
                    <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-1.5 py-0.5 shrink-0">{(ev.status||"").startsWith("awaiting")? "needs you" : "proposed"}</span>
                  </button>
                ))}
              </div>
            )}
            {showHistory && (
              <div className="mt-2 pt-2 border-t" style={{borderColor:"var(--border)"}}>
                <div className="text-[11px] text-[var(--muted)] mb-1">Declined / Cancelled (history)</div>
                <div className="flex flex-wrap gap-1.5">
                  {(events as any[]).filter(ev=> !ev.deletedAt && ["declined","cancelled"].includes(ev.status)).slice(0,8).map(ev=> <span key={ev.id} className="rounded-full border bg-[var(--card-bg)] px-2.5 py-1 text-[11px] line-through" style={{borderColor:"var(--border)"}}>{ev.title}</span>)}
                </div>
              </div>
            )}
          </div>

          <button onClick={()=> setShowAdd(true)} className="w-full h-[44px] rounded-full bg-[#0A0A0A] text-white text-[12px] font-medium">+ Add event</button>
        </div>
      )}

      {/* V62 FAB - 56px black bottom-[88px] bigger shadow 0 12px 24px */}
      <div className="pointer-events-none sticky bottom-[88px] z-10 flex justify-end px-1 mt-2">
        <button onClick={()=> setShowAdd(true)} className="pointer-events-auto grid h-[56px] w-[56px] place-items-center rounded-full bg-[#0A0A0A] text-white shadow-[0_12px_24px_rgba(0,0,0,0.28)] active:scale-[0.98] text-[22px] font-semibold border border-white/10">+</button>
      </div>

      {/* Event detail sheet: V70 ownership clarity */}
      <BottomSheet open={!!activeEvent} onClose={()=> setActiveEvent(null)} title={activeEvent ? activeEvent.title : undefined}>
        {activeEvent && (()=> {
          const ev = activeEvent;
          const k = toLocalKeyDublin(ev.start||ev.dueAt||"", tz) || selected;
          const responses = getResponses(ev);
          const myResp = responses.find(r=> r.memberId===currentUser);
          const timeA = ev.allDay ? "All-day" : toTimeDublin(ev.start||ev.dueAt);
          const timeB = ev.end ? "→ "+toTimeDublin(ev.end) : "";
          const attendees = (ev as any).attendees || ["aisling","ciaran"];
          const proposer = (ev as any).proposer as PersonKey | undefined;
          const isBoth = attendees.length!==1;
          const ownerText = (()=> {
            const pName = proposer ? PERSONS[proposer as any].name : null;
            if (attendees.length===1) {
              const sole = attendees[0]; const soleName = PERSONS[sole as any].name;
              if (proposer && proposer===sole) return `${soleName}'s personal — created by ${pName}`;
              if (proposer) return `Created by ${pName} for ${soleName}`;
              return `${soleName}'s personal`;
            }
            return pName ? `Both — created by ${pName}` : "Both — shared";
          })();
          const myColor = currentUser==="aisling" ? "text-[#6B5CA8]" : "text-[#92400E]";
          return (
            <div className="space-y-3">
              <div className="rounded-[12px] border bg-[var(--card-bg)] px-3 py-2.5 text-[11px] space-y-1.5" style={{borderColor:"var(--border)"}}>
                <div className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 3v3M16 3v3"/></svg> {k} • {toLongDateDublin(k)}</div>
                <div className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> {timeA} {timeB}</div>
                {(ev as any).location && <div className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 21s7-6 7-10a7 7 0 1 0-14 0c0 4 7 10 7 10Z"/><circle cx="12" cy="11" r="2.5"/></svg> {(ev as any).location}</div>}
                <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{borderColor:'var(--border)', background: isBoth? 'var(--chip-bg)' : attendees[0]==="aisling" ? '#EDE8FF' : '#FFECD6', color: isBoth? '#6B5242' : attendees[0]==="aisling" ? '#6B5CA8':'#92400E'}}><span className={"grid h-[14px] w-[14px] place-items-center rounded-full text-[8px] font-bold text-white "+(isBoth?"bg-[#8B7357]":attendees[0]==="aisling"?"bg-[#A89FDA]":"bg-[#E07A5F]")}>{isBoth?"2":attendees[0]==="aisling"?"Á":"C"}</span>{ownerText}</span><span className={"inline-flex rounded-full border px-2 py-0.5 text-[10px] "+(ev.status==="agreed"?"bg-[var(--chip-bg)] text-[#6B5CA8] border-[#C4B5FD]": (ev.status as any)==="declined"?"bg-[#FFE4E6] text-[#9F1239] border-[#FECDD3]":"bg-[var(--card-bg)] text-[#92400E] border-[#FDBA74]")}>{String(ev.status||"proposed").replace("_"," ")}</span></div>
              </div>
              {ev.notes && <div className="text-[12px] bg-[var(--card-bg)] border rounded-[10px] p-2" style={{borderColor:"var(--border)"}}>{ev.notes}</div>}

              {/* Two-row ownership response matrix */}
              <div className="rounded-[12px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:'var(--border)'}}>
                {["aisling","ciaran"].map(pk=> {
                  const p = PERSONS[pk as any]; const resp = responses.find(r=> r.memberId===pk);
                  const isMe = pk===currentUser;
                  const label = (()=> {
                    if (!resp) return "Waiting";
                    if (resp.response==="yes") return "Yes";
                    if (resp.response==="no") return "No";
                    if (resp.response==="discuss") return "Needs talk";
                    return resp.response;
                  })();
                  const dot = resp?.response==="yes" ? "bg-[#16A34A]" : resp?.response==="no" ? "bg-[#DC2626]" : resp ? "bg-[#F59E0B]" : "bg-[var(--border)]";
                  const rowBg = isMe ? "bg-[var(--card-bg)]" : "bg-[var(--card-bg)]";
                  return (
                    <div key={pk} className={"flex items-center justify-between px-3 py-2 text-[12px] border-b last:border-0 "+rowBg+(isMe?" ring-[0.5px] ring-inset ring-[var(--border)]":"")} style={{borderColor:'var(--border)'}}>
                      <span className="flex items-center gap-2"><span className={"grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white "+(pk==="aisling"?"bg-[#A89FDA]":"bg-[#E07A5F]")}>{pk==="aisling"?"Á":"C"}</span><span className={"font-medium "+(isMe?myColor:"text-[var(--text)]")}>{p.name}{isMe?" (you)":""}</span></span>
                      <span className="flex items-center gap-1.5"><span className={"h-[7px] w-[7px] rounded-full "+dot}/><span className={"rounded-full border px-2 py-0.5 text-[10px] "+(isMe?"font-semibold bg-[var(--chip-bg)] text-[var(--text)]":"bg-[var(--card-bg)] text-[var(--text-secondary)]") } style={{borderColor:'var(--border)'}}>{label}</span></span>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-1.5">
                <button onClick={()=> handleResponse(ev,"yes")} className={"flex-1 h-[44px] rounded-full text-[11px] font-medium border "+(myResp?.response==="yes" ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)]") } style={{borderColor:"var(--border)"}}>Yes</button>
                <button onClick={()=> handleResponse(ev,"discuss")} className={"flex-1 h-[44px] rounded-full text-[11px] border "+(myResp?.response==="discuss" ? "bg-[var(--chip-bg)] border-[#A89FDA]" : "bg-[var(--chip-bg)]")} style={{borderColor:"var(--border)"}}>Discuss</button>
                <button onClick={()=> handleResponse(ev,"no")} className={"flex-1 h-[44px] rounded-full text-[11px] border "+(myResp?.response==="no" ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)]")} style={{borderColor:"var(--border)"}}>No</button>
              </div>

              <div className="flex gap-1.5">
                <input value={commentInputs[ev.id]||""} onChange={e=> setCommentInputs(c=> ({...c, [ev.id]: e.target.value}))} placeholder='Add a note — "Could we do Saturday?"' className="flex-1 rounded-full border bg-[var(--card-bg)] px-3 h-[44px] text-[11px]" style={{borderColor:"var(--border)"}} />
                <button disabled={!commentInputs[ev.id]?.trim()} onClick={()=> handleResponse(ev, (myResp as any)?.response as any || "discuss", commentInputs[ev.id])} className="rounded-full bg-[#0A0A0A] px-4 h-[44px] text-[11px] text-white disabled:opacity-40">Add note</button>
              </div>

              {responses.length>0 && (
                <div className="text-[11px] text-[var(--muted)]">
                  {responses.map(r=> `${(PERSONS[r.memberId as any]?.name||r.memberId||"?")}: ${r.response}${r.comment ? " — "+r.comment : ""}`).join(" • ")}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={()=> { setEditing(ev); setActiveEvent(null); }} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[36px] text-[11px]" style={{borderColor:"var(--border)"}}>Edit</button>
                <button onClick={()=> togglePin(ev)} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[36px] text-[11px]" style={{borderColor:"var(--border)"}}>{(ev as any).pinned ? "Unpin" : "Pin countdown"}</button>
                <button onClick={()=> setConfirmDialog({title:"Cancel event?", msg:"It stays visible as cancelled.", onConfirm:()=>{ updateEvent(ev.id, { status:"cancelled" as any }); setActiveEvent(null); setConfirmDialog(null); }})} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[36px] text-[11px] text-[#B91C1C]" style={{borderColor:"var(--border)"}}>Cancel</button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      <BottomSheet open={showAdd} onClose={()=> setShowAdd(false)} title="Add event • Dublin">
        <AddEventForm onAdd={(ev:any)=> { setEvents((p:any)=> [ev, ...p]); setShowAdd(false); }} currentUser={currentUser} selectedDate={selected} />
      </BottomSheet>

      <BottomSheet open={!!editing} onClose={()=> setEditing(null)} title={editing ? "Edit event" : undefined}>
        {editing && (
          <div className="space-y-3">
            <AddEventForm onAdd={(ev:any)=> {
              if (editing.templateId || editing.isTemplate) { setShowEditSeriesAsk({ ev: editing, draft: ev }); return; }
              setEvents((prev:any)=> prev.map((x:any)=> x.id===editing.id ? {...x, ...ev, id: x.id} : x));
              setEditing(null);
            }} currentUser={currentUser} selectedDate={selected} initialEvent={editing} />
            <button onClick={()=> setConfirmDialog({title:"Delete proposal?", onConfirm:()=>{ removeEvent(editing!.id); setEditing(null); setConfirmDialog(null); }})} className="w-full rounded-full border bg-[var(--card-bg)] py-2.5 text-[11px] text-[#B91C1C] min-h-[44px]" style={{borderColor:"var(--border)"}}>Delete proposal</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!showEditSeriesAsk} onClose={()=> setShowEditSeriesAsk(null)} title="Edit recurring">
        {showEditSeriesAsk && (
          <div className="space-y-2">
            <div className="text-[12px]">This is a recurring event: {showEditSeriesAsk.ev.title}. How to apply change?</div>
            <button onClick={()=> {
              const { ev, draft } = showEditSeriesAsk;
              const templateId = ev.templateId || ev.id;
              const occurrenceId = ev.occurrenceId || (()=>{ try{ return toLocalKeyDublin(ev.dueAt||ev.start||"", HOUSEHOLD_TZ)||"" }catch{return ""}})();
              const nowISO = new Date().toISOString();
              const override = {
                ...draft,
                id: uid("cal_ovr"),
                templateId,
                occurrenceId,
                occurrenceDate: occurrenceId,
                seriesId: templateId,
                isTemplate: false,
                isOverride: true,
                updatedAt: nowISO,
                createdAt: nowISO,
              };
              setEvents((prev:any)=> {
                const filtered = prev.filter((x:any)=> !(x.templateId===templateId && x.occurrenceId===occurrenceId && x.id!==templateId));
                return [override, ...filtered];
              });
              try{ upsertCalendarOverride({ id: override.id, seriesId: templateId, occurrenceDate: occurrenceId, occurrenceId, data: override, title: (override as any).title }).catch(()=>{}); }catch{}
              setShowEditSeriesAsk(null); setEditing(null);
            }} className="w-full rounded-full bg-[#0A0A0A] h-[44px] text-white text-[11px]">This event only</button>
            <button onClick={()=> {
              const { ev, draft } = showEditSeriesAsk;
              const templateId = ev.templateId || ev.id;
              const occurrenceId = ev.occurrenceId || (()=>{ try{ return toLocalKeyDublin(ev.dueAt||ev.start||"", HOUSEHOLD_TZ)||"" }catch{return ""}})();
              // split series: truncate original at day-1, new series starts at occurrence
              const prevDayKey = occurrenceId ? addDaysKey(occurrenceId, -1) : null;
              const nowISO = new Date().toISOString();
              const draftHourMin = (()=>{ try{ const hm=getDublinHourMinuteFromIso((draft as any).dueAt||(draft as any).start||ev.dueAt||"", HOUSEHOLD_TZ); return hm; }catch{return {h:9,m:0}} })();
              // derive new series dueAt from occurrence wall + draft time if draft provides new time
              let newDueAt = (draft as any).dueAt || (draft as any).start || ev.dueAt;
              // if draft has same time logic, reconstruct from occurrenceId + draft time to avoid device TZ
              try{
                if (occurrenceId) {
                  const [yy,mm,dd] = occurrenceId.split("-").map(Number);
                  if (yy&&mm&&dd) {
                    const h = draftHourMin.h; const m = draftHourMin.m;
                    const { tzWallToUtc: wallToUtc } = (()=>{ try{ return { tzWallToUtc } }catch{return {tzWallToUtc: (a:any,b:any,c:any,d:any,e:any)=> new Date()} } })() as any;
                    // use imported tzWallToUtc directly
                    const probe = tzWallToUtc(yy, mm, dd, h, m, 0, HOUSEHOLD_TZ);
                    newDueAt = probe.toISOString();
                  }
                }
              }catch{}
              const newSeriesId = uid("cal");
              const newSeries = {
                ...draft,
                id: newSeriesId,
                isTemplate: true,
                dueAt: newDueAt,
                start: newDueAt,
                originalDom: (draft as any).originalDom ?? (ev as any).originalDom ?? (()=>{ try{ const [,,dd]=occurrenceId.split("-").map(Number); return dd }catch{return undefined}})(),
                createdAt: nowISO,
                updatedAt: nowISO,
                recurrenceUntil: undefined,
              };
              setEvents((prev:any)=> {
                let out = prev.map((x:any)=> {
                  if (x.id===templateId) {
                    return { ...x, recurrenceUntil: prevDayKey, updatedAt: nowISO };
                  }
                  return x;
                });
                // remove future overrides for old series (occurrence >= this)
                out = out.filter((x:any)=> {
                  if (x.templateId===templateId && x.occurrenceId && occurrenceId) {
                    if (x.occurrenceId >= occurrenceId) return false;
                  }
                  return true;
                });
                return [newSeries, ...out];
              });
              try{ 
                upsertCalendarSeries({ id: templateId } as any).catch(()=>{});
                upsertCalendarSeries({ id: newSeriesId, title: (newSeries as any).title, frequency: (newSeries as any).frequency, frequencyDetail: (newSeries as any).frequencyDetail, timezone: HOUSEHOLD_TZ } as any).catch(()=>{});
              }catch{}
              setShowEditSeriesAsk(null); setEditing(null);
            }} className="w-full rounded-full border bg-[var(--card-bg)] h-[44px] text-[11px]" style={{borderColor:"var(--border)"}}>This and future events</button>
            <button onClick={()=> {
              const { draft } = showEditSeriesAsk;
              const templateId = showEditSeriesAsk.ev.templateId || showEditSeriesAsk.ev.id;
              const nowISO = new Date().toISOString();
              setEvents((prev:any)=> prev.map((x:any)=> x.id===templateId ? {...x, ...draft, id: templateId, isTemplate:true, updatedAt: nowISO} : x).filter((x:any)=> !(x.templateId===templateId && x.id!==templateId)));
              try{ upsertCalendarSeries({ id: templateId, title: (draft as any).title, frequency: (draft as any).frequency, frequencyDetail: (draft as any).frequencyDetail, timezone: HOUSEHOLD_TZ } as any).catch(()=>{}); }catch{}
              setShowEditSeriesAsk(null); setEditing(null);
            }} className="w-full rounded-full border bg-[var(--card-bg)] h-[44px] text-[11px]" style={{borderColor:"var(--border)"}}>Entire series</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!confirmDialog} onClose={()=> setConfirmDialog(null)} title={confirmDialog?.title || "Confirm"}>
        {confirmDialog && (
          <div className="space-y-3">
            {confirmDialog.msg && <div className="text-[12px] text-[var(--muted)]">{confirmDialog.msg}</div>}
            <div className="flex gap-2">
              <button onClick={()=> setConfirmDialog(null)} className="flex-1 rounded-full border bg-[var(--card-bg)] py-2.5 text-[12px] min-h-[44px]" style={{borderColor:"var(--border)"}}>Cancel</button>
              <button onClick={()=> { confirmDialog.onConfirm(); }} className="flex-1 rounded-full bg-[#0A0A0A] py-2.5 text-[12px] text-white min-h-[44px]">Confirm</button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}



export default CalendarPageV2;
