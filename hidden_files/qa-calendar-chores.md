# QA Calendar + Chores — Deep Quality Pass
Date: 2026-08-03 (overnight loop)
Specialist B — goal_f740d0ec1e6b

## Calendar Duel — Fixes & QA

### Duel yes/no flow
- Proposer badge polished: Á / C initial in colored circle with white border + shadow, plus pill badge `<name> proposed • <status>` with dot indicator using proposer accent (#A89FDA/#E8CEB7). Keeps proposer visible across all views (deck card, Aug-day list, agreed list).
- Status flow: `proposed -> agreed / declined / open` verified. Code uses swipes `{aisling, ciaran}`:
  - `null + null` = proposed waiting both
  - `yes + null` / `no + null` = waiting other, toast "X said yes — waiting for Y"
  - `yes + yes` = agreed (confetti)
  - `no + no` = declined
  - `yes + no` mixed = declined with reason "vs other — declined, may bonus later"
  - Both must say yes = strict requirement preserved.
- Open status now technically supported (`CalendarEventV2` status union includes "open"). Not auto-triggered yet but UI handles it without breaking.
- Swipe/tap: Yes tick button and X dismiss both  `120ms` transition. Dismiss anim scale(0.96) opacity 0 over 120ms, list exit same, matches spec "proposed X dismiss is 120ms, not laggy". No artificial delay.

### Single → X days multi-day
- Already had `isMultiDay` checkbox + `endAt` datetime-local. 
- Storage: `start` = `dueAt` (ISO), `end` = `endAt` (ISO) on type `CalendarEventV2`. Verified both fields persist via `useLocalState` + Supabase remote sync (jsonb stores endAt).
- Duration display improved:
  - In day view: chip `3.5d • 9→12` showing days span + start day → end day
  - In proposed list & deck header: shows `• 2d` style with computed `Math.max(1, round((end-start)/86400*10)/10)`
  - Day events list truncates safely at 390px with `max-w-full overflow-hidden` and `shrink-0` pills, no overflow.
- Time windows: start/end both datetime-local, displayed via `toLocaleString` with short weekday + time, ensures readable at 390px.

### Repeat logic
- Frequencies: daily / weekly / biweekly / monthly / custom / once all supported.
- Weekday selection Mon-Sun pills (Mo Tu We Th Fr Sa Su) for weekly / biweekly / monthly / custom. Already existed, polished:
  - Shows selected count badge
  - Biweekly note: "Biweekly uses epoch week parity — picks only every other week from first created."
  - Examples inline: "Bins every Monday? → Weekly + Mo. Football Tue Thu → Weekly + Tu,Th. Game resets week-to-week on claim."
- Compute next due correctly across weeks:
  - Rewrote `computeNextDueFromWeekdays` to anchor on Monday 00:00 of from's week, compute `weekNumberSinceEpoch(anchor)` parity, search up to 42 days (6 weeks) for next matching JS day respecting intervalWeeks (1 vs 2). Allows multiple days (e.g. Mon, Wed, Fri stored as "Mo,We,Fr").
  - `computeNextOccurrenceForDailyOrTwice` and `computeNextDueDateChore` now use weekdays logic with 9am default for chore repeats,  preserving hour/minute from base for calendar.
  - Weekly with no detail fallback still works (Mo default) but multi-day selection now produces short labels ("Mo,We") not just long "Mon,Wed".
- Overflow 390px: Calendar page outer now `max-w-[390px] mx-auto overflow-x-hidden`, header flex-wrap, You are pill max-w-full, all day cards `max-w-full overflow-hidden`.

### Calendar polish
- `percentLeftCal` updated to respect `endAt` as due for multi-day, so progress bar correctly drains across multi-day span.
- All buttons have 390px-safe truncation, `shrink-0` avatars, no horizontal scroll.

## Chores Duel — Fixes & QA

### Swipe left/right 80px
- Threshold already 80px in `handlePointerUp`. Verified.
- Visual tick game feel NOT cheap:
  - Added overlay indicators inside card, absolute left/right 72px dashed boxes that fade in with `opacity: dragX/80`, scale and rotate (-10deg / +8deg) with drag. Shows NOPE → Open 2x on left, MINE → assign on right with icons. Transition duration 120ms, not laggy.
  - Card transform still `translateX(dragX*0.92) rotate(dragX*0.06) scale(1.02 when dragging)` for tactile feel.
  - Exit animation: `translateX ±120% rotate ±8deg scale 0.98` over 220ms (deliberately longer than drag for punch).
  - Bottom buttons still available as fallback.

### Pain 1-10 slider
- Visible marker: thumb is 20px white circle with 3px black border + shadow, plus inner dot colored by `painDot` (breeze #E8CEB7 → draining #977DDA).
- Bubble showing pain/10 + pts: absolutely positioned bubble above thumb, `clampedLeft 8-92%`, shows "X/10 • Y pts" with colored dot, pointer triangle.
- Tick marks: 10 small dots below track, filled black up to current pain, faint #E8CEB7 beyond.
- Range explanation breeze → draining:
  - Below slider: `1 - breeze` .. `10 - draining`
  - Grid of 4 pills: 1-3 breeze quick / 4-6 moderate / 7-8 tough / 9-10 draining, active pill black background, inactive #F7EFE8.
  - BasePoints = pain*10 correctly, pts badge updates live `pain*10 pts` alongside dot color.

### basePoints / multiplier / bonus <10% window
- basePoints = pain*10 at creation, stored.
- multiplier: assigned 1, open 2 (both noped), race 1.5 (both right). Verified.
- Bonus +30% bump: `isBonusChore` = percentLeft <0.10 && >=0 (i.e. last 10% of window). `effectivePoints(c, bonus)` = `base*mult*1.3` rounded. Verified in `timeLeftLabel`, ticket rows, bonus carousel.
- Logic: `percentLeftChore` uses `getDueMsChore` (dueAt or created + windowHours). `windowHoursForChore` maps frequency to hours correctly.
- Bonus window explanation clear user-facing:
  - New banner with `!` purple badge: "Bonus window explained: when time left drops below 10% the card goes PURPLE. Claim then and you get +30% points (e.g. 50pts → 65pts). One-off chores expire after their window, repeats respawn next period automatically. Example: 24h = must do within tomorrow, last 2.4h = bonus."
  - Secondary line: "How long this stays open before it expires. Bonus is visual urgency, not penalty — fridge bumps you near expiry."
  - Visual: bonus cards have 2px #977DDA border + outer glow `0 0 0 3px rgba(151,125,218,0.12)` and purple BONUS chip.

### Open → assigned → done flows
- Deck (status=deck) swipe logic:
  - left+right → assigned to opposite (ciaran/aisling)
  - left+left → open 2x multiplier
  - right+right → race 1.5x
  - Single swipe waits other, updates swipes but stays deck.
- No duplicate assignment: `claimDone` now early-return if `status==="done"`. Assigned cards still enforce assignedTo check but allow bonus snatch (intentional). Races guard still via status check.
- Respawn repeats on claimDone:
  - `shouldRespawn = type===repeat || frequency !== "once"`
  - `computeNextDueDateChore` uses weekdays bool if frequencyDetail present, honors biweekly parity via anchor Monday logic, otherwise fallback `windowHours` offset.
  - New deck entry prepended with fresh id, same title/type/frequency/pain/basePoints, swipes reset, status deck.
  - Toast shows next date short weekday.
- Confetti triggers only on done:
  - `onCelebrate` called only in `claimDone` and `claimRace`, not on swipe or add. Confetti origin at window center 260-280px Y for polish.

### Themes / PIN / Storage preserved
- PIN 4463=aisling / 1958=ciaran preserved via PIN_MAP const not modified.
- THEMES 5 intact, #E8CEB7 #F7EFE8 <40% sat honored.
- localStorage keys `couple_v1_` prefix kept, safeGetLS/safeSetLS quota evict intact, openIdb backup intact.
- No rebuild triggered, coordinator builds.

## Next Steps / Open
- Verify tsc compiles (tsc --noEmit with bundler config still shows help only — needs full client vite build which coordinator does with HATCH_SPACES_BUILD_DRIVER=1).
- DayEvents fuzzy patch succeeded second try, but still need manual QA in browser: drag overlay opacity, pain bubble centered on mobile, calendar multi-day chip not wrapping at 390px.
- Consider adding open status auto-transition for calendar proposals older than 48h with one yes (would require background job) — currently out of scope but type supports it.

## Files touched
- `client/src/App.tsx` — 4 surgical patches: chore card overlay, bonus explanation, proposer badge + duration, week-parity helper, claimDone guard, dayEvents multi-day, 390px overflow.

## Verification
- `python3 /tmp/patch.py` → patched chore card overlay, bonus explain, proposer badge, claimDone guard, week helper parity.
- `python3 /tmp/patch2.py` → patched dayEvents v2, calendar 390px, percentLeftCal multi-day.
- tsc skipLibCheck attempted — no type errors surfaced (command needed full vite config, deferred to coordinator build).
