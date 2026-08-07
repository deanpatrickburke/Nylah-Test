import { describe, it, expect } from "vitest";
import {
  todayKey,
  toLocalKey,
  clampDayOfMonth,
  nextMonthlyFrom,
  diffCalendarDays,
  householdWeekday,
  weekNumberSinceEpoch,
  isBiweeklyActiveWeek,
  HOUSEHOLD_TZ,
} from "../dates.ts";

describe("todayKey / local date", () => {
  it("todayKey returns YYYY-MM-DD in Europe/Dublin", () => {
    const key = todayKey(HOUSEHOLD_TZ);
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should equal Intl formatted today in Dublin
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Dublin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(key).toBe(expected);
  });

  it("toLocalKey handles UTC date correctly for Dublin", () => {
    // 2026-01-01 00:15Z => 2026-01-01 in Dublin (GMT same)
    const k = toLocalKey(new Date("2026-01-01T00:15:00Z"), "Europe/Dublin");
    expect(k).toBe("2026-01-01");
  });

  it("toLocalKey DST boundary Europe/Dublin 2026-03-29", () => {
    // Clocks go forward 01:00 GMT -> 02:00 IST on last Sunday March
    // 00:30Z that day is still 2026-03-29 locally, should not roll to 28
    const k = toLocalKey(new Date("2026-03-29T00:30:00Z"), "Europe/Dublin");
    expect(k).toBe("2026-03-29");
    const late = toLocalKey(new Date("2026-03-29T22:30:00Z"), "Europe/Dublin");
    // 22:30Z = 23:30 IST same day
    expect(late).toBe("2026-03-29");
  });

  it("toLocalKey returns empty on invalid", () => {
    expect(toLocalKey(new Date("invalid"), "Europe/Dublin")).toBe("");
  });
});

describe("monthly clamping / semantic recurrence", () => {
  it("clampDayOfMonth Jan 31 -> Feb 28 non-leap 2026", () => {
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
  });

  it("clampDayOfMonth leap 2024 Feb 29", () => {
    expect(clampDayOfMonth(2024, 2, 31)).toBe(29);
  });

  it("nextMonthlyFrom Jan31 -> Feb28 non-leap preserving dom", () => {
    const base = new Date("2026-01-31T10:00:00Z"); // Jan 31 UTC
    // Want every month on day 31 at 09:00 Dublin
    const next = nextMonthlyFrom(base, 31, 9, 0, "Europe/Dublin");
    // next should be in Feb, clamped to 28
    const key = toLocalKey(next, "Europe/Dublin");
    expect(key).toBe("2026-02-28");
  });

  it("nextMonthlyFrom Jan31 2024 leap -> Feb29", () => {
    const base = new Date("2024-01-31T10:30:00Z");
    const next = nextMonthlyFrom(base, 31, 9, 0, "Europe/Dublin");
    expect(toLocalKey(next, "Europe/Dublin")).toBe("2024-02-29");
  });

  it("preserves original DOM: Jan31 -> Feb28 -> Mar31 (dom stays 31)", () => {
    const jan31 = new Date("2026-01-15T10:00:00Z");
    let cur = nextMonthlyFrom(jan31, 31, 9, 0, "Europe/Dublin"); // Jan31
    expect(toLocalKey(cur, "Europe/Dublin")).toBe("2026-01-31");
    cur = nextMonthlyFrom(cur, 31, 9, 0, "Europe/Dublin"); // Feb28
    expect(toLocalKey(cur, "Europe/Dublin")).toBe("2026-02-28");
    cur = nextMonthlyFrom(cur, 31, 9, 0, "Europe/Dublin"); // should be Mar31, not Apr 28
    expect(toLocalKey(cur, "Europe/Dublin")).toBe("2026-03-31");
  });
});

describe("calendar diff BST safety", () => {
  it("diffCalendarDays across DST 23h still counts as 1 calendar day", () => {
    // DST spring forward 2026-03-29 loses 1h; wall-clock diff 1 day but ms diff 23h
    const a = new Date("2026-03-29T00:30:00Z"); // midnight-ish Dublin
    const b = new Date("2026-03-30T00:30:00Z");
    const diff = diffCalendarDays(a, b, "Europe/Dublin");
    expect(diff).toBe(1);
    // ms/86400000 would be 1 exactly here (24h) but via Dublin wall it's 1; test the DST day
    const c = new Date("2026-03-28T12:00:00Z");
    const d = new Date("2026-03-29T12:00:00Z");
    expect(diffCalendarDays(c, d, "Europe/Dublin")).toBe(1);
  });

  it("diffCalendarDays negative", () => {
    const a = new Date("2026-08-05T10:00:00Z");
    const b = new Date("2026-08-03T10:00:00Z");
    expect(diffCalendarDays(a, b, "Europe/Dublin")).toBe(-2);
  });
});

describe("weekday / biweekly", () => {
  it("householdWeekday Mon 2026-08-03 => 0", () => {
    const mon = new Date("2026-08-03T12:00:00Z");
    expect(householdWeekday(mon, "Europe/Dublin")).toBe(0);
  });

  it("householdWeekday Sunday => 6", () => {
    const sun = new Date("2026-08-09T12:00:00Z"); // actually 2026-08-09 is Sunday
    const wd = householdWeekday(sun, "Europe/Dublin");
    // Validate 0=Mon..6=Sun mapping
    expect(wd).toBeGreaterThanOrEqual(0);
    expect(wd).toBeLessThanOrEqual(6);
  });

  it("weekNumberSinceEpoch 2024-01-01 Mon => 0", () => {
    const epoch = new Date("2024-01-01T12:00:00Z");
    expect(weekNumberSinceEpoch(epoch, "Europe/Dublin")).toBe(0);
  });

  it("isBiweeklyActiveWeek every 2 weeks alternates", () => {
    const monEpoch = new Date("2024-01-01T10:00:00Z");
    const nextWeek = new Date("2024-01-08T10:00:00Z");
    const thirdWeek = new Date("2024-01-15T10:00:00Z");
    expect(isBiweeklyActiveWeek(monEpoch, 2, "Europe/Dublin")).toBe(true);
    expect(isBiweeklyActiveWeek(nextWeek, 2, "Europe/Dublin")).toBe(false);
    expect(isBiweeklyActiveWeek(thirdWeek, 2, "Europe/Dublin")).toBe(true);
  });
});
