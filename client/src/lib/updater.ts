// client/src/lib/updater.ts
// V11 mega pazaz: 5min polling, code/build support, network-first
// Simplified: no blob download, just refresh
// Goal: compare remote version.json vs localStorage version, prompt refresh to update.
// Keeps APK light, primary updates via GitHub Pages / Netlify wrapper.
// Built for GitHub Pages / Netlify hosting.

export const UPDATE_CHECK_URL = "/version.json";
export const SUPABASE_FALLBACK_VERSION_URL = "https://nylah-os.netlify.app/version.json";

export const LOCAL_VERSION_KEY = "couple_v1_app_version";
export const LOCAL_CODE_KEY = "couple_v1_app_code";
const LAST_CHECK_KEY = "couple_v1_last_update_check";
const ROLLBACK_VERSION_KEY = "couple_v1_rollback_version";

export const REMOTE_VERSION_URL = (() => {
  try {
    // @ts-ignore vite env
    const v = (import.meta as any).env?.VITE_VERSION_URL;
    if (v && typeof v === "string" && v.startsWith("http")) return v as string;
  } catch {}
  try {
    const ls = localStorage.getItem("couple_v1_version_url");
    if (ls) {
      try {
        const parsed = JSON.parse(ls);
        if (typeof parsed === "string" && parsed.startsWith("http")) return parsed;
      } catch {
        if (ls.startsWith("http")) return ls;
      }
    }
  } catch {}
  return "/version.json";
})();

export type RemoteVersion = {
  version: string;
  changelog?: string;
  releaseNotes?: string;
  notes?: string;
  apkUrl?: string;
  bundleUrl?: string;
  mandatory?: boolean;
  minWebVersion?: string;
  minVersion?: string;
  publishedAt?: string;
  builtAt?: string;
  timestamp?: string;
  code?: number;
  build?: string | number;
  buildNumber?: number;
};

export function getCurrentVersion(): string {
  try {
    // @ts-ignore vite define
    const built = (import.meta as any).env?.VITE_APP_VERSION as string | undefined;
    if (built) return built;
  } catch {}
  try {
    const saved = localStorage.getItem(LOCAL_VERSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed === "string") return parsed;
        return saved;
      } catch {
        return saved;
      }
    }
  } catch {}
  return "1.0.0";
}

export function getCurrentCode(): number {
  try {
    // @ts-ignore vite define - numeric code for V11
    const viteCode = (import.meta as any).env?.VITE_APP_CODE;
    if (viteCode != null) {
      const n = Number(viteCode);
      if (!isNaN(n)) return n;
    }
  } catch {}
  try {
    const saved = localStorage.getItem(LOCAL_CODE_KEY);
    if (saved) {
      const n = Number(JSON.parse(saved));
      if (!isNaN(n)) return n;
      const n2 = Number(saved);
      if (!isNaN(n2)) return n2;
    }
  } catch {}
  // Derive from version string fallback: v10 -> code 10
  try {
    const ver = getCurrentVersion();
    const m = ver.match(/v(\d+)|code[:\- ]?(\d+)/i);
    if (m) {
      const num = Number(m[1] || m[2]);
      if (!isNaN(num)) return num;
    }
  } catch {}
  return 10; // V10 baseline
}

export function setCurrentVersion(v: string) {
  try {
    localStorage.setItem(LOCAL_VERSION_KEY, JSON.stringify(v));
  } catch {
    try {
      localStorage.setItem(LOCAL_VERSION_KEY, v);
    } catch {}
  }
}

export function setCurrentCode(code: number) {
  try {
    localStorage.setItem(LOCAL_CODE_KEY, JSON.stringify(code));
  } catch {
    try { localStorage.setItem(LOCAL_CODE_KEY, String(code)); } catch {}
  }
}

export function setVersion(version: string) {
  setCurrentVersion(version);
}

function parseSemver(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

export function isNewer(remote: string, local: string): boolean {
  const r = parseSemver(remote);
  const l = parseSemver(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0;
    const b = l[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

export function isNewerCode(remoteCode: number | undefined, localCode: number): boolean {
  if (remoteCode == null) return false;
  const r = Number(remoteCode);
  if (isNaN(r)) return false;
  return r > localCode;
}

function getRemoteCode(remote: RemoteVersion): number | undefined {
  if (remote.code != null) return Number(remote.code);
  if ((remote as any).buildNumber != null) return Number((remote as any).buildNumber);
  if (remote.build != null) {
    const n = Number(remote.build);
    if (!isNaN(n)) return n;
    // build string like "2026-08-04-v11-..." -> try extract vNN
    const m = String(remote.build).match(/v(\d+)/i);
    if (m) return Number(m[1]);
  }
  return undefined;
}

function semverCompare(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function isCapacitorNative(): boolean {
  try {
    // @ts-ignore
    if ((window as any).Capacitor?.isNativePlatform) return (window as any).Capacitor.isNativePlatform();
  } catch {}
  try {
    return document.URL.startsWith("capacitor://") || document.URL.startsWith("https://__cap") || (navigator as any).userAgent?.includes("Capacitor");
  } catch {
    return false;
  }
}

export function isWebWrapperStrategy(): boolean {
  try {
    const host = window.location.hostname;
    return host.includes("netlify.app") || host.includes("nylah-os") || host.includes("vercel") || host.includes("github.io");
  } catch {
    return false;
  }
}

/**
 * V11 checkForUpdate
 * Adds code/build numeric support, network-first fetch with cache: no-cache
 * Tries candidates: ./version.json, /version.json, REMOTE_VERSION_URL, fallback Netlify
 */
export async function checkForUpdate(): Promise<{ available: boolean; remote: RemoteVersion | null; local: string; localCode: number; error?: string }> {
  const local = getCurrentVersion();
  const localCode = getCurrentCode();
  const candidates: string[] = [];

  // relative first — works on GH Pages subpath
  candidates.push("./version.json");
  candidates.push("/version.json");
  if (REMOTE_VERSION_URL && !candidates.includes(REMOTE_VERSION_URL)) candidates.push(REMOTE_VERSION_URL);
  if (!candidates.includes(SUPABASE_FALLBACK_VERSION_URL)) candidates.push(SUPABASE_FALLBACK_VERSION_URL);
  // extra netlify explicit for redundancy
  if (!candidates.includes("https://nylah-os.netlify.app/version.json")) candidates.push("https://nylah-os.netlify.app/version.json");

  // dedupe preserve order
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    uniq.push(c);
  }

  for (const cUrl of uniq) {
    try {
      const url = `${cUrl}${cUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        cache: "no-store" as any,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as RemoteVersion;
      if (!json?.version) continue;
      try {
        localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
      } catch {}
      const remoteCode = getRemoteCode(json);
      const codeNewer = isNewerCode(remoteCode, localCode);
      const verCmp = semverCompare(json.version, local);
      const verNewer = verCmp > 0;
      const available = codeNewer || verNewer;
      try { console.log(`[updater] check ${cUrl} local ${local}(${localCode}) remote ${json.version}(${remoteCode}) avail ${available}`); } catch {}
      return { available, remote: json, local, localCode };
    } catch {
      continue;
    }
  }

  return { available: false, remote: null, local, localCode };
}

// Simplified install / apply — just set version and reload with cache bust

export async function promptInstall(remote: RemoteVersion | null): Promise<void> {
  if (!remote?.version) return;
  try {
    setCurrentVersion(remote.version);
    const rc = getRemoteCode(remote);
    if (rc != null) setCurrentCode(rc);
  } catch {}
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("_uv", remote.version);
    url.searchParams.set("_t", Date.now().toString());
    window.location.replace(url.toString());
  } catch {
    try {
      window.location.reload();
    } catch {}
  }
}

export async function applyUpdate(remote: RemoteVersion): Promise<boolean> {
  try {
    await promptInstall(remote);
    return true;
  } catch (e) {
    console.warn("[updater] apply failed", e);
    return false;
  }
}

export function rollback(): string | null {
  try {
    const rb = localStorage.getItem(ROLLBACK_VERSION_KEY);
    if (rb) {
      localStorage.setItem(LOCAL_VERSION_KEY, rb);
      return rb;
    }
    return null;
  } catch {
    return null;
  }
}
