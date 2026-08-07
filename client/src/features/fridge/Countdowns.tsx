import { useMemo } from "react";
import type { TabKey, CalendarEventV2 } from "../../types";
import { HOUSEHOLD_TZ, toLocalKey as toLocalKeyDublin } from "../../lib/dates";

type Props = {
  calendar: CalendarEventV2[];
  nowMs: number;
  todayDateStr?: string;
  setTab: (k: TabKey) => void;
};

export default function Countdowns({ calendar, nowMs, todayDateStr, setTab }: Props) {
  const computedToday = todayDateStr || (()=>{ try{ return new Intl.DateTimeFormat("en-CA",{timeZone:HOUSEHOLD_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(nowMs)); }catch{ return new Date(nowMs).toISOString().slice(0,10);} })();

  const activeCalendar = useMemo(() => (calendar as any[]).filter((ev:any)=> !(ev as any).deletedAt), [calendar]);

  const fmtTime = (iso: string) => {
    try { return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit', timeZone: HOUSEHOLD_TZ} as any).format(new Date(iso)) } catch { try{ return new Date(iso).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) }catch{ return "" } }
  };
  const fmtDay = (iso:string) => {
    try {
      const d = new Date(iso);
      const key = toLocalKeyDublin(iso, HOUSEHOLD_TZ);
      const isToday = key===computedToday;
      if(isToday) return `Today • ${fmtTime(iso)}`;
      const tomorrowKey = toLocalKeyDublin(new Date(nowMs+86400000).toISOString(), HOUSEHOLD_TZ);
      if(key===tomorrowKey) return `Tomorrow • ${fmtTime(iso)}`;
      return new Intl.DateTimeFormat('en-GB',{weekday:'short', month:'short', day:'numeric', timeZone: HOUSEHOLD_TZ}).format(d) + ` • ${fmtTime(iso)}`;
    } catch { return "" }
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

  const pinnedEvents = useMemo(()=>{
    const pins = (activeCalendar as any[]).filter((ev:any)=> ev.pinned_at || ev.pinnedAt || ev.isPinned || ev.pinned).sort((a:any,b:any)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,4);
    if(pins.length>0) return pins;
    return [] as any[];
  },[activeCalendar]);

  const IconPin = ()=> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3l2 6h6l-5 4 2 6L12 15l-5 4 2-6-5-4h6z"/></svg>;

  if (pinnedEvents.length===0) return null;

  return (
    <div className="space-y-3">
      <div className="px-1 flex items-center gap-2">
        <span className="text-[20px] font-semibold tracking-tight" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>Pinned & countdowns</span>
        <span className="grid h-5 w-5 place-items-center rounded-full border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--accent-warm)'}}><IconPin/></span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {(pinnedEvents as any[]).map(ev=>{
          const {days, overdue} = dueDiff(ev.dueAt);
          const big = Math.abs(days)<=7;
          const isStar = Math.abs(days)<=3;
          return (
            <button key={ev.id} onClick={()=> setTab("calendar")} className="text-left rounded-[22px] border px-4 py-4 min-h-[112px] relative overflow-hidden transition hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)]" style={{borderColor: overdue?'rgba(239,68,68,0.28)':'var(--border)', background: overdue?'linear-gradient(180deg, color-mix(in srgb, #FEF2F2 58%, var(--card-bg)) 0%, var(--card-bg) 100%)': 'var(--card-bg)', boxShadow:'0 8px 24px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.06)'}}>
              <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full blur-[14px] pointer-events-none" style={{background:'radial-gradient(100% 100% at 50% 50%, var(--accent) 0%, transparent 70%)', opacity: isStar?0.18:0.08}} aria-hidden="true" />
              {isStar && <span className="absolute right-3 top-3 text-[12px] opacity-80" style={{color:'var(--accent)'}}>✦</span>}
              <div className="flex items-start justify-between relative">
                <span className={"text-[11px] rounded-full border px-2.5 py-1 font-semibold min-h-[22px] grid place-items-center "+(overdue?"bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]":"")} style={overdue?{}:{background:'var(--chip-bg)', color:'var(--text-secondary)', borderColor:'var(--border)'}}>{overdue?"OVERDUE":days===0?"TODAY":days===1?"TOMORROW":`${Math.abs(days)}d ${days<0?"ago":"left"}`}</span>
                <span className="h-[7px] w-[7px] rounded-full" style={{background:'var(--accent)', boxShadow: isStar?'0 0 0 5px rgba(255,107,38,0.22), 0 0 12px rgba(255,107,38,0.36)':'0 0 0 4px rgba(255,107,38,0.16)', animation: big?'fridge-peach-pulse 1.8s infinite':undefined}} />
              </div>
              <div className="mt-2.5 flex items-baseline gap-1.5 relative" style={{animation: big?'countdown-pop 0.45s cubic-bezier(0.34,1.56,0.64,1)':undefined}}>
                <span className="tracking-[-0.02em]" style={{fontFamily:'Fraunces, serif', fontWeight:700, fontSize: big?'48px':'28px', lineHeight:0.9, color: overdue?'#991B1B':'var(--text)', textRendering:'optimizeLegibility'}}>{Math.abs(days)}</span>
                <span className="text-[11px] font-medium" style={{fontFamily:'var(--font-ui)', color:'var(--muted)'}}>{Math.abs(days)===1?"day":"days"}</span>
              </div>
              <div className="mt-1.5 text-[13px] font-medium line-clamp-2 leading-[1.35]" style={{color:'var(--text)', letterSpacing:'-0.01em'}}>{ev.title}</div>
              <div className="mt-1 text-[11px] truncate" style={{color:'var(--muted)'}}>{fmtDay(ev.dueAt)}</div>
            </button>
          )
        })}
      </div>
    </div>
  );
}
