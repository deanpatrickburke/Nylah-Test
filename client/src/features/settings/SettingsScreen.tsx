import { useEffect, useMemo, useState } from "react";
import type { Theme, PersonKey } from "../../types";
import { ThemeSettings } from "./ThemeSettings";
import { HouseholdSettings } from "./HouseholdSettings";
import { BiometricsSettings } from "../auth/BiometricsSettings";
import { getEffectiveRowId, getEffectiveTable, hasSupabaseConfig } from "../../lib/supabase";
import { remoteLoad } from "../../lib/remoteSync";

type Props = {
  theme?: Theme; setTheme?: any; onConfetti?: any;
  choresRaw?: any; calendarRaw?: any; shoppingRaw?: any; notesRaw?: any;
  setChoresRaw?: any; setCalendarRaw?: any; setShoppingRaw?: any; setNotesRaw?: any;
  currentUser?: PersonKey;
};

const SPRING = "cubic-bezier(0.34,1.56,0.64,1)";
const EASE = "cubic-bezier(0.22,1,0.36,1)";

function Card({
  open,
  onToggle,
  eyebrow,
  title,
  meta,
  accent,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  eyebrow: string;
  title: string;
  meta: string;
  accent?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="group w-full rounded-[26px] border bg-[var(--card-bg)] overflow-hidden"
      style={{
        borderColor: "var(--border)",
        boxShadow: open ? "0 10px 30px rgba(18,18,20,0.06)" : "0 4px 16px rgba(18,18,20,0.03)",
        transform: "translateZ(0)",
        transition: `box-shadow 260ms ${EASE}, border-color 200ms ${EASE}`,
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-[14px] min-h-[64px] text-left active:scale-[0.988] transition"
        style={{ transitionTimingFunction: SPRING, transitionDuration: "180ms" }}
      >
        <div className="flex items-center gap-3.5 min-w-0">
          <span
            className="grid h-9 w-9 place-items-center rounded-full border text-[13px] shrink-0"
            style={{
              background: accent || "var(--chip-bg)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            {eyebrow === "appearance" ? "○" : eyebrow === "house" ? "⌂" : eyebrow === "people" ? "◐" : eyebrow === "sync" ? "↗" : "—"}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <div
                className="text-[15.5px] font-semibold tracking-[-0.01em] leading-none"
                style={{ fontFamily: "Fraunces, serif", color: "var(--text)" }}
              >
                {title}
              </div>
            </div>
            <div className="mt-1 text-[11px] leading-[1.25] tracking-[0.02em] text-[var(--muted)] truncate max-w-[220px]">{meta}</div>
          </div>
        </div>
        <span
          className="grid h-7 w-7 place-items-center rounded-full border bg-[var(--chip-bg)] text-[10px] shrink-0"
          style={{
            borderColor: "var(--border)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: `transform 260ms ${EASE}, background 200ms`,
          }}
        >
          ▾
        </span>
      </button>

      <div
        className="grid"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: `grid-template-rows 320ms ${EASE}`,
        }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className="px-4 sm:px-5 pb-5 pt-1"
            style={{
              borderTop: open ? "1px solid var(--border)" : "1px solid transparent",
              background: "color-mix(in srgb, var(--card-bg) 92%, var(--wash-top))",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsScreen(props: any = {}) {
  const { theme, setTheme, onConfetti, choresRaw, calendarRaw, shoppingRaw, notesRaw, setChoresRaw, setCalendarRaw, setShoppingRaw, setNotesRaw, currentUser } = (props as Props) || ({} as any);
  const safeTheme = (theme as any) || { name: "Beige", id: "beige" } as any;
  const safeSetTheme = typeof setTheme === "function" ? setTheme : (() => {}) as any;
  const safeOnConfetti = typeof onConfetti === "function" ? onConfetti : (() => {}) as any;
  const safeCurrentUser = (currentUser || "person_1") as any;
  const safeChores = Array.isArray(choresRaw) ? choresRaw : [];
  const safeCalendar = Array.isArray(calendarRaw) ? calendarRaw : [];
  const safeShopping = Array.isArray(shoppingRaw) ? shoppingRaw : [];
  const safeNotes = Array.isArray(notesRaw) ? notesRaw : [];

  const safeSetChoresRaw = typeof setChoresRaw === "function" ? setChoresRaw : (() => {}) as any;
  const safeSetCalendarRaw = typeof setCalendarRaw === "function" ? setCalendarRaw : (() => {}) as any;
  const safeSetShoppingRaw = typeof setShoppingRaw === "function" ? setShoppingRaw : (() => {}) as any;
  const safeSetNotesRaw = typeof setNotesRaw === "function" ? setNotesRaw : (() => {}) as any;

  // grouped dropdowns — single Settings page
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    appearance: true,
    household: true,
    people: false,
    sync: true,
    advanced: false,
  }));
  const toggle = (k: string) => setOpenGroups((p) => ({ ...p, [k]: !p[k] }));

  const displayTheme = safeTheme;

  // --- diagnostic state kept but boutique-hidden ---
  const [lsHouseId, setLsHouseId] = useState<string>("–");
  const [lsHouseCode, setLsHouseCode] = useState<string>("–");
  const [inviteCode, setInviteCode] = useState<string>("–");
  const [rev, setRev] = useState<string>("–");
  const [lastSync, setLastSync] = useState<string>("–");
  const [lastConfirmed, setLastConfirmed] = useState<string>("–");
  const [lastMut, setLastMut] = useState<string>("–");
  const [hadRemote, setHadRemote] = useState<string>("–");
  const [pushErr, setPushErr] = useState<string>("–");
  const [queueLen, setQueueLen] = useState<number>(0);
  const [online, setOnline] = useState<boolean>(true);
  const [anonPresent, setAnonPresent] = useState<string>("unknown");
  const [build, setBuild] = useState<string>("v146-boutique");
  const [effId, setEffId] = useState<string>(() => {
    try {
      return localStorage.getItem("couple_v1_household_id") || "–";
    } catch {
      return "–";
    }
  });
  const [isPulling, setIsPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [remoteCounts, setRemoteCounts] = useState<{ c: number; cal: number; s: number; n: number } | null>(null);
  const [householdName, setHouseholdName] = useState<string>("Our house");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    try { setLsHouseId(localStorage.getItem("couple_v1_household_id") || "–"); } catch {}
    try { setLsHouseCode(localStorage.getItem("couple_v1_household_code") || "–"); } catch {}
    try { setInviteCode(localStorage.getItem("couple_v1_household_code") || localStorage.getItem("couple_v1_household_invite") || localStorage.getItem("couple_v1_household_invite_code") || "–"); } catch {}
    try { setRev(localStorage.getItem("couple_v1_revision") || localStorage.getItem("couple_v1_rev") || "0"); } catch {}
    try { setLastSync(localStorage.getItem("couple_v1_last_sync") || "–"); } catch {}
    try { setLastConfirmed(localStorage.getItem("couple_v1_last_confirmed_at") || "–"); } catch {}
    try { setLastMut(localStorage.getItem("couple_v1_last_mutation") || "–"); } catch {}
    try { setHadRemote(localStorage.getItem("couple_v1_had_remote") || "–"); } catch {}
    try { setPushErr(localStorage.getItem("couple_v1_last_push_err") || "–"); } catch {}
    try { const raw = localStorage.getItem("couple_v1_offline_queue"); if (raw) { const q = JSON.parse(raw); if (Array.isArray(q)) setQueueLen(q.length); } } catch {}
    try { const raw2 = localStorage.getItem("couple_v1_queue_count"); if (raw2) { const n = Number(raw2); if (!isNaN(n) && n > queueLen) setQueueLen(n); } } catch {}
    try { setOnline(typeof navigator !== "undefined" ? navigator.onLine !== false : true); } catch {}
    try {
      let found = false; let tail = "????";
      const w: any = typeof window !== "undefined" ? (window as any) : null;
      const cand = w?.__SUPABASE_ANON__ || w?.__SUPABASE_ANON_KEY__;
      if (cand) { found = true; tail = String(cand).slice(-4); }
      else {
        // @ts-ignore
        const envK = (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY;
        if (envK) { found = true; tail = String(envK).slice(-4); }
        else if (hasSupabaseConfig()) { found = true; tail = "hard"; }
      }
      setAnonPresent(found ? `eyJ…${tail}` : "no");
    } catch { setAnonPresent("err"); }
    try { const nid = getEffectiveRowId(); if (nid) setEffId(nid); } catch {}
    try {
      const v = (localStorage.getItem("couple_v1_build") || (window as any).__NYLAH_VERSION__ || "v146-boutique");
      setBuild(String(v).slice(0, 24));
    } catch {}
    try { setHouseholdName(localStorage.getItem("couple_v1_household_name") || "Our house"); } catch {}
    const onOnline = () => setOnline(true); const onOffline = () => setOnline(false);
    try { window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline); } catch {}
    return () => { try { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); } catch {} };
  }, []);

  async function doForcePull() {
    if (isPulling) return;
    setIsPulling(true); setPullMsg("pulling…");
    try {
      const data: any = await remoteLoad();
      if (!data) { setPullMsg("no remote — offline or empty"); setTimeout(() => setPullMsg(null), 3000); return; }
      try {
        if (Array.isArray(data.chores) && data.chores.length > 0) safeSetChoresRaw(data.chores);
        if (Array.isArray(data.calendar) && data.calendar.length > 0) safeSetCalendarRaw(data.calendar);
        if (Array.isArray(data.shopping) && data.shopping.length > 0) safeSetShoppingRaw(data.shopping);
        if (Array.isArray(data.notes) && data.notes.length > 0) safeSetNotesRaw(data.notes);
        setRemoteCounts({ c: data.chores?.length || 0, cal: data.calendar?.length || 0, s: data.shopping?.length || 0, n: data.notes?.length || 0 });
      } catch (e: any) { setPullMsg("merge " + (e?.message || e)); }
      setPullMsg(`pulled • ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} • c:${data.chores?.length||0} cal:${data.calendar?.length||0}`);
      try { localStorage.setItem("couple_v1_last_sync", data.updated_at || new Date().toISOString()); } catch {}
      setTimeout(() => setPullMsg(null), 4000);
    } catch (e: any) { setPullMsg(String(e?.message || e).slice(0, 80)); setTimeout(() => setPullMsg(null), 4000); }
    finally { setIsPulling(false); }
  }

  function doSwitchDebug(target: string) {
    try {
      if (!confirm(`Switch to ${target}?`)) return;
      localStorage.setItem("couple_v1_household_id", target);
      location.reload();
    } catch {}
  }

  function doExportLocal() {
    try {
      const dump = { house: effId, currentUser: safeCurrentUser, counts: { c: safeChores.length, cal: safeCalendar.length, s: safeShopping.length, n: safeNotes.length }, rev, lastSync, lastConfirmed, build, ts: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `beirt-${effId}-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { alert("export " + String(e?.message || e)); }
  }

  const showEmptyWarning = useMemo(() => {
    const localEmpty = (safeChores.length + safeCalendar.length + safeShopping.length + safeNotes.length) === 0;
    const effIsTest = effId === "nylah-98jylh" || effId === "nylah-fbkf2m" || (effId && typeof effId.startsWith === "function" && effId.startsWith("nylah-"));
    if (localEmpty && effIsTest) return `You're on ${effId} · start here`;
    if (localEmpty) return "Local empty — pull from server";
    return null;
  }, [safeChores.length, safeCalendar.length, safeShopping.length, safeNotes.length, effId]);

  async function doCopy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); } catch {
      try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } catch {}
    }
    setCopied(key); setTimeout(() => setCopied(null), 1300);
  }

  // trusted saved time Europe/Dublin
  const savedLabel = useMemo(() => {
    if (lastSync === "–" || !lastSync) return "not yet";
    try {
      const d = new Date(lastSync);
      return d.toLocaleString("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
    } catch { return "–"; }
  }, [lastSync]);

  return (
    <div className="w-full min-h-[100vh] bg-[var(--wash-top)] text-[var(--text)]">
      {/* boutique masthead — full-bleed 390→100vw, no side margins */}
      <div className="w-full px-5 pt-7 pb-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.16em] font-semibold text-[var(--muted)]" style={{ fontFamily: "Inter, ui-sans-system" }}>Settings</div>
            <h1 className="mt-1 text-[34px] leading-[0.92] tracking-[-0.02em] font-[700]" style={{ fontFamily: "Fraunces, serif" }}>
              {householdName}
            </h1>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border bg-[var(--card-bg)] px-3 py-1 text-[11px]" style={{ borderColor: "var(--border)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: online ? "#16A34A" : "#F59E0B" }} />
              <span className="text-[var(--muted)]">{online ? "online" : "offline"} • {savedLabel} saved</span>
              {queueLen > 0 && <span className="rounded-full bg-[#FF6B26] px-1.5 py-0.5 text-[10px] text-white">{queueLen}</span>}
            </div>
          </div>
          <div className="shrink-0 grid h-10 w-10 place-items-center rounded-full border bg-[var(--chip-bg)] text-[11px] font-mono" style={{ borderColor: "var(--border)" }}>
            {String(build).slice(0,3)}
          </div>
        </div>
      </div>

      {/* cards — 100vw edge-to-edge with 16px side gutters on mobile, single spring accordion */}
      <div className="w-full px-3 sm:px-4 pb-[120px] space-y-3">
        {/* Appearance */}
        <Card
          open={!!openGroups.appearance}
          onToggle={() => toggle("appearance")}
          eyebrow="appearance"
          title="Appearance"
          meta={`${displayTheme?.name||"Beige"} · warm pastel • charcoal Hume`}
          accent="color-mix(in srgb, #F7EFE8 70%, #FF6B26)"
        >
          <div className="pt-3">
            <div className="rounded-[18px] border bg-[var(--card-bg)] p-3" style={{ borderColor: "var(--border)" }}>
              <ThemeSettings theme={displayTheme} setTheme={safeSetTheme} onConfetti={safeOnConfetti} />
            </div>
            <div className="mt-2 text-[10.5px] text-[var(--muted)]">Mellow light, polished dark. Both use the same tokens — no hard white.</div>
          </div>
        </Card>

        {/* Household */}
        <Card
          open={!!openGroups.household}
          onToggle={() => toggle("household")}
          eyebrow="house"
          title="Your house"
          meta={`${(effId||"–").slice(0,16)} • invite ${(inviteCode||"–").slice(0,6)} • Europe/Dublin`}
        >
          <div className="pt-2 space-y-3">
            {/* invite heroic */}
            <div className="rounded-[18px] border bg-[var(--chip-bg)] p-3.5" style={{ borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)]">Invite code</div>
                  <div className="mt-1 font-mono text-[18px] font-[700] tracking-[0.08em]" style={{ letterSpacing: "0.08em" }}>
                    {(inviteCode !== "–" ? inviteCode : lsHouseCode || "—").toString().toUpperCase()}
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">private · just you two · any phone can join</div>
                </div>
                <button
                  onClick={() => doCopy((inviteCode !== "–" ? inviteCode : lsHouseCode) || effId, "invite")}
                  className="shrink-0 h-[40px] min-h-[40px] rounded-full border bg-[var(--card-bg)] px-3.5 text-[11px] font-semibold active:scale-[0.98]"
                  style={{ borderColor: "var(--border)", transitionTimingFunction: SPRING }}
                >
                  {copied === "invite" ? "copied ✓" : "copy"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const code = (inviteCode !== "–" ? inviteCode : lsHouseCode) || "";
                    if (!code) return;
                    const link = `${location.origin}${location.pathname}?code=${code.toUpperCase()}`;
                    doCopy(link, "link");
                  }}
                  className="h-[36px] rounded-full border bg-[var(--card-bg)] px-3 text-[11px]"
                  style={{ borderColor: "var(--border)" }}
                >
                  {copied === "link" ? "link copied" : "share link"}
                </button>
                <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>
                  Europe/Dublin
                </span>
              </div>
            </div>

            <HouseholdSettings currentUser={safeCurrentUser} />

            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <button
                onClick={() => doCopy(effId, "house")}
                className="h-[40px] rounded-full border bg-[var(--card-bg)] px-3 text-left truncate"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="text-[var(--muted)]">house · </span>
                <span className="font-mono">{ (effId||"–").slice(0,14) }</span>
                {copied === "house" && <span className="ml-2 text-[10px] text-[#16A34A]">copied</span>}
              </button>
              <div className="h-[40px] rounded-full border bg-[var(--chip-bg)] px-3 grid place-items-center text-[11px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>
                {safeChores.length + safeCalendar.length + safeShopping.length + safeNotes.length} local items
              </div>
            </div>
          </div>
        </Card>

        {/* People & unlock */}
        <Card open={!!openGroups.people} onToggle={() => toggle("people")} eyebrow="people" title="People & unlock" meta={`Face ID · ${safeCurrentUser} · 44px spring`}>
          <div className="pt-2">
            <BiometricsSettings currentUser={safeCurrentUser} />
            <div className="mt-3 rounded-[14px] border bg-[var(--chip-bg)] px-3 py-2.5 text-[11px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>
              PIN stays local UI — server checks via RPC. No anon rw.
            </div>
          </div>
        </Card>

        {/* Data & sync — boutique not dashboard */}
        <Card
          open={!!openGroups.sync}
          onToggle={() => toggle("sync")}
          eyebrow="sync"
          title="Data & sync"
          meta={`c:${safeChores.length} cal:${safeCalendar.length} s:${safeShopping.length} n:${safeNotes.length} • ${online?"online":"offline"} • ${queueLen?"queued":"saved"}`}
        >
          <div className="pt-2 space-y-3">
            {showEmptyWarning && (
              <div className="rounded-[14px] border bg-[#FEF3C7] border-[#FDE68A] px-3 py-2.5 text-[11.5px] text-[#92400E] leading-[1.35]">⚠︎ {showEmptyWarning}</div>
            )}

            {pullMsg && <div className="rounded-full border bg-[var(--card-bg)] px-3 py-2 text-[11px] text-[var(--muted)]" style={{ borderColor: "var(--border)" }}>{pullMsg}</div>}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[16px] border bg-[var(--card-bg)] px-3 py-3" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">saved (Dublin)</div>
                <div className="mt-1 text-[12.5px] font-medium">{savedLabel}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">confirmed {lastConfirmed==="–"?"—":new Date(lastConfirmed).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</div>
              </div>
              <div className="rounded-[16px] border bg-[var(--card-bg)] px-3 py-3" style={{ borderColor: "var(--border)" }}>
                <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">connection</div>
                <div className="mt-1 flex items-center gap-2 text-[12px]"><span className="h-2 w-2 rounded-full" style={{ background: online?"#16A34A":"#F59E0B"}} />{online?"online ✓":"offline ✗"} · {anonPresent}</div>
                <div className="mt-1 text-[10px] text-[var(--muted)]">build {String(build).slice(0,12)} · rev {String(rev).slice(0,8)}</div>
              </div>
            </div>

            <div className="rounded-[16px] border bg-[var(--chip-bg)] px-3 py-2.5 text-[10.5px] font-mono leading-[1.35]" style={{ borderColor: "var(--border)" }}>
              <div className="flex flex-wrap gap-x-3"><span>local c:{safeChores.length} cal:{safeCalendar.length} s:{safeShopping.length} n:{safeNotes.length}</span><span>queue {queueLen}</span></div>
              {remoteCounts && <div className="mt-1">remote c:{remoteCounts.c} cal:{remoteCounts.cal} s:{remoteCounts.s} n:{remoteCounts.n}</div>}
              <div className="mt-1 truncate text-[var(--muted)]">err {String(pushErr).slice(0,120) || "—"}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={doForcePull}
                disabled={isPulling}
                className="h-[44px] rounded-full bg-[#121214] text-white text-[12.5px] font-semibold active:scale-[0.98] disabled:opacity-60"
                style={{ transitionTimingFunction: SPRING }}
              >
                {isPulling ? "Pulling…" : "Force pull"}
              </button>
              <button onClick={doExportLocal} className="h-[44px] rounded-full border bg-[var(--card-bg)] text-[12px] font-medium" style={{ borderColor: "var(--border)" }}>
                Export debug
              </button>
            </div>

            <div className="text-[10px] text-[var(--muted)]">Each code is isolated. No giant JSON row.</div>
          </div>
        </Card>

        {/* Advanced */}
        <Card open={!!openGroups.advanced} onToggle={() => toggle("advanced")} eyebrow="advanced" title="Advanced" meta={`${build} • Europe/Dublin`}>
          <div className="pt-2 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={()=>{ try{ if('serviceWorker' in navigator){ navigator.serviceWorker.getRegistrations().then(rs=>{ rs.forEach(r=> r.unregister()); alert("SW clear "+rs.length);}); } else alert("no SW"); }catch(e:any){ alert(String(e?.message||e)); } }} className="h-[44px] rounded-full border bg-[var(--card-bg)] text-[11px]">Clear SW</button>
              <button onClick={async()=>{ try{ const dbs=await (indexedDB as any).databases?.(); if(Array.isArray(dbs)){ for(const db of dbs){ if(db.name) indexedDB.deleteDatabase(db.name); } alert("IDB purged "+dbs.length);} else { const req=indexedDB.deleteDatabase("couple_v1_idb"); (req as any).onsuccess=()=> alert("IDB purged"); } }catch(e:any){ alert(String(e?.message||e)); } }} className="h-[44px] rounded-full border bg-[#FEF2F2] text-[#B91C1C] text-[11px]">Purge IDB</button>
              <button onClick={()=>{ localStorage.setItem("couple_v1_force_resync", String(Date.now())); alert("force resync set — reload"); location.reload(); }} className="h-[40px] rounded-full border bg-[var(--chip-bg)] text-[11px]">Flag resync</button>
              <button onClick={()=>{ try{ localStorage.clear(); sessionStorage.clear(); alert("local cleared"); location.reload(); }catch{}}} className="h-[40px] rounded-full bg-[#121214] text-white text-[11px]">Nuke local</button>
              <button onClick={()=> doSwitchDebug("nylah-98jylh")} className="h-[40px] rounded-full border bg-[#FFFbeb] text-[11px]">→ nylah-98jylh</button>
              <button onClick={()=> doSwitchDebug("nylah-fbkf2m")} className="h-[40px] rounded-full border bg-[#FFFbeb] text-[11px]">→ nylah-fbkf2m</button>
            </div>

            <div className="rounded-[16px] border bg-[var(--card-bg)] p-3" style={{ borderColor: "var(--border)" }}>
              <div className="text-[11px] font-semibold">Health</div>
              <div className="mt-1 text-[10.5px] font-mono leading-[1.35] text-[var(--muted)]">
                <div>house { (effId||"–").slice(0,14) } • {online ? "online" : "offline"} • {anonPresent}</div>
                <div>local c:{safeChores.length} cal:{safeCalendar.length} s:{safeShopping.length} n:{safeNotes.length} • queue {queueLen}</div>
                {remoteCounts && <div>remote c:{remoteCounts.c} cal:{remoteCounts.cal} s:{remoteCounts.s} n:{remoteCounts.n}</div>}
                <div className="truncate">err {String(pushErr).slice(0,90) || "—"}</div>
              </div>
            </div>

            <div className="text-[10px] text-[var(--muted)]">Scalable households — each code isolated. No hard-coded main house.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
export default SettingsScreen;
