// ChoreDone.tsx — Done tab
import type { ChoreV2 } from "./choreTypes";
import { effectivePoints, isBonusChore, timingLabel } from "./choreScoring";
import { PERSONS } from "../../constants/themes";

type Props = {
  list: ChoreV2[];
  nowMs: number;
};

export function ChoreDone({ list, nowMs }: Props) {
  if (list.length===0) {
    return (
      <div className="rounded-[28px] border border-dashed bg-[var(--card-bg)] px-6 py-10 text-center" style={{borderColor:"var(--border)"}}>
        <div className="font-display text-[16px]" style={{fontFamily:"Fraunces"}}>No done yet</div>
        <div className="text-[12px] text-[var(--muted)] mt-1">Complete chores to see 1.15× bonuses and streak</div>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {list.slice(0,20).map(c=>{
        const pts=effectivePoints(c, isBonusChore(c, c.completedAt? new Date(c.completedAt).getTime(): nowMs));
        const bonus = isBonusChore(c, c.completedAt? new Date(c.completedAt).getTime(): nowMs);
        return (
          <div key={c.id} className="w-full text-left rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 flex items-center gap-3 min-h-[72px]" style={{borderColor:"var(--border)"}}>
            <span className="grid h-8 w-8 place-items-center rounded-full border text-[10px] font-bold" style={{borderColor:"var(--border)"}}>{PERSONS[(c.completedBy||"aisling") as any]?.initial||"•"}</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[13px] truncate">{c.title}</div>
              <div className="text-[11px] text-[var(--muted)]">{timingLabel(c, nowMs)} • {pts} pts {bonus?"• 1.15×":""}</div>
            </div>
            <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-[var(--chip-bg)] border" style={{borderColor:"var(--border)"}}>+{pts}</span>
          </div>
        );
      })}
    </div>
  );
}

export default ChoreDone;
