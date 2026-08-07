# FIXES.md — Nylah OS V11 Mega (master 2026-08-04)

## V11 Mega Final — what’s fixed in this master
- Theme: paper/card #FFFEFB / #F7EFE8 / peach wash #E8CEB7 lavender, shadows soft/raised, topbar peach wash + grain, Fraunces 26px, avatar 44px, bottom-nav 64px blur 12px active #8B5E3C wash
- Build: index-6ahhryy3.js 542K (baked env zlllebsjtgihsxhcmcvb), index-3jnzr8b2.css 47K, version.json code 11 mandatory false, 2026-08-04-v11-mega-pazaz, SW nyla-os-v11-mega-pazaz, .nojekyll, 404.html SPA routing
- Packaging: 16-file flat root (no dist/dist) ready for ciaranf3308-star.github.io/nylah_os — delete old assets/ then drag

### Trust Audit 7 — all closed
1. offline queue marked processed before Supabase → queue deletes dup without write — FIXED: dedup now verifies remote meta.lastMutationId before skipping, early LS set removed
2. Saved indicator fabrications — FIXED: loading row no longer sets last_sync, realtime doesn't set Saved, applyRemoteSnapshot doesn't, touchSync doesn't (only queue check), init starts as saving not saved, only Saved after remoteSave verifies server meta.lastMutationId + revision advance
3. transient empty can wipe DB — FIXED: block empty write unless allowEmpty:true (total===0 && isTryingToWriteData && !allowEmpty), had_remote no longer gates empty, only explicit Delete ALL remote uses allowEmpty
4. every small edit rewrites whole household with stale data — FIXED: remoteSave now mergeById(local, remote) for chores/calendar/shopping/notes instead of blind overwrite; conflict CAS eq(revision) reload+merge+retry once
5. withTimestamps manufactures now — FIXED: preserves updatedAt/updated_at/createdAt only, no now(), updatedBy fallback unknown only if missing
6. Saved before server verification — FIXED: verify res[0].meta.lastMutationId and revision advance after update/insert, only then set last_sync/had_remote/last_mutation/revision
7. DebugCenter removed — FIXED: mounted inside BlueprintPanel behind ?debug=1, shows local c/cal/s/n, live Supabase c/cal/s/n+updated_at, Test Supabase button, Force pull, Nuke local & reload (clears LS/IDB, keeps DB)

### Perfect Multiplayer — new in this master vs V10
- mergeById preserves photoDataUrl across stripped notes, tie-breaker prefers photo, tombstones kept 7d then purged, archived_at/ deletedAt handled
- remoteSave always fetches existing row first, then merges — stale device can't wipe other person's add
- revision compare-and-swap + merge retry stops double chore points / double next chore
- auto-push guarded 800ms, stableHash snapshot, lastSnapshotHashRef, applyingRemoteRef echo guard, lastLocalMutationId echo guard, pushToSheet total 0 guard

### Supabase SQL fix (2026-08-04 night)
- localTime lowercases to localtime reserved in Postgres → syntax error at line 81
- FIXED: quoted all camelCase "localTime" "templateId" etc, provided MINIMAL file with just couple_data for quick unblock
- supabase-init.sql in this master is fixed (quoted) + idempotent

### Offline / Sync
- mutation_queue IndexedDB, drainQueue on online / focus / visibilitychange, SyncStatus truthful: saving / saved (only after verify) / offline-queued / failed / updated-elsewhere
- SW: supabase.co /rest/ /realtime/ bypass, supabase-env.js network-first, version.json network-first, assets cache-first 3 safe entries, standalone github.io + netlify support

### APK
- PWA manifest standalone #E8CEB7, icons 192/512, updater 5m poll + focus/online, code/build numeric comparison, couple-update-available dispatch — APK wrapper can refresh without reinstall
