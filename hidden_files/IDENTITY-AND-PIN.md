# Identity / PIN — Beta 2 Interim

## Current state (this build v3)

- WhoScreen still uses 4-digit PIN client-side: `4463=aisling / 1958=ciaran` stored in `PIN_MAP` in App.tsx. This is **device-local lock**, not auth.
- UI hint that printed mapping `PIN 4463=Á 1958=C` in preview banners **removed** in v3 (fix: delete public mapping from visible UI).
- PIN entry still present but no mapping shown. Text now: "4-digit code. Only you two know it."

## Why still present (Beta 2)

- True auth requires Supabase table `households` + `household_members` + RLS + magic link / passwordless + PIN as second factor. Not yet migrated to avoid data loss. Migration 001 only added revision + scoped policy, not new tables.
- Scoping RLS to `id='ash-ciaran-2026'` reduces surface vs `USING(true)` but anon key still required to be in client. Acceptable for Beta 2 household of two.

## Target design (long-term)

- `households(id text pk, tz text)` — one row ash-ciaran-2026
- `household_members(id uuid pk, household_id fk, person_key text check in ('aisling','ciaran'), display_name, pin_hash text, remember_device boolean)`
- Client flow:
  1. `?standalone` forces fresh PIN each load (currentUser cleared from LS+IDB)
  2. Normal PWA: if `couple_v1_currentUser` present + `remember_me=1` → skip PIN
  3. Otherwise WhoScreen → PIN compare against pin_hash (bcrypt via server edge function, not plain map)
  4. "Remember me / Ask every time" toggle writes localStorage `couple_v1_remember_device`
- Global profile switch in top bar: bottom sheet with larger avatars, verification sheet if switching away from remembered device (confirm with PIN)
- No in-page identity switching in Chore Duel / Calendar — viewer is person, but actions attributed to viewer; switch via global top bar only.

## RLS (long-term)

```sql
-- Example (to be in supabase-long-term-auth.md)
create policy "household members can read own household" on couple_data
for select using (id = (select household_id from household_members where auth.uid() = user_id));
```

Beta 2 interim uses scoped anon — see migration 001.

## Device prefs NOT shared

- `couple_v1_currentUser`, `couple_v1_theme`, `couple_v1_supabase_url` (override only via ?debug), `mutation_queue` metadata not uploaded via `remoteSync` as shared; `currentDevicePrefs` separated in code comments.
- Shared: chores, calendar, shopping (normalised), notes, meta.syncedAt.

## Checklist for this build

- [x] Removed printed mapping from preview banners (index.html check: 0 matches for PIN 4463)
- [x] No mapping printed in WhoScreen (only generic text)
- [ ] Still hardcoded PIN_MAP — to be replaced in 002_add_households (not in Beta 2)
- [x] `?standalone` clears currentUser each fresh load (existing logic)
- [ ] Remember me toggle UI — planned, not yet in this build (noted)
