# V117 Inventory — Locked Stable

**Base:** V117 v117-dark-text-fix-freeze-clean code 117 assets index-20kshyew.js 736K (753145 bytes)  
Main: 4cfbabb, gh-pages: 89cb7d8 (89cb7d8 built). CDN live confirmed 117 2026-08-06 18:18 IST.

## Feature List (from bundle grep + src)
- PIN + biometric unlock (verifyPin, WebAuthn registerBiometric/authenticateBiometric, webAuthnIdKey)
- Face ID settings (BiometricToggle, PushToggle)
- Fridge home (FridgePage) - boutique-hotel warm paper/peach + charcoal
- Needs You (NeedsYou / pending responses)
- Today and Upcoming (calendar Today/Upcoming split, relTime)
- Pinned countdowns
- Chore Championship
- Chore Deck, Mine, Open, Done, Admin
- Swipe claiming, passing, races (swipes left/right, race, bonus 1.15x)
- Monthly scoring and reset countdown (Scoreboard, weekNumberSinceEpoch)
- Chore recurrence and icons (CHORE_ICONS, ChoreIcon, dayOfMonth, frequencyDetail, twice-week, weekly, biweekly, monthly, custom, once, one-off/repeat)
- Calendar month and agenda (CalendarPageV2, AddEventForm)
- Yes, No, Discuss responses (CalendarEventStatus, CalendarResponseKind)
- Personal and shared events (attendees, proposer, personal/shared)
- "This event", "This and future", "Entire series" (occurrence overrides)
- Pantry filters (mapOldCat, CATS Food/Household/Toiletries/Clothes/Bills/Trips/Entertainment/Personal/Other)
- Recurring shopping items (ShoppingFrequency daily/every-2d/weekly/biweekly/monthly/as-needed, needDays)
- Trip Mode
- Notes, love notes, pinned notes, archives (NoteMemo isLove, pinned_at, archived_at, reactions heart/laugh/kiss/ack)
- Photo notes 900px stickyboard (photoDataUrl, photoThumbDataUrl, resizeToDataUrl, createThumbnail, 900px board)
- Notifications (PushToggle, service worker, syncStatus)
- Offline queue and realtime syncing (remoteSync, remoteLoad/remoteSave, subscribeRemote, idb queue, reallyOnline HEAD fix)
- Debug and recovery tools (DebugCenter, useIsDebug)
- Onboarding, Household ID Europe/Dublin (HOUSEHOLD_ID, HOUSEHOLD_TZ, todayKey, toLocalKeyDublin)
- Theme system (2 themes) with CSS vars --bg --phone-bg --card-bg --text --text-primary etc.

## THEMES (from App.tsx:246)
```ts
const THEMES: Theme[] = [
  { id: "beige", name: "Beige", bg: "#F7EFE8", phoneBg: "linear-gradient(180deg,#FFDCC7 0%,#FFE8D6 22%,#FFFEFB 100%)", accent: "#E8CEB7", accentStrong: "#8B5E3C", text: "#292624", cardBd: "#E8DDD3", navBg: "rgba(255,254,251,0.94)", navActiveBg: "#8B5E3C", navActiveText: "#FFFEFB", topBarBg: "#FFFEFB", washTop: "#FFDCC7", washMid: "#FFE8D6", chipBg: "#F7EFE8", cardBg: "#FFFEFB" },
  { id: "ink", name: "Charcoal Orange", bg: "#121214", phoneBg: "linear-gradient(180deg,#232326 0%,#1E1E20 28%,#161618 58%,#121214 100%)", accent: "#FF6B26", accentStrong: "#FF8A4D", text: "#F5F3F0", cardBd: "rgba(255,255,255,0.08)", navBg: "rgba(22,22,24,0.88)", navActiveBg: "#FF6B26", navActiveText: "#121214", topBarBg: "#1E1E20", washTop: "#2E2E32", washMid: "#242428", chipBg: "#2C2C30", cardBg: "#232326" },
];
```
Theme type:
```ts
type Theme = { id: string; name: string; bg: string; phoneBg: string; accent: string; accentStrong: string; text: string; cardBd: string; navBg: string; navActiveBg: string; navActiveText: string; topBarBg: string; washTop: string; washMid: string; chipBg: string; cardBg: string };
```
Fixed in V117: ink overrides --text #F5F3F0 not var(--card-bg).

## TabKey + TABS
```ts
type TabKey = "fridge" | "plans" | "calendar" | "chores" | "shopping" | "notes" | "blueprint";
const TABS = [
  { k: "fridge", label: "Home", title: "Nylah" },
  { k: "plans", label: "Plans", title: "Plans" },
  { k: "chores", label: "Chores", title: "Chores" },
  { k: "shopping", label: "Shop", title: "Shop" },
  { k: "notes", label: "Notes", title: "Notes" },
] as const;
```

## Core Types
- `PersonKey = "aisling" | "ciaran"`
- `PERSONS: Record<PersonKey, { name, initial, accent, accent2, wash }>`
- `ChoreV2 = { id, title, type: one-off|repeat, frequency: daily|twice-week|weekly|biweekly|monthly|custom|once, frequencyDetail?, dueAt?, createdAt, pain, basePoints, swipes: {aisling, ciaran}, status: deck|assigned|open|race|bonus|done, assignedTo?, multiplier, isOpenDoubled?, completedBy?, completedAt?, timeWindowHours?, updatedAt?, updatedBy?, deletedAt?, templateId?, icon?, dayOfMonth?, originalDom?, localTime?, timezone? }`
- `CalendarEventStatus = draft|proposed|awaiting_aisling|awaiting_ciaran|needs_discussion|agreed|declined|cancelled|completed|open|dismissed`
- `CalendarResponseKind = yes|no|discuss`
- `CalendarEventResponse = { eventId, memberId: PersonKey, response, comment?, respondedAt }`
- `CalendarEventV2 = { id, title, type, frequency?, frequencyDetail?, dueAt ISO, endAt?, start?, end?, createdAt, pain?, basePoints?, swipes {aisling,ciaran}, responses?, status, proposer?, assignedTo?, allDay?, location?, notes?, reminderMinutes?, responseDeadline?, attendees? PersonKey[], recurrenceRule?, templateId?, occurrenceId?, isTemplate?, dayOfMonth?, originalDom?, localTime?, timezone?, updatedAt?, updatedBy?, deletedAt?, dismissed?, proposalReason?, mutationId?, lastNotifiedState? }`
- `ShoppingCategory = Food|Household|Toiletries|Clothes|Bills|Trips|Entertainment|Personal|Other`
- `ShoppingFrequency = daily|every-2d|weekly|biweekly|monthly|as-needed`
- `ShoppingItemV2 = { id, item, qty, cat, purchased, addedBy, createdAt, lastDoneAt?, repeatCount, history?, frequency, needDays?, notes?, tags?, updatedAt?, deletedAt?, archivedAt?, status?, isTemplate?, templateKind? personal|wants, templateOwner?, expiresAt?, mutationId?, originalDom? }`
- `PersonalWants`
- `NoteReactionKind = heart|laugh|kiss|ack`
- `NoteMemo = { id, body, author, createdAt, seenBy, isLove, photoDataUrl?, photoThumbDataUrl?, photoStoragePath?, rotation?, updatedAt?, deletedAt?, pinned_at?, archived_at?, read_by?, reactions?, edited_at? }`
- Aliases: `CalendarEvent=CalendarEventV2`, `Chore=ChoreV2`, `ShoppingItem=ShoppingItemV2`

## Helper Functions (src/App.tsx lines ~)
- Storage: isQuotaError, safeGetLS, safeSetLS, LS_PREFIX
- Hooks: useIsStandalone, useLocalState<T> (with IDB hydration, photo trimmed LS), useIsDebug, usePrefersReducedMotion, useLocalState wrapper for notes large photo handling
- Persons: getHouseholdPersonsRaw, applyCustomPersonNames
- WebAuthn: bufToB64u, b64uToBuf, webAuthnIdKey, isWebAuthnSupported, canDoPlatformBiometric, registerBiometric, authenticateBiometric
- Theme icons: TabIcon, IconFlame, IconEye, IconSparkle, IconTrophy, IconCrown, IconCheckTiny
- Tab meta: getTabMeta, getPageTitle
- IDs: uid, hashId, rotForId
- Time: relTime, timePartFromIsoDublin, wallToIsoDublin
- Chore logic: windowHoursForChore, getDueMsChore, percentLeftChore, isBonusChore, effectivePoints, effortLabel, freqBadgeChore, boolToJsWeekdays, parseFrequencyDetailToJsDays, weekdaysBoolToDetailString, nextDateMatchingWeekdays, computeNextOccurrenceForDailyOrTwice, computeNextDueFromWeekdays, computeNextDueDateChore
- Shopping: freqToHours, computeShoppingNextDue, shoppingFrequencyBadge, shoppingDueLabel, shoppingRestockText, parseNeedDaysToBool, boolToNeedDaysString, shoppingNeedDaysLabel, mapOldCat
- Calendar: getDueMsCal, percentLeftCal, isBonusCal, computeNextOccurrenceForDailyOrTwice already
- Doodle icons: DoodleSun, Sparkle, Leaf, Jar, Broom, IconHeart, IconX, IconCheck, IconChevronDown/Left, GhostNum, MicroLabel, EmptyState, BottomSheet, SyncStatusIsolated
- Household: generateInviteCode, getStoredHouseholdId, hasAnyLegacyData, shouldShowOnboarding, OnboardingFlow, WhoScreen, AvatarDot, DoodleHeartAccent
- Pages: FridgePage, Scoreboard, ChoresPage, CalendarPageV2, ShoppingPageFacelift, NotesMemoPage, PersonalAdd, DebugCenter, PushToggle, BiometricToggle, BlueprintPanel, V1AppShell
- BuildMeta: HOUSEHOLD_ID, HOUSEHOLD_TZ Europe/Dublin
- Lib imports still used: getSupabase, hasSupabaseConfig, saveSupabaseConfig, remoteLoad/save/subscribeRemote, normalized (claimChoreViaRpc, completeChoreOccurrence, insertChoreOccurrence, syncChoreOccurrencesToSupabase, upsertCalendarSeries/Override), CHORE_ICONS, dates (todayKey, toLocalKeyDublin, tzWallToUtc, nextMonthlyFrom, diffCalendarDays, clampDayOfMonth, weekNumberSinceEpoch), recurrence (expandTemplateForMonthDublin, addDaysKey, getDublinHourMinuteFromIso, shouldSuppressGeneratedOccurrence), pins verifyPin, idb openIdb/idbGet/idbSet/idbGetQueue/idbSetQueue, images resizeToDataUrl/createThumbnail

## Current File Tree
```
client/src/
  App.tsx (6882 lines, monolith)
  App.tsx.bak
  main.tsx / main.gh.tsx
  theme.css
  components/UpdaterBanner.tsx
  lib/
    buildMeta.ts, choreIcons.tsx, dates.ts, idb.ts, images.ts, normalized.ts, pins.ts, push.ts, recurrence.ts, remoteSync.ts, schemas.ts, supabase.ts, updater.ts, useReducedMotion.ts
    __tests__/ dates.test.ts, recurrence.test.ts, sync.test.ts
  src/ (duplicate copy, same structure)
```

## Bundle Grep Inventory (v117 live)
- grep -c chore ~ 4k+ matches
- PIN, biometric, Championship, Deck all present
- SW cache: nylah-os-v117-dark-text-fix
- reallyOnline HEAD probe removed (force-online V21)

## PINs preserved
4463 / 1958 (from verifyPin)

## TZ
Europe/Dublin hard-coded in HOUSEHOLD_TZ, toLocalKeyDublin, diffCalendarDays all Dublin.

## Supabase
TABLE couple_data, ROW_ID ash-ciaran-2026, fallback supabase.ts + supabase-env.js anon=eyJ, rev handling.

## Constraints for refactor
- ZERO logic change: copy-paste JSX, keep exact strings/colors/calc
- Keep App.tsx.bak untouched
- Keep offline queue, realtime, saved timestamps
- Keep 44px min spring cubic-bezier(0.34,1.56,0.64,1)
