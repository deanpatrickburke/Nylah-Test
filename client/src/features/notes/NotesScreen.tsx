import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PersonKey, NoteMemo } from "../../types";
import { PERSONS } from "../../constants/themes";
import { uid, relTime, rotForId } from "../../shared/utils/helpers";
import { resizeToDataUrl, createThumbnail } from "../../lib/images";

// BottomSheet extracted verbatim from AppMonolith — boutique tokens preserved
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
        else {
          const first = sheetRef.current.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          first?.focus();
        }
      }
    });
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = prevOverflow;
      try { prevFocusRef.current?.focus(); } catch {}
    };
  }, [open]);
  if (!open) return null;
  const content = (
    <div className="fixed inset-0 z-[80] flex items-end justify-center px-3 pb-[max(16px,env(safe-area-inset-bottom))] pointer-events-auto">
      <button aria-label="Close sheet" onClick={onClose} className="absolute inset-0 bg-[#292624]/20 backdrop-blur-[3px] min-h-[44px]" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={title ? "sheet-title" : undefined} className="relative w-full max-w-[420px] rounded-[16px] bg-[var(--card-bg)] border shadow-[0_-16px_48px_rgba(0,0,0,0.18)] max-h-[72dvh] flex flex-col" style={{ borderColor: "var(--border)" }} tabIndex={-1}>
        <div className="flex items-center justify-center pt-3 pb-2"><span className="rounded-full bg-[var(--border)]" style={{ width:"36px", height:"5px", display:"block"}}/></div>
        <div className="flex items-center justify-between px-5 pb-3 gap-2">
          {title ? <div className="font-display text-[16px] font-medium">{title}</div> : <div className="flex-1"/>}
          <button onClick={onClose} aria-label="Close" className="grid h-[44px] w-[44px] place-items-center rounded-full border" style={{borderColor:"var(--border)"}}>✕</button>
        </div>
        <div className="px-4 pb-6 overflow-auto">{children}</div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

function NotesMemoPage(props: any) {
  let { notes, setNotes, currentUser, nowMs } = (props || {}) as {
    notes: NoteMemo[]; setNotes: any; currentUser: PersonKey; nowMs: number;
  };
  // v120 defensive: never crash on undefined
  if (!Array.isArray(notes)) notes = [] as any;
  if (typeof setNotes !== 'function') setNotes = (()=>{}) as any;
  if (!currentUser) currentUser = "aisling" as any;
  if (typeof nowMs !== 'number') nowMs = Date.now();
  const [filter, setFilter] = useState<"all"|"unread"|"pinned"|"love"|"archive">("all");
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addBody, setAddBody] = useState("");
  const [addIsLove, setAddIsLove] = useState(false);
  const [addPhotoDataUrl, setAddPhotoDataUrl] = useState<string|undefined>(undefined);
  const [addThumbDataUrl, setAddThumbDataUrl] = useState<string|undefined>(undefined);
  const [isResizing, setIsResizing] = useState(false);
  const [selected, setSelected] = useState<NoteMemo|null>(null);

  const activeNotes = useMemo(()=> notes.filter((n:any)=> !(n as any).deletedAt && !(n as any).archived_at && !(n as any).archivedAt), [notes]);
  const partner: PersonKey = currentUser==="aisling"?"ciaran":"aisling";

  const filtered = useMemo(()=>{
    let list = activeNotes;
    if(filter==="unread") list = list.filter(n=> n.author===partner && !((n.seenBy as any)?.[currentUser]));
    else if(filter==="pinned") list = list.filter(n=> (n as any).pinned_at || (n as any).pinnedAt);
    else if(filter==="love") list = list.filter(n=> n.isLove);
    else if(filter==="archive") {
      const arch = notes.filter((n:any)=> (n as any).archivedAt || (n as any).archived_at);
      list = arch as any;
    }
    if(query.trim()){
      const q=query.toLowerCase();
      list = list.filter(n=> n.body.toLowerCase().includes(q));
    }
    return list.sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  }, [activeNotes, filter, query, notes, partner, currentUser]);

  const featured = filtered[0] || null;
  const pinned = useMemo(()=> filtered.filter(n=> (n as any).pinned_at || (n as any).pinnedAt).slice(0,4), [filtered]);
  const older = useMemo(()=> filtered.slice(featured ? 1 : 0).slice(0,12), [filtered, featured]);

  async function handlePhotoFile(file: File) {
    try {
      setIsResizing(true);
      const reader = new FileReader();
      const base64: string = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      // V37 resize to max 900 jpeg 0.82 then 180 thumb 0.8 — sharper but still <200k
      const full = await resizeToDataUrl(base64, 900, "image/jpeg", 0.82);
      const thumb = await createThumbnail(full, 180, "image/jpeg", 0.8);
      setAddPhotoDataUrl(full);
      setAddThumbDataUrl(thumb);
    } catch {
      // fallback original
    } finally { setIsResizing(false); }
  }

  async function addNote(){
    if(!addBody.trim()) return;
    // ensure any large photo is compressed to 900 + thumb 180 before persist
    let finalFull = addPhotoDataUrl;
    let finalThumb = addThumbDataUrl;
    if (finalFull && finalFull.length > 8000) {
      try {
        // re-compress to target sizes if oversized or old 600
        if (finalFull.length < 40000 && finalThumb) {
          // already 900px range, keep
        } else {
          finalFull = await resizeToDataUrl(finalFull, 900, "image/jpeg", 0.82);
          finalThumb = await createThumbnail(finalFull, 180, "image/jpeg", 0.8);
        }
      } catch {}
    }
    const n: NoteMemo = {
      id: uid("note"),
      body: addBody.trim(),
      author: currentUser,
      createdAt: new Date().toISOString(),
      seenBy: { aisling: currentUser==="aisling", ciaran: currentUser==="ciaran" } as any,
      isLove: addIsLove,
      photoDataUrl: finalFull,
      photoThumbDataUrl: finalThumb,
      rotation: rotForId(uid("r")),
      updatedAt: new Date().toISOString(),
    } as any;
    setNotes((p:any)=> [n, ...p]);
    setAddBody(""); setAddIsLove(false); setAddPhotoDataUrl(undefined); setAddThumbDataUrl(undefined); setShowAdd(false);
  }

  return (
    <div className="w-full space-y-4">
      <div className="rounded-[24px] border px-5 pt-5 pb-4 relative overflow-hidden" style={{ background:'linear-gradient(180deg,var(--wash-top) 0%,var(--wash-mid) 18%,var(--wash-top) 28%,var(--card-bg) 100%)', borderColor:'var(--border)', boxShadow:'0 12px 32px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center justify-between h-[44px]">
          <h2 className="font-display text-[26px] font-semibold tracking-tight text-[var(--text)]">Notes</h2>
          <button onClick={()=> setShowAdd(true)} className="grid h-11 w-11 place-items-center rounded-full bg-[#0A0A0A] text-white text-[16px] shadow-[0_6px_18px_rgba(0,0,0,0.18)]" style={{minHeight:44, minWidth:44}}>＋</button>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={query} onChange={e=> setQuery(e.target.value)} placeholder="Search notes…" className="flex-1 h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-4 text-[12px] shadow-sm" style={{borderColor:'var(--border)'}} />
          <div className="relative">
            <select value={filter} onChange={e=> setFilter(e.target.value as any)} className="h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="pinned">Pinned</option>
              <option value="love">Love</option>
              <option value="archive">Archive</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
          </div>
        </div>
      </div>

      {/* FROM ... Large featured - polaroid obvious */}
      {featured && (
        <button onClick={()=> setSelected(featured)} className="relative w-full text-left rounded-[20px] border bg-[var(--card-bg)] px-5 py-5 shadow-[0_12px_32px_rgba(41,26,12,0.12)]" style={{borderColor: featured.isLove ? "#F9A8D4" : "var(--border)"}}>
          <span className="absolute right-4 top-3 h-2 w-6 rounded-full bg-[var(--chip-bg)] border shadow-sm" style={{borderColor:'var(--border)'}} aria-hidden="true" />
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)] flex items-center gap-1.5">FROM {(PERSONS[featured.author as any]?.name||featured.author||"?").toUpperCase()} <svg viewBox="0 0 16 16" className={"h-[12px] w-[12px] "+(featured.isLove ? "fill-[#E07A5F]" : "fill-white stroke-[var(--border)]")}><path d="M8 13.1 4.2 9.6A3.6 3.6 0 0 1 3 7c0-1.7 1.25-2.9 2.9-2.9 1 0 1.65.45 2.1 1.2.45-.75 1.1-1.2 2.1-1.2C11.75 4.1 13 5.3 13 7c0 .9-.4 1.9-1.2 2.9L8 13.1Z"/></svg></div>
          <div className="mt-3 font-display text-[17px] leading-[24px] line-clamp-6 text-[var(--text)]">{featured.body}</div>
          {featured.photoDataUrl && <span className="mt-4 inline-block rounded-[10px] border bg-[var(--card-bg)] p-2 shadow-sm"><img src={featured.photoDataUrl} alt="" className="w-[160px] h-[120px] rounded-[6px] object-cover" loading="lazy" /></span>}
          <div className="mt-3 text-[11px] text-[var(--muted)]">{relTime(featured.createdAt, nowMs)} • {featured.isLove ? "Love" : "Note"}</div>
        </button>
      )}

      {/* PINNED medium grid */}
      {pinned.length>0 && (
        <div className="space-y-2">
          <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Pinned</div>
          <div className="grid grid-cols-2 gap-2">
            {pinned.slice(0,4).map(n=> (
              <button key={n.id} onClick={()=> setSelected(n)} className="rounded-[16px] border bg-[var(--card-bg)] px-3 py-3 text-left min-h-[84px]" style={{borderColor:"var(--border)"}}>
                <div className="text-[13px] line-clamp-3">{n.body}</div>
                <div className="mt-2 text-[11px] text-[var(--muted)]">{relTime(n.createdAt, nowMs)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* OLDER compact rows */}
      <div className="space-y-1">
        <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Older</div>
        {older.length===0 ? (
          <div className="rounded-[16px] border border-dashed bg-[var(--card-bg)] px-4 py-6 text-center text-[12px] text-[var(--muted)]">No notes</div>
        ) : older.map(n=> (
          <button key={n.id} onClick={()=> setSelected(n)} className="w-full text-left flex items-center gap-3 rounded-[16px] border bg-[var(--card-bg)] px-3 py-3 min-h-[52px]" style={{borderColor:"var(--border)"}}>
            <span className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold text-white shrink-0" style={{background: (PERSONS[n.author as any]?.accent2||"#A89FDA")}}>{(PERSONS[n.author as any]?.initial||"?")}</span>
            <span className="flex-1 min-w-0"><span className="block text-[13px] truncate">{n.body}</span><span className="block text-[11px] text-[var(--muted)]">{relTime(n.createdAt, nowMs)} • {n.isLove?"Love":""}</span></span>
          </button>
        ))}
      </div>

      <BottomSheet open={showFilter} onClose={()=> setShowFilter(false)} title="Filter">
        <div className="space-y-3 py-2">
          <div className="relative">
            <select value={filter} onChange={e=> { setFilter(e.target.value as any); setShowFilter(false); }} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="pinned">Pinned</option>
              <option value="love">Love</option>
              <option value="archive">Archive</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={showAdd} onClose={()=> setShowAdd(false)} title="Add note">
        <div className="space-y-3">
          <textarea value={addBody} onChange={e=> setAddBody(e.target.value)} placeholder="Write a note for your person…" className="w-full rounded-[12px] border bg-[var(--card-bg)] px-3 py-3 text-[14px] min-h-[96px]" style={{borderColor:"var(--border)"}} />
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={addIsLove} onChange={e=> setAddIsLove(e.target.checked)} /> Love note <svg width="12" height="12" viewBox="0 0 16 16" fill="#E07A5F"><path d="M8 13.1 4.2 9.6A3.6 3.6 0 0 1 3 7c0-1.7 1.25-2.9 2.9-2.9 1 0 1.65.45 2.1 1.2.45-.75 1.1-1.2 2.1-1.2C11.75 4.1 13 5.3 13 7c0 .9-.4 1.9-1.2 2.9L8 13.1Z"/></svg></label>
          {/* Obvious photo upload */}
          <div className="w-full">
            <input id="note-photo-input" type="file" accept="image/*" onChange={e=>{ const f=e.target.files?.[0]; if(f) handlePhotoFile(f); }} className="sr-only" />
            <label htmlFor="note-photo-input" className="flex h-[64px] w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] border-2 border-dashed bg-[var(--card-bg)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--chip-bg)] active:scale-[0.99]" style={{borderColor:"var(--border)"}}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] border" style={{borderColor:"var(--border)"}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 6l1-2h4l1 2"/></svg></span>
              {isResizing ? "Resizing…" : addPhotoDataUrl ? "Change photo" : "Tap to add photo"}
            </label>
            {isResizing && <span className="mt-1 block text-[11px] text-[var(--muted)]">Compressing to 900px…</span>}
          </div>
          {addPhotoDataUrl && (
            <div className="flex gap-3 items-start rounded-[12px] border bg-[var(--card-bg)] p-2" style={{borderColor:"var(--border)"}}>
              <img src={addThumbDataUrl || addPhotoDataUrl} alt="preview" className="h-[96px] w-[96px] rounded-[10px] object-cover border shadow-sm" style={{borderColor:"var(--border)"}} />
              <div className="text-[11px] text-[var(--text-secondary)] leading-[1.4]">Sharper 900px • 180px thumb JPEG 0.82<br/><span className="text-[11px] text-[var(--muted)]">Looks crisp on phone</span><br/><button onClick={()=>{ setAddPhotoDataUrl(undefined); setAddThumbDataUrl(undefined); }} className="mt-1 text-[11px] underline text-[#B91C1C]">Remove</button></div>
            </div>
          )}
          <button onClick={addNote} disabled={!addBody.trim() || isResizing} className="w-full h-[52px] rounded-[16px] bg-[#0A0A0A] text-white text-[15px] font-semibold disabled:opacity-40">Add</button>
        </div>
      </BottomSheet>

      <BottomSheet open={!!selected} onClose={()=> setSelected(null)} title={selected ? (PERSONS[selected.author as any]?.name||selected.author||"?") : undefined}>
        {selected && (
          <div className="space-y-3">
            <div className="text-[15px] leading-[21px]">{selected.body}</div>
            {selected.photoDataUrl && <img src={selected.photoDataUrl} alt="" className="w-full rounded-[12px] border" style={{borderColor:"var(--border)"}} />}
            <div className="text-[11px] text-[var(--muted)]">{relTime(selected.createdAt, nowMs)}</div>
            <div className="flex gap-2">
              <button onClick={()=> { (() => { const nowISO=new Date().toISOString(); return setNotes((p:any)=> p.map((x:any)=> x.id===selected.id ? {...x, pinned_at: (x as any).pinned_at ? null : nowISO, pinnedAt: (x as any).pinned_at ? null : nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)) })(); setSelected(null); }} className="flex-1 h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[12px]">Pin</button>
              <button onClick={()=> { (() => { const nowISO=new Date().toISOString(); return setNotes((p:any)=> p.map((x:any)=> x.id===selected.id ? {...x, archived_at: nowISO, archivedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)) })(); setSelected(null); }} className="flex-1 h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[12px] text-[#B91C1C]">Archive</button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}


export function NotesScreen(props:any){
  return <NotesMemoPage {...props} />;
}
export default NotesScreen;
