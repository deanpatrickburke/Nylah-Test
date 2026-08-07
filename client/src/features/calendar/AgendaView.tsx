import type { CalendarEventV2, PersonKey } from "../../types";
import { HOUSEHOLD_TZ } from "../../lib/dates";

type Props = {
  eventsForToday: CalendarEventV2[];
  eventsForTomorrow: CalendarEventV2[];
  laterFlat: { key:string, ev:CalendarEventV2 }[];
  onSelectEvent: (ev:CalendarEventV2)=>void;
  currentUser: PersonKey;
};

function toTimeDublin(iso?: string){
  if(!iso) return "";
  try{ return new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:HOUSEHOLD_TZ}); }catch{ return ""; }
}

export function AgendaView({ eventsForToday, eventsForTomorrow, laterFlat, onSelectEvent, currentUser }: Props){
  const AgendaRow = ({ ev }: { ev: CalendarEventV2 }) => {
    const isPending = ["proposed","awaiting_aisling","awaiting_ciaran","needs_discussion"].includes(ev.status as any);
    const timeStr = (ev as any).allDay ? "All day" : toTimeDublin((ev as any).start||(ev as any).dueAt);
    const attendees = (ev as any).attendees || ["aisling","ciaran"];
    const isBoth = attendees.length!==1;
    const leftRuleColor = isBoth ? "#8B7357" : (attendees[0]==="aisling" ? "#A89FDA" : "#E07A5F");
    return (
      <button onClick={()=> onSelectEvent(ev)} className="w-full text-left flex items-stretch rounded-[18px] border bg-[var(--card-bg)] overflow-hidden active:scale-[0.98] min-h-[64px] relative" style={{borderColor:"var(--border)", paddingLeft:3}}>
        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[18px]" style={{background:leftRuleColor}} aria-hidden="true"/>
        <span className="flex flex-1 items-center gap-3 px-3.5 py-3 min-w-0 ml-[3px]">
          <span className="flex flex-col items-center gap-1.5 shrink-0">
            <span className="tabular-nums text-[12px] font-medium rounded-full px-2 py-0.5 border" style={{fontFamily:'Inter Tight, var(--font-ui)', background:'var(--chip-bg)', borderColor:'var(--border)'}}>{timeStr}</span>
            <span className="h-[7px] w-[7px] rounded-full" style={{background:leftRuleColor}}/>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold truncate">{ev.title}</span>
            <span className="block text-[11px] truncate max-w-[150px]" style={{color:'var(--muted)'}}>{(ev as any).location||""} {isPending?"• Needs you":""}</span>
          </span>
          <span className="shrink-0 rounded-full h-8 w-8 grid place-items-center border text-[12px]" style={{background:'var(--chip-bg)', borderColor:'var(--border)'}}>›</span>
        </span>
      </button>
    );
  };
  return (
    <div className="space-y-4 px-1">
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] mb-2">Today • Europe/Dublin</div>
        <div className="space-y-2">{eventsForToday.length? eventsForToday.map(ev=><AgendaRow key={ev.id} ev={ev}/>) : <div className="text-[12px] text-[var(--muted)] italic">Nothing — enjoy the quiet.</div>}</div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] mb-2">Tomorrow</div>
        <div className="space-y-2">{eventsForTomorrow.map(ev=><AgendaRow key={ev.id} ev={ev}/>)}</div>
      </div>
      {laterFlat.length>0 && (
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)] mb-2">Upcoming • Future split</div>
          <div className="space-y-2">{laterFlat.map(({key,ev})=><AgendaRow key={ev.id+"-"+key} ev={ev}/>)}</div>
        </div>
      )}
    </div>
  );
}
export default AgendaView;
