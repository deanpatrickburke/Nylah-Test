import { useMemo, useState, useEffect } from "react";
import type { PersonKey, Theme, TabKey, ChoreV2, CalendarEventV2, ShoppingItemV2, NoteMemo } from "../../types";
import { PERSONS } from "../../constants/themes";
import type { SyncStatus } from "../../lib/remoteSync";
import { HOUSEHOLD_TZ, todayKey, toLocalKey as toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";
import { getDueMsChore, relTime } from "../../shared/utils/helpers";

import NeedsYou, { AwaitingYou } from "./NeedsYou";
import Upcoming from "./Upcoming";
import Countdowns from "./Countdowns";
import { computeShoppingNextDue } from "../../lib/shoppingDue";

type FridgeProps = {
  currentUser?: PersonKey;
  chores?: ChoreV2[];
  calendar?: CalendarEventV2[];
  shopping?: ShoppingItemV2[];
  notes?: NoteMemo[];
  setTab?: (k: TabKey) => void;
  nowMs?: number;
  theme?: Theme;
  syncStatus?: SyncStatus;
};

function FridgePage(props: FridgeProps | any) {
  // v120 defensive guards — prevents undefined .filter / .name crashes when App renders without props
  const raw = props || {};
  const currentUser = (raw.currentUser || "aisling") as PersonKey;
  const chores = Array.isArray(raw.chores) ? raw.chores : [];
  const calendar = Array.isArray(raw.calendar) ? raw.calendar : [];
  const shopping = Array.isArray(raw.shopping) ? raw.shopping : [];
  const notes = Array.isArray(raw.notes) ? raw.notes : [];
  const setTab = typeof raw.setTab === "function" ? raw.setTab : (() => {});
  const nowMs = typeof raw.nowMs === "number" ? raw.nowMs : Date.now();
  const theme = raw.theme;
  const syncStatus = raw.syncStatus;

  const todayDateStr = todayKey(HOUSEHOLD_TZ);
  const nowDate = new Date(nowMs);
  const weekdayLong = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: HOUSEHOLD_TZ }).format(nowDate);
  const dayNumStr = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: HOUSEHOLD_TZ }).format(nowDate);
  const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: HOUSEHOLD_TZ }).format(nowDate);
  const dateLabel = `${weekdayLong}, ${dayNumStr} ${monthLong}`;
  const hourDublin = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: HOUSEHOLD_TZ }).format(nowDate));
  const greeting = hourDublin < 12 ? "Good morning" : hourDublin < 18 ? "Good afternoon" : "Good evening";
  const partner: PersonKey = currentUser === "aisling" ? "ciaran" : "aisling";

  const activeChores = useMemo(() => (chores as any[]).filter((c) => !(c as any).deletedAt), [chores]);
  const activeCalendar = useMemo(() => (calendar as any[]).filter((ev: any) => !(ev as any).deletedAt), [calendar]);
  const activeShopping = useMemo(() => (shopping as any[]).filter((s: any) => !(s as any).deletedAt && !(s as any).archivedAt), [shopping]);
  const activeNotes = useMemo(() => (notes as any[]).filter((n: any) => !(n as any).deletedAt && !(n as any).archived_at && !(n as any).archivedAt), [notes]);

  const emptyAll = activeChores.length === 0 && activeCalendar.length === 0 && activeShopping.length === 0 && activeNotes.length === 0;

  const syncMinimal = (() => {
    if (!syncStatus) return null;
    const k = (syncStatus as any)?.kind;
    if (k === "saving") return <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B] animate-pulse" />Saving</span>;
    if (k === "offline-queued") return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF]"><span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF]" />Queued</span>;
    if (k === "failed") return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#B91C1C]"><span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />Offline</span>;
    const savedAt = (syncStatus as any)?.lastSavedAt;
    const savedLabel = (() => {
      try {
        if (!savedAt) return null;
        return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: HOUSEHOLD_TZ }).format(new Date(savedAt));
      } catch { return null; }
    })();
    return <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]" title={savedAt ? `Server confirmed ${savedAt}` : undefined}><span className="h-1.5 w-1.5 rounded-full bg-[#8DA08E]" />{savedLabel ? `Saved • ${savedLabel}` : "Saved"}</span>;
  })();

  const [confetti, setConfetti] = useState<number>(0);
  useEffect(() => {
    if ((syncStatus as any)?.kind === "saved" || (syncStatus as any)?.kind === "synced") {
      setConfetti((c) => c + 1);
      const t = setTimeout(() => setConfetti((c) => Math.max(0, c - 1)), 1200);
      return () => clearTimeout(t);
    }
  }, [(syncStatus as any)?.kind]);

  const stickyPick = useMemo(() => {
    const unread = (activeNotes as any[]).filter((n) => n.author === partner && !((n.seenBy as any)?.[currentUser])).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (unread[0]) return { note: unread[0], label: `Unread` };
    const pinned = (activeNotes as any[]).filter((n) => (n as any).pinned_at || (n as any).pinnedAt).sort((a: any, b: any) => {
      const pa = (a as any).pinned_at || (a as any).pinnedAt || a.createdAt;
      const pb = (b as any).pinned_at || (b as any).pinnedAt || b.createdAt;
      return new Date(pb).getTime() - new Date(pa).getTime();
    });
    if (pinned[0]) return { note: pinned[0], label: `Pinned` };
    const love = (activeNotes as any[]).filter((n) => n.isLove).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (love[0]) return { note: love[0], label: `Love note` };
    if (activeNotes.length > 0) {
      const sorted = [...activeNotes].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return { note: sorted[0], label: `Note` };
    }
    return null;
  }, [activeNotes, currentUser, partner]);

  const todayCalsForHasToday = useMemo(() => {
    const agreed = (activeCalendar as any[]).filter((ev) => {
      const s: any = ev.status;
      return s === "agreed" || s === "accepted" || s === "yes" || s === "confirmed";
    }).filter((ev) => {
      try { return toLocalKeyDublin(ev.dueAt, HOUSEHOLD_TZ) === todayDateStr; } catch { return false; }
    }).sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()).slice(0, 3);
    return agreed;
  }, [activeCalendar, todayDateStr]);

  const todayChoresMineForHasToday = useMemo(() => {
    const mine = (activeChores as any[]).filter((c) => {
      if (c.assignedTo !== currentUser || c.status === "done") return false;
      try {
        const dueMs = getDueMsChore(c as any);
        const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
        return dueKey === todayDateStr || dueMs < nowMs;
      } catch { return false; }
    }).sort((a: any, b: any) => getDueMsChore(a as any) - getDueMsChore(b as any)).slice(0, 3);
    return mine;
  }, [activeChores, currentUser, todayDateStr, nowMs]);

  const shoppingSummaryForHasToday = useMemo(() => {
    const todo = (activeShopping as any[]).filter((s) => !s.purchased);
    if (todo.length === 0) return null;
    const endOfToday = (() => {
      try {
        const [y, m, d] = todayDateStr.split("-").map(Number);
        return tzWallToUtc(y, m, d, 23, 59, 59, HOUSEHOLD_TZ);
      } catch { return new Date(nowMs); }
    })();
    const dueToday = todo.filter((it) => {
      try {
        const nxt = computeShoppingNextDue(it as any, nowMs);
        if (!nxt) return false;
        const dueKey = toLocalKeyDublin(nxt.toISOString(), HOUSEHOLD_TZ);
        const isToday = dueKey === todayDateStr;
        const isOverdue = nxt.getTime() < nowMs;
        return isToday || isOverdue || nxt.getTime() <= endOfToday.getTime();
      } catch { return false; }
    });
    if (dueToday.length === 0) return null;
    const count = dueToday.length;
    const names = dueToday.slice(0, 3).map((s: any) => (s as any).item || (s as any).title || "item");
    const rest = count - names.length;
    const label = rest > 0 ? `${names.join(", ")} +${rest} more` : names.join(", ");
    return { count, label, todo: dueToday };
  }, [activeShopping, todayDateStr, nowMs]);

  const shoppingDueList = useMemo(() => {
    if (!shoppingSummaryForHasToday) return [];
    return (shoppingSummaryForHasToday.todo as any[]).slice(0, 3);
  }, [shoppingSummaryForHasToday]);

  const hasToday = todayCalsForHasToday.length > 0 || todayChoresMineForHasToday.length > 0 || !!shoppingSummaryForHasToday;

  return (
    <div className="w-full space-y-5">
      <style>{`@keyframes fridge-peach-pulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,107,38,0.22)}50%{transform:scale(1.06);box-shadow:0 0 0 3px rgba(255,107,38,0.12)}} @keyframes countdown-pop{0%{transform:scale(0.96)}50%{transform:scale(1.02)}100%{transform:scale(1)}}`}</style>
      {confetti > 0 && (
        <div className="pointer-events-none absolute right-4 top-2 flex gap-1">
          <span className="h-1 w-1 rounded-full bg-[#E07A5F] animate-bounce [animation-delay:0ms]" />
          <span className="h-1 w-1 rounded-full bg-[#A89FDA] animate-bounce [animation-delay:120ms]" />
          <span className="h-1 w-1 rounded-full bg-[#E8CEB7] animate-bounce [animation-delay:220ms]" />
        </div>
      )}

      <div className="nylah-hero-v101 nylah-grain rounded-[28px] px-6 pt-6 pb-5 relative overflow-hidden" style={{ fontSmooth: 'always' } as any}>
        <div className="relative flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-[0.14em] uppercase" style={{ fontFamily: "var(--font-ui)", color: "var(--muted)", textRendering: 'optimizeLegibility' }}>{dateLabel}</div>
          <div className="shrink-0 opacity-90">{syncMinimal}</div>
        </div>
        <div className="relative mt-5">
          <div className="nylah-script-hero text-[40px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--text)", opacity: 1, fontWeight: 600, textRendering: 'optimizeLegibility', WebkitFontSmoothing: 'antialiased' }}>{greeting.toLowerCase()}</div>
          <h1 className="nylah-display-hero text-[46px] -mt-1" style={{ fontFamily: "var(--font-display)", color: "var(--text)", lineHeight: 0.92, letterSpacing: '-0.02em', fontWeight: 600 }}>
            {((PERSONS as any)[currentUser]?.name || currentUser || "You")}
            <span className="ml-2 inline-flex items-baseline gap-2 align-baseline">
              <span className="text-[20px] font-light" style={{ fontFamily: "var(--font-ui)", fontWeight: 400, color: "var(--muted)", letterSpacing: '-0.01em' }}>with</span>
              <span className="nylah-script-hero text-[34px]" style={{ fontFamily: "var(--font-script)", color: "var(--accent-warm)", fontWeight: 500, textShadow: '0 1px 0 rgba(255,255,255,0.4)' } as any}>{(PERSONS as any)[partner]?.name || partner}</span>
            </span>
          </h1>
          <div className="mt-2 flex items-center gap-2 text-[11px] tracking-[0.12em] uppercase" style={{ fontFamily: "var(--font-ui)", color: "var(--muted)", fontWeight: 500 }}>
            <span className="h-px w-8" style={{ background: "var(--border)" }} /> {(PERSONS as any)[currentUser]?.name || (typeof currentUser==='string' ? currentUser : 'You')} ♥ {(PERSONS as any)[partner]?.name || partner} • Beirt
          </div>
        </div>
        {/* single subtle glow - cut extra blobs */}
        <div className="absolute -right-12 -bottom-12 w-[160px] h-[160px] rounded-full blur-[36px] opacity-[0.12] pointer-events-none" style={{ background: "var(--accent)" }} />
      </div>

      <NeedsYou currentUser={currentUser} calendar={activeCalendar as any} chores={activeChores as any} nowMs={nowMs} setTab={setTab as any} />
      <Upcoming currentUser={currentUser} calendar={activeCalendar as any} chores={activeChores as any} shopping={activeShopping as any} nowMs={nowMs} todayDateStr={todayDateStr} setTab={setTab as any} />
      <AwaitingYou currentUser={currentUser} calendar={activeCalendar as any} nowMs={nowMs} setTab={setTab as any} />
      <Countdowns calendar={activeCalendar as any} nowMs={nowMs} todayDateStr={todayDateStr} setTab={setTab as any} />

      {activeChores.filter((c: any) => c.status === "deck").length > 0 && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[18px] font-semibold tracking-tight text-[var(--text)]">Chores deck • {activeChores.filter((c: any) => c.status === "deck").length}</span>
            <button onClick={() => setTab("chores")} className="text-[11px] text-[var(--muted)] min-h-[44px]">Shuffle →</button>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] px-3 py-3 flex gap-2 overflow-x-auto no-scrollbar" style={{ borderColor: "var(--border)" }}>
            {(activeChores as any[]).filter((c: any) => c.status === "deck").slice(0, 6).map((c: any) => (
              <button key={c.id} onClick={() => setTab("chores")} className="shrink-0 rounded-full border bg-[var(--chip-bg)] px-3 py-2 text-[12px] font-medium hover:bg-[var(--wash-mid)] transition min-h-[44px]" style={{ borderColor: "var(--border)" }}>{c.title}</button>
            ))}
          </div>
        </div>
      )}

      {shoppingDueList.length > 0 && !hasToday && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[18px] font-semibold tracking-tight">Pantry low • {shoppingDueList.length}</span>
            <button onClick={() => setTab("shopping")} className="text-[11px] text-[var(--muted)] min-h-[44px]">Shop →</button>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {shoppingDueList.map((it: any, i: number) => (
              <button key={it.id} onClick={() => setTab("shopping")} className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[56px] hover:bg-[var(--chip-bg)]/40 transition" style={{ borderTop: i === 0 ? undefined : "1px solid var(--chip-bg)" }}>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] border text-[11px]" style={{ borderColor: "var(--border)" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5"><path d="M6 8h12l-1 11H7L6 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg></span>
                <span className="flex-1 text-[13px] font-medium truncate">{it.item} {it.qty > 1 ? `×${it.qty}` : ""}</span>
                <span className="text-[11px] text-[var(--muted)]">{it.cat || ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {stickyPick && stickyPick.note && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[18px] font-semibold tracking-tight text-[var(--text)]">From {(PERSONS as any)[partner]?.name || partner || "?"}</span>
            <span className="text-[11px] rounded-full border bg-[var(--card-bg)] px-2.5 py-1 text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>{stickyPick.label} • {relTime(stickyPick!.note!.createdAt, nowMs)}</span>
          </div>
          <button onClick={() => setTab("notes")} className="relative w-full text-left rounded-[22px] border bg-[var(--card-bg)] px-5 py-5" style={{ borderColor: "var(--border)", boxShadow: "0 16px 40px rgba(41,26,12,0.14), 0 1px 0 rgba(255,255,255,0.9) inset" }}>
            <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 h-4 w-16 rounded-full bg-[var(--chip-bg)]/90 border shadow-sm" style={{ borderColor: "var(--border)" }} aria-hidden="true" />
            <span className="pointer-events-none absolute right-6 top-6 opacity-[0.12]"><svg viewBox="0 0 16 16" className="h-[32px] w-[32px]" fill="#E07A5F"><path d="M8 13.1 4.2 9.6A3.6 3.6 0 0 1 3 7c0-1.7 1.25-2.9 2.9-2.9 1 0 1.65.45 2.1 1.2.45-.75 1.1-1.2 2.1-1.2C11.75 4.1 13 5.3 13 7c0 .9-.4 1.9-1.2 2.9L8 13.1Z" /></svg></span>
            <div className="flex gap-4">
              <span className="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold text-white shrink-0 mt-0.5 shadow-sm" style={{ background: (PERSONS as any)[partner]?.accent2 || "#E07A5F" }}>{(PERSONS as any)[partner]?.initial || "?"}</span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[16px] leading-[1.45] line-clamp-5 text-[var(--text)]">{stickyPick!.note!.body}</div>
                {(stickyPick!.note!.photoThumbDataUrl || stickyPick!.note!.photoDataUrl) && (
                  <div className="mt-4 inline-block rounded-[12px] border bg-[var(--card-bg)] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.10)]">
                    <img src={(stickyPick!.note! as any).photoThumbDataUrl || stickyPick!.note!.photoDataUrl} alt="note" className="h-[160px] w-[160px] rounded-[8px] object-cover" loading="lazy" />
                    <div className="mt-2 flex justify-center"><span className="h-1.5 w-7 rounded-full bg-[var(--chip-bg)] border" style={{ borderColor: "var(--border)" }} /></div>
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>
      )}

      {emptyAll && (
        <div className="rounded-[28px] border bg-[var(--card-bg)] px-7 py-12 text-center relative overflow-hidden" style={{ borderColor: "var(--border)", boxShadow: "0 16px 40px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,0.9)" }}>
          <div className="absolute left-1/2 top-8 -translate-x-1/2 h-px w-24 opacity-60" style={{ background: "linear-gradient(90deg, transparent, var(--border), transparent)" }} />
          <span className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-full border" style={{ background: "var(--chip-bg)", borderColor: "var(--border)" }}><span className="text-[18px]" style={{ color: "var(--accent-warm)" }}>✦</span></span>
          <div className="mt-5 text-[22px] font-semibold tracking-tight" style={{ fontFamily: "Fraunces, serif", color: "var(--text)" }}>A little quiet in here</div>
          <div className="mx-auto mt-2 max-w-[268px] italic leading-[1.55]" style={{ fontFamily: "Fraunces, serif", fontStyle: "italic", fontWeight: 400, fontSize: "17px", color: "var(--muted)" }}>Nothing queued.</div>
          <div className="mx-auto mt-2 max-w-[260px] text-[12.5px] leading-[1.5]" style={{ color: "var(--muted)" }}>Leave a note, add a plan, or tuck a shop list in — it warms right up when you do.</div>
          <button onClick={() => setTab("notes")} className="mt-5 inline-flex h-[44px] min-h-[44px] items-center justify-center rounded-full px-7 text-[13px] font-semibold tracking-wide active:scale-[0.99] transition" style={{ background: "#121214", color: "#FFFEFB", boxShadow: "0 8px 20px rgba(0,0,0,0.18)" }}>Add a note</button>
        </div>
      )}

      {(syncStatus as any)?.kind === "failed" && (
        <div className="rounded-[16px] border px-4 py-3 flex items-center justify-between gap-2 bg-[#FEF2F2]" style={{ borderColor: "#FECACA" }}>
          <span className="text-[12px] text-[#991B1B]">Offline — retrying</span>
          <button onClick={() => { try { window.dispatchEvent(new CustomEvent("couple-sync", { detail: "retry" })); } catch {} }} className="h-9 rounded-full bg-[#0A0A0A] px-4 text-[12px] font-semibold text-white">Retry</button>
        </div>
      )}
      {(syncStatus as any)?.kind === "offline-queued" && !emptyAll && (
        <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 text-[12px] text-[#92400E]" style={{ borderColor: "#FDE68A" }}>
          Offline — changes saved locally, will sync when back.
        </div>
      )}
    </div>
  );
}

export default FridgePage;
export { FridgePage as FridgeScreen };
