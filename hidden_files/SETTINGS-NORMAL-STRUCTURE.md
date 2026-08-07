# Settings — Normal Structure vs Debug Centre

Date: 2026-08-03 Dublin
Build: v3 pin-clean

## Normal Settings (always visible)

Opened via Settings cog in top bar (⚙) → "Settings + Blueprint" BottomSheet.

Structure (proposed, matches shipped partial):

1. **Appearance**
   - Theme picker: Peach / Lavender / Sage / Midnight / Paper / Blush (6 themes)
   - Preview cards showing `bg, phoneBg, accent, chipBg, cardBg` — full app change, not partial
2. **Household**
   - Timezone: Europe/Dublin (fixed, shown)
   - Today: `2026-08-03` grouping key explanation (local date, not UTC slice)
3. **Sync Status (read-only)**
   - Single source: `Saved • 12:34 PM` / `Saving…` / `Offline — 2 queued` / `Sync failed — Retry` / `Updated on another device`
   - No 60s polling, no permanent green timer
4. **About**
   - Build id, revision of row, buildMeta household id

## Debug Centre (gated)

Visibility: **only if** `?debug=1` OR `localStorage couple_v1_debug=1` OR `window.__NYLAH_DEBUG__`

Gate code already in App.tsx:

```ts
const debugFlag = url.searchParams.has('debug') || localStorage.getItem('couple_v1_debug') === '1' || (window as any).__NYLAH_DEBUG__;
```

When `!debugFlag`:

```
"Destructive wipe hidden — add ?debug=1 or set localStorage couple_v1_debug=1 to expose"
```

When `debugFlag` true, show:

- Supabase URL override input (`couple_v1_supabase_url`)
- Anon key override
- Raw remote JSON dump (expand)
- Force auth (incognito guard)
- Nuke local & reload button (`localStorage+IDB clear, keep DB`)
- Delete all remote (wipe) with confirm ("must type DELETE")
- Revision debug display

## What user sees in normal mode (Beta 2)

- No Supabase URL visible
- No raw JSON
- No Delete all remote
- No Nuke local

Only theme picker + read-only sync status.

## Open items

- Supabase URL/key override should also be debug-only (currently partially gated — UI inside BlueprintPanel but wrapped in debugFlag conditional; verify after build)
- Raw JSON dump should be behind collapsible behind debugFlag
- Document "Remember me / Ask every time" once identity toggle shipped

## Acceptance

- Normal user opening Settings sees ≤4 sections, no scary buttons.
- Debug user adding `?debug=1` reloads and sees red zone tools.
