# Nylah OS — Reconciled Audit & Implementation Plan

**Date:** 2026-08-03
**Source:** `ts-spaces/couple-fridge-phone/client/src/App.tsx` (2,664 lines), lib/supabase.ts, remoteSync.ts, theme.css, build.mjs, supabase-init.sql
**Audits:** 6 parallel audits complete — all saved in `hidden_files/audit-*.md`

---

## Executive Summary — What's Actually Wrong

Beta is functional and warm, but trust gaps from prototype shortcuts remain. No generic dashboard needed.

**6 audit verdicts:**
- Product & UX: Fridge duplicates chores, exposes partial votes, fake expiry, UTC midnight bug, unread vs pinned confusion
- Data & Sync: Single-row JSONB, last-write-wins risk, revision CAS partial, RLS open, PIN hardcoded, Personal lists local-only
- Time & Recurrence: Monthly = 720h drift, weekday parity unstable, DST wall-clock shifts, UTC slice shows wrong day near midnight Dublin
- Visual & A11y: 93 peach hardcodes, theme only changes shell, zoom blocked, no focus rings, no reduced-motion, no focus trap
- Perf & PWA: Root redraw fixed, but image data URL bloat, version.json missing in dist, no SW, bundle 585KB
- QA: No test runner, no regression guards, zod unused

**All 6 agree:** Keep fridge-door warmth, Aisling♥Ciaran, handwritten, 390px lock, bottom nav frozen. Fix trust before polish.

---

## One Implementation Plan (No Conflicting Patterns)

### Single Date Engine
- Create `client/src/lib/dates.ts`
- `HOUSEHOLD_TZ = "Europe/Dublin"` fixed, not `undefined` locale
- Functions: `todayKey(tz)`, `toLocalKey(instant,tz)`, `nextMonthly(d,dom,time,tz)`, `nextWeekly(from,weekdays,interval)`, `diffCalendarDays(a,b)`, `formatDue`
- Replace: Fridge UTC slice, `dueDayLabel` rounding, `windowHoursForChore` monthly usage for recurrence, `freqToHours` monthly
- Store recurrence as semantic object not hours: `{kind:"monthly", dayOfMonth, time, tz}` + UTC instant derived

### Single Sync Engine (Interim Safe Path Before Full Normalisation)
Current single-row jsonb stays for now, but hardened:
- Keep revision CAS (`eq('revision',expected)` + merge retry) — already present, keep
- Add mutationId idempotency check localStorage + meta.lastMutationId
- Replace whole-row push with per-array merge + updatedAt comparison (mergeById)
- Add truthful sync state: `saving | saved | offline-queued | failed-retry | updated-elsewhere`
- Remove misleading `Saved Xs ago` green dot when save failed
- Move device prefs (`themeId`,`currentUser`) out of shared meta → localStorage only
- Sync Personal/Wants: move from localStorage key `couple_v1_shopping_personal` to `shopping_templates` personal_for
- Add offline durable queue in IndexedDB (simple array of mutations) with reload survival
- Fix online/offline listener leak in SyncStatusIsolated

### Single Token System (Visual)
- Extend `:root` CSS vars to full set: `--app-bg, --wash-start, --wash-end, --surface, --surface-raised, --surface-muted, --text-primary, --text-secondary, --text-inverse, --border, --accent, --accent-strong, --success, --warning, --danger, --focus-ring, --shadow-soft, --shadow-raised, --nav-bg, --nav-active, --chip-bg`
- Replace 93 `#E8CEB7` + 58 `#F7EFE8` hardcodes with vars over 3 passes
- Verify Midnight `#0A0A0A` entire app (cards `#1E1E1E` not white)

### Security (Interim → Long)
- Interim: Tighten RLS `USING (id='ash-ciaran-2026')` not `true`, add index, keep anon but scoped
- Remove PIN hint from UI, remove hardcoded map display, keep PIN only as local lock after auth
- Long-term schema ready for households/members/devices (see audit-2) — migration plan, not yet applied
- Hide Delete-all-remote behind `?debug=1` dev mode

---

## Phase Order (As Requested)

### Phase 0: Recover & Protect (Done / In-Progress)
- [x] Confirm editable source (not hashed bundle)
- [x] Document build: `bun run build:client` → Hatch SDK → dist assets
- [x] Document deploy: GitHub Pages needs `404.html`+`.nojekyll` + version.json copy
- [ ] Export current household row → versioned backup JSON
- [ ] Add runtime Zod schemas + error boundary
- [ ] Create migration/rollback plan doc

### Phase 1: Security & Destructive Safety
- Tighten RLS interim policy, add revision index
- Remove raw Supabase URL/key override from normal Settings
- Gate "Delete all remote (wipe)" behind dev mode
- Remove PIN map hint, keep verify flow

### Phase 2: Data & Sync Foundations
- Create `lib/schemas.ts` Zod for chores/calendar/shopping/notes
- True mutation queue (IndexedDB) + mutationId
- Truthful sync status component
- Sync Personal/Wants via templates
- Device vs shared split

### Phase 3: Dates & Recurrence
- Create `lib/dates.ts` Europe/Dublin engine
- Replace UTC slice, monthly drift, weekday parity, DST
- Replace `dueDayLabel` ms division
- Remove fake expiry

### Phase 4: Immediate Bugs (Quick Wins)
- Fix note permanent delete (real state)
- Remove photo string slice corruption → Storage path
- Ensure single UpdaterBanner (done)
- Calendar dynamic month already done, verify navigation 24 months
- Remove fake expiry labels
- Race atomicity + multiplier cap
- Prevent recurring duplicate

### Phase 5: Chore Duel Completion
- Hide first response (show "Aisling responded / Your turn")
- Separate Take vs Done
- State model discussion/needs_discussion
- Multiplier cap 1.5x configurable, store scoring_version
- Timer starts at resolved_at, not created_at
- Overdue actions, snooze, release, discuss
- Remove in-page identity switch
- Attributive completion

### Phase 6: Calendar Completion
- Hidden responses, discuss state, split Yes+No → needs_discussion
- X never deletes, safe delete with confirm
- Remove points/urgency bonus
- Dynamic month nav passes
- Recurrence edit ask "this / future / series"

### Phase 7: Shopping Completion
- Category normalisation (9 canonical)
- Shared Personal/Wants
- Duplicate handling modal
- Item editing sheet
- Purchase Undo, trip mode, honest suggestions

### Phase 8: Memo Board Completion
- Read/pinned/archived split, storage photos, reactions, archive interactive, home integration correct

### Phase 9: Fridge Home Refinement
- New hierarchy calm, accurate Dublin dates, private pending cards, honest shopping language, one Open preview, correct note labels, offline/empty states

### Phase 10: Shell & Finish
- Tokens, Midnight, a11y, responsive nav, remove fake 9:41 (done), correct back, notification controls, PWA update, perf pass, regression suite

---

## What We Will NOT Add (Per Brief)

Public feed, AI chat, virtual store, badges economy, leaderboards beyond 2, meal plan, pantry inventory, budget, location tracking, rebrand, desktop-first, animation everywhere.

---

## Next Steps (Next Turn)

1. Spawn 3 parallel implementers:
   - Dates engine + Zod schemas + vitest setup
   - Supabase interim hardening + migration doc + export
   - Visual token pass 1 (CSS vars extension)

2. Then main App.tsx patcher for Phases 0-4 immediate bugs in order.

3. Keep Beta ZIP as rollback.

**Rollback:** Current Beta `nylah-os-GitHub-Pages-BETA.zip` 184K with `index-5bbchy8n.js` 616K is safe restore point if any phase breaks.
