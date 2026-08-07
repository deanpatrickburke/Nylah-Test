# Task 1: Supabase integration QA - Report

## Done

### 1. BlueprintPanel Supabase Config UI (App.tsx 2148+)
- Patched `BlueprintPanel` to include Supabase live-sync panel ABOVE existing Theme panel
- Added state:
  - `supabaseUrl` useLocalState("couple_v1_supabase_url","")
  - `supabaseAnon` useLocalState("couple_v1_supabase_anon","")
  - `sbTestMsg` useState null, `sbTesting` boolean, auto-clear effect 3200ms
- UI:
  - Badge `SB linked` / `local-only` via hasSupabaseConfig()
  - Inputs for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
    - Value unwrapping handles JSON-stringified localStorage (JSON.parse) and raw http/eyJ cases
    - onChange calls saveSupabaseConfig(url, anon) which JSON-stringifies and nulls client cache
  - Test button async: `getSupabase()?.from('couple_data').select('id').limit(1)`
    - Messages: "No config — save URL + anon first", "Error: …", "OK — rows: N • id=…", Ex
    - Sets localStorage couple_v1_last_sync on OK
  - Hint: "saves to localStorage couple_v1_supabase_url / _anon JSON stringified • also honors VITE_ env"
  - Env precedence note, Row ID fixed ash-ciaran-2026 display

### 2. .env.example
- Updated at `~/workspace/ts-spaces/couple-fridge-phone/.env.example`
- Includes VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY placeholders, optional VITE_VERSION_URL, VITE_APPS_SCRIPT_URL fallback comment
- Notes on localStorage override, supabase-init.sql, TOKEN DEFAULT_TOKEN=ash-ciaran-2026

### 3. supabase-init.sql
- Ensured at `~/workspace/ts-spaces/couple-fridge-phone/supabase-init.sql`
- Required spec satisfied:
```sql
CREATE TABLE couple_data (id text primary key, chores jsonb default '[]', calendar jsonb default '[]', shopping jsonb default '[]', notes jsonb default '[]', meta jsonb, updated_at timestamptz default now());
ALTER TABLE couple_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON couple_data FOR ALL USING (true) WITH CHECK (true);
-- enable realtime: ALTER PUBLICATION supabase_realtime ADD TABLE couple_data;
```
- Extended safe-re-run: IF NOT EXISTS, public.couple_data mirror, DROP POLICY IF EXISTS before CREATE, DO $$ block with exception handling for duplicate_object, seed row ON CONFLICT DO NOTHING id=ash-ciaran-2026, security comment explaining open anon for 2-user prototype guarded by row id token, production suggestion.

### 4. version.json for updater
- Created `client/public/version.json` (also copied to `client/dist/version.json` and `client/version.json`)
- Content:
```json
{
  "version": "1.0.1",
  "code": 1,
  "build": "2026-08-03-ash-ciaran-2026-supabase",
  "changelog": "...",
  "mandatory": false,
  "apkUrl": "...",
  "supabase": {"table":"couple_data","rowId":"ash-ciaran-2026","token":"ash-ciaran-2026"}
}
```
- Public folder existed after mkdir -p; ensured Bun build assets hashing copies manifest/icon but not version.json, so post-build cp.

### 5. Icons / Manifest fix for Bun build 1.3.10
- Bun 1.3.10 HTML loader fails on absolute "/icon-192.png" and "/manifest.webmanifest" -> "Could not resolve"
- Created placeholder 1x1 PNGs (transparent) at:
  - client/icon-192.png, client/icon-512.png
  - client/public/icon-192.png, client/public/icon-512.png
  - dist/assets copies after build
- Changed `client/index.html` hrefs from "/icon-192.png" to "./icon-192.png" and "/manifest.webmanifest" to "./manifest.webmanifest"
- Copied public/manifest.webmanifest to client/manifest.webmanifest so Bun resolves "./manifest.webmanifest"
- Build now rewrites to "./assets/icon-192-<hash>.png" and "./assets/manifest-<hash>.webmanifest" correctly

### 6. Build verification
- Ran `HATCH_SPACES_BUILD_DRIVER=1 npm run build` (runs `bun run build:server && bun run build:client`)
- Initial fail: missing icon/manifest resolve -> fixed
- Final success: outputs
  - client/dist/index.html (1.3K, links to assets)
  - client/dist/assets/index-<hash>.js 575K, index-<hash>.css 42K
  - client/dist/assets/icon-192-<hash>.png 68B
  - client/dist/assets/manifest-<hash>.webmanifest 563B
  - client/dist/version.json 682B
  - server/dist/actions.js 66B
- No import errors: @supabase/supabase-js 2.111.0 already in package.json dependencies, lib/supabase.ts and remoteSync.ts imports succeed.

### 7. Empty-guard
- Verified `client/src/lib/remoteSync.ts` guard:
```ts
const relevantKeys = ['chores','calendar','shopping','notes']
const isTryingToWriteData = relevantKeys.some(k => Array.isArray(partial[k]))
const total = (chores+calendar+shopping+notes).length
if (total===0 && isTryingToWriteData && !allowEmpty) { skip save }
```
- Also per-field: if array present but length 0 without allowEmpty, payload falls back to existing (existing.chores etc) to avoid wipe
- Fetch existing before upsert to merge other keys
- Ensure at least one real array to upsert
- pushToSheet in App.tsx also guards: total 0 -> skip push log "[sync] skip push local total 0 - guard"
- Allows explicit clear via `allowEmpty:true` when user intends to clear
- Prevents fresh/incognito tab wiping remote row ash-ciaran-2026

### 8. Token/IDs
- TOKEN = ash-ciaran-2026 (DEFAULT_TOKEN in App.tsx, SB_TOKEN in supabase.ts)
- TABLE = couple_data
- ROW_ID = ash-ciaran-2026
- STORE previous = nylah-os-ash-v1 (LocalStorage + Supabase meta)
- Netlify fallback /.netlify/functions/couple-data kept

## Files created/edited
- Edited: ~/workspace/ts-spaces/couple-fridge-phone/client/src/App.tsx (BlueprintPanel patch)
- Edited: ~/workspace/ts-spaces/couple-fridge-phone/.env.example
- Edited: ~/workspace/ts-spaces/couple-fridge-phone/supabase-init.sql (safe-rerun)
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/public/version.json
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/public/manifest.webmanifest (overwritten updated)
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/public/icon-192.png (+312)
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/public/icon-512.png
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/icon-192.png (+512)
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/icon-512.png
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/manifest.webmanifest
- Created: ~/workspace/ts-spaces/couple-fridge-phone/client/version.json (mirror)
- Edited: ~/workspace/ts-spaces/couple-fridge-phone/client/index.html (hrefs relative)
- Build output: ~/workspace/ts-spaces/couple-fridge-phone/client/dist/index.html, assets/, version.json
- Build output: ~/workspace/ts-spaces/couple-fridge-phone/server/dist/actions.js

## Remaining / No APK rebuild
- APK not built per task (just web). Web build green.
- Updater expects version.json at /version.json same-origin or VITE_VERSION_URL Supabase Storage public bucket app-updates.

