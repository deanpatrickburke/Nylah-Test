// ChoreHistory.tsx — history / feed
import type { ChoreV2 } from "./choreTypes";
import { relTime } from "../../shared/utils/helpers";
import { PERSONS } from "../../constants/themes";
import { effectivePoints, toLocalKeyDublin } from "./choreScoring";

type Props = {
  done: ChoreV2[];
  nowMs: number;
};

export function ChoreHistory({ done, nowMs }: Props) {
  const feed = (()=> {
    const sevenAgo=Date.now()-7*86400000;
    return done.filter(c=> c.completedAt && new Date(c.completedAt).getTime()>=sevenAgo).sort((a,b)=> new Date(b.completedAt||0).getTime()-new Date(a.completedAt||0).getTime()).slice(0,9);
  })();

  const monthlyGrouped = (()=> {
    const map: Record<string,{a:number,c:number,key:string}> = {};
    done.forEach(ch=>{
      try{
        const k = ch.completedAt ? toLocalKeyDublin(ch.completedAt, "Europe/Dublin")?.slice(0,7) : null;
        if(!k) return;
        if(!map[k]) map[k]={a:0,c:0,key:k};
        const pts=effectivePoints(ch, false);
        if(ch.completedBy==='aisling') map[k].a+=pts; else if(ch.completedBy==='ciaran') map[k].c+=pts;
      }catch{}
    });
    return Object.values(map).sort((a,b)=> a.key.localeCompare(b.key)).slice(-6);
  })();

  return (
    <div className="space-y-3">
      {feed.length>0 && (
        <div className="rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)"}}>
          <div className="text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] font-semibold">Feed • 7d</div>
          {feed.slice(0,4).map(c=>(
            <div key={c.id} className="flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5"><span className={"h-6 w-6 grid place-items-center rounded-full border text-[10px] font-bold "+(c.completedBy==="aisling"?"bg-[var(--chip-bg)] border-[#C4B5FD]":"bg-[var(--wash-top)] border-[var(--border)]")}>{c.completedBy==="aisling"?"Á":"C"}</span> {PERSONS[c.completedBy as any]?.name||c.completedBy} did {c.title}</span>
              <span className="text-[11px] text-[var(--muted)]">{c.completedAt? relTime(c.completedAt, nowMs):""}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)"}}>
        <div className="text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] font-semibold">Monthly • 600 pts scale</div>
        {monthlyGrouped.map(m=>(
          <div key={m.key} className="flex items-center justify-between text-[12px]">
            <span>{m.key}</span><span className="flex gap-2"><span>A {m.a}</span><span>C {m.c}</span><span>{m.a>m.c?"A win":m.c>m.a?"C win":"tie"}</span></span>
          </div>
        ))}
        {monthlyGrouped.length===0 && <div className="text-[11px] text-[var(--muted)]">No history yet</div>}
      </div>
    </div>
  );
}

export default ChoreHistory;
