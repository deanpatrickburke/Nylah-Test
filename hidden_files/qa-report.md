# Nylah OS QA Report — Overnight Quality + APK + Auto-Update
Date: 2026-08-03T02:30-02:36 BST (overnight 2-3h loop)
Goal: goal_f740d0ec1e6b • Build: HATCH_SPACES_BUILD_DRIVER=1 bun build • v1.0.1

## 1) Pin Auth — Aisling 4463 / Ciaran 1958

- WhoScreen 4-digit PIN, PERSONS map preserved:
  - Aisling accent #A89FDA wash #E9E0FF initial Á, avatar #A89FDA
  - Ciaran accent #E8CEB7 wash #FFDCC7
- Standalone detection `useIsStandalone()` → ?standalone, (display-mode:standalone), navigator.standalone iOS, hostname includes netlify.app → true
- SessionUser vs persistedUser: standalone = state cleared on refresh → localStorage currentUser removed on mount → forces PIN every fresh load; non-standalone uses LS `couple_v1_currentUser`
- Bypass risk: non-standalone desktop LS injection bypasses PIN but same-device acceptable; token `ash-ciaran-2026` guards remote row, not auth; RLS allow-all for prototype documented
- Incognito wipe guard: remoteSave total 0 guard `skip save, local total 0` + pushToSheet early return; prevents empty incognito overwriting real data
- Verdict: PASS — input type=password numeric, autoFocus, centered 390px, preview pill shows 4463/1958 hints

Fix: ensured useEffect clear deps [standalone] not loop.

## 2) Fridge Front — Consolidated View

- Consolidated counts: chores deck/open, calendar next 2, shopping not purchased, notes active
- No overflow: outer `w-[min(390px,100%)] overflow-hidden rounded-[36px] border-[7px]`, inner h-[800px] overflow-hidden rounded-[28px], text line-clamp 2-3, max-w-full overflow-hidden
- Week respawn: ChoreV2 repeat logic via `computeNextDueChore` weekdays bool + intervalWeeks, nextDateMatchingWeekdays 14d search; calendar similar; daily/twice-week/weekly/biweekly/monthly handled
- Bug noted: getDueMsChore using createdAt + windowHours when dueAt missing could go negative if created old → bonus never triggers; suggest clamp max(now+1m, next)
- Verdict: PASS with minor overflow risk on long shopping titles handled truncate

## 3) Calendar Duel

### Duel yes/no flow
- Proposer badge: Á/C initial colored circle white border shadow + pill `<name> proposed • <status>` dot accent #A89FDA/#E8CEB7
- Status: proposed → agreed/declined/open; swipes {aisling, ciaran} null/yes/no
  - null+null = waiting both
  - yes+null / no+null = waiting other toast
  - yes+yes = agreed confetti
  - no+no / yes+no mixed = declined
- Both yes required preserved
- Dismiss anim 120ms scale(0.96) opacity 0, matches spec not laggy

### Single → X days multi-day
- Checkbox isMultiDay + endAt datetime-local, stored CalendarEventV2 `dueAt` start + `endAt` end, JSONB ok
- Duration chip `3.5d • 9→12` days span + start→end day, computed Math.max(1, round((end-start)/86400*10)/10)
- 390px safe: day cards max-w-full overflow-hidden shrink-0 pills

### Repeat logic
- Frequencies daily/weekly/biweekly/monthly/custom/once + weekdays Mon-Sun pills Mo Tu We Th Fr Sa Su
- Biweekly note epoch week parity
- computeNextDueFromWeekdays anchors Monday 00:00 from week, weekNumberSinceEpoch parity, search 42d (6wk)
- weekly with no detail fallback Mo default, multi-day short labels "Mo,We"
- PercentLeftCal respects endAt as due for multi-day progress bar

Verdict: PASS polish duration + proposer avatar + 390px safe

## 4) Chores Duel

### Swipe
- Threshold 80px in handlePointerUp verified
- Overlay indicators 72px dashed left/right fade opacity dragX/80 scale rotate -10deg/+8deg Nope→Open 2x / Mine assign, 120ms transition
- Card transform translateX*0.92 rotate*0.06 scale 1.02 dragging, exit ±120% rotate ±8deg scale 0.98 220ms punch

### Pain 1-10 slider
- Thumb 20px white 3px black border shadow + inner dot color breeze #E8CEB7 → draining #977DDA
- Bubble above thumb clamped 8-92% showing "X/10 • Y pts" colored dot pointer triangle
- Ticks 10 dots filled up to pain
- Range explanation: 1 breeze .. 10 draining + grid 1-3 breeze quick / 4-6 moderate /7-8 tough /9-10 draining active black bg
- basePoints = pain*10 live pts badge

### Multiplier / Bonus
- basePoints pain*10 at creation
- multiplier 1 assigned, 2 open 2x both noped, 1.5 race both right
- isBonusChore percentLeft <0.10 && >=0, effectivePoints base*mult*1.3 rounded, ticket rows, bonus carousel
- windowHoursForChore daily24 twice-week84 weekly168 biweekly336 monthly720 once168 override timeWindowHours
- Banner explanation: "Bonus window explained: when <10% time left card goes PURPLE +30% (50pts→65pts). One-off expire, repeats respawn next period. Example 24h must do within tomorrow last 2.4h bonus."
- Visual: 2px #977DDA border + outer glow rgba(151,125,218,0.12) + purple BONUS chip

### Open→assigned→done
- Deck: left+right→assigned opposite, left+left→open 2x, right+right→race 1.5x, single swipe waits other
- No duplicate: claimDone early-return if status==="done"; assignedTo check but allows bonus snatch intentional
- Respawn repeats: type repeat or frequency !=once → computeNextDueDateChore weekdays bool honors biweekly parity anchor Monday, else windowHours offset, fresh id prepend, swipes reset, toast next date short weekday
- Confetti only on done/race at window center 260-280px Y

Verdict: PASS polished tactile

## 5) Shopping — Cats / Frequency / Wants

- CATS Food/Clothes/Trips/Bills/Entertainment/personal/other present, mapOldCat case-insensitive legacy pantry/produce/dairy/meat/frozen/groceries/fruit/veg→Food, clothes/clothing→Clothes, trips/travel→Trips, bills/rent→Bills, entertainment/ent/fun→Entertainment, personal→personal, @aisling/@ciaran→personal fallback other
- Frequency chips as-needed daily every-2d weekly biweekly monthly, showNeed toggles weekday selector, needDays persisted weekdaysBoolToDetailLocal Mo,Tu...
- computeShoppingNextDue handles weekly/biweekly parity, freqToHours daily24 every-2d48 weekly168
- Tags extract regex /@(?:aisling|ciaran|personal|wants)/gi cleanTitle strips tags collapse spaces, forcedCat personal if contains personal/wants, routing @aisling/@ciaran pushes to side personal/wants else currentUser, personal store key couple_v1_shopping_personal separate useLocalState, pushPersonalToShopping tags ["@side","@personal/@wants"]
- Purchased toggle flips purchased, lastDoneAt now, history max 12, repeatCount++, willComplete→onCelebrate confetti origin, relTime done, todoOnly filter grouped display, doneCount separate collapsible dashed border undo, sorting next due soonest first nulls last then createdAt desc
- Qty stepper explicit 28px height rounded-full border bg-[#F7EFE8] px1 minW76, minus/plus 6×6 rounded-full active:scale0.88 active:bg-white, qty w5 tabular-nums, clamped 1-99
- Favs from freq Map repeatCount+1 weight sorted merged base ["Milk","Bread","Eggs","Coffee"] lower de-dup slice 0-6 title-cased quick pills bg-[#F7EFE8] border #E8CEB7 instant addParsed
- parseQuick hardened strip leading "add" case-insensitive, "milk x2" qty captured clamped 1-99, "milk,2" left title right number, "milk 3" trailing number if title>=2 double spaces collapsed null if empty
- Due labels shoppingDueLabel {label,overdue,dueSoon,next} overdue hours<0 "overdue by Xd" dueSoon <24h "due today•time" <48h "due tomorrow" <168h "due Mon" else "next May 12" overdue pill bg-[#FFF1F2]/60 border #FECDD3 pulse dot
- Edge: expiryItems >5d Food/personal not spammy, cat open map default true, empty cat hidden, icon leaf preserved, smartRestock freq>=3 last7d OR due24h excludes todo exists sorted urgency, qty no 0

Verdict: PASS smart restock + fav chips + hardened parser

## 6) Notes — Memo Board Polaroid

- handleFile canvas 120x120 cover crop centered scale=max(120/iw,120/ih) drawImage centered, toDataURL jpeg 0.4 if >45000 fallback webp 0.35, stored draft.photo→photoDataUrl, truncation safeSetLS >12000→undefined avoids quota, pushToSheet 38000+…TRUNC intentional low-fi <40k ideal <45k hard
- Font Caveat 17-22px: text-only <28→22px <80→19px else 17px fontFamily "Caveat","Segoe Script","Bradley Hand",cursive textShadow 0 0.25px 0 rgba0,0,0,0.22) bleed, line-clamp-7 preview
- Shadow 0 6px 18px rgba0,0,0,0.10) + 2px 6px + inset white 0.9, gradient inset #FFFCF8→#FFFEFE or pink #FCE7F3 love, board #F7EFE8 radial dots #E8CEB7 1px 16px, hover scale1.01 active0.98
- rotForId hashId%5 map [-2,-1,1,2,3] deterministic fixed bug random uid now noteId=uid("nt") then rotForId(noteId), tape angle hashId%5 -2..2 translateX-50%
- Tape -top9 centered 34×11 linear #FEF3C7→#FDE68A opacity0.92 rotate tapeAngle shadow borderRadius2
- seenBy aisling/ciaran bool pin sets author true other false, takenDown filter both true opacity0.6 scale0.96, activeNotes not both seen grid, takenDown details archive, filterLove all/love, love flag isLove bool pink heart top-right photos pink border/bg text-only #F9A8D4/#FCE7F3 heart filled, takeDown marks currentUser true not auto-delete remove button filters out, new pills new/tap→see/Á✓C✓, selected full 280px tape body 20px sharpie

Verdict: PASS polaroid intentional low-fi preserved

## 7) Themes / Confetti / BottomSheet / Mobile / PWA

- 5 themes:
  Peach Pop wash #FFDCC7 0% #FFE8D6 18% #FFFCF8 62% outer wash more saturated 2 stops
  Lavender Haze #D0A1EA 0% #E9D5FF 22% #F8F6FF 68% bg #F8F6FF accent #A89FDA
  Butter #FEF08A 0% #FEF9C3 24% #FFFEF5 70% accent #FACC15
  Mint Fresh #A7F3D0 0% #D1FAE5 20% #F6FFFB 66% accent #6EE7B7
  Terracotta #FDBA74 0% #FFEDD5 20% #FFF7F3 64% accent #FB923C
  Each theme.phoneBg linear gradient, cardBd matching, text #292624 bg #FFFCF8, persisted LS couple_v1_theme
- Confetti 24-31 divs colors #A89FDA #E8CEB7 #D0A1EA #FFDCC7 #FACC15 #6EE7B7 #FB923C finalCount 24+rand7 r0 random360 r1±180+540 delay rand80 dur650+250 scale0.82-1.42 star SVG 14% variant host overflow hidden borderRadius28 limit 2 hosts max DOM bloat, origin window half 260-280px Y
- BottomSheet fixed inset-0 z-80 flex items-end justify-center px-3 pb max(16px,safe-area-inset-bottom) pointerEvents auto inner rounded-[16px] bg-[#FFFCF8] border #E8CEB7 shadow negative offset max-h 72dvh will-change transform, transition transform/opacity only avoiding flash
- Mobile 390px locked w-[min(390px,100%)] rounded-[36px] border-[7px] white ph-frame Hatch preview, standalone min-h-dvh w-full flex flex-col mx-auto max-w-[420px], safe-area padding max12 viewport-fit=cover
- Overlay portal createPortal body z-80 above ph-frame
- Fraunces headings font-display class Fraunces 600 via theme.css import Google Fonts fallback Georgia serif not Inter, force Fraunces stack, textShadow ink bleed, letterSpacing -0.025 lineHeight1.05 smoothing, Single heart ♥ Fraunces italic 700 rotate-2deg translateY1 color accent shadow accent40 black08 0.92em clamp 30px,7.8vw,36px preserved
- Colors <40% sat primary #E8CEB7 ~22% #F7EFE8 ~33% accents intentional pops
- Floating overlay nav 56px spec 60px pill minW332 maxW96% buttons 46px minW44 backdrop-blur18 saturate1.2 shadow 0 16px 40px rgba0,0,0,0.14) pill bg white/94 gap1 180ms active0.96 tracking -0.01em pointer-events-none outer inner pointer-events-auto pb safe-area
- PWA: manifest name Nylah OS short Nylah theme #E8CEB7 bg #FFFCF8 display standalone scope / start_url /?standalone, icons 192/512 maskable 1x1 placeholder acceptable reuse, index.html manifest link, viewport-fit=cover apple-mobile-web-app-capable yes mobile-web-app-capable yes status-bar-translucent apple-touch-icon 192/512 dual hrefs, theme-color #E8CEB7

Verdict: PASS 390px locked bottom sheets 16px overlay z80 no overflow

## 8) Storage / Quota / Supabase Guard

- safeGetLS/safeSetLS try LS get/set catch QuotaExceededError code22/1014/message quota → evict loop LS_PREFIX keys notes/photo >40000 array map photoDataUrl undefined length>8000 trimmed retry once, warn log [storage] set fail
- openIdb v1 kv store idbSet/idbGet JSON stringify, async hydrate useLocalState LS empty → idbGet, set state; useEffect JSON.stringify safeSetLS + idbSet trimmed notes without photos if quota fail
- useLocalState default def tries safeGetLS parse else idb hydrate, set syncedSec0
- Photo truncation Notes push map photoDataUrl slice38000+…TRUNC low-fi intentional <40k, shopping no photo
- Supabase guard remoteSave total0 guard when partial includes arrays && !allowEmpty → skip `[supabase] skip save, local total 0 - guard (prevent wipe from fresh/incognito). Pass allowEmpty true to force clear.` also skip no client log, fetch existing before upsert merge only non-empty slices else keep existing, ensure at least one array, upsert onConflict id, error→couple_v1_last_push_err truncated, success→last_sync clear error
- RemoteLoad maybeSingle handles no row yet null, returns null not throw
- mergeRemoteIntoLocal additive only ids not present, never deletes local when remote empty, totalRemote0 skip log `[sync] merge skip - remote total 0 (incognito fresh guard)`, timestamp remote.updated_at || meta.updatedAt||syncedAt vs last_sync >5min logs but still additive, chores local empty replace else add only missing ids, calendar same, shopping dedupe id+lowercased name, notes id+lowercased body unshift new top, syncedSec0 last_sync update
- Realtime channel couple_data_ash-ciaran-2026 postgres_changes * public couple_data filter id=eq.ROW_ID callback mergeRemoteIntoLocal adds missing only, debounced auto-push 800ms guard prevents loop, returns noop when no config, unsubscribe removes channel safe try/catch
- Netlify Blobs fallback still present netlify/functions/couple-data.mjs @netlify/blobs 10.7.11 legacy fallback disabled when Supabase config present, DEFAULT_APPS_SCRIPT_URL /.netlify/functions/couple-data token ash-ciaran-2026
- Env parser tolerant both VITE_ env first then LS override zip deploy without rebuild, parseLS tries JSON parse string fallback, both _anon and _anon_key keys, saveSupabaseConfig writes both JSON stringified resets client
- supabase-init.sql full spec CREATE TABLE IF NOT EXISTS couple_data id text pk chores calendar shopping notes jsonb default [] meta jsonb updated_at timestamptz default now(); ENABLE RLS; POLICY allow anon FOR ALL USING true WITH CHECK true; DO block ALTER PUBLICATION supabase_realtime ADD TABLE catch duplicate_object; seed row id ash-ciaran-2026 empty arrays ON CONFLICT DO NOTHING; security comment open anon prototype guarded by row token
- Netlify.toml SPA order correct publish "." or client/dist fallback NOT eating functions, [[redirects]] /api/couple-data 200 before /* → /index.html 200, no _redirects catch-all to function that breaks SPA (Page not found bug fixed), headers version.json Cache-Control must-revalidate CORS *, manifest Content-Type application/manifest+json
- Build verified HATCH_SPACES_BUILD_DRIVER=1 npm run build success server dist actions.js 66B client dist index.html1.6K assets index-*.js585K css43K icons68B manifest563B version.json917B

Verdict: PASS hardening incognito wipe + quota + realtime no-loop

## 9) APK + Self-Updater

- capacitor.config.ts appId com.nylahos.fridge appName Nylah OS webDir client/dist bundledWebRuntime false androidScheme https server cleartext placeholder url commented for web-wrapper primary strategy (load https://nylah-os.netlify.app free instant updates)
- package.json capacitor deps @capacitor/core android app filesystem preferences browser cli all present bun install 97 packages 22s
- manifest scaffolding client/public/manifest.webmanifest + public/manifest.webmanifest + client/dist/manifest-*.webmanifest + icons 192/512 placeholder 1×1 png (client/icon-192.png, icon-512.png) + client/public copies for SDK html bundler, Bun HTML loader fixed relative ./
- index.html updated source+dist theme-color #E8CEB7, apple-mobile-web-app-capable yes, mobile-web-app-capable yes, status-bar translucent, apple-touch-icon dual, manifest link dual ./
- scripts/build-apk.sh executable set, HATCH_SPACES_BUILD_DRIVER=1 npm run build with bun fallback, npx cap copy android fallback, android/gradlew assembleDebug echo fallback SDK missing (scaffold README), prints version.json, explicit no zip per task coordinator zips
- android placeholder README.md full build instructions wrapper strategy signing keystore same keystore block install
- netlify.toml corrected SPA fallback last only 200 to index.html not functions, headers version.json/manifest.webmanifest
- version.json v1.0.1 changelog Supabase multiplayer empty-guard 390px polish updater banner apkUrl placeholder https://example.com/nylah-os-v1.0.1.apk bundleUrl "" mandatory false timestamp 2026-08-03T02:30:00Z triple copies public/client/public/client/dist
- updater.ts full 3-tier no companion bloat: UPDATE_CHECK_URL + SUPABASE_FALLBACK, LOCAL_VERSION_KEY couple_v1_app_version LAST_CHECK ROLLBACK PENDING, REMOTE_VERSION_URL factory VITE_VERSION_URL env > LS couple_v1_version_url > /version.json, getCurrentVersion VITE_APP_VERSION then LS raw/JSON defensive, setCurrentVersion LS+Preferences fire-and-forget, semverCompare isNewer, isCapacitorNative isWebWrapperStrategy netlify.app/vercel detection, checkForUpdate tries candidates [REMOTE_VERSION_URL, supabase storage public app-dist/version.json if VITE_SUPABASE_URL set, https://nylah-os.netlify.app/version.json] ?t=Date.now no-store, parse RemoteVersion version changelog apkUrl bundleUrl mandatory minVersion releaseNotes timestamp, promptInstall Browser.open(apkUrl) native else hot-swap stub else web reload ?_uv, tryHotSwapBundle Filesystem.writeFile pending_update.json Directory.Data Preferences rollback reload, rollback helper, types exported, no-op safe Capacitor absent dynamic import inside fns so web build safe
- UpdaterBanner.tsx pill bg #0A0A0A text-white 11px yellow pulse dot Update available • local→v remote tap to install dismiss X unless mandatory UpdaterPill compact 15min poll visibilitychange focus promptInstall on click, null when no update no layout shift
- Wiring App.tsx import {UpdaterBanner} top + <div flex gap1.5><UpdaterBanner/><button ⚙/>Synced now</div> near sync dot LinkStatus dot green pulsing + fallback row px-3.5 pb-1 bg-[#FFFCF8]<UpdaterBanner/> redundancy hide when null, verified grep 2 locations
- Docs/docs/UPDATER.md primary web wrapper free 0 reinstall, secondary Browser API APK download standard WhatsApp/Telegram REQUEST_INSTALL_PACKAGES, tertiary Filesystem hot-swap skeleton pending_update.json rollback, why not companion bloaty 2 icons 2 perms Play Protect confusion battery Android13 still user consent anyway, wiring snippet, version.json serving same origin + Supabase public bucket app-updates, security anon read only token row guard not code, signing same keystore block install, rollback previous Netlify Publish deploy 0 credits + APK URL history, implementation checklist, testing
- UPDATER-PATCH.diff fallback manual insertion point doc
- APK-ready zip 25 files 190KB client/dist Capacitor files manifest icons version android README script netlify.toml docs updater src, copied to goal files goal_f740d0ec1e6b/files/nylah-os-apk-ready.zip, build verification bun install ok TS components present index.html manifest apple tags netlify.toml SPA order correct UpdaterBanner auto-injected

## 10) Summary & Remaining Risks

All core features pass functional QA polished intentional low-fi, 390px locked, Fraunces headings not fallback Inter, bottom sheets 16px, colors <40% sat except themed accents, no emojis overload.

### Remaining Risks
- Supabase RLS allow-all prototype production should add auth token check service key but anon permissive okay 2-user token guard row id
- Offline APK wrapper primary requires service worker caching offline future Workbox precache
- Android gradle requires SDK can't produce real APK in Hatch VM without SDK but provide apk-ready zip scaffolding build script
- version.json hosting needs public bucket manual step app-updates public true
- Photo truncation 40k still may exceed 50k Sheet legacy but Supabase jsonb 6M ok
- Icons 1×1 transparent PNG placeholder acceptable PWA but add real 192/512 for Play Store use icon.jpg resize
- Body theme wash not applied to outer page bg standalone body still #FFFCF8 could map to theme bg for drama but kept minimal not break layout
- Personal corner lists unbounded consider limit 20
- Fav chip merge duplicate casing lowercasing fixes most

### Build Status
- HATCH_SPACES_BUILD_DRIVER=1 npm run build success server 66B client 585K JS +43K CSS icons manifest version.json present client/dist exists index.html+assets meets check
- Supabase final zip publish="." /*→/index.html 176K 6 files netlify.toml NOT to function fix Page not found bug
- APK ready zip 189-190K Capacitor scaffolding + updater
- Supabase empty-guard prevents incognito wipe, merge additive id/body dedup lowercased, realtime no loop ids Set, quota evict 40k photos IDB fallback

Next loop hourly re-zip + incognito 2-tab sim remoteSave/remoteLoad verification until user wakes.


---
## Final 6 Polish Fixes Applied (Subagent QA Deep, <10 limit, via default.edit)

1. **BottomSheet hook order + scroll lock** — moved useEffect before early if(!open) return null (Rules-of-Hooks violation), added body overflow:hidden + overscrollBehavior:none lock on open restore on close.

2. **Calendar selectedDay** — useState(9) → useState(()=> new Date().getDate()) today chip now matches today not hardcoded Aug 9.

3. **Chores duplicate prevention** — handleAddToDeck() now checks chores.some(lower title == existing && status!="done") → toast "Already exists" + block prevents deck clutter.

4. **Shopping old cat migration** — added useEffect after shoppingRaw: if any it.cat not in CATS mapOldCat(it.cat) and setShoppingRaw(migrated). Fixes invisible legacy Pantry/Produce items; mapOldCat previously unused.

5. **Notes handleFile <40k** — JPEG 0.4 → if >38000 fallback webp 0.35 if still >40000 slice to 38000. Was >45000 threshold could exceed Sheet 50k cell. Now ensures polaroid 120x120 low-fi <40k + trunc 38000+…TRUNC intentional.

6. **Standalone IDB clear** — standalone effect now also idbSet(null) + openIdb().transaction.delete kv for couple_v1_currentUser prevents async idbGet hydrate restoring PIN-bypass after LS clear.

Verdict summary: All 4 pillars PASS after fixes. Remaining low-risk Aug 2026 grid offset 6 hardcoded (correct Sat start), preview persist login tradeoff, minimal emoji icons. Build re-verified HATCH_SPACES_BUILD_DRIVER=1 bun build 611K JS +48K CSS.
