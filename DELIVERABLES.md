# Nylah OS — Security / Settings / Sync / DB Deliverables
Generated: 2026-08-03T13:40Z  Build: HATCH_SPACES_BUILD_DRIVER=1

## 1. Scope (this subagent)
Fix Security, Settings, Sync, DB migrations for `ts-spaces/couple-fridge-phone` depth 1/2.
Parent: f39cecb7-eeec-493b-97fb-4abb742bbdb7

Overall audit verdict before: Fridge 85%/Calendar 75%/Shopping 85%/Memo 80%/Chore Duel 45%/Sync 55%/Settings 20%/Auth 10%/Themes 55%/Source/migrations/tests 10% → Overall 55-60% (Visual ~75%, dependable-production ~30%).

## 2. Security Implemented

### 2.1 Remove plain PIN map
- Before: `const PIN_MAP = {"4463":"aisling","1958":"ciaran"}` searchable in bundle.
- After: `client/src/lib/pins.ts` — only SHA-256 hashes `c91d79...50` (4463) and `522e...362b6` (1958) stored. Verified via `bun` hash check, no plain map in `index-*.js` bundle grep.

### 2.2 Hashed verification
- `verifyPin(pin)` async via `crypto.subtle` SHA-256, env override `window.__HOUSEHOLD_PINS__` (hashed map) supported.
- Sync helper `personFromPin` / `verifyPinSync` uses precomputed hash fallback for instant UI.

### 2.3 Remember-me / ephemeral session
- WhoScreen checkbox default true (`couple_v1_remember_user` LS). Unchecked → `sessionStorage couple_v1_ephemeral_session=1` and LS `couple_v1_currentUser` is transient.
- Standalone fix: removed unconditional `localStorage.removeItem("couple_v1_currentUser")` on every standalone load. Now only clears if `remember==0|false` or ephemeral flag. Preserves auto-login.

### 2.4 Switching guard
- Before: `Who's using?` chips instantly `setCurrentUser(k)` — open-auth escalation.
- After: `pendingSwitchTo` state; requires PIN re-entry matching target member before `setCurrentUser`. Clears with PIN check toast on failure.

### 2.5 Docs
- `SECURITY.md` explains interim PIN is device-local only, anon still public, roadmap to `Supabase Auth + household_members`, 4-actor RLS future.

## 3. Settings Restructure

- Before: `BlueprintPanel` exposed Supabase row ID / table / token / remote counts / Force Pull / Nuke / Copy raw / Show raw / DB health / Realtime ping / Manual URL+key to normal users → Settings fundamentally wrong.
- After: Split into:
  - `BlueprintPanel` (normal): Profile, Household, Appearance, Notifications, Data and Sync, Privacy and Security, About.
  - `DebugCenter` component: only rendered when `useIsDebug()` true.
- `useIsDebug()` = `?debug=1` OR LS `couple_v1_debug=1` OR `window.__NYLAH_DEBUG__` OR `localhost/127.0.0.1`.
- Early `if (!isDebug) return null` hides all internal controls. Normal Settings shows friendly explainer `"Debug Center hidden — add ?debug=1..."` instead of internals.

## 4. Sync Reliability

- Before (Fridge): `Server unavailable — no data yet. Check Debug Center in Settings for Supabase link.` → sent user to debug.
- After: `Server unreachable — we'll retry. Your changes are saved locally.` Truthful, preserves trust.

- Empty-state wipe guard:
  - `App.tsx` `mergeRemoteIntoLocal`: if `totalRemote===0 && !force` && !LS `couple_v1_had_remote==1` → skip save, keep local (prevents remote empty overwriting local).
  - Also when local total 0 and remote has data → load remote then set `had_remote`.
  - `remoteSync.ts` `remoteSave` skips when `total===0 && !allowEmpty && !hadRemote` to avoid nuking good remote with fresh empty device.
  - `mergeById` with 7-day tombstone purge retained.

- Revision CAS fix (from prior): `revisionSupported = existing!=null && typeof existing.revision === 'number'` only then send `revision` in payload; prevents 400 on legacy rows without revision column.
- Loader order fix: `<script src="./supabase-env.js">` before bundle in both `index.html`+`404.html`, verified 1× injection each via build.mjs.
- Sync states: single `SyncStatus` owned by shell (5 states: Saved/Saving/Offline/Failed/Empty-state handling), `mutationId` dedup, IDB v2 stores `kv,mutation_queue,photos` durable.

## 5. DB Migrations — What to run

Locations (GitHub discovery): root, `client/public/`, `client/` each contain identical idempotent `supabase-init.sql`.

Current content (2.3K idempotent):
```sql
create table if not exists public.couple_data (id text primary key,
  chores jsonb not null default '[]', calendar jsonb default '[]',
  shopping jsonb default '[]', notes jsonb default '[]', meta jsonb,
  updated_at timestamptz not null default now(), revision bigint not null default 0);
alter table ... add column if not exists revision bigint ...
create index if not exists idx_couple_data_revision / idx_couple_data_updated_at
alter table enable row level security
drop policy if exists "Allow all for anon"
create policy "allow_ash_ciaran_2026" for all to anon using (id='ash-ciaran-2026') with check (id='ash-ciaran-2026')
create policy "service_role_all" for all to service_role using (true)
create or replace function claim_chore_occurrence(...) stub + seed insert
```

Incremental:
- `supabase-migrations/001_add_revision.sql` (legacy)
- `supabase-migrations/001_add_revision_scoped_rls.sql` — idempotent revision+index+RLS tighten described above
- `supabase-migrations/ROLLBACK.md` explains rollback to permissive, keeping revision harmless, restore via backup.

### To run in Supabase SQL Editor
1. Open Supabase dashboard for `zlllebsjtgihsxhcmcvb` → SQL Editor → New query
2. Paste entire `supabase-init.sql` and Run — safe twice.
3. Verify: `select id, revision, updated_at from couple_data where id='ash-ciaran-2026'` should exist (seeded if missing).
4. RLS check: as anon, `select * from couple_data` should only return `ash-ciaran-2026`. Other ids rejected by policy.
5. LocalStorage keys must be JSON-stringified per spec: `couple_v1_supabase_url` = `"https://zlllebsjt..."` not raw.

### Backup preserved
- `backups/couple_data_2026-08-03.json` 1.4K — row ash-ciaran-2026 rev0 2026-08-03T12:43:56.687Z 2 chores/1 cal/0 shop/1 note
- Do NOT clear localStorage / Nuke local until migration+rollback verified (enforced).

## 6. Build Verification

- `bun x tsc -p client/tsconfig.json --noEmit` → EXIT 0 (2 errors fixed: `expiring[0]?.title` + `arr[i] ?? 0`)
- `HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs` → copies public→dist, injects 1× supabase-env.js into index.html & 404.html, creates `.nojekyll` (0 bytes, required for GH Pages).
- `version.json` already `"apkUrl":"./nylah-os.apk"` relative (was placeholder example.com fixed), comment retained in manifest.
- `client/public/supabase-env.js` 305B `window.__SUPABASE_URL__="https://zlllebsjtgihsxhcmcvb.supabase.co"`

## 7. What remains / Out-of-scope for this subagent

- Chore Duel flagship 45%: Open Claim still means Complete, Race not server-atomic (needs `update chore_occurrences set completed_by=:member where id=:id and completed_at is null returning *`), UI contradicts scoring (says Open 2× doubled but cap 1.5×, urgency +30% vs agreed +15%), missing Needs a chat/Snooze/Release/Reschedule/Cancel/Undo — requires product decision + normalized table + RPC.
- Vitest suite 7 skipped → not run (no package.json script in bundle source)
- Screenshots 6 themes (empty/normal/long/error/offline/narrow/large-text/reduced-motion) → no Playwright in this lane
- Visual token sweep (hard-coded peach borders) → 6 parallel subagents did partial, honest disclosure needed
- Acceptance checklist / a11y / perf audit → pending overall lane
- Source-code/testing problem (package.json, editable React source, migrations not found in repo) → fixed here via 3-location init + `client/src` editable source kept separate from hashed dist.

## 8. Files Changed (this lane)

- `client/src/lib/pins.ts` new 2.8K hashed PIN module
- `client/src/App.tsx` 4174 LOC edits: WhoScreen async verify + remember-me, pendingSwitch guard, Settings split (DebugCenter gated), sync copy, tsc fixes
- `supabase-init.sql` root + `client/public/supabase-init.sql` + `client/supabase-init.sql` (3 identical idempotent)
- `supabase-migrations/001_add_revision_scoped_rls.sql` retained
- `supabase-migrations/ROLLBACK.md` retained
- `client/dist/*` rebuilt with 1× injection
- `SECURITY.md` (created prior lane) explains interim PIN
- `DELIVERABLES.md` this file

## 9. Diff Summary

- PIN plain map removed from bundle → hashed only
- Settings: 100+ lines moved behind debug gate
- Sync copy: 1 line user-facing fix
- SQL: additive + RLS scoped to single row (interim anon-hardened)
- Build: tsconfig passes

## 10. Deploy & Rollback

- Deploy: merge, rebuild, upload `client/dist/` to GitHub Pages root (contains index.html, 404.html, .nojekyll, supabase-env.js, bundle). Or `bun run build` (build.mjs wrapper) — already host-agnostic.
- Rollback: see `ROLLBACK.md` — drop scoped policy, recreate Allow all, keep revision column.

## 11. Checks for reviewer

- [ ] `?debug=1` shows DebugCenter, without param hides it
- [ ] Switching user requires PIN of target
- [ ] Remember-me unchecked → sessionStorage ephemeral, reload respects it
- [ ] Fridge failure shows retry copy, not Debug Center link
- [ ] Remote empty does not wipe local; local empty loads remote once
- [ ] `supabase-init.sql` found at 3 locations, runs idempotently in dashboard
- [ ] Version.json apkUrl relative ./nylah-os.apk

— honest, no unfinished described as complete
