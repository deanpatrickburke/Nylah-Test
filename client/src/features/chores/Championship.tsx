// Championship.tsx — Beirt v6 — boutique editorial, no vibe-code generic
// Removes ALL generic emoji pills (👑🏆🔥), emerald LIVE, dashed callouts.
// Editorial: Fraunces numbers, Inter labels lower-case, Pinyon vs, hairline rules,
// linen avatars, single-line summary, ink tracks, receipt hall.
import React from "react";
import { PERSONS } from "../../constants/themes";
import type { PersonKey } from "./choreTypes";

type MonthScores = { a: number; c: number; total: number; pct: number };
type Countdown = { d: number; h: number; m: number; s: number; label: string };
type MetaHist = { key: string; a: number; c: number; winner: PersonKey | null };

export function Championship({
  monthScores,
  countdown,
  metaHistory,
  monthKey,
  isClear,
}: {
  monthScores: MonthScores;
  countdown: Countdown;
  metaHistory: MetaHist[];
  monthKey: string;
  isClear?: boolean;
}) {
  const [reducedMotion, setReducedMotion] = React.useState(false);
  React.useEffect(() => {
    try {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      setReducedMotion(mql.matches);
      const fn = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mql.addEventListener?.("change", fn);
      return () => mql.removeEventListener?.("change", fn);
    } catch {}
  }, []);

  const a = monthScores?.a ?? 0;
  const c = monthScores?.c ?? 0;
  const totalDone = a + c;
  const hasPoints = totalDone > 0;
  const pct = hasPoints ? Math.round((a / totalDone) * 100) : 50;
  const pctC = 100 - pct;
  const aName = (PERSONS as any)?.["aisling"]?.name || "Aisling";
  const cName = (PERSONS as any)?.["ciaran"]?.name || "Ciaran";
  const aInit = (PERSONS as any)?.["aisling"]?.initial || aName.slice(0, 1).toUpperCase();
  const cInit = (PERSONS as any)?.["ciaran"]?.initial || cName.slice(0, 1).toUpperCase();
  const aWinning = hasPoints && a > c;
  const cWinning = hasPoints && c > a;
  const tied = hasPoints && a === c;
  const diff = Math.abs(a - c);

  const streak = React.useMemo(() => {
    if (!metaHistory?.length) return { count: 0, who: null as PersonKey | null, whoName: null as string | null };
    let who = metaHistory[0]?.winner ?? null;
    if (!who) return { count: 0, who: null, whoName: null };
    let cnt = 0;
    for (const h of metaHistory) {
      if (h.winner === who) cnt++;
      else break;
    }
    const whoName = who === "aisling" ? aName : who === "ciaran" ? cName : null;
    return { count: cnt, who, whoName };
  }, [metaHistory, aName, cName]);

  const rawLabel = (countdown?.label || "").trim();
  const cleanLabel = rawLabel.replace(/^resets\s+/i, "").replace(/^reset\s+/i, "").trim();
  const timerLabel = rawLabel.toLowerCase().startsWith("resets") ? rawLabel : rawLabel ? `Resets ${cleanLabel}` : `Resets ${monthKey ? "end" : "1st"} 00:00`;

  const cap = 600;
  const combinedPct = Math.min(100, (totalDone / cap) * 100);
  const toGo = Math.max(0, cap - totalDone);

  return (
    <div
      className="relative overflow-hidden rounded-[24px] bg-[var(--card-bg)]"
      style={{
        border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
        boxShadow: "0 10px 40px rgba(18,18,20,0.06), 0 1px 0 rgba(0,0,0,0.03)",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,400;9..144,1,400;9..144,0,700&family=Pinyon+Script&display=swap');
        @keyframes beirt-dot{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
      `}</style>

      {/* hairline top tint — not a pill bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-[linear-gradient(90deg,transparent,#F7EFE8_24%,#A8D5BA_76%,transparent)] opacity-[0.9]" aria-hidden />

      {/* masthead */}
      <div className="flex items-baseline justify-between px-5 pt-[15px] pb-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <div className="font-['Fraunces'] text-[15.5px] font-[670] tracking-[-0.01em] text-[var(--text)]" style={{ fontVariationSettings: "'opsz' 32" }}>
            {monthKey ? (
              <span className="inline-flex items-baseline gap-1.5">
                <span className="italic font-[400] opacity-[0.9]">{monthKey.split("-")[1] ?? "This"}</span>
                <span className="not-italic">Championship</span>
              </span>
            ) : (
              <span>Championship</span>
            )}
          </div>
          <span className="text-[10.5px] font-[450] text-[var(--muted)] tracking-[0.02em] tabular-nums">{totalDone} plays • {cap} cap</span>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <span className="grid h-[5px] w-[5px] place-items-center">
            <span className="h-[5px] w-[5px] rounded-full bg-[var(--text)]" style={{ animation: reducedMotion ? "none" : "beirt-dot 2.2s ease-in-out infinite" }} />
          </span>
          <span className="font-['Fraunces'] italic tracking-[0.01em]">live</span>
        </div>
      </div>

      {/* score */}
      <div className="px-4 sm:px-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 pt-1">
          {/* A */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <div
                className="grid h-[46px] w-[46px] place-items-center rounded-full text-[13px] font-[700] tracking-[0.02em]"
                style={{
                  background: aWinning ? "#FFFEFB" : "color-mix(in srgb, var(--chip-bg) 92%, transparent)",
                  color: "var(--text)",
                  border: `1px solid ${aWinning ? "#EFE1D2" : "var(--border)"}`,
                  boxShadow: aWinning ? "0 2px 14px rgba(247,239,232,0.55)" : "0 1px 0 rgba(0,0,0,0.02)",
                }}
              >
                {aInit}
              </div>
              {aWinning && <i className="pointer-events-none absolute -top-[9px] left-1/2 -translate-x-1/2 font-['Fraunces'] text-[14px] not-italic font-[700] text-[#C9A98A]">·</i>}
            </div>
            <div className="mt-2 text-[11px] font-[550] tracking-[0.08em] uppercase text-[var(--muted)]">{aName}</div>
            <div className="font-['Fraunces'] mt-[2px] text-[34px] font-[720] leading-none tracking-[-0.02em] tabular-nums text-[var(--text)]">{a}</div>
            <div className="-mt-[1px] h-[2px] w-[22px] rounded-full" style={{ background: aWinning ? "#F7EFE8" : "transparent" }} aria-hidden />
          </div>

          {/* mid */}
          <div className="flex h-full min-w-[72px] flex-col items-center justify-end pb-[10px]">
            {/* vs script — no emoji */}
            <span className="font-['Pinyon_Script'] text-[22px] leading-none text-[var(--muted)] translate-y-[-1px] opacity-[0.9]">vs</span>
            <span className="mt-1.5 font-['Fraunces'] text-[11px] font-[590] tracking-[0.06em] text-[var(--text-secondary)]">
              {tied ? "tied" : !hasPoints ? "—" : aWinning ? `${aInit} ahead` : `${cInit} ahead`}
            </span>
            <span className="mt-0.5 text-[10.5px] tabular-nums text-[var(--muted)]">{pct}–{pctC}</span>
          </div>

          {/* C */}
          <div className="flex flex-col items-center">
            <div className="relative">
              <div
                className="grid h-[46px] w-[46px] place-items-center rounded-full text-[13px] font-[700]"
                style={{
                  background: cWinning ? "#FBFFFE" : "color-mix(in srgb, var(--chip-bg) 92%, transparent)",
                  color: cWinning ? "#0E1A14" : "var(--text)",
                  border: `1px solid ${cWinning ? "#C3DECA" : "var(--border)"}`,
                  boxShadow: cWinning ? "0 2px 14px rgba(168,213,186,0.38)" : "0 1px 0 rgba(0,0,0,0.02)",
                }}
              >
                {cInit}
              </div>
              {cWinning && <i className="pointer-events-none absolute -top-[9px] left-1/2 -translate-x-1/2 font-['Fraunces'] text-[14px] not-italic font-[700] text-[#7FB89A]">·</i>}
            </div>
            <div className="mt-2 text-[11px] font-[550] tracking-[0.08em] uppercase text-[var(--muted)]">{cName}</div>
            <div className="font-['Fraunces'] mt-[2px] text-[34px] font-[720] leading-none tracking-[-0.02em] tabular-nums text-[var(--text)]">{c}</div>
            <div className="-mt-[1px] h-[2px] w-[22px] rounded-full" style={{ background: cWinning ? "#A8D5BA" : "transparent" }} aria-hidden />
          </div>
        </div>

        {/* single line summary — no 3 chips */}
        <div className="mt-4 text-center font-['Fraunces'] text-[12.8px] font-[460] leading-[1.45] tracking-[-0.005em] text-[var(--text-secondary)]">
          {!hasPoints ? (
            <span className="italic text-[var(--muted)]">No claims yet — first play opens the board.</span>
          ) : tied ? (
            <span>Dead tied at {a}. Next claim decides.</span>
          ) : (
            <span>
              <span className="font-[650] text-[var(--text)]">{aWinning ? aName : cName}</span> leads by {diff}
              <span className="mx-1 text-[var(--muted)]">·</span>
              <span className="tabular-nums">{pct}% share</span>
              {streak.count >= 2 && (
                <>
                  <span className="mx-1 text-[var(--muted)]">·</span>
                  <span className="italic">{streak.count} in a row</span>
                </>
              )}
            </span>
          )}
        </div>

        {/* ink tracks — not chunky bars */}
        <div className="mt-4 space-y-[14px]">
          {/* share */}
          <div className="group">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-[550] tracking-[0.06em] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-px w-[12px] bg-[var(--border)]" />
                <span className="uppercase">share</span>
              </span>
              <span className="font-['Fraunces'] text-[10.5px] normal-case tracking-[0] tabular-nums">{a} – {c}</span>
            </div>
            <div className="relative h-px w-full bg-[var(--border)]">
              <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-all" style={{ width: hasPoints ? `${pct}%` : "50%", background: "#F2E2CC" }} />
              <div className="absolute right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full transition-all" style={{ width: hasPoints ? `${pctC}%` : "50%", background: "#A8D5BA", opacity: hasPoints ? 1 : 0.7 }} />
              <div className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border bg-[var(--card-bg)]" style={{ left: hasPoints ? `${pct}%` : "50%", borderColor: "var(--border)" }} />
            </div>
          </div>

          {/* race */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-[550] tracking-[0.06em] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-px w-[12px] bg-[var(--border)]" />
                <span className="uppercase">toward {cap}</span>
              </span>
              <span className="font-['Fraunces'] text-[11px] italic normal-case tracking-[0]">{toGo === 0 ? "capped" : `${toGo} left`}</span>
            </div>
            <div className="relative h-px w-full bg-[var(--border)]">
              <div className="absolute inset-y-0 left-0 h-px w-full bg-[repeating-linear-gradient(90deg,transparent_0_18px,var(--border)_18px_19px)] opacity-60" aria-hidden />
              <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ width: `${combinedPct}%`, background: "#121214", opacity: 0.88 }} />
            </div>
            <div className="mt-1 flex justify-between font-['Fraunces'] text-[9.5px] tabular-nums text-[var(--muted)]/70">
              <span>0</span><span className="opacity-0">•</span><span>300</span><span className="opacity-0">•</span><span>{cap}</span>
            </div>
          </div>
        </div>
      </div>

      {/* timer footer */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t px-5 py-[10px]" style={{ borderColor: "color-mix(in srgb, var(--border) 70%, transparent)" }}>
        <span className="font-['Fraunces'] text-[11.5px] tracking-[0.01em] text-[var(--text-secondary)]">
          <span className="italic">{timerLabel.split(" ")[0]}</span>
          <span className="ml-1 tabular-nums text-[var(--muted)]">
            {String(countdown.d).padStart(2, "0")}d {String(countdown.h).padStart(2, "0")}h {String(countdown.m).padStart(2, "0")}m
          </span>
        </span>
        {isClear ? (
          <span className="font-['Fraunces'] text-[11px] italic text-[#7FB89A]">deck clear — season live</span>
        ) : (
          <span className="text-[11px] text-[var(--muted)]">{totalDone} played</span>
        )}
      </div>

      {/* hall — receipt, not table */}
      {metaHistory?.length ? (
        <div className="border-t px-5 py-3" style={{ borderColor: "color-mix(in srgb, var(--border) 62%, transparent)" }}>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-['Fraunces'] text-[11px] font-[650] tracking-[0.06em] uppercase text-[var(--muted)]">Past seasons</span>
            <span className="text-[10px] text-[var(--muted)] tabular-nums">{metaHistory.length} tallied</span>
          </div>
          <div className="space-y-0">
            {metaHistory.slice(0, 8).map((h: any) => {
              const winA = h.winner === "aisling";
              const winC = h.winner === "ciaran";
              const tiedRow = !winA && !winC;
              const name = winA ? aName : winC ? cName : "Tie";
              const pts = `${h.a ?? 0}–${h.c ?? 0}`;
              return (
                <div key={h.key} className="flex items-baseline justify-between border-b py-[7px] last:border-0" style={{ borderColor: "color-mix(in srgb, var(--border) 48%, transparent)" }}>
                  <span className="font-['Fraunces'] text-[11.5px] tabular-nums tracking-[-0.01em] text-[var(--muted)]">{h.key}</span>
                  <span className="mx-2 flex-1 border-b border-dotted border-[var(--border)] opacity-40" aria-hidden />
                  <span className="font-['Fraunces'] text-[12px] tabular-nums">
                    <span className={tiedRow ? "text-[var(--muted)] italic" : "text-[var(--text-secondary)]"}>{name}</span>
                    <span className="ml-1.5 text-[11px] text-[var(--muted)]">{pts}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default Championship;
