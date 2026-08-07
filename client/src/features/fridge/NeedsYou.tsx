import { useMemo } from "react";
import type { PersonKey, TabKey, ChoreV2, CalendarEventV2 } from "../../types";
import { PERSONS } from "../../constants/themes";
import { HOUSEHOLD_TZ } from "../../lib/dates";

type BaseProps = {
  currentUser: PersonKey;
  calendar: CalendarEventV2[];
  chores: ChoreV2[];
  nowMs: number;
  setTab: (k: TabKey) => void;
};

export function AwaitingYou({ currentUser, calendar, nowMs, setTab }: { currentUser: PersonKey; calendar: CalendarEventV2[]; nowMs:number; setTab:(k:TabKey)=>void }) {
  const activeCalendar = useMemo(() => (calendar as any[]).filter((ev:any) => !(ev as any).deletedAt), [calendar]);

  const tentative = useMemo(()=>{
    const list = (activeCalendar as any[]).filter(ev=>{
      const s:any=ev.status;
      return s==='proposed'|| (s||'').toString().startsWith('awaiting')||s==='needs_discussion';
    }).filter(ev=>{
      try{ const ms=new Date(ev.dueAt).getTime(); return ms>nowMs && ms<=nowMs+7*86400000 }catch{return false}
    }).sort((a:any,b:any)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,3);
    return list as CalendarEventV2[];
  },[activeCalendar, nowMs]);

  const fmtDay = (iso:string) => {
    try {
      const d = new Date(iso);
      const key = (()=>{ try{ return new Intl.DateTimeFormat("en-CA",{timeZone:HOUSEHOLD_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d); }catch{ return iso.slice(0,10);} })();
      const todayKeyNow = new Intl.DateTimeFormat("en-CA",{timeZone:HOUSEHOLD_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(nowMs));
      const tomorrowKey = new Intl.DateTimeFormat("en-CA",{timeZone:HOUSEHOLD_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(nowMs+86400000));
      const fmtTime = (i:string)=>{ try{ return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit', timeZone: HOUSEHOLD_TZ } as any).format(new Date(i)) }catch{return ""} };
      if(key===todayKeyNow) return `Today • ${fmtTime(iso)}`;
      if(key===tomorrowKey) return `Tomorrow • ${fmtTime(iso)}`;
      return new Intl.DateTimeFormat('en-GB',{weekday:'short', month:'short', day:'numeric', timeZone: HOUSEHOLD_TZ}).format(d) + ` • ${fmtTime(iso)}`;
    } catch { return "" }
  };

  if (tentative.length===0) return null;

  return (
    <div className="space-y-2.5">
      <div className="px-1 flex items-center gap-2">
        <span className="font-display text-[18px] font-semibold tracking-tight text-[var(--text)]">Awaiting you</span>
        <span className="text-[10px] rounded-full bg-[var(--card-bg)] border px-2 py-0.5 text-[#8B5E3C]" style={{borderColor:'#FDE68A'}}>{tentative.length} to respond</span>
      </div>
      <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:'#FDE68A', boxShadow:'0 8px 20px rgba(0,0,0,.05)'}}>
        {(tentative as any[]).map((ev:any,i:number)=>(
          <button key={ev.id} onClick={()=> setTab("calendar")} className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[56px] hover:bg-[var(--card-bg)]/60 transition" style={{borderTop:i===0?undefined:'1px solid #FFF7ED'}}>
            <span className="h-2 w-2 rounded-full bg-[#F59E0B] shrink-0 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium truncate">{ev.title}</div>
              <div className="text-[11px] text-[var(--muted)]">{fmtDay(ev.dueAt)} • proposed by {(PERSONS[(ev as any).proposer as any]?.name)||"partner"}</div>
            </div>
            <span className="text-[11px] font-semibold text-[#92400E] border px-2 py-1 rounded-full bg-[var(--card-bg)]">Reply</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NeedsYou({ currentUser, calendar, chores, nowMs, setTab }: BaseProps) {
  const partner: PersonKey = currentUser === "aisling" ? "ciaran" : "aisling";

  const activeChores = useMemo(() => (chores as any[]).filter(c => !(c as any).deletedAt), [chores]);
  const activeCalendar = useMemo(() => (calendar as any[]).filter((ev:any) => !(ev as any).deletedAt), [calendar]);

  const needsYourAnswer = useMemo(() => {
    const list: { id:string; title:string; kind:'chore'|'calendar'; obj:any }[] = [];
    activeChores.forEach((c:any)=>{
      if (c.status!=='deck') return;
      const my = ((c.swipes as any)?.[currentUser] ?? null);
      const other = ((c.swipes as any)?.[partner] ?? null);
      if (my===null && other!==null) list.push({ id:c.id, title:c.title, kind:'chore', obj:c });
    });
    activeCalendar.forEach((ev:any)=>{
      if (ev.status!=='proposed' && !(ev.status as any)?.toString()?.startsWith('awaiting')) return;
      const my = (ev.swipes as any)?.[currentUser] ?? null;
      const other = (ev.swipes as any)?.[partner] ?? null;
      if (my===null && other!==null) list.push({ id:ev.id, title:ev.title, kind:'calendar', obj:ev });
    });
    return list.slice(0,4);
  }, [activeChores, activeCalendar, currentUser, partner]);

  const IconChevron = ()=> <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 3l5 5-5 5"/></svg>;

  if (needsYourAnswer.length===0) return null;

  return (
    <div className="space-y-2.5">
      <div className="px-1 flex items-center gap-2">
        <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--text)]">Needs you</span>
        <span className="h-[10px] w-[10px] rounded-full bg-[var(--accent)] shrink-0" style={{ boxShadow:'0 0 0 4px rgba(255,107,38,0.14)' }} aria-hidden="true" />
      </div>
      <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor:"var(--border, #E8DDD3)", boxShadow:"0 12px 32px rgba(0,0,0,.10), 0 16px 40px rgba(120,98,84,0.08)" }}>
        {needsYourAnswer.map((item, idx)=>{
          const dateKeyForItem = (()=>{ try{ const iso=(item.obj as any)?.dueAt || (item.obj as any)?.start || (item.obj as any)?.createdAt; if(!iso) return null; const d=new Date(iso); if(isNaN(d.getTime())) return null; return new Intl.DateTimeFormat("en-CA",{timeZone:HOUSEHOLD_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d); }catch{ return null; } })();
          return (
            <button
              key={item.id}
              onClick={()=>{ if(item.kind==='calendar' && dateKeyForItem){ try{ localStorage.setItem("couple_v1_calendar_selected", dateKeyForItem); localStorage.setItem("couple_v1_calendar_viewMonth", dateKeyForItem.slice(0,7)); }catch{} } setTab(item.kind==='chore'?'chores':'calendar'); }}
              className="w-full text-left flex items-center gap-3 px-4 py-4 min-h-[60px] hover:bg-[var(--chip-bg)]/60 transition"
              style={{ borderTop: idx===0 ? undefined : "1px solid var(--chip-bg)" }}
            >
              <span className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-bold text-white shrink-0" style={{ background: (PERSONS[partner]?.accent2||'#E07A5F') }}>{(PERSONS[partner]?.initial||'?')}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold truncate text-[var(--text)]">{item.title}</div>
                <div className="text-[12px] text-[var(--muted)]">{(PERSONS[partner]?.name||partner||'?')} responded • your turn</div>
              </div>
              <span className="text-[13px] text-[var(--muted)]"><IconChevron/></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
