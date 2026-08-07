// choreTypes.ts — re-export canonical types from ../../types (zero logic change)
export type { ChoreV2, PersonKey } from "../../types";
export type { ChoreV2 as Chore } from "../../types";
export * from "../../types";

// Household TZ constant preserved from monolith — Europe/Dublin canonical
export const HOUSEHOLD_TZ = "Europe/Dublin" as const;

// BIWEEKLY_EPOCH_MONDAY_UTC preserved from lib/dates — 2024-01-01 is Monday
export { BIWEEKLY_EPOCH_MONDAY_UTC } from "../../lib/dates";
export { weekNumberSinceEpoch } from "../../lib/dates";
