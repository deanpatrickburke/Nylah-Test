// ChoreMine.tsx — Mine tab list
import type { ChoreV2 } from "./choreTypes";
import { effectivePoints, getDueMsChore, isBonusChore, timingLabel } from "./choreScoring";
import { PERSONS } from "../../constants/themes";

type Props = {
  list: ChoreV2[];
  nowMs: number;
  currentUser: any;
  onDetail: (c:ChoreV2)=>void;
  onComplete: (c:ChoreV2)=>void;
  onSnooze: (c:ChoreV2)=>void;
  onSwap: (c:ChoreV2)=>void;
  triggerPop: (id:string, pts:number)=>void;
  confetti: (pts:number)=>void;
  setChores: any;
  setToast: (s:string|null)=>void;
  monthKey: string;
};

export function ChoreMine({ list, nowMs, currentUser, onDetail, onComplete, onSnooze, onSwap, setChores, setToast, monthKey }: Props) {
  if (list.length===0) {
    return (
      <div className="rounded-[28px] border border-dashed bg-[var(--card-bg)] px-6 py-10 text-center" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--card-bg)] border"><svg width="24" height="24" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg></div>
        <div className="font-display text-[16px]" style={{fontFamily:"Fraunces"}}>No mine chores</div>
        <div className="text-[12px] text-[var(--muted)] mt-1">Warm paper, no emoji, 64 circle chip</div>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {list.slice(0,18).map(c=>{
        const dueMs=getDueMsChore(c);
        const overdue=dueMs < nowMs;
        const dueToday=Math.abs(dueMs-nowMs)<24*3600000;
        const points = effectivePoints(c, isBonusChore(c, nowMs));
        return (
          <div key={c.id} className="w-full text-left rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 flex items-center gap-3 min-h-[92px]" style={{borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
            <span className={"grid h-10 w-10 place-items-center rounded-full border text-[12px] font-bold shrink-0 "+(overdue?"border-[#EF4444] ring-2 ring-[#EF4444]/30": dueToday?"border-[var(--wash-mid)] ring-2 ring-[var(--wash-mid)] animate-pulse":"border-[var(--border)] bg-[var(--card-bg)]")} style={{minHeight:40, minWidth:40}}>{PERSONS[(c.assignedTo||currentUser) as any]?.initial||"•"}</span>
            <button onClick={()=> onDetail(c)} className="flex-1 text-left min-w-0">
              <div className="flex items-center gap-1.5"><span className="font-medium text-[14px] truncate">{c.title}</span><span className="rounded-full bg-[var(--card-bg)] border px-2 py-0.5 text-[10px]" style={{borderColor:"var(--border)"}}>{c.assignedTo} • clear</span></div>
              <div className="text-[11px] text-[var(--muted)]">{timingLabel(c, nowMs)} • {points} pts</div>
            </button>
            <div className="flex flex-col gap-1 shrink-0">
              <button onClick={()=> onComplete(c)} className="h-[36px] rounded-full bg-[#0A0A0A] px-3 text-[11px] text-white active:scale-[0.96] min-w-[52px]" style={{minHeight:36, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Done</button>
              <div className="flex gap-1">
                <button onClick={()=> onSnooze(c)} className="h-[28px] rounded-full border bg-[var(--card-bg)] px-2 text-[10px]" style={{borderColor:"var(--border)"}}>Snooze</button>
                <button onClick={()=> onSwap(c)} className="h-[28px] rounded-full border bg-[var(--card-bg)] px-2 text-[10px]" style={{borderColor:"var(--border)"}}>Swap</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ChoreMine;
