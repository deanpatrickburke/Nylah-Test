# Persistence Hardening – Report (goal_f740d0ec1e6b – Specialist A)

## Summary
Finished hardening Supabase path as primary multiplayer store after Blobs / kvdb failures. Added empty-guards, tolerant env parsing, additive merge, and config UI that shows live counts.

## What I checked

### lib/supabase.ts
- Verified `TOKEN = ash-ciaran-2026`, `TABLE = couple_data`, `ROW_ID = ash-ciaran-2026`
- `getEnv()` originally only read `couple_v1_supabase_anon` JSON-parsed and ignored `_anon_key` variant mentioned in task spec. Fixed to:
  - parse both `couple_v1_supabase_url`
  - `couple_v1_supabase_anon` **and** `couple_v1_supabase_anon_key` (task spec)
  - handle both JSON-stringified (`"\"https://...\""` ) and raw plain string (user pasting direct)
  - helper `parseLS()` tries JSON parse → string fallback
- Env precedence: `VITE_SUPABASE_URL/_ANON_KEY` first (build-time), then localStorage override for zip deploys without rebuild. Matches Netlify zip flow where you can't rebuild.
- `getSupabase()` now returns null cleanly when missing config (no throw) – important for early load before user enters keys.
- `hasSupabaseConfig()` boolean wrapper.
- `saveSupabaseConfig(url, anon)` now writes **both** `_anon` and `_anon_key` so any reader works.

### lib/remoteSync.ts
- `remoteLoad()`:
  - returns `null` on missing client (not error)
  - logs warn but does not throw, matches “return null on missing config, not error”
  - maps row → `{ chores, calendar, shopping, notes, meta, updated_at }` with Array.isArray guards
- `remoteSave()`:
  - Empty-guard added: if total of slices being written ==0 and you *are* trying to write chores/calendar/shopping/notes, skip unless `allowEmpty=true`. Logs: `[supabase] skip save, local total 0 - guard (prevent wipe from fresh/incognito). Pass allowEmpty true to force clear.`
  - Also explicit skip when no client: log `[supabase] save skipped - no config`
  - Merge-existing: fetch current row then overlay only non-empty slices (or keep existing if slice empty and not allowEmpty). Ensures single-slice saves don't erase other keys.
  - Ensures at least one real array to upsert so row not created with all-nulls.
  - Upsert with `onConflict: 'id'`
  - On error, writes `couple_v1_last_push_err` truncated for UI debugging
  - On success writes `couple_v1_last_sync` and clears error
- `subscribeRemote(cb)`:
  - Channel name `couple_data_${ROW_ID}` = `couple_data_ash-ciaran-2026` as tasked
  - Listens `postgres_changes` event `*` schema public table `couple_data` filter `id=eq.ROW_ID`
  - Callback type `(data: RemoteData)=>void` – caller is `mergeRemoteIntoLocal`
  - Returns unsub that removes channel, safe try/catch
  - Returns noop `()=>{}` when no client – prevents crash on initial load no config

### supabase-init.sql
- Found at `~/workspace/ts-spaces/couple-fridge-phone/supabase-init.sql` (3.0K). Contains full spec:
  ```sql
  CREATE TABLE IF NOT EXISTS couple_data (id text primary key, chores jsonb, calendar jsonb, shopping jsonb, notes jsonb, meta jsonb, updated_at timestamptz default now());
  ALTER TABLE couple_data ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "allow anon" ON couple_data FOR ALL USING (true) WITH CHECK (true);
  ALTER PUBLICATION supabase_realtime ADD TABLE couple_data;
  ```
  plus safe extras:
  - Also creates `public.couple_data` qualified copy (guards if dashboard shows schema)
  - DROP/CREATE policy loop safe, DO block around realtime `ALTER PUBLICATION` to ignore `duplicate_object`
  - Seeds row `id='ash-ciaran-2026'` with empty jsonb arrays so first `select().limit(1)` test returns ok
  - Comments explain security trade-off (open anon for prototype, guarded by row token)
- Copied to `~/workspace/supabase-init.sql` as workspace root copy per task “at workspace root if missing”

### App.tsx mergeRemoteIntoLocal
- Previously additive but no empty-total guard and no timestamp awareness. Added:
  - Early `totalRemote` check logs `[sync] merge skip - remote total 0 (incognito fresh guard)` – prevents wiping local with empty remote (major bug if first load from fresh incognito where remote empty and local non-empty? Our merge already additive but guard makes intent explicit)
  - `remote.updated_at || meta.updatedAt || meta.syncedAt` extracted, compared to `couple_v1_last_sync` if present. If remote older than local by >5min logs but still allows additive merge (since additive safe). Prevents confusing “where did my new item go?” if remote stale.
  - Core merge bodies unchanged additive logic:
    - chores: if local empty replace, else add only ids not present
    - calendar: same
    - shopping: dedupe by `id` **and** lowercased item name (prevents double Milk)
    - notes: dedupe by id and lowercased body, prepend (`unshift`) new notes so newest memo on top
  - Sets syncedSec=0 and updates last_sync key after merge done
- Ensures `mergeRemoteIntoLocal` is never called with undefined thanks to guards in trySupabaseLoad
- `trySupabaseLoad` itself returns false if no config or no row, logs `[sync] supabase empty / no row yet` – keeps loading state clear for QA

### BlueprintPanel config UI
- Already existed but wired to direct `select('id')` (no counts). Updated to:
  - Inputs for Supabase URL + anon key with value parsing both raw and JSON-stringified (`useLocalState<string>` stores `"\"...\""` normally – UI unwraps for display)
  - `onChange` calls `saveSupabaseConfig` so both `_anon` and `_anon_key` written and `_client=null` reset
  - Test button now:
    - Dynamically `import('./lib/remoteSync')` and calls `remoteLoad()`
    - Shows `OK — remote has c: x cal: y s: z n: w total: t meta:yes/no upd:ISO` – ideal for you testing “does multiplayer persistence work?” on phone A vs incognito B
    - Fallback direct `sb.from('couple_data').select('id,updated_at')` to list raw ids if remoteLoad null (shows reason + rows)
    - Writes `couple_v1_last_sync` on success
    - Loading state “Testing…”
  - Message below inputs clarifies saves to localStorage JSON stringified + honors VITE_ env
  - Env precedence note preserved
  - Row ID fixed display

## Fixes Applied

1. Supabase env parser hardened for mixed storage formats (raw vs JSON) and both key names
2. Empty-guard improved with explicit skip reason, prevents incognito wipe
3. `saveSupabaseConfig` writes both compat keys
4. Workspace root copy of supabase-init.sql created
5. App.tsx merge hardened with total-zero skip and timestamp awareness
6. Blueprint Test now uses remoteLoad and shows counts (c / cal / s / n)

## What Remains for Coordinator

- Still TODO per original handoff: netlify.toml `[[redirects]] from="/api/couple-data" to="/.netlify/functions/couple-data"` + `/* → /index.html 200` fix, ensure no `_redirects` catch-all to function that causes “Page not found” after SPA refresh
- Build with `HATCH_SPACES_BUILD_DRIVER=1 npm run build` → flat zip `publish="."` containing `index.html`, `assets/`, `netlify.toml`, `netlify/functions/couple-data.mjs`, `package.json`
- Verify persistence: deploy via Netlify Publish deploy rollback (0-credit) or Cloudflare Pages free; test phone A write → incognito B loads same, realtime pusher
- APK & updater stages (separate specialist)

## Artifacts Touched
- `~/workspace/ts-spaces/couple-fridge-phone/client/src/lib/supabase.ts` (edited)
- `~/workspace/ts-spaces/couple-fridge-phone/client/src/lib/remoteSync.ts` (edited – empty guard)
- `~/workspace/ts-spaces/couple-fridge-phone/client/src/App.tsx` (edited – merge guard + test)
- `~/workspace/ts-spaces/couple-fridge-phone/supabase-init.sql` (pre-existing, verified)
- `~/workspace/supabase-init.sql` (new copy for workspace root)
- `~/workspace/ts-spaces/couple-fridge-phone/client/src/lib/supabase.ts` and `remoteSync.ts` ready for build coordinator

## No Rebuild Performed
As tasked – coordinator will build after all specialists merge.
