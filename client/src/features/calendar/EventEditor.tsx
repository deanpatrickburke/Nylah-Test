import { useEffect, useState } from "react";
import type { PersonKey } from "../../types";
import { PERSONS } from "../../constants/themes";
import { todayKey, toLocalKey as toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";
import { HOUSEHOLD_TZ } from "../../lib/buildMeta";

function timePartFromIsoDublin(iso?: string): string {
  if (!iso) return "10:00";
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: HOUSEHOLD_TZ, hour:"2-digit", minute:"2-digit", hour12:false });
    const parts = fmt.formatToParts(d);
    const h = parts.find(p=>p.type==="hour")?.value || "10";
    const m = parts.find(p=>p.type==="minute")?.value || "00";
    return `${h.padStart(2,"0")}:${m.padStart(2,"0")}`;
  } catch { return "10:00"; }
}

function wallToIsoDublin(dateKey:string, timeStr:string, allDayFlag:boolean): string {
  try {
    const [y,m,d] = dateKey.split("-").map(Number);
    if (!y||!m||!d) return new Date().toISOString();
    if (allDayFlag) return tzWallToUtc(y,m,d,0,0,0,HOUSEHOLD_TZ).toISOString();
    const [hh,mm] = (timeStr||"09:00").split(":").map(n=> Number(n)||0);
    return tzWallToUtc(y,m,d,hh,mm,0,HOUSEHOLD_TZ).toISOString();
  } catch { return new Date().toISOString(); }
}

export type AddEventFormProps = {
  onAdd: (ev:any)=>void;
  currentUser: PersonKey;
  selectedDate?: string;
  initialEvent?: any;
};

export function AddEventForm({ onAdd, currentUser, selectedDate, initialEvent }: AddEventFormProps){
  const initDateKey = (()=>{
    if (initialEvent?.dueAt) {
      const k = toLocalKeyDublin(initialEvent.dueAt, HOUSEHOLD_TZ);
      return k || selectedDate || todayKey(HOUSEHOLD_TZ);
    }
    if (initialEvent?.start) {
      const k = toLocalKeyDublin(initialEvent.start, HOUSEHOLD_TZ);
      return k || selectedDate || todayKey(HOUSEHOLD_TZ);
    }
    return selectedDate || todayKey(HOUSEHOLD_TZ);
  })();
  const initEndKey = (()=>{
    if (initialEvent?.endAt) {
      const k = toLocalKeyDublin(initialEvent.endAt, HOUSEHOLD_TZ);
      if (k) return k;
    }
    if (initialEvent?.end) {
      const k = toLocalKeyDublin(initialEvent.end, HOUSEHOLD_TZ);
      if (k) return k;
    }
    return initDateKey;
  })();
  const initAllDay = !!(initialEvent?.allDay);
  const initMulti = !!(initialEvent?.multiDay) || (()=>{
    if (!initialEvent) return false;
    const s = initialEvent.dueAt || initialEvent.start;
    const e = initialEvent.endAt || initialEvent.end;
    if (!s || !e) return false;
    const sk = toLocalKeyDublin(s, HOUSEHOLD_TZ);
    const ek = toLocalKeyDublin(e, HOUSEHOLD_TZ);
    return sk && ek && sk !== ek;
  })();

  const [title,setTitle]=useState(()=> initialEvent?.title || "");
  const [date,setDate]=useState(()=> initDateKey);
  const [startTime,setStartTime]=useState(()=> initialEvent?.dueAt ? timePartFromIsoDublin(initialEvent.dueAt || initialEvent.start) : initialEvent?.start ? timePartFromIsoDublin(initialEvent.start) : "10:00");
  const [endTime,setEndTime]=useState(()=> {
    if (!initialEvent) return "";
    const eIso = initialEvent.endAt || initialEvent.end;
    if (!eIso) return "";
    if (initAllDay) return "";
    return timePartFromIsoDublin(eIso);
  });
  const [showOptions,setShowOptions]=useState(()=> !!initialEvent);
  const [allDay,setAllDay]=useState(()=> initAllDay);
  const [multiDay,setMultiDay]=useState(()=> initMulti);
  const [endDate,setEndDate]=useState(()=> initEndKey);
  const [location,setLocation]=useState(()=> initialEvent?.location || "");
  const [notes,setNotes]=useState(()=> initialEvent?.notes || "");
  const [repeat,setRepeat]=useState<"once"|"daily"|"weekly"|"biweekly"|"monthly">(()=> {
    if (!initialEvent) return "once";
    return (initialEvent.frequency || initialEvent.repeat || "once") as any;
  });
  const [reminder,setReminder]=useState<number|undefined>(()=> initialEvent?.reminderMinutes);
  const [responseDeadline,setResponseDeadline]=useState(()=> {
    if (!initialEvent?.responseDeadline) return "";
    const k = toLocalKeyDublin(initialEvent.responseDeadline, HOUSEHOLD_TZ);
    return k || "";
  });
  const [attendees,setAttendees]=useState<PersonKey[]>(()=> {
    if (initialEvent?.attendees && Array.isArray(initialEvent.attendees) && initialEvent.attendees.length) return initialEvent.attendees;
    return ["aisling","ciaran"];
  });

  useEffect(()=>{
    if (multiDay && date && endDate===date) {
      try {
        const [y,m,d] = date.split("-").map(Number);
        const startUTC = tzWallToUtc(y,m,d,0,0,0,HOUSEHOLD_TZ);
        const wkLater = new Date(startUTC.getTime()+ 6*24*3600*1000);
        const key = toLocalKeyDublin(wkLater.toISOString(), HOUSEHOLD_TZ);
        if (key) setEndDate(key);
      } catch {}
    }
  }, [multiDay]);

  const isEndBeforeStart = multiDay && endDate && date && endDate < date;
  const isTimeInvalidSingle = !allDay && !multiDay && startTime && endTime && endTime <= startTime;
  const isRangeInvalid = !!(isEndBeforeStart || isTimeInvalidSingle);
  const invalidReason = isEndBeforeStart ? "End date must be on or after start" : isTimeInvalidSingle ? "End time must be after start time" : "";

  const fmtDeadlinePreview = responseDeadline ? (()=>{
    try { return new Date(responseDeadline+"T12:00:00").toLocaleDateString(undefined,{weekday:"short", month:"short", day:"numeric"}); } catch {return responseDeadline;}
  })() : "";

  return <div className="space-y-3">
    <div className="text-[11px] text-[var(--muted)]">Responding as {(PERSONS[currentUser]?.name||currentUser||'You')} • Europe/Dublin — {initialEvent ? "editing" : "new"}</div>
    <input id="cal-title" aria-label="Event title" value={title} onChange={e=> setTitle(e.target.value)} placeholder="Title — e.g. Dinner with Mia" className="w-full rounded-full border bg-[var(--card-bg)] px-4 h-[44px] text-[13px]" style={{ borderColor:"var(--border)" }} />
    <div className="flex gap-2">
      <div className="flex-1">
        <label htmlFor="cal-date" className="text-[11px] text-[var(--muted)]">Start date (Dublin)</label>
        <input id="cal-date" type="date" value={date} onChange={e=> setDate(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px]" style={{ borderColor: isEndBeforeStart ? "#B91C1C" : "var(--border)" }} />
      </div>
      {multiDay ? (
        <div className="flex-1">
          <label htmlFor="cal-enddate" className="text-[11px] text-[var(--muted)]">End date</label>
          <input id="cal-enddate" type="date" value={endDate} onChange={e=> setEndDate(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px]" style={{ borderColor: isEndBeforeStart ? "#B91C1C" : "var(--border)" }} />
        </div>
      ) : (
        <div className="w-[128px]">
          <label htmlFor="cal-start" className="text-[11px] text-[var(--muted)]">Start</label>
          <input id="cal-start" type="time" disabled={allDay} value={startTime} onChange={e=> setStartTime(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px] disabled:opacity-50" />
        </div>
      )}
    </div>

    {multiDay && (
      <div className="flex gap-2">
        <div className="w-[128px]">
          <label htmlFor="cal-start-multi" className="text-[11px] text-[var(--muted)]">Start time</label>
          <input id="cal-start-multi" type="time" disabled={allDay} value={startTime} onChange={e=> setStartTime(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px] disabled:opacity-50" />
        </div>
        <div className="w-[128px]">
          <label htmlFor="cal-end" className="text-[11px] text-[var(--muted)]">End time</label>
          <input id="cal-end" type="time" disabled={allDay} value={endTime} onChange={e=> setEndTime(e.target.value)} placeholder={allDay ? "23:59 for all-day" : "optional"} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px] disabled:opacity-50" style={{ borderColor: isTimeInvalidSingle ? "#B91C1C" : "var(--border)" }} />
        </div>
      </div>
    )}
    {!multiDay && (
      <div className="w-full">
        <label htmlFor="cal-end" className="text-[11px] text-[var(--muted)]">End time (optional)</label>
        <input id="cal-end" type="time" value={endTime} onChange={e=> setEndTime(e.target.value)} placeholder="optional" className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px]" style={{ borderColor: isTimeInvalidSingle ? "#B91C1C" : "var(--border)" }} />
      </div>
    )}

    {isRangeInvalid && (
      <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3l9 16H3L12 3z"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>️ {invalidReason}</div>
    )}

    <button onClick={()=> setShowOptions(v=> !v)} className="text-[11px] underline text-[var(--muted)]">Options {showOptions ? "↑" : "↓"} {multiDay ? "• multi-day" : ""} {allDay ? "• all-day" : ""}</button>
    {showOptions && (
      <div className="rounded-[14px] border bg-[var(--card-bg)] p-3 space-y-2" style={{ borderColor:"var(--border)" }}>
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={allDay} onChange={e=> setAllDay(e.target.checked)} /> All-day</label>
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={multiDay} onChange={e=> setMultiDay(e.target.checked)} /> Multi-day — schedule for a week</label>
        {multiDay && <div className="text-[11px] text-[var(--muted)]">For a full week: check All-day, pick Start + End ~7 days apart.</div>}
        <input value={location} onChange={e=> setLocation(e.target.value)} placeholder="Location" className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]" />
        <textarea value={notes} onChange={e=> setNotes(e.target.value)} placeholder="Notes" className="w-full rounded-[12px] border bg-[var(--card-bg)] px-3 py-2 text-[11px] min-h-[60px]" />
        <select value={repeat} onChange={e=> setRepeat(e.target.value as any)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]">
          <option value="once">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly (semantic — preserves day)</option>
        </select>
        <select value={reminder ?? ""} onChange={e=> setReminder(e.target.value ? Number(e.target.value) : undefined)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]">
          <option value="">No reminder</option>
          <option value="15">15 min before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
        </select>
        <label htmlFor="cal-deadline" className="text-[11px] text-[var(--muted)]">Response requested by</label>
        <input id="cal-deadline" type="date" value={responseDeadline} onChange={e=> setResponseDeadline(e.target.value)} placeholder="Response requested by" className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]" />
        <div className="text-[11px] text-[var(--muted)]">Who needs to attend</div>
        <div className="flex gap-2">
          {(["aisling","ciaran"] as PersonKey[]).map(p=> (
            <label key={p} className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={attendees.includes(p)} onChange={e=> { if(e.target.checked) setAttendees(a=> [...a,p]); else setAttendees(a=> a.filter(x=> x!==p)); }} />{PERSONS[p].name}</label>
          ))}
        </div>
        {fmtDeadlinePreview && <div className="text-[11px] text-[var(--muted)]">Response requested by {fmtDeadlinePreview}</div>}
      </div>
    )}
    <button disabled={!title.trim() || isRangeInvalid} onClick={()=> {
      const startIso = wallToIsoDublin(date, startTime, allDay);
      let finalEnd: string | undefined;
      if (multiDay) {
        if (allDay) {
          try {
            const [y2,m2,d2] = endDate.split("-").map(Number);
            finalEnd = tzWallToUtc(y2,m2,d2,23,59,0,HOUSEHOLD_TZ).toISOString();
          } catch {
            finalEnd = new Date(`${endDate}T23:59:00`).toISOString();
          }
        } else {
          finalEnd = endDate ? wallToIsoDublin(endDate, endTime||"23:59", false) : undefined;
        }
      } else {
        finalEnd = endTime ? wallToIsoDublin(date, endTime, false) : undefined;
      }

      const attend = attendees.length ? attendees : ["aisling","ciaran"] as PersonKey[];
      const isSingleAttend = attend.length===1;
      const baseProposer = initialEvent?.proposer || currentUser;
      const awaiting: any = (()=>{
        if (isSingleAttend) return "agreed";
        if (initialEvent?.status) return initialEvent.status;
        return currentUser === "aisling" ? "awaiting_ciaran" : "awaiting_aisling";
      })();

      const ev:any = {
        ...(initialEvent ? {...initialEvent} : {}),
        id: initialEvent?.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
        title:title.trim(),
        type: repeat === "once" ? "one-off" : "repeat",
        frequency: repeat,
        dueAt: startIso,
        endAt: finalEnd,
        start: startIso,
        end: finalEnd,
        proposer: baseProposer,
        status: awaiting,
        swipes: isSingleAttend ? { aisling: attend[0]==="aisling" ? "yes" : null, ciaran: attend[0]==="ciaran" ? "yes" : null } as any : (initialEvent?.swipes || {aisling: currentUser==="aisling" ? "yes" : null, ciaran: currentUser==="ciaran" ? "yes" : null}),
        responses: initialEvent?.responses || [{eventId:"", memberId:currentUser, response:"yes", respondedAt:new Date().toISOString()}],
        createdAt: initialEvent?.createdAt || new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        allDay,
        multiDay,
        endDate: multiDay ? endDate : undefined,
        location: location || undefined,
        notes: notes || undefined,
        reminderMinutes: reminder,
        responseDeadline: responseDeadline ? wallToIsoDublin(responseDeadline, "12:00", false) : undefined,
        attendees: attend,
        timezone: HOUSEHOLD_TZ,
        mutationId: (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()),
      };
      if (isSingleAttend) {
        const sole = attend[0] as PersonKey;
        ev.status = "agreed";
        ev.responses = [{eventId:ev.id, memberId:sole, response:"yes", respondedAt:new Date().toISOString()}];
        ev.swipes = { aisling: sole==="aisling" ? "yes" : null, ciaran: sole==="ciaran" ? "yes" : null } as any;
      } else if (!initialEvent) {
        ev.responses = [{eventId:ev.id, memberId:currentUser, response:"yes", respondedAt:new Date().toISOString()}];
      } else {
        ev.responses = ev.responses.map((r:any)=> ({...r, eventId: ev.id}));
        if (!ev.responses.find((r:any)=> r.memberId===currentUser)) {
          ev.responses.push({eventId:ev.id, memberId:currentUser, response:"yes", respondedAt:new Date().toISOString()});
        }
      }
      if (ev.responses?.[0]) ev.responses[0].eventId = ev.id;
      onAdd(ev);
    }} className="w-full rounded-full bg-[#0A0A0A] h-[44px] text-white text-[13px] disabled:opacity-40 disabled:cursor-not-allowed">{isRangeInvalid ? invalidReason : (attendees.length===1) ? "Save • Only you" : (initialEvent ? "Save" : "Propose")+" • "+(multiDay ? "week / multi" : "Needs a Nod")}</button>
  </div>;
}

export function EventEditor(props: AddEventFormProps){
  return <AddEventForm {...props} />;
}
export default EventEditor;
