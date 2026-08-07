# Stable Releases — Beirt / Nylah OS

This file tracks pinned stable releases for rollback / reference.

---

## v130 — Beirt Stable (Pinned 2026-08-07)

**Status:** PINNED STABLE — do not move without user approval

**Main:** `6ad679c` `v130-onboarding-fresh-fix`
**GH-pages:** `851601e` `v130 onboarding fresh fix`
**Tags:**
- `v130-stable` → 6ad679c (main)
- `v130-onboarding-fresh-fix` → 6ad679c
- `beirt-v130-stable` → 6ad679c
- `gh-pages-v130-stable` → 851601e (gh-pages)

**Branches (pinned):**
- `prod-v130-stable` → 6ad679c
- `beirt-stable` → 6ad679c
- `prod-v130` → 6ad679c

**Version:** code 130, build `v130-onboarding-fresh-fix`, version `130.0.0`

**Build artifacts:**
- `index-DhQYrqy4.js` 703.62 kB (688K disk, 185k gzip), `index-BBYzwo5T.css` 72.04 kB
- `icon-192.png` 23,668 B, `icon-512.png` 123,814 B, `apple-touch-icon.png` 21,454 B
- master `icon-source-beirt-black.png` 1024×1024 black #121214 bg

**What’s in this stable:**

1. **Beirt rebrand** (v126-v129):
   - Nylah OS → Beirt (Irish for two/pair)
   - manifest `name: Beirt, short_name: Beirt`, title Beirt, apple title Beirt
   - Tabs: Home title Beirt
   - theme.css clean 7-section TOC (unchanged)

2. **Logo — black + beige + mint** (v128-v129):
   - Your mockup: house outline = letter B, 2 abstract figures inside
   - Source cream → black #121214, dark green → beige #F7EFE8, terracotta → mint #B8E6C2
   - Anti-aliased edge remap to avoid halo on black
   - Auto-crop bbox 56,142→1198,1234 +5% margin, resized to 664px within 1024 (180px pad each side)
   - Final content 617×614 at 202,203→819,817 → 19.7% padding maskable-safe

3. **Dynamic names fix** (v127):
   - Fridge subtext `Aisling ♥ Ciaran • Beirt` hardcoded → dynamic `{(PERSONS[currentUser])} ♥ {(PERSONS[partner])} • Beirt`
   - Friend house `nylah-98jylh` Dean/Yashita now shows `Dean ♥ Yashita • Beirt`

4. **Onboarding fresh-browser fix** (v130):
   - Bug: `hasAnyLegacyData()` counted any `couple_v1_*` including `couple_v1_build`/`couple_v1_theme` set on mount → reload skipped onboarding → WhoScreen (Ciaran/Aisling picker)
   - Fix: only meaningful keys `household_id, household_persons, currentUser, household_code, household_name, household_persons_, household_pins`
   - Patched in `state.ts`, `OnboardingFlow.tsx`, `AppMonolith.tsx`
   - Fresh incognito now correctly shows Welcome → Create our space / I have a code

**Live verification (2026-08-07 ~14:35Z):**
- raw `https://raw.githubusercontent.com/ciaranf3308-star/nylah_os/gh-pages/version.json` → code 130 ✅
- icons 192/512 23 668 / 123 814 bytes 200 OK ✅
- manifest Beirt ✅
- SW `beirt-v130-onboarding-fix` ✅
- DB `couple_data` 3 rows (`nylah-98jylh`, `nylah-fbkf2m`, `ash-ciaran-2026`) intact ✅

**Rollback:**
```bash
git checkout v130-stable
# or
git checkout beirt-stable
# gh-pages
git checkout gh-pages-v130-stable
```

---

## Prior releases (for reference)

### v129 — Beirt black logo
- main `0edaa49`, gh-pages `0db8c17`/`5cc541b` (supabase-init.sql removal)
- black #121214 bg centered logo, 23KB/123KB icons

### v128 — Beirt logo (green+terracotta)
- main `cd7415a`, gh-pages `aadaad8`
- first house B logo cream bg

### v127 — Dynamic names
- main `84c9358`/`781c704`, gh-pages `851601e`? actually d862a66
- fixed hardcoded Aisling Ciaran to dynamic

### v126 — Beirt rebrand
- main `235307b` (6ad679c ancestor), gh-pages `ed1a411`
- Nylah → Beirt

### v125-v120 — theme facelift, dark fix, clean CSS, tabs fix, etc
- v125 clean-css `index-rsjWKN5t.js` 703k CSS 72k
- v124 dark-fix `index-ucAlfC9s.js` 705k
- v122 theme facelift grain .028→.014
- etc — see git log.

### Invariants (carry forward)
- `prod-v117-frozen` never move
- Preserve all features, no redesign deletions
- Multiplayer save DB required
- Reduced-motion + pause timers when tab hidden
- Cut ~25% effects grain/glow/pulse premium
