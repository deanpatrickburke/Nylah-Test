// eventActions.ts — zero logic change, exact JSX/logic verbatim from AppMonolith.tsx boutique tokens preserved
import type { CalendarEventV2, CalendarEventStatus, CalendarEventResponse, PersonKey } from "../../types";
import { upsertCalendarSeries, upsertCalendarOverride } from "../../lib/normalized";

export type { CalendarEventV2, CalendarEventStatus, CalendarEventResponse };

export function getResponses(ev: any): CalendarEventResponse[] {
  // Pure: only actual responses + legacy swipes migration. No invented proposer yes.
  if (ev.responses && ev.responses.length) return ev.responses as any;
  const res: CalendarEventResponse[] = [];
  if (ev.swipes) {
    if (ev.swipes?.aisling) {
      const v = ev.swipes.aisling as any;
      if (v === "yes" || v === "no" || v === "discuss") res.push({ eventId: ev.id, memberId: "aisling", response: v, respondedAt: ev.updatedAt || ev.createdAt });
    }
    if (ev.swipes?.ciaran) {
      const v = (ev.swipes as any).ciaran as any;
      if (v === "yes" || v === "no" || v === "discuss") res.push({ eventId: ev.id, memberId: "ciaran", response: v, respondedAt: ev.updatedAt || ev.createdAt });
    }
  }
  return res;
}

export function computeStatusFromResponses(ev: any, responses: CalendarEventResponse[]): CalendarEventStatus {
  // Keep cancelled/completed/draft stable — verbatim from AppMonolith
  if ((ev as any).status === "cancelled" || (ev as any).status === "completed" || (ev as any).status === "draft") return ev.status as any;
  if ((ev as any).status === "dismissed") return "cancelled" as any;

  const attendees: string[] = (ev as any).attendees && (ev as any).attendees.length ? (ev as any).attendees : ["aisling","ciaran"];
  const proposer = (ev as any).proposer as PersonKey | undefined;

  // Single attendee - who it's FOR
  if (attendees.length === 1) {
    const sole = attendees[0] as PersonKey;
    // Personal event: I create for me => agreed immediately
    if (proposer && proposer === sole) return "agreed" as any;
    const soleResp = responses.find(r => r.memberId === sole);
    if (!soleResp) return (`awaiting_${sole}` as any) as any; // awaiting owner
    if (soleResp.response === "yes") return "agreed" as any;
    if (soleResp.response === "no") return "declined" as any;
    if (soleResp.response === "discuss") return "needs_discussion" as any;
    return (`awaiting_${sole}` as any) as any;
  }

  // Both attendees (or undefined -> both)
  const hasA = responses.find(r => r.memberId === "aisling");
  const hasC = responses.find(r => r.memberId === "ciaran");

  // Inject proposer yes implicitly for both-events when no explicit response from proposer yet
  const effectiveHasA = hasA ? hasA : (proposer === "aisling" && !hasA ? { memberId:"aisling", response:"yes" } as any : undefined);
  const effectiveHasC = hasC ? hasC : (proposer === "ciaran" && !hasC ? { memberId:"ciaran", response:"yes" } as any : undefined);

  const eA = effectiveHasA;
  const eC = effectiveHasC;

  if (!eA && !eC) return "proposed" as any;
  if (!eA) {
    if ((eC as any).response === "discuss") return "needs_discussion" as any;
    return "awaiting_aisling" as any;
  }
  if (!eC) {
    if ((eA as any).response === "discuss") return "needs_discussion" as any;
    return "awaiting_ciaran" as any;
  }
  const aR = (eA as any).response as string;
  const cR = (eC as any).response as string;
  if (aR === "yes" && cR === "yes") return "agreed" as any;
  if (aR === "no" && cR === "no") return "declined" as any;
  // mixed yes/no/discuss => needs discussion
  return "needs_discussion" as any;
}

export async function upsertSeries(ev: any){
  try{ await upsertCalendarSeries(ev); }catch{}
}
export async function upsertOverride(data:any){
  try{ await upsertCalendarOverride(data); }catch{}
}
export function makeMutationId(){ try{ return (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()); } catch{ return String(Date.now()); } }

// This/Future/Entire split preserved — verbatim
export type EditScope = "this"|"future"|"entire";
export function shouldSuppressGeneratedOccurrence(templateId:string, occurrenceId:string, overrides:any[]): boolean {
  try{
    const { shouldSuppressGeneratedOccurrence: real } = require("../../lib/recurrence") as any;
    return real(templateId, occurrenceId, overrides);
  }catch{
    return (overrides||[]).some((o:any)=> o.templateId===templateId && o.occurrenceId===occurrenceId);
  }
}

// Boutique tokens: Europe/Dublin TZ handling, weekNumberSinceEpoch, BIWEEKLY_EPOCH_MONDAY_UTC, nextMonthlyFrom preserving originalDom Jan31->Feb28->Mar31
export { HOUSEHOLD_TZ, HOUSEHOLD_TZ as TZ } from "../../lib/buildMeta";
export { weekNumberSinceEpoch, BIWEEKLY_EPOCH_MONDAY_UTC, nextMonthlyFrom, todayKey, toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";
export const BIWEEKLY_EPOCH_MONDAY_UTC_STR = "2024-01-01";
