// choreScoring.ts — pure helpers extracted from App.tsx / ChoresScreen.tsx
// Zero logic change — Europe/Dublin TZ, 1.15× bonus, capped 1.5×, 600 pts label preserved
import type { ChoreV2, PersonKey } from "./choreTypes";
import { HOUSEHOLD_TZ } from "./choreTypes";
import { todayKey, toLocalKey as toLocalKeyDublin, tzWallToUtc } from "../../lib/dates";

export { HOUSEHOLD_TZ, todayKey, toLocalKeyDublin, tzWallToUtc };

export function windowHoursForChore(c: ChoreV2): number {
  // FIX urgency window only — monthly recurrence is semantic, not 720h
  if ((c as any).timeWindowHours) return (c as any).timeWindowHours;
  if (c.type === "one-off" || c.frequency === "once") return 24;
  if (c.frequency === "daily") return 24;
  if (c.frequency === "twice-week") return 84;
  if (c.frequency === "weekly") return 168;
  if (c.frequency === "biweekly") return 336;
  if (c.frequency === "monthly") return 720; // window only, recurrence handled by computeNextDueDateChore semantic
  if (c.frequency === "custom") return 168;
  return 168;
}

export function getDueMsChore(c: ChoreV2 | any): number {
  if (c.dueAt) return new Date(c.dueAt).getTime();
  try { return new Date(c.createdAt).getTime() + windowHoursForChore(c as ChoreV2) * 3600 * 1000; } catch { return Date.now(); }
}

export function percentLeftChore(c: ChoreV2 | any, nowMs?: number): number {
  const now = nowMs ?? Date.now();
  const due = getDueMsChore(c);
  const win = windowHoursForChore(c as ChoreV2);
  const created = (()=>{ try{ return new Date(c.createdAt).getTime(); }catch{return now - win*3600000; }})();
  const start = c.dueAt ? due - win * 3600000 : created;
  const total = due - start;
  if (total <= 0) return 0;
  return (due - now) / total;
}

export function isBonusChore(c: ChoreV2 | any, atMs?: number): boolean {
  const pct = percentLeftChore(c, atMs);
  return pct >= 0 && pct < 0.10;
}

export function effectivePoints(c: ChoreV2 | any, bonus = false): number {
  let pts = c.basePoints * c.multiplier;
  if (bonus) pts *= 1.15; // +15% urgency, capped 1.5× total
  pts = Math.min(pts, c.basePoints * 1.5);
  return Math.round(pts);
}

export function effortLabel(pain: number): string {
  if (pain <= 2) return "Tiny";
  if (pain <= 4) return "Quick";
  if (pain <= 6) return "Moderate";
  if (pain <= 8) return "Heavy";
  return "Brutal";
}

export function effortHuman(pain: number): string {
  if (pain <= 2) return "Tiny effort";
  if (pain <= 4) return "Light effort";
  if (pain <= 6) return "Medium effort";
  if (pain <= 8) return "High effort";
  return "Tough";
}

export function freqBadgeChore(c: ChoreV2): string {
  if (c.type === "one-off") return "ONCE";
  if (c.frequency === "custom" && c.frequencyDetail) return c.frequencyDetail.toUpperCase();
  if (c.frequency === "twice-week" && c.frequencyDetail) return c.frequencyDetail.toUpperCase();
  return c.frequency.toUpperCase();
}

export function timingLabel(c: ChoreV2, nowMs: number): string {
  const freq = (c.frequency || "").toUpperCase() || "ONCE";
  const dueMs = getDueMsChore(c);
  const diff = dueMs - nowMs;
  try {
    const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
    const isToday = dueKey === todayKey(HOUSEHOLD_TZ);
    const isOver = diff < 0;
    if (isOver) return `${freq} • OVERDUE`;
    if (isToday) return `${freq} • DUE TODAY`;
    if (diff < 48 * 3600000) return `${freq} • DUE TOMORROW`;
  } catch {}
  return freq;
}

// Monthly / championship helpers

export function getNextResetAt(nowDate: Date): Date {
  try {
    const y = Number(new Intl.DateTimeFormat('en-GB',{timeZone:HOUSEHOLD_TZ, year:'numeric'}).format(nowDate));
    const m = Number(new Intl.DateTimeFormat('en-GB',{timeZone:HOUSEHOLD_TZ, month:'numeric'}).format(nowDate));
    const nextM = m===12 ? 1 : m+1;
    const nextY = m===12 ? y+1 : y;
    return tzWallToUtc(nextY, nextM, 1, 0,0,0, HOUSEHOLD_TZ);
  } catch {
    return new Date(nowDate.getTime()+30*86400000);
  }
}

export function getResetCountdown(nextResetAt: Date, tickMs: number) {
  const diff = nextResetAt.getTime()-tickMs;
  if (diff<=0) return {d:0,h:0,m:0,s:0, label:'Resets now'};
  const d=Math.floor(diff/86400000);
  const h=Math.floor((diff%86400000)/3600000);
  const m=Math.floor((diff%3600000)/60000);
  const s=Math.floor((diff%60000)/1000);
  return {d,h,m,s, label:`Resets 1st 00:00 • ${d}d ${h}h`};
}

export function computeMonthScores(done: ChoreV2[], monthKey: string) {
  let a=0,c=0;
  done.forEach(ch=>{
    try{
      const k = ch.completedAt ? toLocalKeyDublin(ch.completedAt, HOUSEHOLD_TZ) : null;
      if(!k) return;
      if(!k.startsWith(monthKey)) return;
      const pts = effectivePoints(ch, isBonusChore(ch, ch.completedAt? new Date(ch.completedAt).getTime():undefined));
      if(ch.completedBy==='aisling') a+=pts;
      else if(ch.completedBy==='ciaran') c+=pts;
    }catch{}
  });
  const total = (a+c)||1;
  const pct = Math.round((Math.max(a,c)/total)*100);
  return {a,c,total,pct};
}

export function computeWeekScores(done: any[], nowMs: number) {
  const sevenAgo = nowMs - 7*86400000;
  let a=0, cc=0;
  done.forEach((c:any)=>{
    const ts = c.completedAt ? new Date(c.completedAt).getTime() : 0;
    if (ts < sevenAgo) return;
    const pts = effectivePoints(c, isBonusChore(c, ts));
    if (c.completedBy==='aisling') a+=pts;
    else if (c.completedBy==='ciaran') cc+=pts;
  });
  return {a, c: cc};
}

export function computeMetaHistory(done: ChoreV2[], _monthKey?: string) {
  try{
    const raw=localStorage.getItem("couple_v1_chore_game_meta");
    if(raw){
      const j=JSON.parse(raw);
      if(Array.isArray(j.history)) return j.history.slice(-3);
    }
  }catch{}
  const map: Record<string,{a:number,c:number,winner:PersonKey|null,key:string}> = {};
  done.forEach(ch=>{
    try{
      const k= ch.completedAt ? toLocalKeyDublin(ch.completedAt, HOUSEHOLD_TZ)?.slice(0,7) : null;
      if(!k) return;
      if(!map[k]) map[k]={a:0,c:0,winner:null,key:k};
      const pts=effectivePoints(ch, false);
      if(ch.completedBy==='aisling') map[k].a+=pts;
      else if(ch.completedBy==='ciaran') map[k].c+=pts;
    }catch{}
  });
  const arr=Object.values(map).map(m=> ({...m, winner: (m.a===m.c? null : m.a>m.c? "aisling":"ciaran") as any})).sort((a,b)=> a.key.localeCompare(b.key)).slice(-3);
  return arr;
}

// 600 pts label preserved for championship header
export const CHAMPIONSHIP_MAX_LABEL = "600 pts";
