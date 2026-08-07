import { useState } from "react";
import type { NoteMemo, PersonKey } from "../../types";
import { uid } from "../../shared/utils/helpers";
import { resizeToDataUrl, createThumbnail } from "../../lib/images";

type Props = { note?: NoteMemo|null; onSave:(n:any)=>void; onCancel:()=>void; currentUser: PersonKey; };

export function NoteEditor({ note, onSave, onCancel, currentUser }: Props){
  const [body,setBody]=useState(()=> note?.body||"");
  const [isLove,setIsLove]=useState(()=> !!note?.isLove);
  const [photo,setPhoto]=useState<string|undefined>(()=> note?.photoDataUrl);
  const [thumb,setThumb]=useState<string|undefined>(()=> note?.photoThumbDataUrl);
  const [resizing,setResizing]=useState(false);
  async function handleFile(file:File){
    try{
      setResizing(true);
      const reader=new FileReader();
      const base64:string=await new Promise((res,rej)=>{ reader.onload=()=>res(reader.result as string); reader.onerror=rej; reader.readAsDataURL(file); });
      const full=await resizeToDataUrl(base64,900,"image/jpeg",0.82);
      const th=await createThumbnail(full,180,"image/jpeg",0.8);
      setPhoto(full); setThumb(th);
    }finally{ setResizing(false); }
  }
  return (
    <div className="space-y-3">
      <textarea value={body} onChange={e=> setBody(e.target.value)} placeholder="a little note — pinned, archives, love notes, photo notes 900px, stickyboard" className="w-full min-h-[120px] rounded-[16px] border bg-[var(--card-bg)] px-3 py-2 text-[13px]" style={{borderColor:'var(--border)'}}/>
      <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={isLove} onChange={e=> setIsLove(e.target.checked)}/> Love note (heart)</label>
      <input type="file" accept="image/*" onChange={e=>{ const f=e.target.files?.[0]; if(f) handleFile(f); }} className="text-[11px]"/>
      {resizing && <div className="text-[11px] text-[var(--muted)]">resizing to 900px + 180 thumb…</div>}
      {photo && <img src={photo} alt="preview" className="rounded-[12px] max-h-[200px] object-cover border" style={{borderColor:'var(--border)'}}/>}
      <div className="flex gap-2"><button disabled={!body.trim()} onClick={()=>{ const now=new Date().toISOString(); const n={ id:note?.id||uid("note"), body:body.trim(), author:currentUser, createdAt:note?.createdAt||now, updatedAt:now, seenBy:{aisling:currentUser==="aisling", ciaran:currentUser==="ciaran"}, isLove, photoDataUrl:photo, photoThumbDataUrl:thumb, rotation:(Math.random()*6-3)}; onSave(n); }} className="flex-1 h-[44px] rounded-full bg-[#0A0A0A] text-white text-[12px] disabled:opacity-40">{note?"Save":"Add note"}</button><button onClick={onCancel} className="h-[44px] px-4 rounded-full border bg-[var(--card-bg)] text-[12px]" style={{borderColor:'var(--border)'}}>Cancel</button></div>
    </div>
  );
}
export default NoteEditor;
