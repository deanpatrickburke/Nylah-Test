// ChoreAdmin.tsx — Admin template editor, recurrence weekday picker + This/Future split, icons ALL_CHORE_ICON_IDS, CHORE_ICON_BY_TEMPLATE
import { useState, useRef } from "react";
import type { ChoreV2 } from "./choreTypes";
import { ChoreIcon, ALL_CHORE_ICON_IDS, CATEGORY_MAP, ICON_CATEGORIES } from "../../lib/choreIcons";
import type { ChoreIconId, IconCategory } from "../../lib/choreIcons";
import { uid } from "../../shared/utils/helpers";
import { toLocalKeyDublin, HOUSEHOLD_TZ } from "./choreScoring";

type Props = {
  active: ChoreV2[];
  chores: ChoreV2[];
  setChores: any;
  currentUser: any;
  monthKey: string;
  templates: {k:string,title:string,pain:number,freq:string,icon:ChoreIconId}[];
  toast: string|null;
  setToast: (s:string|null)=>void;
};

export function ChoreAdmin({ active, chores, setChores, currentUser, monthKey, templates, setToast }: Props) {
  const [editing, setEditing] = useState<ChoreV2|null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFreq, setEditFreq] = useState<ChoreV2["frequency"]>("once");
  const [editWeekdays, setEditWeekdays] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [editPain, setEditPain] = useState(5);
  const [editBonus, setEditBonus] = useState(false);
  const [editType, setEditType] = useState<"one-off"|"repeat">("one-off");
  const [editIcon, setEditIcon] = useState<ChoreIconId>('broom');
  const [iconCat, setIconCat] = useState<IconCategory>('Kitchen');
  const [holdProgress, setHoldProgress] = useState(0);
  const [futureEdit, setFutureEdit] = useState<"this"|"future">("this");
  const holdRef = useRef<any>(null);

  function effortHuman(pain:number): string {
    if(pain<=2) return "Tiny effort";
    if(pain<=4) return "Light effort";
    if(pain<=6) return "Medium effort";
    if(pain<=8) return "High effort";
    return "Tough";
  }

  function openEdit(c:ChoreV2){
    setEditing(c);
    setEditTitle(c.title);
    setEditFreq(c.frequency as any || "once");
    setEditType((c.type as any)|| (c.frequency==="once"?"one-off":"repeat"));
    try{
      const boolArr = (c.frequencyDetail||"").split(",").map((x:any)=> x.trim()).filter(Boolean);
      const map:any={Mo:0,Tu:1,We:2,Th:3,Fr:4,Sa:5,Su:6};
      const arr=[false,false,false,false,false,false,false];
      boolArr.forEach((k:string)=>{ if(map[k]!==undefined) arr[map[k]]=true; });
      setEditWeekdays(arr);
    }catch{ setEditWeekdays([false,false,false,false,false,false,false]); }
    setEditPain(c.pain||5);
    setEditBonus(c.multiplier>1.05);
    setEditIcon(((c as any).icon as ChoreIconId) || 'broom');
    setFutureEdit("this");
  }

  function saveEdit(){
    if(!editing) return;
    const freqDetail = editWeekdays.some(Boolean) ? (()=>{
      const names=["Mo","Tu","We","Th","Fr","Sa","Su"];
      return names.filter((_,i)=> editWeekdays[i]).join(",");
    })() : undefined;
    const nowISO=new Date().toISOString();
    const updated:any = {
      ...editing,
      title: editTitle.trim() || editing.title,
      type: editType,
      frequency: editFreq,
      frequencyDetail: freqDetail,
      pain: editPain,
      basePoints: editPain*10,
      multiplier: editBonus ? 1.15 : 1,
      icon: editIcon,
      updatedAt: nowISO,
      // This/Future split hint preserved: if future, update templateId too (semantic, not 720h)
      ...(futureEdit==="future" ? { templateId: editing.templateId || editing.id, futureScope: true } : {}),
    };
    setChores((p:any)=> p.map((x:any)=> x.id===editing.id ? updated : x));
    setEditing(null);
    if(navigator.vibrate){ try{navigator.vibrate(10)}catch{} }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border bg-[var(--card-bg)] p-4 space-y-3" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 36%,var(--card-bg) 100%)", boxShadow:"0 16px 40px rgba(0,0,0,0.12)"}}>
        <div className="font-display text-[17px] font-semibold flex items-center justify-between" style={{fontFamily:"Fraunces"}}>Admin <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2.5 py-1"> {active.length}</span></div>
        <div className="text-[11px] text-[var(--muted)]">Templates one-tap • pain 1-10 • type chips 44px • Mo-Su 44px • points live • delete hold 800ms • This/Future split preserved</div>
        <div className="grid grid-cols-3 gap-2">
          {templates.map(t=>(
            <button key={t.k} onClick={()=>{
              const nowISO=new Date().toISOString();
              const nc:any={ id: uid("chk"), title:t.title, type:"one-off", frequency: t.freq as any, createdAt:nowISO, updatedAt:nowISO, pain:6, basePoints:60, swipes:{aisling:null,ciaran:null}, status:"deck", assignedTo:null, multiplier:1, timeWindowHours:24, templateId:t.k, icon:(t as any).icon||"broom" };
              setChores((p:any)=> [nc, ...p]);
              setToast(`${t.title} added`);
              setTimeout(()=>setToast(null),2500);
            }} className="h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[11px] font-semibold active:scale-[0.96] shadow-sm flex items-center justify-center gap-1" style={{borderColor:"var(--border)", minHeight:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}><ChoreIcon id={t.icon} size={14} /> {t.k}</button>
          ))}
        </div>
        <div className="space-y-2 max-h-[280px] overflow-auto no-scrollbar">
          {active.slice(0,20).map((c:any)=> (
            <button key={c.id} onClick={()=> openEdit(c)} className="w-full text-left flex items-center justify-between gap-2 rounded-[16px] border bg-[var(--card-bg)] px-3 py-2.5 min-h-[44px] active:scale-[0.99]" style={{borderColor:"var(--border)"}}>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium flex items-center gap-1.5"><ChoreIcon id={(c.icon||'broom') as any} size={14} /> {c.title}</span>
              <span className="text-[11px] text-[var(--muted)] flex items-center gap-1">{c.frequency||"once"} • {c.pain}/10 {c.multiplier>1?"• 1.15×":""} <span className="h-5 w-5 grid place-items-center rounded-full bg-[#0A0A0A] text-white text-[10px]">{c.basePoints}</span></span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={()=> { const nowISO=new Date().toISOString(); const all=active.map((c:any)=> ({...c, swipes:{aisling:null, ciaran:null}, status:"deck", updatedAt:nowISO, updatedBy:currentUser})); setChores((p:any)=> { const m=new Map(all.map((a:any)=>[a.id,a])); return (p as any[]).map((x:any)=> m.has(x.id) ? m.get(x.id) : x); }); setToast("Reshuffled");  setTimeout(()=>setToast(null),2000); }} className="h-[44px] rounded-full border bg-[var(--card-bg)] text-[11px] font-semibold active:scale-[0.96]" style={{borderColor:"var(--border)", minHeight:44}}>Reshuffle all</button>
          <button onClick={()=> { const kept = chores.filter((c:any)=> c.status!=="done" || (c.completedAt && toLocalKeyDublin(c.completedAt, HOUSEHOLD_TZ).startsWith(monthKey))); setChores(kept); setToast(`Archived old • kept ${monthKey}`); setTimeout(()=>setToast(null),2000); }} className="h-[44px] rounded-full bg-[#0A0A0A] text-white text-[11px] font-semibold active:scale-[0.96]" style={{minHeight:44}}>Archive old • {monthKey}</button>
        </div>
      </div>

      {editing && (
        <div className="rounded-[28px] border bg-[var(--card-bg)] p-4 space-y-3" style={{borderColor:"var(--border)", boxShadow:"var(--shadow-soft)"}}>
          <div className="font-display text-[15px] font-semibold flex items-center justify-between" style={{fontFamily:"Fraunces"}}>Edit {editing.id.slice(0,6)} <button onClick={()=> setEditing(null)} className="h-8 w-8 grid place-items-center rounded-full border bg-[var(--card-bg)] text-[12px]" style={{borderColor:"var(--border)"}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
          <input value={editTitle} onChange={e=> setEditTitle(e.target.value)} className="w-full h-[48px] rounded-[16px] border bg-[var(--card-bg)] px-4 text-[14px]" style={{borderColor:"var(--border)"}} placeholder="Title" />
          {/* This/Future split preserved for recurring chores */}
          <div className="flex gap-1.5 p-1 rounded-full border bg-[var(--chip-bg)]/50" style={{borderColor:"var(--border)"}}>
            {(["this","future"] as const).map(v=>(
              <button key={v} onClick={()=> setFutureEdit(v)} className={"flex-1 h-[36px] rounded-full text-[11px] font-semibold capitalize "+(futureEdit===v?"bg-[#0A0A0A] text-white":"text-[var(--muted)]")} style={{minHeight:36}}>{v==="this"?"This only":"Future + template"}</button>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--muted)] flex items-center justify-between">Pick an icon — {ALL_CHORE_ICON_IDS.length} icons <span className="normal-case font-medium text-[10px] bg-white/60 px-2 py-0.5 rounded-full">{editIcon}</span></div>
            <div className="flex gap-1 overflow-auto no-scrollbar p-1 rounded-full border bg-[var(--chip-bg)]/60" style={{borderColor:"var(--border)"}}>
              {ICON_CATEGORIES.map(cat=> (
                <button key={cat} onClick={()=> setIconCat(cat)} className={"h-[32px] shrink-0 whitespace-nowrap rounded-full px-3 text-[11px] font-semibold "+(iconCat===cat?"bg-[#0A0A0A] text-white":"text-[var(--muted)]")} style={{minHeight:32}}>{cat}</button>
              ))}
            </div>
            <div className="grid grid-cols-6 gap-2 max-h-[192px] overflow-y-auto no-scrollbar snap-y pb-1 pt-1" style={{scrollbarWidth:"thin"}}>
              {(CATEGORY_MAP[iconCat] || CATEGORY_MAP.Kitchen).map(id=> (
                <button key={id} onClick={()=> setEditIcon(id)} className="grid h-[50px] w-[50px] place-items-center rounded-[14px] border text-[14px] active:scale-[0.94] transition-all relative" style={{minHeight:50, minWidth:50, transition:"transform 160ms cubic-bezier(0.34,1.56,0.64,1)", background: editIcon===id ? "#121214" : "var(--card-bg)", color: editIcon===id ? "white" : "var(--text)", borderColor: editIcon===id ? "#121214" : "var(--border)", boxShadow: editIcon===id ? "0 6px 14px rgba(0,0,0,0.18)" : "none"}}>
                  <ChoreIcon id={id} size={22} />
                  {editIcon===id && <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[#A8D5BA] text-[9px] text-[#0B1A12]">✓</span>}
                </button>
              ))}
            </div>
            <button onClick={()=> setIconCat(cat=> cat)} className="text-[10px] text-[var(--muted)] underline decoration-dotted">Showing {CATEGORY_MAP[iconCat]?.length || 0} in {iconCat} • switch tabs for more</button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(["one-off","daily","weekly","monthly"] as const).map(f=> (
              <button key={f} onClick={()=>{ setEditType(f==="one-off"?"one-off":"repeat"); setEditFreq(f==="one-off"?"once":f as any); if(navigator.vibrate) try{navigator.vibrate(10)}catch{} }} className={"h-[44px] rounded-[12px] border text-[11px] font-semibold capitalize "+( (f==="one-off" && editType==="one-off") || editFreq===f ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)] text-[var(--text-secondary)]")} style={{borderColor:"var(--border)", minHeight:44}}>{f}</button>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d,i)=> (
              <button key={d} onClick={()=> { const a=[...editWeekdays]; a[i]=!a[i]; setEditWeekdays(a); if(navigator.vibrate) try{navigator.vibrate(10)}catch{} }} className={"h-[44px] rounded-full border text-[11px] font-medium "+(editWeekdays[i]?"bg-[#0A0A0A] text-white border-[#0A0A0A]":"bg-[var(--card-bg)]")} style={{borderColor:"var(--border)", minHeight:44}}>{d}</button>
            ))}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]"><span>Pain {editPain}/10 base {editPain*10}</span><span className="text-[var(--muted)]">→ {(editPain*10*(editBonus?1.15:1)).toFixed(0)} pts {editBonus?"(1.15× bonus)":""}</span></div>
            <input type="range" min={1} max={10} value={editPain} onChange={e=> { setEditPain(Number(e.target.value)); if(navigator.vibrate) try{navigator.vibrate(10)}catch{} }} className="w-full accent-[#0A0A0A] h-[24px]" />
            <div className="text-[11px] text-[var(--muted)]">Preview: {editPain*10}pts → {(editPain*10*1.15).toFixed(0)}pts (2d overdue 1.15×) • {effortHuman(editPain)}</div>
          </div>
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={editBonus} onChange={e=> setEditBonus(e.target.checked)} /> Bonus 1.15× (under 10%)</label>
          <div className="flex gap-2">
            <button onClick={saveEdit} className="flex-1 h-[52px] rounded-full bg-[#0A0A0A] text-white text-[13px] font-semibold active:scale-[0.96]" style={{minHeight:52, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Save {futureEdit==="future"?"• Future (template)":"• This"}</button>
            <div className="relative">
              <button
                onMouseDown={()=>{ 
                  let start=Date.now(); 
                  setHoldProgress(0); 
                  if(holdRef.current) clearInterval(holdRef.current);
                  holdRef.current=setInterval(()=>{
                    const elapsed=Date.now()-start;
                    const pct=Math.min(100, (elapsed/800)*100);
                    setHoldProgress(pct);
                    if(pct>=100){ 
                      clearInterval(holdRef.current); 
                      const nowISO=new Date().toISOString(); 
                      setChores((pp:any)=> pp.map((x:any)=> x.id===editing.id ? {...x, deletedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)); 
                      setEditing(null); 
                      setHoldProgress(0);
                      if(navigator.vibrate) try{navigator.vibrate([10,30,10])}catch{}
                    }
                  }, 16);
                }}
                onMouseUp={()=>{ if(holdRef.current) clearInterval(holdRef.current); setHoldProgress(0); }}
                onMouseLeave={()=>{ if(holdRef.current) clearInterval(holdRef.current); setHoldProgress(0); }}
                onTouchStart={(e)=>{ 
                  e.preventDefault();
                  let start=Date.now(); 
                  setHoldProgress(0); 
                  if(holdRef.current) clearInterval(holdRef.current);
                  holdRef.current=setInterval(()=>{
                    const elapsed=Date.now()-start;
                    const pct=Math.min(100, (elapsed/800)*100);
                    setHoldProgress(pct);
                    if(pct>=100){ 
                      clearInterval(holdRef.current); 
                      const nowISO=new Date().toISOString(); 
                      setChores((pp:any)=> pp.map((x:any)=> x.id===editing.id ? {...x, deletedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)); 
                      setEditing(null); 
                      setHoldProgress(0);
                      if(navigator.vibrate) try{navigator.vibrate([10,30,10])}catch{}
                    }
                  }, 16);
                }}
                onTouchEnd={()=>{ if(holdRef.current) clearInterval(holdRef.current); setHoldProgress(0); }}
                className="h-[52px] w-[112px] rounded-full border bg-[var(--card-bg)] px-5 text-[11px] text-[#B91C1C] relative overflow-hidden flex items-center justify-center gap-2" style={{borderColor:"var(--border)", minHeight:52}}
              >
                <span className="relative z-10 flex items-center gap-1">{holdProgress>8 ? `${Math.round(holdProgress)}%` : "Hold to delete"}</span>
                <svg className="pointer-events-none absolute inset-0 w-full h-full" viewBox="0 0 52 52" aria-hidden="true">
                  <circle cx="26" cy="26" r="23" fill="none" stroke="#FEF2F2" strokeWidth="2" />
                  <circle cx="26" cy="26" r="23" fill="none" stroke="#B91C1C" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="144.5" strokeDashoffset={144.5 - (144.5*holdProgress/100)} style={{transition:"stroke-dashoffset 16ms linear", transform:"rotate(-90deg)", transformOrigin:"50% 50%"}} />
                </svg>
                <span className="absolute inset-0 rounded-full border-2 border-[#B91C1C] pointer-events-none opacity-30" style={{ clipPath:`inset(0 ${100-holdProgress}% 0 0)`}} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ChoreAdmin;
