import { useMemo } from "react";
import type { PersonKey, TabKey, ChoreV2, CalendarEventV2, ShoppingItemV2 } from "../../types";
import { PERSONS } from "../../constants/themes";
import { HOUSEHOLD_TZ, toLocalKey as toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";
import { getDueMsChore } from "../../shared/utils/helpers";

type Props = {
  currentUser: PersonKey;
  calendar: CalendarEventV2[];
  chores: ChoreV2[];
  shopping: ShoppingItemV2[];
  nowMs: number;
  todayDateStr: string;
  setTab: (k: TabKey) => void;
};

// boutique tokens #E8CEB7 #F7EFE8 preserve, charcoal #121214 44px spring cubic-bezier(0.34,1.56,0.64,1)
// real shopping due preserved from monolith
import { computeShoppingNextDue } from "../../lib/shoppingDue";

export default function Upcoming({ currentUser, calendar, chores, shopping, nowMs, todayDateStr, setTab }: Props) {
  const activeChores = useMemo(() => (chores as any[]).filter(c => !(c as any).deletedAt), [chores]);
  const activeCalendar = useMemo(() => (calendar as any[]).filter((ev:any) => !(ev as any).deletedAt), [calendar]);
  const activeShopping = useMemo(() => (shopping as any[]).filter((s:any) => !(s as any).deletedAt && !(s as any).archivedAt), [shopping]);

  const fmtTime = (iso: string) => {
    try { return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit', timeZone: HOUSEHOLD_TZ} as any).format(new Date(iso)) } catch { try{ return new Date(iso).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) }catch{ return "" } }
  };
  const fmtDay = (iso:string) => {
    try {
      const d = new Date(iso);
      const key = toLocalKeyDublin(iso, HOUSEHOLD_TZ);
      const isToday = key===todayDateStr;
      if(isToday) return `Today • ${fmtTime(iso)}`;
      const tomorrowKey = toLocalKeyDublin(new Date(nowMs+86400000).toISOString(), HOUSEHOLD_TZ);
      if(key===tomorrowKey) return `Tomorrow • ${fmtTime(iso)}`;
      return new Intl.DateTimeFormat('en-GB',{weekday:'short', month:'short', day:'numeric', timeZone: HOUSEHOLD_TZ}).format(d) + ` • ${fmtTime(iso)}`;
    } catch { return "" }
  };
  const timingLabel = (c:any): string => {
    try{
      const freq = ((c as any)?.frequency||"").toString().toUpperCase() || "ONCE";
      const dueMs = typeof getDueMsChore==='function' ? getDueMsChore(c) : (c?.dueAt ? new Date(c.dueAt).getTime() : Date.now());
      const diff = dueMs - nowMs;
      const isOver = diff<0;
      const dueKey = c?.dueAt ? toLocalKeyDublin(c.dueAt, HOUSEHOLD_TZ) : toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
      const isToday = dueKey === todayDateStr;
      if(isOver) return `${freq} • OVERDUE`;
      if(isToday) return `${freq} • DUE TODAY`;
      if(diff < 48*3600000) return `${freq} • DUE TOMORROW`;
      return freq;
    }catch{ return "ONCE"; }
  };
  const dueDiff = (iso:string) => {
    try{
      const dueMs = new Date(iso).getTime();
      const diffMs = dueMs - nowMs;
      const days = Math.ceil(diffMs / 86400000);
      const hours = Math.ceil(diffMs / 3600000);
      return { diffMs, days, hours, overdue: diffMs<0 };
    }catch{ return { diffMs:0, days:0, hours:0, overdue:false } }
  };

  const todayCals = useMemo(()=>{
    const agreed = (activeCalendar as any[]).filter(ev=>{
      const s:any=ev.status;
      return s==='agreed'||s==='accepted'||s==='yes'||s==='confirmed';
    }).filter(ev=>{
      try{ return toLocalKeyDublin(ev.dueAt, HOUSEHOLD_TZ)===todayDateStr }catch{return false}
    }).sort((a:any,b:any)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,3);
    return agreed;
  },[activeCalendar, todayDateStr]);

  const todayChoresMine = useMemo(()=>{
    const mine = (activeChores as any[]).filter(c=>{
      if(c.assignedTo!==currentUser || c.status==='done') return false;
      try{
        const dueMs = getDueMsChore(c as any);
        const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
        return dueKey===todayDateStr || dueMs < nowMs;
      }catch{return false}
    }).sort((a:any,b:any)=> getDueMsChore(a as any)-getDueMsChore(b as any)).slice(0,3);
    return mine;
  },[activeChores, currentUser, todayDateStr, nowMs]);

  const shoppingSummary = useMemo(() => {
    const todo = (activeShopping as any[]).filter(s=> !s.purchased);
    if (todo.length===0) return null;
    const endOfToday = (()=>{ try{
      const [y,m,d] = todayDateStr.split("-").map(Number);
      return tzWallToUtc(y,m,d,23,59,59,HOUSEHOLD_TZ);
    }catch{ return new Date(nowMs); }})();
    const dueToday = todo.filter(it=>{
      try{
        const nxt = computeShoppingNextDue(it as any, nowMs);
        if(!nxt) return false;
        const dueKey = toLocalKeyDublin(nxt.toISOString(), HOUSEHOLD_TZ);
        const isToday = dueKey === todayDateStr;
        const isOverdue = nxt.getTime() < nowMs;
        return isToday || isOverdue || nxt.getTime() <= endOfToday.getTime();
      }catch{ return false; }
    });
    if(dueToday.length===0) return null;
    const count = dueToday.length;
    const names = dueToday.slice(0,3).map((s:any)=> (s as any).item || (s as any).title || "item");
    const rest = count - names.length;
    const label = rest>0 ? `${names.join(", ")} +${rest} more` : names.join(", ");
    return { count, label, todo: dueToday };
  }, [activeShopping, todayDateStr, nowMs]);

  const shoppingDueList = useMemo(()=>{
    if(!shoppingSummary) return [];
    return (shoppingSummary.todo as any[]).slice(0,3);
  },[shoppingSummary]);

  const hasToday = todayCals.length>0 || todayChoresMine.length>0 || !!shoppingSummary;

  const upcoming = useMemo(()=>{
    const in7 = nowMs + 7*86400000;
    const agreed = (activeCalendar as any[]).filter(ev=>{
      const s:any=ev.status;
      if(!(s==='agreed'||s==='accepted'||s==='yes'||s==='confirmed'||s==='proposed'||(s||'').toString().startsWith('awaiting'))) return false;
      try{
        const ms = new Date(ev.dueAt).getTime();
        if(isNaN(ms)) return false;
        if(ms <= nowMs) return false;
        if(ms > in7) return false;
        const k = toLocalKeyDublin(ev.dueAt, HOUSEHOLD_TZ);
        if(k===todayDateStr) return false;
        return true;
      }catch{return false}
    }).sort((a:any,b:any)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,5);
    return agreed;
  },[activeCalendar, nowMs, todayDateStr]);

  const PersonDot = ({k, size=9}:{k:PersonKey,size?:number})=>{
    const p = (PERSONS as any)[k];
    return <span className="grid place-items-center rounded-full text-[10px] font-bold text-white border-2 border-white shadow-sm shrink-0" style={{background:p.accent2, width:size*1.8, height:size*1.8}}>{p.initial}</span>
  };
  const IconChevron = ()=> <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 3l5 5-5 5"/></svg>;
  const IconClock = ()=> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;

  return (
    <>
      {hasToday && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--text)]">Today</span>
            <span className="text-[11px] text-[var(--muted)]">{todayCals.length + todayChoresMine.length + (shoppingDueList.length>0?1:0)} items • Tap to open</span>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor:"var(--border)", boxShadow:"0 8px 28px rgba(0,0,0,.06), 0 1px 0 rgba(255,255,255,0.06) inset" }}>
            {(todayCals as any[]).map((ev:any, i:number)=>(
              <button key={ev.id} onClick={()=> setTab("calendar")} className="w-full text-left flex items-stretch gap-0 min-h-[56px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: i===0? undefined : "1px solid var(--border)" }}>
                <span className="w-[56px] shrink-0 grid place-items-center border-r" style={{ borderColor:'var(--border)' }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--chip-bg)] text-[11px] font-bold text-[#8B5E3C] border shadow-sm" style={{borderColor:'var(--border)'}}><IconClock/></span>
                </span>
                <span className="flex-1 flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0"><span className="block text-[11px] tabular-nums text-[var(--muted)] flex items-center gap-1">{fmtTime(ev.dueAt)} <span className="h-1 w-1 rounded-full bg-[var(--accent)] animate-pulse" /></span><span className="block text-[15px] font-medium truncate text-[var(--text)]">{ev.title}</span></span>
                  <span className="text-[11px] rounded-full border px-2.5 py-1 bg-[var(--chip-bg)] text-[var(--text-secondary)]" style={{ borderColor:'var(--border)' }}>Agreed • {ev.location||"Today"}</span>
                </span>
              </button>
            ))}
            {(todayChoresMine as any[]).map((ch:any, i:number)=>(
              <button key={ch.id} onClick={()=> setTab("chores")} className="w-full text-left flex items-stretch gap-0 min-h-[56px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: (todayCals.length>0 || i>0) ? "1px solid var(--border)" : undefined }}>
                <span className="w-[56px] shrink-0 grid place-items-center border-r" style={{ borderColor:'var(--border)' }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#EEE8FF] text-[11px] font-bold text-[#6B5CA8] shadow-sm">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.4H19l-4.4 3.2 1.7 5.4L12 13.2 7.7 16l1.7-5.4L5 7.4h5.2z"/></svg>
                  </span>
                </span>
                <span className="flex-1 flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0"><span className="block text-[11px] flex items-center gap-1.5 text-[var(--muted)]">{timingLabel(ch as any)} {timingLabel(ch as any).includes("OVERDUE") && <span className="inline-flex rounded-full bg-[#FEF2F2] border border-[#FECACA] px-1.5 py-0.5 text-[10px] font-bold text-[#991B1B]">Due</span>}</span><span className="block text-[15px] font-medium truncate text-[var(--text)]">{ch.title}</span></span>
                  <span className="text-[11px] font-semibold text-[#8B5E3C]">{ch.basePoints} pts</span>
                </span>
              </button>
            ))}
            {shoppingDueList.length>0 && (
              <button onClick={()=> setTab("shopping")} className="w-full text-left flex items-stretch gap-0 min-h-[56px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: (todayCals.length>0 || todayChoresMine.length>0) ? "1px solid var(--border)" : undefined }}>
                <span className="w-[56px] shrink-0 grid place-items-center border-r" style={{ borderColor:'var(--border)' }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0A0A0A] text-white text-[11px] shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6"><path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
                  </span>
                </span>
                <span className="flex-1 flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0"><span className="block text-[11px] uppercase tracking-wide font-semibold text-[var(--muted)]">Shop • {shoppingSummary?.count} due today</span><span className="block text-[13px] truncate text-[var(--text)]">{shoppingDueList.map((s:any)=>s.item).join(", ")}{shoppingSummary && shoppingSummary.count>3 ? ` +${shoppingSummary.count-3}`:""}</span></span>
                  <span className="h-8 w-8 grid place-items-center rounded-full bg-[#8B5E3C] text-white text-[12px]"><IconChevron/></span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {upcoming.length>0 && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--text)]">Upcoming • {upcoming.length}</span>
            <button onClick={()=> setTab("calendar")} className="text-[11px] text-[var(--muted)] underline min-h-[44px]">View all →</button>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,.06)" }}>
            {(upcoming as any[]).map((ev:any, idx:number)=>{
              const diff = dueDiff(ev.dueAt);
              const isSoon = (()=>{ try{ const due = ev.dueAt ? new Date(ev.dueAt).getTime() : ev.start ? new Date(ev.start).getTime() : null; if(!due) return false; const diff2=due-Date.now(); return diff2>=0 && diff2<=24*3600000; }catch{return false} })();
              return (
                <button key={ev.id} onClick={()=> setTab("calendar")} className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[56px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: idx===0?undefined:"1px solid var(--chip-bg)" }}>
                  <span className={"h-2 w-2 rounded-full shrink-0 "+(isSoon?"bg-[var(--accent)]":"bg-[var(--border)]")} style={isSoon?{boxShadow:'0 0 0 4px rgba(255,107,38,0.28)'}:undefined} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate text-[var(--text)]">{ev.title}</div>
                    <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><span>{fmtDay(ev.dueAt)}</span>{ev.location && <><span className="h-1 w-1 rounded-full bg-[var(--border)]" />{ev.location}</>}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.attendees?.length===1 && <PersonDot k={ev.attendees[0] as any} />}
                    <span className="text-[11px] text-[var(--muted)]"><IconChevron/></span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  );
}
