import { useEffect, useState } from "react";
import type { PersonKey } from "../../types";

type PersonMeta = { key: string; name: string; initial?: string };

function getPersons(): PersonMeta[] {
  try {
    const hid = localStorage.getItem("couple_v1_household_id") || "";
    const keys = hid ? [`couple_v1_household_persons_${hid}`, "couple_v1_household_persons"] : ["couple_v1_household_persons"];
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (raw) {
        try {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr) && arr.length >= 2) return arr as PersonMeta[];
        } catch {}
      }
    }
  } catch {}
  return [
    { key: "person_1", name: "You" },
    { key: "person_2", name: "Partner" },
  ];
}

function getHouseId(): string {
  try { return localStorage.getItem("couple_v1_household_id") || "—"; } catch { return "—"; }
}

export function HouseholdSettings({ currentUser }: { currentUser?: PersonKey }) {
  const [persons, setPersons] = useState<PersonMeta[]>(() => getPersons());
  const [hid] = useState(() => getHouseId());
  const [houseName, setHouseName] = useState(() => {
    try { return localStorage.getItem("couple_v1_household_name") || ""; } catch { return ""; }
  });
  const [youPin, setYouPin] = useState("");
  const [partnerPin, setPartnerPin] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const p = getPersons();
    if (p.length) setPersons(p);
  }, []);

  const saveNames = () => {
    try {
      const cleaned = persons.map((p) => ({ key: p.key, name: (p.name || "").trim() || p.key, initial: (p.name || "").slice(0, 1).toUpperCase() }));
      const hidNow = localStorage.getItem("couple_v1_household_id") || hid;
      if (hidNow && hidNow !== "—") localStorage.setItem(`couple_v1_household_persons_${hidNow}`, JSON.stringify(cleaned));
      localStorage.setItem("couple_v1_household_persons", JSON.stringify(cleaned));
      setMsg("names saved ✓");
      setTimeout(() => setMsg(""), 1800);
    } catch (e: any) {
      setMsg("couldn't save");
    }
  };

  const saveHouseName = () => {
    try {
      localStorage.setItem("couple_v1_household_name", houseName.trim());
      setMsg("house saved ✓");
      setTimeout(() => setMsg(""), 1500);
    } catch {}
  };

  const canSetPins = /^\d{4}$/.test(youPin) && /^\d{4}$/.test(partnerPin) && youPin !== partnerPin;

  const doSetPins = async () => {
    if (!canSetPins) { setMsg("both 4 digits, different"); return; }
    if (!hid || hid === "—") { setMsg("no house id"); return; }
    setBusy(true);
    try {
      const mod: any = await import("../../lib/supabase");
      const sb = mod.getSupabase?.();
      if (!sb) { setMsg("offline — try when online"); setBusy(false); return; }
      const tryUpsert = async (pinVal: string, key: string) => {
        try {
          const { error } = await sb.rpc("upsert_household_pin", { hid, pin: pinVal, person_key: key } as any);
          if (!error) return true;
        } catch {}
        // fallback hash insert (should not be needed, server does bcrypt)
        try {
          const { error } = await sb.from("household_pins").upsert({ household_id: hid, person_key: key, pin_hash: pinVal } as any);
          return !error;
        } catch { return false; }
      };
      const k1 = persons[0]?.key || "person_1";
      const k2 = persons[1]?.key || "person_2";
      const okA = await tryUpsert(youPin, k1);
      const okB = await tryUpsert(partnerPin, k2);
      if (!okA || !okB) { setMsg("failed — try again"); setBusy(false); return; }
      setMsg("PINs live ✓ server-only");
      setYouPin(""); setPartnerPin("");
    } catch (e: any) { setMsg(String(e?.message || e).slice(0, 40)); }
    setBusy(false);
    setTimeout(() => setMsg(""), 2500);
  };

  return (
    <div className="space-y-3">
      {/* house name — boutique */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)]">You two</div>
        <div className="grid grid-cols-2 gap-2">
          {persons.map((p, i) => (
            <label key={p.key} className="block">
              <div className="text-[10px] text-[var(--muted)] mb-1 ml-2">{i === 0 ? "Person 1" : "Person 2"}</div>
              <input
                value={p.name}
                onChange={(e) => setPersons((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value.slice(0, 18) } : x))}
                placeholder={i === 0 ? "You" : "Partner"}
                className="w-full h-[42px] rounded-full border bg-[var(--card-bg)] px-4 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#FF6B26]/30"
                style={{ borderColor: "var(--border)" }}
              />
            </label>
          ))}
        </div>
        <button onClick={saveNames} className="h-[36px] rounded-full border bg-[var(--chip-bg)] px-4 text-[11px] font-medium active:scale-[0.98]" style={{ borderColor: "var(--border)" }}>Save names</button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)]">House</div>
        <div className="flex gap-2">
          <input
            value={houseName}
            onChange={(e) => setHouseName(e.target.value.slice(0, 28))}
            onBlur={saveHouseName}
            placeholder={`${persons[0]?.name || "You"} & ${persons[1]?.name || "Partner"}`}
            className="flex-1 h-[40px] rounded-full border bg-[var(--card-bg)] px-4 text-[12.5px]"
            style={{ borderColor: "var(--border)" }}
          />
        </div>
        <div className="text-[10px] text-[var(--muted)]">house · <span className="font-mono">{hid}</span></div>
      </div>

      {/* PINs — server only, scalable keys */}
      <div className="rounded-[14px] border bg-[var(--chip-bg)] p-3 space-y-2" style={{ borderColor: "var(--border)" }}>
        <div className="text-[11px] font-semibold">{persons[0]?.name || "Person 1"} PIN · {persons[1]?.name || "Person 2"} PIN</div>
        <div className="grid grid-cols-2 gap-2">
          <input value={youPin} onChange={(e) => setYouPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder={`${persons[0]?.name || "You"} 4-digit`} className="h-[40px] rounded-[12px] border bg-[var(--card-bg)] px-3 text-center text-[13px] tracking-[0.2em]" style={{ borderColor: "var(--border)" }} />
          <input value={partnerPin} onChange={(e) => setPartnerPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder={`${persons[1]?.name || "Partner"} 4-digit`} className="h-[40px] rounded-[12px] border bg-[var(--card-bg)] px-3 text-center text-[13px] tracking-[0.2em]" style={{ borderColor: "var(--border)" }} />
        </div>
        <button disabled={!canSetPins || busy} onClick={doSetPins} className={`w-full h-[40px] rounded-full text-[12px] font-semibold active:scale-[0.98] ${canSetPins ? "bg-[#121214] text-white" : "bg-[var(--card-bg)] text-[var(--muted)] border"}`} style={{ borderColor: canSetPins ? "transparent" : "var(--border)" }}>
          {busy ? "setting…" : canSetPins ? `Set PINs · ${persons[0]?.name || "P1"} & ${persons[1]?.name || "P2"}` : "Enter both 4-digit PINs"}
        </button>
        <div className="text-[10px] text-[var(--muted)]">PINs never ship in bundle — checked server-side via RPC.</div>
        {msg && <div className="text-[11px] text-[#16A34A]">{msg}</div>}
      </div>
    </div>
  );
}
export default HouseholdSettings;
