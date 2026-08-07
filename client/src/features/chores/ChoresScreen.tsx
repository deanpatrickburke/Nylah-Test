// ChoresScreen.tsx — composer that imports all above and renders tab switcher (h-[44px] rounded-full px-4 text-[11px] etc) same as original
// Zero logic change — preserve Europe/Dublin TZ, swipe, races, 1.15× bonus, capped 1.5×, 600 pts label, offline queue, Saved timestamp logic
import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PersonKey, ChoreV2 } from "../../types";
import { PERSONS } from "../../constants/themes";
import { uid, relTime } from "../../shared/utils/helpers";
import { todayKey, toLocalKey as toLocalKeyDublin, HOUSEHOLD_TZ } from "../../lib/dates";
import { ChoreIcon, ALL_CHORE_ICON_IDS } from "../../lib/choreIcons";
import type { ChoreIconId } from "../../lib/choreIcons";
import { claimChoreViaRpc as claimChoreOccRpc } from "../../lib/normalized";

// submodules
import { effectivePoints, getDueMsChore, isBonusChore, effortHuman, getNextResetAt, getResetCountdown, computeMonthScores, computeMetaHistory } from "./choreScoring";
import { Championship } from "./Championship";
import { ChoreDeck } from "./ChoreDeck";
import { ChoreMine } from "./ChoreMine";
import { ChoreOpen } from "./ChoreOpen";
import { ChoreDone } from "./ChoreDone";
import { ChoreAdmin } from "./ChoreAdmin";
import { ChoreHistory } from "./ChoreHistory";

function BottomSheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(()=>{ onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current?.(); }
      if (e.key === "Tab" && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", h);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      if (sheetRef.current) {
        const auto = sheetRef.current.querySelector<HTMLElement>('[autofocus]');
        if (auto) auto.focus();
        else { const first = sheetRef.current.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'); first?.focus(); }
      }
    });
    return () => { document.removeEventListener("keydown", h); document.body.style.overflow = prevOverflow; try { prevFocusRef.current?.focus(); } catch {} };
  }, [open]);
  if (!open) return null;
  const content = (
    <div className="fixed inset-0 z-[80] flex items-end justify-center px-3 pb-[max(16px,env(safe-area-inset-bottom))] pointer-events-auto">
      <button aria-label="Close sheet" onClick={onClose} className="absolute inset-0 bg-[#292624]/20 backdrop-blur-[3px] min-h-[44px]" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={title ? "sheet-title" : undefined} className="relative w-full max-w-[420px] animate-[sheetIn_0.24s_ease] rounded-[16px] bg-[var(--card-bg)] border shadow-[0_-16px_48px_rgba(0,0,0,0.18)] max-h-[72dvh] flex flex-col focus:outline-none" style={{ borderColor: "var(--border)" }} tabIndex={-1}>
        <div className="flex items-center justify-center pt-3 pb-2 shrink-0" aria-hidden="true"><span className="rounded-full bg-[var(--border)]" style={{ width: "36px", height: "5px", display: "block" }} /></div>
        <div className="flex items-center justify-between px-5 pb-3 shrink-0 gap-2">
          {title ? <div id="sheet-title" className="font-display text-[16px] font-medium text-[var(--text)]">{title}</div> : <div className="flex-1" />}
          <button onClick={onClose} aria-label="Close" className="grid h-[44px] w-[44px] place-items-center rounded-full bg-[var(--card-bg)] border hover:bg-[var(--chip-bg)] shrink-0" style={{ borderColor: "var(--border)" }}>
            <span aria-hidden="true" className="text-[14px]"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
          </button>
        </div>
        <div className="px-4 pb-6 overflow-auto no-scrollbar overscroll-contain">{children}</div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

export default function ChoresScreen(props: any) {
  let { chores, setChores, currentUser, setCurrentUser, onCelebrate, nowMs } = (props || {}) as {
    chores: ChoreV2[]; setChores: any; currentUser: PersonKey; setCurrentUser?: any; onCelebrate?: any; nowMs: number;
  };
  if (!Array.isArray(chores)) chores = [] as any;
  if (typeof setChores !== 'function') setChores = (()=>{}) as any;
  if (!currentUser) currentUser = "aisling" as any;
  if (typeof setCurrentUser !== 'function') setCurrentUser = (()=>{}) as any;
  if (typeof onCelebrate !== 'function') onCelebrate = (()=>{}) as any;
  if (typeof nowMs !== 'number') nowMs = Date.now();
  const [tab, setTab] = useState<"deck"|"mine"|"open"|"done"|"admin">("deck");
  const [filter, setFilter] = useState<"all"|"today"|"week"|"overdue">("all");
  const [weekdayFilter, setWeekdayFilter] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailChore, setDetailChore] = useState<ChoreV2|null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number|null>(null);
  const [flippedId, setFlippedId] = useState<string|null>(null);
  const [pointsPops, setPointsPops] = useState<{id:string, pts:number}[]>([]);
  const [toast, setToast] = useState<string|null>(null);
  const [combo, setCombo] = useState(0);
  const [showSkeletons, setShowSkeletons] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundOn, setSoundOn] = useState(()=>{ try{return localStorage.getItem("couple_v1_sound_on")==="1"}catch{return false}});
  const [addIcon, setAddIcon] = useState<ChoreIconId>('broom');
  const [addPain, setAddPain] = useState(5);
  const [addBonus, setAddBonus] = useState(false);
  const [addFreq, setAddFreq] = useState<ChoreV2["frequency"]>("once");
  const [addWeekdays, setAddWeekdays] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [addType, setAddType] = useState<"one-off"|"repeat">("one-off");
  const [showRules, setShowRules] = useState(false);
  const [reactionMap, setReactionMap] = useState<Record<string,string[]>>(()=>{ try{ const r=localStorage.getItem("couple_v1_chore_reactions"); return r?JSON.parse(r):{} }catch{return {}} });

  const active = useMemo(()=> chores.filter(c=> !(c as any).deletedAt), [chores]);
  const deck = useMemo(()=> active.filter(c=> c.status==="deck"), [active]);
  const mine = useMemo(()=> active.filter(c=> c.assignedTo===currentUser && c.status!=="done"), [active, currentUser]);
  const open = useMemo(()=> active.filter(c=> c.status==="open" || c.status==="race" || (c.status==="assigned" && c.assignedTo!==currentUser)), [active, currentUser]);
  const done = useMemo(()=> active.filter(c=> c.status==="done"), [active]);
  const listForFilter = useMemo(()=>{
    let base: ChoreV2[] = [];
    if (tab==="deck") base = deck;
    else if (tab==="mine") base = mine;
    else if (tab==="open") base = open;
    else if (tab==="done") base = done;
    else base = active;
    if (filter==="today") {
      const todayK = todayKey(HOUSEHOLD_TZ);
      return base.filter(c=> {
        const k = c.dueAt ? toLocalKeyDublin(c.dueAt, HOUSEHOLD_TZ) : null;
        return k===todayK;
      });
    }
    if (filter==="week") {
      const now = nowMs;
      const weekEnd = now + 6*86400000;
      return base.filter(c=> {
        const due = getDueMsChore(c);
        return due>=now && due<=weekEnd;
      });
    }
    if (filter==="overdue") {
      const now = nowMs;
      return base.filter(c=> getDueMsChore(c)<now && c.status!=="done");
    }
    if(tab==="admin") return base;
    if(weekdayFilter.some(Boolean)){
      const names=["Mo","Tu","We","Th","Fr","Sa","Su"];
      const sel=names.filter((_,i)=>weekdayFilter[i]);
      return base.filter(c=>{
        const det=c.frequencyDetail||"";
        return sel.some(s=> det.includes(s));
      });
    }
    return base;
  }, [tab, deck, mine, open, done, active, filter, nowMs, weekdayFilter]);

  const deckCount = deck.length;
  const currentCard = deck[0] || null;
  const nowDate = new Date(nowMs);
  const monthKey = new Intl.DateTimeFormat('en-CA',{timeZone:HOUSEHOLD_TZ, year:'numeric', month:'2-digit'}).format(nowDate).slice(0,7);
  const nextResetAt = useMemo(()=> getNextResetAt(nowDate), [nowDate]);
  const [tick,setTick]=useState(()=>Date.now());
  useEffect(()=>{
    let id:any = null;
    const schedule = ()=>{
      const diff = nextResetAt.getTime()-Date.now();
      const isLastHour = diff>0 && diff<3600000;
      const interval = isLastHour ? 1000 : 60000;
      if(id) clearInterval(id);
      id = setInterval(()=>{ if(document.hidden) return; setTick(Date.now()); }, interval);
    };
    schedule();
    const onVis = ()=>{ if(!document.hidden){ setTick(Date.now()); schedule(); } };
    document.addEventListener("visibilitychange", onVis);
    return ()=>{ if(id) clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  },[nextResetAt]);
  useEffect(()=>{
    try{
      const mql=window.matchMedia("(prefers-reduced-motion: reduce)");
      setReducedMotion(mql.matches);
      const fn=(e:any)=>setReducedMotion(e.matches);
      mql.addEventListener?.("change",fn);
      return ()=>mql.removeEventListener?.("change",fn);
    }catch{}
  },[]);
  useEffect(()=>{ const t=setTimeout(()=>setShowSkeletons(false), 700); return ()=>clearTimeout(t); },[tab]);
  useEffect(()=>{ try{ localStorage.setItem("couple_v1_chore_reactions", JSON.stringify(reactionMap)); }catch{} },[reactionMap]);

  const countdown = useMemo(()=> getResetCountdown(nextResetAt, tick), [nextResetAt, tick]);
  const monthScores = useMemo(()=> computeMonthScores(done, monthKey), [done, monthKey]);
  const metaHistory = useMemo(()=> computeMetaHistory(done), [done]);

  function timingLabel(c: ChoreV2): string {
    const freq = (c.frequency||"").toUpperCase() || "ONCE";
    const dueMs = getDueMsChore(c);
    const diff = dueMs - nowMs;
    try{
      const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
      const isToday = dueKey === todayKey(HOUSEHOLD_TZ);
      const isOver = diff<0;
      if(isOver) return `${freq} • OVERDUE`;
      if(isToday) return `${freq} • DUE TODAY`;
      if(diff < 48*3600000) return `${freq} • DUE TOMORROW`;
    }catch{}
    return freq;
  }

  function triggerPointsPop(id:string, pts:number){
    setPointsPops(p=> [...p, {id, pts}]);
    setTimeout(()=> setPointsPops(p=> p.filter(x=> x.id!==id)), 900);
    if(soundOn){
      try{
        const ctx=new (window as any).AudioContext();
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.frequency.value= 440 + Math.min(pts*2, 320);
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.12, ctx.currentTime);
        o.start(); o.stop(ctx.currentTime+0.12);
      }catch{}
    }
  }

  function confettiByPoints(pts:number, el?: any){
    if(reducedMotion) return;
    const count = pts<60 ? 12 : pts<100 ? 24 : 36;
    try{ onCelebrate?.({ points: pts, count, el }); }catch{}
  }

  function handleSwipe(dir:"left"|"right") {
    if(!currentCard) return;
    const me = currentUser;
    const partner: PersonKey = me==="aisling"?"ciaran":"aisling";
    const nowISO=new Date().toISOString();
    const safeBaseSwipes = (currentCard.swipes as any) ?? {aisling:null, ciaran:null};
    const baseSwipes = safeBaseSwipes.a !== undefined || safeBaseSwipes.b !== undefined ? {aisling: safeBaseSwipes.a ?? null, ciaran: safeBaseSwipes.b ?? null} : safeBaseSwipes;
    if(dir==="right"){
      const otherSwipe = (baseSwipes as any)[partner];
      const nextSwipes = { ...(baseSwipes as any), [me]: "right" } as any;
      let nextStatus: any = "assigned";
      let assigned: any = me;
      if(otherSwipe==="right"){
        nextStatus="open";
        assigned=null;
        setToast("RACE • first to do wins 1.15× bonus");
      } else {
        setToast(`${PERSONS[me].name} claimed ${currentCard.title} • ${currentCard.basePoints} pts`);
      }
      setChores((prev:any)=> prev.map((x:any)=> x.id===currentCard.id ? {...x, swipes: nextSwipes, status: nextStatus, assignedTo: assigned, updatedAt: nowISO, updatedBy: me, seen: true} : x));
      setDragX(0);
      setCombo(c=>c+1); triggerPointsPop(currentCard.id, currentCard.basePoints); if(nextStatus==="open") confettiByPoints(currentCard.basePoints);
      try{ import('../../lib/push').then(m=> (m as any).notifyOther(me as any, {title: `${(me==='aisling'?'Aisling':'Ciarán')} claimed ${currentCard.title}`, body: `${nextStatus==='open'?'Race — first wins 1.15×':'Your turn'}`, url: './?standalone'})) }catch{}
      try{ localStorage.setItem("couple_v1_last_local_write", nowISO); }catch{}
      try{ const cur = Number(localStorage.getItem("couple_v1_chore_streak")||0); localStorage.setItem("couple_v1_chore_streak", String(cur+1)); }catch{}
      if(navigator.vibrate){ try{navigator.vibrate(10)}catch{} }
      setTimeout(()=> setToast(null), 2200);
      return;
    } else {
      const nextSwipes = { ...(baseSwipes as any), [me]: null } as any;
      if((baseSwipes as any)[partner]==="left" || (baseSwipes as any)[partner]==null){
        nextSwipes[partner]=null;
      }
      setChores((prev:any)=>{
        const without = (prev as any[]).filter((x:any)=> x.id!==currentCard.id);
        const meCard = {...currentCard, swipes: nextSwipes, status:"deck", assignedTo:null, updatedAt: nowISO, updatedBy: me, seen: true, snoozedUntil: new Date(Date.now()+24*3600000).toISOString() } as any;
        const deckCountNow = without.filter((c:any)=> c.status==="deck").length;
        let idx = 0;
        let deckSeen=0;
        for(let i=0;i<without.length;i++){
          if((without[i] as any).status==="deck") deckSeen++;
          if(deckSeen===deckCountNow) { idx=i+1; break; }
        }
        if(idx===0) idx=deckCountNow;
        const next = [...without.slice(0, idx), meCard, ...without.slice(idx)];
        return next;
      });
      setDragX(0);
      setCombo(0);
      setToast(`Passed • ${currentCard.title} will resurface later`);
      try{ localStorage.setItem("couple_v1_last_local_write", nowISO); }catch{}
      if(navigator.vibrate){ try{navigator.vibrate([10,30])}catch{} }
      setTimeout(()=> setToast(null), 1800);
      return;
    }
  }

  const onDetail = (c:ChoreV2)=> setDetailChore(c);
  const onComplete = async (c:any)=>{
    // Atomic claim first - if fails, do not mark, points, confetti, streak, notify
    try{
      const res = await claimChoreOccRpc(c.id, currentUser as any);
      // If RPC unavailable (null), fail closed - do not mark locally
      if (!res) {
        setToast(`Couldn't claim — check connection`);
        setTimeout(()=>setToast(null),2500);
        return;
      }
      if (res.claimed===false || (res as any).claimed === false) {
        const who = res.alreadyBy || 'other';
        setToast(`Already by ${who}`);
        setTimeout(()=>setToast(null),2500);
        return;
      }
    } catch(e:any) {
      setToast(`Claim failed — try again`);
      setTimeout(()=>setToast(null),2500);
      return;
    }
    const nowISO=new Date().toISOString();
    // Server confirmed - now update local UI only
    setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, status:"done", completedBy:currentUser, completedAt:nowISO, updatedAt:nowISO, updatedBy:currentUser} : x));
    // Only award points after confirmation
    triggerPointsPop(c.id, effectivePoints(c,false));
    confettiByPoints(effectivePoints(c,false));
    try{ import('../../lib/push').then(m=> (m as any).notifyOther(currentUser as any, {title: `${(currentUser==='aisling'?'Aisling':'Ciarán')} did ${c.title}`, body: `+${effectivePoints(c,false)} pts — ${monthKey}`, url: './?standalone'})) }catch{}
    if(c.assignedTo && c.assignedTo!==currentUser){ setToast(`${PERSONS[currentUser].name} stole ${c.title}`); setTimeout(()=>setToast(null),3000); }
  };
  const onSnooze = (c:any)=>{
    const nowISO=new Date().toISOString();
    const d=new Date(nowMs+48*3600000).toISOString();
    setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, dueAt:d, updatedAt:nowISO}:x));
    setToast("Snoozed 48h"); setTimeout(()=>setToast(null),2000);
  };
  const onSwap = (c:any)=>{
    const nowISO=new Date().toISOString();
    const other:PersonKey=currentUser==="aisling"?"ciaran":"aisling";
    setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, assignedTo: (x.assignedTo===currentUser? other: currentUser) as any, updatedAt:nowISO}:x));
    setToast("Delegated"); setTimeout(()=>setToast(null),2000);
  };

  const templates = [
    {k:"Bins", title:"Take bins out", pain:3, freq:"weekly", icon:"bins" as ChoreIconId},
    {k:"Dishes", title:"Wash dishes", pain:4, freq:"daily", icon:"dishes" as ChoreIconId},
    {k:"Laundry", title:"Laundry", pain:5, freq:"weekly", icon:"laundry" as ChoreIconId},
    {k:"Vacuum", title:"Vacuum living room", pain:6, freq:"weekly", icon:"vacuum" as ChoreIconId},
    {k:"Bathroom", title:"Clean bathroom", pain:8, freq:"weekly", icon:"bathroom" as ChoreIconId},
    {k:"Shop", title:"Groceries", pain:5, freq:"weekly", icon:"groceries" as ChoreIconId},
  ];

  const feed = useMemo(()=>{
    const sevenAgo=Date.now()-7*86400000;
    return done.filter(c=> c.completedAt && new Date(c.completedAt).getTime()>=sevenAgo).sort((a,b)=> new Date(b.completedAt||0).getTime()-new Date(a.completedAt||0).getTime()).slice(0,9);
  },[done]);

  const isClear = deck.length===0;

  return (
    <div className="w-full space-y-5 pb-[96px] min-h-[calc(100vh-16px)]">
      <style>{`
        @keyframes popUp{0%{transform:translateY(0); opacity:1} 100%{transform:translateY(-24px); opacity:0}}
        @keyframes popUpBouncy{0%{transform:translateY(12px) scale(0.7); opacity:0} 35%{transform:translateY(-10px) scale(1.15); opacity:1} 66%{transform:translateY(2px) scale(0.98)} 100%{transform:translateY(-22px) scale(1); opacity:0}}
        @keyframes pulseRace{0%,100%{transform:scale(1)} 50%{transform:scale(1.02)}}
        @keyframes floatHeart{0%{transform:translateY(0) scale(1)} 50%{transform:translateY(-3px) scale(1.05)} 100%{transform:translateY(0) scale(1)}}
      `}</style>

      <Championship monthScores={monthScores} countdown={countdown} metaHistory={metaHistory as any} monthKey={monthKey} isClear={isClear} />

      <div className="flex items-center justify-between px-1">
        <h2 className="font-display text-[26px] font-semibold tracking-tight flex items-center gap-2" style={{fontFamily:"Fraunces, serif"}}>Chores <span className="inline-flex rounded-full bg-[var(--chip-bg)] border px-2.5 py-0.5 text-[11px] font-medium" style={{borderColor:"var(--border)"}}>{active.length} total</span></h2>
        <div className="flex items-center gap-2">
          <button onClick={()=> setSoundOn(s=>{ const n=!s; try{localStorage.setItem("couple_v1_sound_on", n?"1":"0")}catch{}; return n;})} className={"grid h-11 w-11 place-items-center rounded-full border bg-[var(--card-bg)] text-[12px] active:scale-[0.96] transition "+(soundOn?"ring-2 ring-[#A89FDA]":"")} style={{borderColor:"var(--border)", minHeight:44, minWidth:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}} aria-label="Sound toggle">{soundOn? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="1.6"><path d="M11 5 L6 9 H2 v6 h4 l5 4z"/><path d="M15 9a4 4 0 010 6"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.6"><path d="M11 5 L6 9 H2 v6 h4 l5 4z"/><path d="M16 9l4 6M20 9l-4 6"/></svg>}</button>
          <button onClick={()=> setShowAdd(true)} className="grid h-11 w-11 place-items-center rounded-full bg-[#0A0A0A] text-white text-[18px] active:scale-[0.96]" style={{minHeight:44, minWidth:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>+</button>
        </div>
      </div>

      <div className="px-1 overflow-x-auto no-scrollbar">
        <div className="inline-flex rounded-full border p-1 gap-1" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)"}}>
          {(["deck","mine","open","done","admin"] as const).map(t=> (
            <button key={t} onClick={()=> setTab(t)} className={"h-[44px] rounded-full px-4 text-[11px] font-semibold capitalize transition flex items-center gap-1 min-w-[52px] "+(tab===t?"bg-[#0A0A0A] text-white shadow-sm":"text-[var(--text-secondary)] hover:bg-[var(--card-bg)]")} style={{ minHeight:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>
              {t==="admin" ? <span className="flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.2a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.2a1.6 1.6 0 00-1.5 1z"/></svg> Admin</span> : <span>{t} {t==="deck"?"•"+deckCount:t==="mine"? "•"+mine.length:t==="open"? "•"+open.length:""}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab==="deck" ? (
        <>
          <ChoreDeck
            deck={deck}
            currentCard={currentCard}
            deckCount={deckCount}
            dragX={dragX}
            dragging={dragging}
            startX={startX}
            setDragX={setDragX}
            setDragging={setDragging}
            onSwipe={handleSwipe}
            flippedId={flippedId}
            setFlippedId={setFlippedId as any}
            pointsPops={pointsPops}
            nowMs={nowMs}
            onTapCard={(c)=> setFlippedId(f=> f===c.id? null: c.id)}
            combo={combo}
            filter={filter}
            setFilter={setFilter}
            showSkeletons={showSkeletons}
            setShowRules={setShowRules}
          />

          {feed.length>0 && (
            <div className="rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)"}}>
              <div className="text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] font-semibold">Feed • 7d</div>
              {feed.slice(0,4).map(c=>(
                <div key={c.id} className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5"><span className={"h-6 w-6 grid place-items-center rounded-full border text-[10px] font-bold "+(c.completedBy==="aisling"?"bg-[var(--chip-bg)] border-[#C4B5FD]":"bg-[var(--wash-top)] border-[var(--border)]")}>{c.completedBy==="aisling"?"Á":"C"}</span> {PERSONS[c.completedBy as any]?.name||c.completedBy} did {c.title}</span>
                  <span className="text-[11px] text-[var(--muted)]">{c.completedAt? relTime(c.completedAt, nowMs):""}</span>
                </div>
              ))}
              <div className="flex gap-1.5 pt-1">
                {[
                  {k:"flame", svg:<svg width="14" height="14" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 2 C10 6 4 8 4 13 a6 6 0 0012 0 c0-5-6-7-4-11z"/></svg>},
                  {k:"eye", svg:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.4"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>},
                  {k:"sparkle", svg:<svg width="14" height="14" viewBox="0 0 24 24" fill="#A89FDA"><path d="M12 2l2.4 7.6H22l-6.2 4.6 2.4 7.8L12 17.4 5.8 22l2.4-7.8L2 9.6h7.6z"/></svg>},
                ].map(r=> <button key={r.k} onClick={()=>{ try{ const m={...reactionMap}; const arr=m[feed[0]?.id]||[]; if(!arr.includes(r.k)) m[feed[0].id]=[...arr, r.k]; setReactionMap(m);}catch{} }} className="h-[36px] w-[36px] grid place-items-center rounded-full border bg-[var(--card-bg)] active:scale-[0.94]" style={{borderColor:"var(--border)", minHeight:36, minWidth:36}}>{r.svg}</button>)}
              </div>
            </div>
          )}

          <div className="pt-2 border-t mt-4 space-y-2" style={{borderColor:"var(--chip-bg)"}}>
            <div className="flex items-center justify-between px-1">
              <span className="font-display text-[13px]" style={{fontFamily:"Fraunces"}}>This week • {monthScores.pct}% to win</span>
              <button onClick={()=> { try{(document.getElementById("stats") as any)?.scrollIntoView?.();}catch{} }} className="text-[11px] underline text-[var(--muted)]">Stats</button>
            </div>
            <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 flex items-center justify-between" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
              <span className="text-[12px] font-semibold">Aisling</span><span className="font-bold text-[14px]">{(()=>{ const sevenAgo=Date.now()-7*86400000; let a=0; done.forEach((c:any)=>{ const ts=c.completedAt? new Date(c.completedAt).getTime():0; if(ts>=sevenAgo && c.completedBy==='aisling') a+=effectivePoints(c, isBonusChore(c, ts)); }); return a; })()}</span>
              <span className="text-[11px] text-[var(--muted)]">vs</span>
              <span className="font-bold text-[14px]">{(()=>{ const sevenAgo=Date.now()-7*86400000; let b=0; done.forEach((c:any)=>{ const ts=c.completedAt? new Date(c.completedAt).getTime():0; if(ts>=sevenAgo && c.completedBy==='ciaran') b+=effectivePoints(c, isBonusChore(c, ts)); }); return b; })()}</span><span className="text-[12px] font-semibold">Ciarán</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#0A0A0A]/10 overflow-hidden flex gap-px">
              <div className="h-full bg-[#A89FDA]" style={{width: (monthScores.a/monthScores.total)*100+"%"}} />
              <div className="h-full bg-[#E07A5F]" style={{width: (monthScores.c/monthScores.total)*100+"%"}} />
            </div>
          </div>
        </>
      ) : tab==="admin" ? (
        <ChoreAdmin active={active} chores={chores as any} setChores={setChores} currentUser={currentUser} monthKey={monthKey} templates={templates} toast={toast} setToast={setToast as any} />
      ) : (
        <div className="space-y-3">
          {listForFilter.length===0 ? (
            <div className="rounded-[28px] border border-dashed bg-[var(--card-bg)] px-6 py-10 text-center" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--card-bg)] border"><svg width="24" height="24" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg></div>
              <div className="font-display text-[16px]" style={{fontFamily:"Fraunces"}}>No {tab} chores</div>
              <div className="text-[12px] text-[var(--muted)] mt-1">Warm paper, no emoji, 64 circle chip</div>
              <button onClick={()=> setShowAdd(true)} className="mt-3 h-[44px] rounded-full bg-[#0A0A0A] px-5 text-[12px] text-white active:scale-[0.96]" style={{minHeight:44}}>Add a chore you hate</button>
            </div>
          ) : tab==="mine" ? (
            <ChoreMine list={listForFilter as any} nowMs={nowMs} currentUser={currentUser} onDetail={onDetail} onComplete={onComplete} onSnooze={onSnooze} onSwap={onSwap} triggerPop={triggerPointsPop} confetti={confettiByPoints} setChores={setChores} setToast={setToast as any} monthKey={monthKey} />
          ) : tab==="open" ? (
            <ChoreOpen list={listForFilter as any} nowMs={nowMs} currentUser={currentUser} onDetail={onDetail} onComplete={onComplete} setChores={setChores} setToast={setToast as any} monthKey={monthKey} />
          ) : tab==="done" ? (
            <>
              <ChoreDone list={listForFilter as any} nowMs={nowMs} />
              <ChoreHistory done={done as any} nowMs={nowMs} />
            </>
          ) : (
            <ChoreMine list={listForFilter as any} nowMs={nowMs} currentUser={currentUser} onDetail={onDetail} onComplete={onComplete} onSnooze={onSnooze} onSwap={onSwap} triggerPop={triggerPointsPop} confetti={confettiByPoints} setChores={setChores} setToast={setToast as any} monthKey={monthKey} />
          )}
          <div className="text-[11px] text-[var(--muted)]/60 px-1 flex items-center justify-between"><span>{monthKey} • {active.length} active</span><span className="tabular-nums">{countdown.d}d {countdown.h}h {countdown.m}m</span></div>
          {(()=>{ const sevenAgo=Date.now()-7*86400000; let aStreak=0; const sorted=done.filter((c:any)=> c.completedAt && new Date(c.completedAt).getTime()>=sevenAgo).sort((aa:any,bb:any)=> new Date(bb.completedAt).getTime()-new Date(aa.completedAt).getTime()); for(const ch of sorted){ if(ch.completedBy===currentUser) aStreak++; else break; } return aStreak>=2 ? <div className="rounded-full bg-[#0A0A0A] text-white px-3 py-1.5 text-[11px] inline-flex gap-1 items-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="#FACC15"><path d="M12 2a7 7 0 00-7 7c0 5 7 11 7 11s7-6 7-11a7 7 0 00-7-7z"/></svg> {aStreak} win streak • keep it</div> : null; })()}
        </div>
      )}

      <BottomSheet open={!!detailChore} onClose={()=> { setDetailChore(null); setFlippedId(null); }} title={detailChore?.title}>
        {detailChore && (
          <div className="space-y-3">
            <div className="rounded-[16px] p-3 border" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{timingLabel(detailChore)}</div>
              <div className="text-[13px] font-medium mt-1">{detailChore.frequencyDetail ? `Repeats: ${detailChore.frequencyDetail}` : `Frequency: ${detailChore.frequency}`} • {detailChore.type}</div>
              <div className="text-[12px] text-[var(--muted)] mt-1">Pain {detailChore.pain}/10 • {effortHuman(detailChore.pain)} • {effectivePoints(detailChore, isBonusChore(detailChore, nowMs))} pts • {detailChore.multiplier>1?"1.15× bonus":"base"} • {detailChore.basePoints} base → {(detailChore.basePoints*1.15).toFixed(0)} (2d overdue 1.15×)</div>
              <div className="text-[12px] mt-1">Due: {new Date(getDueMsChore(detailChore)).toLocaleString("en-GB",{timeZone:HOUSEHOLD_TZ})}</div>
              <div className="text-[11px] mt-1">Streak <span className="inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 2 C10 6 4 8 4 13 a6 6 0 0012 0 c0-5-6-7-4-11z"/></svg></span> combo {combo} • Saved • {active.length} • {(()=>{ try{return localStorage.getItem("couple_v1_queue_count")||"0"}catch{return "0"}})()} synced</div>
            </div>
            <div className="flex gap-2">
                            <button onClick={async()=> { 
                try{
                  const res=await claimChoreOccRpc(detailChore.id, currentUser as any);
                  if (!res) { setToast(`couldn't claim — try again`); setTimeout(()=>setToast(null),2500); return; }
                  if (res && res.claimed===false) { setToast(`Already done by ${res.alreadyBy||'other'}`); setTimeout(()=>setToast(null),2500); return; }
                }catch{ setToast(`claim failed`); setTimeout(()=>setToast(null),2500); return; }
                const nowISO=new Date().toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===detailChore.id ? {...x, status:"done", completedBy: currentUser, completedAt:nowISO, updatedAt:nowISO, updatedBy:currentUser} : x)); setDetailChore(null); const pts=effectivePoints(detailChore,false); triggerPointsPop(detailChore.id, pts); confettiByPoints(pts); try{ import('../../lib/push').then(m=> (m as any).notifyOther(currentUser as any, {title: `${(currentUser==='aisling'?'Aisling':'Ciarán')} did ${detailChore.title}`, body: `+${pts} pts • ${monthKey}`, url: './?standalone'})) }catch{} }} className="flex-1 h-[52px] rounded-[16px] bg-[#0A0A0A] text-white text-[13px] font-semibold active:scale-[0.96]" style={{minHeight:52, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Mark done • +{effectivePoints(detailChore,false)}</button>
              <button onClick={()=> { const nowISO=new Date().toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===detailChore.id ? {...x, status:"deck", swipes:{aisling:null,ciaran:null}, updatedAt:nowISO, updatedBy:currentUser}:x)); setDetailChore(null); triggerPointsPop(detailChore.id, 20); confettiByPoints(20); }} className="flex-1 h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[13px] active:scale-[0.96]" style={{borderColor:"var(--border)", minHeight:44}}>Reshuffle</button>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{ if(!detailChore) return; setDetailChore(null); setTab("admin"); }} className="flex-1 h-[44px] rounded-full border bg-[var(--card-bg)] text-[12px]" style={{borderColor:"var(--border)", minHeight:44}}>Edit • Admin</button>
              <button onClick={()=>{ const nowISO=new Date().toISOString(); const half1={...detailChore, id: uid("chk"), title: detailChore.title+" • A", pain: Math.ceil(detailChore.pain/2), basePoints: Math.ceil(detailChore.basePoints/2), updatedAt:nowISO}; const half2={...detailChore, id: uid("chk"), title: detailChore.title+" • B", pain: Math.floor(detailChore.pain/2)||1, basePoints: Math.floor(detailChore.basePoints/2)||5, updatedAt:nowISO}; setChores((p:any)=> [half1, half2, ...p.filter((x:any)=> x.id!==detailChore.id)]); setDetailChore(null); setToast("Split into two"); setTimeout(()=>setToast(null),2000); }} className="flex-1 h-[44px] rounded-full border bg-[var(--card-bg)] text-[11px]" style={{borderColor:"var(--border)", minHeight:44}}>Split • Two</button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={showRules} onClose={()=> setShowRules(false)} title="How chores works">
        <div className="space-y-4 px-1">
          <div className="rounded-[16px] border bg-[var(--chip-bg)]/40 p-3 text-[12px] leading-[1.5]" style={{borderColor:"var(--border)"}}>
            <div className="font-semibold text-[13px] mb-1">The game</div>
            <div>Every chore lives in the Deck. You both swipe through the same deck. Right = you claim it, Left = you pass it on.</div>
          </div>
          <div className="space-y-2 text-[12px]">
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[#0A0A0A] text-white text-[10px] shrink-0">R</span><span><b>Swipe Right = I'll do it</b> — moves to your Mine. You own it. If you finish it, you get the points.</span></div>
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[var(--card-bg)] border text-[10px] shrink-0">L</span><span><b>Swipe Left = Pass</b> — you don't want it, rotates to your partner. If you both pass, it goes back to deck (24h snooze).</span></div>
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[var(--card-bg)] border-[#FCA5A5] border text-[10px] shrink-0">⚡</span><span><b>Both right = Race</b> — you both claimed it → it becomes Open + 1.15× bonus (15% extra). First to complete wins the boosted points.</span></div>
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[var(--wash-mid)] text-[10px] shrink-0">↔</span><span><b>Steal / Swap</b> — Mine items stuck &gt;3h or overdue can be stolen by partner. Anyone can swap owner.</span></div>
          </div>
          <div className="rounded-[16px] border bg-[var(--card-bg)] p-3 text-[12px] space-y-1.5" style={{borderColor:"var(--border)"}}>
            <div className="font-semibold text-[13px]">Points = pain × 10</div>
            <div className="text-[11px] text-[var(--muted)]">Pain 1 = Tiny (10pts), 5 = Medium (50pts), 10 = Brutal (100pts). Pain is effort, not priority.</div>
            <div>• Base = pain × 10 (10-100)</div>
            <div>• Bonus 1.15× if you check Bonus when adding (under 10% of chores should be bonus — nasty jobs)</div>
            <div>• Race 1.15× when both claim same chore</div>
            <div>• Overdue 1.15× after 2 days (auto)</div>
            <div>• Capped at 1.5× base max — hardest job 100 → 150 max</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">Championship = calendar month, resets 1st 00:00 {HOUSEHOLD_TZ}. Scoreboard shows total + this week. Archive old after month.</div>
          </div>
          <button onClick={()=> setShowRules(false)} className="w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[13px] font-semibold">Got it • Let's play</button>
        </div>
      </BottomSheet>

            <BottomSheet open={showAdd} onClose={()=> setShowAdd(false)} title="">
        <div className="space-y-5 px-1">
          {/* Masthead — editorial */}
          <div className="pt-1 pb-0">
            <div className="font-['Fraunces'] text-[22px] font-[680] tracking-[-0.01em] text-[var(--text)] leading-[1.05]">New chore</div>
            <div className="font-['Fraunces'] text-[12.5px] italic text-[var(--muted)] mt-1 tracking-[0.01em]">pain = points • a tiny ritual, not a form</div>
          </div>

          {/* Title input — boutique */}
          <div className="space-y-2.5">
            <input
              id="chore-title"
              placeholder="Bins, dishes, laundry…"
              className="w-full h-[56px] rounded-[18px] border px-[18px] text-[15.5px] font-[500] tracking-[-0.01em] placeholder:text-[var(--muted)]/55 focus:outline-none focus:ring-[3px] focus:ring-[#F7E1CC]/60 focus:border-[#EADFCE] transition-all"
              style={{ background: "#FFFDFA", borderColor: "#EADFCE", color: "var(--text)", minHeight:56 }}
              autoFocus
            />
            <div className="flex items-center gap-2 flex-wrap">
              {templates.slice(0,3).map((t:any)=>(
                <button
                  key={t.k}
                  onClick={()=>{ const el=document.getElementById("chore-title") as HTMLInputElement; if(el) el.value=t.title; setAddIcon(t.icon); setAddPain(t.k==="Bins"?3:t.k==="Dishes"?4:6); }}
                  className="h-[28px] rounded-full border px-3 text-[11.5px] font-[520] tracking-[0.01em] transition hover:bg-[#FFFDFA]"
                  style={{ background:"#FFF8EF", borderColor:"#EAE0D2", color:"var(--text-secondary)"}}
                >
                  <span className="inline-flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-[#D07A5F] opacity-70" />{t.k}</span>
                </button>
              ))}
              <button onClick={()=> setShowRules(true)} className="text-[11px] font-[450] underline decoration-dotted underline-offset-4 text-[var(--muted)] hover:text-[var(--text-secondary)]">How scoring works?</button>
            </div>
          </div>

          {/* Effort — dot scale */}
          <div className="rounded-[18px] border bg-[var(--card-bg)] px-4 py-3.5" style={{borderColor:"var(--border)"}}>
            <div className="flex items-baseline justify-between">
              <span className="text-[10.5px] font-[650] tracking-[0.12em] uppercase text-[#8A7D6E]">How heavy?</span>
              <span className="font-['Fraunces'] text-[11.5px] italic text-[var(--muted)] tabular-nums">
                {(()=>{ const p=addPain; if(p<=2) return "Whisper"; if(p<=4) return "Light"; if(p<=6) return "Medium"; if(p<=8) return "Hefty"; return "Brutal"; })()} — {addPain*10} pts
              </span>
            </div>
            <div className="mt-3 grid grid-cols-10 gap-1 sm:gap-1.5">
              {[1,2,3,4,5,6,7,8,9,10].map(n=>{
                const active = n<=addPain;
                const frac = n/10;
                const fill = active
                  ? (frac<0.4 ? "#D8CFC3" : frac<0.7 ? "#D7B09A" : "#D07A5F")
                  : "transparent";
                return (
                  <button
                    key={n}
                    onClick={()=> setAddPain(n)}
                    aria-label={`Pain ${n}`}
                    className="grid aspect-square w-full max-w-[36px] place-items-center rounded-full border transition-all active:scale-[0.92] justify-self-center"
                    style={{
                      borderColor: active ? "#E0CEB8" : "#E8DDCF",
                      background: active ? fill : "#FFFEFB",
                      boxShadow: active ? "0 1px 0 rgba(0,0,0,0.04)" : "none",
                    }}
                  >
                    <span className="h-[9px] w-[9px] rounded-full" style={{ background: active ? (n===addPain ? "#121214" : fill) : "#E8DDCF" }} />
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-[10.5px]">
              <span className="text-[var(--muted)]/70 font-[450]">1 • Tiny 10</span>
              <span className="font-['Fraunces'] text-[11px] text-[var(--text-secondary)]">{addPain} × 10 = <b>{addPain*10}</b> base {addBonus? <i className="not-italic text-[#D07A5F]">+15%</i>:null}</span>
              <span className="text-[var(--muted)]/70 font-[450]">10 • 100</span>
            </div>
            <div className="mt-2">
              <button
                onClick={()=> setAddBonus(v=>!v)}
                className={"text-[11px] font-[450] tracking-[0.01em] "+(addBonus?"text-[#9A6754]":"text-[var(--muted)]")}
              >
                <span className="underline decoration-dotted underline-offset-4">{addBonus? "✓ 15% awful-job bonus on":"add 15% for awful?"}</span>{addBonus? <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full border bg-[#FFF1E6] border-[#E8CBB6]">bonus</span>:null}
              </button>
            </div>
          </div>

          {/* Frequency — pill rail */}
          <div className="space-y-2.5">
            <span className="text-[10.5px] font-[650] tracking-[0.12em] uppercase text-[#8A7D6E]">How often?</span>
            <div className="grid w-full grid-cols-4 rounded-[14px] p-[3px] gap-[2px]" style={{background:"var(--chip-bg)", border:"1px solid var(--border)"}}>
              {(["one-off","daily","weekly","monthly"] as const).map(f=> {
                const active = (f==="one-off" && addType==="one-off") || addFreq===f;
                return (
                  <button
                    key={f}
                    onClick={()=>{ setAddType(f==="one-off"?"one-off":"repeat"); setAddFreq(f==="one-off"?"once":f as any); }}
                    className={"h-[40px] rounded-[10px] text-[12px] font-[600] capitalize tracking-[0.01em] transition-all "+(active?"bg-white shadow-[0_1px_6px_rgba(0,0,0,0.08)] text-[var(--text)]":"text-[var(--muted)] hover:text-[var(--text-secondary)]")}
                    style={{minHeight:40}}
                  >
                    {f==="one-off"?"Once":f}
                  </button>
                );
              })}
            </div>
            {addType!=="one-off" && (
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                {["M","T","W","T","F","S","S"].map((d,i)=> {
                  const long=["Mo","Tu","We","Th","Fr","Sa","Su"][i];
                  const active=addWeekdays[i];
                  return (
                    <button
                      key={long}
                      onClick={()=> { const a=[...addWeekdays]; a[i]=!a[i]; setAddWeekdays(a); }}
                      className={"grid h-[36px] w-[36px] place-items-center rounded-full border text-[11px] font-[600] transition-all active:scale-[0.96] "+(active?"bg-[#121214] text-white border-[#121214]":"bg-[#FFFEFB] text-[#7A6E61]")}
                      style={{borderColor: active ? "#121214" : "#E1D8CC", minHeight:36, minWidth:36}}
                      aria-pressed={active}
                    >
                      {d}
                    </button>
                  );
                })}
                <span className="ml-1 text-[10px] text-[var(--muted)]/70">{addWeekdays.filter(Boolean).length ? `${addWeekdays.filter(Boolean).length} days` : "pick days"}</span>
              </div>
            )}
          </div>

          {/* Icons — refined */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-[650] tracking-[0.12em] uppercase text-[#8A7D6E]">Mark</span>
              <span className="text-[10px] font-[450] text-[var(--muted)]/60 tabular-nums">{addPain*10} pts • {addIcon}</span>
            </div>
            <div className="rounded-[14px] border bg-[var(--card-bg)] p-2" style={{borderColor:"var(--border)"}}>
              <div className="grid grid-cols-5 gap-2 max-h-[148px] overflow-y-auto no-scrollbar p-1">
                {(ALL_CHORE_ICON_IDS as any).map((id:string)=> {
                  const active = addIcon===id;
                  return (
                    <button
                      key={id}
                      onClick={()=> setAddIcon(id as any)}
                      className={"relative grid h-[44px] w-[44px] place-items-center rounded-[12px] border text-[12px] transition-all active:scale-[0.96] "+(active?"bg-white shadow-[0_2px_10px_rgba(0,0,0,0.06)] border-[#121214]":"bg-[#FFFEFB] border-[#EADFCE] hover:border-[#D9CBB6]")}
                      style={{minHeight:44, minWidth:44}}
                    >
                      <ChoreIcon id={id as any} size={18} />
                      {active && <span className="pointer-events-none absolute -bottom-[4px] left-1/2 h-[2px] w-[18px] -translate-x-1/2 rounded-full bg-[#D07A5F]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Primary CTA */}
          <button
            onClick={()=>{
              const el=document.getElementById("chore-title") as HTMLInputElement;
              if(!el?.value.trim()) return;
              const nowISO=new Date().toISOString();
              const pain=Math.min(10, Math.max(1, addPain||5));
              const base=pain*10;
              const mult = addBonus?1.15:1;
              const fd = addType==="one-off" ? undefined : (addWeekdays.some(Boolean) ? ["Mo","Tu","We","Th","Fr","Sa","Su"].filter((_,i)=>addWeekdays[i]).join(",") : addFreq);
              const nc:any={ id: uid("chk"), title:el.value.trim(), type:addType, frequency:addFreq, frequencyDetail: fd, createdAt:nowISO, updatedAt:nowISO, pain, basePoints:base, swipes:{aisling:null,ciaran:null}, status:"deck", assignedTo:null, multiplier:mult, timeWindowHours:24, icon: addIcon };
              setChores((p:any)=> [nc, ...p]); setShowAdd(false);
              setAddPain(5); setAddBonus(false);
              triggerPointsPop(nc.id, base);
              setToast(`${nc.title} • ${base}pts ${addBonus?"1.15×":""} → deck`);
              setTimeout(()=>setToast(null),2500);
            }}
            className="w-full h-[56px] rounded-[16px] bg-[#121214] text-[#FFFEFB] text-[15px] font-[650] tracking-[-0.01em] active:scale-[0.98] shadow-[0_8px_22px_rgba(18,18,20,0.18)] flex items-center justify-center gap-2"
            style={{minHeight:56, fontFamily:"Fraunces, ui-serif, Georgia, serif"}}
          >
            <span className="h-[6px] w-[6px] rounded-full bg-[#A8D5BA]" /> Add to deck — {addPain*10} pts
          </button>
          <div className="text-[10px] text-[var(--muted)]/60 text-center font-['Fraunces'] italic">Resets {HOUSEHOLD_TZ} • pain is points, not priority</div>
        </div>
      </BottomSheet>

      {toast && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 -translate-x-1/2 z-[88] rounded-full bg-[#0A0A0A] text-white px-5 py-2.5 text-[12px] font-medium shadow-[0_8px_24px_rgba(0,0,0,0.28)] animate-[popUp_300ms_ease]">{toast}</div>
      )}
    </div>
  );
}

// Backward compat alias — App.tsx may import ChoresPage from features
// Keep default as main, named export below for alternative import paths
export const ChoresPage = (props:any)=> ChoresScreen(props as any);
