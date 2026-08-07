// shoppingDue.ts — computeShoppingNextDue extracted verbatim from AppMonolith.tsx 947-1030
// Zero logic change — preserves Europe/Dublin TZ, semantic monthly Jan31->Feb28->Mar31, biweekly parity
import { HOUSEHOLD_TZ, nextMonthlyFrom, clampDayOfMonth, nextDateMatchingWeekdays as nextDateMatchingWeekdaysLib, weekNumberSinceEpoch, BIWEEKLY_EPOCH_MONDAY_UTC } from "./dates";
import { parseFrequencyDetailToJsDays } from "./recurrence";
import type { ShoppingItemV2 } from "../types";

function freqToHours(freq: ShoppingItemV2["frequency"]): number | null {
  switch(freq){
    case "daily": return 24;
    case "every-2d": return 48;
    case "weekly": return 168;
    case "biweekly": return 336;
    case "monthly": return 720;
    default: return null;
  }
}

function computeNextDueFromWeekdays(from: Date, weekdaysBool: boolean[], intervalWeeks = 1): Date {
  const jsDays = [1,2,3,4,5,6,0];
  const allowed: number[] = [];
  weekdaysBool.forEach((on,i)=>{ if(on) allowed.push(jsDays[i] as number); });
  if (allowed.length===0) {
    const nxt = new Date(from);
    nxt.setDate(nxt.getDate()+1);
    nxt.setHours(9,0,0,0);
    return nxt;
  }
  const start = new Date(from);
  for (let offset=0; offset<42; offset++) {
    const cand = new Date(start);
    cand.setDate(start.getDate()+offset);
    const js = cand.getDay();
    if (!allowed.includes(js)) continue;
    if (cand.getTime() < from.getTime()+60000) continue;
    if (intervalWeeks>1) {
      const epochWeekStart = weekNumberSinceEpoch(new Date(BIWEEKLY_EPOCH_MONDAY_UTC));
      const candMon = new Date(cand);
      candMon.setHours(0,0,0,0);
      const cDayIdx = (candMon.getDay()+6)%7;
      candMon.setDate(candMon.getDate()-cDayIdx);
      const candWeekNum = weekNumberSinceEpoch(candMon);
      if ((candWeekNum - epochWeekStart) % intervalWeeks !== 0) continue;
    }
    return cand;
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate()+ (intervalWeeks>1?14:7));
  return fallback;
}

export function computeShoppingNextDue(item: ShoppingItemV2, nowMs?: number): Date | null {
  const now = nowMs? new Date(nowMs): new Date();
  const baseRef = (item as any).lastDoneAt ? new Date((item as any).lastDoneAt) : new Date((item as any).createdAt);
  const freq = (item as any).frequency || "as-needed";
  if (freq==="as-needed") return null;
  if ((freq==="weekly" || freq==="biweekly") && (item as any).needDays) {
    const jsDays = parseFrequencyDetailToJsDays((item as any).needDays);
    if (jsDays.length>0) {
      const interval = freq==="biweekly"?2:1;
      const ref = baseRef.getTime()>now.getTime()? baseRef: now;
      const refDate = new Date(ref.getTime()+ 10*60*1000);
      const hour = refDate.getHours();
      const minute = refDate.getMinutes();
      if (interval>1) {
        const bool: boolean[]=[false,false,false,false,false,false,false];
        const mapJsToIdx: Record<number,number> = {1:0,2:1,3:2,4:3,5:4,6:5,0:6};
        jsDays.forEach(j=>{ const i=mapJsToIdx[j]; if(i!==undefined) bool[i]=true; });
        return computeNextDueFromWeekdays(refDate, bool, interval);
      }
      return nextDateMatchingWeekdaysLib(refDate, jsDays, hour, minute);
    }
  }
  if (freq === "monthly") {
    const baseHour = baseRef.getHours();
    const baseMin = baseRef.getMinutes();
    const preservedDom = (item as any).originalDom ?? baseRef.getDate();
    try {
      let cand = nextMonthlyFrom(new Date(baseRef.getTime()+ 60*1000), preservedDom, baseHour, baseMin, HOUSEHOLD_TZ);
      let guard=0;
      while (cand.getTime() <= now.getTime() && guard<24) {
        cand = nextMonthlyFrom(new Date(cand.getTime()+ 3600*1000), preservedDom, baseHour, baseMin, HOUSEHOLD_TZ);
        guard++;
      }
      return cand;
    } catch {
      const y = baseRef.getFullYear();
      const m = baseRef.getMonth();
      const clamped = clampDayOfMonth(y, m+1, preservedDom);
      const h=720;
      const nxt=new Date(baseRef.getTime()+h*3600*1000);
      void clamped;
      if(nxt.getTime()<now.getTime()){
        const diffH=(now.getTime()-nxt.getTime())/3600000;
        const steps=Math.floor(diffH/h)+1;
        nxt.setTime(nxt.getTime()+steps*h*3600000);
      }
      return nxt;
    }
  }
  const h = freqToHours(freq as any);
  if (!h) return null;
  const nxt = new Date(baseRef.getTime()+ h*3600*1000);
  if (nxt.getTime()<now.getTime()) {
    const diffH=(now.getTime()-nxt.getTime())/3600000;
    const steps=Math.floor(diffH/h)+1;
    nxt.setTime(nxt.getTime()+steps*h*3600000);
  }
  return nxt;
}

export default computeShoppingNextDue;
