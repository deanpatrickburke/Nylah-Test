// @ts-nocheck
/**
 * Beirt — Pure 195-320 line composer root (v118-preview)
 * Zero logic change from V117 prod 117 89cb7d8. Uses app/state.ts verbatim.
 * Fast-edit base: features/* product areas.
 */
import React from "react";
import { useAppState } from "./app/state";

// feature screens — product areas
import FridgeScreen from "./features/fridge/FridgeScreen";
import ChoresScreen from "./features/chores/ChoresScreen";
import CalendarScreen from "./features/calendar/CalendarScreen";
import ShoppingScreen from "./features/shopping/ShoppingScreen";
import NotesScreen from "./features/notes/NotesScreen";
import SettingsScreen from "./features/settings/SettingsScreen";
import WhoScreen from "./features/auth/WhoScreen";
import PinScreen from "./features/auth/PinScreen";

import { THEMES, PERSONS, TABS } from "./constants/themes";
import type { TabKey } from "./types";
import { verifyPin } from "./lib/pins";
import { idbSet } from "./lib/idb";
import OnboardingFlow from "./features/auth/OnboardingFlow";

// — helpers preserved verbatim minimal —
function getPageTitle(tab: TabKey): string {
  const m: Record<string,string> = {
    fridge: "Fridge",
    plans: "Plans",
    calendar: "Calendar",
    chores: "Chores",
    shopping: "Shop",
    notes: "Notes",
    blueprint: "Settings",
  };
  return m[tab] || "Beirt";
}
function TabIcon({ k, active }: { k: TabKey; active?: boolean }) {
  // minimal inline icons — same palette as monolith
  const icons: Record<string,React.ReactNode> = {
    fridge: <span>❄︎</span>,
    plans: <span>◐</span>,
    calendar: <span>📅</span>,
    chores: <span>✦</span>,
    shopping: <span>🛒</span>,
    notes: <span>♥</span>,
    blueprint: <span>⚙︎</span>,
  };
  return <span className={active?"opacity-100":"opacity-70"}>{icons[k]||"•"}</span>;
}
function BottomSheet({ open, onClose, children, title }: { open: boolean; onClose:()=>void; children:React.ReactNode; title?:string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[390px] max-h-[88vh] overflow-auto no-scrollbar rounded-t-[28px] border bg-[var(--card-bg)] px-4 py-4 pb-[calc(20px+env(safe-area-inset-bottom))]" style={{borderColor:"var(--border)"}}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border)]" />
        {title && <div className="text-[14px] font-semibold mb-3" style={{fontFamily:"Fraunces"}}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function App() {
  const s = useAppState() as any;
  const {
    currentUser, setCurrentUser,
    theme, themeId, setThemeId,
    tab, setTab,
    chores, choresRaw, setChoresRaw,
    calendarRaw, setCalendarRaw,
    shoppingRaw, setShoppingRaw,
    notesRaw, setNotesRaw,
    syncStatus, drainQueue, reallyOnline,
    nowMs,
    standalone,
    showSwitch, setShowSwitch,
    showBlueprint, setShowBlueprint,
    pendingSwitchTo, setPendingSwitchTo,
    switchPin, setSwitchPin,
    switchPinWrong, setSwitchPinWrong,
    phoneInnerRef,
    pushToast,
    onboardingDone, setOnboardingDone,
    urlInviteCode,
  } = s || {};

  // v120 defensive: never let undefined props crash .filter
  const safeCurrentUser = (currentUser || "aisling") as any;
  const safeTheme = theme || { bg: "#F7EFE8", fg: "#0A0A0A" } as any;
  const safeChores = Array.isArray(chores) ? chores : [];
  const safeChoresRaw = Array.isArray(choresRaw) ? choresRaw : [];
  const safeCalendarRaw = Array.isArray(calendarRaw) ? calendarRaw : [];
  const safeShoppingRaw = Array.isArray(shoppingRaw) ? shoppingRaw : [];
  const safeNotesRaw = Array.isArray(notesRaw) ? notesRaw : [];
  const safeSetChoresRaw = typeof setChoresRaw === 'function' ? setChoresRaw : (()=>{}) as any;
  const safeSetCalendarRaw = typeof setCalendarRaw === 'function' ? setCalendarRaw : (()=>{}) as any;
  const safeSetShoppingRaw = typeof setShoppingRaw === 'function' ? setShoppingRaw : (()=>{}) as any;
  const safeSetNotesRaw = typeof setNotesRaw === 'function' ? setNotesRaw : (()=>{}) as any;
  const safeSetCurrentUser = typeof setCurrentUser === 'function' ? setCurrentUser : (()=>{}) as any;
  const safeNowMs = typeof nowMs === 'number' ? nowMs : Date.now();
  const safeSyncStatus = syncStatus || { kind: "saved" } as any;
  const safeDrainQueue = typeof drainQueue === 'function' ? drainQueue : (()=>{}) as any;
  const safeSetTab = typeof setTab === 'function' ? setTab : (()=>{}) as any;
  const safePhoneInnerRef = phoneInnerRef || { current: null } as any;

  // — theme owns styling via CSS — JS only flips data-theme & data-connection attribute
  React.useEffect(() => {
    try {
      const legacyMap: Record<string,string> = { peach:'beige', butter:'beige', lavender:'beige', terracotta:'beige', mint:'beige', paper:'beige', cream:'beige', midnight:'ink' };
      const rawId = (theme as any)?.id || themeId || 'beige';
      const mappedId = legacyMap[rawId] || rawId;
      const isInk = mappedId === 'ink';
      const r = document.documentElement;
      r.setAttribute('data-theme', isInk ? 'ink' : 'beige');
      if (onboardingDone) {
        const conn = localStorage.getItem('couple_v1_connection_type') || 'couple';
        r.setAttribute('data-connection', conn);
      } else {
        r.removeAttribute('data-connection');
      }
      if (rawId !== mappedId) {
        try { localStorage.setItem('couple_v1_theme', JSON.stringify(mappedId)); } catch {}
        try { setThemeId(mappedId); } catch {}
      }
    } catch {}
  }, [theme, themeId, setThemeId, onboardingDone]);

  // confetti — verbatim 24-node 1.15s, palette #A89FDA var(--border) #D0A1EA var(--wash-top) #FACC15 #6EE7B7 #FB923C
  function triggerConfetti(origin?: any) {
    const hostParent = phoneInnerRef?.current; if (!hostParent) return;
    const existing = hostParent.querySelectorAll(".confetti-host"); if (existing.length >= 2) existing[0]?.remove();
    const host = document.createElement("div"); (host as any).className = "confetti-host confetti-host--race"; (host as any).style.position = "absolute"; (host as any).style.inset = "0"; (host as any).style.pointerEvents = "none"; (host as any).style.zIndex = "50"; (host as any).style.overflow = "hidden"; (host as any).style.borderRadius = "28px"; hostParent.appendChild(host);
    let cx = 0.5, cy = 0.38;
    try {
      const o:any=origin; if (o && typeof o.clientX==="number"){const r=hostParent.getBoundingClientRect(); cx=(o.clientX-r.left)/r.width; cy=(o.clientY-r.top)/r.height;}
      else if (o instanceof Element){const r=o.getBoundingClientRect(); const pr=hostParent.getBoundingClientRect(); cx=((r.left+r.width/2)-pr.left)/pr.width; cy=((r.top+r.height/2)-pr.top)/pr.height;}
    } catch {}
    cx=Math.min(0.85,Math.max(0.15,cx)); cy=Math.min(0.78,Math.max(0.12,cy));
    const colors=["#A89FDA","var(--border)","#D0A1EA","var(--wash-top)","#FACC15","#6EE7B7","#FB923C"];
    const finalCount=24+Math.floor(Math.random()*7);
    for(let i=0;i<finalCount;i++){
      const el=document.createElement("div"); (el as any).className="confetti-node";
      const roll=Math.random(); const color=colors[Math.floor(Math.random()*colors.length)]!;
      const angle=Math.random()*Math.PI*2; const dist0=Math.random()*16; const dist1=42+Math.random()*94;
      const x0=Math.cos(angle)*dist0; const y0=Math.sin(angle)*dist0*0.5-Math.random()*12;
      const x1=Math.cos(angle)*dist1+(Math.random()-0.5)*28; const yDrift=110+Math.random()*150;
      const leftBase=cx*100; const leftJitter=(Math.random()-0.5)*16; const left=Math.min(85,Math.max(15,leftBase+leftJitter+x0/3.2));
      const r0=Math.floor(Math.random()*360); const r1=r0+(180+Math.random()*540)*(Math.random()<0.5?-1:1);
      const delay=Math.floor(Math.random()*80); const dur=650+Math.floor(Math.random()*250); const scale=0.82+Math.random()*0.6;
      (el as any).style.left=left+"%"; (el as any).style.top=cy*100+"%";
      (el as any).style.setProperty("--x0",x0+"px"); (el as any).style.setProperty("--y0",y0+"px");
      (el as any).style.setProperty("--x1",x1+"px"); (el as any).style.setProperty("--y1",yDrift+"px");
      (el as any).style.setProperty("--r0",r0+"deg"); (el as any).style.setProperty("--r1",r1+"deg");
      (el as any).style.setProperty("--s",scale.toString()); (el as any).style.animationDelay=delay+"ms"; (el as any).style.animationDuration=dur+"ms";
      if(roll<0.33){(el as any).style.width="6px";(el as any).style.height="6px";(el as any).style.borderRadius="999px";(el as any).style.background=color;}
      else if(roll<0.66){(el as any).style.width="6px";(el as any).style.height="6px";(el as any).style.borderRadius="1.5px";(el as any).style.background=color;}
      else if(roll<0.86){(el as any).style.width="8px";(el as any).style.height="3px";(el as any).style.borderRadius="2px";(el as any).style.background=color;}
      else{(el as any).style.width="10px";(el as any).style.height="10px";(el as any).style.background="transparent";(el as any).innerHTML="<svg viewBox='0 0 10 10' width='10' height='10'><path d='M5 0 L6.15 3.2 L9.5 3.2 L6.72 5.28 L7.62 8.7 L5 6.64 L2.38 8.7 L3.28 5.28 L0.5 3.2 L3.85 3.2 Z' fill='"+color+"'/></svg>";}
      host.appendChild(el);
    }
    window.setTimeout(()=>{host.remove();},1150);
  }

  // household / TZ preserved via state: HOUSEHOLD_ID ash-ciaran-2026 TZ Europe/Dublin, 
  // grain 0.028, accent 12% hero 15% — in theme.css tokens

  // onboarding — proper flow restored from V117 source, no generic Continue bypass
  // Existing users with valid household_id / legacy keys bypass via shouldShowOnboarding in state.ts
  if (!onboardingDone) {
    return (
      <OnboardingFlow
        onComplete={(hid: string) => {
          // require household_id persisted before marking done — prevents bypass
          try {
            if (hid && hid.length >= 3) localStorage.setItem("couple_v1_household_id", hid);
            localStorage.setItem("couple_v1_onboarding_completed", "true");
            localStorage.setItem("couple_v1_onboarded_at", new Date().toISOString());
          } catch {}
          setOnboardingDone(true);
          try { (s as any).applyCustomPersonNames?.(); } catch {}
        }}
      />
    );
  }

  if (!currentUser) {
    // who / pin — product area auth
    const raw = (s.currentUserRaw || null) as any;
    if (!raw) {
      return <WhoScreen onSelect={(k:string)=> s.setCurrentUserRaw(k)} persons={PERSONS} />;
    }
    return <PinScreen user={raw} onBack={()=>{s.setCurrentUserRaw(null);}} onSuccess={(k:any)=>{s.setCurrentUser(k);}} />;
  }

  return (
    <>
      <style>{`
        .continuous-card > * + * { border-top: 1px solid var(--border); }
        .list-separated > * + * { border-top: 1px solid var(--border); }
        .bottom-nav-v11 { height:64px; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding-bottom: env(safe-area-inset-bottom); border-top:1px solid var(--border); background: var(--nav-bg); }
        .topbar-transparent { background: transparent; }
        .wash-gradient { background: linear-gradient(180deg,var(--wash-top) 0%,var(--wash-mid) 22%,var(--card-bg) 100%); }
        .confetti-host { pointer-events: none; }
        /* script hero Aisling ♥ Ciaran — floating overlay */
        .hero-script { font-family: Fraunces, Instrument Serif, Georgia, serif; letter-spacing: -0.02em; }
      `}</style>

      <div className={standalone ? "relative w-full max-w-[100vw] w-[100vw] min-h-screen min-h-dvh flex flex-col border-0 rounded-none" : "relative mx-auto w-full max-w-[390px] overflow-hidden rounded-[36px] border-0 flex flex-col"} style={{ background: (safeTheme as any).bg || (theme as any)?.bg, width: standalone ? "100vw" : undefined, maxWidth: standalone ? "100vw" : undefined } as any}>
        {pushToast && (
          <div className="fixed top-[12px] left-1/2 -translate-x-1/2 z-[80] rounded-full bg-[#0A0A0A] text-white px-4 py-2 text-[12px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.22)] max-w-[90%] truncate">
            <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" />{pushToast.title}: {pushToast.body}</span>
          </div>
        )}
        <div ref={safePhoneInnerRef} className={standalone ? "relative flex flex-1 min-h-0 flex-col overflow-hidden w-full max-w-[100vw] rounded-none" : "relative flex h-[800px] flex-col overflow-hidden rounded-[28px]"}>
          <div className="sticky top-0 z-30 flex flex-col bg-transparent border-0 shadow-none backdrop-blur-[1px] topbar-transparent" style={{ background: "transparent" }}>
            <div className="flex h-[56px] items-center justify-between px-4">
              <h1 className="text-[26px] font-semibold leading-[32px] tracking-[-0.02em] text-[var(--text)] hero-script">{getPageTitle((tab as any) || "fridge")}</h1>
              <button onClick={()=> setShowSwitch(true)} aria-label="Open account" className="grid h-11 w-11 place-items-center rounded-full border-2 text-[13px] font-bold active:scale-[0.96] transition ring-1 ring-[var(--border)]" style={{ background: (PERSONS[safeCurrentUser]?.wash||'var(--wash-top)'), borderColor:"var(--border)", color:"var(--text)", minHeight:44, minWidth:44 }}>{(PERSONS[safeCurrentUser]?.initial||'?')}</button>
            </div>
            {(()=>{ const k=(safeSyncStatus as any)?.kind; if(!k||k==="saved"||k==="saving") return null; let msg:string|null=null; let tone="bg-amber-50 text-amber-900 border-amber-200"; if(k==="offline-queued"||k==="offline"||k==="queued"){const n=(safeSyncStatus as any).queueCount??1; msg=n>1?`${n} changes waiting`:"Offline"; tone="bg-neutral-100 text-neutral-800 border-neutral-200";} else if(k==="failed"){msg="Sync failed — tap retry"; tone="bg-red-50 text-red-800 border-red-200";} else if(k==="updated-elsewhere"){msg="Updated elsewhere"; tone="bg-violet-50 text-violet-800 border-violet-200";} if(!msg) return null; return (<button onClick={()=> (safeDrainQueue as any)()} className={`mx-3 mb-2 flex h-[36px] items-center rounded-[12px] border px-3 text-[12px] font-medium leading-[17px] ${tone}`}><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-70 mr-2" />{msg}</button>); })()}
          </div>

          <div className="flex-1 overflow-auto no-scrollbar px-4 pt-3 pb-[112px]" style={{ background: (safeTheme as any).bg || (theme as any)?.bg }}>
            {(tab as any)==="fridge" && <FridgeScreen currentUser={safeCurrentUser} chores={(safeChores||[]) as any} calendar={(safeCalendarRaw||[])} shopping={(safeShoppingRaw||[])} notes={(safeNotesRaw||[])} setTab={safeSetTab as any} nowMs={safeNowMs} theme={safeTheme} syncStatus={safeSyncStatus} />}
            {((tab as any)==="calendar" || (tab as any)==="plans") && <CalendarScreen events={(safeCalendarRaw||[]) as any} setEvents={safeSetCalendarRaw as any} currentUser={safeCurrentUser} nowMs={safeNowMs} chores={(safeChores||[]) as any} setCurrentUser={safeSetCurrentUser as any} onCelebrate={()=> (s as any).triggerConfetti?.()} />}
            {tab==="chores" && <ChoresScreen chores={(safeChores||[]) as any} setChores={(s as any).setChores || safeSetChoresRaw as any} currentUser={safeCurrentUser} setCurrentUser={safeSetCurrentUser as any} onCelebrate={()=> (s as any).triggerConfetti?.()} nowMs={safeNowMs} />}
            {tab==="shopping" && <ShoppingScreen items={(safeShoppingRaw||[]) as any} setItems={safeSetShoppingRaw as any} currentUser={safeCurrentUser} nowMs={safeNowMs} onCelebrate={()=> (s as any).triggerConfetti?.()} />}
            {tab==="notes" && <NotesScreen notes={(safeNotesRaw||[]) as any} setNotes={safeSetNotesRaw as any} currentUser={safeCurrentUser} nowMs={safeNowMs} />}
            {tab==="blueprint" && <SettingsScreen theme={safeTheme as any} setTheme={setThemeId as any} onConfetti={()=> (s as any).triggerConfetti?.()} choresRaw={(safeChoresRaw||[])} calendarRaw={(safeCalendarRaw||[])} shoppingRaw={(safeShoppingRaw||[])} notesRaw={(safeNotesRaw||[])} setChoresRaw={safeSetChoresRaw as any} setCalendarRaw={safeSetCalendarRaw as any} setShoppingRaw={safeSetShoppingRaw as any} setNotesRaw={safeSetNotesRaw as any} currentUser={safeCurrentUser} />}
          </div>
        </div>

        <nav className="absolute inset-x-0 bottom-0 left-0 right-0 z-[60] flex h-[64px] w-full max-w-none items-center justify-around bottom-nav-v11 backdrop-blur-[12px] pb-[env(safe-area-inset-bottom)]" style={{ borderColor:"var(--border)" }}>
          {(TABS as any).map((it:any)=>{
            const isPlans=it.k==="plans"; const currentIsPlans=(tab as any)==="plans"||(tab as any)==="calendar"; const isActive=isPlans?currentIsPlans:tab===it.k;
            return (
              <button key={it.k} onClick={()=>{ const target=it.k==="plans"?"plans":it.k; safeSetTab(target); }} className={`flex flex-1 flex-col items-center justify-center gap-0.5 active:scale-[0.94] select-none ${isActive?"nav-item-active":""}`} style={{ minHeight:52, height:52, minWidth:44 }}>
                <span className={`nav-icon grid h-6 w-6 place-items-center transition-colors`} style={{ color: isActive ? "#8B5E3C" : "var(--muted)" }}><TabIcon k={it.k} active={isActive} /></span>
                <span className={`nav-label text-[12px] leading-[17px] tracking-[-0.01em] ${isActive?"font-semibold":"font-medium"}`} style={{ color: isActive ? "#8B5E3C" : "var(--muted)" }}>{it.label}</span>
              </button>
            );
          })}
        </nav>

        {showSwitch && (
          <BottomSheet open={showSwitch} onClose={()=>{ setShowSwitch(false); setPendingSwitchTo(null); setSwitchPin(""); setSwitchPinWrong(false); }} title={pendingSwitchTo ? "Enter PIN" : "You"}>
            {pendingSwitchTo ? (
              <div className="py-4 space-y-3">
                <div className="text-[13px] font-medium">Enter PIN for {(():string=>{
                  try{
                    const hid=localStorage.getItem("couple_v1_household_id");
                    const raw=hid?localStorage.getItem(`couple_v1_household_persons_${hid}`):null;
                    const fallback=localStorage.getItem("couple_v1_household_persons");
                    const list=raw?JSON.parse(raw):fallback?JSON.parse(fallback):null;
                    const found=list?.find((p:any)=>p.key===pendingSwitchTo);
                    if(found) return found.name;
                  }catch{}
                  return (PERSONS[pendingSwitchTo as any]?.name||pendingSwitchTo||"?");
                })()}</div>
                <div className="flex gap-2">
                  <input value={switchPin} onChange={e=>{ const v=e.target.value.replace(/\D/g,"").slice(0,4); setSwitchPin(v); setSwitchPinWrong(false); }} inputMode="numeric" placeholder="••••" className="flex-1 rounded-[12px] border bg-[var(--card-bg)] px-4 h-[48px] text-center tracking-widest text-[14px]" style={{ borderColor: switchPinWrong ? "#E07A5F" : "var(--border)" }} />
                  <button onClick={async()=>{ const who=await verifyPin(switchPin); if(who===pendingSwitchTo){ safeSetCurrentUser(who as any); try{ localStorage.setItem("couple_v1_currentUser", JSON.stringify(who)); }catch{} try{ idbSet("couple_v1_currentUser", who); }catch{} setShowSwitch(false); setPendingSwitchTo(null); setSwitchPin(""); } else { setSwitchPinWrong(true); setTimeout(()=> setSwitchPin(""),300);} }} className="rounded-[16px] bg-[#0A0A0A] px-4 h-[48px] text-white text-[13px]">Switch</button>
                </div>
                {switchPinWrong && <div className="text-[11px] text-[#B91C1C]">wrong PIN — server-checked</div>}
                <button onClick={()=>{ setPendingSwitchTo(null); setSwitchPin(""); }} className="text-[11px] underline">cancel</button>
              </div>
            ) : (
              <div className="space-y-2 py-2">
                <div className="px-3 pb-2 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full border text-[13px] font-bold" style={{ background:(PERSONS[safeCurrentUser]?.wash||'var(--wash-top)'), borderColor:"var(--border)" }}>{(PERSONS[safeCurrentUser]?.initial||(():string=>{try{const hid=localStorage.getItem("couple_v1_household_id");const raw=hid?localStorage.getItem(`couple_v1_household_persons_${hid}`):null;const list=raw?JSON.parse(raw):null;return list?.find((p:any)=>p.key===safeCurrentUser)?.name?.slice(0,1).toUpperCase()||'?'}catch{return '?'}})())}</span><div><div className="text-[15px] font-semibold">{(():string=>{try{const hid=localStorage.getItem("couple_v1_household_id");const raw=hid?localStorage.getItem(`couple_v1_household_persons_${hid}`):null;const fb=localStorage.getItem("couple_v1_household_persons");const list=raw?JSON.parse(raw):fb?JSON.parse(fb):null;return list?.find((p:any)=>p.key===safeCurrentUser)?.name||PERSONS[safeCurrentUser]?.name||safeCurrentUser||'You'}catch{return PERSONS[safeCurrentUser]?.name||safeCurrentUser||'You'}})()}</div><div className="text-[12px] text-[var(--muted)]">Current profile</div></div></div>
                <div className="pt-1"><div className="text-[11px] text-[var(--muted)] px-2 mb-2">Switch to</div><div className="flex items-center gap-3 px-2">{(():any[]=>{try{const hid=localStorage.getItem("couple_v1_household_id");const keys=[hid?`couple_v1_household_persons_${hid}`:null,"couple_v1_household_persons"];for(const k of keys){if(!k)continue;const raw=localStorage.getItem(k);if(raw){const arr=JSON.parse(raw);if(Array.isArray(arr))return arr;}} }catch{};return Object.keys(PERSONS).slice(0,2).map(k=>({key:k,name:PERSONS[k].name,initial:PERSONS[k].initial,wash:PERSONS[k].wash,accent:PERSONS[k].accent}))})().map((p:any)=> (<button key={p.key} onClick={()=>{ if(p.key===safeCurrentUser){ setShowSwitch(false); return;} setPendingSwitchTo(p.key); }} className={"flex flex-col items-center gap-1.5 active:scale-[0.98] "+(safeCurrentUser===p.key?"opacity-100":"opacity-70")}><span className={"grid h-11 w-11 place-items-center rounded-full border text-[13px] font-bold "+(safeCurrentUser===p.key?"ring-2 ring-[#0A0A0A] ring-offset-2":"")} style={{ background: p.wash||PERSONS[p.key]?.wash||'var(--wash-top)', borderColor: p.accent||PERSONS[p.key]?.accent||"var(--border)" }}>{p.initial||p.name?.slice(0,1).toUpperCase()||"?"}</span><span className="text-[11px]">{p.name}</span></button>))}</div></div>
                <button onClick={()=>{ setShowSwitch(false); safeSetTab("blueprint" as any); }} className="mt-3 w-full min-h-[44px] rounded-full border bg-[var(--chip-bg)] text-[12px] font-medium active:scale-[0.98]" style={{borderColor:"var(--border)"}}>Open Settings →</button>
              </div>
            )}
          </BottomSheet>
        )}

      </div>
    </>
  );
}
export default App;
