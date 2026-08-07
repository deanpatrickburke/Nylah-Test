/**
 * Nylah OS — Build-time constants (Scalable V144)
 * No hard-coded household ID. Household is dynamic per-install.
 * Only shared invariants live here.
 */

// Household timezone — single source of truth for all local-date logic
export const HOUSEHOLD_TZ = "Europe/Dublin" as const;

// Legacy token kept for migration reads only; do not use for auth or default row
export const HOUSEHOLD_TOKEN_LEGACY = "ash-ciaran-2026" as const;

// Members type — actual names are per-household dynamic, stored in Supabase meta.persons
export type HouseholdMember = string;

// Beta build marker
export const BUILD_CHANNEL = "beta" as const;
export const BUILD_META = {
  tz: HOUSEHOLD_TZ,
  channel: BUILD_CHANNEL,
} as const;

// For backwards compat where code imported HOUSEHOLD_ID / ROW_ID — export nullable helper, not a default
export const HOUSEHOLD_ID: string | null = null;
export const HOUSEHOLD_ROW_ID: string | null = null;
export const HOUSEHOLD_TABLE = "couple_data" as const;
