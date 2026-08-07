import { useState } from "react";
import type { ShoppingItemV2, ShoppingCategory, ShoppingFrequency, PersonKey } from "../../types";
import { CATS } from "../../types";
import { uid } from "../../shared/utils/helpers";

type Props = {
  item?: ShoppingItemV2|null;
  onSave: (it:any)=>void;
  onCancel: ()=>void;
  currentUser: PersonKey;
};

export function ShoppingEditor({ item, onSave, onCancel, currentUser }: Props){
  const [text,setText]=useState(()=> item?.item || "");
  const [cat,setCat]=useState<ShoppingCategory>(()=> item?.cat || "Food");
  const [freq,setFreq]=useState<ShoppingFrequency>(()=> item?.frequency || "as-needed");
  const [qty,setQty]=useState(()=> item?.qty || 1);
  const [needDaysBool,setNeedDaysBool]=useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [notes,setNotes]=useState(()=> item?.notes || "");
  const [showAdv,setShowAdv]=useState(false);
  const isFreqDaily = freq==="daily"||freq==="weekly"||freq==="biweekly";
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-[var(--muted)]">CATS • {CATS.join(", ")} • Personal/Wants tags preserved</div>
      <input value={text} onChange={e=> setText(e.target.value)} placeholder="item — e.g. Oat milk" className="w-full rounded-full border bg-[var(--card-bg)] px-4 h-[44px] text-[13px]" style={{borderColor:"var(--border)"}} />
      <div className="flex gap-2">
        <select value={cat} onChange={e=> setCat(e.target.value as any)} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[40px] px-3 text-[12px]">{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <input type="number" min={1} value={qty} onChange={e=> setQty(Math.max(1, Number(e.target.value)||1))} className="w-[80px] rounded-full border bg-[var(--card-bg)] h-[40px] px-3 text-[12px]" />
      </div>
      <select value={freq} onChange={e=> setFreq(e.target.value as any)} className="w-full rounded-full border bg-[var(--card-bg)] h-[36px] px-3 text-[11px]">
        <option value="as-needed">As needed</option><option value="daily">Daily</option><option value="every-2d">Every 2d</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option>
      </select>
      {isFreqDaily && (
        <div className="flex gap-1 flex-wrap">{["Mo","Tu","We","Th","Fr","Sa","Su"].map((d,i)=><button key={d} onClick={()=> setNeedDaysBool(p=>{ const n=[...p]; n[i]=!n[i]; return n;})} className={"h-[32px] min-w-[32px] px-2 rounded-full border text-[11px] "+(needDaysBool[i]?"bg-[#0A0A0A] text-white border-[#0A0A0A]":"bg-[var(--chip-bg)]")} style={{borderColor:'var(--border)'}}>{d}</button>)}</div>
      )}
      <button onClick={()=> setShowAdv(v=>!v)} className="text-[11px] underline text-[var(--muted)]">{showAdv?"Hide":"Advanced"}: Personal/Wants • Trip Mode • recurring</button>
      {showAdv && <textarea value={notes} onChange={e=> setNotes(e.target.value)} placeholder="notes • personal tag @aisling/@ciaran • trip mode tag" className="w-full rounded-[12px] border bg-[var(--card-bg)] px-3 py-2 text-[11px] min-h-[60px]"/>}
      <div className="flex gap-2"><button onClick={()=>{ if(!text.trim()) return; const needDaysStr=needDaysBool.some(Boolean)? ["Mo","Tu","We","Th","Fr","Sa","Su"].filter((_,i)=>needDaysBool[i]).join(","):undefined; const it={ id:item?.id||uid("shop"), item:text.trim(), cat, qty, frequency:freq, needDays:needDaysStr, notes, addedBy: currentUser, createdAt: item?.createdAt||new Date().toISOString(), purchased:false, repeatCount: item?.repeatCount||0, templateKind: text.toLowerCase().includes("@personal")?"personal":text.toLowerCase().includes("wants")?"wants":undefined, tags:[] }; onSave(it); }} className="flex-1 h-[44px] rounded-full bg-[#0A0A0A] text-white text-[12px]">Save • {freq} {needDaysBool.some(Boolean)?"• "+needDaysBool.map((b,i)=> b?["Mo","Tu","We","Th","Fr","Sa","Su"][i]:"").filter(Boolean).join(","):""}</button><button onClick={onCancel} className="h-[44px] px-4 rounded-full border bg-[var(--card-bg)] text-[12px]" style={{borderColor:'var(--border)'}}>Cancel</button></div>
    </div>
  );
}
export default ShoppingEditor;
