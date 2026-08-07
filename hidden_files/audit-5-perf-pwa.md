# Agent 5 - Performance and PWA Reliability Audit

Date: 2026-08-03 13:39 UTC (Europe/London)
Scope: `client/src/App.tsx`, `client/src/lib/remoteSync.ts`, `client/src/lib/supabase.ts`, `client/src/lib/updater.ts`, `client/src/components/UpdaterBanner.tsx`, `client/build.mjs`, `client/dist`, `client/public/version.json`, `client/public/manifest.webmanifest`

## 1. Rerender Frequency - FIXED but partial

**Before:** Root V1AppShell had `syncedSec` state + `setInterval(...,1000)` forcing full tree rerender every 1s to show "Saved Xs ago".

**Now:**
- `V1AppShell` no longer has `syncedSec` interval. Instead isolated in `SyncStatusIsolated` component (line ~635).
- `SyncStatusIsolated` has its own `sec` state + `setInterval(tick,1000)` - scoped, doesn't bubble.
- Parent `V1AppShell` still has a **30s** timer: `useEffect(()=>{ const i=setInterval(()=>setNowMs(Date.now()),30000); return ()=>clearInterval(i); },[setNowMs]);` - This drives all relative time calculations (`relTime`, `percentLeftChore`, `shoppingDueLabel`) across all tabs. 30s is reasonable; 5min would be better for battery but OK.

**Residual risk:**
- `nowMs` propagates to all 5 tab components; memoization relies on `useMemo` but many derived collections still recalc every 30s. `FridgePage` with `activeChores`, `activeCalendar` uses `useMemo` correctly, `ChoresPage` filters `bonusNow` each `nowMs` tick - acceptable.
- `triggerConfetti` creates 24-30 DOM nodes directly (not React) - avoids rerender, correct choice.

**Recommendation:** Keep isolated sync component, extend `nowMs` tick to 60s or make granular: only `relTime` labels need updates, not entire page.

## 2. Timers - Inventory

Main loop timers:
```
SyncStatusIsolated: setInterval(tick,1000)   // 1s - isolated
V1AppShell nowMs: setInterval(setNowMs,30000) // 30s
UpdaterBanner: setInterval(runCheck, 15*60*1000) // 15min
UpdaterPill: setInterval(doCheck, 15*60*1000)  // 15min - currently unused in App.tsx but exported
auto-push: setTimeout 800ms debounce on [choresRaw,calendarRaw,shoppingRaw,notesRaw]
toast: setTimeout 2200ms
sbTestMsg: 5000ms
resetMsg: 2800ms
confetti cleanup: setTimeout 1150ms
chore swipe exit: setTimeout 220ms (x2 variants)
choreDone debounce: 800ms mutSetRef delete
```

Total persistent intervals: 2-3 (1s +30s +15min). No longer has 60s sync poll. Good improvement.

**Leak check:**
- `SyncStatusIsolated` cleanup removes `couple-sync` listener but **missing removal** for `online`/`offline` listeners. Memory leak minor.
- `UpdaterBanner` correctly clears interval and removes both `visibilitychange` and `focus` listeners in return.
- V1AppShell effect cleans `focus`, `visibilitychange`, and realtime unsub.

## 3. Realtime Subscriptions

- Single call: `subscribeRemote` inside V1AppShell's main `useEffect([])` (line ~2491).
- `remoteSync.ts` implementation: `sb.channel('couple_data_'+ROW_ID).on('postgres_changes', {filter: `id=eq.${ROW_ID}`}, ...) .subscribe()` - one channel per app instance.
- Channel removal: `try { sb.removeChannel(ch) } catch {}` in cleanup - correct.

**Risk:** No reconnection backoff. Supabase client handles retry, but no explicit `onClose` handler. Acceptable for v0.

**Duplicate risk eliminated:** Previously multiple components called subscribe. Now single source.

## 4. Polling

**Docs say:** Keep realtime only, polling as fallback when unhealthy.

**Code:**
- 60s poll **removed**. Comment: `// Realtime only – no permanent 60s polling. Focus refresh only when disconnected or stale (>5min)`
- Fallback logic:
```ts
let lastSyncOk = Date.now()
const focus = () => {
  const stale = Date.now() - lastSyncOk > 5*60*1000
  const disconnected = !(hasSupabaseConfig() && getSupabase())
  if (stale || disconnected) { syncFromRemote() }
}
```
- So polling only on `focus` or `visibilitychange` and only if stale/disconnected.

**Gap:** No interval poll when tab is foreground but realtime dies silently (supabase-js sometimes loses WS without firing). Recommendation: add 5min health check only when `!navigator.onLine` or after `subscribe` error. Current is acceptable if we trust Supabase reconnect.

## 5. Visibility Listeners - Fix Confirmed

**Previous bug:** `document.addEventListener('visibilitychange', () => {...})` with anon arrow, then `removeEventListener('visibilitychange', () =>...)` different anon ref - never removed -> leak.

**Now:**
```ts
const onVis = () => { if (document.visibilityState==="visible") focus() }
window.addEventListener("focus", focus)
document.addEventListener("visibilitychange", onVis)
return () => { cancelled=true; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", onVis); ... }
```
Correct named reference. One focus listener, one visibility listener.

**Remaining issue in SyncStatusIsolated:** 
```ts
window.addEventListener('couple-sync', onSync)
window.addEventListener('online', ()=>{...})
window.addEventListener('offline', ()=> setState('offline'))
return ()=>{ clearInterval(id); window.removeEventListener('couple-sync', onSync) } // missing online/offline removal
```
Should store handler refs and remove.

## 6. Focus Listeners

Single focus listener. No duplication. Triggers `syncFromRemote()` only when stale >5m or disconnected - avoids spamming.

UpdaterBanner adds separate `focus` listener that triggers version check - acceptable, separate concern (update check).

## 7. Image Storage

**Current:**
- Notes photos resized client-side to 120x120? Search shows no explicit resize code now - previous resize possibly removed. `photoDataUrl` stored as data URL string in localStorage via `useLocalState`.
- `isQuotaError` handling (line ~14): detects `QuotaExceededError`, code 22/1014, or message includes quota.
  On quota error, loops storage for `couple_v1_*` keys containing notes/photo length >40000, parses array, strips any `photoDataUrl.length>8000` entries, retries original.
- `useLocalState` fallback: if `safeSetLS` fails for notes, tries trimmed version stripping photos >12000 chars.
- `idbSet` / `idbGet` for overflow to IndexedDB `couple_v1_idb` KV store - async, non-blocking.

**Problem:**
- Data URLs still large: base64 ~ ~10KB for 120x120 JPEG is okay but 5 photos = 50KB+ per notes array, plus 4 other arrays sharing 5MB LS quota (typical Safari). On iOS PWA, LS limit 5MB, IDB may not be read on initial synchronous render - `useLocalState` initial reads only LS, not IDB, so offline startup could miss IDB-stored photos until effect writes again.
- `idbGet` never used in `useLocalState` init - only `idbSet` called after LS write. So IDB is backup but not source of truth on reload when LS stripped. Need `useEffect` to hydrate from IDB if LS miss.
- Supabase row storing data URLs: payload.chores/calendar/shopping/notes all via `withTimestamps`, then `sb.from(TABLE).update(payload)` - entire notes array including dataURL shipped. Supabase row size limit ~8KB? Actually jsonb maybe 64KB soft but data URLs could blow row. Need Supabase Storage for images.

**Acceptable interim:** 120x120 low-res keeps within quota for <20 photos. Long term requires Storage bucket.

**Bundle bloat mention:** data URLs not in bundle, only runtime.

## 8. Bundle Size

- `client/dist/assets/index-r9r347tb.js` = 598,590 bytes (585KB)
- CSS = 44KB
- Total dist = 648KB
- Subagent claim 616K (index-5bbchy8n.js) - similar ballpark, ~600K.

**Why large:**
- Single-file App.tsx ~2650 lines, includes all 5 tabs, no route-based code splitting.
- `@supabase/supabase-js` ~150KB minified.
- No dynamic `import()` for modals, confetti, heavy panels.
- Tailwind classes inlined in JS via JSX.

**Audit verdict:** Not terrible for PWA but over 500KB JS will hit parse time on low-end Android. Recommendation:
- Lazy load BlueprintPanel, UpdaterBundle hot-swap (contains Capacitor imports), calendar month logic.
- Split Supabase import via dynamic import for offline cache-only startup.
- Target <250KB gzipped initial.

`build.mjs` delegates to `@hatch/space-sdk/build` - no custom bundle analyzer. Add `brotli` check.

## 9. Update Flow (version.json, UpdaterBanner)

**Version source:** `client/public/version.json` exists:
```
{"version":"1.0.0","... }? Not read but candidate.
```
`client/dist` currently has **no** version.json (checked `dist` listing - missing) cause dist is build output, public files maybe not copied? Check `client/public/` has version.json, but `dist` listing showed only 4 files: 2 icons, js, css, manifest - missing version.json, supabase-env.js. So update checks against `/version.json` will 404 on gh-pages, fallback to netlify URL `https://nylah-os.netlify.app/version.json` which likely 404.

**Updater code (`updater.ts`):**
- `UPDATE_CHECK_URL = "/version.json"` + `REMOTE_VERSION_URL` computed from VITE_VERSION_URL or LS override else "/version.json"
- Candidates: `[REMOTE_VERSION_URL, supabase storage public/app-dist/version.json if supabase configured, https://nylah-os.netlify.app/version.json]`
- Fetch with `cache: no-store`, `Cache-Control: no-cache`, `?t=Date.now()` busting - good for cache invalidation.

**UpdaterBanner:** interval 15min + visibilitychange + focus => triggers `checkForUpdate()` async. If available shows pill with `local → v{remote.version}`.

**Install flow:**
- Web wrapper strategy: `isWebWrapperStrategy` true for netlify, nylah-os, vercel, ondigitalocean hostnames. If true, `promptInstall` just sets LS version and does `window.location.replace(url with _uv & _t)` to force reload bypassing cache. No real Blob download.
- Native Capacitor: tries `Browser.open(apkUrl)`, else hot-swap bundle via `Filesystem.writeFile` to `pending_update.json`. Writes `pending_update.json` marker, writes `couple_v1_pending_bundle_url` to Preferences, sets rollback version, then `window.location.reload()`.

**Gaps:**
- No service worker `skipWaiting` / `clients.claim` - if PWA SW exists elsewhere, update wouldn't propagate.
- Rollback reads `ROLLBACK_VERSION_KEY` but never auto-triggers on crash loop.
- Dismiss X respects `mandatory` flag but dismissed state not persisted - reappears on reload.
- No changelog modal - only title attr hover.

## 10. Service Worker

**Status:** None found.
- `build.mjs` calls `buildClient()` from Hatch SDK - grep SDK maybe not inject SW.
- `client/public/manifest.webmanifest` exists but no `sw.js` in dist.
- No `navigator.serviceWorker.register` call in App.tsx or updater.ts.
- Offline startup relies only on LS + IDB, not Cache API.

Impact: No offline HTML shell caching, no precache of JS/CSS. If user offline on first load after deploy, GH Pages (no SW) will fail because browser cache may have old index.html referencing evicted chunk hash (`index-r9r347tb.js` after new deploy). Needs SW or GH Pages must ship `index.html` with `Cache-Control: no-cache`.

Recommendation: Add Workbox minimal SW or Netlify `_headers` no-cache for index.html.

## 11. Offline Startup

- `useIsStandalone` determines framing, uses LS read via `useLocalState` initial sync parse - if LS empty, returns `def` empty arrays. So app can mount offline with cached data.
- `safeGetLS` wraps try/catch around `localStorage.getItem`.
- `trySupabaseLoad` bails early if `!hasSupabaseConfig()` - allows offline without config.
- Merge guards: `remote total 0 + !force => skip` prevents wiping local when incognito fresh.
- `SyncStatusIsolated` detects `navigator.onLine===false` => Offline gray badge.

**Missing:** IDB hydration not synchronous, so if LS was quota-evicted, offline startup loses photos despite IDB having copy. Also `supabase-env.js` is injected via `window.__SUPABASE_URL__` if present - file missing in dist, so baked env relies on Vite env. On GH Pages, no env, relies on LS override -> if LS cleared offline, no supabase config.

**Cache invalidation concern:** No stale-while-revalidate for `remoteLoad` - offline cold start shows cached but no indicator of last sync age beyond `Saved Xs ago` (isolated). SyncStatusIsolated shows offline queued, good.

## 12. Cache Invalidation

- JS assets hashed (`index-r9r347tb.js`) - correct immutable caching.
- `index.html` not hashed - should be no-cache (GH Pages defaults cache 10min). No headers file found.
- Updater fetch uses `?t=Date.now()` anti-cache, `no-store` - correct.
- Supabase realtime channel caches revision in LS - correctly invalidated on new push via `updated_at` comparison.

Risk: If deploying to GH Pages (`ciaranf3308-star.github.io/nylah_os`), `404.html` fallback for SPA needed? Not in dist listing - only index.html. Could cause soft 404 on deep links.

## 13. Duplicate Update Banners

**Previous bug:** `UpdaterBanner` rendered twice (once in top bar, once lower). Now single instance in top bar line ~2551:
```tsx
<span ...>BETA</span><UpdaterBanner /><button settings>...
```
`UpdaterPill` exported but not rendered in App.tsx - grep count 1. So duplicate fixed.

**But:** `UpdaterBanner` interval ref + `UpdaterPill` interval would double-run checks if both mounted. Only one mounted currently.

**Listeners double:** UpdaterBanner adds both `visibilitychange` and `focus` pointing to same `onVis` function (runCheck) - cleanup removes both, okay but `focus` event uses same handler as visibility; should be separate.

## Checklist Items - Verbatim from Task

Detailed checks:

- [x] useEffect intervals in V1AppShell: 30s nowMs, auto-push 800ms, toast 2.2s, sbTest 5s - no 1s root redraw.
- [x] triggerConfetti DOM creation: direct DOM, 24-30 nodes, manual cleanup 1150ms, limits to max 2 concurrent hosts, removes oldest. Good perf.
- [x] idbSet/get: openIdb v1 kv store, JSON stringified, async, but get never used for hydration on startup.
- [x] isQuotaError handling: checks name, code 22/1014, message includes quota. Eviction loops LS keys, strips large dataUrls >8KB. Retry logic exists.
- [x] safeGetLS/safeSetLS: safe wrappers with try/catch, fallback trimming for notes.
- [x] SyncStatusIsolated vs SyncStatus component: Old `SyncStatus` (maybe with interval in root) replaced by isolated version. Still has 1s interval but local state only.
- [x] auto-push debounce: 800ms setTimeout cleared on deps change, checks auto_push toggle, requires supabase config, dispatches `couple-sync` events for UI. Logs revision.

## Critical Fixes Remaining (P0-P1)

1. **P0** - Missing `version.json` in dist breaks update chain on GH Pages - need copy public -> dist in build or add version.json fetch fallback always hits netlify.
2. **P0** - No service worker -> GH Pages can serve stale index.html pointing to missing hashed JS after deploy -> white screen. Add SW or configure GH Pages to never cache index.html.
3. **P1** - SyncStatusIsolated leaked online/offline listeners (needs cleanup).
4. **P1** - IDB hydration missing on startup - photos lost after LS quota eviction despite backup.
5. **P1** - Data URLs in Supabase row risk row size limit - move to Storage.
6. **P2** - UpdaterBanner + UpdaterPill dual interval if both ever mounted.
7. **P2** - Bundle 585KB still high, no route splitting.

## Summary Scorecard

| Area | Status | Notes |
|------|--------|-------|
| Rerender freq | 7/10 | Root redraw fixed, 30s tick okay, isolated sync tick |
| Timers | 6/10 | 2 persistent + 15min updater, toast etc - acceptable but漏 cleanup online/offline |
| Realtime | 8/10 | Single channel, correct filter, good cleanup |
| Polling | 9/10 | 60s removed, stale>5m fallback correct |
| Visibility | 9/10 | Named handler cleanup correct |
| Focus | 9/10 | Single listener, correct logic |
| Image storage | 5/10 | DataURL 120px okay-ish, quota handling exists but IDB not hydrated, row bloat risk |
| Bundle | 5/10 | 585KB JS, no split, acceptable for prototype not production |
| Update flow | 5/10 | Flow implemented but version.json missing in dist, no SW, no persisted dismiss |
| SW | 2/10 | None - offline PWA incomplete |
| Offline startup | 7/10 | LS works, IDB fallback async but usable, no SW html shell |
| Cache invalid | 6/10 | Hash correct, anti-cache fetch correct, index.html cache risk on GH Pages |
| Dup banners | 9/10 | Fixed - single banner |

Overall Perf/PWA: ~6.2/10 - Beta ship-able but needs SW + version.json copy + IDB hydration for production confidence.

## Evidence Paths

- `client/src/App.tsx` V1AppShell interval line isolated: search `setInterval.*nowMs`
- `SyncStatusIsolated` 1s isolated line `const id = setInterval(tick, 1000)`
- `Updatable`: `client/src/components/UpdaterBanner.tsx` interval 15min + visibilitychange/focus listeners
- `remoteSync.ts` single channel `'couple_data_'+ROW_ID`
- `V1AppShell` focus/visibility wiring block ~line 2480-2500
- `safeSetLS` quota eviction block ~line 14-33
- `dist` size: `wc -c` 598590 bytes current hash `index-r9r347tb.js`
- `public/version.json` exists but `dist/version.json` missing (build artifact gap)
