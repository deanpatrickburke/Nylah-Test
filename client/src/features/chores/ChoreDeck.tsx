// ChoreDeck.tsx — Soho boutique refinement
// Soft linen, hairline, 20px radius, warm wash, 44px circle icon, no black shadows,
// no rotate grain blur. Editorial micro.
import React from "react";
import type { ChoreV2 } from "./choreTypes";
import { effectivePoints, getDueMsChore, isBonusChore, effortHuman } from "./choreScoring";
import { rotForId } from "../../shared/utils/helpers";
import { ChoreIcon, CHORE_ICONS, CHORE_ICON_BY_TEMPLATE } from "../../lib/choreIcons";
import { todayKey, toLocalKey as toLocalKeyDublin, HOUSEHOLD_TZ } from "../../lib/dates";

type Props = {
  deck: ChoreV2[];
  currentCard: ChoreV2 | null;
  deckCount: number;
  dragX: number;
  dragging: boolean;
  startX: React.MutableRefObject<number | null>;
  setDragX: (v: number) => void;
  setDragging: (v: boolean) => void;
  onSwipe: (dir: "left" | "right") => void;
  flippedId: string | null;
  setFlippedId: (cb: any) => void;
  pointsPops: { id: string; pts: number }[];
  nowMs: number;
  onTapCard: (c: ChoreV2) => void;
  combo: number;
  filter: "all" | "today" | "week" | "overdue";
  setFilter: (v: any) => void;
  showSkeletons: boolean;
  setShowRules: (v: boolean) => void;
};

function timingLabel(c: ChoreV2, nowMs: number) {
  try {
    const freq = (c.frequency || "").toUpperCase() || "ONCE";
    const dueMs = getDueMsChore(c);
    const diff = dueMs - nowMs;
    const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
    const isToday = dueKey === todayKey(HOUSEHOLD_TZ);
    const isOver = diff < 0;
    if (isOver) return `${freq} • OVERDUE`;
    if (isToday) return `${freq} • TODAY`;
    if (diff < 48 * 3600000) return `${freq} • TOMORROW`;
    return freq;
  } catch {
    return (c.frequency || "ONCE").toUpperCase();
  }
}

export function ChoreDeck(props: Props) {
  const {
    deck,
    currentCard,
    deckCount,
    dragX,
    dragging,
    startX,
    setDragX,
    setDragging,
    onSwipe,
    flippedId,
    pointsPops,
    nowMs,
    onTapCard,
    combo,
    filter,
    setFilter,
    showSkeletons,
    setShowRules,
  } = props;

  const ChoreCardBoutique = ({ c, large = false, onTap }: { c: ChoreV2; large?: boolean; onTap?: () => void }) => {
    const isFlipped = flippedId === c.id;
    const dueMs = getDueMsChore(c as any);
    const overdue = dueMs < nowMs && c.status !== "done";
    const rotBase = large ? 0 : rotForId(c.id) * 0.12; // max ~0.6deg
    const dragRot = Math.max(-1.15, Math.min(1.15, dragX * 0.015));
    const totalRot = large ? dragRot : rotBase;
    const points = effectivePoints(c, isBonusChore(c, nowMs));
    const overdueDays = overdue ? Math.max(1, Math.floor((nowMs - dueMs) / 86400000)) : 0;
    const mult = c.multiplier > 1 ? c.multiplier : overdueDays > 0 ? 1.15 : 1;

    const resolveIconId = (ch: any): string => {
      if (ch.icon && (CHORE_ICONS as any)[ch.icon]) return ch.icon;
      if (ch.templateId && (CHORE_ICON_BY_TEMPLATE as any)[ch.templateId]) return (CHORE_ICON_BY_TEMPLATE as any)[ch.templateId];
      const t = (ch.title || "").toLowerCase();
      if (t.includes("bin") || t.includes("trash") || t.includes("rubbish")) return "bins";
      if (t.includes("dish")) return "dishes";
      if (t.includes("laundr") || t.includes("clothes")) return "laundry";
      if (t.includes("vacuum") || t.includes("hoover")) return "vacuum";
      if (t.includes("bathroom") || t.includes("toilet") || t.includes("shower")) return "bathroom";
      if (t.includes("shop") || t.includes("grocer") || t.includes("market")) return "groceries";
      if (t.includes("kitchen") || t.includes("cook")) return "kitchen";
      if (t.includes("bed")) return "bed";
      if (t.includes("window")) return "windows";
      if (t.includes("garden") || t.includes("yard")) return "garden";
      if (t.includes("mop") || t.includes("floor")) return "mop";
      return "broom";
    };
    const iconId = resolveIconId(c);
    const isRace = c.status === "open" && (c as any).swipes?.aisling === "right" && (c as any).swipes?.ciaran === "right";

    return (
      <div className="relative w-full select-none">
        {/* layered next-card peek */}
        {large && deck.length > 1 && (
          <div
            className="pointer-events-none absolute inset-0 rounded-[20px] translate-y-[6px] scale-[0.985]"
            style={{
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              opacity: 0.62,
            }}
            aria-hidden
          />
        )}

        <div
          className={
            "relative w-full rounded-[20px] border bg-[var(--card-bg)] text-left overflow-hidden " +
            (large ? "min-h-[264px] " : "min-h-[106px] ") +
            "transition-[transform,box-shadow,border-color] active:scale-[0.985]"
          }
          style={{
            borderColor: "var(--border)",
            background: "var(--card-bg)",
            boxShadow: large
              ? "0 6px 20px rgba(18,18,20,0.05), 0 1px 0 rgba(0,0,0,0.02)"
              : "0 2px 10px rgba(18,18,20,0.04)",
            transform: `translateX(${large ? dragX : 0}px) rotate(${totalRot}deg)`,
            transition: dragging
              ? "none"
              : "transform 380ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease, border-color 200ms ease",
          }}
          onClick={() => {
            try {
              if (navigator.vibrate) navigator.vibrate(6);
            } catch {}
          }}
        >
          {/* ultra-subtle grain 0.014 – or none */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[20px] opacity-[0.014] mix-blend-multiply"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            }}
            aria-hidden
          />
          {/* soft wash – theme aware, not beige-only */}
          <div
            className="pointer-events-none absolute -right-10 -top-14 h-[168px] w-[168px] rounded-full blur-[18px]"
            style={{
              background: "radial-gradient(70% 70% at 50% 50%, var(--chip-bg) 0%, transparent 72%)",
              opacity: 0.72,
            }}
            aria-hidden
          />

          {/* top-rule row */}
          <div className="relative z-10 flex items-center justify-between px-[18px] pt-[14px]">
            <span className="text-[10px] font-[650] tracking-[0.18em] uppercase" style={{color:"var(--muted)"}}>
              {timingLabel(c, nowMs)}
            </span>
            <div className="flex items-center gap-2">
              {isRace && (
                <span className="inline-flex items-center gap-1 rounded-full border bg-[var(--chip-bg)]/80 px-2 py-[2px] text-[10px] font-[600] tracking-[0.04em]" style={{borderColor:"var(--border)", color:"var(--text-secondary)"}}>
                  <span className="h-[4px] w-[4px] rounded-full bg-[#D6BCA7] animate-pulse" />
                  RACE
                </span>
              )}
              {/* 44px circle icon – theme aware */}
              <span
                className="grid h-[44px] w-[44px] place-items-center rounded-full bg-[var(--chip-bg)] text-[var(--text)]"
                style={{ border: "1px solid var(--border)" }}
                aria-hidden
              >
                <ChoreIcon id={iconId as any} size={20} />
              </span>
            </div>
          </div>

          {/* swipe hints – soft translucent, centered */}
          {large && dragX < -56 && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
              <div className="rounded-full border bg-[var(--card-bg)]/85 px-4 py-2 text-[11.5px] font-[600] tracking-[0.06em] backdrop-blur-md shadow-[0_2px_12px_rgba(0,0,0,0.08)]" style={{borderColor:"var(--border)", color:"var(--text-secondary)"}}>
                pass
              </div>
            </div>
          )}
          {large && dragX > 56 && (
            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
              <div className="rounded-full bg-[#121214] px-4 py-2 text-[11.5px] font-[650] tracking-[0.06em] text-white shadow-[0_4px_14px_rgba(0,0,0,0.16)] dark:bg-[#FF6B26] dark:text-[#121214]">
                mine
              </div>
            </div>
          )}

          <button
            onClick={(e: any) => {
              e.stopPropagation();
              onTap?.();
            }}
            className="relative z-10 w-full cursor-pointer text-left"
          >
            <div className="px-[18px] pt-[2px] pb-[12px]">
              {/* title – Fraunces 21px tight */}
              <div
                className={
                  "font-[630] text-[var(--text)] " +
                  (large
                    ? "text-[21px] leading-[1.15] tracking-[-0.012em] mt-[6px] max-w-[76%]"
                    : "text-[15px] leading-[1.28] mt-1 max-w-[78%]")
                }
                style={{ fontFamily: "Fraunces, ui-serif, Georgia, serif" }}
              >
                {c.title}
              </div>

              {/* meta row – effort chip, points, overdue */}
              <div className="mt-[10px] flex flex-wrap items-center gap-2">
                <span className="inline-flex h-[20px] items-center rounded-full border bg-transparent px-2.5 text-[10.5px] font-[500]" style={{borderColor:"var(--border)", color:"var(--muted)"}}>
                  {effortHuman(c.pain)}
                </span>
                <span className="text-[11px] font-[600] tracking-[0.01em]" style={{color:"var(--accent-strong)"}}>
                  {points} pts{mult > 1 ? ` • ${mult}×` : ""}
                </span>
                {overdue && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-[500]" style={{color:"#A77166"}}>
                    <span className="h-[4px] w-[4px] rounded-full bg-[#D9A8A0]" />
                    {overdueDays}d late
                  </span>
                )}
                {isFlipped && <span className="text-[10.5px]" style={{color:"var(--muted)"}}>close</span>}
              </div>

              {large && (
                <div className="mt-[14px] h-[1.5px] w-full overflow-hidden rounded-full" style={{background:"var(--border)"}}>
                  <div
                    className="h-full rounded-full bg-[#D9CFC5] transition-all duration-500"
                    style={{ width: Math.min(100, (points / 120) * 100) + "%", background:"var(--border)" }}
                  />
                </div>
              )}
            </div>
          </button>

          {isFlipped && (
            <div className="relative z-10 mx-[12px] mb-[12px] rounded-[12px] border bg-[var(--chip-bg)] px-3 py-2.5 text-[11px] leading-[1.5]" style={{borderColor:"var(--border)", color:"var(--text-secondary)"}}>
              <div>
                Pain {c.pain}/10 • base {c.basePoints} {c.multiplier > 1 ? "• bonus 1.15×" : ""} {overdue ? `• ${overdueDays}d overdue 1.15× → ${points}` : `• ${points} pts`}
              </div>
              <div>
                Due {new Date(getDueMsChore(c as any)).toLocaleString("en-GB", { timeZone: HOUSEHOLD_TZ, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} • {c.frequency}
                {c.frequencyDetail ? ` • ${c.frequencyDetail}` : ""}
              </div>
              <div>
                Assigned {c.assignedTo || "deck"} • Swipes {(c as any).swipes?.aisling || "–"} / {(c as any).swipes?.ciaran || "–"}
              </div>
            </div>
          )}

          {pointsPops.find((p) => p.id === c.id) && (
            <span
              className="pointer-events-none absolute right-5 top-[54px] z-20 text-[12.5px] font-[750] text-[#7A9A7A]"
              style={{ animation: "popUpBouncy 680ms cubic-bezier(0.34,1.56,0.64,1) forwards" }}
            >
              +{pointsPops.find((p) => p.id === c.id)?.pts}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* deck chrome – editorial, theme aware */}
      <div className="px-[2px] flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-['Fraunces'] text-[12.5px] font-[620] tracking-[-0.01em] tabular-nums" style={{color:"var(--text)"}}>
            {deckCount} left
          </span>
          <span className="text-[11px] font-[450] tracking-[0.02em]" style={{color:"var(--muted)"}}>swipe to play</span>
          {combo > 1 && (
            <span className="ml-1 inline-flex h-[20px] items-center rounded-full border bg-[var(--chip-bg)]/70 px-2 text-[10.5px] font-[650] tracking-[0.04em]" style={{borderColor:"var(--border)", color:"var(--text-secondary)"}}>
              {combo}×
            </span>
          )}
        </div>

        {/* minimal underline filter */}
        <div className="flex items-center gap-2">
          {deckCount === 0 && (
            <span className="hidden sm:inline-flex h-[22px] items-center rounded-full border bg-[var(--chip-bg)] px-2.5 text-[10.5px] font-[550]" style={{borderColor:"var(--border)", color:"var(--muted)"}}>
              {(() => {
                try {
                  return Number(localStorage.getItem("couple_v1_chore_streak") || 0);
                } catch {
                  return 0;
                }
              })()}{" "}
              day run
            </span>
          )}
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="h-[32px] min-w-[88px] appearance-none bg-transparent px-0 pr-5 text-[11.5px] font-[500] outline-none"
              style={{ border: "none", borderBottom: "1px solid var(--border)", color:"var(--muted)" }}
            >
              <option value="all">All</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="overdue">Overdue</option>
            </select>
            <span className="pointer-events-none absolute right-[2px] top-1/2 -translate-y-1/2" style={{color:"var(--muted)"}}>
              <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.6 4.2 L6 7.6 L9.4 4.2" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {showSkeletons ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-[20px] border bg-[var(--card-bg)] h-[248px] animate-pulse" style={{borderColor:"var(--border)"}}>
            <div className="p-[18px] space-y-3">
              <div className="h-2 w-20 rounded-full bg-[var(--border)]" />
              <div className="h-5 w-3/4 rounded-full bg-[var(--border)]" />
              <div className="h-3 w-full rounded-full bg-[var(--chip-bg)]" />
            </div>
          </div>
          <div className="h-[52px] rounded-[14px] bg-[var(--chip-bg)] border animate-pulse" style={{borderColor:"var(--border)"}} />
        </div>
      ) : currentCard ? (
        <div className="mt-[10px] space-y-3">
          <div
            className="relative"
            style={{ touchAction: "pan-y", minHeight: 286, userSelect: "none" } as any}
            onPointerDown={(e: any) => {
              setDragging(true);
              setDragX(0);
              try {
                (e.currentTarget as any).setPointerCapture(e.pointerId);
              } catch {}
              startX.current = e.clientX;
            }}
            onPointerMove={(e: any) => {
              if (!dragging) return;
              const sx = startX.current;
              if (sx == null) return;
              const diff = e.clientX - sx;
              const clamped = Math.max(-160, Math.min(160, diff * 0.72));
              setDragX(clamped);
            }}
            onPointerUp={(e: any) => {
              if (Math.abs(dragX) > 72) onSwipe(dragX > 0 ? "right" : "left");
              else setDragX(0);
              setDragging(false);
              startX.current = null;
              try {
                (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
              } catch {}
            }}
            onPointerCancel={() => {
              setDragX(0);
              setDragging(false);
              startX.current = null;
            }}
          >
            <ChoreCardBoutique c={currentCard} large onTap={() => onTapCard(currentCard)} />
          </div>

          {/* Soho buttons – ghost + charcoal, theme aware */}
          <div className="grid grid-cols-[1fr_1.35fr] gap-[10px] px-[1px]">
            <button
              onClick={() => onSwipe("left")}
              className="h-[52px] rounded-[14px] border bg-[var(--card-bg)] text-[13px] font-[600] tracking-[0.04em] active:scale-[0.98] transition-transform"
              style={{
                borderColor: "var(--border)",
                color:"var(--text-secondary)",
                boxShadow: "0 1px 0 rgba(0,0,0,0.02) inset",
                minHeight: 52,
                transition: "transform 180ms cubic-bezier(0.34,1.56,0.64,1)",
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[12px] opacity-60">×</span> Pass
              </span>
            </button>
            <button
              onClick={() => onSwipe("right")}
              className="h-[52px] rounded-[14px] bg-[#121214] text-[13px] font-[650] tracking-[0.02em] text-white active:scale-[0.98] shadow-[0_6px_18px_rgba(0,0,0,0.18)] transition-transform dark:bg-[#FF6B26] dark:text-[#121214]"
              style={{ minHeight: 52, transition: "transform 180ms cubic-bezier(0.34,1.56,0.64,1)" }}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="h-[5px] w-[5px] rounded-full bg-[#F7EFE8] opacity-80 dark:bg-[#121214]/70" /> I’ll do it
              </span>
            </button>
          </div>

          {/* next up – muted */}
          {deck.length > 1 && (
            <div className="px-[2px] pt-[2px] text-[11px] font-[450] tracking-[0.01em]" style={{color:"var(--muted)"}}>
              Next <span style={{color:"var(--text-secondary)"}}>{deck[1].title}</span> • {deck[1].basePoints}pts
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 rounded-[20px] border bg-[var(--card-bg)] px-6 py-[36px] text-center shadow-[0_6px_20px_rgba(0,0,0,0.04)]" style={{borderColor:"var(--border)"}}>
          <div className="mx-auto mb-3 grid h-[44px] w-[44px] place-items-center rounded-full bg-[var(--chip-bg)] border" style={{borderColor:"var(--border)"}}>
            <span className="h-[6px] w-[6px] rounded-full bg-[#8B5E3C]/70" />
          </div>
          <div className="font-['Fraunces'] text-[15.5px] font-[620] tracking-[-0.01em]" style={{color:"var(--text)"}}>Deck clear</div>
          <div className="mt-1 text-[12px] font-[450] leading-[1.5]" style={{color:"var(--muted)"}}>New drops at midnight • come back then</div>
        </div>
      )}
    </>
  );
}

export default ChoreDeck;
