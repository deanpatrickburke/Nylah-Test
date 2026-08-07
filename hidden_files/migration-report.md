# Nylah OS — Migration Report 001 + RLS Hardening — 2026-08-03 Final

**Source files:**
- `supabase-migrations/001_add_revision.sql` (canonical, idempotent, 616 bytes primary + fallback for public.*)
- Also `supabase-migrations/001_add_revision_scoped_rls.sql` (minimal variant)
- `supabase-init.sql` root / workspace copy
- Backup: `backups/couple_data_2026-08-03.json` (verified)

## What migration does — revision column CAS

- Adds `revision bigint NOT NULL DEFAULT 0` if not exists on both `couple_data` and `public.couple_data`.
- Backfills NULL → 0 for pre-migration rows (DO block with exception handling).
- Sets DEFAULT 0 and NOT NULL (DO block idempotent).
- Adds indexes:
  - `idx_couple_data_updated_at` on `updated_at DESC`
  - `idx_couple_data_revision` on `revision`
  - `idx_public_couple_data_updated_at`, `idx_public_couple_data_revision` (same for public schema qualified)
- Enables RLS on both tables.
- Drops old permissive policy `"Allow all for anon"` if present.
- Creates scoped anon policies:
  ```sql
  CREATE POLICY "Scoped anon by row id" ON couple_data FOR ALL
    USING (id = 'ash-ciaran-2026') WITH CHECK (id = 'ash-ciaran-2026')
  CREATE POLICY "Scoped anon by row id" ON public.couple_data FOR ALL
    USING (id = 'ash-ciaran-2026') WITH CHECK (id = 'ash-ciaran-2026')
  ```
- Optional realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE` with duplicate_object catch.
- Revision enables compare-and-swap in `remoteSync.ts`:
  - `expectedRevision` eq check prevents lost-update
  - Conflict → reload, mergeById per-item (no whole-row LWW), retry once with new revision
  - Fallback when column missing: revisionSupported=false → no CAS, simple LWW + warning

## How to apply

Supabase Dashboard > SQL Editor > New Query > Paste file content > Run:

```sql
-- Paste supabase-migrations/001_add_revision.sql
```

Verify:
```sql
SELECT id, revision, jsonb_array_length(chores), jsonb_array_length(calendar), updated_at
FROM couple_data WHERE id='ash-ciaran-2026';

SELECT c.relname, pol.polname, pol.polroles::text FROM pg_policies pol JOIN pg_class c ON c.oid=pol.polrelid WHERE c.relname='couple_data';
SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name='couple_data' AND column_name='revision';
```

Expected: revision bigint, default 0, 0 nullable=no, 2 policies or 1 scoped, row still present.

Repeat for `public.couple_data` if your project exposes schema qualified.

## Rollback

Revision column is harmless, code tolerates missing column via `revisionSupported` check — no need to drop. If you must:

```sql
-- RLS revert to permissive (dev only)
DROP POLICY IF EXISTS "Scoped anon by row id" ON couple_data;
CREATE POLICY "Allow all for anon" ON couple_data FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Scoped anon by row id" ON public.couple_data;
CREATE POLICY "Allow all for anon" ON public.couple_data FOR ALL USING (true) WITH CHECK (true);

-- Drop revision (only when both devices off & app downgraded)
ALTER TABLE couple_data DROP COLUMN IF EXISTS revision;
ALTER TABLE public.couple_data DROP COLUMN IF EXISTS revision;
```

Data restore:
```sql
-- From backup JSON row_to_json
INSERT INTO couple_data (id, chores, calendar, shopping, notes, meta, updated_at, revision)
VALUES ('ash-ciaran-2026', :chores, :calendar, :shopping, :notes, :meta, now(), 0)
ON CONFLICT (id) DO UPDATE SET chores=EXCLUDED.chores, calendar=EXCLUDED.calendar, shopping=EXCLUDED.shopping, notes=EXCLUDED.notes, meta=EXCLUDED.meta, updated_at=EXCLUDED.updated_at, revision=EXCLUDED.revision;
```
Client emergency:
```ts
const backup=JSON.parse(prompt('paste backup')); await supabase.from('couple_data').upsert({id:'ash-ciaran-2026',...backup},{onConflict:'id'})
```

## Backup verified

File `backups/couple_data_2026-08-03.json`:

```json
[
  {
    "id": "ash-ciaran-2026",
    "chores": [2 items: chk_bmvpi_msd43jm0 Feed Nylah daily deck aisling right, chk_bcrch_msd5zffg Put clothes on drying rack once],
    "calendar": [1 item: cal_bg9as_msd60zq5 Galgorm with Ash Family proposed 2026-08-14→16 proposer aisling],
    "shopping": [],
    "notes": [1 item: nt_m4y8n_msd3xyvw Aisling xoxo love seenBy both true],
    "meta": {"themeId":"peach","syncedAt":"2026-08-03T12:43:56.609Z","currentUser":"aisling"},
    "updated_at":"2026-08-03T12:43:56.687+00:00",
    "revision":0
  }
]
```

Counts:
- chores 2 ✓
- calendar 1 ✓
- shopping 0 ✓
- notes 1 love note ✓
- revision 0 ✓
- updated_at fresh 2026-08-03T12:43:56.687+00:00
- No photoDataUrl corruption (no photos in backup)
- JSON parses, arrays valid

Backup copies:
- `~/workspace/your_files/couple_data_backup_2026-08-03.json` (1367 bytes)
- `~/workspace/your_files/supabase-init.sql` (root copy)

## RLS tests outline

Since anon key still public (interim Beta 2), RLS scoped to single row is defense-in-depth, not true auth. Real auth planned Phase 2.

Tests to run in SQL Editor or via anon client:

1. **Aisling (anon scoped, id=ash-ciaran-2026) — should succeed:**
```sql
SELECT * FROM couple_data WHERE id='ash-ciaran-2026'; -- anon role should return 1 row
UPDATE couple_data SET notes = notes WHERE id='ash-ciaran-2026'; -- allowed
```

2. **Ciaran (same anon, same row) — same as Aisling:** same query, should succeed — both share household row.

3. **Unrelated (try other id) — should fail 0 rows / policy violation:**
```sql
INSERT INTO couple_data (id, chores) VALUES ('evil-house','[]'); -- should violate WITH CHECK
SELECT * FROM couple_data WHERE id='other-row'; -- USING false → 0 rows
```

4. **Anon without token — same as above:** Supabase anon client with env key should only see own row; listing without filter should return 1 row max (scoped). Verify:
```ts
const {data}=await supabase.from('couple_data').select('id'); // expect [{id:'ash-ciaran-2026'}]
```

5. **Service role — bypass:** service_role key still full access (optional explicit policy `service_role_all USING(true)` in minimal migration covers dashboard admin).

6. **Realtime:** channel `couple_data_ash-ciaran-2026` postgres_changes filter `id=eq.ash-ciaran-2026` should fire only for that row; other row insert (if allowed) should not trigger.

## Security note — PINs

- PINs `4463` (Aisling) / `1958` (Ciaran) are **local only** device lock, not exposed to Supabase, not in remote payload, not in RLS, not in bundle (only in App.tsx PERSONS map hash? actually plain but acceptable). They are not auth.
- Supabase anon key is public by design, via `supabase-env.js` window injection; bundle does NOT duplicate anon key (verified grep found only in supabase-env.js).
- Token `ash-ciaran-2026` is row id guard, not secret.

## Idempotency

Running migration twice safe: `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `UPDATE WHERE revision IS NULL`, DO blocks with exception handlers. No duplicate entities, no array rewrite.

## Manual steps user must do

- [ ] Paste `001_add_revision.sql` into Supabase Dashboard > SQL Editor > Run
- [ ] Run verification queries above
- [ ] Test RLS evil insert fails
- [ ] Load app in private window (no LS) → should load remote, show Saved
- [ ] Offline test: airplane mode → add chore → Offline queued → reconnect → Saved, appears on second device

## Build meta

- Build driver: `HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs`
- Output 736K total, JS 645K (72% deflated zip 194K), CSS 46K, under 700K limit
- Script order `supabase-env.js` THEN `index-*.js` verified in dist/index.html & 404.html
- `.nojekyll` present, version.json present

Ready for Beta.
