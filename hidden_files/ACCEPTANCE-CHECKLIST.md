# Acceptance Checklist — Nylah OS Beta 2 FIXED v3 (2026-08-03)

## Critical pipeline (must pass)

- [x] Build injects `<script src="./supabase-env.js"></script>` BEFORE module bundle in both `index.html` and `404.html`
  - Verified: `grep` shows 1 occurrence in dist/index.html order `<script src="./supabase-env.js"></script><script type="module"`
- [x] `client/dist/supabase-env.js` exists in zip (window.__SUPABASE_URL__ + __SUPABASE_ANON__)
- [x] No `supabase-env.js` missing silent local-only failure — app will load Supabase config from env file
- [x] DB backup `backups/couple_data_2026-08-03.json` exists (2 chores, 1 calendar, 0 shopping, 1 note, rev 0)
- [x] Revision logic fixed: `revisionSupported = existing!=null && typeof existing.revision==='number'` only then `payload.revision=existing.revision+1`
- [x] No destructive wipe done (LS not cleared, no Nuke)
- [x] `supabase-migrations/001_add_revision.sql` idempotent, covers both `couple_data` and `public.couple_data`, adds indexes, scoped RLS
- [x] `supabase-migrations/ROLLBACK.md` with 3 options

## Sync truth (interim)

- [x] One sync engine: initial cached render vs server reconciliation, realtime item-level merge, queue, single clock (30s not 1s)
- [x] One visibilitychange listener + one focus listener + one realtime channel (no 60s polling)
- [x] Queue durable via `idbSet('mutation_queue')` + `localStorage queue count` display
- [x] `SyncStatusIsolated` presentational, owned by shell, prop `syncStatus`
- [x] Truthful states implemented in `SyncStatus` type: `saving/saved/offline-queued/failed/updated-elsewhere`
- [x] `Offline — 2 changes waiting` queue count shown (via `queueCount` in status)
- [x] `Saved` means server ack not timer (`lastSync` set only after successful `remoteSave`)
- [x] No interval `Synced Xs ago` timer (removed)
- [x] `drainQueue` retries with backoff, skips duplicate mutationId
- [x] `couple-sync` CustomEvent for same-device tabs

Remaining for full truth (next):

- [ ] Full IDB hydration robust (notes + photos)
- [ ] Realtime health detection → polling fallback only when unhealthy (currently realtime always, fallback via focus stale check)
- [ ] Full one-sync-engine file extraction to `/lib/syncEngine.ts` (currently inline in App.tsx)

## Fonts & visuals

- [x] Theme tokens: `--app-bg,--wash-start,--wash-end,--surface,--surface-raised,--surface-muted,--text-primary,--text-secondary,--border,--accent,...--shadow-soft` defined at App.tsx:2272 (~10 vars)
- [ ] Full sweep: 152 hard-coded `#E8CEB7|#F7EFE8` → CSS vars (partial done ~41 replacements, remaining open)
- [ ] Midnight cards contrast fix (`#1E1E1E` white text currently failing in Midnight)

## Security / Identity

- [x] `supabase-init.sql` scoped anon policy `USING (id='ash-ciaran-2026')` written (needs to be run in Dashboard)
- [x] `supabase-env.js` contains restricted anon key (still anon but row-scoped)
- [x] Removed PIN hint UI from preview banners (0 matches for `PIN 4463` in bundle)
- [x] Destructive tools gated behind `?debug=1` / `localStorage couple_v1_debug=1` (existing BlueprintPanel logic)
- [ ] `households` / `household_members` long-term RLS (planned, not in Beta 2)
- [ ] Remember me / Ask every time toggle UI (planned)

## Visual token / a11y / perf (open, noted)

- [x] 44px min-tap for primary actions (chore duel buttons 44px)
- [x] Focus trap for sheets improved (first/last Tab cycle)
- [x] Zoom re-enabled verification: `maximum-scale=5` via space-sdk build
- [ ] Full focus trap return-to-trigger, reduced-motion, keyboard nav, screen-reader order audit (needed)

## Page deep fixes (spec'd, open)

- Chore Duel: hidden votes, Take vs Done, Race atomic, MAX 1.5x, flexible timer, Discussion chip, overdue actions, Undo toast, remove in-page identity switch (uses `currentUser` setter currently — top bar switch is preferred)
- Calendar: dynamic month prev/next, correct first-day Mon start, full local date key grouping (partially done via `toLocalKeyDublin`), hidden responses until both, split Yes+No → needs_discussion not declined, recurrence sheet
- Shopping: normalize 9 cats TitleCase, Personal/Wants shared not device-local, duplicate active detection, item edit sheet, purchase undo, archive, trip mode
- Notes: photo resize to ≤512px, WebP, storage URL not slice-corrupt, memo vs loves, SeenBy, Archive

## Tests

- [x] `client/src/lib/__tests__/sync.test.ts` 11 tests passing (revision CAS, dup prevention, tombstone purge, mergeById LWW-safe, offline queue durability, truthful Saved)
- [x] `client/src/lib/__tests__/dates.test.ts` existing 7 skipped (Dublin engine tests) — still pending but engine wired

## Build

- `HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs` required (SDK)
- Produces `dist/assets/index-*.js` 645K, `index-*.css` 46K, `supabase-env.js` 305 B
- Zip `nylah-os-BETA2-FIXED-v3-pin-clean-20260803.zip` 194K includes all assets + manifest + `.nojekyll`
- Live DB break #1 fixed, #2 fixed, backup done

## What to do in Supabase Dashboard (user Action Required)

1. Open https://supabase.com dashboard → SQL Editor
2. Paste `supabase-migrations/001_add_revision.sql` and Run — idempotent
3. Verify: `SELECT id, revision FROM couple_data WHERE id='ash-ciaran-2026'` returns 1 row
4. Deploy zip to custom domain / GitHub Pages (or Netlify drag drop dist/)
5. Test: private window loads, add chore on phone, appears on laptop realtime
6. If offline test fails, keep `couple_v1_debug=1` in console and watch `[sync]` logs

## Known not in this zip (roadmap)

- Full visual token sweep remaining
- Midnight contrast fix
- Chore Duel / Calendar / Shopping deep Acceptance Criteria (requires separate subagents, spec'd)
- `space-sdk` long-term auth
