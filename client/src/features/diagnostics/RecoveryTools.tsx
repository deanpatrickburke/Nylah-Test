import { useState } from "react";

export function RecoveryTools({ choresRaw, calendarRaw, shoppingRaw, notesRaw, setChoresRaw, setCalendarRaw, setShoppingRaw, setNotesRaw }: any){
  const [msg,setMsg]=useState<string|null>(null);
  async function clearSw(){
    try{
      if('serviceWorker' in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        for(const r of regs) await r.unregister();
        setMsg("SW cleared "+regs.length);
      } else setMsg("no SW");
    }catch(e:any){ setMsg("sw err "+String(e?.message||e)); }
    setTimeout(()=> setMsg(null),4000);
  }
  async function purgeIdb(){
    try{
      const dbs=await (indexedDB as any).databases?.();
      if(Array.isArray(dbs)){ for(const db of dbs){ if(db.name) indexedDB.deleteDatabase(db.name); } setMsg("IDB purged "+dbs.length); }
      else { indexedDB.deleteDatabase("couple_v1_idb"); setMsg("IDB purge requested"); }
    }catch(e:any){ setMsg("idb err "+String(e?.message||e)); }
    setTimeout(()=> setMsg(null),4000);
  }
  function debugDump(){
    try{
      const dump={ chores: choresRaw?.length, calendar: calendarRaw?.length, shopping: shoppingRaw?.length, notes: notesRaw?.length, tz:"Europe/Dublin", house:"ash-ciaran-2026", build:"v117" };
      console.log("[debug]", dump);
      setMsg("logged debug "+JSON.stringify(dump));
    }catch{}
    setTimeout(()=> setMsg(null),4000);
  }
  function nukeLocal(){
    if(!confirm("purge local? this keeps remote")) return;
    try{ localStorage.clear(); sessionStorage.clear(); setMsg("local cleared"); }catch{}
  }
  return (
    <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 space-y-3" style={{borderColor:"var(--border)"}}>
      <div className="text-[12px] font-semibold">RecoveryTools • debug • clear SW • purge IDB • 44px spring</div>
      {msg && <div className="text-[11px] text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] rounded-[8px] px-2 py-1">{msg}</div>}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={debugDump} className="h-[44px] min-h-[44px] rounded-full border bg-[var(--chip-bg)] text-[11px]" style={{borderColor:'var(--border)', transitionTimingFunction:'cubic-bezier(0.34,1.56,0.64,1)'}}>Debug dump</button>
        <button onClick={clearSw} className="h-[44px] min-h-[44px] rounded-full border bg-[var(--card-bg)] text-[11px]">Clear SW</button>
        <button onClick={purgeIdb} className="h-[44px] min-h-[44px] rounded-full border bg-[#FEF2F2] text-[#B91C1C] text-[11px]">Purge IDB</button>
        <button onClick={nukeLocal} className="h-[44px] min-h-[44px] rounded-full border bg-[#0A0A0A] text-white text-[11px]">Purge local</button>
      </div>
      <div className="text-[10px] text-[var(--muted)]">charcoal #121214 card #232326 chip #2C2C30 nav #FF6B26/#0A0A0A topBar #1E1E20 accent 12% hero 15% grain .028 • single Settings 5-group</div>
    </div>
  );
}
export default RecoveryTools;
