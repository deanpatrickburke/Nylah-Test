import { useEffect, useState, useRef } from "react";
import { checkForUpdate, getCurrentVersion, getCurrentCode, setCurrentVersion, setCurrentCode, isNewer, isNewerCode, UPDATE_CHECK_URL, type RemoteVersion } from "../lib/updater";

/**
 * UpdaterBanner — V11 mega pazaz
 * Simplified: No blob download, no Filesystem hot-swap.
 * Compares remote version.json vs local version/code, shows "New version available — refresh to update"
 * Checks every 5min when online + on visibilitychange/focus/online.
 * Supports both semver and numeric code/build as task requires.
 */
export function UpdaterBanner({ className = "" }: { className?: string }) {
  const [remote, setRemote] = useState<RemoteVersion | null>(null);
  const [local, setLocal] = useState<string>(() => getCurrentVersion());
  const [localCode, setLocalCode] = useState<number>(() => getCurrentCode());
  const [show, setShow] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const runCheck = async () => {
    // Only check when online - V11 requirement
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine) return;
    } catch {}
    try {
      const res = await checkForUpdate();
      setLocal(res.local);
      setLocalCode(res.localCode);
      const remoteCandidate = res.remote;
      if (!remoteCandidate) {
        // try direct fetch fallback explicitly with cache-bust for GH Pages / network-first
        try {
          const bust = Date.now();
          const tryUrl = `${UPDATE_CHECK_URL}?t=${bust}`;
          const r = await fetch(tryUrl, { cache: "no-store" as any, headers: { "Cache-Control": "no-cache" } as any });
          if (r.ok) {
            const j = (await r.json()) as RemoteVersion;
            const remoteCode = (j as any).code ?? (j as any).buildNumber ?? Number(j.build);
            if (j?.version) {
              const codeNewer = remoteCode != null && isNewerCode(Number(remoteCode), res.localCode);
              const verNewer = isNewer(j.version, res.local);
              if (codeNewer || verNewer) {
                setRemote(j);
                setShow(true);
                // dispatch event for App.tsx auto-update handler to optionally sync
                try { window.dispatchEvent(new CustomEvent('couple-update-available', { detail: j })); } catch {}
                return;
              }
            }
          }
        } catch {}
        setShow(false);
        setRemote(null);
        return;
      }

      // primary: code/build numeric first, then semver - as per task spec
      const remoteCode = (remoteCandidate as any).code ?? (remoteCandidate as any).buildNumber ?? (remoteCandidate.build != null ? Number(remoteCandidate.build) : undefined);
      const codeNewer = remoteCode != null && !isNaN(Number(remoteCode)) && isNewerCode(Number(remoteCode), res.localCode);
      const verNewer = isNewer(remoteCandidate.version, res.local);
      if (codeNewer || verNewer || res.available) {
        setRemote(remoteCandidate);
        setShow(true);
        try { window.dispatchEvent(new CustomEvent('couple-update-available', { detail: remoteCandidate })); } catch {}
        try { window.dispatchEvent(new CustomEvent('couple-sync', { detail: 'update-available' })); } catch {}
      } else {
        setShow(false);
        setRemote(null);
      }
    } catch (e) {
      console.warn("[UpdaterBanner] check failed", e);
    }
  };

  useEffect(() => {
    runCheck();
    // V11: every 5 min, paused when tab hidden + reduced-motion
        const prefersReduced = (()=>{ try{ return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }catch{return false} })();
    if(prefersReduced){ /* no polling when reduced motion */ }
    else { intervalRef.current = window.setInterval(()=>{ if(document.hidden) return; runCheck(); }, 5 * 60 * 1000); }
    const onVis = () => {
      if (document.visibilityState === "visible") runCheck();
    };
    const onFocus = () => runCheck();
    const onOnline = () => runCheck();
    const onUpdateAvailable = () => runCheck();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("couple-update-available" as any, onUpdateAvailable as any);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus as any);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("couple-update-available" as any, onUpdateAvailable as any);
    };
  }, []);

  if (!show || !remote) return null;

  const mandatory = remote.mandatory;
  const remoteCodeStr = (remote as any).code != null ? ` code:${(remote as any).code}` : remote.build != null ? ` build:${remote.build}` : "";

  return (
    <div className={`inline-flex items-center gap-2 ${className}`} style={{ animation: "fadeIn 180ms ease-out" }}>
      <button
        onClick={() => {
          try {
            setCurrentVersion(remote.version);
            if ((remote as any).code != null) setCurrentCode(Number((remote as any).code));
            else if (remote.build != null && !isNaN(Number(remote.build))) setCurrentCode(Number(remote.build));
          } catch {}
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("_uv", remote.version);
            url.searchParams.set("_t", Date.now().toString());
            window.location.replace(url.toString());
          } catch {
            window.location.reload();
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#0A0A0A] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-[0_2px_8px_rgba(0,0,0,0.14)] active:scale-[0.97] transition-transform"
        title={remote.changelog || remote.releaseNotes || remote.notes || ""}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[#FACC15] animate-pulse inline-block" />
        New version available — refresh to update {local} → {remote.version}{remoteCodeStr ? ` (${localCode}→${(remote as any).code ?? remote.build})` : ""}
      </button>
      {!mandatory && (
        <button
          onClick={() => setShow(false)}
          className="grid h-6 w-6 place-items-center rounded-full bg-white border text-[11px] text-[#5A5655] hover:bg-[#F7EFE8] active:scale-95"
          style={{ borderColor: "#E8CEB7" }}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Inline pill variant for top bar near sync dot (compact) — V11 simplified with code support
export function UpdaterPill({ className = "" }: { className?: string }) {
  const [remote, setRemote] = useState<RemoteVersion | null>(null);
  const [local, setLocal] = useState<string>(() => getCurrentVersion());
  const [localCode, setLocalCode] = useState<number>(() => getCurrentCode());
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const doCheck = async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      } catch {}
      try {
        const res = await checkForUpdate();
        if (cancelled) return;
        setLocal(res.local);
        setLocalCode(res.localCode);
        const rc = res.remote;
        if (rc) {
          const rcCode = (rc as any).code ?? (rc as any).buildNumber ?? (rc.build != null ? Number(rc.build) : undefined);
          const codeNewer = rcCode != null && isNewerCode(Number(rcCode), res.localCode);
          const verNewer = isNewer(rc.version, res.local);
          if (res.available || codeNewer || verNewer) {
            setRemote(rc);
            setShow(true);
            return;
          }
        }
        if (res.available && res.remote) {
          setRemote(res.remote);
          setShow(true);
        } else if (res.remote && isNewer(res.remote.version, res.local)) {
          setRemote(res.remote);
          setShow(true);
        }
      } catch {}
    };
    doCheck();
    const id = window.setInterval(()=>{ if(document.hidden) return; doCheck(); }, 5 * 60 * 1000);
    const onVis = () => { if (document.visibilityState === "visible") doCheck(); };
    const onFocus = () => doCheck();
    const onOnline = () => doCheck();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus as any);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!show || !remote) return null;

  return (
    <button
      onClick={() => {
        try { setCurrentVersion(remote.version); if ((remote as any).code != null) setCurrentCode(Number((remote as any).code)); } catch {}
        try {
          const url = new URL(window.location.href);
          url.searchParams.set("_uv", remote.version);
          url.searchParams.set("_t", Date.now().toString());
          window.location.replace(url.toString());
        } catch {
          window.location.reload();
        }
      }}
      className={`inline-flex items-center gap-1 rounded-full bg-[#0A0A0A] px-2.5 py-1 text-[11px] font-medium text-white ${className}`}
    >
      <span className="h-1 w-1 rounded-full bg-[#FACC15] animate-pulse inline-block" />
      {local} → {remote.version}{(remote as any).code != null && (remote as any).code !== localCode ? ` c${(remote as any).code}` : ""}
    </button>
  );
}

export default UpdaterBanner;
