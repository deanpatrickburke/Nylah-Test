// ChoreOpen.tsx — Open tab (race, open, assigned to other)
import type { ChoreV2 } from "./choreTypes";
import { effectivePoints, getDueMsChore, isBonusChore, timingLabel } from "./choreScoring";
import { PERSONS } from "../../constants/themes";

type Props = {
  list: ChoreV2[];
  nowMs: number;
  currentUser: any;
  onDetail: (c:ChoreV2)=>void;
  onComplete: (c:ChoreV2)=>void;
  setChores: any;
  setToast: (s:string|null)=>void;
  monthKey: string;
};

export function ChoreOpen({ list, nowMs, currentUser, onDetail, onComplete, setChores, setToast, monthKey }: Props) {
  if (list.length===0) {
    return (
      <div className="rounded-[28px] border border-dashed bg-[var(--card-bg)] px-6 py-10 text-center" style={{borderColor:"var(--border)"}}>
        <div className="font-display text-[16px]" style={{fontFamily:"Fraunces"}}>No open chores</div>
        <div className="text-[12px] text-[var(--muted)] mt-1">Race 1.15× when both claim</div>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {list.slice(0,18).map(c=>{
        const dueMs=getDueMsChore(c);
        const overdue=dueMs < nowMs;
        const dueToday=Math.abs(dueMs-nowMs)<24*3600000;
        const isContested=(c as any).swipes?.aisling==="right" && (c as any).swipes?.ciaran==="right";
        const hoursOpen=c.updatedAt ? (nowMs - new Date(c.updatedAt).getTime())/3600000 : 0;
        const canSteal=c.assignedTo && c.assignedTo!==currentUser && (hoursOpen>3 || overdue);
        const points=effectivePoints(c, isBonusChore(c, nowMs));
        return (
          <div key={c.id} className={"w-full text-left rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 flex items-center gap-3 min-h-[92px] "+(isContested?"border-[#FCA5A5] bg-[var(--card-bg)]/30 animate-pulse":"")} style={{borderColor:isContested?"#FCA5A5":"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)", background: isContested?"#FEE2E2": overdue?"var(--card-bg)":"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
            <span className={"grid h-10 w-10 place-items-center rounded-full border text-[12px] font-bold shrink-0 "+(overdue?"border-[#EF4444] ring-2 ring-[#EF4444]/30": dueToday?"border-[var(--wash-mid)] ring-2 ring-[var(--wash-mid)] animate-pulse":"border-[var(--border)] bg-[var(--card-bg)]")} style={{minHeight:40, minWidth:40}}>{PERSONS[(c.assignedTo||currentUser) as any]?.initial||"•"}</span>
            <button onClick={()=> onDetail(c)} className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-1.5"><span className="font-medium text-[14px] truncate">{c.title}</span>{isContested && <span className="rounded-full bg-[var(--card-bg)] border border-[#FCA5A5] px-2 py-0.5 text-[10px] font-bold text-[#991B1B]">RACE • 1.15×</span>}{c.assignedTo && !isContested && <span className="rounded-full bg-[var(--card-bg)] border px-2 py-0.5 text-[10px]" style={{borderColor:"var(--border)"}}>{c.assignedTo} • clear</span>}</div>
              <div className="text-[11px] text-[var(--muted)]">{timingLabel(c, nowMs)} • {points} pts</div>
            </button>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={()=> onComplete(c)} className="h-[36px] rounded-full bg-[#0A0A0A] px-3 text-[11px] text-white active:scale-[0.96] min-w-[52px]" style={{minHeight:36, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Done</button>
              {canSteal && <button onClick={()=>{ const nowISO=new Date().toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, assignedTo:currentUser, updatedAt:nowISO}:x)); setToast(`${PERSONS[currentUser].name} stole ${c.title}`); setTimeout(()=>setToast(null),3000); }} className="h-[32px] rounded-full border bg-[var(--card-bg)] px-2.5 text-[10px] font-semibold" style={{borderColor:"var(--border)", minHeight:32}}>Steal</button>}
              <div className="flex gap-1">
                <button onClick={()=>{ const nowISO=new Date().toISOString(); const d=new Date(nowMs+48*3600000).toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, dueAt:d, updatedAt:nowISO}:x)); setToast("Snoozed 48h"); setTimeout(()=>setToast(null),2000); }} className="h-[28px] rounded-full border bg-[var(--card-bg)] px-2 text-[10px]" style={{borderColor:"var(--border)"}}>Snooze</button>
                <button onClick={()=>{ const nowISO=new Date().toISOString(); const other:any=currentUser==="aisling"?"ciaran":"aisling"; setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, assignedTo: (x.assignedTo===currentUser? other: currentUser) as any, updatedAt:nowISO}:x)); setToast("Delegated"); setTimeout(()=>setToast(null),2000); }} className="h-[28px] rounded-full border bg-[var(--card-bg)] px-2 text-[10px]" style={{borderColor:"var(--border)"}}>Swap</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ChoreOpen;
