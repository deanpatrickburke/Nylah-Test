// PIN verification — server-side only via Supabase RPC
// Client never stores plaintext PINs, hashes, or mappings.
// All values live in Supabase household_pins table and verified via verify_household_pin RPC.
// If RPC unavailable, fail closed requiring PIN setup.

export type PersonKey = "aisling" | "ciaran";

function getHouseholdIdForPins(): string {
  try {
    const custom = localStorage.getItem("couple_v1_household_id");
    if (custom && custom.trim().length >= 3) return custom.trim();
    const legacyCode = localStorage.getItem("couple_v1_household_code");
    if (legacyCode && legacyCode.trim().length >= 3) {
      const c = legacyCode.trim().toLowerCase();
      return c.startsWith("nylah-") ? c : `nylah-${c}`;
    }
  } catch {}
  try { const id = localStorage.getItem("couple_v1_household_id"); if(id) return id; } catch {} return null as any;
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
  try {
    const sb = await getSupabaseClientForPin();
    if (!sb) return null; // fail closed - no server, no auth
    // RPC: verify_household_pin(hid text, pin text) returns person_key text
    const { data, error } = await sb.rpc("verify_household_pin", { hid, pin: trimmed } as any);
    if (error) {
      console.warn("[pin] rpc verify error", error.message);
      return null;
    }
    if (!data) return null;
    // data may be string or object {person_key} or array
    if (typeof data === "string") {
      if (data === "aisling" || data === "ciaran") return data as PersonKey;
      return null;
    }
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      if (typeof first === "string" && (first === "aisling" || first === "ciaran")) return first as PersonKey;
      if (first && typeof first === "object" && (first.person_key === "aisling" || first.person_key === "ciaran")) return first.person_key;
    }
    if (typeof data === "object") {
      const pk = (data as any).person_key || (data as any).personKey;
      if (pk === "aisling" || pk === "ciaran") return pk;
    }
    return null;
  } catch (e) {
    console.warn("[pin] verify exception", e);
    return null;
  }
}

// Legacy sync wrappers removed - return null to force async path and fail closed
export async function verifyPinSync(_pin: string): Promise<PersonKey | null> {
  return null;
}

export function personFromPin(_pin: string): PersonKey | null {
  return null; // server-side only; client must use async verifyPin
}

export const PERSON_PIN_LENGTH = 4 as const;

// No PIN_TO_PERSON mapping - removed for security
export const PIN_TO_PERSON: Record<string, PersonKey> = {};

// Removed: sha256hex, sha256hexSyncFallback, PIN_HASHES, setHouseholdPinMap, etc.
// Household PIN management now server-side only. LocalStorage maps deprecated and ignored.
// For backwards compat with old settings UI that tried to set maps, provide no-ops that clear legacy keys.

export function setHouseholdPinMap(_hid: string, _map: Record<string, PersonKey>) {
  try { localStorage.removeItem(`couple_v1_household_pins_${_hid}`); } catch {}
}
export function setHouseholdPlainPins(_hid: string, _plainMap: Record<string, PersonKey>) {
  try { localStorage.removeItem(`couple_v1_household_pins_plain_${_hid}`); } catch {}
}
export function clearHouseholdPinMap(hid: string) {
  try { localStorage.removeItem(`couple_v1_household_pins_${hid}`); localStorage.removeItem(`couple_v1_household_pins_plain_${hid}`); } catch {}
}
