# Agent 2 — Data Integrity & Sync Audit — Nylah OS

**Date:** 2026-08-03  
**Source files inspected:**
- `client/src/App.tsx` (~2950 lines, BETA `index-5bbchy8n.js` 616K)
- `client/src/lib/supabase.ts` (tolerant LS + Vite env + window.__SUPABASE__)
- `client/src/lib/remoteSync.ts` (12248 B, CAS with mergeById + 7d tombstone)
- `supabase-init.sql` (couple_data single-row jsonb, seed + realtime + permissive RLS)
- `supabase-revision-migration.sql` (`revision bigint default 0`)
- hidden_files prior QA (709 lines)

---

## Executive Summary

| Area | Severity | Current | Safe? |
|---|---|---|---|
| Single-row JSONB store | **CRITICAL** | `couple_data.id=ash-ciaran-2026` with 4 jsonb arrays | No — all prototype risk |
| Concurrent edits | **HIGH** | revision CAS exists but with fallbacks to LWW | Partial |
| Offline queue | **HIGH** | 800ms debounce auto-push, no durable queue | No |
| Duplicate prevention | **MED** | body-dedup for notes only, chores title check | Fragile |
| Deletion / tombstones | **MED** | `deletedAt` soft-delete + 7d purge in `mergeById` | Interim ok |
| Per-device vs shared | **HIGH** | `themeId`,`currentUser` written into household `meta` | Violates principle |
| Personal/Wants sync | **HIGH** | `couple_v1_shopping_personal` localStorage only | Breaks cross-device |
| RLS | **CRITICAL** | `Allow all for anon FOR ALL USING (true)` | No isolation |
| Auth (PIN) | **CRITICAL** | `PIN_MAP={"4463":"aisling","1958":"ciaran"}` hardcoded, hint rendered | Only local lock |
| Migrations | **MED** | additive IF NOT EXISTS, seed row, revision backfill | No version tracking |

BETA passes functional QA (no 9:41, single UpdaterBanner, 0 Sheets refs, SyncStatusIsolated present) but **not trustworthy for household data under concurrent offline edits.**

---

## 1. Supabase Schema

**Current (`supabase-init.sql`):**
```sql
CREATE TABLE IF NOT EXISTS couple_data (
  id text primary key,
  chores jsonb default '[]',
  calendar jsonb default '[]',
  shopping jsonb default '[]',
  notes jsonb default '[]',
  meta jsonb,
  updated_at timestamptz default now()
);
-- + duplicate public.couple_data
CREATE POLICY "Allow all for anon" ON couple_data FOR ALL USING (true) WITH CHECK (true);
-- publication add_table for realtime
INSERT INTO couple_data VALUES ('ash-ciaran-2026', '[]'::jsonb, ...) ON CONFLICT DO NOTHING;
```
+ migration:
```sql
ALTER TABLE couple_data ADD COLUMN IF NOT EXISTS revision bigint DEFAULT 0;
UPDATE couple_data SET revision = COALESCE(revision,0);
```

**Problems:**
- One row = one household. No `households` table, so second household impossible.
- JSONB arrays unbounded (photos as data URLs truncated via string slice — corrupt image data, 24-note limit alert workaround).
- No indexes on item IDs.
- No `created_by`, `updated_by`, `deleted_at` columns at row level (soft delete only inside JSON).
- No FK, no constraints, no check `jsonb` schema.

**Interim hardening (safe to apply now):**
```sql
ALTER TABLE couple_data ADD COLUMN IF NOT EXISTS revision bigint DEFAULT 0 NOT NULL;
ALTER TABLE couple_data ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE couple_data ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
-- keep jsonb but add GIN?
CREATE INDEX IF NOT EXISTS idx_couple_data_updated_at ON couple_data(updated_at);
-- seed revision if null handled.
```
Keep household data, no destructive alter.

**Long-term (per Product Principles):**
```
households (id uuid pk, name text, timezone text default 'Europe/Dublin', created_at)
household_members (id uuid, household_id fk, user_id fk auth.users, role enum[t owner,member], display_name, initial)
devices (id uuid, household_id, member_id, last_seen, push_token)

chores (id uuid pk, household_id, template_id nullable, title, type enum[t one-off,repeat], frequency, frequency_detail, due_at timestamptz, created_at/by, updated_at/by, revision bigint, deleted_at)
chore_votes (id uuid, chore_id fk, member_id, vote enum[t mine,nope,discuss], created_at, mutation_id unique)
chore_completions (id uuid, chore_id fk, claimed_by, completed_by, marked_done_by, base_points, multiplier, awarded_points, scoring_version, completed_at, mutation_id unique)

chore_templates (id uuid, household_id, title, effort int, recurrence rrule text, default_window_h, semantic_rule jsonb, active bool)

events (id uuid, household_id, template_id?, title, start_at timestamptz, end_at, all_day bool, location, notes, status enum[draft,proposed,awaiting_aisling,awaiting_ciaran,needs_discussion,agreed,declined,cancelled,completed], proposer_id, revision, deleted_at)
event_responses (id uuid, event_id, member_id, response enum[yes,no,discuss], comment text, responded_at, mutation_id unique)
event_templates (id uuid, household_id, rrule, ...)

shopping_items (id uuid, household_id, name, qty numeric, unit, cat enum[food,household,toiletries,clothes,bills,trips,entertainment,personal,other], state enum[active,purchased,archived,deleted], added_by, requested_for member_id?, notes, expires_at nullable, created/at, updated/at, revision, deleted_at, mutation_id)
shopping_templates (id uuid, household_id, name, cat, typical_freq, suggested bool, personal_for member_id nullable, history jsonb)
shopping_history (id uuid, item_id, action, qty, member_id, at, meta jsonb)

notes (id uuid, household_id, body, author_id, photo_path text null -- storage bucket -- , thumbnail_path, pinned_at, archived_at, deleted_at, edited_at, created_at, revision)
note_reads (id uuid, note_id, member_id, read_at)
note_reactions (id uuid, note_id, member_id, reaction enum[heart,laugh,kiss,ack], created_at, mutation_id)

mutation_log (id uuid pk, household_id, entity_type, entity_id, mutation_id text unique, actor_member_id, device_id, op enum[create,update,delete], payload jsonb, revision_expected, revision_applied, created_at, synced_at)
```

Every entity gets `id, household_id, created_at, created_by, updated_at, updated_by, revision, deleted_at`.

---

## 2. Realtime Behaviour

**Current (`remoteSync.ts`):**
```ts
const ch = sb.channel('couple_data_'+ROW_ID)
  .on('postgres_changes', {event:'*', schema:'public', table:TABLE, filter:`id=eq.${ROW_ID}`}, payload=>{ cb({chores:r.chores||[], ...}) })
  .subscribe()
```

+ In `App.tsx`:
```ts
try { unsubReal = subscribeRemote(remote=> mergeRemoteIntoLocal(remote,{force:true})) } catch {}
let lastSyncOk=Date.now()
const focus = ()=> { stale = Date.now()-lastSyncOk>5*60*1000; if(stale||!hasConfig) syncFromRemote() }
window.addEventListener("focus", focus)
document.addEventListener("visibilitychange", onVis) // onVis is variable (bug fixed earlier)
```

**Good:**  single channel per row, cleanup on unmount, no duplicate polling (earlier 60s poll removed in QA FINAL).

**Risks:**
- `postgres_changes` only fires for committed row changes; supabase `maybeSingle` selects whole row — large payload (4 arrays) on every keystroke debounce 800ms can cause channel back-pressure.
- No health check: if channel `CLOSED` or `CHANNEL_ERROR`, no retry / exponential backoff.
- Initial `trySupabaseLoad` does `mergeRemoteIntoLocal(...,{force:true})` inside effect with empty dep array — races with concurrent IDB hydrate (IDB set/get fallback present but not awaited).

**Interim fix:**
- Track channel status, on error schedule reconnect 5s → 30s with jitter.
- Debounce remote inbound: if 3 pushes in 1s, coalesce.
- Keep `lastSyncOk` in ref, not closure variable.

**Severity:** MED

---

## 3. Concurrent Edits

**Current (`remoteSync.ts: remoteSave`):**
```ts
let existing:any=null; existingRevision=0
try { const {data}= await sb.from(TABLE).select('id,chores,calendar,shopping,notes,meta,updated_at,revision').eq('id',ROW_ID).maybeSingle()
      if(data) existingRevision=data.revision ?? 0
} catch(e){ // revision column may not exist yet
  const {data}= await sb.from(TABLE).select('id,chores,calendar,shopping,notes,meta,updated_at') ... }

payload.revision = expectedRev +1
...
if(payload.revision!=null){
  const q = await sb.from(TABLE).update(payload).eq('id',ROW_ID).eq('revision',expectedRev).select()
  if(!err && (!res||res.length===0)){
    // conflict: reload & merge per item, retry once
    const {data:fresh}= await sb.from(TABLE).select('*').eq('id',ROW_ID).maybeSingle()
    merged={chores:mergeById(payload.chores,fresh.chores), ... , revision:fresh.revision+1}
    retry = await sb.from(TABLE).update(merged).eq('id',ROW_ID).eq('revision',fresh.revision).select()
  }
}
```

**What works:** true CAS when `revision` column exists. Prevents naive whole-row LWW. MutationId dedup (`couple_v1_last_mutation`) prevents double tap scoring.

**What breaks:**
- `expectedRev` defaults to `existingRevision` read 1 line earlier — TOCTOU: two clients both read rev=5, both try update eq 5 — first wins (6), second sees empty `res` and goes into merge/retry path. Merge uses `mergeById(local, remote)` where `b>a` wins — but `updatedAt` comes from client clock (device can be wrong). Device with future clock wins forever.
- If revision column missing (old DB), code falls back to plain `update().eq(id)` — full LWW.
- `payload` built with `...existing.chores` fallback: if partial only contains `notes`, it copies existing `chores` into payload, overwriting concurrent chore edit that happened between `select` and `update` unless merge branch triggered.
- No atomicity for race chores: two devices `claimDone` at same time — both set `status=done`, `completedBy`, both get merge, whichever has larger `updatedAt` wins; losing device doesn't get immediate feedback, may think it won. Needs server-side function / RPC.

**Fix (interim, no schema break):**
- Always include `updatedAt` as server-generated (not trust client) — currently `withTimestamps` uses client ISO now if missing.
- Use `maybeSingle().limit(1)` not needed.
- In merge, prefer `existing` revision + merge per field, not whole array replace.

**Severity:** HIGH

---

## 4. Last-Write-Wins Risks

As above. BETA reduced risk from **3/10 → ~6/10** (QA FINAL note) but still fragile for high-traffic actions (chore duel simultaneous swipe).

**Scenario: Aisling & Ciaran swipe same deck card simultaneously**
1. Device A reads rev 10, sets `swipes.aisling = right`, saves rev 11
2. Device B read rev 10 slightly earlier, sets `swipes.ciaran = right`, sends update rev 11 → conflict detected, merge path loads fresh rev 11 (which has Aisling's swipe). `mergeById` will compare updatedAt: B's newer timestamp > A's → B's whole card replaces A's card if B's timestamp wins, losing Aisling's swipe.

`mergeById` currently merges per ID, not per field inside object. So concurrent field-level updates clobber.

**Recommendation:** split votes into `chore_votes` table (or at least store `swipes` as separate keys) + server-side merge function that does shallow field merge when both updated same object but different keys.

Temporary mitigation: store `updatedAt` per field, or bump `updatedAt` only when that field changes and merge per field if `updatedBy` differs.

**Severity:** HIGH

---

## 5. Offline Changes

**Current:** auto-push effect (`App.tsx:2518`):
```ts
useEffect(() => {
  const raw=localStorage.getItem("couple_v1_auto_push"); if(raw false) return;
  if(hasSupabaseConfig()){
    window.dispatchEvent('couple-sync','saving')
    const h=setTimeout(()=>{ const rev = Number(localStorage.getItem('couple_v1_revision')||'0'); remoteSave({... expectedRevision:rev}) ... },800)
    return ()=>clearTimeout(h)
  }
}, [choresRaw, calendarRaw, shoppingRaw, notesRaw])
```

- Triggers on every array change (4 arrays). 800ms trailing debounce.
- If navigator.offline → dispatches `offline` but does NOT enqueue mutation.
- No persisted queue: reload while offline loses pending optimistic UI? Actually localStorage persists because optimistic is direct state, but pending mutation never retried unless user changes something else while online again (effect re-fires because deps changed? No, because change already made, effect already ran offline and failed, won't re-run unless array reference changes again).
- No outbox table, no retry count, no backoff, no mutation ID chain.

**Interim fix safe without breaking:**
```ts
type OutboxItem = {id:string, mutationId:string, payload:Partial<RemoteData>, tries:number, at:string}
localStorage key couple_v1_outbox = JSON.stringify(array)
on remoteSave fail && navigator.onLine===false → push to outbox
on window 'online' → drain outbox in order, each with merge retry
on visibility change to visible & stale>5m → also drain
```
Preserve household data, no new tables.

**Long-term:** `mutation_log` + per entity `revision` + Dexie / IndexedDB queue.

**Severity:** HIGH

---

## 6. Mutation Retries

- Single retry inside conflict branch only.
- On network error, `remoteLoad` returns null silently, `remoteSave` returns false, sets `couple_v1_last_push_err` truncated 180 chars.
- No exponential retry; user must trigger another change or reload.
- `SyncStatusIsolated` polls localStorage every 1s (its own interval, isolated from root) — not global rerender anymore (fixed QA FINAL), so acceptable but inefficient.

**Recommendation:** use `navigator.serviceWorker` background sync if available, else retry with 2s, 8s, 30s capped 3 tries. Never loop forever.

---

## 7. Duplicate Prevention

**Chores:** `dup = chores.some(c.title.toLowerCase().trim() === low && status!=='done' && !deletedAt)` in Add form — case-insensitive duplicate block but only within local array, not server truth. Two devices can create same title race -> duplicate rows.

**Calendar:** no duplicate prevention.

**Shopping:** no duplicate active check? Previous audit says suggested but not enforced. Code path: `extractTags` etc but not dedup.

**Notes:** `notesRaw` body dedup in merge:
```ts
const bodies = new Set(cur.map(x=> String(x.body||"").toLowerCase().trim()))
for (m of notes) { const bk = String(m.body).toLowerCase().trim(); if(bodies.has(bk)) continue; ... }
```
- Identical bodies allowed per spec — requirement #9 says identical note bodies must be allowed and not deduped. Current dedup violates spec, can silently drop legit love note repeated phrase ("I love you").
- Dedup based on body only, not author + timestamp. Should be ID-based only.

**Fix:** remove body set dedup, keep ID-based only.

**Mutation dup:** `couple_v1_last_mutation` dedup prevents double tap but only last 1 ID, not log. If same mutation retried after reload (offline) with fresh UUID, it would create duplicate (e.g., chore completion awarded twice). Needs unique constraint on `mutation_log.mutation_id`.

Severity: MED

---

## 8. Deletion Behaviour (tombstones 7d present?)

**Current in `remoteSync.ts`:**
```ts
function withTimestamps(arr){ return arr.map(it=> ({...it, updatedAt: it.updatedAt||now, updatedBy: updatedBy||it.author||'unknown'})) }

function mergeById(local, remote){
  const map=new Map()
  for(it of [...remote,...local]) {
    if(b>a) map.set(id,it)
    if(it.deletedAt && !existing.deletedAt) if(b>=a) map.set(id,it)
  }
  for(v of map.values()){
    if(v.deletedAt){
      const t=new Date(v.deletedAt).getTime()
      if(isNaN(t) || (now-t)<7*24*3600*1000) out.push(v) else continue // purge after 7d
    } else out.push(v)
  }
  return out
}
```

+ UI filter: `chores.filter(c=>!c.deletedAt)`

**Good:** soft delete propagated via sync, 7d retention allows offline devices to learn about delete, purge after 7d prevents array bloat indefinitely. No `alert()` for delete, but blueprint debug panel has "Delete all remote (wipe)" — violates principle #1 of settings (destructive tools in normal UI).

**Edge:**
- `withTimestamps` does NOT copy `deletedAt` if already present? It does (spread). But it always overwrites `updatedAt` if missing only — if you set `deletedAt` with old `updatedAt` timestamp, merge may lose to newer undleted version (b<a). Need to bump updatedAt when setting deletedAt.
- Purge is during merge only — if a client never syncs for >7d, tombstone may have been purged on other clients but stale client resurrects entity on next push because it still has undelted version with no deletedAt but older updatedAt? Actually if stale client hasn't seen delete, its updatedAt older, so merge would keep delete if delete's updatedAt newer. Since delete updates updatedAt, safe. But if client modifies item at same time another deletes it (same second), tie-breaker random.
- No server-side garbage collection — if user never opens app for 7d, tombstone stays in row forever (payload includes it next save). Minor.

**Interim hardening:**
- When setting `deletedAt`, always set `updatedAt = now` (force).
- Ensure `setNotes` delete path sets `deletedAt` not splice.
- Hide "Delete all remote (wipe)" behind `?debug=1` only.

Severity: MED (tombstone logic acceptable for BETA, needs server-side purge job long-term).

---

## 9. Per-Device vs Shared Preferences

**Violations found:**

```ts
// App.tsx auto-push payload
remoteSave({ chores, calendar, shopping, notes, meta:{ currentUser, themeId, syncedAt: new Date().toISOString() } })
// blueprint settings
const [persistedUserRaw]= useLocalState<PersonKey|null>("couple_v1_currentUser", null)
const [themeId]= useLocalState<string>("couple_v1_theme","peach")
// standalone effect deletes localStorage currentUser every launch then uses sessionUser — good for privacy but confusing
```

- `currentUser` (who is using device) should NOT be in shared `meta`. If Aisling's phone saves `currentUser=aisling`, Ciaran's phone loading remote will merge meta? Currently they do `payload.meta = {...existing.meta, ...partial.meta}` — so `currentUser` from one device overwrites household meta, other device reads it on load? `mergeRemoteIntoLocal` does not use meta except to restore? Actually `mergeRemoteIntoLocal` extracts `{chores,calendar,shopping,notes}` only, ignoring remote.meta except for `updated_at`. So currentUser leakage is limited but still pollutes row and triggers syncStatus.
- `themeId` in meta similarly pollutes. Requirement: theme is device preference unless explicitly shared. BETA shows `theme` CSS vars applied correctly but storing shared is wrong.
- `Personal/Wants` (`couple_v1_shopping_personal`) purely localStorage; shopping item `addedBy` is synced but personal tag lists aren't. Opening on second device shows 0 personal items — breaks expectation.
- Device prefs that should be local: `currentUser` (per device session), `themeId`, `reducedMotion`, `last tab`. Shared prefs: `household name`, `timezone` (`Europe/Dublin`), `member list`.

**Fix:**
- Stop writing `currentUser` and `themeId` to Supabase. Keep only in LS: `couple_v1_currentUser`, `couple_v1_theme`.
- Add `household_settings` JSONB inside `meta` for truly shared: `{household_name, timezone, member_roles}`.
- Move Personal/Wants to synced store: either as `shopping_templates` with `personal_for` member_id, or separate `shopping_items` with tag `personal` + `requested_for`. Ensure sync via remote.

Severity: HIGH

---

## 10. RLS (Row Level Security)

**Current:**
```sql
ALTER TABLE couple_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all for anon" ON couple_data;
CREATE POLICY "Allow all for anon" ON couple_data FOR ALL USING (true) WITH CHECK (true);
```

- `true` = any anon key can read/write any row if they know table name. Since Supabase anon key is public (exposed in baked `supabase-env.js` + `supabaseUrl`/`anon` localStorage), anyone on internet can scan or overwrite household data by guessing table.
- Row ID `ash-ciaran-2026` is security-through-obscurity. TOKEN same value.
- No distinction Aisling vs Ciaran vs unrelated user.

**Interim (least-break for BETA, no auth UI yet):**
```sql
-- Keep anon but at least restrict to known ID
DROP POLICY "Allow all for anon" ON couple_data;
CREATE POLICY "row-token" ON couple_data FOR ALL USING (id='ash-ciaran-2026') WITH CHECK (id='ash-ciaran-2026');
-- and same for public.couple_data
```
Still anon but limits scan of other rows.

Better interim: switch to server-side edge function that checks TOKEN header (existing TOKEN already used `ash-ciaran-2026`) before allowing write. Requires edge.

**Long-term (required by spec):**
- Enable Supabase Auth (email or magic link).
- `auth.users` → `household_members` FK.
- Policies:
```sql
CREATE POLICY "members can read own household" ON chores FOR SELECT USING (household_id IN (SELECT household_id FROM household_members WHERE user_id=auth.uid()));
CREATE POLICY "members can insert" ON chores FOR INSERT WITH CHECK (household_id IN (SELECT household_id FROM household_members...));
-- update only if membership and not deleted etc
```
- Add anon blocked: `FOR ALL USING (auth.role()='authenticated')`.
- Test with 4 principals as spec: Aisling auth, Ciaran auth, unrelated auth, anon -> expect 0 rows.

Severity: CRITICAL (blocks production launch)

---

## 11. Authentication (PIN 4463/1958 hardcoded)

**Current (`App.tsx`):**
```ts
const PIN_MAP: Record<string, PersonKey> = { "4463": "aisling", "1958": "ciaran" };
// hint rendered:
<div className="text-[10px]">4463=Á • 1958=C • other codes blocked</div>
```

- Both PINs baked in JS bundle (minified but trivially readable). `index-5bbchy8n.js` contains map.
- Displayed in UI (hint), also in preview banner `PIN 4463=Á 1958=C` when not standalone.
- Treated as authentication, but only local lock. Any person with device can try codes (only 10k combos) or read JS.
- No rate limit beyond visual shake, no biometric, no recovery besides trying other code.
- Identity switch allowed inside `ChoresPage` via `viewer` state derived from `currentUser` — violates chore page requirement 6: "Do not allow identity switching inside Calendar/Chores."
- `standalone` effect deletes `couple_v1_currentUser` each launch, so user asked for PIN every fresh open (good for shared device but annoying). No "Remember me" toggle per spec.

**Fix timeline:**
- Short term (BETA keep): hide hint in production (`?debug` only), obscure PIN_MAP via hashed or server check, add 3-attempt 30s lockout, store attempt count in LS.
- Mid term: replace PIN as auth with Supabase Auth + local PIN as device unlock only. PIN hashed (bcrypt) stored per device, not per household.
- Long term: each member has own account, device signs in once, optional biometrics, profile switch requires re-auth.

Severity: CRITICAL but acknowledged prototype limitation — must not ship to extended family.

---

## 12. Data Migrations

**Current approach:**
- `supabase-init.sql` is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`) — safe to re-run.
- `supabase-revision-migration.sql` adds column if not exists, backfills 0.
- No version table, no down migration.
- Export path: `BlueprintPanel` "Delete all remote (wipe)" uses `remoteSave({chores:[],..., allowEmpty:true})` — correctly guards empty wipe but dangerous. Nuke localStorage keeps supabase creds, removes other keys.
- Rollback: manual re-export before destructive? No automated export, no versioned backup.

**Needed before any schema normalization:**
1. Export current household record:
   ```ts
   const dump = await supabase.from('couple_data').select('*').eq('id','ash-ciaran-2026').single()
   localStorage.setItem('couple_v1_backup_'+Date.now(), JSON.stringify(dump.data))
   // plus download JSON file
   ```
2. Validate: JSON parse, array lengths, photo dataURL integrity.
3. Create `supabase_migrations` table:
   ```sql
   CREATE TABLE IF NOT EXISTS supabase_migrations (id text pk, applied_at timestamptz default now(), checksum text);
   ```
4. Migration script idempotency: check `supabase_migrations` row before running, wrap in transaction (Postgres doesn't support DDL transaction fully but can for column add).
5. Rollback instructions document (how to restore from backup JSON via `remoteSave({...backup, allowEmpty:true, expectedRevision: current+1})`).

**Existing risk:** changing from arrays to normalized tables requires backfill that preserves IDs. Current IDs are `uid("id")` random (6 chars + timestamp). Normalized migration must keep those IDs to keep references (tombstones reference id). Need mapping CSV.

---

## Detailed Check Answers

### Does remoteSync use revision compare-and-swap correctly? eq revision retry merge logic
Partially correct but not bullet-proof. Code does `update().eq('revision', expectedRev)` and retries with `mergeById`. Good direction. Flaws: TOCTOU, client-clock reliance, fallback to LWW when column missing, payload construction copies existing arrays even when partial (can overwrite concurrent edit of sibling entity).

### Does mergeById handle updatedAt comparison, deletedAt tombstone 7d purge?
Yes — implements updatedAt comparison (`new Date(...).getTime()`) and keeps tombstones <7d (`now - t < 7*86400*1000`). Drops expired tombstone. Edge: if `updatedAt` missing falls back to 0, newer but with missing timestamp could lose. Tombstone win condition only checks `b>=a` when `it.deletedAt && !existing.deletedAt`. No check when both have deletedAt (different deletion times). Acceptable for BETA.

### Does withTimestamps add updatedBy/updatedAt?
Yes: `updatedAt: it.updatedAt || it.updated_at || now`, `updatedBy: updatedBy || it.updatedBy || it.author || 'unknown'`. Does not overwrite existing `updatedAt` — preserves original edit time. That's good for stable `updatedAt`. But when deleting, should force bump.

### Does load merge handle additive vs authoritative?
`mergeRemoteIntoLocal` logic:
- `totalRemote===0 && !force` → skip (incognito fresh guard)
- `allowWipe = force || had_remote==='1'`
- `shouldAuthoritative = isFresh || force || (remoteMs > lastSyncMs)`
- If authoritative or local length 0 → replace with remote (+ recentLocalOnly 120s grace)
- Else additive: push missing remote ids.

Problem: if remote empties a list legitimately (user deletes all chores), `totalRemote===0` guard prevents wipe unless `allowWipe`. But `remote.chores` empty while other arrays non-empty still has `totalRemote>0`, so wipe of that single array happens via `applyArray` branch (check length 0 + allowWipe). Works but fragile.

### Is Personal/Wants syncing or local-only?
Local-only (`useLocalState` LS). BUG: violates shopping completion requirement 2. Two devices show different personal lists.

### Is theme/device preference stored as household truth?
Yes — themeId and currentUser in `meta` persisted to row. Violates principle 4. Should be LS only.

### Mutation ID dedup, offline queue
Mutation ID is random UUID per save, stored as `couple_v1_last_mutation` only last 1. Dedup works for double-tap but not for offline replay. No queue. Offline changes sit in LS optimistic array but not retried automatically unless another edit triggers auto-push. Needs outbox.

---

## Recommended Action Plan

### Phase 0 (Before BETA launch to family)
- Hide PIN hint behind `?debug` or remove. Add 3-strike lockout.
- Change RLS to `id='ash-ciaran-2026'` only (not true).
- Move Personal/Wants into synced `shopping` with `personal_for` field or separate table still via same row (interim) — include in `remoteSave` payload.
- Remove `currentUser, themeId` from `meta` payload.
- Fix notes body dedup (remove Set bodies).
- Add forced `updatedAt=now` when setting `deletedAt`.

### Phase 1 (Security)
- Supabase Auth accounts for Aisling/Ciaran (magic link).
- `household_members` table.
- RLS policies tested with 4 principals.
- Edge function to migrate current anon row to first auth user.

### Phase 2 (Sync robustness)
- Introduce `couple_v1_outbox` LS queue.
- Add `mutation_log` table (or JSONB array inside row interim).
- Replace client-clock `updatedAt` with server `updated_at` returned from `select()` as source of truth after save.
- Per-field merge for votes.

### Phase 3 (Normalization)
- Normalized tables + backfill preserving IDs.
- GIN indexes, RLS per table.
- Versioned migration with rollback doc.

---

## Appendix: Snippets Requiring Change

**App.tsx PIN leak:**
```ts
const PIN_MAP: Record<string, PersonKey> = { "4463": "aisling", "1958": "ciaran" };
<div>4463=Á • 1958=C</div>
```
Recommendation: move to env var check or server auth.

**RLS permissive:**
```sql
CREATE POLICY "Allow all for anon" FOR ALL USING (true) WITH CHECK (true);
```
Fix to `USING (id='ash-ciaran-2026')`.

**Personal local-only:**
```ts
const [personal, setPersonal] = useLocalState<PersonalWants>("couple_v1_shopping_personal", { aisling:{personal:[],wants:[]}, ciaran:{personal:[],wants:[]} })
```
Move to synced.

**Theme leakage:**
```ts
remoteSave({..., meta:{ currentUser, themeId, syncedAt:... }})
```
Remove `currentUser`,`themeId` from shared payload.

**Notes dedup violation:**
```ts
const bodies = new Set(cur.map(x=> String(x.body||"").toLowerCase().trim()))
if (!bk) continue; if (bodies.has(bk)) continue;
```
Violates identical bodies allowed — delete.

**Delete tombstone not bumping timestamp:**
```ts
// in App.tsx delete path (not shown) likely does setNotes(prev.filter) — should be setNotes(prev.map(n=> n.id===id? {...n, deletedAt: now, updatedAt: now} : n))
```

---

**Final verdict:** BETA is shippable as private prototype for 2 users who understand PIN limitation, with offline tolerated for short gaps. Not safe for multi-household or public link. Must address RLS + Auth + per-field merge before Phase 5 (Chore Duel competition).
