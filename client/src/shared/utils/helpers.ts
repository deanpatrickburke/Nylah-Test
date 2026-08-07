// Pure helpers extracted from App.tsx — zero logic change, Europe/Dublin canonical
// Keep exact implementations from monolith to preserve scoring, TZ, recurrence.

export function uid(p = "id") { return p + "_" + Math.random().toString(36).slice(2, 7) + "_" + Date.now().toString(36); }

export function hashId(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff; return h; }

export function rotForId(id: string) {
  const r = hashId(id) % 5;
  const map = [-2, -1, 1, 2, 3];
  return map[r] as number;
}

export function relTime(iso: string, nowMs: number) {
  const t = new Date(iso).getTime(); const diff = nowMs - t;
  if (diff < 60000) return "just now";
  const mins = Math.floor(diff / 60000); if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60); if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24); if (days < 7) return days + "d ago";
  return new Date(t).toLocaleDateString();
}

// TZ helpers — canonical Europe/Dublin, same as lib/dates but kept here for fast edits
export const HOUSEHOLD_TZ = "Europe/Dublin" as const;

export { todayKey, toLocalKey as toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";

export function getDueMsChore(c: any): number {
  // Mirrors App.tsx original (uses windowHoursForChore)
  function windowHoursForChoreLocal(x: any): number {
    if (x.timeWindowHours) return x.timeWindowHours;
    if (x.type === "one-off" || x.frequency === "once") return 24;
    if (x.frequency === "daily") return 24;
    if (x.frequency === "twice-week") return 84;
    if (x.frequency === "weekly") return 168;
    if (x.frequency === "biweekly") return 336;
    if (x.frequency === "monthly") return 720;
    if (x.frequency === "custom") return 168;
    return 168;
  }
  if (c.dueAt) return new Date(c.dueAt).getTime();
  return new Date(c.createdAt).getTime() + windowHoursForChoreLocal(c) * 3600 * 1000;
}

export function fmtTimeDublin(iso: string, tz: string) {
  try { return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit', timeZone: tz}).format(new Date(iso)) } catch { try{ return new Date(iso).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) }catch{ return "" } }
}

// Simplified small variants kept for sub-components that used simplified helpers (no behavior change for those call sites)
export function relTimeShort(iso: string, nowMs: number) {
  try {
    const diff = nowMs - new Date(iso).getTime();
    const sec = Math.floor(diff/1000);
    if (sec < 60) return "now";
    const min = Math.floor(sec/60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min/60);
    if (hr < 24) return `${hr}h`;
    const d = Math.floor(hr/24);
    return `${d}d`;
  } catch { return ""; }
}

export function hashIdSimple(s: string){ let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))&0xffffffff; return h; }
export function rotForIdSimple(id:string){ const h=hashIdSimple(id); return (h%14)-7; }

export function getDueMsChoreSimple(c:any){ try{ return c.dueAt? new Date(c.dueAt).getTime(): Date.now(); }catch{ return Date.now(); } }
