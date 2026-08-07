import { describe, it, expect } from "vitest";
import { expandTemplateForMonthDublin, parseFrequencyDetailToJsDays, addDaysKey } from "../recurrence";
import { HOUSEHOLD_TZ } from "../dates";

describe("parseFrequencyDetailToJsDays", () => {
  it("parses Mo,Tu,We", () => {
    expect(parseFrequencyDetailToJsDays("Mo,Tu,We")).toEqual([1,2,3]);
  });
  it("parses mixed case and dedup", () => {
    expect(parseFrequencyDetailToJsDays("Mo, mo, TU")).toEqual([1,2]);
  });
  it("handles Su", () => {
    expect(parseFrequencyDetailToJsDays("Su")).toEqual([0]);
  });
});

describe("expand weekly multi-weekday Dublin", () => {
  const tz = HOUSEHOLD_TZ;

  it("weekly with Tue/Thu generates only Tue/Thu not original Mon", () => {
    // template base is Monday 2026-08-03 10:00 Dublin, but frequencyDetail says Tue,Thu
    // So in August 2026, should generate Tue/Thu dates
    const template: any = {
      id: "tmpl1",
      frequency: "weekly",
      frequencyDetail: "Tu,Th",
      dueAt: new Date("2026-08-03T09:00:00Z").toISOString(), // 10:00 IST = 09:00 UTC in Aug (BST+1)
      isTemplate: true,
      type: "repeat",
    };
    const aug = expandTemplateForMonthDublin(template, 2026, 7, tz); // month 7 = Aug (0-index)
    const keys = aug.map((o: any) => o.occurrenceId);
    // all should be Tue or Thu
    // 2026-08-04 is Tue, 06 Thu, 11 Tue, 13 Thu...
    expect(keys).toContain("2026-08-04");
    expect(keys).toContain("2026-08-06");
    expect(keys).not.toContain("2026-08-03"); // Monday should NOT appear anymore (bug fix)
    // count Tue/Thu in Aug 2026: 4 Tuesdays + 4 Thursdays? Let's just check length >3 and no Mondays
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const k of keys) {
      const d = new Date(k);
      const js = d.getUTCDay(); // since key is wall date, UTC weekday matches wall
      // Tue=2 Thu=4
      expect([2,4]).toContain(js);
    }
  });

  it("weekly fallback to base weekday when no detail", () => {
    const template: any = {
      id: "tmpl2",
      frequency: "weekly",
      dueAt: new Date("2026-08-03T09:00:00Z").toISOString(),
      isTemplate: true,
      type: "repeat",
    };
    const aug = expandTemplateForMonthDublin(template, 2026, 7, tz);
    const keys = aug.map((o:any)=>o.occurrenceId);
    // should be all Mondays in Aug 2026: 3,10,17,24,31
    expect(keys).toEqual(["2026-08-03","2026-08-10","2026-08-17","2026-08-24","2026-08-31"]);
  });
});

describe("expand daily Dublin TZ", () => {
  it("daily generates all days in month with Dublin time", () => {
    const template: any = {
      id: "daily1",
      frequency: "daily",
      dueAt: new Date("2026-02-01T09:00:00Z").toISOString(),
      isTemplate: true,
      type: "repeat",
    };
    const feb = expandTemplateForMonthDublin(template, 2026, 1, HOUSEHOLD_TZ); // Feb 2026 non-leap 28 days
    expect(feb.length).toBe(28);
    expect(feb[0].occurrenceId).toBe("2026-02-01");
  });
});

describe("expand monthly semantics Dublin", () => {
  it("monthly Jan31 -> Feb28 -> preserves wall time DST", () => {
    const template: any = {
      id: "m1",
      frequency: "monthly",
      dueAt: "2026-01-31T10:00:00Z", // wall 10:00 GMT Jan 31
      originalDom: 31,
      isTemplate: true,
      type: "repeat",
    };
    const feb = expandTemplateForMonthDublin(template, 2026, 1, HOUSEHOLD_TZ);
    expect(feb.length).toBe(1);
    expect(feb[0].occurrenceId).toBe("2026-02-28");
    // March should be 31 again
    const mar = expandTemplateForMonthDublin(template, 2026, 2, HOUSEHOLD_TZ);
    expect(mar[0].occurrenceId).toBe("2026-03-31");
  });

  it("respects recurrenceUntil truncation", () => {
    const template: any = {
      id: "m2",
      frequency: "daily",
      dueAt: "2026-08-01T09:00:00Z",
      recurrenceUntil: "2026-08-05",
      isTemplate: true,
      type: "repeat",
    };
    const aug = expandTemplateForMonthDublin(template, 2026, 7, HOUSEHOLD_TZ);
    expect(aug.length).toBe(5);
    expect(aug[aug.length-1].occurrenceId).toBe("2026-08-05");
  });
});

describe("DST Dublin edge", () => {
  it("BST vs GMT preserves 09:00 wall time across DST jump", () => {
    // DST 2026-03-29 clocks forward. A weekly Monday at 09:00 Dublin should stay 09:00 wall, not drift to 08:00 UTC
    const template: any = {
      id: "dst1",
      frequency: "weekly",
      dueAt: "2026-03-23T09:00:00Z", // Monday before DST, 09:00 GMT = 09:00Z
      isTemplate: true,
      type: "repeat",
    };
    const mar = expandTemplateForMonthDublin(template, 2026, 2, HOUSEHOLD_TZ); // March
    const apr = expandTemplateForMonthDublin(template, 2026, 3, HOUSEHOLD_TZ); // April
    const mon30Mar = mar.find((o:any)=>o.occurrenceId==="2026-03-30");
    // 2026-03-30 is Monday after DST, 09:00 IST = 08:00 UTC
    expect(mon30Mar).toBeDefined();
    const iso = mon30Mar.dueAt;
    // Verify wall time in Dublin is still 09:00
    const wallHour = new Intl.DateTimeFormat("en-GB", { timeZone: HOUSEHOLD_TZ, hour: "2-digit", hour12:false }).format(new Date(iso));
    expect(wallHour).toBe("09");
  });
});

describe("biweekly multi-weekday parity", () => {
  it("biweekly Tue/Thu respects parity and weekdays", () => {
    const template: any = {
      id: "bi1",
      frequency: "biweekly",
      frequencyDetail: "Tu,Th",
      dueAt: "2026-08-04T09:00:00Z", // Tue Aug 4 2026 is actually Tue? 2026-08-04 is Tue
      isTemplate: true,
      type: "repeat",
    };
    const aug = expandTemplateForMonthDublin(template, 2026, 7, HOUSEHOLD_TZ);
    const keys = aug.map((o:any)=>o.occurrenceId);
    // Should include first week Tue/Thu, skip next week, include third week
    expect(keys).toContain("2026-08-04");
    expect(keys).toContain("2026-08-06");
    expect(keys).not.toContain("2026-08-11"); // next Tue biweekly should skip
    expect(keys).not.toContain("2026-08-13");
    expect(keys).toContain("2026-08-18");
  });
});

describe("addDaysKey", () => {
  it("adds negative days for split series", () => {
    expect(addDaysKey("2026-08-10", -1)).toBe("2026-08-09");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28"); // 2026 non-leap
  });
});
