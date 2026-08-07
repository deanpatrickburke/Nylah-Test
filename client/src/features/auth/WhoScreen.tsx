import { useEffect, useState } from "react";
import type { PersonKey } from "../../types";
import { PERSONS } from "../../constants/themes";

// Custom names — verbatim from AppMonolith.tsx preserving boutique tokens
function getHouseholdPersonsRaw(): any[] | null {
  try {
    const hid = localStorage.getItem("couple_v1_household_id");
    const tryKeys = hid ? [`couple_v1_household_persons_${hid}`, `couple_v1_household_persons`] : [`couple_v1_household_persons`];
    for (const k of tryKeys) {
      const raw = localStorage.getItem(k);
      if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {} }
    }
  } catch {}
  return null;
}

export function WhoScreen({ onPick, onSelect }: { onPick?: (k: PersonKey)=>void; onSelect?: (k: PersonKey)=>void }) {
  const pick = (k: PersonKey) => { (onPick||onSelect)?.(k); };
  const [names, setNames] = useState<Record<string,string>>(()=> {
    // try custom names instantly (person picker 2, custom names)
    try {
      const persons = getHouseholdPersonsRaw();
      const map: Record<string,string> = {};
      if (persons) {
        for (const p of persons) {
          if (p?.key && p?.name) map[p.key] = p.name;
        }
      }
      return map;
    } catch { return {}; }
  });

  useEffect(()=> {
    try {
      const persons = getHouseholdPersonsRaw();
      if (!persons || persons.length<2) return;
      const map: Record<string,string> = {};
      for (const p of persons) {
        if (!p || !p.key || !p.name) continue;
        map[p.key] = p.name;
      }
      if (Object.keys(map).length) setNames(map);
    } catch {}
  }, []);

  return (
    <div className="min-h-[100vh] flex flex-col items-center justify-center px-6 py-10" style={{background:"linear-gradient(180deg,var(--wash-top),var(--card-bg))"}}>
      <div className="w-full max-w-[344px] flex flex-col gap-4">
        <div className="text-center mb-2">
          <div className="text-[26px] font-semibold tracking-tight" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>Who's there?</div>
          <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mt-1">private • just you two</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {((): PersonKey[] => {
            try {
              const raw = getHouseholdPersonsRaw();
              if (raw && raw.length >= 2) return raw.map((x:any)=>x.key).filter(Boolean) as PersonKey[];
            } catch {}
            return ["person_1","person_2"] as PersonKey[];
          })().map(k=>{
            const p = (PERSONS as any)[k] || { name: names[k] || k, initial: (names[k]||k).slice(0,1).toUpperCase(), accent2: "#FF6B26" } as any;
            const customName = names[k] || (p as any).name || k;
            const initial = customName.trim().slice(0,1).toUpperCase() || (p as any).initial || "?";
            return (
              <button
                key={k}
                onClick={()=> pick(k)}
                className="h-[96px] min-h-[44px] rounded-[22px] border bg-[var(--card-bg)] flex flex-col items-center justify-center gap-2 active:scale-[0.98] transition"
                style={{borderColor:'var(--border)', transitionTimingFunction:'cubic-bezier(0.34,1.56,0.64,1)', transitionDuration:'180ms'}}
              >
                <span className="grid h-[44px] w-[44px] place-items-center rounded-full text-[16px] font-bold text-white border-2 border-white shadow-sm" style={{background:p.accent2}}>{initial}</span>
                <span className="text-[13px] font-semibold" style={{color:'var(--text)'}}>{customName}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
export default WhoScreen;
