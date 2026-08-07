# Refactor Plan V117 — Zero-Logic Split

**Goal:** Break 6882-line App.tsx into fast-edit modules, same bytes-out logic.

**Locked:** V117 v117-dark-text-fix-freeze-clean code 117 assets index-20kshyew.js 736K live stable main 4cfbabb gh-pages 89cb7d8.

## Principles
- No visual, no functional, no behavior change. Copy-paste only.
- Bundle size stays 700-760K after each step (min 700 due to splitting overhead, max 760)
- grep -c for key strings must stay same count or increase slightly (due to extra exports)
- Keep App.tsx.bak untouched, App.tsx becomes composition root ~300 lines
- Use bun build verification each step: `HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs`
- Run tests: `bun test lib/__tests__` if present
- No gh-pages push, stays on refactor/split-v117 branch locally

## Stage Breakdown

### Stage 0 — Already exists, keep
- `client/src/lib/*` : normalized, supabase, remoteSync, dates, recurrence, choreIcons, pins, idb, images, buildMeta, schemas, push, updater, useReducedMotion
- `client/src/components/UpdaterBanner.tsx`
- `client/src/theme.css`

### Stage 1 — Types (first extraction, done first)
File: `client/src/types.ts` + re-export shim
- Extract to `types.ts`:
  - `PersonKey`, `PERSONS` type only (const stays in constants if needed)
  - `Theme`
  - `TabKey`, `TABS` type/meta
  - `ChoreV2`, `Chore` alias
  - `CalendarEventStatus`, `CalendarResponseKind`, `CalendarEventResponse`, `CalendarEventV2`, `CalendarEvent`
  - `ShoppingCategory`, `ShoppingFrequency`, `ShoppingItemV2`, `ShoppingItem`, `CATS`, `PersonalWants`
  - `NoteReactionKind`, `NoteMemo`
  - `AddEventFormProps`
- Keep re-exports in App.tsx via `import type {...} from "./types"` for zero churn, then gradually switch.

Verification: build still passes, bundle size within 736K ±20K, grep still finds PIN etc via App.tsx re-export.

### Stage 2 — Constants / Themes
File: `client/src/constants/themes.ts`
- `THEMES` array (2 items, beige+ink) exact copy
- `PERSONS` const (since it's data not logic)
- `TABS` const array (5 tabs)
- `CATS` const

Potentially `client/src/constants/persons.ts` but keep in themes.ts for now to reduce splits.

Implementation:
```ts
// constants/themes.ts
export type Theme = { ... };
export const THEMES: Theme[] = [...exact copy...];
export const PERSONS = { ... };
export const TABS = [...] as const;
export type TabKey = ...
```
App.tsx: `import { THEMES, PERSONS, TABS } from "./constants/themes"` replacing inline definitions.

Verification: `grep "#F5F3F0" constants/themes.ts` must find 1x.

### Stage 3 — Hooks / Helpers
Separate directory `client/src/hooks/` + `client/src/lib/` additions:
- `hooks/useIsStandalone.ts` (68-115 lines)
- `hooks/useLocalState.ts` (safeGetLS, safeSetLS, isQuotaError, IDB hydration, photo trimmed logic)
- `hooks/useIsDebug.ts`
- `hooks/usePrefersReducedMotion.ts` (already exists as lib but duplicate)
- `lib/helpers.ts` or `lib/ui-helpers.ts`:
  - `uid`, `hashId`, `rotForId`, `relTime`
  - `getTabMeta`, `getPageTitle`
  - `timePartFromIsoDublin`, `wallToIsoDublin`
  - WebAuthn helpers: `bufToB64u`, `b64uToBuf`, `webAuthnIdKey`, `isWebAuthnSupported`, `canDoPlatformBiometric`, `registerBiometric`, `authenticateBiometric`
  - Household: `getHouseholdPersonsRaw`, `applyCustomPersonNames`, `generateInviteCode`, `getStoredHouseholdId`, `hasAnyLegacyData`, `shouldShowOnboarding`

Chore helpers go to `lib/chore-helpers.ts`:
- `windowHoursForChore`, `getDueMsChore`, `percentLeftChore`, `isBonusChore`, `effectivePoints`, `effortLabel`, `freqBadgeChore`, `boolToJsWeekdays`, `parseFrequencyDetailToJsDays`, `weekdaysBoolToDetailString`, `nextDateMatchingWeekdays`, `computeNextDueDateChore`

Calendar helpers `lib/calendar-helpers.ts`:
- `getDueMsCal`, `percentLeftCal`, `isBonusCal`, `computeNextOccurrenceForDailyOrTwice`, `computeNextDueFromWeekdays`

Shopping helpers `lib/shopping-helpers.ts`:
- `mapOldCat`, `freqToHours`, `computeShoppingNextDue`, `shoppingFrequencyBadge`, `shoppingDueLabel`, `shoppingRestockText`, `parseNeedDaysToBool`, `boolToNeedDaysString`, `shoppingNeedDaysLabel`

Icons `components/icons.tsx`:
- `TabIcon`, `IconFlame`, `IconEye`, `IconSparkle`, `IconTrophy`, `IconCrown`, `IconCheckTiny`, `DoodleSun`, `DoodleSparkle`, `DoodleLeaf`, `DoodleJar`, `DoodleBroom`, `IconHeart`, `IconX`, `IconCheck`, `IconChevronDown`, `IconChevronLeft`, `GhostNum`, `MicroLabel`, `EmptyState`, `BottomSheet`, `SyncStatusIsolated`

Verification each: build, grep still present in bundle (since imported).

### Stage 4 — Per-Tab Components
Create `client/src/components/<tab>/` directories, each exact copy of corresponding Page function from App.tsx:

- `components/pin/WhoScreen.tsx` (WhoScreen)
- `components/onboarding/OnboardingFlow.tsx`
- `components/fridge/FridgePage.tsx` (FridgePage 2031-2541)
- `components/chores/Scoreboard.tsx` (2542-2574)
- `components/chores/ChoresPage.tsx` (2575-3491) — Deck/Mine/Open/Done/Admin/Championship
- `components/chores/championship/*` eventually split further but keep as single file first
- `components/plans/CalendarPageV2.tsx` (3492-4406) + `AddEventForm` (567-800)
- `components/shopping/ShoppingPageFacelift.tsx` (4407-4807)
- `components/shopping/IconCat.tsx`, `PersonalAdd.tsx`
- `components/notes/NotesMemoPage.tsx` (4818-5024)
- `components/settings/DebugCenter.tsx`, `PushToggle.tsx`, `BiometricToggle.tsx`, `BlueprintPanel.tsx`, `AvatarDot`, `DoodleHeartAccent`
- `components/nav/TopBar.tsx` + `BottomNav`
- `components/layout/V1AppShell.tsx` (5481-6882 composition root wrapper)

Each component file top: `// ZERO LOGIC CHANGE — copied from App.tsx lines X-Y`

App.tsx import wrapper: `import { FridgePage } from "./components/fridge/FridgePage"` etc.

Keep exact JSX, same tailwind classes, same Fraunces 26/17 Inter 16 #E8CEB7 #F7EFE8 <40% sat, same 44px min spring cubic-bezier(0.34,1.56,0.64,1), same 100vw full-bleed, 390→100vw QA.

### Stage 5 — Composition Root Shrink

Final App.tsx ~300 lines:
- imports: all types, constants, hooks, components
- state wiring: useLocalState chores/calendar/shopping/notes, theme, tab, currentUser, syncStatus
- useEffect CSS vars (theme ink fix preserved)
- useEffect reallyOnline, offline queue, subscribeRemote
- return <V1AppShell tab={tab} theme={theme} ...><...Pages /></V1AppShell>

Preserve:
- Supabase sync: remoteLoad/save, subscribeRemote, normalized upserts, reallyOnline force-online (V21)
- Offline queue, trusted Saved real server time, normalized mirror
- Calendar Dublin TZ with weekday picker + This/Future split
- Chores Tinder swipe deck/mine/o etc 44px spring
- Shopping freq + personal/wants, Notes 900px stickyboard
- Floating nav, script hero, Fraunces+Inter
- PIN 4463/1958 hardcoded verifyPin
- Europe/Dublin TZ handling entire app
- No new deps, same Vite driver HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs

### Bundle Size Guard

After each extraction:
```bash
HATCH_SPACES_BUILD_DRIVER=1 bun ./client/build.mjs
ls -lh client/dist/assets/index-*.js
grep -c "Championship\|biometric\|Fridge\|Deck\|PANTRY\|Photo" client/dist/assets/index-*.js
```

Expect 736K → 720-760K jitter due to tree-shaking. If >800K or <650K, investigate accidental duplication or deletion.

### Tests

```bash
bun test lib/__tests__
# dates.test.ts, recurrence.test.ts, sync.test.ts must pass
```

### Do NOT

- Change visual strings, colors, logic, recurrence, TZ
- Change Supabase sync, offline queue, reallyOnline, saved timestamps
- Change PINs 4463/1958
- Delete App.tsx yet — keep App.tsx.bak
- Push to gh-pages — stays on branch refactor/split-v117
- Add new npm deps — bun only

### Stop Condition

Task says stop after plan + first two extractions (types + themes) if file work large, report remainder. So after Stage 1+2, if build passes, create report file tree, bundle comparison, tests.

### Remaining Work After This Task
- hooks extraction
- icons extraction
- per-tab components extraction
- final App.tsx shrink to 300 lines
- full QA tour: PIN 4463/1958 both themes, tab tour Home/Plans/Chores/Shop/Notes/Settings, save qa-live-tour-117-refactor.md

