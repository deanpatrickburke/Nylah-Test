/**
 * Nylah OS — Calendar Recurrence Fixed
 * Fixes:
 * - Weekly generation tied to original weekday only -> now uses ALL selected weekdays (frequencyDetail)
 * - Device TZ usage -> now Europe/Dublin via tzWallToUtc + HOUSEHOLD_TZ
 * - This-only / This-and-future duplication -> overrides + series split with recurrenceUntil
 * - Biweekly parity Dublin-aware
 * - Multi-weekday weekly/biweekly supported
 */

import {
HOUSEHOLD_TZ,
tzWallToUtc,
toLocalKey,
nextMonthlyFrom,
weekNumberSinceEpoch,
} from "./dates";

// Reuse existing parse but ensure robust
export function parseFrequencyDetailToJsDays(detail?: string): number[] {
  if (!detail) return [];
  const tokens = detail.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    if (["mo","mon","monday"].includes(t)) out.push(1);
    else if (["tu","tue","tues","tuesday"].includes(t)) out.push(2);
    else if (["we","wed","wednesday"].includes(t)) out.push(3);
    else if (["th","thu","thur","thurs","thursday"].includes(t)) out.push(4);
    else if (["fr","fri","friday"].includes(t)) out.push(5);
    else if (["sa","sat","saturday"].includes(t)) out.push(6);
    else if (["su","sun","sunday"].includes(t)) out.push(0);
  }
  return [...new Set(out)];
}

export function getDublinHourMinuteFromIso(iso: string, tz: string = HOUSEHOLD_TZ): { h: number; m: number } {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = fmt.formatToParts(d);
    const hh = Number(parts.find(p=>p.type==="hour")?.value || "9");
    const mm = Number(parts.find(p=>p.type==="minute")?.value || "0");
    return { h: hh, m: mm };
  } catch { return { h: 9, m: 0 } }
}

export function getJsWeekdayForDublinWallInstant(instant: Date, tz: string = HOUSEHOLD_TZ): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
    const wd = fmt.format(instant); // Mon, Tue...
    const map: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    return map[wd] ?? instant.getDay();
  } catch { return instant.getDay(); }
}

export function getJsWeekdayForWallDate(y: number, m0: number, d: number): number {
  // calendar date weekday is same in any tz; UTC midnight's weekday = wall weekday
  return new Date(Date.UTC(y, m0, d)).getUTCDay();
}

export function addDaysKey(baseKey: string, delta: number): string {
  try {
    const [y,m,d] = baseKey.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m-1, d));
    dt.setUTCDate(dt.getUTCDate() + delta);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth()+1).padStart(2,"0");
    const dd = String(dt.getUTCDate()).padStart(2,"0");
    return `${yy}-${mm}-${dd}`;
  } catch { return baseKey; }
}

export function getDublinWallParts(instant: Date, tz: string = HOUSEHOLD_TZ): { y: number; m: number; d: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const str = fmt.format(instant); // YYYY-MM-DD
    const [y,m,d] = str.split("-").map(Number);
    return { y, m, d };
  } catch { return { y: instant.getFullYear(), m: instant.getMonth()+1, d: instant.getDate() } }
}

type CalendarTemplate = {
  id: string;
  frequency?: string;
  frequencyDetail?: string;
  dueAt?: string;
  start?: string;
  endAt?: string;
  end?: string;
  dayOfMonth?: number;
  originalDom?: number;
  recurrenceUntil?: string;
  isTemplate?: boolean;
  type?: string;
  [k: string]: any;
};

export function expandTemplateForMonthDublin(
  template: CalendarTemplate,
  y: number,
  m0: number,
  tz: string = HOUSEHOLD_TZ,
): any[] {
  const freq = (template.frequency as string) || "once";
  if (freq === "once") return [];
  if (!template.isTemplate && template.type !== "repeat" && freq === "once") return [];

  // recurrenceUntil: if month starts after until, skip
  const untilRaw = (template as any).recurrenceUntil || (template as any).recurrence_until;
  let untilKey: string | null = null;
  if (untilRaw) {
    try {
      const u = typeof untilRaw === "string" && untilRaw.length===10 ? untilRaw : toLocalKey(new Date(untilRaw), tz);
      if (u) untilKey = u;
    } catch { untilKey = null; }
  }

  const baseIso = template.dueAt || template.start;
  if (!baseIso) return [];
  const base = new Date(baseIso);
  if (isNaN(base.getTime())) return [];

  const { h: baseHour, m: baseMin } = getDublinHourMinuteFromIso(baseIso, tz);

  // days in month (month length doesn't vary by tz)
  const daysInMonth = new Date(y, m0+1, 0).getDate();

  // early exit if whole month after until
  if (untilKey) {
    const firstKey = `${y}-${String(m0+1).padStart(2,"0")}-01`;
    if (firstKey > untilKey) return [];
  }

  const occs: any[] = [];

  if (freq === "monthly") {
    const dom = (template as any).originalDom ?? template.dayOfMonth ?? getDublinWallParts(base, tz).d ?? base.getDate();
    let cand = nextMonthlyFrom(new Date(Date.UTC(y, m0, 1) - 1000), dom, baseHour, baseMin, tz);
    let guard = 0;
    const monthStartIso = toLocalKey(new Date(Date.UTC(y, m0, 1)), tz);
    const monthEndKey = `${y}-${String(m0+1).padStart(2,"0")}-${String(daysInMonth).padStart(2,"0")}`;

    while (cand && guard < 4) {
      const key = toLocalKey(cand, tz);
      if (!key) break;
      if (untilKey && key > untilKey) break;
      if (key < monthStartIso) {
        cand = nextMonthlyFrom(new Date(cand.getTime() + 1000), dom, baseHour, baseMin, tz);
        guard++;
        continue;
      }
      if (key > monthEndKey) break;
      occs.push({
        ...template,
        id: template.id + "#" + key,
        templateId: template.id,
        occurrenceId: key,
        dueAt: cand.toISOString(),
        start: cand.toISOString(),
        end: template.endAt ? new Date(cand.getTime() + (new Date(template.endAt).getTime() - base.getTime())).toISOString() : template.end ? new Date(cand.getTime() + (new Date(template.end).getTime() - base.getTime())).toISOString() : undefined,
        isTemplate: false,
        isOverride: false,
      });
      cand = nextMonthlyFrom(new Date(cand.getTime() + 1000), dom, baseHour, baseMin, tz);
      guard++;
      if (occs.length >= 3) break;
    }
    return occs;
  }

  if (freq === "daily" || freq === "weekly" || freq === "biweekly") {
    let allowedJsDays = parseFrequencyDetailToJsDays(template.frequencyDetail);
    if (allowedJsDays.length === 0) {
      // fallback to base weekday in Dublin
      const baseJs = getJsWeekdayForDublinWallInstant(base, tz);
      allowedJsDays = [baseJs];
    }

    const baseWeekNum = weekNumberSinceEpoch(base, tz);

    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `${y}-${String(m0+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      if (untilKey && dayKey > untilKey) continue; // truncate

      const jsDay = getJsWeekdayForWallDate(y, m0, d);

      if (freq === "daily") {
        const probe = tzWallToUtc(y, m0+1, d, baseHour, baseMin, 0, tz);
        occs.push({
          ...template,
          id: template.id + "#" + dayKey,
          templateId: template.id,
          occurrenceId: dayKey,
          dueAt: probe.toISOString(),
          start: probe.toISOString(),
          end: template.endAt ? new Date(probe.getTime() + (new Date(template.endAt).getTime() - base.getTime())).toISOString() : undefined,
          isTemplate: false,
          isOverride: false,
        });
        continue;
      }

      if (freq === "weekly") {
        if (!allowedJsDays.includes(jsDay)) continue;
        const probe = tzWallToUtc(y, m0+1, d, baseHour, baseMin, 0, tz);
        occs.push({
          ...template,
          id: template.id + "#" + dayKey,
          templateId: template.id,
          occurrenceId: dayKey,
          dueAt: probe.toISOString(),
          start: probe.toISOString(),
          end: template.endAt ? new Date(probe.getTime() + (new Date(template.endAt).getTime() - base.getTime())).toISOString() : undefined,
          isTemplate: false,
          isOverride: false,
        });
        continue;
      }

      if (freq === "biweekly") {
        if (!allowedJsDays.includes(jsDay)) continue;
        const probe = tzWallToUtc(y, m0+1, d, baseHour, baseMin, 0, tz);
        const curWeek = weekNumberSinceEpoch(probe, tz);
        const diff = curWeek - baseWeekNum;
        if (diff % 2 !== 0) continue;
        occs.push({
          ...template,
          id: template.id + "#" + dayKey,
          templateId: template.id,
          occurrenceId: dayKey,
          dueAt: probe.toISOString(),
          start: probe.toISOString(),
          end: template.endAt ? new Date(probe.getTime() + (new Date(template.endAt).getTime() - base.getTime())).toISOString() : undefined,
          isTemplate: false,
          isOverride: false,
        });
        continue;
      }
    }
    return occs;
  }

  return [];
}

export function shouldSuppressGeneratedOccurrence(
  templateId: string,
  occurrenceId: string,
  existingEvents: any[],
): boolean {
  return existingEvents.some((ev: any) =>
    ev.templateId === templateId &&
    ev.occurrenceId === occurrenceId &&
    (ev.isOverride || (ev.id !== templateId && !ev.isTemplate))
  );
}
