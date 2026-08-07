# V117 → V118 Pure Composer Parity

Locked foundation zero logic change.

- Live V117 `prod-v117-frozen` `89cb7d8` `index-20kshyew.js` 736K 753145 bytes
- Pure `refactor-v1-pure` `98d1338` App.tsx 6771→231 lines, `app/state.ts` 1076 lines verbatim V1AppShell+AppCurrentUser+offline+Saved
- 36 files product-area: app/ + features/auth fridge chores calendar shopping notes settings diagnostics + data/ + shared/utils + types/constants
- Build `index-r1kybn8a.js` 698K 714731 bytes (38K dedupe from removing AppMonolith double-import, still 700-760K window)
- Tests 52 pass 0 fail 111 expect
- Tokens identical: charcoal #121214 card #232326 chip #2C2C30 nav #FF6B26/#0A0A0A topBar #1E1E20 #F5F3F0 ink fix Fraunces 26/17 Inter 16 #E8CEB7 #F7EFE8 <40% sat no emoji 44px spring cubic-bezier(0.34,1.56,0.64,1) accent 12% hero 15% grain 0.028
- PINs 4463/1958 household ash-ciaran-2026 TZ Europe/Dublin Saved Europe/Dublin reallyOnline V21 force-online

Fast edits: ChoreDeck 208 lines isolated rebuild, not 6771.

Safety: AppMonolith.tsx 6760 + App.tsx.bak 257K fallback, prod-v117-frozen never force-pushed.
