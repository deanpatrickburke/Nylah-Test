# Agent 1 — Product & UX Audit: Nylah OS

**Source:** `~/workspace/ts-spaces/couple-fridge-phone/client/src/App.tsx` (2664 lines), `theme.css`, `components/UpdaterBanner.tsx`
**Date:** 2026-08-03
**Tone principle:** Preserve the shared-fridge soul. Warm paper, handwritten Sharpie, peach/lavender, Aisling ♥ Ciaran. Not Jira.

---

## Global Shell & Navigation

### Current
- `TABs: fridge | calendar | chores | shopping | notes` — 5-item floating pill `z-[60]` bottom nav, rounded-full, backdrop-blur[20px], safe-area inset `pb-[max(14px,env(safe-area-inset-bottom))]`. Strong active state (dark fill + white dot). Good.
- Top bar: back chevron to fridge, “Aisling • using” switcher pill, BETA pill, UpdaterBanner, ⚙ settings, SyncStatusIsolated.
- `standalone` detection: `?standalone` OR `display-mode: standalone` OR iOS `navigator.standalone` OR host `netlify.app | github.io` OR width <=500 → avoids desktop phone-frame wrapper. Good for PWA but fragile (any narrow desktop = standalone).
- Tap targets: nav buttons upgraded to `min-h 46px min-w 44px`, TopBar icons upgraded to `32px`. Most other buttons recently fixed to `44px`. Some still `h-6 w-6` in switcher.
- `PH-frame` desktop preview wrapper `w-[min(390px,100%)]` rounded 36px white 7px border.

### Issues
| # | Severity | Finding | Rec |
|---|--|--|--|
| G1 | **High** | Fake OS time was removed (good) but `todayDateStr = new Date().toISOString().slice(0,10)` remains in FridgePage for `nextCalToday`. UTC slicing → wrong day near midnight Dublin (BST = UTC+1). Also `new Date().getDate()` for dayNum not household tz. | Use `Europe/Dublin` via `Intl.DateTimeFormat` or `date-fns-tz` to compute local key. Create single `useHouseholdDate()` hook. |
| G2 | **Med** | Back chevron always visible even on Fridge tab. No-op loop: tapping back on Home returns to Home. | Hide back when `tab === "fridge"`. Browser Back should close BottomSheet, not navigate. Currently Escape closes sheet but history.back not wired. |
| G3 | **Med** | Responsive nav: `minWidth 332px` + `maxWidth 96%` can overflow at 320px width (iPhone SE). `px-4 py-2.5` *5 labels = 5* ~66px = >300px. | Use icon-only at <360px or scrollable pill. Reduce padding to `px-3`. |
| G4 | **Low** | UpdaterBanner + UpdaterPill both exist. Banner is primary; pill duplication risk if both imported. Currently single import = OK, but cleanup: remove duplicate listeners (15 min interval + focus + visibility). | Keep one component + one listener source. Extract to `lib/updateChecker` shared. |
| G5 | **High** | `SyncStatusIsolated` shows “Saved Xs ago” from `setInterval 1s` + localStorage timestamp. Can show green “Saved now” while remoteSave failed. Misleading per product principle #2. | Replace with truthful engine: `Saving… | Saved | Offline 2 queued | Failed Retry | Updated elsewhere`. See sync audit. |

---

## Page 1 — Fridge Home

### Purpose
Should answer: *What matters today? Is anything waiting? Did partner leave me something? Is household saved?* Should be calmest page, not dashboard.

### Current info hierarchy
1. Fridge-door hero: `Fridge — Beta` + `BETA • major update` pill + dayNum GhostNum.
2. Today-for-you (max 3 cards): Next event today / Next assigned chore / Shopping summary.
3. Needs a Nod (private votes needing other).
4. Open • 2x carousel + Bonus purple card.
5. Sticky Love polaroids.

### Audit (10 points)
1. **Purpose** — Mixed. Hero + today cards align. But page currently duplicates large Chore Duel mechanics (Open carousel, urgency, score). Violates brief “do not reproduce full Open carousels”.
2. **Hierarchy** — Needs a Nod placed below shopping, easy to miss. Should be #2 if purpose is “is anything waiting”.
3. **Entry/exit** — Entry via bottom nav always. Exit via card tap → setTab. No deep-link into specific chore/event. Good for mobile.
4. **Empty states** — Now uses `EmptyState` with 96px doodle, CTA “Add event/chore/note” → calm, not broken. Good improvement. Sticky Love empty: “No sticky notes — pin a love note” OK.
5. **Loading** — None. `isFresh` cache render instant. No skeleton; acceptable but offline-first needs “Loading cached…” label per brief missing-failure list.
6. **Offline** — Not distinguished. Fridge shows same cards whether `sbLive` = null or live. No “Offline — last confirmed Xh ago”.
7. **Error** — No error state. If remoteLoad fails, merge silently keeps cache. No banner “Server unavailable — showing cache”.
8. **Destructive** — No destructive actions here. Safe.
9. **Terminology** — **High issues:**
   - “2x • 50 pts” on Fridge open card leaks scoring before user opens Chores. Breaks gamified simplicity.
   - “Bonus Now! urgent • +30%” encourages waiting to earn points — product principle says do not encourage delaying merely to earn multiplier.
   - “Front of fridge” micro-label + GhostNum dayNum feels decorative but unclear.
10. **Clever but annoying daily** — Open carousel + bonus card auto-promote urgency every open. If 3+ Open chores daily, carousel scroll fatigue. Score maths (50 pts • 1.3 etc) shown on calm home page = noisy.

### Specific brief failures
- **[CRITICAL] Exposing partner vote:** `needsNod` currently *does* hide vote (only shows `whoSwiped` avatar dot, not Mine/Nope). ✅ Fixed. Fridge event card however: `both yet? ${status}` + avatar dots for yes-siders still leaks partial info. Should be “Aisling responded / Your turn” until resolved.
- **[HIGH] Near expiry misleading:** `shoppingExpiry` computed as `(Pantry||Food) >5d` → labelled `3 near expiry` then changed in Todo card to `${n} still on list • ${n} near expiry`. Language still says food expires because it sat on list. Violates principle. Should be `On list for 6 days` only. No “Using up soon?” Pantry >5d.
- **[HIGH] UTC date slicing:** `todayDateStr = new Date().toISOString().slice(0,10)` used to filter todays events. Off by 1 in BST evenings.
- **[MED] Unread vs pinned confusion:** `stickyLove = notes.filter(!(seenBy both))` = “unseen”. But UI says `${n} pinned` header. Unread ≠ pinned. Label lies. User who read but wants to keep pinned loses it.
- **[MED] Duplicating Chores:** Full Open carousel + Bonus + urgency copied. Should be one high-priority Open chore preview with count: “3 open chores — Take a look” → Chore Duel.

### Recommendations (Fridge)
1. Remove fake expiry logic entirely. Replace with:
   ```
   Shopping: 4 things left — On list 6d avg
   ```
   Only show `expires_at` if field exists.
2. New header:
   ```
   Aisling ♥ Ciaran
   Monday, 3 August — Europe/Dublin
   [truthful sync chip]
   ```
3. Today hierarchy: **Next agreed event** (if any) > **Next assigned chore due** > **Shopping summary** OR **Sticky Love**. Max 3.
4. Needs a Nod card:
   ```
   Title
   Aisling responded — Your turn [Yes/No/Discuss]
   ```
   Hidden vote until resolution. No avatar leaking value.
5. Open preview:
   ```
   3 open chores — highest: Take bins out
   Open Duel
   ```
   Single tap, no carousel.
6. Fix UTC: create `householdTodayKey()` using `Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Dublin'})`.
7. Empty calm: ghost doodle → “No plans today — enjoy the blank door.”
8. Offline banner: at top if `!navigator.onLine` or `sbLive===null`: `Offline — showing last saved`.

---

## Page 2 — Calendar & Events

### Purpose
Agree on plans (proposal) + understand schedule (agreed event). Two distinct concepts conflated.

### Current
- Month grid built locally: `firstWd = new Date(y,m,1).getDay()`, `daysInM = new Date(y,m+1,0).getDate()`. Dynamic — no longer hardcoded Aug 2026 ✅.
- Prev/Next month + Today button.
- Selected-day sheet: list events overlapping `selected` date (including multi-day spanning via `isEventOnDate` enumerating each day in month).
- Actions: `declined` X, `agreed` ✓, dismiss —.
- Add via `AddEventForm` (assumed in file).

### 10-point
1. **Purpose** — Proposal vs agreed conflated: status uses `"proposed"|"agreed"|"declined"|"dismissed"` but UI treats decline as final, dismiss as archive. No `needs_discussion`.
2. **Hierarchy** — Month grid OK, today ring `ring-2 ring-[#0A0A0A]` improved. Agenda list minimal but lacks time + duration + proposer clearly.
3. **Entry/exit** — Tap day → filter agenda. Tap + → Add sheet. Close sheet → underlying month preserved. Good.
4. **Empty** — Polaroid: `No plans that day` + doodle 96px + “Add event” CTA. Calm ✅.
5. **Loading** — No skeleton; grid instant. Acceptable (local).
6. **Offline** — No offline chip; events show same.
7. **Error** — No malformed date guard besides `isNaN` fallback. If `dueAt` missing, `isEventOnDate` returns false → event disappears silently.
8. **Destructive** — X = `declined` not delete, but “—” = dismiss to `dismissed`. X vs dismiss confusing. No confirmation for either. Violates principle “Delete without clear confirmation”.
9. **Terminology** — “Propose” vs “Add event” mixed. `proposalReason` badge shown but origin unclear.
10. **Clever annoying** — Points & urgency bonus on calendar (`BONUS +30% closing soon`) removed from recent build? Still appears via `bonusCal` on Fridge, but CalendarPageV2 itself no longer awards points. Good. However 10px badges “by Ciaran” small.

### Specific brief failures
- **[FIXED]** Hardcoded August: now dynamic y/m, cells padding for firstWd, overflow while length%7. ✅
- **[MED]** Points still in memory: `basePoints, pain` still in `CalendarEventV2`. No UI shows points in CalendarPageV2 anymore — good. Type should drop points fields to prevent regression.
- **[HIGH]** Hidden responses: current shows proposer name badge always, but not partner response content. Acceptable — but if status=`proposed` and `swipes.aisling!==null`, other sees “by Aisling” + avatar? Should be “Aisling responded — waiting for you”.
- **[HIGH]** X vs Delete: Close X should not delete proposal silently. Current does status=declined, not delete, so safe, but UX asks for `Yes | No | Discuss | More` not `✓ ✕ —`.
- **[HIGH]** Identity switching: CalendarPageV2 receives `currentUser` prop from shell's active profile. Top switcher “Aisling • using” can change mid-screen and then next tap responds as other person. Violates “One person cannot respond as other without verification”. Should be `Responding as Ciaran` readonly + profile switch via global verified flow.
- **[MED]** Multi-day: enumeration loop `for day=1..daysInM` O(n*m). Works but includes event twice if both start/end keys inside month (dup check missing dedup via Set). Also multi-day >2 months not tested.

### Rec
1. State model: `draft, proposed, awaiting_aisling, awaiting_ciaran, needs_discussion, agreed, declined, cancelled, completed` + separate `event_responses` table (future).
2. Month: use `date-fns` or `Temporal` for local date keys, support Mon-start option (EU). Keep `key = yyyy-MM-dd` not day-of-month.
3. Cards: `Yes / No / Discuss` pill set, with hidden second response until both answered. Reveal animation together.
4. Delete: More menu → `Edit | Cancel Proposal | Delete` + destructive confirmation sheet (not `confirm()`).
5. Multi-day: dedicated `isMultiDay` badge, show `Aug 2 → 5 · 3 days` not two time stamps.
6. Recurrence: template vs occurrence, weekday rules via shared recurrence engine.

---

## Page 3 — Chore Duel

### Purpose
Transform awkward allocation into lightweight ritual: Create → Privately respond → Reveal → Take/Start → Complete → Celebrate.

### Current
- Deck stacking `max-w 340px` dotted bg, `320x190` card, `rot 0.06*dx`, `scale 1.02` on drag, exit `translateX 120% rotate 8deg scale 0.98` 220ms ease. Good feel.
- Filters `all | today | tomorrow | Mo..Su` with counts `(n)` — helpful.
- Scoreboard: Aisling vs Ciaran total + weekly 7d bar, linear gradient peach-purple.
- Assigned / Open / Races sections.

### 10-point
1. **Purpose** — Strongest feature; personality kept. Swipe Mine/Nope retained.
2. **Hierarchy** — Deck on top → good. Scoreboard second → good. Filters third → fine but filter bar wraps 2 lines on narrow.
3. **Entry/exit** — Entry via Fridge “Open deck” or bottom nav. Exit via claiming. No confirmation for swipe — good (fast), undo after swipe missing.
4. **Empty** — Now `Deck clear — nice.` 120px doodle, CTA Add chore. Good. Assigned empty “No assigned — swipe deck”. Good. Races empty “No races”. Good. All 44px heights.
5. **Loading** — No spinner; deck from LS instant.
6. **Offline** — Works offline (LS). No offline indicator inside page.
7. **Error** — Duplicate title guard: `dup` check `title.toLowerCase() trim === existing` + status !== done → toast “Already exists”. Prevents duplicate active cards ✅ (brief wanted dialog with Increase qty / Add separate). Partial.
8. **Destructive** — Swipes not destructive, but `claimDone` immediately marks done + respawns next occurrence if repeat. No undo.
9. **Terminology** — “Pain” still used as label though Add form spec wants “Effort”. “Pain 5 • 50 pts” confusing emotional word. “Deck”, “Open • 2x”, “BONUS” are gamified; acceptable but “Take vs Done” distinction missing.
10. **Clever but annoying** — Swipe is fun daily but thumb fatigue if 7+ cards. Fixed by showing only next occurrence not 7 pre-made cards (templateId single). Good. Filter counts now computed per-filter O(n*m) each render — 10 filters * chores length ~ fine. Bonus calculation `isBonusChore` on every render.

### Specific brief failures
- **[HIGH]** Take vs Done collapsed: `Claim` button in Assigned & Open immediately marks `status=done`. Brief wants `Take it` (Open → assigned to me) then `Mark done`. Race: first Finished wins atomically. Currently first claim wins locally but optimistic, no server-side atomic guard → double points possible if two devices claim near-simultaneously (last-write-wins).
- **[HIGH]** Hidden responses: Card reveals `whoSwiped`? Current deck card shows no partner swipe until both? In `doSwipe`, first swipe sets `swipes[viewer]=dir` and keeps deck card hidden (waits). Toast says “waiting for X”. Good. But Fridge Needs a Nod previously leaked; now fixed at source: card shows only mine pending.
- **[HIGH]** Scoring incentives: Base 50 pts, multiplier `1 / 1.5 / 2 / 1.3 bonus`. Current cap uncapped if combo: Open 2x * Bonus 1.3 = 2.6x. Brief wants max 1.5x configurable. Historical scores change because `effectivePoints` recomputed on render, not stored at completion (`awarded_points`). Violates immutability.
- **[MED]** Flexible timers: `windowHoursForChore` = fixed per frequency (24h daily, 84h twice-week, 168 weekly, 336 biweekly, 720 monthly). Monthly 720h = 30d drift (brief explicitly bans). Should be semantic `dayOfMonth + time Europe/Dublin`.
- **[MED]** Recurring duplication: fixed to single template occurrence (`templateId`, `computeNextDueFromWeekdays`). Completing late → `computeNextDueDateChore` uses `now+60s + windowHours` fallback for daily, not fixed cadence. Late completion shifts next due (shouldn’t unless recurrence = “after completion”).
- **[MED]** In-page identity switching: “You are: Aisling | Ciaran” toggle inside page allows swapping and swiping as other with one tap. Violates “Identity cannot be changed inside page / act as other without verification”. Show read-only `Playing as Ciaran`.
- **[MED]** Attribution: `completedBy` stored, but `marked_done_by` vs `completed_by` distinction missing. If Ciaran marks for Aisling, current shows `Ciaran marked`? No, `claimDone(by)` sets `completedBy=by` regardless of assignee → misleading.

### Rec
1. Separate actions: Open: `Take it • 1.25x` → Assigned. Assigned: `Mark done`. Race: `Finished!` atomic RPC `claim_race(race_id, actor, mutation_id)`.
2. Store scoring at completion: `{base, multiplier, urgencyAdd, awarded, version}`. Never recompute history. Cap max multiplier 1.5.
3. Use Europe/Dublin semantic monthly: `dayOfMonth: 12, localTime:"09:00", timezone:"Europe/Dublin"`.
4. Timer start = `resolved_at` for flexible chores, not `created_at` while awaiting second vote.
5. Add third action `Needs a chat` small pill → Discussion state, keeps swipes but flags.
6. Undo toast after swipe/claim: 5s to revert.
7. Remove in-page switcher; global profile control only.

---

## Page 4 — Shopping

### Purpose
What do we need / who asked / recurring vs one-off / check off during shop.

### Current
- Quick-add smart parser: `milk x2`, `add milk`, `milk, 2`, `milk 2`. Qty 1-99 clamp. Good.
- Category pills: Food, Clothes, Trips, Bills, Entertainment, personal, other. `quickCat` selection + `forcedCat` via @tags.
- Frequency chips: as-needed, daily, every-2d, weekly, biweekly, monthly. `showNeed` weekday selector for weekly/biweekly.
- Notes optional, tags `@aisling @ciaran @personal @wants` → personal store.
- Personal corners: Aisling personal/wants + Ciaran personal/wants lists (local + shopping sync).
- Grouped expandable cats, qty stepper (− 1 +), cat `<select>`, purchase toggle, expiry & smart restock sections.

### 10-point
1. **Purpose** — Fast add works (seconds). ✅ Preserves attribution `addedBy`.
2. **Hierarchy** — Quick-add top good. `freq ≥3× last 7d` / `Pantry>5d` boxes between add and list = pushes active list down (breaks progressive disclosure). Suggestions should be collapsed or below list.
3. **Entry/exit** — Tap fav pill → auto add `1`. Good. Exit via purchase collapse to “done”.
4. **Empty** — `empty cart — add above` 12px grey, no doodle, no CTA beyond input. Weaker than other pages.
5. **Loading** — None.
6. **Offline** — Queues offline via localStorage; no offline chip inside page.
7. **Error** — Duplicate detection missing for Shopping. Adding “Milk” when active “Milk” exists creates duplicate rows (brief asks intentional duplicate handling).
8. **Destructive** — No delete action visible; only purchase/archive. Personal list × deletes without undo or confirm.
9. **Terminology** — “Quick add — smart”, “freq / ≥3× last 7d”, “Pantry >5d” are implementation language, not user language. “As-needed” vs “Once” vs “Custom” inconsistent.
10. **Clever annoying** — `@personal` tagging is clever but parsing `@aisling` via `cleanTitle.replace(/@\w+/g)` strips email-like text. Frequency chip selector every time adds friction (adding milk should be seconds, not frequency pick). Weekly needDays 7-circle UI novel but heavy.

### Specific brief failures
- **[HIGH]** Fake expiry: “Using up soon? Pantry >5d”, orange dot pulse `>5d`, “Near expiry” tag on Fridge. All infer spoilage from list age. Violates brief — Remove fake expiry. Replace with honest `On list for 6 days`.
- **[MED]** Category normalisation: old `Pantry` mapped → `Food` via `mapOldCat`. No `Pantry` pill anymore ✅. “personal” lowercased vs TitleCase Food inconsistent.
- **[HIGH]** Personal & Wants sync: `personal` stored via `useLocalState("couple_v1_shopping_personal")` = LS-only per device. Brief says must sync as household (shopping_templates / saved personal). Changes on Aisling’s phone won’t appear on Ciaran’s. Also `@personal` items that push to shopping are synced (since shopping synced), but standalone personal list is not.
- **[MED]** Active / history / template model missing: currently one array `ShoppingItemV2[]` with `purchased boolean`. No `archived` vs `deleted` vs `active`. History grows as `purchased` items remain, collapsed into “done” but never pruned → unmanageable page over months.
- **[HIGH]** Duplicate active handling missing: should show `Milk is already on list — Increase quantity to 2?` sheet.
- **[MED]** Item editing: only cat `<select>` and qty stepper inline; no full sheet with Name / Category / Requested by / Notes / Recurrence / Needed-on / Archive / Delete + Undo.
- **[MED]** Purchase Undo: toggle purchased flips but strike-through purchased items allow toggle back? Actually `togglePurchased` flips boolean; purchased items rendered in separate “done” section with onClick to undo — works but no explicit Undo toast.
- **[LOW]** Trip mode missing.

### Rec
1. Remove all fake expiry UI (orange dot, amber pill, “Using up soon?”). Replace with `On list for 5 days • usually bought weekly`.
2. Sync personal: move personal/wants to Supabase table `shopping_templates` or add to remote `shopping_personal` bucket (sync same as shopping).
3. Normalise CATS enum to Title Case consistent: Food, Household, Toiletries, Trips… Store lowercased internally but display nice.
4. Add duplicate guard BottomSheet.
5. Add full EditItem sheet (slide-in) on tap of item name.
6. Move smart suggestions below active list, language: `You bought this 3 times recently — Add again?`.

---

## Page 5 — Memo Board / Love Notes

### Purpose
Emotional, lightweight, tactile: quick note, love note, small photo, know partner saw it, pin worthwhile, archive memories.

### Current
- Polaroid visuals: `.polaroid` soft shadow + gradient inset, tape `34x11px` random angle -2..2 deg, rotation `rotForId`. Handwritten `Caveat 600/700` font. Warm.
- Grid 2-col corkboard dotted bg, 120×120 JPEG 0.4 quality `<40k`, webp fallback 0.35, slice truncate 38000.
- Modes plain / Love, seen-by chips `Á✓ C✓`, “new” pill black.
- Add: plain/love toggle, textarea Sharpie, 120×120 low-fi photo allowed.

### 10-point
1. **Purpose** — Feels like real fridge mementos. Well preserved.
2. **Hierarchy** — All boards grid up top, CTA “Pin note” primary below grid, archive `<details>` below. Good.
3. **Entry/exit** — Tap polaroid → detail sheet, Take down — mark seen, Remove permanently. Escape closes.
4. **Empty** — `No notes — pin one for Ciaran.` calm small 11px. Good but CTA could be larger 44px.
5. **Loading** — None.
6. **Offline** — Works offline via LS, photo dataUrl kept in same row → quota risk; `safeGetLS` eviction may silently drop photo.
7. **Error** — Photo fileReader may fail; no error toast.
8. **Destructive** — **CRITICAL**: `Remove permanently` previously referenced wrong state? Now `setNotes(prev=> filter id)` looks correct (recent fix). Still no Undo, no failure report, no tombstone so stale device resurrects deleted note via merge.
9. **Terminology** — “Take down — mark seen” combines two actions (read vs archive). Confusing.
10. **Clever annoying** — 120×120 aggressive crop + 0.4 JPEG intentionally low-fi to save space — works aesthetically but product brief says “Do not truncate encoded image string using slicing” (currently does `.slice(0,38000)` can corrupt base64 → corrupt dataUrl). Should use Supabase Storage instead.

### Specific brief failures
- **[FIXED]** Deletion bug: fixed to use `prev.filter id`. Remaining: no failure reporting, no tombstone.
- **[HIGH]** Read vs pinned vs archived: `active = !(seenBy both)` effectively treats “both seen = archived”. Read ≠ pinned. Opening a note currently does not auto-archive? Actually `takeDown` sets `seenBy[current]=true`, making `both seen = takenDown`. So reading = archiving de facto. Violates brief: separate `pinned_at`, `archived_at`, `deleted_at`, `read_by`.
- **[HIGH]** Photo storage: slicing dataUrl corrupts image, no resize to 512px webp, no Storage upload, large dataUrl in main row → quota + realtime payload 15KB * 10 = 150KB row growth, close to Supabase row limits (~few KB? Actually jsonb >?). Should use Storage + thumbnail URL.
- **[MED]** Author permissions: current allows anyone to `Remove permanently` any note (no author check). One person can silently rewrite other's note? No edit allowed, so safe for rewrite, but delete permission too broad.
- **[MED]** Archive experience: `<details>` archive list `scale-[0.96] opacity-60` non-interactive, faded text only, cannot open/restore image properly.
- **[HIGH]** Home integration: Fridge says `${n} pinned` but actually shows unread count. Label inaccurate.

### Rec
1. Data model: `id, body, author, created_at, pinned_at, archived_at, deleted_at, read_by[]`, `photo_url, thumbnail_url`, `edited_at`.
2. Split actions: `Mark read` (sets read) vs `Take down from board` (pins→archived) vs `Keep pinned`. Don’t auto-archive on read.
3. Store photos in Supabase Storage `note-photos/{id}.webp` 512px max, 82q. Thumbnail 120. Save URLs not base64. Keep existing low-fi aesthetic via CSS filter, not destructive compression.
4. Delete: soft delete tombstone 7d, Undo toast 5s before purge, mutation with `deletedAt`, `updatedBy`.
5. Archive view: tappable cards that expand to full readable + photo + restore CTA.
6. Identical bodies allowed: current notes merge removed body-based dedup (good) but remote merge still does `unshift` all ids; allow same body duplicates.

---

## Page 6 — Settings / Blueprint / Debug Centre

### Current
Settings lives as BlueprintPanel shown via bottom sheet or `tab=blueprint`. Contains:
- Supabase Debug Centre (live linked pill, c/cal/n/s counts, row/token ids, envSrc, force pull, nuke local, copy debug JSON, delete all remote, raw JSON, DB health queries)
- Theme picker (4 circles 40px, border-white → border-black on select, name + accent)
- Manual Supabase override (URL input, anon key password input)
- Local cache keys

### 10-point
1. **Purpose** — Settings should help normal user manage Profile/Household/Appearance/Notifications/Data/Security/About. Current is production debug control room.
2. **Hierarchy** — Debug centre dominates top of sheet, pushed above theme. Wrong.
3. **Entry/exit** — Settings via ⚙ top-right → BottomSheet 72dvh. Scroll-lock via `document.body overflow hidden`. Good. No separate route for diagnostics.
4. **Empty** — N/A.
5. **Loading** — “Testing…” state for Test Supabase, `sbTesting` disabled.
6. **Offline** — Live pill shows `local-only` yellow when `!hasSupabaseConfig`. Good signal but buried.
7. **Error** — `sbTestMsg` shows cut error `msg.slice(0,80)` inline. Good.
8. **Destructive** — **CRITICAL**: `Delete all remote (wipe)` + `Nuke local & reload` are available in ordinary production UI without dev mode guard. One tap erases household truth. No confirmation beyond `confirm()`. Violates trust.
9. **Terminology** — “Supabase Debug Center”, “True multiplayer — Supabase is source of truth”, “merge-duplicates does NOT clear empty array — now using PATCH update() so delete sticks.” — internal implementation notes exposed to end user.
10. **Clever annoying** — 4 DB health query buttons (Check row age / Check counts / List row ids / Realtime ping) are developer utilities. Realtime ping creates transient channel `health_${Date.now()}` and removes after 4s — leaks if fails.

### Specific brief failures
- **[CRITICAL]** Remove debug centre from normal Settings. Must move behind `?debug=1` or build-time `DEV` or multi-step unlock (tap version 7 times). Currently visible to normal user.
- **[HIGH]** Normal Settings missing: Profile (avatar/initial), Household name/members/timezone, Appearance (reduced motion), Notifications (per category), Data & Sync truthful status/last success/pending/retry/export, Privacy/Security signed-in/ devices / app lock, About version/changelog/update check.
- **[MED]** Theme preview only shows accent circle; does not show surface/text/selected. Midnight theme contrast untested.
- **[HIGH]** Update mechanism: UpdaterBanner chooses `Blob + write pending metadata + call it installed` — brief says do not pretend download Blob is installed when app never loads bundle. Need verified strategy. Currently interval 15 min + focus + visibility — duplicates listeners (also `addEventListener focus` and `document visibilitychange` duplicate). Should be one source.
- **[HIGH]** Data export: none. Backup status: none.

### Rec
1. Create two modes:
   ```
   Settings (normal):
     Profile, Household, Appearance, Notifications, Data & Sync, Privacy, About
   Developer (hidden ?debug=1):
     Supabase Debug, DB health, Force pull, Raw JSON (read-only), Clear cache (not delete-remote)
   ```
2. Delete destructive remote wipe button entirely from production builds.
3. Truthful sync: move sync status to Settings Data & Sync detailed panel.
4. Theme preview: show mini phone mock with surface/surface/text/accent chips.
5. Update: one banner only, versioned deployment, service-worker prompt, activate+reload. Remove APK Blob pretend.

---

## Page 7 — PIN / Profile Identity / Onboarding

### Current
- `WhoScreen` PIN pad: 4-digit input `type=password?` Actually text-ish inputMode numeric, dots placeholder `••••`, digit grid 1-9 + 0 + ⌫, `PIN_MAP {4463:aisling,1958:ciaran}` hardcoded.
- Hint footer: `4463=Á • 1958=C • other codes blocked` — prints both codes publicly.
- `standalone` must ask PIN every fresh load: clears LS `couple_v1_currentUser` on mount + `idbSet null` + delete kv `couple_v1_currentUser`. Forces re-PIN each launch.
- Profile switcher: “Who’s using?” bottom sheet with two avatars 96px wash/accent initials, opacity toggle, global `currentUser`.

### 10-point
1. **Purpose** — Identity determines who acts, so cannot be cosmetic toggle only. Currently partially used.
2. **Hierarchy** — PIN screen is full-screen `z-[80]`, centred 300px card, 20px title, 12px subtitle, 4-digit field, 3-col keypad. Good affordance.
3. **Entry/exit** — Entry on no `currentUser`. Exit on correct PIN → `onSelect`. Wrong → shake animation 280ms `pinShake -6px/6px` + “wrong code — try again” tomato `#E07A5F`.
4. **Empty** — N/A.
5. **Loading** — None.
6. **Offline** — Works offline (client-side PIN check only).
7. **Error** — Wrong PIN shows message, clears pin after 340ms. No rate limit, no lockout.
8. **Destructive** — No.
9. **Terminology** — “Enter PIN — 4-digit code. Only you two know it” warm, good.
10. **Clever annoying** — Printing PIN mapping on login defeats security. `other codes blocked` implies denylist not safelist.

### Specific brief failures
- **[CRITICAL]** Hardcoded public PINs in client bundle + printed on login page. Public anon key not security but PIN exposure is zero security. Violates “Do not hardcode both PINs in client bundle / Print PIN mapping”.
- **[HIGH]** Authentication: PIN treated as household auth. No real Supabase Auth `household_members` / RLS. Any device knowing row ID can read/write (anon key open). `ROW_ID` + `TOKEN` baked public.
- **[MED]** Persist device identity: `standalone ? sessionUser : persistedUserRaw` logic clears LS aggressively, so returning on same phone must re-PIN every time unless they stay in same session. Brief wants setting `Remember me / Ask each time / Lock with PIN / Biometric`.
- **[MED]** Profile switching: top switcher + in-page switchers allow swap without verification. Should be deliberate: Open global profile control → Choose Switch → Verify other person's PIN → Update active profile → show new identity. Logically needs authenticated actor tracking.
- **[LOW]** Failed PIN: no rate-limit, no secure recovery via account, stores raw mapping anyway.
- **[MED]** First-run onboarding missing entirely.

### Rec
1. Remove hardcoded PIN map from UI; replace with Supabase Auth email magic-link (one per member) + household invite. Keep PIN only as optional local device unlock (stored as hash, not plaintext map). Do not show hint `4463=Á`.
2. Persist identity via `localStorage` with preference `askEachTime` boolean. If false, keep member on same device without re-PIN, but still carry authenticated member ID.
3. Global switch flow: `tap header pill → Switch person? → enter other PIN (hashed compare rate-limited 3 tries / 30s) → success`.
4. Every mutation carry `created_by, updated_by` (member id) + `updatedAt`. Show `Responding as Ciaran` read-only inside pages.
5. Onboarding: Welcome → Create/join household → Identify member → Timezone → Notifications opt-in → Theme opt-in → Add first chore/event/item/note (optional).

---

## Cross-Cutting Product Observations (Clever but Annoying)

1. **Day filters on Chores** showing `(count)` per filter are useful but recompute counts every render via `FILTERS.map` scanning chores → fine now, scales O(n*10) trivial.
2. **Bonus +30% purple cards** on every tab promote waiting. Remove from Fridge/Home, keep only inside Chore detail as timer-based urgency with `Response requested by Friday` language (no points).
3. **Shopping frequency mandatory** on quick-add: tap milk → must choose freq → extra tap. Move to Options collapsed.
4. **Notes polaroid tape random angle** charming, keeps fridge metaphor. Keep.
5. **Confetti 24-31 particles** everywhere (celebrate) on every claim may become noisy with daily use. Reserve full confetti for race win / high-effort / goal reached, tick+haptic otherwise. Respect `prefers-reduced-motion`.

---

## Severity Summary Table

| Sev | Count | Top Examples |
|-----|-------|--------------|
| CRITICAL | 5 | Debug wipe in prod UI, PIN map hardcoded+printed, No RLS/auth, Fake expiry spoilage, Time & recurrence 720h monthly |
| HIGH | 14 | UTC date slicing, Near expiry language, Unread≠Pinned label, Take vs Done collapsed, Scoring uncapped+mutable history, Atomic race missing, Personal unsynced, Deletion no tombstone/failure report, No offline distinguishing, Sync status lying, Identity switching inside pages, Multi-day dup/spans, Proposal vs event conflated, Update Blob pretend |
| MED | 12 | Back btn on Home, Responsive nav 332px overflow, Empty States weaker Shopping, Category lower-case inconsistent, Archive faded non-interactive, Theme preview only accent, Update duplicative listeners, No onboarding, No rate limit, Duplicate handler missing shopping, No undo toasts, Destructive no confirmation sheets |
| LOW | 5 | GhostNum decorative, “front of fridge” micro-label, 8-10px tiny type, Focus states missing, Reduced-motion not respected |

---

## Immediate Implementation Priorities (Product Path)

### Phase 0 — Protect
1. Hide debug centre behind `?debug=1` flag before any other work.
2. Remove `Delete all remote` button.
3. Runtime validation Zod for remote payloads to prevent crash on malformed remote.

### Phase 1 — Identity & Trust
1. Drop `PIN_MAP` visual hint. Create proper Supabase Auth (magic link) + `household_members` table.
2. Make `Playing as` read-only in Calendar/Chores.

### Phase 2 — Sync & Data Correctness
1. Replace lying “Saved now” with truthful sync state from single engine.
2. Add offline queue with mutationId idempotency.

### Phase 3 — Dates & Recurrence (Europe/Dublin)
1. Create `householdTime` helper → replace all `toISOString().slice(0,10)` and `new Date().getDate()`.
2. Fix monthly = semantic day-of-month, not 720h.

### Phase 4 — Immediate Bugs (can do quickly)
1. Notes deletion: keep fix but add tombstone + Undo.
2. Photo slicing: remove `.slice(0,38000)`; placeholder to Storage approach.
3. Calendar month dynamic already done.
4. Remove fake shopping expiry everywhere.
5. Shopping categories consistent TitleCase.
6. Prevent recurring chore duplication (already single template).

### Phase 5-10 — Page completions per brief order, preserving warm fridge metaphor.

---

*Audit complete — warm fridge kept, prototype shortcuts flagged, no generic dashboard proposed.*
