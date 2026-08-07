import type { NoteMemo } from "../../types";
import { rotForId } from "../../shared/utils/helpers";

export function PhotoNote({ note }: { note: NoteMemo }){
  const rot = (note as any).rotation ?? rotForId(note.id);
  return (
    <div className="relative rounded-[16px] border bg-[var(--card-bg)] overflow-hidden shadow-sm" style={{borderColor:'var(--border)', transform:`rotate(${rot}deg)`}}>
      {note.photoDataUrl && <img src={note.photoDataUrl} alt="note" className="w-full h-auto object-cover max-h-[320px]" loading="lazy"/>}
      <div className="p-3">
        <div className="text-[13px] leading-[1.45]" style={{fontFamily:'Fraunces, serif'}}>{note.body}</div>
        <div className="mt-1 text-[10px] text-[var(--muted)]">{note.isLove?"♥ love • ":""}{new Date(note.createdAt).toLocaleDateString()}</div>
      </div>
      {note.photoThumbDataUrl && <div className="absolute top-2 right-2 h-[44px] w-[44px] rounded-full overflow-hidden border-2 border-white shadow-sm"><img src={note.photoThumbDataUrl} className="h-full w-full object-cover"/></div>}
    </div>
  );
}
export default PhotoNote;
