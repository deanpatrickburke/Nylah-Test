import type { Theme } from "../../types";
import { THEMES } from "../../constants/themes";

type Props = { theme: Theme; setTheme: (id:string)=>void; onConfetti?:()=>void };

export function ThemeSettings({ theme, setTheme, onConfetti }: Props){
  return (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Appearance - #E8CEB7 #F7EFE8 - low saturation no emoji - Fraunces 26/17 Inter 16</div>
      <button onClick={()=>{ const i=THEMES.findIndex(t=>t.id===theme.id); const n=THEMES[(i+1)%THEMES.length]; setTheme(n.id); onConfetti?.(); }} className="w-full flex items-center justify-between min-h-[48px] px-3 rounded-[12px] border bg-[var(--chip-bg)] text-left" style={{borderColor:"var(--border)"}}>
        <span className="text-[13px]">Theme - {theme.name||"Beige"} - charcoal #121214 card #232326 chip #2C2C30 nav active #FF6B26/#0A0A0A topBar #1E1E20 accent 12% hero 15% grain .028</span>
        <span className="flex items-center gap-2 text-[12px]"><span className="h-3 w-3 rounded-full" style={{background: theme.id==='ink'?'#FF6B26':'#FFDCC7', border:'1px solid var(--border)'}} />{theme.name}</span>
      </button>
      <div className="text-[11px] text-[var(--muted)]">Beige = warm paper #FFFEFB #F7EFE8 #E8CEB7 100vw full-bleed 390 to 100vw QA 44px spring cubic-bezier(0.34,1.56,0.64,1) - Charcoal = Hume #121214 with orange #FF6B26 active</div>
    </div>
  );
}
export default ThemeSettings;
