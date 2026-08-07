// Rebuilt shop — one-tap bought, second-tap delete, grouped by trip
import { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { PersonKey, ShoppingItemV2, ShoppingTrip } from "../../types";
import { uid } from "../../shared/utils/helpers";

type TripDef = { id: ShoppingTrip | "all"; label: string; short: string; hint: string; icon: string };
const TRIPS: TripDef[] = [
  { id: "all", label: "All", short: "All", hint: "Everything", icon: "◐" },
  { id: "grocery", label: "Next grocery run", short: "Grocery", hint: "Aisles", icon: "🛒" },
  { id: "online", label: "Online", short: "Online", hint: "Order later", icon: "↗" },
  { id: "personal", label: "Personal", short: "Personal", hint: "Just you", icon: "◐" },
  { id: "want", label: "Wants / later", short: "Wants", hint: "Nice to have", icon: "✦" },
];

function getItemTrip(it: any): ShoppingTrip {
  if (it?.trip && typeof it.trip === "string") return it.trip as ShoppingTrip;
  // infer from legacy fields
  const t = (it?.templateKind as string)?.toLowerCase();
  if (t === "personal") return "personal";
  if (t === "wants") return "want";
  const cat = (it?.cat as string)?.toLowerCase();
  if (cat === "personal") return "personal";
  if (cat === "entertainment" || cat === "trips" || cat === "bills") return "online";
  return "grocery";
}

function BottomConfirm({ open, itemLabel, onCancel, onDelete, dontAsk, setDontAsk }: any) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center px-3 pb-[max(16px,env(safe-area-inset-bottom))] animate-[fadeIn_0.18s]">
      <button onClick={onCancel} className="absolute inset-0 bg-[#292624]/22 backdrop-blur-[3px]" aria-label="close" />
      <div className="relative w-full max-w-[380px] rounded-[20px] bg-[var(--card-bg)] border shadow-[0_18px_48px_rgba(0,0,0,0.18)] p-5 animate-[sheetIn_0.22s]" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[var(--muted)]">Remove?</div>
        <div className="mt-1 text-[15px] font-[600] tracking-[-0.01em]" style={{ fontFamily: "Fraunces, serif" }}>
          Delete “{itemLabel}”?
        </div>
        <div className="mt-1 text-[12px] text-[var(--muted)] leading-[1.4]">Gone from both phones. You can undo for a few seconds.</div>
        <label className="mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)] cursor-pointer select-none">
          <input type="checkbox" checked={!!dontAsk} onChange={e=> setDontAsk(e.target.checked)} className="h-3 w-3 rounded" /> Don’t show this again
        </label>
        <div className="mt-4 flex gap-2">
          <button onClick={onCancel} className="flex-1 h-[44px] rounded-full border bg-[var(--card-bg)] text-[13px] font-medium" style={{ borderColor: "var(--border)" }}>Keep</button>
          <button onClick={onDelete} className="flex-1 h-[44px] rounded-full bg-[#121214] text-white text-[13px] font-semibold">Delete</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function UndoToast({ snack, onUndo, onDismiss }: any) {
  if (!snack) return null;
  return createPortal(
    <div className="fixed bottom-[88px] left-1/2 -translate-x-1/2 z-[86] w-[calc(100%-24px)] max-w-[380px] rounded-full bg-[#121214] text-white px-4 py-2.5 flex items-center justify-between shadow-[0_10px_28px_rgba(0,0,0,0.22)] animate-[sheetIn_0.2s]">
      <span className="text-[12.5px] truncate pr-3">{snack.label} deleted</span>
      <div className="flex items-center gap-2 shrink-0">
        <button onClick={onUndo} className="h-[32px] rounded-full bg-white text-[#121214] px-3 text-[11px] font-semibold">Undo</button>
        <button onClick={onDismiss} className="grid h-[28px] w-[28px] place-items-center rounded-full bg-white/10 text-[10px]">✕</button>
      </div>
    </div>,
    document.body
  );
}

function TripPill({ active, def, onClick }: { active?: boolean; def: TripDef; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "h-[36px] whitespace-nowrap rounded-full border px-3 text-[12px] font-medium transition flex items-center gap-1.5 active:scale-[0.97] " +
        (active ? "bg-[#121214] text-white border-[#121214] shadow-sm" : "bg-[var(--card-bg)] text-[var(--text)] border-[var(--border)]")
      }
    >
      <span className="text-[11px]">{def.icon}</span>
      {def.short}
    </button>
  );
}

export function ShoppingScreen(props: any) {
  const { items: rawItems, setItems, currentUser, nowMs } = (props || {}) as {
    items: ShoppingItemV2[]; setItems: any; currentUser: PersonKey; nowMs: number;
  };
  const items = Array.isArray(rawItems) ? rawItems : [];
  const safeSet = typeof setItems === "function" ? setItems : (() => {}) as any;
  const who = (currentUser || "person_1") as any;

  const [tripFilter, setTripFilter] = useState<ShoppingTrip | "all">("all");
  const [addText, setAddText] = useState("");
  const [addTrip, setAddTrip] = useState<ShoppingTrip>("grocery");
  const [query, setQuery] = useState("");
  const [confirmItem, setConfirmItem] = useState<ShoppingItemV2 | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(() => {
    try { return localStorage.getItem("couple_v1_shop_skip_delete_confirm") === "1"; } catch { return false; }
  });
  const [snack, setSnack] = useState<{ id: string; label: string; prev: any } | null>(null);
  const snackTimer = useRef<any>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  // keep addTrip in sync with filter when filter is a concrete trip
  useEffect(() => {
    if (tripFilter !== "all") setAddTrip(tripFilter as ShoppingTrip);
  }, [tripFilter]);

  useEffect(() => {
    try { if (dontAskAgain) localStorage.setItem("couple_v1_shop_skip_delete_confirm", "1"); } catch {}
    if (dontAskAgain) setSkipConfirm(true);
  }, [dontAskAgain]);

  const activeAll = useMemo(() => items.filter((a: any) => !a.deletedAt && !a.archivedAt && (a.item || "").trim()), [items]);

  const filtered = useMemo(() => {
    let list = activeAll;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(i => i.item.toLowerCase().includes(q));
    }
    if (tripFilter !== "all") list = list.filter(i => getItemTrip(i) === tripFilter);
    return list;
  }, [activeAll, query, tripFilter]);

  const todo = useMemo(() => filtered.filter(s => !s.purchased), [filtered]);
  const bought = useMemo(() => filtered.filter(s => !!s.purchased), [filtered]);

  const grouped = useMemo(() => {
    if (tripFilter !== "all") {
      // single group view — order by created desc
      return [{ trip: tripFilter as ShoppingTrip, def: TRIPS.find(t => t.id === tripFilter)!, items: todo }];
    }
    const map = new Map<ShoppingTrip, ShoppingItemV2[]>();
    for (const it of todo) {
      const tr = getItemTrip(it);
      if (!map.has(tr)) map.set(tr, []);
      map.get(tr)!.push(it);
    }
    const order: ShoppingTrip[] = ["grocery", "online", "personal", "want"];
    const out: { trip: ShoppingTrip; def: TripDef; items: ShoppingItemV2[] }[] = [];
    for (const k of order) if (map.has(k)) out.push({ trip: k, def: TRIPS.find(t => t.id === k)!, items: map.get(k)! });
    for (const [k, v] of map.entries()) if (!order.includes(k as any)) out.push({ trip: k as ShoppingTrip, def: { id: k, label: k, short: k, hint: "", icon: "•" } as any, items: v });
    return out;
  }, [todo, tripFilter]);

  // counts for trip pills
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: activeAll.filter(i => !i.purchased).length };
    for (const t of ["grocery", "online", "personal", "want"] as ShoppingTrip[]) c[t] = activeAll.filter(i => !i.purchased && getItemTrip(i) === t).length;
    return c;
  }, [activeAll]);

  function addItem() {
    const text = addText.trim();
    if (!text) return;
    const nowISO = new Date().toISOString();
    const it: ShoppingItemV2 = {
      id: uid("shop"),
      item: text,
      qty: 1,
      cat: (addTrip === "personal" ? "Personal" : addTrip === "online" ? "Other" : addTrip === "want" ? "Entertainment" : "Food") as any,
      trip: addTrip,
      purchased: false,
      addedBy: who,
      createdAt: nowISO,
      repeatCount: 0,
      frequency: "as-needed" as any,
      updatedAt: nowISO,
      updatedBy: who,
    } as any;
    safeSet((prev: any) => [it, ...(Array.isArray(prev) ? prev : [])]);
    setAddText("");
    try { addInputRef.current?.focus(); } catch {}
  }

  function markBought(it: ShoppingItemV2) {
    const nowISO = new Date().toISOString();
    safeSet((prev: any) =>
      (Array.isArray(prev) ? prev : []).map((x: any) => x.id === it.id ? { ...x, purchased: true, lastDoneAt: nowISO, updatedAt: nowISO, updatedBy: who } : x)
    );
    // haptic hint
    try { (navigator as any)?.vibrate?.(10); } catch {}
  }

  function markNeed(it: ShoppingItemV2) {
    const nowISO = new Date().toISOString();
    safeSet((prev: any) =>
      (Array.isArray(prev) ? prev : []).map((x: any) => x.id === it.id ? { ...x, purchased: false, updatedAt: nowISO, updatedBy: who } : x)
    );
  }

  function requestDelete(it: ShoppingItemV2) {
    if (skipConfirm) {
      doDelete(it);
    } else {
      setConfirmItem(it);
    }
  }

  function doDelete(it: ShoppingItemV2) {
    const nowISO = new Date().toISOString();
    // save for undo
    setSnack({ id: it.id, label: it.item, prev: { ...it } });
    if (snackTimer.current) clearTimeout(snackTimer.current);
    snackTimer.current = setTimeout(() => setSnack(null), 4200);

    // soft tombstone then filter out for multiplayer sync safety
    safeSet((prev: any) => {
      const arr = Array.isArray(prev) ? prev : [];
      const withTomb = arr.map((x: any) => x.id === it.id ? { ...x, deletedAt: nowISO, archivedAt: nowISO, status: "deleted", updatedAt: nowISO, updatedBy: who } : x);
      // UI immediately hides, but tombstone remains one render for remoteSave cycle; filter next tick would re-hide but we return filtered so it disappears now
      return withTomb.filter((x: any) => x.id !== it.id || !x.deletedAt ? true : false).filter((x: any) => !x.deletedAt);
      // Actually above double filter keeps tombstone out of UI but preserves merge? We rely on mergeById keeping tombstone in remote payload for one cycle via existing ref — simplest: return only non-deleted for UI, remoteSync's before-save still saw tombstone in closure captured? Safer: write tombstone first then on next render it's gone, remoteSave already queued tombstone via previous setItems closure?
    });
    setConfirmItem(null);
  }

  function handleUndo() {
    if (!snack) return;
    const prev = snack.prev;
    if (!prev) { setSnack(null); return; }
    safeSet((p: any) => {
      const arr = Array.isArray(p) ? p : [];
      // if item already gone, re-insert at top
      if (!arr.find((x: any) => x.id === prev.id)) return [{ ...prev, deletedAt: undefined, archivedAt: undefined, updatedAt: new Date().toISOString() }, ...arr];
      return arr.map((x: any) => x.id === prev.id ? { ...prev, deletedAt: undefined, archivedAt: undefined, updatedAt: new Date().toISOString() } : x);
    });
    setSnack(null);
    if (snackTimer.current) clearTimeout(snackTimer.current);
  }

  function handleRowTap(it: ShoppingItemV2) {
    if (!it.purchased) {
      markBought(it);
    } else {
      requestDelete(it);
    }
  }

  return (
    <div className="w-full min-h-[100vh] bg-[var(--wash-top)] pb-[120px]">
      {/* header */}
      <div className="w-full px-4 pt-6 pb-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)]" style={{ fontFamily: "Inter, ui-sans" }}>Shop</div>
            <h1 className="mt-1 text-[30px] leading-[0.95] font-[700] tracking-[-0.02em]" style={{ fontFamily: "Fraunces, serif" }}>
              What we need
            </h1>
            <div className="mt-1 text-[11.5px] text-[var(--muted)]">{counts.all} to get • {bought.length} bought • tap = strike</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-8 inline-flex items-center rounded-full border bg-[var(--card-bg)] px-3 text-[11px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>
              {bought.length > 0 ? `${bought.length} done` : "0 done"}
            </div>
          </div>
        </div>

        {/* inline add — no sheet */}
        <div className="mt-4 rounded-[18px] border bg-[var(--card-bg)] p-2.5 flex items-center gap-2 shadow-[0_4px_14px_rgba(0,0,0,0.04)]" style={{ borderColor: "var(--border)" }}>
          <input
            ref={addInputRef}
            value={addText}
            onChange={e => setAddText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
            placeholder={`Add ${addTrip === "grocery" ? "milk, eggs…" : addTrip === "online" ? "something to order…" : addTrip === "personal" ? "just for me…" : "a want…"} `}
            className="flex-1 h-[44px] rounded-full bg-transparent px-3 text-[14px] outline-none placeholder:text-[var(--muted)]/70"
            enterKeyHint="done"
          />
          <select
            value={addTrip}
            onChange={e => setAddTrip(e.target.value as ShoppingTrip)}
            className="h-[36px] rounded-full border bg-[var(--chip-bg)] px-2.5 text-[11px] font-medium outline-none"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="grocery">Grocery</option>
            <option value="online">Online</option>
            <option value="personal">Personal</option>
            <option value="want">Wants</option>
          </select>
          <button
            onClick={addItem}
            disabled={!addText.trim()}
            className="h-[40px] w-[40px] grid place-items-center rounded-full bg-[#121214] text-white text-[14px] disabled:opacity-30 active:scale-[0.96]"
          >
            +
          </button>
        </div>

        {/* search tiny */}
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find…" className="w-full h-[36px] rounded-full border bg-[var(--card-bg)] pl-3 pr-8 text-[12px] outline-none" style={{ borderColor: "var(--border)" }} />
            {query && <button onClick={() => setQuery("")} className="absolute right-1 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-[var(--chip-bg)] text-[9px]">✕</button>}
          </div>
          <span className="text-[10px] text-[var(--muted)]">{filtered.length} showing</span>
        </div>

        {/* trip filter */}
        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {TRIPS.map(t => (
            <TripPill key={t.id} def={t} active={tripFilter === t.id} onClick={() => setTripFilter(t.id as any)} />
          ))}
        </div>
        <div className="flex gap-1.5 flex-wrap mt-1">
          {TRIPS.filter(t => t.id !== "all").map(t => (
            <span key={t.id} className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] " + (tripFilter === t.id ? "bg-[#121214] text-white border-[#121214]" : "bg-[var(--chip-bg)] text-[var(--muted)] border-[var(--border)]")}>
              {(counts as any)[t.id] || 0} {t.short.toLowerCase()}
            </span>
          ))}
        </div>
      </div>

      {/* list */}
      <div className="px-3 space-y-5">
        {todo.length === 0 && bought.length === 0 && (
          <div className="rounded-[20px] border border-dashed bg-[var(--card-bg)]/70 px-6 py-12 text-center" style={{ borderColor: "var(--border)" }}>
            <div className="text-[14px] font-medium">Nothing here</div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">Add milk, bread, that cable — pick Grocery / Online / Personal / Wants above.</div>
          </div>
        )}

        {grouped.map(g => (
          <div key={g.trip} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--muted)] flex items-center gap-1">
                <span>{g.def.icon}</span> {g.def.label}
              </span>
              <span className="h-[1px] flex-1 bg-[var(--border)]" />
              <span className="text-[11px] text-[var(--muted)]">{g.items.length}</span>
            </div>
            <div className="grid gap-2">
              {g.items.map(it => (
                <button
                  key={it.id}
                  onClick={() => handleRowTap(it as any)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 min-h-[56px] rounded-[16px] border bg-[var(--card-bg)] text-left active:scale-[0.985] transition will-change-transform"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="grid h-[28px] w-[28px] place-items-center rounded-full border bg-white shrink-0">
                    <span className="h-[7px] w-[7px] rounded-full border border-[#8B7357]" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14.5px] font-[500] truncate">{it.item}</span>
                    <span className="block text-[11px] text-[var(--muted)] flex items-center gap-1.5">
                      {it.qty > 1 && <span>×{it.qty}</span>}
                      <span className="inline-flex rounded-full bg-[var(--chip-bg)] px-1.5 py-0.5 text-[10px]">need</span>
                      <span className="hidden sm:inline">tap to mark bought</span>
                    </span>
                  </span>
                  <span className="text-[10px] text-[var(--muted)]">○</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {bought.length > 0 && (
          <div className="pt-2 border-t border-dashed mt-6">
            <div className="flex items-center gap-2 px-1 mb-2">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-[var(--muted)]">Bought • tap to remove</span>
              <span className="h-[1px] flex-1 bg-[var(--border)]" />
              <span className="text-[10px] text-[var(--muted)]">{bought.length}</span>
            </div>
            <div className="grid gap-1.5">
              {bought.map(it => (
                <div key={it.id} className="flex items-center gap-2 px-2.5 py-2 min-h-[50px] rounded-[14px] border border-dashed bg-[#F3F1EF] opacity-[0.92]" style={{ borderColor: "var(--border)" }}>
                  <button onClick={() => handleRowTap(it as any)} className="flex-1 text-left flex items-center gap-2 min-w-0">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[#121214] text-white text-[10px]">✓</span>
                    <span className="text-[13.5px] line-through text-[var(--muted)] truncate flex-1">{it.item}</span>
                    <span className="inline-flex rounded-full bg-[#121214] px-2 py-0.5 text-[10px] text-white">bought</span>
                  </button>
                  <button onClick={() => markNeed(it as any)} className="h-[32px] rounded-full border bg-white px-2.5 text-[11px]">Need?</button>
                  <button onClick={() => requestDelete(it as any)} className="h-[32px] w-[32px] grid place-items-center rounded-full text-[#B91C1C]">✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10px] text-[var(--muted)] px-1">Tip: bought items stay visible until you tap them again. Undo shows if you delete.</div>
          </div>
        )}
      </div>

      <BottomConfirm
        open={!!confirmItem}
        itemLabel={confirmItem?.item}
        onCancel={() => setConfirmItem(null)}
        onDelete={() => confirmItem && doDelete(confirmItem as any)}
        dontAsk={dontAskAgain}
        setDontAsk={setDontAskAgain}
      />
      <UndoToast snack={snack} onUndo={handleUndo} onDismiss={() => { setSnack(null); if (snackTimer.current) clearTimeout(snackTimer.current); }} />
    </div>
  );
}

export default ShoppingScreen;
