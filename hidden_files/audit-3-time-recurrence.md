# Agent 3 — Time and Recurrence Audit — Nylah OS

**Date:** 2026-08-03  
**File audited:** `~/workspace/ts-spaces/couple-fridge-phone/client/src/App.tsx` (~2947 lines, pre-Beta)  
**Scope:** Chores, Calendar, Shopping, Dashboard (FridgePage), Notifications (bonus / percentLeft)

---

## 1. Inventory — Where Time Lives

| Location | What | Lines (grep) |
|----------|------|--------------|
| `windowHoursForChore` | Maps frequency → hours | L220-232 |
| `getDueMsChore` | dueAt || createdAt+window | L233-234 |
| `percentLeftChore` / `isBonusChore` | Urgency + bonus detection | L235-241, 956, 1036 |
| `computeNextOccurrenceForDailyOrTwice` | Calendar repeat next-occurrence | L304-354 |
| `computeNextDueFromWeekdays` | Weekday + biweekly parity | L363-398 |
| `computeNextDueDateChore` | Chore next occurrence | L400-446 |
| `freqToHours` | Shopping frequency → hours | L450-459 |
| `computeShoppingNextDue` | Shopping next due | L460-503 |
| `getDueMsCal` / `percentLeftCal` / `isBonusCal` | Calendar urgency | L526-548 |
| `toLocalKey` / `isEventOnDate` | Calendar grouping | L1326-1364 |
| `FridgePage` `todayDateStr`, `weekday`, `dayNum` | Home today | L784-786, 791-794 |
| `dueDayLabel`, `shoppingDueLabel`, `relTime`, `timeLeftLabel` | User-facing labels | L1177-1184, 511-520, 156-162, 1045 |
| CalendarEventV2 type | `dayOfMonth? localTime? timezone?` optional | L184 |
| Shopping expiry fake | `Pantry` age >5d | L804, 899 |

**Storage model found:** All dates stored as ISO strings (`dueAt`, `createdAt`, `lastDoneAt`, `start`, `end`) — UTC instants via `toISOString()`. No IANA tz persisted unless user manually fills optional `timezone`/`localTime` (never set by UI). Interpretation is *mixed*: sometimes UTC slice `slice(0,10)`, sometimes local `getFullYear()/getMonth()/getDate()`, sometimes `toLocaleDateString(undefined)`.

---

## 2. Critical Bugs — Monthly = 720h Drift

### 2a. Chores — `windowHoursForChore` L226-227
```js
if (c.frequency === "monthly") return 720;
```
720h = 30d fixed. Real months are 28-31d. Over 12 months drifts up to 6 days.

**Fail scenario — Different months:**
- Chore created Jan 31 09:00. Next = Mar 2 (720h) not Feb 28, then Apr 1, never lands on 31st again.
- Late Feb (28d) chore then March expectation off by 2 days.

### 2b. Shopping — `freqToHours` L455-L456 same
```js
case "monthly": return 720; // ~30d
```
Shopping monthly restock drifts identical to chores. User buying on 15th monthly will see 14th, 13th over time.

### 2c. Chores creation L1160
```js
freq==="monthly"?30:7
```
`setDate(getDate()+30)` for monthly template — same non-semantic drift.

---

## 3. Weekday Recurrence — DST & Parity Bugs

### `computeNextDueFromWeekdays` L363-398
- **Anchor unstable for biweekly:** `startWeekNum` computed from `from` date’s Monday, not stable epoch. Parity then ` (candWeekNum - startWeekNum) % intervalWeeks` means creating same biweekly rule on different days yields different future dates.
- **Epoch mismatch:** `weekNumberSinceEpoch` uses `Date.UTC(2024,0,1)` (UTC) but anchor uses local midnight `setHours(0,0,0,0)`. Across BST/GMT transition (Europe/Dublin last Sun Mar / Oct), UTC vs local diverges 1h → week number off-by-1.
- **Hour/Minute from `from`:** `from.getHours()` local; if `from` is in BST (UTC+1) and candidate falls in GMT (UTC+0), 09:00 BST stored as 09:00 local becomes 09:00 GMT = 1h earlier real instant.
- **Search window 42 days:** Allows 6 weeks — skips biweekly occurrence that would land week 7.

**Fail scenario — DST:**
- Chore “Tue, Fri” created Oct 25 2025 (before Oct 26 clock-back in Dublin). Next occurrence calculated after fallback shifts 09:00 local to 08:00 UTC underlying — percentLeft calculation `getTime()` changes 1h causing bonus at wrong hour.

**Fail scenario — Biweekly skipped:**
- User creates biweekly Tue/Fri on Wed Oct 8. Anchor = Mon Oct 6 weekNum 91. Candidate Tue Oct 14 weekNum 92 — `(92-91)%2 =1` → skipped, Fri Oct 17 also skipped, returns Mon Oct 20? Actually loop offset continues; picks Tue Oct 21 weekNum 93 → `(93-91)%2=0` OK → first occurrence 13d later not 1-3d.

### `nextDateMatchingWeekdays` L282-300
- Searches 14 days, uses `cand.setDate(start.getDate()+offset)` + `setHours(hour,minute)` — hour from base `dueAt` local, but if DST transition inside 14d, `setHours` after date-add may keep wall-clock constant (good) but comparison `cand.getTime() < from.getTime()` uses UTC so may reject correct day inside DST gap.

---

## 4. Monthly Semantic — Broken Implementation

### Calendar `computeNextOccurrenceForDailyOrTwice` L332-349
```js
const dom = ev.dayOfMonth ?? base.getDate();
const tz = ev.timezone || "Europe/Dublin";
// ...
let next = new Date(Date.UTC(cand.getFullYear(), cand.getMonth(), 1, hour, minute, 0));
next.setMonth(next.getMonth() + monthsAdd);
```
- `tz` variable declared then never used — comment says “for simplicity use local BST = Europe/London = Dublin same offset (DST handled by JS local)” — **false**: Dublin & London differ in historical offsets, JS local may not be Europe/Dublin (user could be in US visiting — `undefined` locale).
- Constructs via `Date.UTC` then `setMonth` (local method!) mixing UTC/local. `Date.UTC(y,m,1,h,m)` assumes h/m UTC but then `setMonth` mutates local fields of UTC-time-initialized Date — results in 1h drift at BST.
- No clamping loop for Feb 31 correctly? Does clamp via `daysInMonth` but only once, if today is Jan 31 → Feb 28, next from Feb 28 should still try Mar 31 (dom 31), code returns Mar 28 because `dom` preserved but `cand` already moved.

**Fail scenarios:**
- **Leap year:** Event `Feb 29` monthly (`dayOfMonth=29`). `new Date(y,m+1,0).getDate()` → Feb 2024 =29 OK, 2025 =28 clamped to 28. Next year 2028 should be 29 again but code after clamping to 28 keeps 28 forever (doesn’t re-read dom each month).
- **Month boundary:** Event Jan 31 monthly. Feb 2027 (28d) clamps to Feb 28. Mar should be Mar 31 per spec “Every month on day 31” → currently returns Mar 28 because base is Feb 28.
- **DST:** Event `09:00 Europe/Dublin` daily across Oct 26 2025 clock-back. `base.getHours()=9` local BST = 08:00 UTC, after transition candidate 09:00 GMT = 09:00 UTC = 1h later UTC instant; users see 1h shift.

### Chore monthly `computeNextDueDateChore` L423-442
Better: uses local `setMonth`, clamps via `daysInMonth`, while loop to advance until > fromPlus (handles DST). Still:
- Uses local timezone not explicit Europe/Dublin.
- Doesn’t store `dayOfMonth` always — fallback `base.getDate()` after DST may be 30 not original 31.
- No timezone field written.

---

## 5. UTC Slice vs Local Date — Wrong Today

### FridgePage L786
```js
const todayDateStr = new Date().toISOString().slice(0,10);
const weekday = new Date().toLocaleDateString(undefined,{weekday:"long"});
const dayNum = String(new Date().getDate()).padStart(2,"0");
```
- `todayDateStr` UTC. At 00:30 IST / Europe/Dublin (UTC+1) on Aug 3 local, `toISOString().slice(0,10)` = previous day Aug 2. `nextCalToday` filtered by `ev.dueAt.slice(0,10)===todayDateStr` L791/794 → misses today's real Dublin events.
- `weekday` and `dayNum` use local/undefined locale → mismatch: weekday says Sunday Aug 3, todayDateStr says 2026-08-02.

**Fail scenario:** Around midnight Dublin (00:00-00:59 BST) fridge shows “No events today” even though calendar has events for that Dublin date. Same at 23:30 GMT winter.

### Calendar `toLocalKey` L1326-1330
```js
return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
```
Local key — correct approach for grouping — but `selectedEvents` L1408 uses `isEventOnDate` which uses `new Date(dateStr+"T12:00:00").getTime()` — parses as local without TZ offset, DST edge 12:00 may be ambiguous but OK. Inconsistent with `nextCalToday` UTC slice.

### `getDueMsChore` vs day filter
`getDueMsChore` uses UTC instant `getTime()`, but ChoresPage `matchFor` L998-1012 uses `new Date(c.dueAt).toDateString()` === local date string — compares UTC instant interpreted locally (good) but dayFilter counts use `chores.filter(... matchFor)` which uses local `toDateString` while Fridge uses UTC slice — counts differ.

---

## 6. `dueDayLabel` / `timeLeftLabel` DST Math

### L1177-1184
```js
const diffDays = Math.round((new Date(year,month,date).getTime() - nowMidnight)/86400000);
```
Uses `Math.round(.../86400000)`. On DST start (23h day) diff 47h /24 =1.958 → round 2 not 2d correct but near DST boundary round may push Tomorrow to Today. Should use calendar-day diff via `getFullYear/month/date` equality, not ms division.

### `percentLeftChore` L235-237
```js
const created = new Date(c.createdAt).getTime();
const start = c.dueAt ? due - win*3600000 : created;
```
`win` is hours (24,168…). If chore created Feb 28 BST->later due spans BST/GMT transition (25h/23h day), `win*3600000` assumes 1h=3600000 fixed, but real wall-clock window 24h across DST is 23h or 25h UTC. `percentLeft` then slightly wrong (4% error on DST day) causing bonus at wrong time.

---

## 7. Shopping “Expiry” Fake + Recurrence

- L804: `shoppingExpiry = shopping.filter(... (cat==="Pantry"||"Food") && (Date.now()-created)/86400000>5)` — 5d age on list labeled “near expiry” later `shoppingLeftover` UI `shoppingExpiry ? " • "+shoppingExpiry+" near expiry"` L899. Violates spec: age on list ≠ food expiry.
- `computeShoppingNextDue` L484-502: For past-due items advances by `steps*h` (hours). For monthly 720h = drifts as above. For weekly/biweekly with `needDays`, reference uses `baseRef=lastDoneAt||createdAt` but display uses `ref = baseRef>now?baseRef:now` +10min — if `lastDoneAt` 2 weeks ago, next due may be tomorrow even though weekly occurrence was missed last week (skipped occurrences never surface).
- `shoppingDueLabel` L512-520: overdue label computed from fixed hours, not calendar.

---

## 8. Multi-day Events — Incomplete

- `isEventOnDate` L1336-1356: handles multi-day spanning month boundaries via `sKey <= dateStr <= eKey` inclusive plus fallback ms overlap using `new Date(dateStr+"T12:00:00")`. T12:00:00 local parsing breaks if user timezone != Dublin — e.g., US Eastern 12:00 local is 17:00 Dublin, multi-day inclusive logic still works but time display wrong.
- `isValidMultiDay` L1358-1372 always returns false after check (`return false` twice) — dead code.
- `byDay` map L1399-1428 enumerates each day in month and calls `isEventOnDate` per day per event — O(days*events) OK but uses `sKey < y+"-01-01"` weird year-only guard L1426.
- No handling of `endAt` vs `end` inconsistency: Calendar V2 uses `endAt` in `percentLeftCal` but `byDay` uses `ev.end` field (original structure mismatch). Some events use `end` some `endAt`.

---

## 9. Europe/Dublin Timezone — Absent

Evidence:
- No `Intl.DateTimeFormat({... timeZone:"Europe/Dublin"})` usage.
- No `temporal` polyfill.
- `timezone` field declared L184 but only read L336, never written by UI (AddEventForm unknown).
- All `new Date(iso).getTime()` correct for UTC instant comparison, but day grouping inconsistent.
- Supabase stores ISO, good, but no semantic recurrence rule.

Consequence: Couple in Dublin, but if one member travels to New York (EST, UTC-5), `toLocaleDateString(undefined)` shifts day boundaries leading to different “Today for you”. Household truth should be Europe/Dublin fixed.

---

## 10. Leap Year / Month Boundary / Skipped Occurrence Matrix

| Test | Expected | Actual | Pass? |
|------|----------|--------|-------|
| **Different months** Chore weekly Mo created Jan 31 → Feb 3 should stay Mo | stays Mo | `computeNextDueFromWeekdays` OK for weekly | ✅ |
| **Month boundary** Calendar monthly Jan 31 → Feb 28 → Mar 31 | Mar 31 per spec | Returns Mar 28 (clamped stays clamped) L334-L349 | ❌ |
| **Leap year** Feb 29 2024 monthly → Feb 28 2025 → Feb 29 2028 | 2028 =29 | Stays 28 forever after first clamp | ❌ |
| **DST spring 30 Mar 2025 Dublin 01:00→02:00** Daily 09:00 chores percentLeft | Wall 09:00 still 09:00 | `getTime()` diff 23h → percentLeft 4% off at transition day | ❌ |
| **DST autumn 26 Oct 2025 02:00→01:00** Daily | 09:00 | Double 09:00 hour ambiguous — `new Date` picks first instance | ❌ partial |
| **Europe/Dublin vs UTC** 00:15 Aug 3 BST (23:15 UTC Aug 2) fridge | Should show Aug 3 events | Shows Aug 2 events because `toISOString().slice(0,10)` UTC | ❌ |
| **Recurring weekday biweekly** Tue/Fri biweekly across 3 months | Every other week Tue/Fri | Parity drifts when `from` day changes; may skip week | ❌ |
| **Monthly 720h vs semantic** Monthly on 12th 09:00 Europe/Dublin | Explicit “Every month on day 12 @09:00 Europe/Dublin” | 720h = Jan12 09:00 → Feb11 09:00 | ❌ |
| **Late completion** Chore daily completed 2 days late, next? | Next should be tomorrow fixed, not after completion+24h (per spec decide) | `computeNextDueDateChore` uses `from=now` +window → after completion drift, shifts recurrence | ❌ drift unless spec is “after completion” |
| **Skipped occurrences** Weekly Mo skipped 2 weeks (sick) | Should still show Mo upcoming, not skip | `computeShoppingNextDue` advances by multiples until future → OK, but chore `computeNextDueDateChore` returns now+window only, not missed count | ⚠️ chores partial |
| **Multi-day** Event Jan 30 - Feb 2 | Should appear in both months | `byDay` rebuilds month grid each viewMonth, but only loops `daysInM` days of current month — span across year Dec 31 - Jan 2 fails if Jan view: sKey Dec, eKey Jan → `isEventOnDate` inclusive true, so shows — OK but `isValidMultiDay` dead | ⚠️ partial |

---

## 11. Recommendation — One Date Engine Europe/Dublin

Create `~/workspace/ts-spaces/couple-fridge-phone/client/src/lib/dates.ts`

**Requirements from spec §7:**

```
Store:
- UTC instants for real moments (dueAt, createdAt, completedAt)
- IANA timezone where local interpretation matters (household_tz)
- Semantic recurrence rules rather than hour counts

Use Europe/Dublin as household timezone unless household changes it.

Don’t represent monthly as 720h. Monthly must mean:
- Every month on day 12 at 09:00 Europe/Dublin
OR
- First Monday of every month at 09:00 Europe/Dublin
Use proven recurrence library and proven date library.

Do not use new Date().toISOString().slice(0,10) for today.
```

**Proposed API:**

```ts
// lib/dates.ts
import { Temporal } from "@js-temporal/polyfill" // or date-fns-tz
// OR use luxon: DateTime with zone Europe/Dublin

export const HOUSEHOLD_TZ = "Europe/Dublin";

export type RecurrenceRule =
  | { kind: "once" }
  | { kind: "daily"; time: string; tz: string } // "09:00"
  | { kind: "weekly"; weekdays: number[]; time: string; tz: string; intervalWeeks?: number }
  | { kind: "monthly"; dayOfMonth: number; time: string; tz: string } // explicit
  | { kind: "monthlyWeekday"; nth: number; weekday: number; time: string; tz: string } // first Monday

// Store semantic, compute next occurrence in tz
export function nextOccurrence(rule: RecurrenceRule, from: Temporal.Instant): Temporal.ZonedDateTime
export function toLocalKey(instant: Temporal.Instant, tz?: string): string // YYYY-MM-DD Europe/Dublin
export function todayKey(tz?: string): string // correct Dublin today
export function formatDueLabel(instant, now, tz): string
export function daysBetweenCalendars(a: string, b: string): number // calendar days not ms/86400000
export function clampDayOfMonth(year:number, month:number, dom:number): number // Feb 28/29 handling
```

**Implementation constraints:**

1. **Drop `freqToHours` / `windowHoursForChore` monthly/weekly mapping** — keep for urgency window (hours) but not recurrence. Separate `completionWindowHours` (how long open) vs `recurrenceRule`.

2. **Persist recurrence as object, not hours:**
   ```json
   template: { id, title, effort, recurrence: { kind:"monthly", dayOfMonth:12, time:"09:00", tz:"Europe/Dublin" }, windowHours:24 }
   occurrence: { templateId, scheduledLocalDate:"2026-08-12", dueAt:"2026-08-12T08:00:00Z" } // UTC instant derived from Europe/Dublin 09:00
   unique constraint templateId+scheduledLocalDate
   ```

3. **Fridge fix** — replace:
   ```js
   const todayDateStr = new Date().toISOString().slice(0,10)
   ```
   with:
   ```js
   import { todayKey } from "./lib/dates"
   const todayDateStr = todayKey("Europe/Dublin")
   ```

   And calendar grouping `toLocalKey` → `toLocalKey(instant,"Europe/Dublin")`.

4. **DST safe:** Use `Temporal.ZonedDateTime` or `luxon DateTime.fromISO(...,{zone})` so BST (UTC+1) → GMT (UTC+0) 09:00 stays 09:00 wall.

5. **dueDayLabel fix:** Don’t use `Math.round(ms/86400000)`. Use calendar diff:
   ```ts
   function diffCalendarDays(a: ZonedDateTime, b: ZonedDateTime) { return b.dayOfYear - a.dayOfYear ... handling year }
   // or Temporal: a.until(b).days
   ```

6. **Shopping expiry removal:** Delete `shoppingExpiry` logic L804/L899, replace with honest “On list for X days” only.

7. **Notifications:** Bonus/urgency calculation should use timezone-aware `percentLeft` only for UI; points should not depend on ms; use wall-clock.

8. **Testing hooks:** Export pure functions for unit tests:
   - `nextMonthly(dublinDate, dom, time)` → leap-year tests
   - `nextWeekday(from, weekdays, interval)` → DST tests with `Europe/Dublin` winter/summer instants
   - `todayKey` mocked with fake now

**Migration:**

- Add `recurrenceRule` JSON to chore_templates / shopping_templates, backfill from existing `frequency`/`frequencyDetail`:
  - `frequency=weekly Mo,We,Fr` → `{kind:"weekly", weekdays:[1,3,5], time:"09:00", tz:"Europe/Dublin"}`
  - `monthly` with no dom → use `dayOfMonth = new Date(dueAt).toLocaleDateString("en",{timeZone:"Europe/Dublin", day:"numeric"})`
- Keep old `dueAt` UTC instant for backward compat during migration, compute new `scheduledLocalDate`.
- Version backup before migration.

---

## 12. Immediate Quick-Wins Before Full Engine

If normalising cannot happen instantly (spec § Global 2):

1. **Fix Fridge UTC slice:** L786 one-line to `new Date().getFullYear()+"-"+...` local.
2. **Fix dueDayLabel rounding:** replace `Math.round` with `Math.floor` on calendar-day equality check.
3. **Replace monthly 720 → semantic:** reuse existing `computeNextDueDateChore` monthly branch for all monthly (already exists L423-L442) — apply to `windowHoursForChore` only as window not recurrence, and `freqToHours` should return null for monthly + use own semantic.
4. **Make biweekly parity stable:** Compute weekNum since fixed epoch Monday Jan 1 2024 local Dublin (not `from`). Use `Intl` epoch.
5. **Drop timezone mixing UTC/local:** Always `getFullYear()/getMonth()/getDate()` for local grouping, never `slice(0,10)`.
6. **Remove fake expiry** L804/L899.

These 6 one-liners unblock Beta while full `lib/dates.ts` is built.

---

## 13. Line Reference Summary

| Issue | Lines |
|-------|-------|
| Monthly 720h chore | 226-227 |
| Monthly 720h shopping | 455-456 |
| Monthly creation +30d | 1160 |
| Calendar monthly UTC/local mix | 334-349 |
| Chore monthly better but local not Dublin explicit | 423-442 |
| Weekday biweekly parity uses `from` | 371-396 |
| `from.getHours()` DST drift | 366, 369, 483 |
| Fridge UTC slice | 786, 791-794 |
| Fridge fake expiry | 804 |
| dueDayLabel round ms/86400000 | 1181 |
| percentLeft window ms fixed | 236-237 |
| timezone var unused | 336 |
| isValidMultiDay dead | 1358-1372 |
| toLocalKey vs slice inconsistency | 1326-1330 vs 791 |
| Shopping skipped occurrence advance | 489-492 |

---

## 14. Acceptance Criteria Not Met (Current)

- Navigate 24 months without errors → ❌ month drift 720h moves Feb→Mar incorrectly
- Multi-day across month boundaries → ⚠️ works but dead helper, no year-cross test
- Split response → not in scope of this agent, but date part OK
- Partner hidden → not date
- Repeat survives DST → ❌ off by 1h 09:00 wall
- Monthly semantic → ❌ 720h
- Notifications once → depends on ms window shift
- Agreed events remain → OK
- Edit/cancel attribution → not date
- Event points/urgency removed? — still exists `isBonusCal` L547

**Blocking for Trust:** UTC slice around midnight will cause household confusion daily. Monthly drift will desync recurring chores within 2 months. DST bugs 2026-10-25 will shift all daily chores 1h.

---

**End Audit 3**
