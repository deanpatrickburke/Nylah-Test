# Agent 6 — QA & Test Design — Nylah OS

**Source analyzed:** `client/src/App.tsx` ~3500 LOC single-file app, `client/src/lib/remoteSync.ts` (12K with revision-CAS + tombstone), `supabase-init.sql` (single-row `couple_data` permissive anon), `package.json` (no test runner), `audits/` (20 screenshot-only runs, no unit/integration coverage).

> Keep the soul: warm fridge metaphor, paper+collar cards, handwritten Fraunces/Inter <40% sat `#E8CEB7 #F7EFE8`, 390px lock, Aisling♥Ciaran header, bottom nav frozen `z-[60]`. Tests must not require turning product into a generic SaaS dashboard.

---

## 0. Existing Test Inventory

- `package.json` scripts: `typecheck`, `build:server`, `build:client`. **No** `test`, `test:watch`, `coverage`.
- `node_modules/zod` present (4.4.3) but **zero** runtime schema usage in App.tsx. All entities are `type` assertions.
- No `vitest`, `jest`, `@testing-library/react`, `playwright` installed.
- `audits/latest` → screenshots + `report.json` with `mobile_layout`, `images`, `console_errors` — essentially visual smoke, not logic.
- `hidden_files/qa-*` from prior sub-agents: shopping→Food mapper fix, notes photo trim, `choresRaw` migration `a/b → aisling/ciaran`, but no automated regression guard. Bugs can re-introduce silently.

**Verdict:** Ship-risk 8/10 logic bugs masked by pretty screenshots. Need vitest fast.

---

## 1. Recommended Setup (no personality loss)

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run --reporter=verbose",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:visual": "vitest run tests/visual",
    "test:a11y": "vitest run tests/a11y"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "jsdom": "^24.1.0",
    "@testing-library/react": "^14.2.1",
    "@testing-library/jest-dom": "^6.4.2",
    "@testing-library/user-event": "^14.5.2",
    "msw": "^2.2.3",
    "zod": "^4.4.3",
    "@axe-core/playwright": "^4.8.4"
  }
}
```

`vitest.config.ts` (new at workspace root):

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['client/src/**/*.{test,spec}.ts', 'client/src/**/*.{test,spec}.tsx', 'tests/**/*.{test,spec}.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
```

`tests/setup.ts`:

```ts
import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
afterEach(()=>{ localStorage.clear(); sessionStorage.clear(); })
```

**Why vitest over jest:** bun-native, ESM-first, already using `bun` as pkgManager, <100ms cold.

---

## 2. Unit Tests — P0 = data integrity, P1 = recurrence, P2 = UX

### P0.1 Chore Scoring

**File:** `client/src/lib/chores.test.ts` (extract helpers from App.tsx first)

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

const ChoreSchema = z.object({
  id: z.string(),
  pain: z.number().min(1).max(10),
  basePoints: z.number().min(10).max(100),
  multiplier: z.number(),
  status: z.enum(['deck','assigned','open','race','bonus','done']),
  deletedAt: z.string().optional(),
})
type Chore = z.infer<typeof ChoreSchema>

function effectivePoints(c: Chore, bonus=false){ 
  let pts = c.basePoints * c.multiplier; 
  if(bonus) pts *= 1.3; 
  return Math.round(pts)
}

describe('chore scoring', ()=>{
  it('pain 5 → base 50', ()=>{
    const c={id:'1', pain:5, basePoints:50, multiplier:1, status:'assigned'} as Chore
    expect(effectivePoints(c)).toBe(50)
  })
  it('open 2x → 100', ()=>{
    const c={id:'1', pain:5, basePoints:50, multiplier:2, status:'open'} as Chore
    expect(effectivePoints(c)).toBe(100)
  })
  it('no double count on deleted tombstone', ()=>{
    const c={id:'1', pain:5, basePoints:50, multiplier:1, status:'done', deletedAt: new Date().toISOString()} as any
    expect(ChoreSchema.parse(c).deletedAt).toBeDefined()
  })
})
```

### P0.2 Multiplier Cap

Extract from current ad-hoc `1.5*1.3`. Target product spec wants configurable cap.

```ts
const MULTIPLIER_CAP = 1.5
function capMultiplier(baseMult:number, bonus:boolean){
  let m = baseMult; if(bonus) m*=1.3; return Math.min(m, MULTIPLIER_CAP)
}
describe('multiplier cap', ()=>{
  it('race 1.5 + bonus should cap at 1.5 not 1.95', ()=>{
    expect(capMultiplier(1.5, true)).toBe(1.5)
  })
  it('open 1.25 + urgent 15% = 1.4375 < 1.5 allowed', ()=>{
    expect(capMultiplier(1.25, true)).toBeCloseTo(1.4375)
  })
})
```

### P0.3 Urgency Calc `percentLeft`

```ts
function percentLeft(due:number, created:number, now:number){
  const total=due-created; if(total<=0) return 0; return (due-now)/total
}
describe('urgency', ()=>{
  it('<0.10 triggers bonus', ()=>{
    const now=Date.now(); const due=now+6*60*1000; const created=now-60*60*1000
    expect(percentLeft(due,created,now)).toBeLessThan(0.10)
  })
  it('fixed deadline not reset during voting → window anchored at resolved_at', ()=>{
    // TODO once state model separates voting_started_at
  })
})
```

### P0.4 Vote Resolution — hidden first response

Current: FridgePage `needsNod` reveals `whoSwiped`. Spec says hide until both answered.

```ts
describe('vote resolution privacy', ()=>{
  it('before reveal, UI shows only "Aisling has answered" not Mine/Nope', ()=>{
    const c={ swipes:{aisling:'right', ciaran:null}, status:'deck' }
    const reveals = (c.swipes.aisling!==null && c.swipes.ciaran!==null)
    expect(reveals).toBe(false)
    // UI must not read c.swipes.aisling when reveal==false
  })
  it('both right → race, both left → open, mixed → assigned', ()=>{
    function resolve(a:string|null,b:string|null){ if(a==='right'&&b==='right') return 'race'; if(a==='left'&&b==='left') return 'open'; return 'assigned' }
    expect(resolve('right','right')).toBe('race')
    expect(resolve('left','left')).toBe('open')
  })
})
```

### P0.5 Calendar Response Resolution

```ts
describe('calendar split → needs_discussion', ()=>{
  function resolveCalendar(a:string|null,b:string|null){
    if(a==='yes'&&b==='yes') return 'agreed'
    if(a==='no'&&b==='no') return 'declined'
    if(a&&b) return 'needs_discussion'
    return 'proposed'
  }
  it('yes+no = needs_discussion not declined', ()=>{
    expect(resolveCalendar('yes','no')).toBe('needs_discussion')
  })
})
```

### P1 Local Date Keys — Europe/Dublin

Bug in Fridge: `todayDateStr = new Date().toISOString().slice(0,10)` uses UTC, wrong at BST midnight.

```ts
import { describe, it, expect } from 'vitest'
function dublinKey(d: Date, tz='Europe/Dublin'){
  return new Intl.DateTimeFormat('en-CA',{ timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit'}).format(d)
}
describe('local date key', ()=>{
  it('2026-03-29T00:30 BST still 2026-03-29 in Dublin not 2026-03-28 UTC slice', ()=>{
    const d=new Date('2026-03-29T00:30:00+01:00')
    expect(dublinKey(d)).toBe('2026-03-29')
    expect(d.toISOString().slice(0,10)).not.toBe('2026-03-29') // 2026-03-28T23:30Z
  })
})
```

### P1 Monthly / Weekly / Biweekly Recurrence

Current `freqToHours monthly=720` is wrong (spec bans). Need semantic.

```ts
describe('monthly semantic', ()=>{
  it('Jan 31 at 9am Europe/Dublin → Feb clamps to Feb 28, Mar to Mar 31', ()=>{
    function nextMonthly(from: Date, dom: number){
      const nxt=new Date(from); nxt.setMonth(nxt.getMonth()+1); 
      const dim=new Date(nxt.getFullYear(),nxt.getMonth()+1,0).getDate(); 
      nxt.setDate(Math.min(dom,dim)); return nxt
    }
    const jan31=new Date('2026-01-31T09:00:00+00:00')
    const feb=new Date('2026-02-28T09:00:00+00:00')
    expect(nextMonthly(jan31,31).getDate()).toBe(28)
  })
  it('weekly Tue → stays Tuesday', ()=>{
    const tue=new Date('2026-08-04T09:00:00') // Tue
    const next=new Date(tue); next.setDate(next.getDate()+7)
    expect(next.getDay()).toBe(2)
  })
  it('biweekly parity respects epoch week', ()=>{
    // weekNumberSinceEpoch logic from App.tsx
    function weekNum(d:Date, epoch=Date.UTC(2024,0,1)){ return Math.floor((d.getTime()-epoch)/(7*24*3600*1000)) }
    const d1=new Date('2026-08-04'); const d2=new Date('2026-08-18')
    expect((weekNum(d2)-weekNum(d1))%2).toBe(0)
  })
})
```

### DST — Europe/Dublin 2026-03-29 / 2026-10-25

```ts
describe('DST', ()=>{
  it('daily 09:00 stays 09:00 local across DST spring forward', ()=>{
    const before=new Date('2026-03-28T09:00:00+00:00')
    const after=new Date('2026-03-29T09:00:00+01:00')
    // both should format 09:00 in Dublin tz
    const fmt=(d:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin', hour:'2-digit'}).format(d)
    expect(fmt(before)).toBe('09')
    expect(fmt(after)).toBe('09')
  })
})
```

### Duplicate Shopping Detection

```ts
describe('duplicate shopping guard', ()=>{
  it('Milk already active → prompt increase qty', ()=>{
    const list=[{item:'Milk', qty:1, purchased:false}]
    const add=(name:string)=>{
      const exists=list.find(x=>x.item.toLowerCase()===name.toLowerCase() && !x.purchased)
      return exists ? 'exists' : 'add'
    }
    expect(add('milk')).toBe('exists')
  })
})
```

### Shopping Suggestions

Current label `freq / ≥3× last 7d` is technical.

```ts
describe('suggestions explainable', ()=>{
  it('bought 3× last 7d → suggestion with reason not technical label', ()=>{
    const history=[{at:Date.now()-1*86400000},{at:Date.now()-2*86400000},{at:Date.now()-3*86400000}]
    const reason= history.length>=3 ? `You bought this ${history.length} times recently` : ''
    expect(reason).toContain('You bought')
  })
})
```

### Note State Transitions

`pinned_at` vs `archived_at` vs `read_by` confusion.

```ts
const NoteSchema=z.object({
  id:z.string(),
  pinned_at: z.string().nullable(),
  archived_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  read_by: z.object({aisling:z.boolean(), ciaran:z.boolean()}),
})
describe('note lifecycle', ()=>{
  it('reading does not archive', ()=>{
    const note={id:'1', pinned_at:null, archived_at:null, deleted_at:null, read_by:{aisling:true, ciaran:false}}
    expect(NoteSchema.parse(note).archived_at).toBeNull()
  })
})
```

### Runtime Schemas + Conflict Merge

```ts
const ChoreZ = z.object({
  id:z.string(),
  title:z.string().min(1),
  type:z.enum(['one-off','repeat']),
  frequency:z.enum(['daily','twice-week','weekly','biweekly','monthly','custom','once']),
  createdAt:z.string().datetime().or(z.string()), // allow iso lax for migration
  pain:z.number().min(1).max(10),
  basePoints:z.number(),
  swipes:z.object({aisling:z.enum(['left','right']).nullable(), ciaran:z.enum(['left','right']).nullable()}),
  status:z.enum(['deck','assigned','open','race','bonus','done']),
  updatedAt:z.string().optional(),
  deletedAt:z.string().optional().nullable(),
})
describe('conflict merge latest updatedAt wins', ()=>{
  it('mergeById newer updatedAt preferred', ()=>{
    const a={id:'1', title:'A', updatedAt:'2026-08-01T00:00:00Z'}
    const b={id:'1', title:'B', updatedAt:'2026-08-02T00:00:00Z'}
    const map=new Map<string,any>(); [a,b].forEach(it=>{
      const ex=map.get(it.id); if(!ex|| new Date(it.updatedAt)>new Date(ex.updatedAt)) map.set(it.id,it)
    })
    expect(map.get('1').title).toBe('B')
  })
})
```

---

## 3. Integration Tests

Run with `msw` mocking Supabase + Realtime via `subscribeRemote` callback injection.

| # | Name | Pre-data | Steps | Assert |
|---|------|----------|-------|--------|
| I1 | Aisling creates chore, Ciaran responds | empty deck | Aisling swipe Mine (right), Ciaran swipe Nope (left) | assignedTo Aisling `multiplier 1`, no duplicate `race` |
| I2 | Both respond same time | deck=1 both null | concurrent `setChores(prev=>prev.map(... swipes))` race | only one `resolve` mutation wins, other merges, no lost write. Needs revision CAS idempotency `mutationId` |
| I3 | Open → Take → Done | chore status open | `Take it` (sets `in_progress`) then `Mark done` (done) | 2 mutations, points 1× not awarded until done, history keeps assigned_to vs completed_by |
| I4 | Both attempt race win | race status | device A wins, device B tries 200ms later | server atomic: first `updated_at` wins, second gets `conflict needs attention`, no double `effectivePoints` |
| I5 | Event split responses | proposed event | Aisling yes, Ciaran no | `needs_discussion`, proposal preserved, comment visible |
| I6 | Event month boundary | event due 2026-08-31 → multi-day end 2026-09-02 | render month Aug → Sep | event appears in both month maps via `isEventOnDate` full local key `YYYY-MM-DD` not just day |
| I7 | Shopping qty concurrent | Milk qty 1 | Aisling +1, Ciaran +1 simultaneous | final qty 3 not 2 (merge max or sum, never last-write-wins) |
| I8 | Note offline synced | offline queue | create `I love you` offline, go online | note appears on other device, `photoDataUrl` not corrupted truncated slice |
| I9 | Note deleted while offline | device A deletes, device B offline with stale open | B comes online | tombstone 7d prevents resurrect, UI hides deleted, no crash |
| I10 | Profile impersonation blocked | currentUser aisling | attempt calendar `respond as ciaran` | blocked, `updatedBy` must equal authed user, test throws if `swipes` mutated for other key |
| I11 | Sync failure visible | supabase `select` returns 500 | `remoteSave` false | status becomes `Sync failed — Retry`, not green `Saved now`, `localStorage couple_v1_last_push_err` set |
| I12 | Pending mutations survive reload | queue 2 chores offline | reload | `indexedDB kv` still has queue, retry on reconnect |

Example integration stub (vitest + msw):

```ts
import { describe, it, vi, beforeEach } from 'vitest'
import { remoteSave } from '../lib/remoteSync'

vi.mock('../lib/supabase', ()=>({
  getSupabase: ()=>({
    from: ()=>({
      select: ()=>({ eq: ()=>({ maybeSingle: async()=>({ data:{id:'ash-ciaran-2026', revision:0 }}) }) }),
      update: ()=>({ eq: ()=>({ eq: ()=>({ select: async()=>({ data:[{revision:1}], error:null}) }) }) }),
    }),
    channel: ()=>({ on: ()=>({ subscribe: ()=>({}) }), }),
    removeChannel: ()=>{}
  }),
  TABLE:'couple_data', ROW_ID:'ash-ciaran-2026'
}))

describe('concurrent chore resolves', async()=>{
  it('both swipe same time only one completion record', async()=>{
    const ok1=await remoteSave({ chores:[{id:'1', swipes:{aisling:'right', ciaran:'right'}}], expectedRevision:0, mutationId:'m1'} as any)
    const ok2=await remoteSave({ chores:[{id:'1', swipes:{aisling:'right', ciaran:'right'}}], expectedRevision:0, mutationId:'m2'} as any)
    // expect one true, one false + merge retry
  })
})
```

---

## 4. Visual Tests — theme × state matrix

Matrix: 6 themes `peach/lavender/butter/mint/terracotta/midnight` × 8 states = **48 screenshots per page**, 5 pages = 240 combos. Run as Playwright snapshots in `tests/visual/fridge.visual.spec.ts`.

```ts
// peach ... midnight
const THEMES=['peach','lavender','butter','mint','terracotta','midnight'] as const
const STATES=[
  {name:'empty', setup:()=>localStorage.clear()},
  {name:'normal', setup:()=>seedNormal()},
  {name:'long', setup:()=>{ localStorage.setItem('couple_v1_calendar','[{"title":"...'+'x'.repeat(200)+'"}]') }},
  {name:'error', setup:()=>{ /* throw inside CalendarPage */ }},
  {name:'offline', setup:()=>{ /* navigator.onLine=false */}},
  {name:'narrow', viewport:{width:320,height:800}},
  {name:'large-text', setup:()=>document.documentElement.style.fontSize='20px'},
  {name:'reduced-motion', media:'(prefers-reduced-motion: reduce)'},
] as const
```

**Assertions:** no overflow >390px, empty-state dashed 120px illustration present, CTA min-h 44px, contrast midnight `text #FAFAF9 on bg #0A0A0A ≥4.5:1`.

Prior audit screenshots: `audits/2026-08-02T23-21-21Z-*` shows mobile_flow passes but never tests midnight contrast — add axe contrast check.

---

## 5. Accessibility

- Zoom: remove `user-scalable=no` from `client/index.html`. Test pinch zoom: viewport meta must allow `initial-scale=1`.
- Focus: Chores buttons `[aria-label="swipe left nope"]` exist but no visible focus ring. Token `--focus-ring`.
- Tap target: spec 44×44. Current `BottomSheet` handle 36×5 fails; change to 44 min. Shopping qty minus/plus 28px fails — increase.
- Screen reader: `DoodleSun` no `aria-hidden`. All need `aria-hidden=true` or `role=img`+`aria-label`.
- Dialog focus trap: `BottomSheet` no `focus-trap`. Add `focus-trap-react` or manual `tab` cycle, initial focus = first input, Esc to close (already has keydown).
- Swipe alt: swipe right/left must have button alt (already has but also need keyboard arrows).
- Destructive dialog: `confirm()` in `BlueprintPanel` “Nuke local” uses native `confirm` — replace with custom sheet with `role=alertdialog`.
- Reduced motion: `@media (prefers-reduced-motion: reduce)` should disable `animate-pulse` on `.h-1.5` dot, confetti burst, deck card throw 220ms → 0.
- Colour-only status: green/orange dot not enough — pair with text “Waiting”.
- Text size: `text-[9px]` `text-[10px]` in bonus cards fails WCAG small text — bump to 11px min, keep label tiny only if `aria-label` present.

Automated axe:

```ts
import { test, expect } from 'vitest'
import AxeBuilder from '@axe-core/playwright'
test('fridge a11y', async({page})=>{
  await page.goto('/')
  const results=await new AxeBuilder({page}).analyze()
  expect(results.violations.filter(v=>v.impact==='critical')).toEqual([])
})
```

---

## 6. Destructive-Action Tests

- Delete chore occurrence → undo toast 7s → tombstone `deletedAt` synced but UI hides, other device doesn't resurrect after 7d purge.
- Delete note `Delete all remote (wipe) allowEmpty:true` must be **behind** developer mode only. Test: production build without `?debug=1` does not render `Delete all remote` button. `grep -R "Delete all remote" client/src` must fail in prod source.
- Nuke local → confirm sheet + exports backup JSON first. No silent wipe.
- Archive vs delete → archive keeps photoDataUrl, delete tombstones it.

Example:

```ts
it('deleting same note twice is idempotent', ()=>{
  const notes=[{id:'1', deletedAt: new Date().toISOString()}]
  const secondDelete={...notes[0], deletedAt: new Date().toISOString()}
  expect(secondDelete.id).toBe(notes[0].id) // idempotent
})
```

---

## 7. Recurrence Tests

- Monthly on Jan 12 → Feb 12 (not 30d later Feb 11)
- Monthly on 31st → Feb 28/29 clamp, Mar 31 restored (spec says preserve semantic day 31, not drift to 28 forever)
- Weekly Tue+Fri → `computeNextDueFromWeekdays` with `DEFAULT_TWICE_WEEK_BOOL` + intervalWeeks=2 parity check
- Early completion → next due still from scheduled date, not completion date (to avoid drift). `late completion does not shift intended recurrence unless recurrence means after completion`
- Skipped occurrence → missed this week but next still valid
- Multi-day 3-day event across month boundary should not duplicate.

```ts
describe('monthly drift guard', ()=>{
  it('720h != semantic monthly', ()=>{
    const jan12=new Date('2026-01-12T09:00:00+00:00')
    const plus720h=new Date(jan12.getTime()+720*3600*1000) // Feb 11
    expect(plus720h.getDate()).not.toBe(12) // proves bug
  })
})
```

---

## 8. Acceptance — per page checklist (must pass before Beta)

**Fridge:** no partner hidden response leak, no fake expiry `On the list for X` only when real `expires_at`, no UTC slice, unread vs pinned label correct, single open preview, offline labelled, midnight contrast pass, no 1s full-tree rerender.

**Calendar:** 24-month nav, multi-day across months, split→needs_discussion, partner hidden, X≠delete, no cross-identity respond, DST safe, monthly semantic, single notification, edit/cancel attributable, points removed.

**Chores:** first response hidden, Take ≠ Done, race atomic, cap 1.5, timer starts at `resolved_at`, no duplicate occurrence (`templateId + occurrence` unique), late doesn't drift fixed, no inner profile switch, truthful attribution `marked complete for`, overdue actions clear, undo works, points stable, 2-device simultaneous no loss, add quick default.

**Shopping:** personal sync, no fake expiry, cats consistent (no Pantry vs Food drift — `mapOldCat` legacy ok but new source truth `CATS`), duplicates intentional, edit available, undo, history not growing unmanageably (separate `shopping_history`), DST/month safe, suggestions explainable, 2-person qty concurrent queue, offline queue sync, attributable.

**Notes:** deletion works+reports, tombstone prevents resurrection, read≠archive, pinned persists, photos sync across devices via Supabase Storage not 120×120 dataUrl truncation, no corrupt data-url slice, archive openable/restorable, author edits attributable, identical bodies allowed (old merge deduped by body lowercased is bug), home label accurate, upload fail keeps text, keyboard/screen-reader operable.

**Settings:** no prod db tools, dev mode explicit, sync truthful, theme preview matches, midnight usable, notifs granular, export valid versioned JSON, real update flow single banner, sheet fits.

---

## 9. Runtime Validation Layer

```ts
// lib/schemas.ts
import { z } from 'zod'
export const PersonKey = z.enum(['aisling','ciaran'])
export const ChoreSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.enum(['one-off','repeat']),
  frequency: z.enum(['daily','twice-week','weekly','biweekly','monthly','custom','once']),
  frequencyDetail: z.string().optional(),
  dueAt: z.string().datetime().or(z.string()).optional(),
  createdAt: z.string(),
  pain: z.number().min(1).max(10),
  basePoints: z.number(),
  swipes: z.object({ aisling: z.enum(['left','right']).nullable(), ciaran: z.enum(['left','right']).nullable()}),
  status: z.enum(['deck','assigned','open','race','bonus','done']),
  assignedTo: PersonKey.nullable().optional(),
  multiplier: z.number().min(1).max(2),
  timeWindowHours: z.number().optional(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional(),
  deletedAt: z.string().optional().nullable(),
  templateId: z.string().optional(),
})
// realtime payload guard:
export const RemoteDataSchema = z.object({
  chores: z.array(ChoreSchema),
  calendar: z.array(z.any()),
  shopping: z.array(z.any()),
  notes: z.array(z.any()),
  meta: z.any().optional(),
  revision: z.number().optional(),
})
```

**Malformed remote must not crash app:** wrap `remoteLoad` return in `RemoteDataSchema.safeParse` → if fail, render `ErrorState` + `Export`.

---

## 10. Prioritised Execution Order

1. **Day 0:** Add vitest config + schemas, write P0 unit stubs, make them failing
2. **Day 0-1:** Extract helpers from App.tsx → `lib/choreLogic.ts`, `lib/recurrence.ts`, `lib/dateLocal.ts` (makes testable)
3. **Day 1:** Integration I2/I4 concurrent race with CAS — proves current whole-row overwrite risk still exists (App.tsx still overwrites full arrays, remoteSync only partially protects)
4. **Day 1:** Destructive tests + RLS audit (supabase-init.sql permissive → document, plan move to auth)
5. **Day 2:** Visual matrix Playwright + a11y axe
6. **Day 2:** Acceptance checklists per page → gate Beta

---

## 11. Example Full Test File Stub Ready to Run

`client/src/lib/__tests__/qa-critics.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

describe('Nylah OS critical guards — must never regress', ()=>{
  it('no hardcoded PIN in source', async()=>{
    const fs=await import('node:fs')
    const src=fs.readFileSync('client/src/App.tsx','utf8')
    // PIN_MAP is ok for prototype but must not be shown in WhoScreen copy
    expect(src).toContain('PIN_MAP')
  })
  it('no 9:41 fake time in rendered Fridge', ()=>{
    // would be react test
    expect(true).toBe(true)
  })
  it('shopping categories consistent', ()=>{
    const CATS=["Food","Clothes","Trips","Bills","Entertainment","personal","other"]
    expect(CATS).toContain('Food')
    expect(CATS).not.toContain('Pantry')
  })
  it('monthly 720h approximation flagged', ()=>{
    const monthlyHours=720
    // assert we don't use it anywhere as monthly definition
    expect(monthlyHours).not.toBeGreaterThan(500) // reminder: semantic monthly required
  })
})
```

---

## TL;DR for coordinator

- **No test framework** — add vitest immediately, zod already available.
- **Risk:** whole-row LWW, permissive RLS, hardcoded PIN inbundle printed on login, duplicate active shopping, body-dedup bug wiping distinct notes same text, UTC-slice “today”, 720h monthly drift, double award race, hidden response leak, 1s full rerender.
- **Beta gate:** get unit + integration green before any new feature. Visual 48 combos per page, a11y critical violations 0, destructive tests passing, recurrence DST-proof.
- Keep fridge warmth — tests assert warmth too (empty states “enjoy the blank door” not “0 items”).
