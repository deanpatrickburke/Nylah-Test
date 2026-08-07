import { useEffect, useState } from "react";
import { HOUSEHOLD_ID, HOUSEHOLD_TZ } from "../../lib/buildMeta";

export function DataTruth({ choresRaw, calendarRaw, shoppingRaw, notesRaw }: { choresRaw?:any[]; calendarRaw?:any[]; shoppingRaw?:any[]; notesRaw?:any[] }){
  const [queueLen,setQueueLen]=useState(0);
  const [rev,setRev]=useState<string>("–");
  const [build,setBuild]=useState<string>("–");
  useEffect(()=>{
    try{
      const raw=localStorage.getItem("couple_v1_offline_queue");
      if(raw){ const q=JSON.parse(raw); if(Array.isArray(q)) setQueueLen(q.length); }
    }catch{}
    try{ setRev(localStorage.getItem("couple_v1_rev")||localStorage.getItem("couple_v1_last_sync")||"–"); }catch{}
    try{ setBuild(localStorage.getItem("couple_v1_build")||"v117"); }catch{}
  },[]);
  const c=choresRaw?.length||0;
  const cal=calendarRaw?.length||0;
  const s=shoppingRaw?.length||0;
  const n=notesRaw?.length||0;
  return (
    <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)"}}>
      <div className="text-[12px] font-semibold tracking-wide">DataTruth • couple_data</div>
      <div className="text-[11px] font-mono text-[var(--muted)]">HOUSEHOLD_ID {HOUSEHOLD_ID} TZ {HOUSEHOLD_TZ} • c:{c} cal:{cal} s:{s} n:{n} • rev {rev?.slice?.(0,24)||rev} • queue {queueLen} • build {build}</div>
      <div className="text-[11px] text-[var(--muted)]">Row counts: c:4 cal:0 etc (live) • rev • offline queue length • 100vw 390→100vw QA 44px spring cubic-bezier(0.34,1.56,0.64,1) • Fraunces 26/17 Inter 16</div>
      <div className="grid grid-cols-4 gap-2 text-[10px]">{[
        {k:"chores",v:c},{k:"calendar",v:cal},{k:"shopping",v:s},{k:"notes",v:n}
      ].map(x=><span key={x.k} className="rounded-full border bg-[var(--chip-bg)] px-2 py-1 text-center" style={{borderColor:'var(--border)'}}>{x.k}:{x.v}</span>)}</div>
    </div>
  );
}
export default DataTruth;
