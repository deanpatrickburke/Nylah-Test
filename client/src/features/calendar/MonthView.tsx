import type { CalendarEventV2 } from "../../types";

type Props = {
  cells: { key: string|null; day:number|null; isSelected:boolean; isToday:boolean }[];
  byDay: Map<string, CalendarEventV2[]>;
  onSelect: (k:string)=>void;
};

export function MonthView({ cells, byDay, onSelect }: Props){
  return (
    <div className="nylah-arena rounded-[24px] px-5 pt-5 pb-4 relative overflow-hidden" style={{background:'var(--card-bg)', border:'1px solid var(--border)'}}>
      <div className="relative">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] mb-2 px-1" style={{fontFamily:'var(--font-ui)'}}><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((c,i)=>{
            if (!c.key) return <div key={"empty-"+i} className="min-h-[44px] min-w-[44px]" />;
            const dayEvs = (byDay.get(c.key!) || []) as any[];
            const hasEv = dayEvs.length>0;
            const isSel = c.isSelected;
            const isToday = c.isToday;
            return (
              <button
                key={c.key}
                onClick={()=> onSelect(c.key!)}
                aria-label={c.key + (hasEv ? " has "+dayEvs.length+" events" : "")}
                className="relative min-h-[44px] w-full rounded-[14px] grid place-items-center border active:scale-[0.96] py-2.5"
                style={{
                  minHeight:44,
                  background: isSel ? '#121214' : isToday ? 'rgba(255,107,38,0.14)' : 'var(--card-bg)',
                  color: isSel ? '#FFFEFB' : 'var(--text)',
                  borderColor: isSel ? '#121214' : isToday ? 'rgba(255,107,38,0.28)' : 'var(--border)',
                  boxShadow: isSel ? '0 8px 20px rgba(0,0,0,0.22), 0 0 0 1px #121214 inset' : isToday ? '0 0 0 4px rgba(255,107,38,0.10), 0 4px 16px rgba(255,107,38,0.12)' : '0 1px 0 rgba(255,255,255,0.86) inset',
                  fontFamily: 'Fraunces, var(--font-display)',
                  fontWeight: isSel||isToday?600:500,
                  fontSize:'13px',
                  transition:'transform 160ms cubic-bezier(0.34,1.56,0.64,1)'
                }}
              >
                <span className="leading-none">{c.day}</span>
                {hasEv && (
                  <span className="absolute bottom-[5px] left-1/2 -translate-x-1/2 flex gap-[2.5px] justify-center items-center">
                    {dayEvs.slice(0,3).map((ev:any,j:number)=> {
                      const at = (ev as any).attendees || ["aisling","ciaran"];
                      const col = at.length===1 ? (at[0]==="aisling" ? "#A89FDA" : "#E07A5F") : "#8B7357";
                      return <span key={j} className="rounded-full" style={{width:'5px',height:'5px',background:col}} />;
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-center gap-3 text-[11px] font-medium text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#A89FDA"}}/> Aisling</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#E07A5F"}}/> Ciaran</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#8B7357"}}/> Both</span>
        </div>
      </div>
    </div>
  );
}
export default MonthView;
