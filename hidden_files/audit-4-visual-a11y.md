# Agent 4 — Visual System & Accessibility Audit — Nylah OS

**Date:** 2026-08-03  
**Files audited:** `client/src/App.tsx` (2664 lines), `client/src/theme.css`, `client/src/components/UpdaterBanner.tsx`, `client/index.html`
**Scope:** 13-point checklist + user-reported theme bug

---

## 1. Theme Consistency (6 themes)

### THEMES definition (App.tsx:113-119)
```ts
type Theme = { id, name, bg, phoneBg, accent, accentStrong, text, cardBd, navBg, navActiveBg, navActiveText, topBarBg, washTop, washMid, chipBg, cardBg }
```
6 themes: peach (#FFFCF8), lavender (#F8F6FF), butter (#FFFEF5), mint (#F6FFFB), terracotta (#FFF7F3), midnight (#0A0A0A)

Full token set per theme — good.

### Theme application — PARTIAL / BUG CONFIRMED

**User complaint: “changing theme legit only changes 1 little thing” — VALIDATED TRUE.**

In `V1AppShell` (line 2270-2282):
```ts
useEffect(()=>{
  const r = document.documentElement;
  r.style.setProperty('--app-bg', theme.bg);
  r.style.setProperty('--surface', theme.cardBg);
  r.style.setProperty('--surface-muted', theme.bg);
  r.style.setProperty('--text-primary', theme.text);
  r.style.setProperty('--text-secondary', '#5A5655');
  r.style.setProperty('--border', theme.cardBd);
  r.style.setProperty('--accent', theme.accent);
  r.style.setProperty('--accent-strong', theme.accentStrong);
  r.style.setProperty('--nav-bg', theme.navBg);
  r.style.setProperty('--nav-active', theme.navActiveBg);
}, [theme]);
```

Sets 10 CSS variables on `:root`, but:

- **CSS file never consumes most of them** — `theme.css` defines its own `:root` with `--bg: #FFFCF8`, `--surface: #FFFCF8`, `--border: #E8CEB7` etc that override/are hardcoded, and components rarely use `var(--app-bg)` style.
- Actual UI uses `theme.bg`, `theme.cardBd` etc via inline `style={{ background: theme.xxx, borderColor: theme.cardBd }}` in only a few top-level containers (shell, topBar, nav). 
- Inner cards overwhelmingly use hardcoded `bg-[#FFFCF8]`, `borderColor: "#E8CEB7"` (93× #E8CEB7, 58× #F7EFE8 hardcodes).
- Result: switching theme changes outer shell + nav + topBar, inner cards stay peach. Midnight (#0A0A0A) leaves white cards on black bg → instant broken look, user perception “only 1 little thing changed”.
- Midnight tokens themselves suspect: `cardBg: "#1E1E1E"` but no component reads it except via CSS var that never gets applied to card backgrounds.

**Fix required:** Full token system via CSS variables applied in `theme.css` or Tailwind `@theme` map, replace all hardcoded #E8CEB7/#F7EFE8 with `var(--border)` / `var(--surface)` / `var(--accent)` etc, ensure `.card`, `.card-flat`, empty states, sheets all consume tokens. Verify midnight reads.

---

## 2. CSS Variables vs Hardcoded Colors

- **#E8CEB7 appears 93 times** in App.tsx — borders, chip backgrounds, dot grids, sheet handles, polaroid fallbacks. Only 12 places use `var(--border, #E8CEB7)`.
- **#F7EFE8 appears 58 times** — button fills, muted surfaces, corkboard. No var fallback in most.
- `theme.css` defines `--border: #E8CEB7`, `--peach`, `--cream` but component CSS (`.card { border: 1px solid #E8CEB7 }`, `.dot-grid radial-gradient(#E8CEB7 ...)`, `.sheet-handle bg:#E8CEB7`, `.corkboard bg:#F7EFE8`) still hardcoded.
- Design tokens in V1AppShell set `--app-bg`, `--surface`, `--border`, `--accent` but never `--wash-start`, `--wash-end`, `--surface-raised`, `--text-inverse`, `--focus-ring`, `--shadow-*` as required in spec (Global Technical Foundations §8). All pages need migration.

**Risk:** Midnight, lava, butter themes unreadable in detail panels; any future theme = re-audit 150 hardcodes again.

---

## 3. Contrast / Midnight Theme (#0A0A0A)

- Midnight: `bg #0A0A0A`, `text #FAFAF9`, `cardBd #2A2A2A`, `navBg rgba(18,18,18,0.92)`, `navActiveBg #F5F5F4`
- Midnight `navBg rgba(18,18,18,0.92)` on bottom floating pill with `backdrop-blur-[20px]` — over light content, blur reads as grey but still low contrast vs underlying `FFFCF8` cards. Needs explicit contrast test (WCAG AA fails if text #FAFAF9 on rgba 18/0.92 over white = calc ~#E5E5E5 background → ratio ~14:1 passes *text*, but inactive nav label `theme.text = #FAFAF9` on `transparent` pill segment over white body behind pill likely 21:1 fail for mid-state).
- Card in midnight currently white `#FFFCF8` with dark text — actually passes, but loses midnight intent; should be `#1E1E1E` with light text to keep personality.
- Status chips: orange dot / peach pill with #5A5655 text — in midnight, border #E8CEB7 not #2A2A2A means chip pops; text #5A5655 on #F7EFE8 not in dark tokens.
- Overall: Midnight never visually QAd due to partial theme apply.

---

## 4. Font Sizes (Tiny-text audit)

Global small type pervasive, many below 11px floor:

- `text-[8px]`, `text-[9px]`, `text-[10px]` used for meta/status/legends in:
  - Chores: Bonus +30% pill, pts labels, pain dots ~10px.
  - Calendar: weekday headers, month-year label 11px.
  - Fridge: sticky love author 11px.
  - Shopping: `text-[9px]` overdue pill, category select.
- EmptyState title 14px OK, subtitle 11px readable, but Fridge micro-copy “for you…” 11px borderline.
- Spec requires review extremely small 8–10px — important instructions not rely on tiny type. Many of these ARE status (overdue, bonus, time left). 
- Dynamic Type not supported (no rem scaling); all fixed px/tailwind.

**Recommendation:** Raise floor to 11px for body meta, 12px minimum for interactive controls; keep 10px only for non-essential upper-case legends with letter-spacing.

---

## 5. Tap-Target Sizes (44px)

**Pass with gaps:**

- Good: major CTAs have `min-h-[44px]`, `min-w-[44px]` — EmptyState button (598), BottomSheet close handle, nav buttons (46px), shopping qty +/- uses 28px but inside 28px tall pill overall 28px <44px → fail.
- Bad:
  - Shopping `togglePurchased` uses 24px circle (line 1834) — fails WCAG 2.5.5.
  - TopBar: back home, gear, sync dot are 32px (`h-8 w-8`) — below 44px; on narrow device hard to hit.
  - Fridge open chores 140px cards clickable but whole card is button? Yes button wraps — OK.
  - BottomSheet backdrop is close but no visible close button besides drag handle; ESC works but touch users must tap backdrop.
  - `WhoScreen` PIN pad uses 48px (good).

**Fix:** Enlarge interactive to 44px min, add padding slop for smaller visual circles.

---

## 6. Focus States

- Almost zero `focus-visible`, `focus:ring`, `focus:outline` declarations in App.tsx.
- Inputs have `focus:border-[#0A0A0A]` (726) — low visibility, no ring.
- Buttons use `active:scale` but no focus ring; keyboard users cannot see where they are.
- `theme.css` has no `:focus-visible` rule.
- Tailwind `@theme` defines `--text-xs` but not `--focus-ring`.

**Critical gap.**

---

## 7. Keyboard Support

- BottomSheet: ESC to close implemented via `keydown` listener (good), but doesn't trap focus.
- No `tab` loop handling for Sheet; focus can slip to background (background still interactive via backdrop blur?).
- Swipes require pointer — alternatives exist (left nope / right yes buttons) via `aria-label` swipe left/right (1279) — good coverage for Chore Duel.
- Calendar month prev/next has aria-label (1449/1451) — good.
- No `onKeyDown` Enter/Space for card divs that act as buttons (fridge cards are `<button>` — good).
- `WhoScreen` PIN input accepts keyboard, but numpad buttons no keyboard nav grouping.

Overall: partial.

---

## 8. Screen-Reader Labels

- Positive:
  - `aria-label="close sheet"`, `aria-label="swipe left nope"`, `aria-label="swipe right yes"`, `aria-label="mark done"`, `aria-label="prev/next month"`, `aria-label="back home"`.
  - Buttons mostly have visible text, not icon-only without label.
- Negative:
  - BottomSheet missing `role="dialog"` & `aria-modal="true"` & `aria-labelledby` linking title.
  - Confetti host `aria-hidden` not set — announces nothing? Should have `aria-hidden="true"`.
  - Status dot `animate-pulse` no text alternative — needs `aria-live` or text hidden label.
  - EmptyState decorative sun icon no `aria-hidden`.
  - Theme picker lacks `aria-pressed`.
  - `SyncStatusIsolated` status text inline but no live region.

---

## 9. Zoom Support — BLOCKED

`client/index.html:5`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
```

- `user-scalable=no` explicitly disables pinch-zoom — fails WCAG 1.4.4 Resize Text & spec “Users must be able to pinch zoom”.
- Audit checklist: Zoom support (user-scalable=no is blocking) → CONFIRMED VIOLATION.
- Must change to `width=device-width, initial-scale=1, viewport-fit=cover` and remove `user-scalable=no`, add `maximum-scale=5` or omit.
- Also `html, body { overflow-x: hidden }` in theme.css can clip zoomed content but acceptable if no horizontal lock.

---

## 10. Reduced Motion

- `grep` returns zero matches for `prefers-reduced-motion`.
- Animations run unconditionally: `sheetIn 0.24s`, `pulseRing infinite`, `confettiFall`, `rowPop`, `ticketTear`, `animate-pulse` on many dots.
- Chore Duel throw, confetti celebration ignore prefers-reduced-motion.
- Spec requires disable/simplify card throwing, confetti, pulse loops, sheet animation, rotating notes.

**Gap.**

---

## 11. Modal Focus Trapping (BottomSheet)

`BottomSheet` (606-632):
- Implements ESC, scroll lock via `document.body.style.overflow hidden` and `documentElement overscrollBehavior none` (good, but doesn't restore previous overscroll correctly if multiple sheets).
- Doesn't trap focus: no `focus-trap-react` or manual first/last focus loop.
- Doesn't remember previously focused element to return focus on close.
- Backdrop is `<button aria-label="close sheet">` covering whole screen (good for click), but keyboard focus can escape to elements behind modal because portal to `document.body` not marked `inert`.
- Initial focus not set (should focus sheet title or first interactive).

Spec requires focus trap, initial focus, return focus to trigger, title association.

---

## 12. Dynamic Type / Text Scaling

- No relative units: all `text-[11px]`, `text-[12px]`, fixed clamp only in hero.
- `html { font-size }` not respecting user's browser default increase.
- iOS Dynamic Type / Android font scaling not tested — fixed px will not scale.
- `--text-xs: 10px` in @theme locks tiny size globally.

Needs `rem` base or `clamp` with accessibility check.

---

## 13. Colour-Independent Status Communication

- Status relies heavily on color dots:
  - Open vs Bonus (orange dot vs purple).
  - Assigned vs Unclaimed — dot color only.
  - Shopping overdue — pill border switches to `#FECDD3` but still red-ish alone.
  - Pairing `+30%` purple pill adds text label — good, but overdue only border color.
- Spec: Do not rely only on green vs orange, peach vs lavender, small coloured dots. Always pair colour with text/icon/shape.
- Fixes: already some text (“BONUS +30%”, “overdue by Xd”), but small 8-10px dots should add icon or prefix.

---

## 14. Other Visual Bugs from Checklist

### Fake 9:41 div removed? ✅ PASS
- `grep 9:41 App.tsx` returns 0 results. No fake status bar time.
- `isButter`, hero heart etc remain but not fake time.

### UpdaterBanner duplicate rendering? ⚠️ PARTIAL PASS
- Single import `UpdaterBanner` in V1AppShell top-bar (line 2583). 
- No second `<div px-3.5 pb-1>` wrapper (that was removed in QA audit rev 17→18). 
- However `UpdaterBanner.tsx` also exports `UpdaterPill` unused — dead code but harmless.
- `UpdaterBanner` itself installs its own `intervalRef` 15min check + visibility + focus listeners — if rendered twice would double poll. Currently single instance, so OK.

### Floating nav z-[60] backdrop-blur frozen overlay
- Nav container: `class pointer-events-none absolute bottom-0 z-[60] ... backdrop-blur-[20px] pb-[max(14px,env(safe-area-inset-bottom))] pt-2` with inner `pointer-events-auto` pill `minWidth 332px maxWidth 96% minHeight 60px`. 
- Position: `absolute bottom-0` inside relative phone shell, not `fixed`. On long page scroll, nav scrolls with content? Spec says “bottom nav bar THAT NEEDS TO BE FROZEN on screen and all times as forced overlay”. Current `absolute` within scrolling container? Container itself is `flex-1 overflow-auto` sibling to nav? Actually structure: root holds `phoneInnerRef` relative with `overflow-hidden`; inner scroll div is `flex-1 overflow-auto no-scrollbar px-3.5 pt-3 pb-[106px]`. Nav is `absolute bottom-0` sibling inside same relative parent — thus visually frozen over scroll (since scroll is inside inner div). Good, but should be `position: absolute` with safe-area, and `isolation:isolate` (present). For standalone full-screen dvh, nav still inside flex column parent with `overflow-hidden` — likely works but risky. Could use `position: sticky bottom-0` for extra guarantee. Overall PASS with note.

### Theme preview whole app vs little thing
Already covered in §1 — FAIL, needs rework.

### Midnight navBg rgba readablity
Covered §3 — needs contrast pass.

---

## Summary Scorecard

| Area | Status | Notes |
|------|--------|-------|
| Theme consistency | ❌ FAIL | Only shell uses theme object, cards hardcoded #FFFCF8/#E8CEB7 |
| CSS vars vs hardcoded | ❌ FAIL | 93/58 hardcodes, 10 vars set but not consumed |
| Contrast (midnight) | ⚠️ PARTIAL | Text AA likely passes on pure black, but nav on white behind blur untested, chip greys questionable |
| Font sizes 8-10px | ⚠️ WARN | Important status sometimes 10px, non-essential OK |
| Tap targets 44px | ⚠️ WARN | Most good after beta polish, some 24/28/32px circles |
| Focus states | ❌ FAIL | Almost none |
| Keyboard | ⚠️ PARTIAL | ESC works, no focus trap |
| Screen-reader labels | ⚠️ PARTIAL | Good aria-labels on key swipe, missing dialog roles |
| Zoom | ❌ FAIL | user-scalable=no active |
| Reduced motion | ❌ FAIL | No prefers-reduced-motion handling |
| Modal focus trap | ❌ FAIL | No trap, no return focus |
| Dynamic type | ❌ FAIL | No rem scaling |
| Colour-independent | ⚠️ WARN | Dots mostly paired with text but some border-only |

### Immediate Blockers to Beta→Prod
1. Remove `user-scalable=no` (index.html:5)
2. Full theme -> CSS vars migration (90+ hardcodes)
3. Add focus-visible ring
4. Add prefers-reduced-motion media query disabling confetti/pulse
5. BottomSheet role=dialog + aria-modal + focus trap
6. Enlarge 24/28/32 tap targets

### Nice-to-have polish aligning with product principles
- Replace 10px uppercase tracking labels where they *are* status with 11px medium + icon.
- Midnight visual QA once theme fully applied.
- Make `EmptyState` border use `var(--border)` universally (already fallback but many places pass `theme.cardBd` — unify).

---

**Evidence files**
- Count results: `grep -o "#E8CEB7" App.tsx | wc -l` → 93
- Count `#F7EFE8` → 58
- Theme var setter snippet line 2272-2281
- UpdaterBanner single instance confirmed line 2583
- Fake 9:41 zero matches
- Zoom meta present line 5 index.html

End report.
