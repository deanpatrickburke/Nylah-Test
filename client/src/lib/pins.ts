// PIN verification — server-side only via Supabase RPC
// Scalable: no hard-coded household, no migration maps. Fail closed if no hid.

export type PersonKey = string;

function getHouseholdIdForPins(): string | null {
  try {
    const custom = localStorage.getItem("couple_v1_household_id");
    if (custom && custom.trim().length >= 3) return custom.trim();
    const legacyCode = localStorage.getItem("couple_v1_household_code");
    if (legacyCode && legacyCode.trim().length >= 3) {
      const c = legacyCode.trim().toLowerCase();
      if (c.includes("-") && c.length >= 8) return c;
      return c.startsWith("nylah-") ? c : `nylah-${c}`;
    }
  } catch {}
  return null;
}

async function getSupabaseClientForPin() {
  try {
    const mod = await import("./supabase");
    const sb = (mod as any).getSupabase?.();
    if (sb) return sb;
  } catch {}
  return null;
}

export async function verifyPin(pin: string): Promise<PersonKey | null> {
  const trimmed = pin.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const hid = getHouseholdIdForPins();
  if (!hid) return null; // no household — must recover/create first
  try {
    const sb = await getSupabaseClientForPin();
    if (!sb) return null;
    const { data, error } = await sb.rpc("verify_household_pin", { hid, pin: trimmed } as any);
    if (error) {
      console.warn("[pin] rpc verify error", error.message);
      return null;
    }
    if (!data) return null;
    if (typeof data === "string") return data as PersonKey;
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (typeof first === "string") return first as PersonKey;
      if (first && typeof first === "object" && first.person_key) return first.person_key;
    }
    if (typeof data === "object") {
      const pk = (data as any).person_key || (data as any).personKey;
      if (pk) return pk;
    }
    return null;
  } catch (e) {
    console.warn("[pin] verify exception", e);
    return null;
  }
}

export async function verifyPinSync(_pin: string): Promise<PersonKey | null> { return null; }
export function personFromPin(_pin: string): PersonKey | null { return null; }
export const PERSON_PIN_LENGTH = 4 as const;
export const PIN_TO_PERSON: Record<string, PersonKey> = {};
export function setHouseholdPinMap(_hid: string, _map: Record<string, PersonKey>) { try { localStorage.removeItem(`couple_v1_household_pins_${_hid}`); } catch {} }
export function setHouseholdPlainPins(_hid: string, _plainMap: Record<string, PersonKey>) { try { localStorage.removeItem(`couple_v1_household_pins_plain_${_hid}`); } catch {} }
export function clearHouseholdPinMap(hid: string) { try { localStorage.removeItem(`couple_v1_household_pins_${hid}`); localStorage.removeItem(`couple_v1_household_pins_plain_${hid}`); } catch {} }
