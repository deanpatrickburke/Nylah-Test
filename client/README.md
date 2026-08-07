# Nylah OS Client

React 18 PWA (Vite + Bun build driver). Mobile-first household OS.

## Scripts

- `dev`: vite dev
- `build`: `bun ./build.mjs` (Hatch Spaces SDK)
- `test`: `vitest`
- `test:run`: `vitest run`

## Env

Supabase config via `public/supabase-env.js`:

```js
window.__SUPABASE_URL__="https://zlllebsjtgihsxhcmcvb.supabase.co";
window.__SUPABASE_ANON_KEY__="eyJ...";
window.__SUPABASE_ANON__=window.__SUPABASE_ANON_KEY__;
```

Injected before bundle by `build.mjs`.

## Structure

- `src/lib/dates.ts` — Europe/Dublin ONE date engine, no deps
- `src/lib/remoteSync.ts` — mergeById, revision CAS, tombstones
- `src/lib/idb.ts` — offline queue, kv, photos
- `src/lib/pins.ts` — hashed PIN verification interim
- `src/lib/updater.ts` — simplified refresh-to-update (no blob)
- `src/components/UpdaterBanner.tsx` — banner "New version available — refresh to update"

## Build

```
HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs
```

Produces `dist/` with `index.html`, `404.html`, `.nojekyll`, `assets/`, `version.json`, `manifest.webmanifest`, `supabase-env.js`.

## Versioning

`version.json` + `public/version.json` identical, `apkUrl` `"./nylah-os.apk"`, `bundleUrl` `""`, note "Built for GitHub Pages / Netlify hosting". Updater checks `./version.json` `/version.json` `https://nylah-os.netlify.app/version.json`.

## Tests

`src/lib/__tests__/dates.test.ts`, `sync.test.ts` — vitest jsdom, no skips.

## Architecture Interim

Single-row JSONB `couple_data` id `ash-ciaran-2026`. Future normalized tables per DATA-PLAN.md.
