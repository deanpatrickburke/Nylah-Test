# Nylah OS - Self-Updater (No Companion App Bloat) - goal_f740d0ec1e6b

## Primary Strategy: WebView loading https = free updates (RECOMMENDED)

Instead of bundling static HTML/JS inside APK, make APK a thin WebView wrapper that loads `https://nylah-os.netlify.app` (or your custom domain).

- APK code via Capacitor:
  ```ts
  // capacitor.config.ts
  server: { url: 'https://nylah-os.netlify.app', cleartext: true }
  ```
  or Java WebView -> loadUrl(...)
- Pros:
  - Updates = deploy new zip to Netlify = users get new version instantly on next app open
  - No APK reinstall, no storage bloat, no Filesystem hot-swap complexity
  - Works with Supabase realtime same as web
  - Free unlimited deploys via Netlify/Cloudflare Pages (0 credits trick via Publish deploy rollback)
- Cons: Requires internet for first load (acceptable for couple app), offline needs Service Worker cache
- For production offline-capable: keep bundled webDir as fallback + Service Worker precache.

## Secondary In-App Prompt: Offline Bundle + Browser API Download (Current Implementation)

When APK bundles webDir (client/dist) for offline use, JS bundle hot-swap:

1. App boots, calls `checkForUpdate()` -> fetches `/version.json` (and fallback `VITE_VERSION_URL` = Supabase Storage public URL)
   Example version.json:
   ```json
   {
     "version": "1.0.1",
     "changelog": "Fixed incognito wipe, improved shopping tags",
     "apkUrl": "https://.../nylah-os-v1.0.1.apk",
     "bundleUrl": "https://.../bundle-1.0.1.zip",
     "mandatory": false,
     "timestamp": "2026-08-03T02:30:00Z"
   }
   ```
2. Compare semver with `localStorage couple_v1_app_version` (default 1.0.0)
3. If available:
   - Show UpdaterBanner pill in top bar near sync dot
   - On tap: if `apkUrl` present -> `Browser.open(apkUrl)` (Capacitor Browser) -> user installs APK (needs `REQUEST_INSTALL_PACKAGES` permission)
   - Else: `window.location.reload()` for web strategy

Implementation files:
- `client/src/lib/updater.ts` - `UPDATE_CHECK_URL`, `REMOTE_VERSION_URL`, `checkForUpdate`, `promptInstall`, `applyUpdate`, `isNewer`, `getCurrentVersion`
- `client/src/components/UpdaterBanner.tsx` - UI pill with 15min poll, visibilitychange + focus triggers
- `public/version.json` + `client/public/version.json` kept in sync
- `client/index.html` - manifest + viewport-fit=cover + apple-mobile-web-app-capable + theme-color #E8CEB7

## Tertiary: Capacitor Filesystem JS Bundle Hot-Swap (Skeleton)

Advanced, optional, not in v1 due to security & signing:

- Download `bundleUrl` zip via Capacitor Filesystem API
- Unzip to data directory
- Patch index.html to load new JS via custom scheme
- Prompt restart, keep `couple_v1_rollback_version` for rollback
- `tryHotSwapBundle()` in updater.ts implements skeleton: writes `pending_update.json` to `Directory.Data`, stores rollback, reloads.

## Why Not Companion Updater App?

- Bloaty (2 apps for 1 user), Play Store confusion, double permissions, background service battery complaints
- Android 13+ blocks silent APK install without user consent anyway - companion adds no value
- In-app Browser.open + DownloadManager is standard pattern (WhatsApp, Telegram, etc. use it)

## Wiring

In `V1AppShell` top bar JSX near sync dot:

```tsx
import { UpdaterBanner } from "../components/UpdaterBanner";
...
<div className="flex items-center gap-1.5"><UpdaterBanner /><button ...>⚙</button><div>Synced {syncedSec}</div></div>
<div className="px-3.5 pb-1 bg-[#FFFCF8]"><UpdaterBanner /></div> // fallback row
```

If patch fails (large file), manual instruction kept in `hidden_files/updater-integration.txt`.

Capacitor deps (already in package.json):
- `@capacitor/core@^6.2.0`, `@capacitor/android@^6.2.0`, `@capacitor/app@^6.0.2`, `@capacitor/filesystem@^6.0.2`, `@capacitor/preferences@^6.0.3`, `@capacitor/browser@^6.0.5`, `@capacitor/cli@^6.2.0`

## version.json

Served from same origin `/version.json` with fallback to Supabase Storage public bucket `app-dist/version.json` and `https://nylah-os.netlify.app/version.json`. anon key only allows read.

## Security

- APK signing: use same keystore for updates or Android will block install
- Token `ash-ciaran-2026` guards couple_data, not code updates

## Rollback

If update broken: publish previous Netlify deploy via Netlify UI Deploys -> Publish deploy (0 credits). For APK: keep previous APK URL in version.json history.
