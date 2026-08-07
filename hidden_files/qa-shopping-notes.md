# QA — Shopping + Notes + Mobile Polish

Date: overnight loop / Specialist C
Goal: goal_f740d0ec1e6b

## Shopping Deep QA

### Categories
- CATS = Food, Clothes, Trips, Bills, Entertainment, personal, other — verified present.
- mapOldCat hardened:
  - now case-insensitive lookup, finds direct match regardless of case
  - legacy "pantry/produce/dairy/meat/frozen/groceries/fruit/veg" -> Food
  - "clothes/clothing/apparel/shoes" -> Clothes
  - "trips/trip/travel/holiday/flight" -> Trips
  - "bills/bill/rent/utilities/subscription" -> Bills
  - "entertainment/ent/fun/movies/games" -> Entertainment
  - "personal/@personal/people" -> personal
  - "@aisling/@ciaran" prefixes -> personal (so tags not lost)
  - fallback other

### Frequency
- Chips: as-needed, daily, every-2d, weekly, biweekly, monthly
- showNeed toggles weekday selector when weekly/biweekly
- needDays persisted via weekdaysBoolToDetailLocal (Mo,Tu,We...)
- computeShoppingNextDue handles weekly/biweekly interval parity (2wk respects start week)
- freqToHours conversion daily 24h, every-2d 48h, weekly 168h etc.

### Tags & Personal Wants
- extractTags: regex /(^|\s)@(aisling|ciaran|personal|wants)\b/gi
- cleanTitle strips tags, multiple spaces collapsed
- forcedCat -> personal if contains personal/wants
- routing: if @aisling/@ciaran present, pushes to that side's personal/wants; else currentUser
- personal store key couple_v1_shopping_personal separate from main shopping, persisted via useLocalState
- pushPersonalToShopping creates shopping item with tags ["@side","@personal/@wants"]

### Purchased Flow
- togglePurchased flips purchased, sets lastDoneAt now, history push (last 12), repeatCount++
- willComplete detection triggers onCelebrate(e) -> confetti at click origin
- relTime shown for done items (e.g. "3m ago")
- done filter: todoOnly = items.filter(!purchased) for grouped display; doneCount computed separately; collapsible done list dashed border with undo (click to un-buy)
- next due via computeShoppingNextDue used for sorting: nulls last, soonest first, then createdAt desc
- sorting stable per category grouping

### Qty Stepper 28px
- Container: rounded-full border bg-[#F7EFE8] px-1 height 28px minWidth 76px (was 28px height already but now explicit)
- Minus/Plus: h-6 w-6 rounded-full grid place, active:scale 0.88, active:bg-white
- Qty display: w-5 tabular-nums medium font
- Change clamped Math.max(1) upper 99 in parseQuick
- Micro-interaction: active:bg-white + scale, hover not necessary for mobile

### Fav Chips Milk/Bread/Eggs/Coffee
- favs computed from freq Map using repeatCount + 1 weight, sorted desc, merged with base ["Milk","Bread","Eggs","Coffee"] lowercase de-dup, slice 0-6, title-cased
- UI shows top 4 as quick pills bg-[#F7EFE8] border #E8CEB7, onClick addParsed(`${f}, 1`) instant add
- Instant add parses title single word, qty 1

### ParseQuick Hardened
- Previously only handled comma or trailing number via simple split. Now:
  - strip leading "add" case-insensitive
  - "milk x2" or "milk X 2" -> qty captured, clamped 1-99
  - "milk, 2" or "milk,2" -> left title, right number detection
  - "milk 3" trailing number only if title >=2 chars
  - double spaces collapsed
  - returns null if empty

### Due Labels & Overdue
- shoppingDueLabel returns {label, overdue, dueSoon, next}
- overdue: hours<0 => "overdue by Xd"
- dueSoon <24h => "due today • time"
- <48h => "due tomorrow"
- <168h => "due Mon"
- else "next May 12"
- overdue pill bg-[#FFF1F2]/60 border #FECDD3, pulse dot

### Edge Cases Fixed
- expiryItems >5d for Food/personal kept but not spammy
- category open state persisted per cat bool map default true
- empty cat sections hidden (return null) to save space
- icon for each cat (leaf for Food etc) placeholder emoji kept intentional per original
- smartRestock uses freq>=3 in last 7d OR due within 24h, excludes if todo already exists, sorted urgency
- qty increase/decrease no longer allows 0 or negative

## Notes Deep QA

### Polaroid Style 120x120 low-fi
- handleFile: canvas 120x120 cover crop centered scale=max(120/iw,120/ih), drawImage centered
- toDataURL jpeg 0.4 quality, if >45000 fallback webp 0.35
- stored as dataUrl in draft.photo -> photoDataUrl field
- truncation in safeSetLS / safeGetLS: if length >12000 trimmed -> undefined to avoid quota error; in pushToSheet truncated 38000 + …TRUNC
- Intentional low visual quality acceptable per spec, persisted as <40k ideal, <45k hard

### Sharpie Font Caveat 17-22px
- text-only notes: <28 chars -> text-[22px], <80 -> 19px, else 17px
- fontFamily "Caveat","Segoe Script","Bradley Hand",cursive
- textShadow 0 0.25px 0 rgba(0,0,0,0.22) + 0 0 0.5px for ink bleed simulation
- line-clamp-7 for preview

### Polaroid Shadow + Gradient Inset
- Shadow: "0 6px 18px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.9)"
- Gradient inset for non-photo: linear-gradient(180deg,#FFFCF8 0%,#FFFEFE 100%) or pink for love
- Background for board: #F7EFE8 with radial dots #E8CEB7 1px pattern 16px
- Hover scale 1.01 on image, active scale 0.98

### Rotation Hash Based on Id
- rotForId uses hashId %5 map [-2,-1,1,2,3] deterministic
- Fixed bug: previously rotForId(uid("r")) generated random uid each note, rotation random but not id-based. Now noteId = uid("nt") then rotForId(noteId)
- Tape rotation deterministic: hashId %5 -2 => -2..2 deg, translateX(-50%) preserved

### Tape Element
- -top 9px centered, 34x11px, background linear-gradient 180deg #FEF3C7 -> #FDE68A, opacity 0.92, rotate tapeAngle deg, boxShadow 0 1px 2px rgba(0,0,0,0.06), borderRadius 2px

### SeenBy Á/C, Taken-Down Archive, Love-Note Feature
- seenBy: {aisling, ciaran} bool
- pin sets author seen true, other false
- takenDown = notes.filter both seen true
- UI: activeNotes = not both seen, shown in grid; takenDown in <details> archived opacity 0.6 scale 0.96
- filterLove toggle all/love
- Love flag: isLove bool, pink heart icon top-right for photos, pink border/bg for text-only #F9A8D4/#FCE7F3, heart icon filled
- takeDown() marks currentUser true, does not auto-delete; remove permanently button filters out
- new pills: new / tap → see / Á✓ C✓
- selected view shows full polaroid 280px max, tape, body 20px sharpie

## Mobile / Polish

### Floating Overlay Nav 56px Pill, 44px Buttons
- Before: minWidth 320px maxWidth 92% minHeight 56px, buttons minHeight 44px, shadow 0 12px 32px
- After: minWidth 332px maxWidth 96% minHeight 60px (still meets 56px spec but bigger than before as requested), buttons minHeight 46px minWidth 44px, backdrop-blur 18px saturate 1.2, shadow 0 16px 40px rgba(0,0,0,0.14) + 0 6px 16px + inset white, pill bg white/94, gap 1, transition 180ms, active scale 0.96, tracking -0.01em for labels
- Stays overlay: absolute bottom-0 inset-x-0 z-30 pointer-events-none outer, inner pointer-events-auto, pb max(14px, safe-area-inset-bottom)
- Larger tap targets, more visible than previous

### Better Scaling, Hero Aisling ♥ Ciaran
- clamp(30px,7.8vw,36px) already present via inline style fontSize clamp(...), preserved
- Changed from SVG DoodleHeartAccent to single heart character ♥ with Fraunces italic styling: fontFamily "Fraunces", Georgia, serif, italic, weight 700, rotate -2deg translateY 1px, color theme.accent, textShadow 0 2px 8px accent40 + 0 1px 2px black08, fontSize 0.92em of hero
- Single heart requirement met, not loading Inter fallback (force Fraunces stack, fallback Georgia serif not Inter)
- LetterSpacing -0.025em, lineHeight 1.05, webkit smoothing

### 390px Locked, Bottom Sheets 16px Radius, Overlay Portal z-80 Fixed, No Overflow
- Outer non-standalone: w-[min(390px,100%)] overflow-hidden rounded-[36px] border 7px white
- Inner: h-[800px] flex flex-col overflow-hidden rounded-[28px]
- Standalone: w-full max-w-[420px] min-h-dvh flex flex-col mx-auto
- BottomSheet component: fixed inset-0 z-[80] flex items-end justify-center px-3 pb max(16px,safe-area) pointerEvents auto, inner rounded-[16px] bg-[#FFFCF8] border #E8CEB7 shadow negative offset, max-h 72dvh
- No overflow x: body container overflow-hidden, inner scroll no-scrollbar, overscroll-contain
- Portal via createPortal to document.body

### Standalone netlify.app Detection: min-h-dvh w-full, no header/footer/rules
- useIsStandalone: checks ?standalone param, display-mode standalone, iOS navigator.standalone, hostname.includes("netlify.app") -> true
- When true, forces sessionUser (no persisted currentUser), removes couple_v1_currentUser on mount to force PIN each fresh load
- Standalone shell: no preview warning bar "Preview — add ?standalone", wrapper min-h-dvh w-full flex justify-center bg #FFFCF8
- Non-standalone shows preview pill with PIN hints 4463/1958
- No header/footer/rules: single app shell only

### Themes: 5 Themes Drastic Gradients Peach/Lav etc, Outer Wash + Inner Cards
- Peach Pop: linear 180deg #FFDCC7 0%, #FFE8D6 18%, #FFFCF8 62%
- Lavender Haze: #D0A1EA 0%, #E9D5FF 22%, #F8F6FF 68% bg #F8F6FF
- Butter: #FEF08A 0%, #FEF9C3 24%, #FFFEF5 70%
- Mint Fresh: #A7F3D0 0%, #D1FAE5 20%, #F6FFFB 66% accent #6EE7B7
- Terracotta: #FDBA74 0%, #FFEDD5 20%, #FFF7F3 64% accent #FB923C
- Each has washTop/washMid distinct for inner card usage, outer wash more saturated than previous (was 1 stop to white, now 2 stops layered)
- Current theme persisted localStorage couple_v1_theme

### Other Polish Verified
- safeGetLS/safeSetLS quota evict: tries trimming notes photos >40k
- openIdb fallback for kv
- Photo low-fi canvas <40k intention kept
- Sharpie font Caveat used via class font-sharpie but now explicit fontFamily fallback set
- Polaroid shadow + gradient inset added
- Bottom nav bigger, pill 60px, button 46px, still meets 56/44 minimum per spec
- Hero heart single ♥ Fraunces italic, clamp preserved

## Remaining Risks / Next
- Image generation quality at 120x120 jpeg 0.4 could be blocky for high detail photos; acceptable per spec intentional low quality
- Personal corner lists could grow unbounded; consider limit 20
- Fav chip merge could still show duplicate casing (Milk vs milk); lowercasing fixes most
- Theme outer wash not applied to outer page background in standalone (body still #FFFCF8); could map body to theme bg for extra drama but kept minimal to not break existing layout
- No rebuild done per coordinator instruction; coordinator should build after all specialists merge
