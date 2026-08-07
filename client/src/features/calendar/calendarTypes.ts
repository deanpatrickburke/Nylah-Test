// calendarTypes.ts — zero logic change, re-export canonical types
export type { CalendarEventV2, CalendarEventStatus, CalendarResponseKind, CalendarEventResponse, PersonKey } from "../../types";
export type { CalendarEventV2 as CalendarEvent } from "../../types";
export const HOUSEHOLD_TZ = "Europe/Dublin" as const;
export { HOUSEHOLD_ID } from "../../lib/buildMeta";
