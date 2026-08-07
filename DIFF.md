# DIFF.md — V10->V11 Mega Pazaz

## App.tsx
- TopBar: sticky z-30 topbar-peach-wash paper-grain borderColor var(--border), h1 26px Fraunces family, avatar h-11 w-11 border-2 ring-1 ring-[#E8DDD3] min 44px
- BottomNav: class bottom-nav-v11 backdrop-blur 12px floating elevation shadow-soft + shadow-raised, active color #8B5E3C wash #F7EFE8, item 52px minHeight 52 minWidth 44, icon 18px 12px label font-semibold active
- Updater useEffect: new checkVersion fetch ./version.json?t=Date.now() cache:no-store compare code via isNewerCode + semver isNewer, dispatch couple-update-available + couple-sync, poll 5min on focus/visibilitychange/online, fallback checkForUpdate lib, realtime primary preserved

## theme.css
- V11 mega added: :root overrides --bg #F7EFE8 --card-bg #FFFEFB --card-bd #E8DDD3 --peach #E8CEB7 --accent-strong #8B5E3C --shadow-soft/raised/float
- .paper-grain ::before SVG turbulence noise opacity 0.035 multiply
- .topbar-peach-wash gradient #FFDCC7→#FFE8D6→#FFFEFB backdrop-blur 12px border-bottom 1px
- .card-v11 bg #FFFEFB border 1px #E8DDD3 radius 20px shadow-soft hover shadow raised transition 160ms
- .continuous-card bg #FFFEFB border shadow 0 4px 18px etc border-top per item #F7EFE8
- .bottom-nav-v11 rgba(255,254,251,0.94) blur 12px border-top shadow float
- .polaroid-v11 rotation odd -2deg even 1.5deg hover 0deg scale 1.02 tape gradient 64×18 opacity .9 2px radius
- .empty-illustrated dashed border radius 20px padding 32px shadow soft
- .handwritten-name Caveat 600 13px scale .98
- .sheet-in-v11 220ms cubic-bezier(.34,1.56,.64,1) overshoot
- .needs-you-dot 7px dot peach shadow pulse 1.8s infinite
- .corkboard-v11 background #F7EFE8 dot 22% 1.2px 18px

## sw.js (client/public/sw.js → dist/sw.js)
- CACHE_NAME v10 → v11 mega pazaz
- activate delete old caches not matching new name + clients.claim same promise
- fetch: supabase.co /rest/ /realtime/ bypass preserved, supabase-env.js network-first cache:no-store put, version.json network-first new, navigation network-first cache:no-store fallback cached index.html, assets cache-first only 3 safe entries

## manifest.webmanifest
- background_color #FFFCF8 → #E8CEB7
- kept name Nylah OS short_name Nylah display standalone theme #E8CEB7 icons 192/512 start_url ./ ?standalone scope ./ categories lifestyle productivity orientation portrait

## lib/updater.ts
- LOCAL_CODE_KEY code, getCurrentCode, setCurrentCode, isNewerCode, getRemoteCode supporting code buildNumber numeric build vNN
- checkForUpdate returns local, localCode, remote, available = codeNewer||semverNewer, candidates ./version.json /version.json REMOTE_VERSION_URL netlify fallback ?t=Date.now() cache no-store headers Cache-Control no-cache
- promptInstall saves version & code, set 15min→5min interval in caller, online guard

## components/UpdaterBanner.tsx
- interval 15min→5min, added online+focus+visibilitychange+couple-update-available listeners, online guard skip when offline, supports numeric code/build, dispatches couple-update-available & couple-sync, banner title local→remote (localCode→remoteCode) dismiss mandatory preserved, pill variant 5min code support

## lib/supabase.ts
- preserved: window.__SUPABASE_URL__/__ANON__ injection, Vite VITE_ primary, LS override, hardcoded fallback zlllebsjtgihsxhcmcvb + anon eyJhbG... (household)

## version.json (public + dist)
- code 10→11, version 1.0.0-beta-v10→11.0.0-mega-pazaz, build 2026-08-04-v10→2026-08-04-v11-mega-pazaz, changelog V11 mega pazaz ...

## build.mjs
- public/ → dist/ cp recursive, .nojekyll created, 404.html SPA routing before injection, supabase-env.js injected before module bundle fallback </head>, index.html 1491 bytes

## Packaging
- FLAT: dist/ → NYLAH-OS-FLAT-V11-MEGA-20260804.zip 16 files unzip -l verified no dist/dist
- COMPLETE: src/lib/dist+FIXES.md+DIFF.md → NYLAH-OS-COMPLETE-V11-MEGA-20260804.zip

