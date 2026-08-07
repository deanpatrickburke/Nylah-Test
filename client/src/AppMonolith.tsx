import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSupabase, hasSupabaseConfig, saveSupabaseConfig, TOKEN as SB_TOKEN, TABLE as SB_TABLE, ROW_ID as SB_ROW_ID } from "./lib/supabase";
const TABLE = SB_TABLE;
const ROW_ID = SB_ROW_ID;
// refactor split-v117: zero-logic extraction
import type { PersonKey, Theme, TabKey, ChoreV2, CalendarEventV2, CalendarEventStatus, CalendarResponseKind, CalendarEventResponse, ShoppingCategory, ShoppingFrequency, ShoppingItemV2, NoteMemo, CalendarEvent, AddEventFormProps } from "./types";
import { CATS } from "./types";
import { THEMES, PERSONS, TABS } from "./constants/themes";
import { remoteLoad, remoteSave, subscribeRemote } from "./lib/remoteSync";
import { claimChoreViaRpc as claimChoreOccRpc, completeChoreOccurrence as completeChoreRpc } from "./lib/normalized";
import { CHORE_ICONS, ChoreIcon, ALL_CHORE_ICON_IDS, CHORE_ICON_BY_TEMPLATE } from "./lib/choreIcons";
import type { ChoreIconId } from "./lib/choreIcons";
// FIX: one date engine Europe/Dublin — single source of truth
import { HOUSEHOLD_ID as BUILD_HOUSEHOLD_ID, HOUSEHOLD_TZ } from "./lib/buildMeta";
import {
todayKey,
toLocalKey as toLocalKeyDublin, tzWallToUtc,
nextMonthlyFrom, clampDayOfMonth,
weekNumberSinceEpoch,
BIWEEKLY_EPOCH_MONDAY_UTC
} from "./lib/dates";
import { uid, rotForId, relTime } from "./shared/utils/helpers";
import { expandTemplateForMonthDublin, getDublinHourMinuteFromIso, shouldSuppressGeneratedOccurrence } from "./lib/recurrence";
import { upsertCalendarSeries, upsertCalendarOverride } from "./lib/normalized";
import { verifyPin } from "./lib/pins";
import { openIdb, idbGet, idbSet } from "./lib/idb";
import { resizeToDataUrl, createThumbnail } from "./lib/images";

// ---- robust storage ----
const LS_PREFIX = "couple_v1_";
const DEFAULT_TOKEN = "ash-ciaran-2026"; void DEFAULT_TOKEN;
function isQuotaError(e: any): boolean {
  return e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014 || (typeof e.message === "string" && e.message.includes("quota")));
}
function safeGetLS(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function safeSetLS(key: string, val: string): boolean {
  try { localStorage.setItem(key, val); return true; } catch (e: any) {
    if (isQuotaError(e)) {
      // try evict oldest truncated photos / large notes then retry once
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(LS_PREFIX)) continue;
          if (k.includes("notes") || k.includes("photo")) {
            const raw = localStorage.getItem(k);
            if (raw && raw.length > 40000) {
              try {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) {
                  const trimmed = arr.map((n: any) => n.photoDataUrl && typeof n.photoDataUrl === "string" && n.photoDataUrl.length > 8000 ? { ...n, photoDataUrl: undefined } : n);
                  localStorage.setItem(k, JSON.stringify(trimmed));
                  // retry original
                  localStorage.setItem(key, val);
                  return true;
                }
              } catch {}
            }
          }
        }
      } catch {}
    }
    console.warn("[storage] set fail", key, e?.message || e);
    return false;
  }
}

function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("standalone")) return true;
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
      // @ts-ignore iOS
      if ((window.navigator as any).standalone === true) return true;
      if (window.location.hostname.includes("netlify.app")) return true;
      if (window.location.hostname.includes("github.io")) return true;
      // on real phone sizes avoid the desktop “phone frame” wrapper
      if (typeof window !== "undefined" && window.innerWidth <= 500) return true;
      return false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const check = () => {
      try {
        const url = new URL(window.location.href);
        const mq = window.matchMedia ? window.matchMedia("(display-mode: standalone)").matches : false;
        // @ts-ignore
        const ios = (window.navigator as any).standalone === true;
        const host = window.location.hostname.includes("netlify.app") || window.location.hostname.includes("github.io");
        const isPhoneWidth = window.innerWidth <= 500;
        setStandalone(url.searchParams.has("standalone") || mq || ios || host || isPhoneWidth);
      } catch {}
    };
    check();
    const mql = window.matchMedia ? window.matchMedia("(display-mode: standalone)") : null;
    const handler = () => check();
    // @ts-ignore
    mql?.addEventListener?.("change", handler);
    // @ts-ignore fallback
    mql?.addListener?.(handler);
    window.addEventListener("popstate", handler);
    return () => {
      // @ts-ignore
      mql?.removeEventListener?.("change", handler);
      // @ts-ignore
      mql?.removeListener?.(handler);
      window.removeEventListener("popstate", handler);
    };
  }, []);
  return standalone;
}
// PersonKey + PERSONS moved to constants/themes.ts — zero logic change, re-imported
function getHouseholdPersonsRaw(): any[] | null {
  try {
    const hid = localStorage.getItem("couple_v1_household_id");
    const tryKeys = hid ? [`couple_v1_household_persons_${hid}`, `couple_v1_household_persons`] : [`couple_v1_household_persons`];
    for (const k of tryKeys) {
      const raw = localStorage.getItem(k);
      if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch {} }
    }
  } catch {}
  return null;
}
function applyCustomPersonNames() {
  try {
    const persons = getHouseholdPersonsRaw();
    if (!persons || persons.length<2) return;
    for (const p of persons) {
      if (!p || !p.key || !p.name) continue;
      const k = p.key as PersonKey;
      if (PERSONS[k]) {
        PERSONS[k].name = p.name;
        if (p.name && p.name.length>0) PERSONS[k].initial = p.name.trim().slice(0,1).toUpperCase();
      }
    }
  } catch {}
}
try { applyCustomPersonNames(); } catch {}
// --- WebAuthn biometric helpers (device-local convenience, not server verified) ---
function bufToB64u(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64uToBuf(b64u: string): ArrayBuffer {
  let b64 = b64u.replace(/-/g,"+").replace(/_/g,"/");
  const pad = b64.length % 4; if (pad) b64 += "=".repeat(4-pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes.buffer;
}
function webAuthnIdKey(user: PersonKey){ return `couple_v1_webauthn_${user}`; }
function isWebAuthnSupported(): boolean {
  try { return !!(window as any).PublicKeyCredential; } catch { return false; }
}
async function canDoPlatformBiometric(): Promise<boolean> {
  try {
    const pkc = (window as any).PublicKeyCredential;
    if (!pkc) return false;
    if (pkc.isUserVerifyingPlatformAuthenticatorAvailable) {
      return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch { return false; }
}
async function registerBiometric(user: PersonKey): Promise<string | null> {
  if (!isWebAuthnSupported()) return null;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const rpId = location.hostname;
  try {
    const cred: any = await (navigator.credentials as any).create({
      publicKey: {
        challenge,
        rp: { name: "Beirt", id: rpId },
        user: { id: userId, name: user, displayName: PERSONS[user].name },
        pubKeyCredParams: [{ type:"public-key", alg:-7 }, { type:"public-key", alg:-257 }],
        authenticatorSelection: { authenticatorAttachment:"platform", requireResidentKey:false, userVerification:"required" },
        timeout: 60000,
        attestation: "none",
      }
    });
    if (!cred || !cred.rawId) return null;
    const idB64u = bufToB64u(cred.rawId);
    try { localStorage.setItem(webAuthnIdKey(user), idB64u); localStorage.setItem("couple_v1_biometric_enabled","1"); } catch {}
    return idB64u;
  } catch (e) {
    // user cancelled or not allowed
    return null;
  }
}
async function authenticateBiometric(): Promise<PersonKey | null> {
  if (!isWebAuthnSupported()) return null;
  const stored: { user: PersonKey; id: string }[] = [];
  try {
    for (const u of ["aisling","ciaran"] as PersonKey[]) {
      const v = localStorage.getItem(webAuthnIdKey(u));
      if (v) stored.push({ user: u, id: v });
    }
  } catch { return null; }
  if (stored.length===0) return null;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  // Try with allow list first, fallback without for discoverable creds
  const allow = stored.map(s=> ({ id: b64uToBuf(s.id) as any, type:"public-key" as const, transports: ["internal"] as any }));
  try {
    const assertion: any = await (navigator.credentials as any).get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification:"required",
        allowCredentials: allow,
      }
    });
    if (!assertion || !assertion.rawId) return null;
    const got = bufToB64u(assertion.rawId);
    const match = stored.find(s=> s.id===got);
    if (match) return match.user;
    // If id doesn't match (different encoding) but we got *something*, pick first if only one enrolled
    if (stored.length===1) return stored[0].user;
    // fallback: return first as best guess
    return stored[0].user;
  } catch {
    // try without allowCredentials (discoverable)
    try {
      const assertion: any = await (navigator.credentials as any).get({
        publicKey: { challenge, timeout:60000, userVerification:"required" }
      });
      if (!assertion) return null;
      // we can't map without id, but if only one user enrolled return it
      if (stored.length===1) return stored[0].user;
      return null;
    } catch { return null; }
  }
}
// Theme + THEMES moved to constants/themes.ts — zero logic change
type TabKeyLocal = TabKey; // keep alias for internal references if needed
type ThemeLocal = Theme;

function TabIcon({ k, active }: { k: TabKey; active?: boolean }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as any, strokeLinejoin: "round" as any };
  if (k === "fridge") {
    return <svg {...common}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-5H9v5H4a1 1 0 0 1-1-1v-9.5Z"/><path d="M9 21V11h6v10" opacity="0.6"/></svg>;
  }
  if (k === "plans") {
    return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 3v3M16 3v3"/><rect x="7" y="12" width="3" height="3" rx="0.5"/><rect x="14" y="12" width="3" height="3" rx="0.5"/></svg>;
  }
  if (k === "chores") {
    return <svg {...common}><path d="M12 3 19 6v6c0 4.5-3 8.5-7 9-4-0.5-7-4.5-7-9V6l7-3Z"/><path d="M8.5 12.5 10.8 14.8 15.5 9.2" strokeWidth={1.9}/></svg>;
  }
  if (k === "shopping") {
    return <svg {...common}><path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M9 12h6"/></svg>;
  }
  if (k === "notes") {
    return <svg {...common} fill={active ? "currentColor" : "none"}><path d="M12 19.5 8.7 16.4A4.2 4.2 0 0 1 7 13.6C7 11.3 8.8 9.5 11.1 9.5c1.1 0 1.9.5 2.5 1.2.6-.7 1.4-1.2 2.5-1.2C18.4 9.5 20.2 11.3 20.2 13.6c0 1.1-.6 2.2-1.7 3.2L12 19.5Z" fill={active ? "currentColor" : "none"} stroke="currentColor"/></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="7"/></svg>;
}
function IconFlame({ size=14, color="currentColor"}: {size?:number; color?:string}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} opacity="0.95"><path d="M12 2C10.5 5.5 6 7.5 6 12.5A6 6 0 0 0 18 12.5C18 7.5 13.5 5.5 12 2Z"/></svg>; }
function IconEye({ size=14 }: {size?:number}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>; }
function IconSparkle({ size=14 }: {size?:number}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.4H19l-4.4 3.2 1.7 5.4L12 13.2 7.7 16l1.7-5.4L5 7.4h5.2z"/></svg>; }
function IconTrophy({ size=14 }: {size?:number}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M6 8h12v2c0 3-2.5 5-6 5s-6-2-6-5V8Z"/><path d="M9 3h6"/><path d="M12 13v5"/><path d="M8 18h8"/></svg>; }
function IconCrown({ size=14 }: {size?:number}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M3 16L12 6l9 10H3Z"/><path d="M9 16V14M12 16V12M15 16V14" stroke="white" strokeWidth="0.8"/></svg>; }
function IconCheckTiny({ size=12 }: {size?:number}){ return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}><path d="M5 12.5l3.7 3.7L19 7"/></svg>; }
function getTabMeta(tab: string) {
  const norm = tab === "calendar" ? "plans" : tab;
  return (TABS as any).find((t: any) => t.k === norm) ?? { k: norm, label: norm, title: norm, icon: "" };
}
function getPageTitle(tab: TabKey): string {
  const meta = getTabMeta(tab as any);
  if (meta.k === "fridge") return "Beirt";
  return meta.title ?? meta.label;
}
const LEGACY_TABS = TABS;
// uid now from shared/utils/helpers — zero logic change
function useLocalState<T>(key: string, def: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = safeGetLS(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {}
    return def;
  });

  // ── IDB hydration path: if LS empty/ stale, hydrate from IDB (cached) ──
  useEffect(()=>{
    let cancelled = false;
    (async()=>{
      try {
        if (key.includes("notes")) {
          const cached = await idbGet<T>(key);
          if (cancelled) return;
          if (Array.isArray(cached) && (cached as any).length>0) {
            const curArr = state as any;
            if (!Array.isArray(curArr) || curArr.length===0) {
              setState(cached as any);
              return;
            }
            // hydrate photos from separate photo store if present
            const photoMap = await idbGet<Record<string,string>>('note_photos');
            if (photoMap && !cancelled && Array.isArray(curArr)) {
              let merged = false;
              const next = (curArr as any[]).map((n:any)=>{
                if (!n.photoDataUrl && photoMap[n.id]) { merged = true; return { ...n, photoDataUrl: photoMap[n.id] }; }
                return n;
              });
              if (merged) setState(next as any);
            }
          } else {
            // no full cached, try photo map only to patch existing LS notes
            const curArr = state as any;
            if (Array.isArray(curArr) && curArr.length>0) {
              const photoMap = await idbGet<Record<string,string>>('note_photos');
              if (photoMap && !cancelled) {
                let merged = false;
                const next = curArr.map((n:any)=>{
                  if (!n.photoDataUrl && photoMap[n.id]) { merged = true; return { ...n, photoDataUrl: photoMap[n.id] }; }
                  return n;
                });
                if (merged) setState(next as any);
              }
            }
          }
        } else {
          const cached = await idbGet<T>(key);
          if (cancelled) return;
          if (cached != null) {
            const cur = state as any;
            const isEmpty = cur==null || (Array.isArray(cur) && cur.length===0) || (typeof cur==='object' && !Array.isArray(cur) && Object.keys(cur).length===0);
            if (isEmpty) setState(cached);
          }
        }
      } catch {}
    })();
    return ()=>{ cancelled = true; };
    // run once per key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      // Photos IDB path: extract large photoDataUrl into IDB separate store, keep LS light
      if (key.includes("notes") && Array.isArray(state as any)) {
        const arr = state as any as NoteMemo[];
        const photoMap: Record<string,string> = {};
        let hasLarge = false;
        for (const n of arr) {
          if (n.photoDataUrl && n.photoDataUrl.length>4000) {
            photoMap[n.id] = n.photoDataUrl;
            hasLarge = true;
          }
        }
        if (hasLarge) {
          // async fire-and-forget persist photos
          (async()=>{ try { const existing = await idbGet<Record<string,string>>('note_photos') || {}; const merged = { ...existing, ...photoMap }; await idbSet('note_photos', merged); } catch {} })();
          // LS holds trimmed version (no heavy blob) to avoid quota & corrupt slice
          const trimmed = arr.map(n=> n.photoDataUrl && n.photoDataUrl.length>4000 ? { ...n, photoDataUrl: undefined } : n);
          try { safeSetLS(key, JSON.stringify(trimmed)); } catch {}
          try { idbSet(key, state as any); } catch {}
          // keep in-memory state still has full photos (don't downgrade React state)
          try { idbSet('couple_v1_last_local_write', new Date().toISOString()); } catch{}
          return;
        }
      }
      const json = JSON.stringify(state);
      const ok = safeSetLS(key, json);
      if (ok) { idbSet(key, state as any); }
      else {
        // quota fallback: store trimmed without photos and keep IDB as source of truth
        if (key.includes("notes") && Array.isArray(state as any)) {
          const trimmed = (state as any).map((n: any) => n.photoDataUrl ? { ...n, photoDataUrl: undefined } : n);
          safeSetLS(key, JSON.stringify(trimmed));
          idbSet(key, state as any);
        } else {
          // for non-notes, try IDB only
          idbSet(key, state as any);
        }
      }
    } catch {}
  }, [key, state]);
  return [state, setState as any];
}
// relTime, hashId, rotForId now from shared/utils/helpers — zero logic change
// types moved to ./types.ts — zero logic change, re-exported via import
// ChoreV2, CalendarEventV2, ShoppingCategory etc now imported
function mapOldCat(catRaw: string): ShoppingCategory {
  const raw = (catRaw||"").trim();
  const s = raw.toLowerCase();
  // FIX 9 canonical — case insensitive, maps legacy pantry etc + TitleCase normalisation
  const direct = (CATS as string[]).find(c => c.toLowerCase() === s);
  if (direct) return direct as ShoppingCategory;
  if ((CATS as string[]).includes(raw)) return raw as ShoppingCategory;
  if (["produce","pantry","dairy","meat","frozen","groceries","grocery","drinks","food","fruit","veg","vegetables"].includes(s)) return "Food";
  if (["household","home","cleaning","supplies"].includes(s)) return "Household";
  if (["toiletries","toilet","bathroom","hygiene"].includes(s)) return "Toiletries";
  if (["clothes","clothing","apparel","shoes","wardrobe"].includes(s)) return "Clothes";
  if (["trips","trip","travel","holiday","vacation","flight"].includes(s)) return "Trips";
  if (["bills","bill","rent","utilities","utility","subscription"].includes(s)) return "Bills";
  if (["entertainment","ent","fun","movies","games","going-out"].includes(s)) return "Entertainment";
  if (["personal","@personal","people","person","user","aisling","ciaran"].includes(s)) return "Personal";
  if (s.startsWith("@aisling") || s.startsWith("@ciaran")) return "Personal";
  return "Other";
}
 // Shopping types moved to ./types.ts — imported, zero logic change (ShoppingFrequency, ShoppingItemV2, PersonalWants, NoteMemo etc)

function timePartFromIsoDublin(iso?: string): string {
  if (!iso) return "10:00";
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: HOUSEHOLD_TZ, hour:"2-digit", minute:"2-digit", hour12:false });
    const parts = fmt.formatToParts(d);
    const h = parts.find(p=>p.type==="hour")?.value || "10";
    const m = parts.find(p=>p.type==="minute")?.value || "00";
    return `${h.padStart(2,"0")}:${m.padStart(2,"0")}`;
  } catch { return "10:00"; }
}

function wallToIsoDublin(dateKey:string, timeStr:string, allDayFlag:boolean): string {
  try {
    const [y,m,d] = dateKey.split("-").map(Number);
    if (!y||!m||!d) return new Date().toISOString();
    if (allDayFlag) {
      return tzWallToUtc(y,m,d,0,0,0,HOUSEHOLD_TZ).toISOString();
    }
    const [hh,mm] = (timeStr||"09:00").split(":").map(n=> Number(n)||0);
    const hour = Number.isFinite(hh) ? hh : 9;
    const min = Number.isFinite(mm) ? mm : 0;
    return tzWallToUtc(y,m,d,hour,min,0,HOUSEHOLD_TZ).toISOString();
  } catch {
    return new Date(`${dateKey}T${timeStr||"09:00"}:00`).toISOString();
  }
}

function AddEventForm({ onAdd, currentUser, selectedDate, initialEvent }: AddEventFormProps){
  const initDateKey = (()=>{
    if (initialEvent?.dueAt) {
      const k = toLocalKeyDublin(initialEvent.dueAt, HOUSEHOLD_TZ);
      return k || selectedDate || todayKey(HOUSEHOLD_TZ);
    }
    if (initialEvent?.start) {
      const k = toLocalKeyDublin(initialEvent.start, HOUSEHOLD_TZ);
      return k || selectedDate || todayKey(HOUSEHOLD_TZ);
    }
    return selectedDate || todayKey(HOUSEHOLD_TZ);
  })();
  const initEndKey = (()=>{
    if (initialEvent?.endAt) {
      const k = toLocalKeyDublin(initialEvent.endAt, HOUSEHOLD_TZ);
      if (k) return k;
    }
    if (initialEvent?.end) {
      const k = toLocalKeyDublin(initialEvent.end, HOUSEHOLD_TZ);
      if (k) return k;
    }
    return initDateKey;
  })();
  const initAllDay = !!(initialEvent?.allDay);
  const initMulti = !!(initialEvent?.multiDay) || (()=>{
    if (!initialEvent) return false;
    const s = initialEvent.dueAt || initialEvent.start;
    const e = initialEvent.endAt || initialEvent.end;
    if (!s || !e) return false;
    const sk = toLocalKeyDublin(s, HOUSEHOLD_TZ);
    const ek = toLocalKeyDublin(e, HOUSEHOLD_TZ);
    return sk && ek && sk !== ek;
  })();

  const [title,setTitle]=useState(()=> initialEvent?.title || "");
  const [date,setDate]=useState(()=> initDateKey);
  const [startTime,setStartTime]=useState(()=> initialEvent?.dueAt ? timePartFromIsoDublin(initialEvent.dueAt || initialEvent.start) : initialEvent?.start ? timePartFromIsoDublin(initialEvent.start) : "10:00");
  const [endTime,setEndTime]=useState(()=> {
    if (!initialEvent) return "";
    const eIso = initialEvent.endAt || initialEvent.end;
    if (!eIso) return "";
    if (initAllDay) return "";
    return timePartFromIsoDublin(eIso);
  });
  const [showOptions,setShowOptions]=useState(()=> !!initialEvent);
  const [allDay,setAllDay]=useState(()=> initAllDay);
  const [multiDay,setMultiDay]=useState(()=> initMulti);
  const [endDate,setEndDate]=useState(()=> initEndKey);
  const [location,setLocation]=useState(()=> initialEvent?.location || "");
  const [notes,setNotes]=useState(()=> initialEvent?.notes || "");
  const [repeat,setRepeat]=useState<"once"|"daily"|"weekly"|"biweekly"|"monthly">(()=> {
    if (!initialEvent) return "once";
    return (initialEvent.frequency || initialEvent.repeat || "once") as any;
  });
  const [reminder,setReminder]=useState<number|undefined>(()=> initialEvent?.reminderMinutes);
  const [responseDeadline,setResponseDeadline]=useState(()=> {
    if (!initialEvent?.responseDeadline) return "";
    const k = toLocalKeyDublin(initialEvent.responseDeadline, HOUSEHOLD_TZ);
    return k || "";
  });
  const [attendees,setAttendees]=useState<PersonKey[]>(()=> {
    if (initialEvent?.attendees && Array.isArray(initialEvent.attendees) && initialEvent.attendees.length) return initialEvent.attendees;
    return ["aisling","ciaran"];
  });

  useEffect(()=>{
    if (multiDay && date && endDate===date) {
      try {
        const [y,m,d] = date.split("-").map(Number);
        const startUTC = tzWallToUtc(y,m,d,0,0,0,HOUSEHOLD_TZ);
        const wkLater = new Date(startUTC.getTime()+ 6*24*3600*1000);
        const key = toLocalKeyDublin(wkLater.toISOString(), HOUSEHOLD_TZ);
        if (key) setEndDate(key);
      } catch {}
    }
  }, [multiDay]);

  const isEndBeforeStart = multiDay && endDate && date && endDate < date;
  const isTimeInvalidSingle = !allDay && !multiDay && startTime && endTime && endTime <= startTime;
  const isRangeInvalid = !!(isEndBeforeStart || isTimeInvalidSingle);
  const invalidReason = isEndBeforeStart ? "End date must be on or after start" : isTimeInvalidSingle ? "End time must be after start time" : "";

  const fmtDeadlinePreview = responseDeadline ? (()=>{
    try { return new Date(responseDeadline+"T12:00:00").toLocaleDateString(undefined,{weekday:"short", month:"short", day:"numeric"}); } catch {return responseDeadline;}
  })() : "";

  return <div className="space-y-3">
    <div className="text-[11px] text-[var(--muted)]">Responding as {(PERSONS[currentUser]?.name||currentUser||'You')} • Europe/Dublin — {initialEvent ? "editing" : "new"}</div>
    <input id="cal-title" aria-label="Event title" value={title} onChange={e=> setTitle(e.target.value)} placeholder="Title — e.g. Dinner with Mia" className="w-full rounded-full border bg-[var(--card-bg)] px-4 h-[44px] text-[13px]" style={{ borderColor:"var(--border)" }} />
    <div className="flex gap-2">
      <div className="flex-1">
        <label htmlFor="cal-date" className="text-[11px] text-[var(--muted)]">Start date (Dublin)</label>
        <input id="cal-date" type="date" value={date} onChange={e=> setDate(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px]" style={{ borderColor: isEndBeforeStart ? "#B91C1C" : "var(--border)" }} />
      </div>
      {multiDay ? (
        <div className="flex-1">
          <label htmlFor="cal-enddate" className="text-[11px] text-[var(--muted)]">End date</label>
          <input id="cal-enddate" type="date" value={endDate} onChange={e=> setEndDate(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px]" style={{ borderColor: isEndBeforeStart ? "#B91C1C" : "var(--border)" }} />
        </div>
      ) : (
        <div className="w-[128px]">
          <label htmlFor="cal-start" className="text-[11px] text-[var(--muted)]">Start</label>
          <input id="cal-start" type="time" disabled={allDay} value={startTime} onChange={e=> setStartTime(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px] disabled:opacity-50" />
        </div>
      )}
    </div>

    {multiDay && (
      <div className="flex gap-2">
        <div className="w-[128px]">
          <label htmlFor="cal-start-multi" className="text-[11px] text-[var(--muted)]">Start time</label>
          <input id="cal-start-multi" type="time" disabled={allDay} value={startTime} onChange={e=> setStartTime(e.target.value)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px] disabled:opacity-50" />
        </div>
        <div className="w-[128px]">
          <label htmlFor="cal-end" className="text-[11px] text-[var(--muted)]">End time</label>
          <input id="cal-end" type="time" disabled={allDay} value={endTime} onChange={e=> setEndTime(e.target.value)} placeholder={allDay ? "23:59 for all-day" : "optional"} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px] disabled:opacity-50" style={{ borderColor: isTimeInvalidSingle ? "#B91C1C" : "var(--border)" }} />
        </div>
      </div>
    )}
    {!multiDay && (
      <div className="w-full">
        <label htmlFor="cal-end" className="text-[11px] text-[var(--muted)]">End time (optional)</label>
        <input id="cal-end" type="time" value={endTime} onChange={e=> setEndTime(e.target.value)} placeholder="optional" className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[40px] text-[12px]" style={{ borderColor: isTimeInvalidSingle ? "#B91C1C" : "var(--border)" }} />
      </div>
    )}

    {isRangeInvalid && (
      <div className="rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[11px] text-[#B91C1C]"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3l9 16H3L12 3z"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>️ {invalidReason}</div>
    )}

    <button onClick={()=> setShowOptions(v=> !v)} className="text-[11px] underline text-[var(--muted)]">Options {showOptions ? "↑" : "↓"} {multiDay ? "• multi-day" : ""} {allDay ? "• all-day" : ""}</button>
    {showOptions && (
      <div className="rounded-[14px] border bg-[var(--card-bg)] p-3 space-y-2" style={{ borderColor:"var(--border)" }}>
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={allDay} onChange={e=> setAllDay(e.target.checked)} /> All-day</label>
        <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={multiDay} onChange={e=> setMultiDay(e.target.checked)} /> Multi-day — schedule for a week</label>
        {multiDay && <div className="text-[11px] text-[var(--muted)]">For a full week: check All-day, pick Start + End ~7 days apart.</div>}
        <input value={location} onChange={e=> setLocation(e.target.value)} placeholder="Location" className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]" />
        <textarea value={notes} onChange={e=> setNotes(e.target.value)} placeholder="Notes" className="w-full rounded-[12px] border bg-[var(--card-bg)] px-3 py-2 text-[11px] min-h-[60px]" />
        <select value={repeat} onChange={e=> setRepeat(e.target.value as any)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]">
          <option value="once">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every 2 weeks</option>
          <option value="monthly">Monthly (semantic — preserves day)</option>
        </select>
        <select value={reminder ?? ""} onChange={e=> setReminder(e.target.value ? Number(e.target.value) : undefined)} className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]">
          <option value="">No reminder</option>
          <option value="15">15 min before</option>
          <option value="60">1 hour before</option>
          <option value="1440">1 day before</option>
        </select>
        <label htmlFor="cal-deadline" className="text-[11px] text-[var(--muted)]">Response requested by</label>
        <input id="cal-deadline" type="date" value={responseDeadline} onChange={e=> setResponseDeadline(e.target.value)} placeholder="Response requested by" className="w-full rounded-full border bg-[var(--card-bg)] px-3 h-[36px] text-[11px]" />
        <div className="text-[11px] text-[var(--muted)]">Who needs to attend</div>
        <div className="flex gap-2">
          {(["aisling","ciaran"] as PersonKey[]).map(p=> (
            <label key={p} className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={attendees.includes(p)} onChange={e=> { if(e.target.checked) setAttendees(a=> [...a,p]); else setAttendees(a=> a.filter(x=> x!==p)); }} />{PERSONS[p].name}</label>
          ))}
        </div>
        {fmtDeadlinePreview && <div className="text-[11px] text-[var(--muted)]">Response requested by {fmtDeadlinePreview}</div>}
      </div>
    )}
    <button disabled={!title.trim() || isRangeInvalid} onClick={()=> {
      const startIso = wallToIsoDublin(date, startTime, allDay);
      let finalEnd: string | undefined;
      if (multiDay) {
        if (allDay) {
          try {
            const [y2,m2,d2] = endDate.split("-").map(Number);
            finalEnd = tzWallToUtc(y2,m2,d2,23,59,0,HOUSEHOLD_TZ).toISOString();
          } catch {
            finalEnd = new Date(`${endDate}T23:59:00`).toISOString();
          }
        } else {
          finalEnd = endDate ? wallToIsoDublin(endDate, endTime||"23:59", false) : undefined;
        }
      } else {
        finalEnd = endTime ? wallToIsoDublin(date, endTime, false) : undefined;
      }

      const attend = attendees.length ? attendees : ["aisling","ciaran"] as PersonKey[];
      const isSingleAttend = attend.length===1;
      const baseProposer = initialEvent?.proposer || currentUser;
      const awaiting: any = (()=>{
        if (isSingleAttend) return "agreed";
        if (initialEvent?.status) return initialEvent.status;
        return currentUser === "aisling" ? "awaiting_ciaran" : "awaiting_aisling";
      })();

      const ev:any = {
        ...(initialEvent ? {...initialEvent} : {}),
        id: initialEvent?.id || `ev_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
        title:title.trim(),
        type: repeat === "once" ? "one-off" : "repeat",
        frequency: repeat,
        dueAt: startIso,
        endAt: finalEnd,
        start: startIso,
        end: finalEnd,
        proposer: baseProposer,
        status: awaiting,
        swipes: isSingleAttend ? { aisling: attend[0]==="aisling" ? "yes" : null, ciaran: attend[0]==="ciaran" ? "yes" : null } as any : (initialEvent?.swipes || {aisling: currentUser==="aisling" ? "yes" : null, ciaran: currentUser==="ciaran" ? "yes" : null}),
        responses: initialEvent?.responses || [{eventId:"", memberId:currentUser, response:"yes", respondedAt:new Date().toISOString()}],
        createdAt: initialEvent?.createdAt || new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        allDay,
        multiDay,
        endDate: multiDay ? endDate : undefined,
        location: location || undefined,
        notes: notes || undefined,
        reminderMinutes: reminder,
        responseDeadline: responseDeadline ? wallToIsoDublin(responseDeadline, "12:00", false) : undefined,
        attendees: attend,
        timezone: HOUSEHOLD_TZ,
        mutationId: (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()),
      };
      if (isSingleAttend) {
        const sole = attend[0] as PersonKey;
        ev.status = "agreed";
        ev.responses = [{eventId:ev.id, memberId:sole, response:"yes", respondedAt:new Date().toISOString()}];
        ev.swipes = { aisling: sole==="aisling" ? "yes" : null, ciaran: sole==="ciaran" ? "yes" : null } as any;
      } else if (!initialEvent) {
        ev.responses = [{eventId:ev.id, memberId:currentUser, response:"yes", respondedAt:new Date().toISOString()}];
      } else {
        ev.responses = ev.responses.map((r:any)=> ({...r, eventId: ev.id}));
        if (!ev.responses.find((r:any)=> r.memberId===currentUser)) {
          ev.responses.push({eventId:ev.id, memberId:currentUser, response:"yes", respondedAt:new Date().toISOString()});
        }
      }
      if (ev.responses?.[0]) ev.responses[0].eventId = ev.id;
      onAdd(ev);
    }} className="w-full rounded-full bg-[#0A0A0A] h-[44px] text-white text-[13px] disabled:opacity-40 disabled:cursor-not-allowed">{isRangeInvalid ? invalidReason : (attendees.length===1) ? "Save • Only you" : (initialEvent ? "Save" : "Propose")+" • "+(multiDay ? "week / multi" : "Needs a Nod")}</button>
  </div>;
}
function windowHoursForChore(c: ChoreV2): number {
  // FIX urgency window only — monthly recurrence is semantic, not 720h
  if (c.timeWindowHours) return c.timeWindowHours;
  if (c.type === "one-off" || c.frequency === "once") return 24;
  if (c.frequency === "daily") return 24;
  if (c.frequency === "twice-week") return 84;
  if (c.frequency === "weekly") return 168;
  if (c.frequency === "biweekly") return 336;
  if (c.frequency === "monthly") return 720; // window only, recurrence handled by computeNextDueDateChore semantic
  if (c.frequency === "custom") return 168;
  return 168;
}
function getDueMsChore(c: ChoreV2): number {
  if (c.dueAt) return new Date(c.dueAt).getTime();
  return new Date(c.createdAt).getTime() + windowHoursForChore(c) * 3600 * 1000;
}
function percentLeftChore(c: ChoreV2, nowMs?: number) {
  const now = nowMs ?? Date.now(); const due = getDueMsChore(c); const win = windowHoursForChore(c);
  const created = new Date(c.createdAt).getTime(); const start = c.dueAt ? due - win * 3600000 : created;
  const total = due - start; if (total <= 0) return 0; return (due - now) / total;
}
function isBonusChore(c: ChoreV2, atMs?: number) { const pct = percentLeftChore(c, atMs); return pct >= 0 && pct < 0.10; }
function effectivePoints(c: ChoreV2, bonus = false) { let pts = c.basePoints * c.multiplier; if (bonus) pts *= 1.15; // +15% urgency, capped 1.5× total
  pts = Math.min(pts, c.basePoints * 1.5);
  return Math.round(pts); }
function effortLabel(pain:number): string {
  if(pain<=2) return "Tiny";
  if(pain<=4) return "Quick";
  if(pain<=6) return "Moderate";
  if(pain<=8) return "Heavy";
  return "Brutal";
}
function freqBadgeChore(c: ChoreV2) { if (c.type === "one-off") return "ONCE"; if (c.frequency === "custom" && c.frequencyDetail) return c.frequencyDetail.toUpperCase(); if (c.frequency === "twice-week" && c.frequencyDetail) return c.frequencyDetail.toUpperCase(); return c.frequency.toUpperCase(); }

// --- twice-week fix utilities ---
const WEEKDAY_SHORT_MON = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const; // index 0=Mo ... 6=Su
const WEEKDAY_LONG_TUEFRI = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DEFAULT_TWICE_WEEK_BOOL = [false, true, false, false, true, false, false] as const; // Tue + Fri

// keep referenced for legacy / debug — avoid unused-local TS error
function boolToJsWeekdays(weekdays: boolean[]): number[] {
  // converts Mo-Su bool to JS getDay numbers 0-6 Sun-Sat
  const js: number[] = [];
  weekdays.forEach((on, i) => {
    if (!on) return;
    // i:0 Mo->1,1 Tu->2,2 We->3,3 Th->4,4 Fr->5,5 Sa->6,6 Su->0
    const map = [1, 2, 3, 4, 5, 6, 0];
    js.push(map[i] as number);
  });
  return js;
}
const _keep_boolToJs = boolToJsWeekdays;
void _keep_boolToJs;
function parseFrequencyDetailToJsDays(detail?: string): number[] {
  if (!detail) return [];
  const tokens = detail.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    if (["mo", "mon", "monday"].includes(t)) out.push(1);
    else if (["tu", "tue", "tues", "tuesday"].includes(t)) out.push(2);
    else if (["we", "wed", "wednesday"].includes(t)) out.push(3);
    else if (["th", "thu", "thur", "thurs", "thursday"].includes(t)) out.push(4);
    else if (["fr", "fri", "friday"].includes(t)) out.push(5);
    else if (["sa", "sat", "saturday"].includes(t)) out.push(6);
    else if (["su", "sun", "sunday"].includes(t)) out.push(0);
  }
  return [...new Set(out)];
}
function weekdaysBoolToDetailString(weekdays: boolean[], fmt: "mo" | "tue" = "mo"): string {
  const labels = fmt === "tue" ? WEEKDAY_LONG_TUEFRI : WEEKDAY_SHORT_MON;
  const sel = (labels as readonly string[]).filter((_, i) => weekdays[i]);
  return sel.join(",");
}
// V30: dead code removed, weekdays helper direct
function nextDateMatchingWeekdays(from: Date, allowedJsDays: number[], hour: number, minute: number): Date {
  // finds next date >= from that matches allowedJsDays, preserving hour/minute
  // if from's day matches and time has not passed for today case, allow today
  const start = new Date(from);
  // search up to 14 days
  for (let offset = 0; offset < 14; offset++) {
    const cand = new Date(start);
    cand.setDate(start.getDate() + offset);
    cand.setHours(hour, minute, 0, 0);
    const jsDay = cand.getDay();
    if (allowedJsDays.includes(jsDay)) {
      if (offset === 0 && cand.getTime() < from.getTime()) continue;
      return cand;
    }
  }
  // fallback: return from
  return from;
}

function computeNextOccurrenceForDailyOrTwice(ev: CalendarEventV2, nowMs?: number): Date {
  const now = nowMs ? new Date(nowMs) : new Date();
  const base = new Date(ev.dueAt);
  const hour = base.getHours();
  const minute = base.getMinutes();
  const freq = ev.frequency;
  const detail = ev.frequencyDetail;
  if (!freq || freq === "once") return base;
  if (freq === "twice-week" || freq === "custom" || freq === "weekly" || freq === "biweekly" || freq === "monthly") {
    const jsDays = parseFrequencyDetailToJsDays(detail);
    if (jsDays.length > 0) {
      // if now is after base but base is future, we want next from now; else from base if base is future else now
      const reference = base.getTime() > now.getTime() ? base : now;
      const refTime = base; // keep hour/min from base
      return nextDateMatchingWeekdays(reference, jsDays, refTime.getHours(), refTime.getMinutes());
    }
  }
  if (freq === "daily") {
    // next daily at same time
    const ref = base.getTime() > now.getTime() ? base : now;
    const cand = new Date(ref);
    cand.setHours(hour, minute, 0, 0);
    if (cand.getTime() <= now.getTime()) cand.setDate(cand.getDate() + 1);
    return cand;
  }
  if (freq === "weekly" || freq === "biweekly" || freq === "monthly") {
    const ref = base.getTime() > now.getTime() ? base : now;
    let cand = new Date(ref);
    cand.setHours(hour, minute, 0, 0);
    if (freq === "monthly") {
      // V17 semantic monthly: preserve originalDom, Europe/Dublin, avoid Feb 29 drift
      const dom = (ev as any).originalDom ?? ev.dayOfMonth ?? base.getDate();
      const tzLocal = (ev as any).timezone || "Europe/Dublin";
      try {
        const fromPlus = new Date((ref.getTime() > base.getTime() ? ref.getTime() : base.getTime()) + 60*1000);
        let next = nextMonthlyFrom(fromPlus, dom, hour, minute, tzLocal);
        let guard = 0;
        while (next.getTime() <= now.getTime() && guard < 12) {
          next = nextMonthlyFrom(new Date(next.getTime()+ 3600*1000), dom, hour, minute, tzLocal);
          guard++;
        }
        return next;
      } catch {
        // fallback clamp using originalDom, not drifted base date
        let monthsAdd = 0;
        if (cand.getTime() <= now.getTime()) monthsAdd = 1;
        let next = new Date(Date.UTC(cand.getFullYear(), cand.getMonth(), 1, hour, minute, 0));
        next.setMonth(next.getMonth() + monthsAdd);
        const daysInMonth = new Date(next.getFullYear(), next.getMonth()+1, 0).getDate();
        next.setDate(Math.min(dom, daysInMonth));
        return next;
      }
    }
    const daysAdd = freq === "biweekly" ? 14 : 7;
    if (cand.getTime() <= now.getTime()) cand.setDate(cand.getDate() + daysAdd);
    return cand;
  }
  return base;
}

// --- new: proper weekdays recurring helpers for chores/calendar + biweekly parity ---

function computeNextDueFromWeekdays(from: Date, weekdaysBool: boolean[], intervalWeeks = 1): Date {
  if (!weekdaysBool.some(Boolean)) {
    const nxt = new Date(from);
    nxt.setDate(nxt.getDate()+1);
    nxt.setHours(9,0,0,0);
    return nxt;
  }
  const jsDays = boolToJsWeekdays(weekdaysBool);
  const hour = from.getHours();
  const minute = from.getMinutes();
  // FIX epoch anchor for intervalWeeks — use fixed Monday epoch, not from's Monday
  const epochWeekStart = weekNumberSinceEpoch(new Date(BIWEEKLY_EPOCH_MONDAY_UTC));
  const anchor = new Date(from);
  anchor.setHours(0,0,0,0);
  const dayIdx = (anchor.getDay()+6)%7;
  anchor.setDate(anchor.getDate()-dayIdx);
  const startWeekNum = intervalWeeks>1 ? epochWeekStart : weekNumberSinceEpoch(anchor);
  for (let offset=0; offset< 42; offset++) {
    const cand = new Date(from);
    cand.setDate(from.getDate()+offset);
    cand.setHours(hour, minute,0,0);
    const jsDay = cand.getDay();
    if (!jsDays.includes(jsDay)) continue;
    if (cand.getTime() < from.getTime() + 60000) continue;
    if (intervalWeeks>1) {
      const candMon = new Date(cand);
      candMon.setHours(0,0,0,0);
      const cDayIdx = (candMon.getDay()+6)%7;
      candMon.setDate(candMon.getDate()-cDayIdx);
      const candWeekNum = weekNumberSinceEpoch(candMon);
      if ((candWeekNum - startWeekNum) % intervalWeeks !== 0) continue;
    }
    return cand;
  }
  const fallback = new Date(from);
  fallback.setDate(fallback.getDate()+ (intervalWeeks>1?14:7));
  fallback.setHours(hour, minute,0,0);
  return fallback;
}

function computeNextDueDateChore(chore: ChoreV2, fromMs?: number): Date {
  const from = fromMs ? new Date(fromMs) : new Date();
  const fromPlus = new Date(from.getTime()+ 60*1000); // +1m to avoid now == due edge
  if (chore.frequencyDetail) {
    const jsDays = parseFrequencyDetailToJsDays(chore.frequencyDetail);
    if (jsDays.length>0) {
      // map interval
      const interval = chore.frequency==="biweekly"?2:1;
      // need weekdaysBool from jsDays — reconstruct bool
      // but simpler: use nextDateMatchingWeekdays logic with interval if biweekly
      if (interval>1) {
        // convert jsDays back to bool
        const bool: boolean[] = [false,false,false,false,false,false,false];
        // jsDay 1=Mo->0, 2=Tu->1 etc
        const mapJsToIdx: Record<number,number> = {1:0,2:1,3:2,4:3,5:4,6:5,0:6};
        jsDays.forEach(j=>{ const i=mapJsToIdx[j]; if(i!==undefined) bool[i]=true; });
        return computeNextDueFromWeekdays(fromPlus, bool, interval);
      }
      const baseHour = chore.dueAt? new Date(chore.dueAt).getHours(): 9;
      const baseMin = chore.dueAt? new Date(chore.dueAt).getMinutes():0;
      return nextDateMatchingWeekdays(fromPlus, jsDays, baseHour, baseMin);
    }
  }
  // fallback based on windowHours – monthly special
  if (chore.frequency === "monthly") {
    const base = chore.dueAt ? new Date(chore.dueAt) : new Date(chore.createdAt);
    const dom = (chore as any).originalDom ?? (chore as any).dayOfMonth ?? base.getDate();
    const hour = base.getHours(); const min = base.getMinutes();
    // FIX semantic monthly via nextMonthlyFrom Europe/Dublin preserving DOM each month Jan31->Feb28->Mar31
    const preservedDom = (chore as any).originalDom ?? dom;
    try {
      const cand = nextMonthlyFrom(fromPlus, preservedDom, hour, min, HOUSEHOLD_TZ);
      // ensure > fromPlus, loop months until future — but cand from nextMonthlyFrom already > fromPlus
      let next = cand;
      let guard = 0;
      while (next.getTime() <= fromPlus.getTime() && guard<12) {
        // use nextMonthlyFrom semantic advance, not naive +30d
        next = nextMonthlyFrom(new Date(next.getTime()+ 3600*1000), preservedDom, hour, min, HOUSEHOLD_TZ);
        guard++;
      }
      return next;
    } catch {
      // fallback: clamp with preservedDom, not drifting
      let cand = new Date(fromPlus); cand.setHours(hour, min, 0, 0);
      if (cand.getTime() <= fromPlus.getTime()) {
        cand.setMonth(cand.getMonth()+1);
        cand.setDate(1);
      }
      const dimFirst = clampDayOfMonth(cand.getFullYear(), cand.getMonth()+1, preservedDom);
      cand.setDate(dimFirst);
      while (cand.getTime() <= fromPlus.getTime()) {
        cand.setMonth(cand.getMonth()+1);
        const dim = clampDayOfMonth(cand.getFullYear(), cand.getMonth()+1, preservedDom);
        cand.setDate(dim);
      }
      return cand;
    }
  }
  const winH = windowHoursForChore(chore);
  const nxt = new Date(from.getTime()+ winH*3600*1000);
  return nxt;
}

// --- Shopping helpers ---
function freqToHours(freq: ShoppingFrequency): number | null {
  switch(freq){
    case "daily": return 24;
    case "every-2d": return 48;
    case "weekly": return 168;
    case "biweekly": return 336;
    case "monthly": return 720; // FIX window only — recurrence semantic in computeShoppingNextDue
    default: return null; // as-needed
  }
}
function computeShoppingNextDue(item: ShoppingItemV2, nowMs?: number): Date | null {
  const now = nowMs? new Date(nowMs): new Date();
  const baseRef = item.lastDoneAt ? new Date(item.lastDoneAt) : new Date(item.createdAt);
  const freq = item.frequency || "as-needed";
  if (freq==="as-needed") return null;
  // if weekly/biweekly with needDays, use weekdays logic
  if ((freq==="weekly" || freq==="biweekly") && item.needDays) {
    const jsDays = parseFrequencyDetailToJsDays(item.needDays);
    if (jsDays.length>0) {
      const interval = freq==="biweekly"?2:1;
      // Use generic next matching after now-ish (use now as reference for display)
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
      return nextDateMatchingWeekdays(refDate, jsDays, hour, minute);
    }
  }
  if (freq === "monthly") {
    // V17 semantic monthly Jan31->Feb28->Mar31 preserving original DOM, not 720h drift
    const baseHour = baseRef.getHours(); const baseMin = baseRef.getMinutes();
    const preservedDom = (item as any).originalDom ?? baseRef.getDate(); // shopping now preserves originalDom
    try {
      let cand = nextMonthlyFrom(new Date(baseRef.getTime()+ 60*1000), preservedDom, baseHour, baseMin, HOUSEHOLD_TZ);
      // advance until > now
      let guard=0;
      while (cand.getTime() <= now.getTime() && guard<24) {
        cand = nextMonthlyFrom(new Date(cand.getTime()+ 3600*1000), preservedDom, baseHour, baseMin, HOUSEHOLD_TZ);
        guard++;
      }
      return cand;
    } catch {
      // fallback old 720h but bounded using preservedDom via clamp
      const y = baseRef.getFullYear(); const m = baseRef.getMonth();
      const clamped = clampDayOfMonth(y, m+1, preservedDom);
      const h=720; const nxt=new Date(baseRef.getTime()+h*3600*1000);
      void clamped;
      if(nxt.getTime()<now.getTime()){
        const diffH=(now.getTime()-nxt.getTime())/3600000; const steps=Math.floor(diffH/h)+1; nxt.setTime(nxt.getTime()+steps*h*3600000);
      }
      return nxt;
    }
  }
  const h = freqToHours(freq);
  if (!h) return null;
  const nxt = new Date(baseRef.getTime()+ h*3600*1000);
  // if nxt is in past relative to now, advance by multiples
  if (nxt.getTime()<now.getTime()) {
    const diffH = (now.getTime()-nxt.getTime())/3600000;
    const steps = Math.floor(diffH / h)+1;
    nxt.setTime(nxt.getTime()+ steps*h*3600000);
  }
  return nxt;
}

function shoppingFrequencyBadge(it: ShoppingItemV2): string {
  const freq = it.frequency || "as-needed";
  if (freq==="as-needed") return "AS NEEDED";
  if (freq==="daily") return "DAILY";
  if (freq==="every-2d") return "EVERY 2D";
  if (freq==="weekly") {
    return it.needDays? "WEEKLY • "+ it.needDays.toUpperCase() : "WEEKLY";
  }
  if (freq==="biweekly") {
    return it.needDays? "2WK • "+ it.needDays.toUpperCase() : "EVERY 2 WKS";
  }
  if (freq==="monthly") return "MONTHLY";
  return (freq as string).toUpperCase();
}
function shoppingDueLabel(it: ShoppingItemV2, nowMs?: number): { label:string; overdue:boolean; dueSoon:boolean; next:Date|null } {
  const nxt = computeShoppingNextDue(it, nowMs);
  if (!nxt) return { label: it.lastDoneAt? "bought "+ relTime(it.lastDoneAt, nowMs||Date.now()) : "new", overdue:false, dueSoon:false, next:null };
  const diff = nxt.getTime() - (nowMs||Date.now());
  const hours = diff/3600000;
  const overdue = hours <0;
  if (overdue) return { label: "overdue by "+ Math.ceil(-hours/24)+"d", overdue:true, dueSoon:false, next:nxt };
  if (hours <24) return { label: "due today • "+ nxt.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}), overdue:false, dueSoon:true, next:nxt };
  if (hours <48) return { label: "due tomorrow", overdue:false, dueSoon:true, next:nxt };
  if (hours <168) return { label: "due "+ nxt.toLocaleDateString(undefined,{weekday:"short"}), overdue:false, dueSoon:false, next:nxt };
  return { label: "next "+ nxt.toLocaleDateString(undefined,{month:"short",day:"numeric"}), overdue:false, dueSoon:false, next:nxt };
}

function shoppingRestockText(it: ShoppingItemV2, nowMs?: number): { text:string; tone:"ok"|"soon"|"overdue"; due: Date|null } {
  const info = shoppingDueLabel(it, nowMs);
  const nxt = info.next;
  if (!nxt) {
    // as-needed fallback
    return { text: info.label, tone: "ok", due: null };
  }
  const diff = nxt.getTime() - (nowMs || Date.now());
  const days = Math.ceil(diff / 86400000);
  const hours = diff / 3600000;
  if (info.overdue) return { text: "Overdue • Restock now", tone: "overdue", due: nxt };
  if (hours <= 0) return { text: "Restock today", tone: "soon", due: nxt };
  if (hours < 24) return { text: "Restock today • " + nxt.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}), tone: "soon", due: nxt };
  if (hours < 48) return { text: "Restock tomorrow", tone: "soon", due: nxt };
  if (days === 1) return { text: "Restock tomorrow", tone: "soon", due: nxt };
  if (days <= 3) return { text: "Restock in " + days + " days", tone: "soon", due: nxt };
  if (days <= 6) return { text: "Restock in " + days + " days", tone: "ok", due: nxt };
  if (days <= 13) return { text: "Restock in " + Math.round(days) + "d • " + nxt.toLocaleDateString(undefined,{weekday:"short"}), tone: "ok", due: nxt };
  return { text: info.label, tone: info.dueSoon ? "soon" : "ok", due: nxt };
}

function parseNeedDaysToBool(s?: string): boolean[] {
  const out = [false,false,false,false,false,false,false];
  if (!s) return out;
  const toks = s.split(",").map(t=> t.trim().toLowerCase()).filter(Boolean);
  const map: Record<string,number> = {mo:0,mon:0,monday:0,tu:1,tue:1,tues:1,tuesday:1,we:2,wed:2,wednesday:2,th:3,thu:3,thur:3,thurs:3,thursday:3,fr:4,fri:4,friday:4,sa:5,sat:5,saturday:5,su:6,sun:6,sunday:6};
  for (const tk of toks) { const idx = (map as any)[tk]; if (idx!==undefined) out[idx]=true; }
  return out as any;
}
function boolToNeedDaysString(b: boolean[]): string | undefined {
  const labels=["Mo","Tu","We","Th","Fr","Sa","Su"];
  const sel = labels.filter((_,i)=> b[i]);
  return sel.length ? sel.join(",") : undefined;
}

function shoppingNeedDaysLabel(it: ShoppingItemV2): string {
  if (!it.needDays) return "";
  return it.needDays;
}


function getDueMsCal(ev: CalendarEventV2) {
  // Calendar is not a chore — no points / urgency
  // If repeat with weekdays, use next occurrence for display / due calc
  if (ev.frequency === "twice-week" || ev.frequency === "custom") {
    if (ev.frequencyDetail) {
      const nxt = computeNextOccurrenceForDailyOrTwice(ev, Date.now());
      return nxt.getTime();
    }
  }
  if (ev.start) return new Date(ev.start).getTime();
  return new Date(ev.dueAt).getTime();
}
function percentLeftCal(ev: CalendarEventV2, nowMs?: number) {
  void nowMs;
  // removed urgency multiplier for events
  return 1;
}
function isBonusCal(ev: CalendarEventV2, nowMs?: number) {
  void ev; void nowMs;
  return false;
}
function DoodleSun({ className = "h-5 w-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#292624" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="3.6" /><path d="M12 2.8v2.2M12 18.9V21M2.9 12H5.2M18.8 12H21M5 5l1.8 1.8M17.2 17.2l1.8 1.8M19 5l-1.8 1.8M6.8 17.2l-1.8 1.8" /></svg>;
}
function DoodleSparkle({ className = "h-5 w-5" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="#292624" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.8L13.4 8.2L19 10L13.4 11.8L12 17.2L10.6 11.8L5 10L10.6 8.2L12 2.8Z" /><path d="M18.4 12.6L19 14.6L20.9 15.2L19 15.9L18.4 18L17.7 15.9L15.8 15.2L17.7 14.6L18.4 12.6Z" /><path d="M6 14.2L6.6 15.6L8 16.2L6.6 16.9L6 18.4L5.3 16.9L3.9 16.2L5.3 15.6L6 14.2Z" /></svg>;
}
void DoodleSparkle;
function DoodleLeaf({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="#292624" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 2.2C6.2 2.9 3.8 5.2 3.8 8.3c0 2.3 1.6 4.1 4.7 4.1 0.8-0.9 1.4-2.3 1.4-3.8 0-2.8-1.7-5-1.4-6.4Z" /><path d="M8.2 6.2c0 0-1.1 1.3-1 3.0 0.1 1.1 0.7 2.0 1.3 2.7" /></svg>;
}
function DoodleJar({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="#292624" strokeWidth="1.5" strokeLinecap="round"><path d="M5.2 3.2h5.6M4.2 5.2h7.6v7.2c0 0.8-0.6 1.4-1.4 1.4H5.6c-0.8 0-1.4-0.6-1.4-1.4V5.2Z" /><path d="M6 7.2h4M6 9.2h4" /></svg>;
}
void DoodleJar;
function DoodleBroom({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="#292624" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11.8 2.2L3.2 10.8" /><path d="M10.2 11.2l-2.0 2.0 1.2 1.2 2.0-2.0" /><path d="M7.2 11.8l-2.5 1.0 1.0-2.5" /></svg>;
}
void DoodleBroom;
function IconHeart({ className = "h-4 w-4", filled = false }: { className?: string; filled?: boolean }) {
  return <svg viewBox="0 0 16 16" className={className} fill={filled ? "#E07A5F" : "none"} stroke="#292624" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13.2 4.9 10.3A3.8 3.8 0 0 1 4 7.6a2.9 2.9 0 0 1 5-2 2.9 2.9 0 0 1 5 2c0 1-.4 1.95-1.9 3.7L8 13.2Z" /></svg>;
}
function IconX({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="#5A5655" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4L4 12" /></svg>;
}
function IconCheck({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return <svg viewBox="0 0 12 12" className={className} fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6L5 8.5L9.5 3.5" /></svg>;
}
void IconCheck;
function IconChevronDown({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="#5A5655" strokeWidth="1.4" strokeLinecap="round"><path d="M3 6l5 4 5-4" /></svg>;
}
function IconChevronLeft({ className = "h-4 w-4" }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className} fill="none" stroke="#0A0A0A" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 3L5.5 8L10.5 13" /></svg>;
}
function GhostNum({ children }: { children: React.ReactNode }) {
  return <span className="font-display text-[38px] leading-none tracking-tight text-[var(--text)] opacity-[0.12] select-none">{children}</span>;
}
function MicroLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={"text-[11px] uppercase tracking-[0.14em] text-[var(--muted)] " + className}>{children}</span>;
}
function EmptyState({ icon, title, subtitle, ctaLabel, onCta, borderColor }: { icon?: React.ReactNode; title: string; subtitle?: string; ctaLabel?: string; onCta?: ()=>void; borderColor?: string }) {
  return (
    <div className="rounded-[20px] border border-dashed bg-[var(--card-bg)] px-6 py-8 text-center" style={{ borderColor: borderColor || "var(--border)" }}>
      <div className="mx-auto mb-3 grid h-[96px] w-[96px] place-items-center rounded-full bg-[var(--chip-bg)] border" style={{ borderColor: borderColor || "var(--border)" }}>
        {icon || <DoodleSun className="h-[48px] w-[48px] opacity-80" />}
      </div>
      <div className="font-display text-[14px] font-medium text-[var(--text)]">{title}</div>
      {subtitle && <div className="mt-1 text-[11px] text-[var(--muted)] max-w-[240px] mx-auto">{subtitle}</div>}
      {ctaLabel && onCta && <button onClick={onCta} className="mt-3 rounded-full bg-[#0A0A0A] px-4 py-2.5 text-[11px] font-medium text-white active:scale-[0.97] min-h-[44px]">{ctaLabel}</button>}
    </div>
  );
}

function useIsDebug(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("debug") || url.searchParams.get("debug") === "1") return true;
  } catch {}
  try {
    if (localStorage.getItem("couple_v1_debug") === "1") return true;
  } catch {}
  try {
    if ((window as any).__NYLAH_DEBUG__) return true;
  } catch {}
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) return true;
  return false;
}

function BottomSheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  // keep latest onClose without re-triggering effect (parent re-renders every sync tick otherwise close flickers)
  useEffect(()=>{ onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
      }
      if (e.key === "Tab" && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0] as HTMLElement;
        const last = focusable[focusable.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", h);
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = (document.documentElement as any).style?.overscrollBehavior;
    document.body.style.overflow = "hidden";
    try { (document.documentElement as any).style.overscrollBehavior = "none"; } catch {}
    requestAnimationFrame(() => {
      if (sheetRef.current) {
        const auto = sheetRef.current.querySelector<HTMLElement>('[autofocus]');
        if (auto) auto.focus();
        else {
          const first = sheetRef.current.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          first?.focus();
        }
      }
    });
    // NOTE: history push/pop removed — it was the source of polling/nowMs re-renders closing sheets instantly.
    // Escape + backdrop click handled via onCloseRef. Back button simply does browser back; sheet will unmount via parent.
    return () => {
      document.removeEventListener("keydown", h);
      document.body.style.overflow = prevOverflow;
      try { (document.documentElement as any).style.overscrollBehavior = prevOverscroll || ""; } catch {}
      try { prevFocusRef.current?.focus(); } catch {}
    };
  }, [open]);
  if (!open) return null;
  const content = (
    <div className="fixed inset-0 z-[80] flex items-end justify-center px-3 pb-[max(16px,env(safe-area-inset-bottom))] pointer-events-auto">
      <button aria-label="Close sheet" onClick={onClose} className="absolute inset-0 bg-[#292624]/20 backdrop-blur-[3px] min-h-[44px]" />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby={title ? "sheet-title" : undefined} className="relative w-full max-w-[420px] animate-[sheetIn_0.24s_ease] rounded-[16px] bg-[var(--card-bg)] border shadow-[0_-16px_48px_rgba(0,0,0,0.18)] max-h-[72dvh] flex flex-col focus:outline-none" style={{ borderColor: "var(--border)" }} tabIndex={-1}>
        <div className="flex items-center justify-center pt-3 pb-2 shrink-0" aria-hidden="true"><span className="rounded-full bg-[var(--border)]" style={{ width: "36px", height: "5px", display: "block" }} /></div>
        <div className="flex items-center justify-between px-5 pb-3 shrink-0 gap-2">
          {title ? <div id="sheet-title" className="font-display text-[16px] font-medium text-[var(--text)]">{title}</div> : <div className="flex-1" />}
          <button onClick={onClose} aria-label="Close" className="grid h-[44px] w-[44px] place-items-center rounded-full bg-[var(--card-bg)] border hover:bg-[var(--chip-bg)] shrink-0" style={{ borderColor: "var(--border)" }}>
            <span aria-hidden="true" className="text-[14px]"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></span>
          </button>
        </div>
        <div className="px-4 pb-6 overflow-auto no-scrollbar overscroll-contain">{children}</div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}
// PIN_MAP removed — now hashed in lib/pins.ts (interim device-local only, see SECURITY.md)


export type SyncKind = 'saving' | 'saved' | 'offline-queued' | 'failed' | 'updated-elsewhere';
export type SyncStatus = {
  kind: SyncKind;
  queueCount?: number;
  lastSavedAt?: string; // ISO
  error?: string;
  updatedElsewhere?: boolean;
};

/**
 * SyncStatusIsolated — now a pure presentational component.
 * It does NOT own online/offline listeners or interval timers.
 * Parent (V1AppShell) owns one sync engine, one visibility listener,
 * one focus listener, and passes truthful status as prop.
 * This fixes the leak where each render mounted new listeners + 1s tick.
 */
function SyncStatusIsolated({ syncStatus, onRetry }: { syncStatus: SyncStatus; onRetry?: ()=>void }) {
  const kind = syncStatus.kind;
  if (kind === 'saving') {
    return <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B] animate-pulse" />Saving…</span>;
  }
  if (kind === 'failed') {
    return (
      <button onClick={onRetry} className="inline-flex items-center gap-1.5 text-[11px] text-[#B91C1C] hover:text-[#991B1B] transition min-h-[20px]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />Failed — Retry{syncStatus.error ? ` • ${syncStatus.error.slice(0,24)}` : ''}
      </button>
    );
  }
  if (kind === 'offline-queued') {
    const n = syncStatus.queueCount ?? 1;
    return <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF]" />Offline — {n} queued</span>;
  }
  if (kind === 'updated-elsewhere') {
    return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#7C5CFC]"><span className="h-1.5 w-1.5 rounded-full bg-[#A89FDA] animate-pulse" />Updated elsewhere</span>;
  }
  // saved — truthful: only shown after server ack. No timer that re-renders every second.
  // Show absolute time via title, not "Xs ago" that required 1s interval.
  const last = syncStatus.lastSavedAt ? new Date(syncStatus.lastSavedAt).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' }) : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]" title={syncStatus.lastSavedAt || undefined}>
      <span className="rounded-full bg-[#8DA08E]" style={{ width:"6px", height:"6px", display:"inline-block" }} />
      {last ? `Saved ${last}` : 'Saved'}
    </span>
  );
}

// --- ONBOARDING: open Nylah to other couples (friends beta) ---
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(6);
  try { crypto.getRandomValues(arr); } catch { for(let i=0;i<6;i++) arr[i]=Math.floor(Math.random()*chars.length); }
  let code = "";
  for (let i=0;i<6;i++) code += chars[arr[i]%chars.length];
  return code;
}
async function hashPinHex(pin: string): Promise<string> {
  const trimmed = pin.trim();
  try {
    const buf = new TextEncoder().encode(trimmed);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const arr = new Uint8Array(digest);
    let hex = '';
    for (let i=0;i<arr.length;i++) hex += arr[i].toString(16).padStart(2,'0');
    return hex;
  } catch { return trimmed; }
}
function getStoredHouseholdId(): string | null {
  try { return localStorage.getItem("couple_v1_household_id"); } catch { return null; }
}
function hasAnyLegacyData(): boolean {
  try {
    const meaningful = ["couple_v1_household_id","couple_v1_household_persons","couple_v1_currentUser","couple_v1_household_code","couple_v1_household_name","couple_v1_household_persons_","couple_v1_household_pins"];
    for (let i=0;i<localStorage.length;i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (meaningful.some(p=>k.startsWith(p))) return true;
    }
  } catch {}
  return false;
}
function shouldShowOnboarding(): boolean {
  try {
    try{ if(localStorage.getItem("couple_v1_force_onboard")==="1") return true; }catch{}

    const hid = getStoredHouseholdId();
    if (hid && hid.length>=3) return false;
    if (hasAnyLegacyData()) return false;
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.get("onboard")==="0") return false;
      if (sp.get("onboard")==="1") return true;
    } catch {}
    return true;
  } catch { return true; }
}

function OnboardingFlow({ onComplete }: { onComplete: (hid: string)=>void }) {
  const [step, setStep] = useState<"welcome"|"create_names"|"create_pins"|"creating"|"share"|"join_code"|"join_pick"|"joining">("welcome");
  const [youName, setYouName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [youPin, setYouPin] = useState("");
  const [partnerPin, setPartnerPin] = useState("");
  const [inviteCode, setInviteCode] = useState<string>("");
  const [householdId, setHouseholdId] = useState<string>("");
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinMeta, setJoinMeta] = useState<any>(null);
  const [joinPersons, setJoinPersons] = useState<any[]>([]);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);

  // auto-fill invite code from shared link ?code=XXXX
  useEffect(()=>{
    try {
      const sp = new URLSearchParams(location.search);
      const c = sp.get("code");
      if (c && c.length>=4) {
        const clean = c.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
        setJoinCode(clean);
        // if welcome screen still, nudge to join_code to reduce friction
        setStep(s => s==="welcome" ? "join_code" : s);
      }
    } catch {}
  }, []);

  const canContinueNames = youName.trim().length>=1 && partnerName.trim().length>=1;
  const canContinuePins = /^\d{4}$/.test(youPin) && /^\d{4}$/.test(partnerPin) && youPin!==partnerPin;

  const startCreate = () => {
    setError("");
    if (!canContinueNames) { setError("Add both names"); return; }
    setStep("create_pins");
  };
  const doCreate = async () => {
    setError("");
    if (!canContinuePins) { setError("Both PINs must be 4 digits and different"); return; }
    setCreating(true); setStep("creating");
    try {
      const code = generateInviteCode();
      const hid = `nylah-${code.toLowerCase()}`;
      setInviteCode(code); setHouseholdId(hid);
      const hashA = await hashPinHex(youPin);
      const hashB = await hashPinHex(partnerPin);
      const pinMapHashed: Record<string,string> = {};
      pinMapHashed[hashA] = "aisling";
      pinMapHashed[hashB] = "ciaran";
      const plainMap: Record<string,string> = {};
      plainMap[youPin] = "aisling";
      plainMap[partnerPin] = "ciaran";
      const persons = [
        { key:"aisling", name: youName.trim(), initial: youName.trim().slice(0,1).toUpperCase() },
        { key:"ciaran", name: partnerName.trim(), initial: partnerName.trim().slice(0,1).toUpperCase() },
      ];
      try {
        localStorage.setItem("couple_v1_household_id", hid);
        localStorage.setItem("couple_v1_household_code", code);
        localStorage.setItem("couple_v1_household_name", `${youName.trim()} & ${partnerName.trim()}`);
        localStorage.setItem(`couple_v1_household_persons_${hid}`, JSON.stringify(persons));
        localStorage.setItem(`couple_v1_household_persons`, JSON.stringify(persons));
        localStorage.setItem(`couple_v1_household_pins_${hid}`, JSON.stringify(pinMapHashed));
        localStorage.setItem(`couple_v1_household_pins_plain_${hid}`, JSON.stringify(plainMap));
        try { (window as any).__HOUSEHOLD_PINS__ = pinMapHashed; } catch {}
      } catch {}
      try {
        const sb = getSupabase();
        if (sb) {
          const meta = {
            householdName: `${youName.trim()} & ${partnerName.trim()}`,
            householdId: hid,
            inviteCode: code,
            persons,
            pinHashes: pinMapHashed,
            createdAt: new Date().toISOString(),
            onboardedAt: new Date().toISOString(),
            tz: "Europe/Dublin",
          };
          const row = {
            id: hid,
            chores: [],
            calendar: [],
            shopping: [],
            notes: [],
            meta,
            updated_at: new Date().toISOString(),
            revision: 1,
          };
          const { error: insErr } = await (sb as any).from(SB_TABLE).upsert(row, { onConflict: 'id' });
          if (insErr) console.warn("[onboard] supabase upsert error", insErr.message);
        }
      } catch (e:any) { console.warn("[onboard] sb err", e?.message); }
      setCreating(false);
      setStep("share");
      try { applyCustomPersonNames(); } catch {}
    } catch (e:any) {
      setCreating(false);
      setError("Couldn't create — try again: "+String(e?.message||e).slice(0,80));
      setStep("create_pins");
    }
  };
  const doCopyCode = async () => {
    try { await navigator.clipboard.writeText(inviteCode); setError("Copied!"); setTimeout(()=>setError(""), 1200); } catch { setError(inviteCode); }
  };
  const doShare = async () => {
    const url = `${location.origin}${location.pathname}?code=${inviteCode}`;
    const text = `Join our Beirt — our private space for two. Code: ${inviteCode} — ${url}`;
    try {
      if ((navigator as any).share) {
        await (navigator as any).share({ title: "Join us on Beirt", text, url });
      } else {
        await navigator.clipboard.writeText(text);
        setError("Link copied!");
        setTimeout(()=>setError(""), 1200);
      }
    } catch {}
  };
  const startJoin = () => { setError(""); setJoinCode(""); setStep("join_code"); };
  const doJoinLookup = async () => {
    setError("");
    const code = joinCode.trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
    if (code.length<4) { setError("Enter the 6-letter code"); return; }
    setJoining(true);
    try {
      const hid = `nylah-${code.toLowerCase()}`;
      const sb = getSupabase();
      if (!sb) { setError("No connection — check internet"); setJoining(false); return; }
      let data: any = null;
      const res1 = await (sb as any).from(SB_TABLE).select('*').eq('id', hid).maybeSingle();
      data = res1.data;
      if (!data) {
        const res2 = await (sb as any).from(SB_TABLE).select('*').eq('id', code.toLowerCase()).maybeSingle();
        if (res2.data) data = res2.data;
      }
      if (!data) {
        setError("No couple found with that code — check letters");
        setJoining(false);
        return;
      }
      const meta = (data as any).meta;
      setJoinMeta(meta);
      const persons = meta?.persons || [{key:"aisling", name:"Partner 1"}, {key:"ciaran", name:"Partner 2"}];
      setJoinPersons(persons);
      setInviteCode(code);
      setHouseholdId(hid);
      setJoining(false);
      setStep("join_pick");
    } catch (e:any) {
      setJoining(false);
      setError("Couldn't find — try again: "+String(e?.message||e).slice(0,60));
    }
  };
  const doJoinAs = async (personKey: string) => {
    setError(""); setJoining(true);
    try {
      const persons = joinPersons;
      const meta = joinMeta;
      const pinHashes = meta?.pinHashes || {};
      try {
        localStorage.setItem("couple_v1_household_id", householdId);
        localStorage.setItem("couple_v1_household_code", inviteCode);
        localStorage.setItem("couple_v1_household_name", meta?.householdName || "You & Partner");
        localStorage.setItem(`couple_v1_household_persons_${householdId}`, JSON.stringify(persons));
        localStorage.setItem(`couple_v1_household_persons`, JSON.stringify(persons));
        if (pinHashes && typeof pinHashes === 'object' && Object.keys(pinHashes).length>0) {
          localStorage.setItem(`couple_v1_household_pins_${householdId}`, JSON.stringify(pinHashes));
          try { (window as any).__HOUSEHOLD_PINS__ = pinHashes; } catch {}
        }
      } catch {}
      try { applyCustomPersonNames(); } catch {}
      setJoining(false);
      onComplete(householdId);
    } catch (e:any) {
      setJoining(false);
      setError("Join failed: "+String(e?.message||e).slice(0,60));
    }
  };

  return (
    <div className="absolute inset-0 z-[90] flex items-center justify-center bg-[var(--bg)] px-6 overflow-auto" style={{ background: "linear-gradient(180deg,var(--chip-bg) 0%,var(--card-bg) 60%,var(--wash-top) 100%)" }}>
      <div className="w-full max-w-[360px] rounded-[28px] border bg-[var(--card-bg)] shadow-[0_18px_50px_rgba(0,0,0,0.10)] px-6 py-7 flex flex-col items-center" style={{ borderColor:"var(--border)" }}>
        {step==="welcome" && (
          <>
            <div className="h-12 w-12 rounded-full grid place-items-center bg-[#0A0A0A] text-white text-[20px] font-display">♥</div>
            <div className="mt-3 font-display text-[26px] font-semibold tracking-tight text-[#0A0A0A] text-center">Nylah</div>
            <div className="mt-1 text-[13px] text-[#6B5242] text-center leading-[1.4]">A private space for two. Shared calendar, chores, shopping, notes. No ads. Just you two.</div>
            <div className="mt-5 w-full space-y-2.5">
              <button onClick={()=> setStep("create_names")} className="w-full h-[52px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold active:scale-[0.98] shadow-sm">Create our space</button>
              <button onClick={startJoin} className="w-full h-[48px] rounded-full bg-white border border-[var(--border)] text-[#2D2118] text-[13px] font-medium active:scale-[0.98]">I have a code</button>
            </div>
            <div className="mt-4 text-[11px] text-[#8B7357] text-center">For friends beta — invite only. Your data stays in your own household.</div>
            {false && <span/>}
          </>
        )}
        {step==="create_names" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("welcome")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">What should we call you two?</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">These show up everywhere — on chips, calendar dots, notes.</div>
            </div>
            <div className="mt-4 w-full space-y-3">
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">You</label>
                <input value={youName} onChange={e=> setYouName(e.target.value)} placeholder="e.g. Maya" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-[14px] outline-none" style={{borderColor:"var(--border)"}} autoFocus />
              </div>
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">Your partner</label>
                <input value={partnerName} onChange={e=> setPartnerName(e.target.value)} placeholder="e.g. Jon" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-[14px] outline-none" style={{borderColor:"var(--border)"}} />
              </div>
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B] w-full">{error}</div>}
            <button disabled={!canContinueNames} onClick={startCreate} className={"mt-5 w-full h-[48px] rounded-full text-[14px] font-semibold active:scale-[0.98] "+(canContinueNames?"bg-[#0A0A0A] text-white shadow-sm":"bg-[var(--chip-bg)] text-[#8B7357]")}>Continue</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">You can change names later in Settings</div>
          </>
        )}
        {step==="create_pins" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("create_names")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Set your 4-digit PINs</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">Each of you gets your own. This is your lock screen — fingerprint will be a quick tap on top of it.</div>
            </div>
            <div className="mt-4 w-full space-y-3">
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">{youName||"You"}’s PIN</label>
                <input value={youPin} onChange={e=> setYouPin(e.target.value.replace(/\D/g,"").slice(0,4))} inputMode="numeric" placeholder="••••" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-center text-[18px] tracking-[0.3em] outline-none" style={{borderColor:"var(--border)"}} />
              </div>
              <div>
                <label className="text-[11px] text-[#6B5242] font-medium">{partnerName||"Partner"}’s PIN</label>
                <input value={partnerPin} onChange={e=> setPartnerPin(e.target.value.replace(/\D/g,"").slice(0,4))} inputMode="numeric" placeholder="••••" className="mt-1 w-full rounded-[14px] border bg-white px-3 py-3 text-center text-[18px] tracking-[0.3em] outline-none" style={{borderColor:"var(--border)"}} />
              </div>
              <div className="text-[10px] text-[#8B7357]">Must be different. You can also set up fingerprint after — in Settings → Fingerprint.</div>
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B] w-full">{error}</div>}
            <button disabled={!canContinuePins} onClick={doCreate} className={"mt-5 w-full h-[48px] rounded-full text-[14px] font-semibold active:scale-[0.98] "+(canContinuePins?"bg-[#0A0A0A] text-white shadow-sm":"bg-[var(--chip-bg)] text-[#8B7357]")}>{creating?"Creating…":"Create our couple space"}</button>
          </>
        )}
        {step==="creating" && (
          <div className="py-10 text-center">
            <div className="h-10 w-10 rounded-full bg-[var(--chip-bg)] animate-pulse mx-auto grid place-items-center">♥</div>
            <div className="mt-3 text-[14px] font-medium text-[#2D2118]">Creating your private space…</div>
            <div className="mt-1 text-[11px] text-[#6B5242]">Generating invite code, saving your household</div>
          </div>
        )}
        {step==="share" && (
          <>
            <div className="h-10 w-10 rounded-full bg-[#0A0A0A] text-white grid place-items-center">✓</div>
            <div className="mt-3 font-display text-[20px] font-semibold text-[#0A0A0A] text-center">You’re set!</div>
            <div className="mt-1 text-[12px] text-[#6B5242] text-center">Share this code with {partnerName||"your partner"} so they can join your space.</div>
            <div className="mt-4 w-full rounded-[20px] border bg-[var(--chip-bg)] px-4 py-4 text-center" style={{borderColor:"var(--border)"}}>
              <div className="text-[11px] uppercase tracking-[0.12em] text-[#8B7357]">Invite code</div>
              <div className="mt-1 font-mono text-[28px] font-bold tracking-[0.18em] text-[#0A0A0A]">{inviteCode}</div>
              <div className="mt-1 text-[11px] text-[#6B5242]">nylah-{inviteCode?.toLowerCase()} • private to you two</div>
              <div className="mt-3 flex gap-2 justify-center">
                <button onClick={doCopyCode} className="h-[36px] rounded-full bg-white border border-[var(--border)] px-4 text-[11px] font-semibold">Copy code</button>
                <button onClick={doShare} className="h-[36px] rounded-full bg-[#0A0A0A] text-white px-4 text-[11px] font-semibold">Share link</button>
              </div>
            </div>
            {error && <div className="mt-2 text-[11px] text-[#6B5242]">{error}</div>}
            <button onClick={()=> onComplete(householdId)} className="mt-4 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold active:scale-[0.98]">Continue to our space →</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">Your partner can join anytime from their phone with the code. Until they join, you can use it solo.</div>
          </>
        )}
        {step==="join_code" && (
          <>
            <div className="w-full text-left">
              <button onClick={()=> setStep("welcome")} className="text-[11px] text-[#8B7357]">← Back</button>
              <div className="mt-2 font-display text-[20px] font-semibold text-[#0A0A0A]">Enter your invite code</div>
              <div className="mt-1 text-[12px] text-[#6B5242]">Your partner should have sent you a 6-letter code like ABC123.</div>
            </div>
            <input value={joinCode} onChange={e=> setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6))} placeholder="ABC123" className="mt-4 w-full rounded-[16px] border bg-white px-4 py-4 text-center font-mono text-[20px] tracking-[0.22em] outline-none" style={{borderColor:"var(--border)"}} autoFocus />
            {error && <div className="mt-2 text-[11px] text-[#991B1B] w-full text-center">{error}</div>}
            <button onClick={doJoinLookup} disabled={joining} className="mt-4 w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[14px] font-semibold disabled:opacity-60 active:scale-[0.98]">{joining?"Looking up…":"Join our space"}</button>
            <div className="mt-2 text-[10px] text-[#8B7357] text-center">Codes are single-household private. If it’s expired, ask your partner to go to Settings → Share invite code and send a new one.</div>
          </>
        )}
        {step==="join_pick" && (
          <>
            <div className="h-10 w-10 rounded-full bg-[var(--chip-bg)] grid place-items-center text-[16px]">♥</div>
            <div className="mt-3 font-display text-[18px] font-semibold text-[#0A0A0A] text-center">Which one are you?</div>
            <div className="mt-1 text-[12px] text-[#6B5242] text-center">{joinMeta?.householdName||"You two"} — pick your name to link your phone.</div>
            <div className="mt-4 w-full space-y-2">
              {joinPersons.map((p:any)=> (
                <button key={p.key} onClick={()=> doJoinAs(p.key)} disabled={joining} className="w-full flex items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left active:scale-[0.98]" style={{borderColor:"var(--border)"}}>
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px] font-bold">{p.initial||p.name?.slice(0,1).toUpperCase()}</span>
                  <span className="flex-1"><div className="text-[14px] font-medium">{p.name}</div><div className="text-[11px] text-[#6B5242]">Tap to join as {p.name}</div></span>
                  <span className="text-[11px] text-[#8B7357]">→</span>
                </button>
              ))}
            </div>
            {error && <div className="mt-3 text-[11px] text-[#991B1B]">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function WhoScreen({ onSelect }: { onSelect: (k: PersonKey) => void }) {
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [popIdx, setPopIdx] = useState<number | null>(null);
  const [remember, setRemember] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("couple_v1_remember_user");
      if (v === "1" || v === '"1"' || v === "true") return true;
      return false;
    } catch { return false; }
  });
  const [checking, setChecking] = useState(false);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState<PersonKey[]>([]);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioError, setBioError] = useState<string>("");

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const ok = await canDoPlatformBiometric();
        if (cancelled) return;
        setBioSupported(ok);
        const enrolled: PersonKey[] = [];
        try{
          if (localStorage.getItem(webAuthnIdKey("aisling"))) enrolled.push("aisling");
          if (localStorage.getItem(webAuthnIdKey("ciaran"))) enrolled.push("ciaran");
        }catch{}
        setBioEnrolled(enrolled);
      }catch{}
    })();
    return ()=>{ cancelled=true; };
  },[]);

  const handleBiometric = async () => {
    if (bioLoading) return;
    setBioLoading(true); setBioError("");
    try{
      const who = await authenticateBiometric();
      if (who) {
        try{
          localStorage.setItem("couple_v1_remember_user", "1");
          try { sessionStorage.removeItem("couple_v1_ephemeral_session"); } catch {}
        }catch{}
        onSelect(who as PersonKey);
      } else {
        setBioError("couldn't verify — try again or use PIN");
      }
    } catch {
      setBioError("Face ID not available — use PIN or re-enable in Settings");
    } finally { setBioLoading(false); }
  };

  const tryPin = async (code: string) => {
    if (checking) return;
    setChecking(true);
    try {
      const who = await verifyPin(code);
      if (who) {
        try {
          localStorage.setItem("couple_v1_remember_user", remember ? "1" : "0");
          if (!remember) {
            try { sessionStorage.setItem("couple_v1_ephemeral_session", "1"); } catch {}
          } else {
            try { sessionStorage.removeItem("couple_v1_ephemeral_session"); } catch {}
          }
        } catch {}
        onSelect(who as PersonKey);
      } else {
        setWrong(true);
        setShaking(true);
        try { (navigator as any).vibrate?.([30,50,30]); } catch {}
        setTimeout(() => setShaking(false), 460);
        setTimeout(() => setPin(""), 380);
      }
    } catch {
      setWrong(true);
      setShaking(true);
      try { (navigator as any).vibrate?.([30,50,30]); } catch {}
      setTimeout(() => setShaking(false), 460);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (pin.length === 4) tryPin(pin);
  }, [pin]);

  const pushDigit = (d: string) => {
    if (pin.length >= 4 || checking) return;
    setWrong(false);
    setPopIdx(pin.length);
    setPin((p) => (p + d).slice(0, 4));
    setTimeout(()=> setPopIdx(null), 190);
  };
  const doBackspace = () => {
    if (pin.length===0) return;
    setWrong(false);
    setPin((p) => p.slice(0, -1));
  };

  const nameA = PERSONS.ciaran?.name || "Ciaran";
  const nameB = PERSONS.aisling?.name || "Aisling";

  return (
    <div
      className="absolute inset-0 z-[80] flex flex-col items-center justify-center px-6 py-8 overflow-auto"
      style={{ background: "linear-gradient(180deg,var(--wash-top), var(--card-bg))", minHeight:"100%" }}
    >
      <div className="absolute inset-0 pointer-events-none opacity-[0.20] mix-blend-multiply" aria-hidden style={{ opacity: 0.20 }}>
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <filter id="grain-who">
            <feTurbulence type="fractalNoise" baseFrequency="0.92" numOctaves={4} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain-who)" />
        </svg>
      </div>

      <style>{`
        @keyframes whoShake{0%,100%{transform:translateX(0)}15%,45%,75%{transform:translateX(-7px)}30%,60%,90%{transform:translateX(7px)}}
        @keyframes whoPop{0%{transform:scale(1)}45%{transform:scale(1.3)}100%{transform:scale(1)}}
        @keyframes whoShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
        @keyframes whoFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .who-shake{animation:whoShake 440ms cubic-bezier(.36,.07,.19,.97) both}
        .who-dot-pop{animation:whoPop 180ms cubic-bezier(0.34,1.56,0.64,1) both}
        .who-card{animation:whoFadeIn 420ms cubic-bezier(.16,1,.3,1) both}
      `}</style>

      <div className="who-card w-full max-w-[344px] relative z-10 flex flex-col items-center">
        <div className="flex flex-col items-center mb-7">
          <div
            className="flex items-center gap-[9px] tracking-tight select-none"
            style={{ fontFamily:'"Fraunces", ui-serif, Georgia, serif', fontSize:'26px', fontWeight:600 as any, letterSpacing:'-0.02em', color:'var(--text)' }}
          >
            <span>{nameA}</span>
            <span className="inline-flex -mt-[1px]" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 16 16" fill="#E07A5F" xmlns="http://www.w3.org/2000/svg" style={{ display:'block', filter:'drop-shadow(0 1.5px 3px rgba(224,122,95,0.38)) drop-shadow(0 0 8px rgba(224,122,95,0.18))' }}>
                <path d="M8 13.2 L3.6 9.3 A2.85 2.85 0 0 1 2.9 7.15 A2.36 2.36 0 0 1 5.08 5.03 A2.20 2.20 0 0 1 8 6.35 A2.20 2.20 0 0 1 10.92 5.03 A2.36 2.36 0 0 1 13.10 7.15 C13.10 7.93 12.84 8.54 12.4 9.28 L8 13.2Z" />
              </svg>
            </span>
            <span>{nameB}</span>
          </div>
          <div className="mt-1.5 text-[11px] tracking-wide uppercase text-[var(--muted)] font-medium opacity-80">private • just you two</div>
        </div>

        <div
          className={"w-full rounded-[28px] border px-6 pt-7 pb-6 flex flex-col items-center shadow-[0_18px_48px_rgba(0,0,0,0.10),0_1px_0_rgba(255,255,255,0.6)_inset] " + (shaking ? "who-shake " : "")}
          style={{
            background:'var(--card-bg)',
            borderColor: wrong ? '#E07A5F' : 'var(--border)',
            boxShadow: wrong ? '0 0 0 2px rgba(224,122,95,0.22), 0 16px 40px rgba(0,0,0,0.08)' : undefined,
            transition:'border-color 180ms, box-shadow 180ms'
          }}
        >
          <div className="text-[13px] font-semibold tracking-wide text-[var(--muted)] uppercase">Enter PIN</div>

          <div className="mt-4 flex items-center gap-3" role="status" aria-label={`PIN ${pin.length} of 4`}>
            {[0,1,2,3].map(i=>{
              const filled = i < pin.length;
              const isPop = popIdx===i && filled;
              return (
                <div
                  key={i}
                  className={"grid h-[16px] w-[16px] place-items-center rounded-full border transition-all duration-150 " + (isPop ? "who-dot-pop " : "")}
                  style={{
                    borderColor: wrong ? '#E07A5F' : filled ? 'var(--text)' : 'var(--border)',
                    background: filled ? (wrong ? '#E07A5F' : 'var(--text)') : 'transparent',
                    transform: filled ? undefined : 'scale(0.95)',
                  }}
                >
                  <div className="h-[6px] w-[6px] rounded-full bg-white/90" style={{ opacity: filled ? (wrong?1:0) : 0 }} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 min-h-[18px] text-[11px] font-medium tracking-wide" style={{ color: wrong ? '#B91C1C' : 'transparent' }}>
            {wrong ? 'wrong code — try again' : '·'}
          </div>

          {bioSupported && bioEnrolled.length>0 && (
            <div className="mt-1 w-full">
              <button
                onClick={handleBiometric}
                disabled={bioLoading}
                className="group relative w-full h-[56px] min-h-[56px] overflow-hidden rounded-full bg-[#0A0A0A] text-white text-[13.5px] font-semibold flex items-center justify-center gap-2.5 active:scale-[0.98] disabled:opacity-60 shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                style={{ transition:'transform 220ms cubic-bezier(0.34,1.56,0.64,1), opacity 160ms' }}
              >
                <span className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                  <span className="absolute inset-0" style={{ background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)', transform:'translateX(-100%)', animation:'whoShimmer 2.2s infinite' }} />
                </span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round"><path d="M7 10a5 5 0 0 1 10 0v1a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-2a3 3 0 0 0-6 0v2a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2v-1Z"/><path d="M9 18h6"/></svg>
                <span>{bioLoading ? "Checking…" : `Unlock with ${PERSONS[bioEnrolled[0]]?.name || 'Face ID'}`}</span>
              </button>
              <div className="mt-2 text-[11px] text-[var(--muted)] text-center leading-snug">
                {bioEnrolled.map(u=>PERSONS[u].name).join(" or ")} • this device only
              </div>
              {bioError && <div className="mt-1.5 text-[11px] text-[#B91C1C] text-center px-2">{bioError}</div>}
              <div className="my-4 h-px w-full bg-[var(--border)] opacity-60" />
            </div>
          )}

          <div className="w-full grid grid-cols-3 gap-3 mt-2">
            {[1,2,3,4,5,6,7,8,9].map((n) => (
              <button
                key={n}
                onClick={() => pushDigit(String(n))}
                className="h-[52px] min-h-[52px] min-w-[52px] rounded-full border bg-[var(--card-bg)] text-[17px] font-[600] tracking-tight text-[var(--text)] active:scale-[0.96] hover:brightness-[0.98] select-none"
                style={{
                  borderColor:'var(--border)',
                  background:'var(--chip-bg)',
                  transition:'transform 160ms cubic-bezier(0.34,1.56,0.64,1), background 150ms',
                }}
                aria-label={`Digit ${n}`}
              >
                {n}
              </button>
            ))}
            <div className="min-h-[64px] grid place-items-start pt-1 justify-items-center">
              <label className="flex flex-col items-center justify-center cursor-pointer group select-none w-[74px]" title="Remember device – stay logged in">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e=> { const v=e.target.checked; setRemember(v); try{ localStorage.setItem("couple_v1_remember_user", v?"1":"0"); }catch{} }}
                  className="peer sr-only"
                  aria-label="Stay logged in on this device"
                />
                <span className="h-[28px] w-[44px] rounded-full bg-[var(--border)] relative transition-colors duration-200 peer-checked:bg-[#0A0A0A] flex items-center px-[3px] shrink-0">
                  <span className="h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-transform duration-200 translate-x-0 peer-checked:translate-x-[16px]" style={{ display:'inline-block' } as any} />
                </span>
                <span className="mt-1.5 max-w-[74px] text-center text-[10px] font-semibold tracking-[0.02em] leading-[1.15] text-[var(--muted)] peer-checked:text-[var(--text)] whitespace-normal break-words normal-case">Stay logged in</span>
              </label>
            </div>
            <button
              onClick={() => pushDigit("0")}
              className="h-[52px] min-h-[52px] min-w-[52px] rounded-full border text-[17px] font-[600] text-[var(--text)] active:scale-[0.96] select-none"
              style={{ borderColor:'var(--border)', background:'var(--chip-bg)', transition:'transform 160ms cubic-bezier(0.34,1.56,0.64,1)' }}
            >
              0
            </button>
            <button
              onClick={doBackspace}
              aria-label="backspace"
              className="h-[52px] min-h-[52px] min-w-[52px] rounded-full border bg-[var(--card-bg)] grid place-items-center text-[16px] text-[var(--muted)] active:scale-[0.96] hover:bg-[var(--chip-bg)] transition select-none"
              style={{ borderColor:'var(--border)' }}
            >
              ⌫
            </button>
          </div>

          <div className="mt-5 text-[11px] text-[var(--muted)]/70 text-center leading-[1.35]">
            {checking ? "checking…" : bioSupported && bioEnrolled.length===0 ? "Tip: enable Face ID in Settings after login" : "hashed • device-local • see SECURITY.md"}
          </div>
        </div>

        {!remember && (
          <div className="mt-3 text-[10.5px] text-[var(--muted)]/80 text-center max-w-[260px]">You'll be asked again after you close the app — Stay keeps you signed in on this device</div>
        )}
      </div>
    </div>
  );
}
function AvatarDot({ k }: { k: PersonKey }) {
  const p = PERSONS[k];
  return <span className="grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold text-white border-2 border-white" style={{ background: p.accent2 }}>{p.initial}</span>;
}
function DoodleHeartAccent({ color, className = "h-[18px] w-[18px]" }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12.8 L3.8 9.3 A2.9 2.9 0 0 1 3.1 7.1 a2.35 2.35 0 0 1 4.05-1.72 A2.35 2.35 0 0 1 12.9 7.1 c0 .8-.32 1.55-1.6 3.04L8 12.8Z" />
    </svg>
  );
}
void DoodleHeartAccent; // kept for optional festive reuse, not in default hero now

function FridgePage({
  currentUser, chores, calendar, shopping, notes, setTab, nowMs, theme, syncStatus,
}: {
  currentUser: PersonKey; chores: ChoreV2[]; calendar: CalendarEventV2[]; shopping: ShoppingItemV2[]; notes: NoteMemo[];
  setTab: (k: TabKey) => void; nowMs: number; theme: Theme; syncStatus?: SyncStatus;
}) {
  const todayDateStr = todayKey(HOUSEHOLD_TZ);
  const nowDate = new Date(nowMs);
  const weekdayLong = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: HOUSEHOLD_TZ }).format(nowDate);
  const dayNumStr = new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: HOUSEHOLD_TZ }).format(nowDate);
  const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: HOUSEHOLD_TZ }).format(nowDate);
  const dateLabel = `${weekdayLong}, ${dayNumStr} ${monthLong}`;
  const hourDublin = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: HOUSEHOLD_TZ }).format(nowDate));
  const greeting = hourDublin < 12 ? "Good morning" : hourDublin < 18 ? "Good afternoon" : "Good evening";
  const partner: PersonKey = currentUser === "aisling" ? "ciaran" : "aisling";

  const activeChores = useMemo(() => chores.filter(c => !(c as any).deletedAt), [chores]);
  const activeCalendar = useMemo(() => calendar.filter((ev:any) => !(ev as any).deletedAt), [calendar]);
  const activeShopping = useMemo(() => shopping.filter((s:any) => !(s as any).deletedAt && !(s as any).archivedAt), [shopping]);
  const activeNotes = useMemo(() => notes.filter((n:any) => !(n as any).deletedAt && !(n as any).archived_at && !(n as any).archivedAt), [notes]);

  const emptyAll = activeChores.length===0 && activeCalendar.length===0 && activeShopping.length===0 && activeNotes.length===0;

  const syncMinimal = (() => {
    if (!syncStatus) return null;
    const k = syncStatus.kind;
    if (k === 'saving') return <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><span className="h-1.5 w-1.5 rounded-full bg-[#F59E0B] animate-pulse" />Saving</span>;
    if (k === 'offline-queued') return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF]"><span className="h-1.5 w-1.5 rounded-full bg-[#9CA3AF]" />Queued</span>;
    if (k === 'failed') return <span className="inline-flex items-center gap-1.5 text-[11px] text-[#B91C1C]"><span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />Offline</span>;
    // Trust only server-confirmed time, not current clock
    const savedAt = syncStatus.lastSavedAt;
    const savedLabel = (()=>{ try{
      if (!savedAt) return null;
      // Use Europe/Dublin confirmed time, not nowMs
      return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit', timeZone: HOUSEHOLD_TZ}).format(new Date(savedAt));
    } catch { return null; } })();
    return <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted)]" title={savedAt ? `Server confirmed ${savedAt}` : undefined}><span className="h-1.5 w-1.5 rounded-full bg-[#8DA08E]" />{savedLabel ? `Saved • ${savedLabel}` : 'Saved'}</span>;
  })();

  const [confetti, setConfetti] = useState<number>(0);
  useEffect(()=>{
    if(syncStatus?.kind==='saved' || syncStatus?.kind==='synced' || (syncStatus as any)?.kind==='saved'){
      setConfetti(c=>c+1);
      const t=setTimeout(()=>setConfetti(c=>Math.max(0,c-1)), 1200);
      return ()=>clearTimeout(t);
    }
  },[syncStatus?.kind]);

  // --- helpers ---
  const fmtTime = (iso: string) => {
    try { return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit', timeZone: HOUSEHOLD_TZ, timeZoneName: undefined} as any).format(new Date(iso)) } catch { try{ return new Date(iso).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}) }catch{ return "" } }
  };
  const fmtDay = (iso:string) => {
    try {
      const d = new Date(iso);
      const key = toLocalKeyDublin(iso, HOUSEHOLD_TZ);
      const isToday = key===todayDateStr;
      if(isToday) return `Today • ${fmtTime(iso)}`;
      const tomorrowKey = toLocalKeyDublin(new Date(nowMs+86400000).toISOString(), HOUSEHOLD_TZ);
      if(key===tomorrowKey) return `Tomorrow • ${fmtTime(iso)}`;
      return new Intl.DateTimeFormat('en-GB',{weekday:'short', month:'short', day:'numeric', timeZone: HOUSEHOLD_TZ}).format(d) + ` • ${fmtTime(iso)}`;
    } catch { return "" }
  };
  const timingLabel = (c:any): string => {
    try{
      const freq = ((c as any)?.frequency||"").toString().toUpperCase() || "ONCE";
      const dueMs = typeof getDueMsChore==='function' ? getDueMsChore(c) : (c?.dueAt ? new Date(c.dueAt).getTime() : Date.now());
      const diff = dueMs - nowMs;
      const isOver = diff<0;
      const dueKey = c?.dueAt ? toLocalKeyDublin(c.dueAt, HOUSEHOLD_TZ) : toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
      const isToday = dueKey === todayDateStr;
      if(isOver) return `${freq} • OVERDUE`;
      if(isToday) return `${freq} • DUE TODAY`;
      if(diff < 48*3600000) return `${freq} • DUE TOMORROW`;
      return freq;
    }catch{ return "ONCE"; }
  };
  const dueDiff = (iso:string) => {
    try{
      const dueMs = new Date(iso).getTime();
      const diffMs = dueMs - nowMs;
      const days = Math.ceil(diffMs / 86400000);
      const hours = Math.ceil(diffMs / 3600000);
      return { diffMs, days, hours, overdue: diffMs<0 };
    }catch{ return { diffMs:0, days:0, hours:0, overdue:false } }
  };

  // TODAY collections - up to 3 each
  const todayCals = useMemo(()=>{
    const agreed = activeCalendar.filter(ev=>{
      const s:any=ev.status;
      return s==='agreed'||s==='accepted'||s==='yes'||s==='confirmed';
    }).filter(ev=>{
      try{ return toLocalKeyDublin(ev.dueAt, HOUSEHOLD_TZ)===todayDateStr }catch{return false}
    }).sort((a,b)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,3);
    return agreed;
  },[activeCalendar, todayDateStr]);

  const todayChoresMine = useMemo(()=>{
    const mine = activeChores.filter(c=>{
      if(c.assignedTo!==currentUser || c.status==='done') return false;
      try{
        const dueMs = getDueMsChore(c);
        const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
        return dueKey===todayDateStr || dueMs < nowMs;
      }catch{return false}
    }).sort((a,b)=> getDueMsChore(a)-getDueMsChore(b)).slice(0,3);
    return mine;
  },[activeChores, currentUser, todayDateStr, nowMs]);

  const shoppingSummary = useMemo(() => {
    const todo = activeShopping.filter(s=> !s.purchased);
    if (todo.length===0) return null;
    const endOfToday = (()=>{ try{
      const [y,m,d] = todayDateStr.split("-").map(Number);
      return tzWallToUtc(y,m,d,23,59,59,HOUSEHOLD_TZ);
    }catch{ return new Date(nowMs); }})();
    const dueToday = todo.filter(it=>{
      try{
        const nxt = computeShoppingNextDue(it as any, nowMs);
        if(!nxt) return false;
        const dueKey = toLocalKeyDublin(nxt.toISOString(), HOUSEHOLD_TZ);
        const isToday = dueKey === todayDateStr;
        const isOverdue = nxt.getTime() < nowMs;
        return isToday || isOverdue || nxt.getTime() <= endOfToday.getTime();
      }catch{ return false; }
    });
    if(dueToday.length===0) return null;
    const count = dueToday.length;
    const names = dueToday.slice(0,3).map(s=> (s as any).item || (s as any).title || "item");
    const rest = count - names.length;
    const label = rest>0 ? `${names.join(", ")} +${rest} more` : names.join(", ");
    return { count, label, todo: dueToday };
  }, [activeShopping, todayDateStr, nowMs]);

  const shoppingDueList = useMemo(()=>{
    if(!shoppingSummary) return [];
    return (shoppingSummary.todo as any[]).slice(0,3);
  },[shoppingSummary]);

  const hasToday = todayCals.length>0 || todayChoresMine.length>0 || !!shoppingSummary;

  // NEEDS YOUR ANSWER
  const needsYourAnswer = useMemo(() => {
    const list: { id:string; title:string; kind:'chore'|'calendar'; obj:any }[] = [];
    activeChores.forEach(c=>{
      if (c.status!=='deck') return;
      const my = ((c.swipes as any)?.[currentUser] ?? null);
      const other = ((c.swipes as any)?.[partner] ?? null);
      if (my===null && other!==null) list.push({ id:c.id, title:c.title, kind:'chore', obj:c });
    });
    activeCalendar.forEach(ev=>{
      if (ev.status!=='proposed' && !(ev.status as any)?.toString()?.startsWith('awaiting')) return;
      const my = (ev.swipes as any)?.[currentUser] ?? null;
      const other = (ev.swipes as any)?.[partner] ?? null;
      if (my===null && other!==null) list.push({ id:ev.id, title:ev.title, kind:'calendar', obj:ev });
    });
    return list.slice(0,4);
  }, [activeChores, activeCalendar, currentUser, partner]);

  // UPCOMING next 7 days
  const upcoming = useMemo(()=>{
    const in7 = nowMs + 7*86400000;
    const agreed = activeCalendar.filter(ev=>{
      const s:any=ev.status;
      if(!(s==='agreed'||s==='accepted'||s==='yes'||s==='confirmed'||s==='proposed'||(s||'').toString().startsWith('awaiting'))) return false;
      try{
        const ms = new Date(ev.dueAt).getTime();
        if(isNaN(ms)) return false;
        if(ms <= nowMs) return false;
        if(ms > in7) return false;
        const k = toLocalKeyDublin(ev.dueAt, HOUSEHOLD_TZ);
        if(k===todayDateStr) return false;
        return true;
      }catch{return false}
    }).sort((a,b)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,5);
    return agreed;
  },[activeCalendar, nowMs, todayDateStr]);

  const tentative = useMemo(()=>{
    const list = activeCalendar.filter(ev=>{
      const s:any=ev.status;
      return s==='proposed'|| (s||'').toString().startsWith('awaiting')||s==='needs_discussion';
    }).filter(ev=>{
      try{ const ms=new Date(ev.dueAt).getTime(); return ms>nowMs && ms<=nowMs+7*86400000 }catch{return false}
    }).sort((a,b)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,3);
    return list;
  },[activeCalendar, nowMs]);

  // PINNED & COUNTDOWNS
  const pinnedEvents = useMemo(()=>{
    const pins = activeCalendar.filter((ev:any)=> ev.pinned_at || ev.pinnedAt || ev.isPinned || ev.pinned).sort((a,b)=> new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()).slice(0,4);
    if(pins.length>0) return pins;
    // fallback: events whose title starts with pin emoji or marked starred? Look for events with reminder close
    return [] as any[];
  },[activeCalendar]);

  const stickyPick = useMemo(()=>{
    const unread = activeNotes.filter(n=> n.author===partner && !((n.seenBy as any)?.[currentUser])).sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
    if (unread[0]) return { note: unread[0], label: `Unread` };
    const pinned = activeNotes.filter(n=> (n as any).pinned_at || (n as any).pinnedAt).sort((a,b)=> {
      const pa = (a as any).pinned_at || (a as any).pinnedAt || a.createdAt;
      const pb = (b as any).pinned_at || (b as any).pinnedAt || b.createdAt;
      return new Date(pb).getTime()-new Date(pa).getTime();
    });
    if (pinned[0]) return { note: pinned[0], label: `Pinned` };
    const love = activeNotes.filter(n=> n.isLove).sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
    if (love[0]) return { note: love[0], label: `Love note` };
    if (activeNotes.length>0) {
      const sorted = [...activeNotes].sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
      return { note: sorted[0], label: `Note` };
    }
    return null;
  }, [activeNotes, currentUser, partner]);

  // helpers UI
  const PersonDot = ({k, size=9}:{k:PersonKey,size?:number})=>{
    const p = PERSONS[k];
    return <span className="grid place-items-center rounded-full text-[10px] font-bold text-white border-2 border-white shadow-sm shrink-0" style={{background:p.accent2, width:size*1.8, height:size*1.8}}>{p.initial}</span>
  };
  const IconChevron = ()=> <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M5 3l5 5-5 5"/></svg>;
  const IconClock = ()=> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  const IconPin = ()=> <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3l2 6h6l-5 4 2 6L12 15l-5 4 2-6-5-4h6z"/></svg>;

  return (
    <div className="w-full space-y-6">
      <style>{`@keyframes fridge-peach-pulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(184,166,255,0.36),0 0 0 8px rgba(255,107,38,0.28)}50%{transform:scale(1.08);box-shadow:0 0 0 2px rgba(255,176,135,0.10),0 0 0 10px rgba(255,176,135,0.16)}} @keyframes countdown-pop{0%{transform:scale(0.92)}50%{transform:scale(1.04)}100%{transform:scale(1)}}`}</style>
      {confetti>0 && (
        <div className="pointer-events-none absolute right-4 top-2 flex gap-1">
          <span className="h-1 w-1 rounded-full bg-[#E07A5F] animate-bounce [animation-delay:0ms]" />
          <span className="h-1 w-1 rounded-full bg-[#A89FDA] animate-bounce [animation-delay:120ms]" />
          <span className="h-1 w-1 rounded-full bg-[#E8CEB7] animate-bounce [animation-delay:220ms]" />
        </div>
      )}

      {/* HERO V102 — editorial script classy, theme-aware contrast fix */}
      <div className="nylah-hero-v101 nylah-arena rounded-[28px] px-6 pt-6 pb-5 relative overflow-hidden">
        <div className="relative flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-[0.14em] uppercase" style={{fontFamily:'var(--font-ui)', color:'var(--muted)'}}>{dateLabel}</div>
          <div className="shrink-0 opacity-80">{syncMinimal}</div>
        </div>
        <div className="relative mt-5">
          <div className="nylah-script-hero text-[40px]" style={{fontFamily:'var(--font-display)', color:'var(--text)', opacity:0.92}}>{greeting.toLowerCase()}</div>
          <h1 className="nylah-display-hero text-[46px] -mt-1" style={{fontFamily:'var(--font-display)', color:'var(--text)'}}>
            {(PERSONS[currentUser]?.name||currentUser||'You')}
            <span className="ml-2 inline-flex items-baseline gap-2 align-baseline">
              <span className="text-[20px] font-light" style={{fontFamily:'var(--font-ui)', fontWeight:300, color:'var(--muted)'}}>with</span>
              <span className="nylah-script-hero text-[34px] font-script-hero" style={{fontFamily:"var(--font-script)"}} style={{fontFamily:'var(--font-display)', color:'var(--accent-warm)'}}>{PERSONS[partner]?.name||partner}</span>
            </span>
          </h1>
          <div className="mt-2 flex items-center gap-2 text-[11px] tracking-[0.12em] uppercase" style={{fontFamily:'var(--font-ui)', color:'var(--muted)'}}>
            <span className="h-px w-8" style={{background:'var(--border)'}} /> {(PERSONS[currentUser]?.name||currentUser)} ♥ {(PERSONS[partner]?.name||partner)} • Beirt
          </div>
        </div>
        <div className="absolute -right-10 -bottom-10 w-[180px] h-[180px] rounded-full blur-[38px] opacity-[0.18] pointer-events-none" style={{background:'radial-gradient(100% 100% at 50% 50%, var(--accent) 0%, transparent 70%)'}} />
      </div>

      {/* NEEDS YOU */}
      {needsYourAnswer.length>0 && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center gap-2">
            <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--text)]">Needs you</span>
            <span className="h-[10px] w-[10px] rounded-full bg-[var(--accent)] shrink-0" style={{ boxShadow:'0 0 0 4px rgba(255,107,38,0.14)' }} aria-hidden="true" />
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor:"var(--border, #E8DDD3)", boxShadow:"0 12px 32px rgba(0,0,0,.10), 0 16px 40px rgba(120,98,84,0.08)" }}>
            {needsYourAnswer.map((item, idx)=>{
              const dateKeyForItem = (()=>{ try{ const iso=(item.obj as any)?.dueAt || (item.obj as any)?.start || (item.obj as any)?.createdAt; if(!iso) return null; const d=new Date(iso); if(isNaN(d.getTime())) return null; return new Intl.DateTimeFormat("en-CA",{timeZone:HOUSEHOLD_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).format(d); }catch{ return null; } })();
              return (
                <button
                  key={item.id}
                  onClick={()=>{ if(item.kind==='calendar' && dateKeyForItem){ try{ localStorage.setItem("couple_v1_calendar_selected", dateKeyForItem); localStorage.setItem("couple_v1_calendar_viewMonth", dateKeyForItem.slice(0,7)); }catch{} } setTab(item.kind==='chore'?'chores':'calendar'); }}
                  className="w-full text-left flex items-center gap-3 px-4 py-4 min-h-[60px] hover:bg-[var(--chip-bg)]/60 transition"
                  style={{ borderTop: idx===0 ? undefined : "1px solid var(--chip-bg)" }}
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-bold text-white shrink-0" style={{ background: (PERSONS[partner]?.accent2||'#E07A5F') }}>{(PERSONS[partner]?.initial||'?')}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold truncate text-[var(--text)]">{item.title}</div>
                    <div className="text-[12px] text-[var(--muted)]">{(PERSONS[partner]?.name||partner||'?')} responded • your turn</div>
                  </div>
                  <span className="text-[13px] text-[var(--muted)]"><IconChevron/></span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TODAY - up to 3 per type */}
      {hasToday && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--text)]">Today</span>
            <span className="text-[11px] text-[var(--muted)]">{todayCals.length + todayChoresMine.length + (shoppingDueList.length>0?1:0)} items • Tap to open</span>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor:"var(--border)", boxShadow:"0 8px 28px rgba(0,0,0,.08), 0 1px 0 rgba(255,255,255,0.8) inset" }}>
            {todayCals.map((ev, i)=>(
              <button key={ev.id} onClick={()=> setTab("calendar")} className="w-full text-left flex items-stretch gap-0 min-h-[60px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: i===0? undefined : "1px solid #F0DDD0" }}>
                <span className="w-[56px] shrink-0 grid place-items-center border-r" style={{ borderColor:'#F0DDD0' }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--wash-mid)] text-[11px] font-bold text-[#8B5E3C] shadow-sm"><IconClock/></span>
                </span>
                <span className="flex-1 flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0"><span className="block text-[11px] tabular-nums text-[var(--muted)] flex items-center gap-1">{fmtTime(ev.dueAt)} <span className="h-1 w-1 rounded-full bg-[var(--accent)] animate-pulse" /></span><span className="block text-[15px] font-medium truncate text-[var(--text)]">{ev.title}</span></span>
                  <span className="text-[11px] rounded-full border px-2.5 py-1 bg-[var(--chip-bg)] text-[var(--text-secondary)]" style={{ borderColor:'var(--border)' }}>Agreed • {ev.location||"Today"}</span>
                </span>
              </button>
            ))}
            {todayChoresMine.map((ch, i)=>(
              <button key={ch.id} onClick={()=> setTab("chores")} className="w-full text-left flex items-stretch gap-0 min-h-[60px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: (todayCals.length>0 || i>0) ? "1px solid #F0DDD0" : undefined }}>
                <span className="w-[56px] shrink-0 grid place-items-center border-r" style={{ borderColor:'#F0DDD0' }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#EEE8FF] text-[11px] font-bold text-[#6B5CA8] shadow-sm">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.4H19l-4.4 3.2 1.7 5.4L12 13.2 7.7 16l1.7-5.4L5 7.4h5.2z"/></svg>
                  </span>
                </span>
                <span className="flex-1 flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0"><span className="block text-[11px] flex items-center gap-1.5 text-[var(--muted)]">{timingLabel(ch as any)} {timingLabel(ch as any).includes("OVERDUE") && <span className="inline-flex rounded-full bg-[#FEF2F2] border border-[#FECACA] px-1.5 py-0.5 text-[10px] font-bold text-[#991B1B]">Due</span>}</span><span className="block text-[15px] font-medium truncate">{ch.title}</span></span>
                  <span className="text-[11px] font-semibold text-[#8B5E3C]">{ch.basePoints} pts</span>
                </span>
              </button>
            ))}
            {shoppingDueList.length>0 && (
              <button onClick={()=> setTab("shopping")} className="w-full text-left flex items-stretch gap-0 min-h-[60px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: (todayCals.length>0 || todayChoresMine.length>0) ? "1px solid #F0DDD0" : undefined }}>
                <span className="w-[56px] shrink-0 grid place-items-center border-r" style={{ borderColor:'#F0DDD0' }}>
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0A0A0A] text-white text-[11px] shadow-sm">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6"><path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
                  </span>
                </span>
                <span className="flex-1 flex items-center justify-between gap-3 px-4 py-3.5">
                  <span className="min-w-0"><span className="block text-[11px] uppercase tracking-wide font-semibold text-[var(--muted)]">Shop • {shoppingSummary?.count} due today</span><span className="block text-[13px] truncate text-[var(--text)]">{shoppingDueList.map((s:any)=>s.item).join(", ")}{shoppingSummary && shoppingSummary.count>3 ? ` +${shoppingSummary.count-3}`:""}</span></span>
                  <span className="h-8 w-8 grid place-items-center rounded-full bg-[#8B5E3C] text-white text-[12px]"><IconChevron/></span>
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* UPCOMING */}
      {upcoming.length>0 && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[20px] font-semibold tracking-tight text-[var(--text)]">Upcoming • {upcoming.length}</span>
            <button onClick={()=> setTab("calendar")} className="text-[11px] text-[var(--muted)] underline min-h-[44px]">View all →</button>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{ borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,.07)" }}>
            {upcoming.map((ev, idx)=>{
              const diff = dueDiff(ev.dueAt);
              const isSoon = (()=>{ try{ const due = ev.dueAt ? new Date(ev.dueAt).getTime() : ev.start ? new Date(ev.start).getTime() : null; if(!due) return false; const diff=due-Date.now(); return diff>=0 && diff<=24*3600000; }catch{return false} })();
              return (
                <button key={ev.id} onClick={()=> setTab("calendar")} className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[56px] hover:bg-[var(--chip-bg)]/50 transition" style={{ borderTop: idx===0?undefined:"1px solid var(--chip-bg)" }}>
                  <span className={"h-2 w-2 rounded-full shrink-0 "+(isSoon?"bg-[var(--accent)]":"bg-[var(--border)]")} style={isSoon?{boxShadow:'0 0 0 4px rgba(255,107,38,0.28)'}:undefined} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate text-[var(--text)]">{ev.title}</div>
                    <div className="text-[11px] text-[var(--muted)] flex items-center gap-1.5"><span>{fmtDay(ev.dueAt)}</span>{ev.location && <><span className="h-1 w-1 rounded-full bg-[var(--border)]" />{ev.location}</>}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.attendees?.length===1 && <PersonDot k={ev.attendees[0] as any} />}
                    <span className="text-[11px] text-[var(--muted)]"><IconChevron/></span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* TENTATIVE / AWAITING */}
      {tentative.length>0 && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center gap-2">
            <span className="font-display text-[18px] font-semibold tracking-tight text-[var(--text)]">Awaiting you</span>
            <span className="text-[10px] rounded-full bg-[var(--card-bg)] border px-2 py-0.5 text-[#8B5E3C]" style={{borderColor:'#FDE68A'}}>{tentative.length} to respond</span>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:'#FDE68A', boxShadow:'0 8px 20px rgba(0,0,0,.05)'}}>
            {tentative.map((ev,i)=>(
              <button key={ev.id} onClick={()=> setTab("calendar")} className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[56px] hover:bg-[var(--card-bg)]/60 transition" style={{borderTop:i===0?undefined:'1px solid #FFF7ED'}}>
                <span className="h-2 w-2 rounded-full bg-[#F59E0B] shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium truncate">{ev.title}</div>
                  <div className="text-[11px] text-[var(--muted)]">{fmtDay(ev.dueAt)} • proposed by {(PERSONS[(ev as any).proposer as any]?.name)||"partner"}</div>
                </div>
                <span className="text-[11px] font-semibold text-[#92400E] border px-2 py-1 rounded-full bg-[var(--card-bg)]">Reply</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* PINNED & COUNTDOWNS — V104 boutique classy, theme-aware clarity */}
      {pinnedEvents.length>0 && (
        <div className="space-y-3">
          <div className="px-1 flex items-center gap-2">
            <span className="text-[20px] font-semibold tracking-tight" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>Pinned & countdowns</span>
            <span className="grid h-5 w-5 place-items-center rounded-full border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--accent-warm)'}}><IconPin/></span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {pinnedEvents.map(ev=>{
              const {days, overdue} = dueDiff(ev.dueAt);
              const big = Math.abs(days)<=7;
              const isStar = Math.abs(days)<=3;
              return (
                <button key={ev.id} onClick={()=> setTab("calendar")} className="text-left rounded-[22px] border px-4 py-4 min-h-[112px] relative overflow-hidden transition hover:shadow-[0_6px_16px_rgba(0,0,0,0.08)]" style={{borderColor: overdue?'rgba(239,68,68,0.28)':'var(--border)', background: overdue?'linear-gradient(180deg, #FFF7F7 0%, var(--card-bg) 100%)': 'var(--card-bg)', boxShadow:'0 8px 24px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.86)'}}>
                  <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full blur-[14px] pointer-events-none" style={{background:'radial-gradient(100% 100% at 50% 50%, var(--accent) 0%, transparent 70%)', opacity: isStar?0.22:0.12}} aria-hidden="true" />
                  {isStar && <span className="absolute right-3 top-3 text-[12px] opacity-80" style={{color:'var(--accent)', textShadow:'0 0 8px rgba(255,107,38,0.42)'}}>✦</span>}
                  <div className="flex items-start justify-between relative">
                    <span className={"text-[11px] rounded-full border px-2.5 py-0.5 font-semibold "+(overdue?"bg-[#FEF2F2] text-[#991B1B] border-[#FECACA]":"")} style={overdue?{}:{background:'var(--chip-bg)', color:'var(--muted)', borderColor:'var(--border)'}}>{overdue?"OVERDUE":days===0?"TODAY":days===1?"TOMORROW":`${Math.abs(days)}d ${days<0?"ago":"left"}`}</span>
                    <span className="h-[7px] w-[7px] rounded-full" style={{background:'var(--accent)', boxShadow: isStar?'0 0 0 5px rgba(255,107,38,0.22), 0 0 12px rgba(255,107,38,0.36)':'0 0 0 4px rgba(255,107,38,0.16)', animation: big?'fridge-peach-pulse 1.8s infinite':undefined}} />
                  </div>
                  <div className="mt-2.5 flex items-baseline gap-1.5 relative" style={{animation: big?'countdown-pop 0.5s ease':undefined}}>
                    <span className="font-light tracking-[-0.02em]" style={{fontFamily:'Fraunces, serif', fontWeight:300, fontSize: big?'36px':'26px', lineHeight:1, color: overdue?'#991B1B':'var(--text)'}}>{Math.abs(days)}</span>
                    <span className="text-[11px] font-medium" style={{fontFamily:'var(--font-ui)', color:'var(--muted)'}}>{Math.abs(days)===1?"day":"days"}</span>
                  </div>
                  <div className="mt-1.5 text-[13px] font-medium line-clamp-2 leading-[1.35]" style={{color:'var(--text)'}}>{ev.title}</div>
                  <div className="mt-1 text-[11px] truncate" style={{color:'var(--muted)'}}>{fmtDay(ev.dueAt)}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* CHORES DECK QUICK */}
      {activeChores.filter(c=>c.status==='deck').length>0 && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[18px] font-semibold tracking-tight text-[var(--text)]">Chores deck • {activeChores.filter(c=>c.status==='deck').length}</span>
            <button onClick={()=> setTab("chores")} className="text-[11px] text-[var(--muted)] min-h-[44px]">Shuffle →</button>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] px-3 py-3 flex gap-2 overflow-x-auto no-scrollbar" style={{borderColor:'var(--border)'}}>
            {activeChores.filter(c=>c.status==='deck').slice(0,6).map(c=>(
              <button key={c.id} onClick={()=> setTab("chores")} className="shrink-0 rounded-full border bg-[var(--chip-bg)] px-3 py-2 text-[12px] font-medium hover:bg-[var(--wash-mid)] transition min-h-[44px]" style={{borderColor:'var(--border)'}}>{c.title}</button>
            ))}
          </div>
        </div>
      )}

      {/* PANTRY LOW */}
      {shoppingDueList.length>0 && !hasToday && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[18px] font-semibold tracking-tight">Pantry low • {shoppingDueList.length}</span>
            <button onClick={()=> setTab("shopping")} className="text-[11px] text-[var(--muted)] min-h-[44px]">Shop →</button>
          </div>
          <div className="rounded-[22px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:'var(--border)'}}>
            {shoppingDueList.map((it:any, i:number)=>(
              <button key={it.id} onClick={()=> setTab("shopping")} className="w-full text-left flex items-center gap-3 px-4 py-3.5 min-h-[56px] hover:bg-[var(--chip-bg)]/40 transition" style={{borderTop:i===0?undefined:"1px solid var(--chip-bg)"}}>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] border text-[11px]" style={{borderColor:'var(--border)'}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.5"><path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg></span>
                <span className="flex-1 text-[13px] font-medium truncate">{it.item} {it.qty>1?`×${it.qty}`:""}</span>
                <span className="text-[11px] text-[var(--muted)]">{(it.cat||"")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FROM partner */}
      {stickyPick && stickyPick.note && (
        <div className="space-y-2.5">
          <div className="px-1 flex items-center justify-between">
            <span className="font-display text-[18px] font-semibold tracking-tight text-[var(--text)]">From {(PERSONS[partner]?.name||partner||'?')}</span>
            <span className="text-[11px] rounded-full border bg-[var(--card-bg)] px-2.5 py-1 text-[var(--muted)]" style={{ borderColor:'var(--border)' }}>{stickyPick.label} • {relTime(stickyPick!.note!.createdAt, nowMs)}</span>
          </div>
          <button onClick={()=> setTab("notes")} className="relative w-full text-left rounded-[22px] border bg-[var(--card-bg)] px-5 py-5 text-left"
            style={{ borderColor:"var(--border)", boxShadow:"0 16px 40px rgba(41,26,12,0.14), 0 1px 0 rgba(255,255,255,0.9) inset" }}>
            <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 h-4 w-16 rounded-full bg-[var(--chip-bg)]/90 border shadow-sm" style={{ borderColor:'var(--border)'}} aria-hidden="true" />
            <span className="pointer-events-none absolute right-6 top-6 opacity-[0.12]"><svg viewBox="0 0 16 16" className="h-[32px] w-[32px]" fill="#E07A5F"><path d="M8 13.1 4.2 9.6A3.6 3.6 0 0 1 3 7c0-1.7 1.25-2.9 2.9-2.9 1 0 1.65.45 2.1 1.2.45-.75 1.1-1.2 2.1-1.2C11.75 4.1 13 5.3 13 7c0 .9-.4 1.9-1.2 2.9L8 13.1Z"/></svg></span>
            <div className="flex gap-4">
              <span className="grid h-10 w-10 place-items-center rounded-full text-[12px] font-bold text-white shrink-0 mt-0.5 shadow-sm" style={{ background: (PERSONS[partner]?.accent2||'#E07A5F') }}>{(PERSONS[partner]?.initial||'?')}</span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[16px] leading-[1.45] line-clamp-5 text-[var(--text)]">{stickyPick!.note!.body}</div>
                {(stickyPick!.note!.photoThumbDataUrl || stickyPick!.note!.photoDataUrl) && (
                  <div className="mt-4 inline-block rounded-[12px] border bg-[var(--card-bg)] p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.10)]">
                    <img src={(stickyPick!.note! as any).photoThumbDataUrl || stickyPick!.note!.photoDataUrl } alt="note" className="h-[160px] w-[160px] rounded-[8px] object-cover" loading="lazy" />
                    <div className="mt-2 flex justify-center"><span className="h-1.5 w-7 rounded-full bg-[var(--chip-bg)] border" style={{ borderColor:'var(--border)'}} /></div>
                  </div>
                )}
              </div>
            </div>
          </button>
        </div>
      )}

      {emptyAll && (
        <div className="rounded-[28px] border bg-[var(--card-bg)] px-7 py-12 text-center relative overflow-hidden" style={{ borderColor:'var(--border)', boxShadow:'0 16px 40px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
          <div className="absolute left-1/2 top-8 -translate-x-1/2 h-px w-24 opacity-60" style={{background:'linear-gradient(90deg, transparent, var(--border), transparent)'}} />
          <span className="mx-auto grid h-[68px] w-[68px] place-items-center rounded-full border" style={{ background:'var(--chip-bg)', borderColor:'var(--border)'}}><span className="text-[18px]" style={{color:'var(--accent-warm)'}}>✦</span></span>
          <div className="mt-5 text-[22px] font-semibold tracking-tight" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>A little quiet in here</div>
          <div className="mx-auto mt-2 max-w-[268px] italic leading-[1.55]" style={{fontFamily:'Fraunces, serif', fontStyle:'italic', fontWeight:400, fontSize:'17px', color:'var(--muted)'}}>Nothing queued.</div>
          <div className="mx-auto mt-2 max-w-[260px] text-[12.5px] leading-[1.5]" style={{color:'var(--muted)'}}>Leave a note, add a plan, or tuck a shop list in — it warms right up when you do.</div>
          <button onClick={()=> setTab("notes")} className="mt-5 inline-flex h-[44px] min-h-[44px] items-center justify-center rounded-full px-7 text-[13px] font-semibold tracking-wide active:scale-[0.99] transition" style={{background:'#121214', color:'#FFFEFB', boxShadow:'0 8px 20px rgba(0,0,0,0.18)'}}>Add a note</button>
        </div>
      )}

      {syncStatus?.kind==='failed' && (
        <div className="rounded-[16px] border px-4 py-3 flex items-center justify-between gap-2 bg-[#FEF2F2]" style={{ borderColor:"#FECACA" }}>
          <span className="text-[12px] text-[#991B1B]">Offline — retrying</span>
          <button onClick={()=>{ try{ window.dispatchEvent(new CustomEvent('couple-sync',{detail:'retry'})) }catch{} }} className="h-9 rounded-full bg-[#0A0A0A] px-4 text-[12px] font-semibold text-white">Retry</button>
        </div>
      )}
      {syncStatus?.kind==='offline-queued' && !emptyAll && (
        <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 text-[12px] text-[#92400E]" style={{ borderColor:"#FDE68A" }}>
          Offline — changes saved locally, will sync when back.
        </div>
      )}
    </div>
  );
}





function Scoreboard({ chores }: { chores: ChoreV2[] }) {
  const done = chores.filter(c => c.status === "done");
  let tA = 0, tB = 0; done.forEach(c => {
    const pts = effectivePoints(c, isBonusChore(c, c.completedAt ? new Date(c.completedAt).getTime() : undefined));
    if (c.completedBy === "aisling") tA += pts; else if (c.completedBy === "ciaran") tB += pts;
  });
  const total = tA + tB || 1; const pctA = tA / total;
  // weekly filter last 7 days
  const sevenAgo = Date.now() - 7*86400000;
  let wA=0,wB=0;
  done.forEach(c=>{
    const ts = c.completedAt? new Date(c.completedAt).getTime(): 0;
    if (ts < sevenAgo) return;
    const pts = effectivePoints(c, isBonusChore(c, ts));
    if (c.completedBy==="aisling") wA+=pts; else if (c.completedBy==="ciaran") wB+=pts;
  });
  const weeklyTotal = wA+wB||1; const pctWA = wA/weeklyTotal;
  return (
    <div className="rounded-[20px] border bg-[var(--card-bg)] px-4 py-3.5 space-y-2.5" style={{ borderColor: "var(--border)", boxShadow: "0 6px 20px rgba(41,38,36,0.08)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1"><span className="h-8 w-8 rounded-full grid place-items-center text-[11px] font-bold text-white shrink-0" style={{ background: "#A89FDA" }}>Á</span><div className="min-w-0"><div className="text-[11px] text-[var(--muted)]">Aisling</div><div className="font-display font-bold leading-none text-[22px]">{tA}</div></div></div>
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--muted)] px-2 py-1 rounded-full bg-[var(--chip-bg)] border" style={{ borderColor: "var(--border)" }}>VS</span>
        <div className="flex items-center gap-2 min-w-0 flex-1 justify-end"><div className="text-right"><div className="text-[11px] text-[var(--muted)]">Ciaran</div><div className="font-display font-bold leading-none text-[22px]">{tB}</div></div><span className="h-8 w-8 rounded-full grid place-items-center text-[11px] font-bold text-white shrink-0" style={{ background: "var(--border)", color: "#6B5242" }}>C</span></div>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-[var(--chip-bg)] overflow-hidden flex"><div className="h-full rounded-full transition-all" style={{ width: pctA * 100 + "%", background: "linear-gradient(90deg,#A89FDA,#977DDA)" }} /><div className="flex-1" style={{ background: "var(--border)", marginLeft: "2px" }} /></div>
      <div className="mt-1 flex justify-between text-[11px] text-[var(--muted)]"><span>{PERSONS.aisling.name} {(pctA * 100).toFixed(0)}%</span><span>{PERSONS.ciaran.name} {(100 - pctA * 100).toFixed(0)}%</span></div>
      <div className="pt-2 border-t flex items-center justify-between" style={{ borderColor:"var(--chip-bg)"}}>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">this week (7d)</span>
        <div className="flex items-center gap-2 text-[11px]"><span className="font-medium">Á {wA}</span><div className="h-1.5 w-[48px] rounded-full bg-[var(--chip-bg)] overflow-hidden flex"><div className="h-full rounded-full" style={{ width: pctWA*100+"%", background:"#A89FDA"}}/></div><span className="font-medium">C {wB}</span></div>
      </div>
    </div>
  );
}
function ChoresPage({
  chores, setChores, currentUser, setCurrentUser, onCelebrate, nowMs,
}: {
  chores: ChoreV2[]; setChores: any; currentUser: PersonKey; setCurrentUser?: any; onCelebrate?: any; nowMs: number;
}) {
  const [tab, setTab] = useState<"deck"|"mine"|"open"|"done"|"admin">("deck");
  const [filter, setFilter] = useState<"all"|"today"|"week"|"overdue">("all");
  const [weekdayFilter, setWeekdayFilter] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [showAdd, setShowAdd] = useState(false);
  const [detailChore, setDetailChore] = useState<ChoreV2|null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number|null>(null);
  const [flippedId, setFlippedId] = useState<string|null>(null);
  const [pointsPops, setPointsPops] = useState<{id:string, pts:number}[]>([]);
  const [toast, setToast] = useState<string|null>(null);
  const [combo, setCombo] = useState(0);
  const [editing, setEditing] = useState<ChoreV2|null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFreq, setEditFreq] = useState<ChoreV2["frequency"]>("once");
  const [editWeekdays, setEditWeekdays] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [editPain, setEditPain] = useState(5);
  const [editBonus, setEditBonus] = useState(false);
  const [editType, setEditType] = useState<"one-off"|"repeat">("one-off");
  const [holdProgress, setHoldProgress] = useState(0);
  const [showSkeletons, setShowSkeletons] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundOn, setSoundOn] = useState(()=>{ try{return localStorage.getItem("couple_v1_sound_on")==="1"}catch{return false}});
  const [addIcon, setAddIcon] = useState<ChoreIconId>('broom');
  const [addPain, setAddPain] = useState(5);
  const [addBonus, setAddBonus] = useState(false);
  const [addFreq, setAddFreq] = useState<ChoreV2["frequency"]>("once");
  const [addWeekdays, setAddWeekdays] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [addType, setAddType] = useState<"one-off"|"repeat">("one-off");
  const [showRules, setShowRules] = useState(false);
  const [editIcon, setEditIcon] = useState<ChoreIconId>('broom');
  const holdRef = useRef<any>(null);

  const active = useMemo(()=> chores.filter(c=> !(c as any).deletedAt), [chores]);
  const deck = useMemo(()=> active.filter(c=> c.status==="deck"), [active]);
  const mine = useMemo(()=> active.filter(c=> c.assignedTo===currentUser && c.status!=="done"), [active, currentUser]);
  const open = useMemo(()=> active.filter(c=> c.status==="open" || c.status==="race" || (c.status==="assigned" && c.assignedTo!==currentUser)), [active, currentUser]);
  const done = useMemo(()=> active.filter(c=> c.status==="done"), [active]);
  const listForFilter = useMemo(()=>{
    let base: ChoreV2[] = [];
    if (tab==="deck") base = deck;
    else if (tab==="mine") base = mine;
    else if (tab==="open") base = open;
    else if (tab==="done") base = done;
    else base = active;
    if (filter==="today") {
      const todayK = todayKey(HOUSEHOLD_TZ);
      return base.filter(c=> {
        const k = c.dueAt ? toLocalKeyDublin(c.dueAt, HOUSEHOLD_TZ) : null;
        return k===todayK;
      });
    }
    if (filter==="week") {
      const now = nowMs;
      const weekEnd = now + 6*86400000;
      return base.filter(c=> {
        const due = getDueMsChore(c);
        return due>=now && due<=weekEnd;
      });
    }
    if (filter==="overdue") {
      const now = nowMs;
      return base.filter(c=> getDueMsChore(c)<now && c.status!=="done");
    }
    if(tab==="admin") return base;
    // weekday filter inside deck etc
    if(weekdayFilter.some(Boolean)){
      const names=["Mo","Tu","We","Th","Fr","Sa","Su"];
      const sel=names.filter((_,i)=>weekdayFilter[i]);
      return base.filter(c=>{
        const det=c.frequencyDetail||"";
        return sel.some(s=> det.includes(s));
      });
    }
    return base;
  }, [tab, deck, mine, open, done, active, filter, nowMs, weekdayFilter]);

  const deckCount = deck.length;
  const currentCard = deck[0] || null;

  // Monthly Championship
  const nowDate = new Date(nowMs);
  const monthKey = new Intl.DateTimeFormat('en-CA',{timeZone:HOUSEHOLD_TZ, year:'numeric', month:'2-digit'}).format(nowDate).slice(0,7);
  const nextResetAt = useMemo(()=>{
    try{
      const y = Number(new Intl.DateTimeFormat('en-GB',{timeZone:HOUSEHOLD_TZ, year:'numeric'}).format(nowDate));
      const m = Number(new Intl.DateTimeFormat('en-GB',{timeZone:HOUSEHOLD_TZ, month:'numeric'}).format(nowDate));
      const nextM = m===12 ? 1 : m+1;
      const nextY = m===12 ? y+1 : y;
      return tzWallToUtc(nextY, nextM, 1, 0,0,0, HOUSEHOLD_TZ);
    }catch{ return new Date(nowDate.getTime()+30*86400000); }
  }, [nowDate]);
  const [tick,setTick]=useState(()=>Date.now());
  useEffect(()=>{
    let id:any = null;
    const schedule = ()=>{
      const diff = nextResetAt.getTime()-Date.now();
      const isLastHour = diff>0 && diff<3600000;
      const interval = isLastHour ? 1000 : 60000;
      if(id) clearInterval(id);
      id = setInterval(()=>{ if(document.hidden) return; setTick(Date.now()); }, interval);
    };
    schedule();
    const onVis = ()=>{ if(!document.hidden){ setTick(Date.now()); schedule(); } };
    document.addEventListener("visibilitychange", onVis);
    return ()=>{ if(id) clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  },[nextResetAt]);
  useEffect(()=>{
    try{
      const mql=window.matchMedia("(prefers-reduced-motion: reduce)");
      setReducedMotion(mql.matches);
      const fn=(e:any)=>setReducedMotion(e.matches);
      mql.addEventListener?.("change",fn);
      return ()=>mql.removeEventListener?.("change",fn);
    }catch{}
  },[]);
  useEffect(()=>{ const t=setTimeout(()=>setShowSkeletons(false), 700); return ()=>clearTimeout(t); },[tab]);

  const countdown = (()=>{ const diff = nextResetAt.getTime()-tick; if(diff<=0) return {d:0,h:0,m:0,s:0, label:'Resets now'}; const d=Math.floor(diff/86400000); const h=Math.floor((diff%86400000)/3600000); const m=Math.floor((diff%3600000)/60000); const s=Math.floor((diff%60000)/1000); return {d,h,m,s, label:`Resets 1st 00:00 • ${d}d ${h}h`}; })();

  // Monthly scores
  const monthScores = useMemo(()=>{
    let a=0,c=0;
    done.forEach(ch=>{ try{ const k = ch.completedAt ? toLocalKeyDublin(ch.completedAt, HOUSEHOLD_TZ) : null; if(!k) return; if(!k.startsWith(monthKey)) return; const pts = effectivePoints(ch, isBonusChore(ch, ch.completedAt? new Date(ch.completedAt).getTime():undefined)); if(ch.completedBy==='aisling') a+=pts; else if(ch.completedBy==='ciaran') c+=pts; }catch{} });
    return {a,c,total:(a+c)||1, pct: Math.round((Math.max(a,c)/((a+c)||1))*100 )};
  },[done, monthKey]);

  // history meta
  const metaHistory = useMemo(()=>{
    try{
      const raw=localStorage.getItem("couple_v1_chore_game_meta");
      if(raw){ const j=JSON.parse(raw); if(Array.isArray(j.history)) return j.history.slice(-3); }
    }catch{}
    // fallback synthetic from done grouped by month
    const map: Record<string,{a:number,c:number,winner:PersonKey|null,key:string}> = {};
    done.forEach(ch=>{
      try{
        const k= ch.completedAt ? toLocalKeyDublin(ch.completedAt, HOUSEHOLD_TZ)?.slice(0,7) : null;
        if(!k) return;
        if(!map[k]) map[k]={a:0,c:0,winner:null,key:k};
        const pts=effectivePoints(ch, false);
        if(ch.completedBy==='aisling') map[k].a+=pts; else if(ch.completedBy==='ciaran') map[k].c+=pts;
      }catch{}
    });
    const arr=Object.values(map).map(m=> ({...m, winner: (m.a===m.c? null : m.a>m.c? "aisling":"ciaran") as any})).sort((a,b)=> a.key.localeCompare(b.key)).slice(-3);
    return arr;
  },[done]);

  function effortHuman(pain:number): string {
    if(pain<=2) return "Tiny effort";
    if(pain<=4) return "Light effort";
    if(pain<=6) return "Medium effort";
    if(pain<=8) return "High effort";
    return "Tough";
  }
  function timingLabel(c: ChoreV2): string {
    const freq = (c.frequency||"").toUpperCase() || "ONCE";
    const dueMs = getDueMsChore(c);
    const diff = dueMs - nowMs;
    const dueKey = toLocalKeyDublin(new Date(dueMs).toISOString(), HOUSEHOLD_TZ);
    const isToday = dueKey === todayKey(HOUSEHOLD_TZ);
    const isOver = diff<0;
    if(isOver) return `${freq} • OVERDUE`;
    if(isToday) return `${freq} • DUE TODAY`;
    if(diff < 48*3600000) return `${freq} • DUE TOMORROW`;
    return freq;
  }

  function triggerPointsPop(id:string, pts:number){
    setPointsPops(p=> [...p, {id, pts}]);
    setTimeout(()=> setPointsPops(p=> p.filter(x=> x.id!==id)), 900);
    if(soundOn){
      try{
        const ctx=new (window as any).AudioContext();
        const o=ctx.createOscillator(); const g=ctx.createGain();
        o.frequency.value= 440 + Math.min(pts*2, 320);
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.12, ctx.currentTime);
        o.start(); o.stop(ctx.currentTime+0.12);
      }catch{}
    }
  }

  function confettiByPoints(pts:number, el?: any){
    if(reducedMotion) return;
    const count = pts<60 ? 12 : pts<100 ? 24 : 36;
    try{ onCelebrate?.({ points: pts, count, el }); }catch{}
    // own fallback
    setTimeout(()=>{},0);
  }

  function handleSwipe(dir:"left"|"right") {
    if(!currentCard) return;
    const me = currentUser;
    const partner: PersonKey = me==="aisling"?"ciaran":"aisling";
    const nowISO=new Date().toISOString();
    const safeBaseSwipes = (currentCard.swipes as any) ?? {aisling:null, ciaran:null};
    const baseSwipes = safeBaseSwipes.a !== undefined || safeBaseSwipes.b !== undefined ? {aisling: safeBaseSwipes.a ?? null, ciaran: safeBaseSwipes.b ?? null} : safeBaseSwipes;
    // V78 mega fix: single-swipe decides, no need to wait for partner
    if(dir==="right"){
      const otherSwipe = (baseSwipes as any)[partner];
      const nextSwipes = { ...(baseSwipes as any), [me]: "right" } as any;
      let nextStatus: any = "assigned";
      let assigned: any = me;
      if(otherSwipe==="right"){
        nextStatus="open";
        assigned=null;
        setToast("RACE • first to do wins 1.15× bonus");
      } else {
        setToast(`${PERSONS[me].name} claimed ${currentCard.title} • ${currentCard.basePoints} pts`);
      }
      setChores((prev:any)=> prev.map((x:any)=> x.id===currentCard.id ? {...x, swipes: nextSwipes, status: nextStatus, assignedTo: assigned, updatedAt: nowISO, updatedBy: me, seen: true} : x));
      setDragX(0);
      setCombo(c=>c+1); triggerPointsPop(currentCard.id, currentCard.basePoints); if(nextStatus==="open") confettiByPoints(currentCard.basePoints);
      try{ import('./lib/push').then(m=> m.notifyOther(me as any, {title: `${(me==='aisling'?'Aisling':'Ciarán')} claimed ${currentCard.title}`, body: `${nextStatus==='open'?'Race — first wins 1.15×':'Your turn'}`, url: './?standalone'})) }catch{}
      try{ localStorage.setItem("couple_v1_last_local_write", nowISO); }catch{}
      try{ const cur = Number(localStorage.getItem("couple_v1_chore_streak")||0); localStorage.setItem("couple_v1_chore_streak", String(cur+1)); }catch{}
      if(navigator.vibrate){ try{navigator.vibrate(10)}catch{} }
      setTimeout(()=> setToast(null), 2200);
      return;
    } else {
      // PASS – move card to bottom of deck, clear my swipe so it resurfaces
      const nextSwipes = { ...(baseSwipes as any), [me]: null } as any;
      // if both passed recently, clear both to avoid stalemate
      if((baseSwipes as any)[partner]==="left" || (baseSwipes as any)[partner]==null){
        nextSwipes[partner]=null;
      }
      setChores((prev:any)=>{
        const without = (prev as any[]).filter((x:any)=> x.id!==currentCard.id);
        const meCard = {...currentCard, swipes: nextSwipes, status:"deck", assignedTo:null, updatedAt: nowISO, updatedBy: me, seen: true, snoozedUntil: new Date(Date.now()+24*3600000).toISOString() } as any;
        // insert at end of deck section to resurface later
        const deckCountNow = without.filter((c:any)=> c.status==="deck").length;
        // put after existing deck cards but before others
        let idx = 0;
        let deckSeen=0;
        for(let i=0;i<without.length;i++){
          if((without[i] as any).status==="deck") deckSeen++;
          if(deckSeen===deckCountNow) { idx=i+1; break; }
        }
        if(idx===0) idx=deckCountNow;
        const next = [...without.slice(0, idx), meCard, ...without.slice(idx)];
        return next;
      });
      setDragX(0);
      setCombo(0);
      setToast(`Passed • ${currentCard.title} will resurface later`);
      try{ localStorage.setItem("couple_v1_last_local_write", nowISO); }catch{}
      if(navigator.vibrate){ try{navigator.vibrate([10,30])}catch{} }
      setTimeout(()=> setToast(null), 1800);
      return;
    }
  }

  const ChoreCardMega = ({c, large=false, onTap}:{c:ChoreV2; large?:boolean; onTap?:()=>void})=>{
    const isFlipped=flippedId===c.id;
    const dueMs=getDueMsChore(c);
    const overdue=dueMs < nowMs && c.status!=="done";
    const dueToday=Math.abs(dueMs-nowMs)<24*3600000;
    const rotBase = large ? -0.8 : (rotForId(c.id)*0.3);
    const dragRot = Math.max(-12, Math.min(12, dragX*0.06));
    const totalRot = large ? rotBase + dragRot : rotBase;
    const points=effectivePoints(c, isBonusChore(c, nowMs));
    const overdueDays= overdue ? Math.max(1, Math.floor((nowMs-dueMs)/86400000)) : 0;
    const mult=c.multiplier>1 ? c.multiplier : (overdueDays>0?1.15:1);
    const resolveIconId = (ch:any): string => {
      if (ch.icon && (CHORE_ICONS as any)[ch.icon]) return ch.icon;
      if (ch.templateId && (CHORE_ICON_BY_TEMPLATE as any)[ch.templateId]) return (CHORE_ICON_BY_TEMPLATE as any)[ch.templateId];
      const t=(ch.title||'').toLowerCase();
      if (t.includes('bin') || t.includes('trash') || t.includes('rubbish')) return 'bins';
      if (t.includes('dish')) return 'dishes';
      if (t.includes('laundr') || t.includes('clothes')) return 'laundry';
      if (t.includes('vacuum') || t.includes('hoover')) return 'vacuum';
      if (t.includes('bathroom') || t.includes('toilet') || t.includes('shower')) return 'bathroom';
      if (t.includes('shop') || t.includes('grocer') || t.includes('market')) return 'groceries';
      if (t.includes('kitchen') || t.includes('cook')) return 'kitchen';
      if (t.includes('bed')) return 'bed';
      if (t.includes('window')) return 'windows';
      if (t.includes('garden') || t.includes('yard')) return 'garden';
      if (t.includes('mop') || t.includes('floor')) return 'mop';
      return 'broom';
    };
    const iconId = resolveIconId(c);

    return (
      <div className="relative w-full select-none cursor-pointer" style={{ perspective:"800px" }}>
        <div
          className={"relative w-full rounded-[28px] border bg-[var(--card-bg)] px-5 py-5 text-left overflow-hidden "+(large?"min-h-[300px] shadow-[var(--shadow-soft)]":"min-h-[112px] shadow-[var(--shadow-soft)]")+" active:scale-[0.98] hover:translate-y-[-1px] transition-all cursor-pointer"}
          style={{
            borderColor:"var(--border)",
            transform: `translateX(${large?dragX:0}px) rotate(${totalRot}deg)`,
            transition: dragging ? "none" : "transform 300ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 200ms ease, border-color 200ms ease, scale 180ms cubic-bezier(0.34,1.56,0.64,1)",
            background: large ? "linear-gradient(180deg,var(--wash-top, #FFE8D6) 0%,var(--card-bg) 38%,var(--card-bg) 100%)" : "linear-gradient(180deg,var(--wash-top, #FFE8D6) 0%,var(--card-bg) 100%)",
            transformStyle:"preserve-3d" as any
          }}
          onClick={()=>{ try{ if(navigator.vibrate) navigator.vibrate(10);}catch{} }}
        >
          {/* V78 grain 0.12 opacity - theme aware */}
          <div className="pointer-events-none absolute inset-0 rounded-[28px] opacity-[0.12] mix-blend-multiply" style={{ backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`}} aria-hidden="true" />
          {/* Icon badge 64x64 circle theme-aware */}
          <div className="absolute right-4 top-4 grid h-[64px] w-[64px] place-items-center rounded-full border text-[var(--text)]" style={{background:"var(--chip-bg, #F7EFE8)", borderColor:"var(--border, #E8DDD3)", boxShadow:"var(--shadow-soft, 0 8px 24px rgba(0,0,0,0.08))"}} aria-hidden="true">
            <ChoreIcon id={iconId as any} size={28} />
          </div>
          {/* swipe tint overlays V78 pointer-events-none */}
          {large && dragX < -60 && (
            <div className="pointer-events-none absolute inset-0 rounded-[28px] flex items-center justify-start pl-8 gap-3" style={{ background:"rgba(254,226,226,0.92)", border:"1px solid #FECACA"}}>
              <span className="rounded-full bg-[var(--card-bg)] px-4 py-1.5 text-[13px] font-bold tracking-wide border" style={{borderColor:"#FCA5A5", color:"#991B1B"}}>PASS</span>
              <span className="grid h-[56px] w-[56px] place-items-center rounded-full bg-[var(--card-bg)]/70 border" style={{borderColor:"#FCA5A5"}} aria-hidden="true"><svg width="56" height="56" viewBox="0 0 24 24" fill="#EF4444" opacity="0.9"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg></span>
            </div>
          )}
          {large && dragX > 60 && (
            <div className="pointer-events-none absolute inset-0 rounded-[28px] flex items-center justify-end pr-8 gap-3" style={{ background:"rgba(220,252,231,0.92)", border:"1px solid #BBF7D0"}}>
              <span className="grid h-[56px] w-[56px] place-items-center rounded-full bg-[var(--card-bg)]/80 border" style={{borderColor:"#BBF7D0"}} aria-hidden="true"><svg width="56" height="56" viewBox="0 0 24 24" fill="#059669"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg></span>
              <span className="rounded-full bg-[#0A0A0A] px-4 py-1.5 text-[13px] font-bold text-white tracking-wide">MINE</span>
            </div>
          )}
          {/* content */}
          <button onClick={(e:any)=>{ e.stopPropagation(); const t=e.currentTarget as HTMLElement; const prev=t.style.transform; t.style.transform='scale(1.15)'; t.style.transition='transform 120ms cubic-bezier(0.34,1.56,0.64,1)'; try{ if((navigator as any).vibrate) (navigator as any).vibrate(10);}catch{} setTimeout(()=>{ t.style.transform=prev||'scale(1)'; setTimeout(()=>{ t.style.transform=''; },80); },140); onTap?.(); }} className="w-full text-left cursor-pointer relative z-10">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-[0.13em] uppercase text-[var(--muted)]">{timingLabel(c)}</span>
              {c.status==="open" && c.swipes?.aisling==="right" && c.swipes?.ciaran==="right" && <span className="animate-pulse rounded-full bg-[var(--card-bg)] border border-[#FCA5A5] px-2.5 py-0.5 text-[10px] font-bold text-[#991B1B]">RACE • 1.15×</span>}
            </div>
            <div className={"font-display font-semibold text-[var(--text)] "+(large?"text-[22px] leading-[26px] mt-2":"text-[15px] leading-[20px] mt-1")} style={{fontFamily:"Fraunces, serif"}}>{c.title}</div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-secondary)] border" style={{borderColor:'var(--border)'}}>{effortHuman(c.pain)}</span>
              <span className="text-[12px] font-semibold text-[#8B5E3C]">{points} pts {mult>1 ? `• ${mult}×` : ""}</span>
              {overdue && <span className="rounded-full bg-[var(--card-bg)] px-2 py-0.5 text-[10px] font-bold text-[#991B1B] border border-[#FECACA]">{overdueDays}d overdue</span>}
              {isFlipped && <span className="text-[11px] text-[var(--muted)]">tap to close</span>}
            </div>
            {large && (
              <div className="mt-3 h-1.5 w-full rounded-full bg-[#0A0A0A]/10 overflow-hidden flex"><div className="h-full rounded-full bg-gradient-to-r from-[#A89FDA] to-[var(--wash-top)]" style={{ width: Math.min(100, (points/120)*100)+"%"}} /></div>
            )}
          </button>

          {isFlipped && (
            <div className="mt-3 rounded-[16px] border bg-[var(--card-bg)]/80 backdrop-blur px-3 py-2.5 text-[12px] space-y-1 relative z-10" style={{borderColor:"var(--border)"}}>
              <div>Pain {c.pain}/10 • base {c.basePoints} • {c.multiplier>1?"bonus 1.15×":""} • {overdue? `${overdueDays}d overdue 1.15× → ${points}`: `${points} pts`}</div>
              <div>Due: {new Date(getDueMsChore(c)).toLocaleString("en-GB",{timeZone:HOUSEHOLD_TZ, weekday:"short", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"})} • {c.frequency} {c.frequencyDetail? `• ${c.frequencyDetail}`:""}</div>
              <div>Assigned: {c.assignedTo? (PERSONS[c.assignedTo]?.name||c.assignedTo):"deck"} • Swipes {c.swipes?.aisling||"–"} / {c.swipes?.ciaran||"–"}</div>
            </div>
          )}

          {pointsPops.find(p=>p.id===c.id) && (
            <span className="pointer-events-none absolute right-6 top-6 text-[14px] font-extrabold text-[#059669]" style={{ animation:"popUpBouncy 700ms cubic-bezier(0.34,1.56,0.64,1) forwards", transform:"translateY(0)"}}>+{pointsPops.find(p=>p.id===c.id)?.pts}</span>
          )}
        </div>

        {large && deck.length>1 && (
          <div className="absolute inset-0 -z-10 rounded-[28px] border bg-[var(--card-bg)]/60 backdrop-blur-[1px] translate-y-1.5 scale-[0.98]" style={{ borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}} aria-hidden="true" />
        )}
      </div>
    );
  };


  function openEdit(c:ChoreV2){
    setEditing(c);
    setEditTitle(c.title);
    setEditFreq(c.frequency as any || "once");
    setEditType((c.type as any)|| (c.frequency==="once"?"one-off":"repeat"));
    try{ const boolArr = (c.frequencyDetail||"").split(",").map((x:any)=> x.trim()).filter(Boolean); const map:any={Mo:0,Tu:1,We:2,Th:3,Fr:4,Sa:5,Su:6}; const arr=[false,false,false,false,false,false,false]; boolArr.forEach((k:string)=>{ if(map[k]!==undefined) arr[map[k]]=true; }); setEditWeekdays(arr); }catch{ setEditWeekdays([false,false,false,false,false,false,false]); }
    setEditPain(c.pain||5);
    setEditBonus(c.multiplier>1.05);
    setEditIcon(((c as any).icon as ChoreIconId) || 'broom');
  }

  function saveEdit(){
    if(!editing) return;
    const freqDetail = editWeekdays.some(Boolean) ? (()=>{ const names=["Mo","Tu","We","Th","Fr","Sa","Su"]; return names.filter((_,i)=> editWeekdays[i]).join(","); })() : undefined;
    const nowISO=new Date().toISOString();
    const updated:any = {
      ...editing,
      title: editTitle.trim() || editing.title,
      type: editType,
      frequency: editFreq,
      frequencyDetail: freqDetail,
      pain: editPain,
      basePoints: editPain*10,
      multiplier: editBonus ? 1.15 : 1,
      icon: editIcon,
      updatedAt: nowISO,
    };
    setChores((p:any)=> p.map((x:any)=> x.id===editing.id ? updated : x));
    setEditing(null);
    if(navigator.vibrate){ try{navigator.vibrate(10)}catch{} }
    triggerPointsPop(updated.id, updated.basePoints);
  }

  // templates — V77 with icon ids for pizazz
  const templates = [
    {k:"Bins", title:"Take bins out", pain:3, freq:"weekly", icon:"bins" as ChoreIconId},
    {k:"Dishes", title:"Wash dishes", pain:4, freq:"daily", icon:"dishes" as ChoreIconId},
    {k:"Laundry", title:"Laundry", pain:5, freq:"weekly", icon:"laundry" as ChoreIconId},
    {k:"Vacuum", title:"Vacuum living room", pain:6, freq:"weekly", icon:"vacuum" as ChoreIconId},
    {k:"Bathroom", title:"Clean bathroom", pain:8, freq:"weekly", icon:"bathroom" as ChoreIconId},
    {k:"Shop", title:"Groceries", pain:5, freq:"weekly", icon:"groceries" as ChoreIconId},
  ];

  // feed 7d
  const feed = useMemo(()=>{
    const sevenAgo=Date.now()-7*86400000;
    return done.filter(c=> c.completedAt && new Date(c.completedAt).getTime()>=sevenAgo).sort((a,b)=> new Date(b.completedAt||0).getTime()-new Date(a.completedAt||0).getTime()).slice(0,9);
  },[done]);

  const isClear = deck.length===0;

  return (
    <div className="w-full space-y-5 pb-[96px] min-h-[calc(100vh-16px)]">
      <style>{`
        @keyframes popUp{0%{transform:translateY(0); opacity:1} 100%{transform:translateY(-24px); opacity:0}}
        @keyframes popUpBouncy{0%{transform:translateY(12px) scale(0.7); opacity:0} 35%{transform:translateY(-10px) scale(1.15); opacity:1} 66%{transform:translateY(2px) scale(0.98)} 100%{transform:translateY(-22px) scale(1); opacity:0}}
        @keyframes pulseRace{0%,100%{transform:scale(1)} 50%{transform:scale(1.02)}}
        @keyframes floatHeart{0%{transform:translateY(0) scale(1)} 50%{transform:translateY(-3px) scale(1.05)} 100%{transform:translateY(0) scale(1)}}
      `}</style>

      {/* V103 Boutique Arena — Hume charcoal + Soho House linen, theme-aware contrast */}
      <div className="nylah-arena nylah-arena rounded-[28px] px-5 py-5 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 h-[160px] w-[160px] rounded-full blur-[24px] pointer-events-none" style={{background:'radial-gradient(100% 100% at 50% 50%, var(--accent) 0%, transparent 72%)', opacity:0.16}} aria-hidden="true" />
        <div className="flex items-center justify-between relative">
          <span className="text-[11px] uppercase tracking-[0.18em] font-semibold" style={{fontFamily:'Fraunces, serif', color:'var(--muted)'}}>Championship Arena</span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide" style={{background:'var(--chip-bg)', border:'1px solid var(--border)', color:'var(--text)'}}> <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> LIVE</span>
        </div>

        {/* podium boutique — linen 1st not flat orange, Fraunces numbers */}
        <div className="mt-5 flex items-end justify-center gap-5 relative">
          {monthScores.a >= monthScores.c ? (
            <>
              {/* 2nd Ciaran */}
              <div className="flex flex-col items-center">
                <div className="grid h-11 w-11 place-items-center rounded-full border bg-[var(--card-bg)] text-[12px] font-bold shadow-sm" style={{borderColor:'var(--border)', color:'var(--text)'}}>{PERSONS["ciaran"].initial}</div>
                <div className="mt-1.5 h-[38px] w-[68px] rounded-t-[14px] grid place-items-center text-[11px] font-medium border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--muted)'}}>2nd</div>
                <div className="text-[13px] font-semibold mt-1" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>{monthScores.c}</div>
              </div>
              {/* 1st Aisling — linen */}
              <div className="flex flex-col items-center relative">
                <span className="absolute -top-5 left-1/2 -translate-x-1/2" aria-hidden="true">
                  <svg width="20" height="12" viewBox="0 0 20 12" fill="none"><path d="M2 8 L10 0 L18 8 L10 6 Z" fill="var(--accent)" opacity="0.9" /></svg>
                </span>
                <div className="relative">
                  <div className="grid h-14 w-14 place-items-center rounded-full border-2 text-[14px] font-bold shadow-[0_8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]" style={{background:'var(--card-bg)', borderColor:'var(--accent)', color:'#292624'}}>{PERSONS["aisling"].initial}</div>
                  <span className="absolute -top-1 -right-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold border" style={{background:'#121214', borderColor:'var(--accent)', color:'var(--accent)'}}>LEADING</span>
                </div>
                <div className="mt-1.5 h-[56px] w-[84px] rounded-t-[16px] grid place-items-center text-[13px] font-bold shadow-[0_10px_28px_rgba(0,0,0,0.14)] border" style={{background:'var(--card-bg)', color:'#292624', borderColor:'rgba(0,0,0,0.06)'}}>
                  <span className="inline-flex items-center gap-1" style={{fontFamily:'Fraunces, serif'}}><span style={{color:'var(--accent)'}}>✦</span> 1st</span>
                </div>
                <div className="text-[14px] font-bold mt-1" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>{monthScores.a}</div>
              </div>
            </>
          ) : (
            <>
              {/* 2nd Aisling */}
              <div className="flex flex-col items-center">
                <div className="grid h-11 w-11 place-items-center rounded-full border bg-[var(--card-bg)] text-[12px] font-bold shadow-sm" style={{borderColor:'var(--border)', color:'var(--text)'}}>{PERSONS["aisling"].initial}</div>
                <div className="mt-1.5 h-[38px] w-[68px] rounded-t-[14px] grid place-items-center text-[11px] font-medium border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--muted)'}}>2nd</div>
                <div className="text-[13px] font-semibold mt-1" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>{monthScores.a}</div>
              </div>
              {/* 1st Ciaran */}
              <div className="flex flex-col items-center relative">
                <span className="absolute -top-5 left-1/2 -translate-x-1/2" aria-hidden="true">
                  <svg width="20" height="12" viewBox="0 0 20 12" fill="none"><path d="M2 8 L10 0 L18 8 L10 6 Z" fill="var(--accent)" opacity="0.9" /></svg>
                </span>
                <div className="relative">
                  <div className="grid h-14 w-14 place-items-center rounded-full border-2 text-[14px] font-bold shadow-[0_8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.9)]" style={{background:'var(--card-bg)', borderColor:'var(--accent)', color:'#292624'}}>{PERSONS["ciaran"].initial}</div>
                  <span className="absolute -top-1 -right-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold border" style={{background:'#121214', borderColor:'var(--accent)', color:'var(--accent)'}}>LEADING</span>
                </div>
                <div className="mt-1.5 h-[56px] w-[84px] rounded-t-[16px] grid place-items-center text-[13px] font-bold shadow-[0_10px_28px_rgba(0,0,0,0.14)] border" style={{background:'var(--card-bg)', color:'#292624', borderColor:'rgba(0,0,0,0.06)'}}>
                  <span className="inline-flex items-center gap-1" style={{fontFamily:'Fraunces, serif'}}><span style={{color:'var(--accent)'}}>✦</span> 1st</span>
                </div>
                <div className="text-[14px] font-bold mt-1" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>{monthScores.c}</div>
              </div>
            </>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 relative">
          <div className="flex-1"><div className="text-[10px] uppercase tracking-[0.12em]" style={{color:'var(--muted)'}}>Aisling</div><div className="text-[22px] font-semibold" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>{monthScores.a}</div></div>
          <div className="flex-1 flex flex-col items-center gap-1.5">
            <div className="h-1.5 w-[110px] rounded-full overflow-hidden" style={{background:'var(--chip-bg)'}}><div className="h-full rounded-full" style={{ width: (monthScores.a/(monthScores.total))*100+"%", background:'linear-gradient(90deg,var(--accent),var(--accent-warm))' }} /></div>
            <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--muted)'}}>{monthScores.pct}% to win</span>
          </div>
          <div className="flex-1 text-right"><div className="text-[10px] uppercase tracking-[0.12em]" style={{color:'var(--muted)'}}>Ciaran</div><div className="text-[22px] font-semibold" style={{fontFamily:'Fraunces, serif', color:'var(--text)'}}>{monthScores.c}</div></div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 relative">
          <span className="inline-flex rounded-full px-3 py-1 text-[11px] font-medium border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--text)'}}>Resets 1st 00:00 • {countdown.d}d {countdown.h}h {countdown.m}m {countdown.s}s</span>
          <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold border" style={{background:'var(--card-bg)', borderColor:'rgba(0,0,0,0.06)', color:'#292624'}}>Month {monthKey} • 600 pts</span>
        </div>

        {metaHistory.length>0 && (
          <div className="mt-3 flex gap-1.5 flex-wrap relative">
            {metaHistory.map((h:any)=>(
              <span key={h.key} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] border" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--muted)'}}><span className={"h-1.5 w-1.5 rounded-full "+(h.winner==="aisling"?"bg-[#E07A5F]":h.winner==="ciaran"?"bg-[#FF6B26]":"bg-[var(--muted)]")} />{h.key} {h.winner? (h.winner==="aisling"?"Á win":"C win"):"tie"}</span>
            ))}
          </div>
        )}

        {isClear && <div className="mt-2 text-[11px] relative" style={{color:'var(--muted)'}}>Deck clear — championship still live</div>}
      </div>

      {/* header */}

      <div className="flex items-center justify-between px-1">
        <h2 className="font-display text-[26px] font-semibold tracking-tight flex items-center gap-2" style={{fontFamily:"Fraunces, serif"}}>Chores <span className="inline-flex rounded-full bg-[var(--chip-bg)] border px-2.5 py-0.5 text-[11px] font-medium" style={{borderColor:"var(--border)"}}>{active.length} total</span></h2>
        <div className="flex items-center gap-2">
          <button onClick={()=> setSoundOn(s=>{ const n=!s; try{localStorage.setItem("couple_v1_sound_on", n?"1":"0")}catch{}; return n;})} className={"grid h-11 w-11 place-items-center rounded-full border bg-[var(--card-bg)] text-[12px] active:scale-[0.96] transition "+(soundOn?"ring-2 ring-[#A89FDA]":"")} style={{borderColor:"var(--border)", minHeight:44, minWidth:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}} aria-label="Sound toggle">{soundOn? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="1.6"><path d="M11 5 L6 9 H2 v6 h4 l5 4z"/><path d="M15 9a4 4 0 010 6"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.6"><path d="M11 5 L6 9 H2 v6 h4 l5 4z"/><path d="M16 9l4 6M20 9l-4 6"/></svg>}</button>
          <button onClick={()=> setShowAdd(true)} className="grid h-11 w-11 place-items-center rounded-full bg-[#0A0A0A] text-white text-[18px] active:scale-[0.96]" style={{minHeight:44, minWidth:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>+</button>
        </div>
      </div>

      {/* 5 tabs - 44px min */}
      <div className="px-1 overflow-x-auto no-scrollbar">
        <div className="inline-flex rounded-full border p-1 gap-1" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)"}}>
          {(["deck","mine","open","done","admin"] as const).map(t=> (
            <button key={t} onClick={()=> setTab(t)} className={"h-[44px] rounded-full px-4 text-[11px] font-semibold capitalize transition flex items-center gap-1 min-w-[52px] "+(tab===t?"bg-[#0A0A0A] text-white shadow-sm":"text-[var(--text-secondary)] hover:bg-[var(--card-bg)]")} style={{ minHeight:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>
              {t==="admin" ? <span className="flex items-center gap-1"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.2a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.2a1.6 1.6 0 00-1.5 1z"/></svg> Admin</span> : <span>{t} {t==="deck"?"•"+deckCount:t==="mine"? "•"+mine.length:t==="open"? "•"+open.length:""}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab==="deck" ? (
        <>
          <div className="px-1 flex items-center justify-between">
            <span className="text-[12px] text-[var(--muted)] flex items-center gap-2"><span className="inline-flex h-5 w-5 place-items-center rounded-full bg-[#0A0A0A] text-white text-[10px] grid place-items-center">{deckCount}</span> cards left • Swipe or tap to flip</span>
            <div className="relative">
              <select value={filter} onChange={e=> setFilter(e.target.value as any)} className="h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                <option value="all">All</option>
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="overdue">Overdue</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
          </div>

          {/* streak + combo header */}
          <div className="px-1 flex items-center gap-2">
            {combo>1 && <span className="inline-flex items-center gap-1 rounded-full bg-[#0A0A0A] px-3 py-1 text-[11px] font-bold text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="#FACC15"><path d="M12 2a7 7 0 00-7 7c0 5 7 11 7 11s7-6 7-11a7 7 0 00-7-7z"/></svg> {combo}x combo</span>}
            {(deckCount===0) && <span className="inline-flex items-center gap-1 rounded-full bg-[var(--chip-bg)] border px-3 py-1 text-[11px] font-semibold" style={{borderColor:"#C4B5FD"}}>Streak <svg width="10" height="12" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 2 C10 6 4 8 4 13 a6 6 0 0012 0 c0-5-6-7-4-11z"/></svg> {(() => { try{ return Number(localStorage.getItem("couple_v1_chore_streak")||0)}catch{return 0}})()}</span>}
          </div>

          {showSkeletons ? (
            <div className="space-y-3">
              <div className="rounded-[28px] border bg-[var(--card-bg)] h-[280px] animate-pulse" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
                <div className="p-5 space-y-3"><div className="h-3 w-24 rounded-full bg-[var(--chip-bg)]"/><div className="h-6 w-3/4 rounded-full bg-[var(--chip-bg)]"/><div className="h-12 w-full rounded-[16px] bg-[var(--card-bg)]"/></div>
              </div>
              <div className="h-[64px] rounded-[16px] bg-[var(--card-bg)] border animate-pulse" style={{borderColor:"var(--border)"}}/>
            </div>
          ) : currentCard ? (
            <div className="space-y-4 min-h-[340px]">
              <div className="relative min-h-[240px]" style={{ touchAction: "pan-y", minHeight:340, userSelect:"none"} as any}
                onPointerDown={(e:any)=>{ setDragging(true); setDragX(0); try{ (e.currentTarget as any).setPointerCapture(e.pointerId); }catch{}; startX.current = e.clientX; }}
                onPointerMove={(e:any)=>{ if(!dragging) return; const sx = startX.current; if(sx==null) return; const diff = e.clientX - sx; const clamped = Math.max(-180, Math.min(180, diff*0.7)); setDragX(clamped); }}
                onPointerUp={(e:any)=>{ if(Math.abs(dragX)>80){ handleSwipe(dragX>0?"right":"left"); } else setDragX(0); setDragging(false); startX.current=null; try{ (e.currentTarget as any).releasePointerCapture?.(e.pointerId); }catch{} }}
                onPointerCancel={(e:any)=>{ setDragX(0); setDragging(false); startX.current=null; }}
              >
                <ChoreCardMega c={currentCard} large onTap={()=> setFlippedId(f=> f===currentCard.id? null: currentCard.id)} />
              </div>
              <div className="flex gap-3 px-1">
                <button onClick={()=> handleSwipe("left")} className="flex-1 h-[56px] rounded-[16px] border bg-[var(--card-bg)] text-[14px] font-semibold tracking-wide active:scale-[0.96] shadow-sm flex items-center justify-center gap-1.5" style={{borderColor:"var(--border)", minHeight:56, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.6"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg> PASS</button>
                <button onClick={()=> handleSwipe("right")} className="flex-1 h-[56px] rounded-[16px] bg-[#0A0A0A] text-white text-[14px] font-bold tracking-wide active:scale-[0.96] shadow-[0_6px_18px_rgba(0,0,0,0.25)] flex items-center justify-center gap-1.5" style={{minHeight:56, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}><svg width="14" height="14" viewBox="0 0 24 24" fill="#E07A5F" stroke="white" strokeWidth="1.3"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg> I'LL DO IT</button>
              </div>
              <div className="px-1 flex items-center gap-2">
                <div className="flex-1 text-[11px] text-[var(--muted)] leading-[1.35]"><b>→</b> claim (Mine), <b>←</b> pass, <b>both →</b> Race 1.15×, tap card = details • <b>{currentCard.basePoints}</b>pts = pain {currentCard.pain}/10 ×10</div>
                <button onClick={()=> setShowRules(true)} className="h-[32px] w-[32px] grid place-items-center rounded-full border bg-[var(--card-bg)] text-[11px] font-bold shrink-0" style={{borderColor:"var(--border)", minHeight:32, minWidth:32}}>?</button>
              </div>
              {/* next up preview */}
              {deck.length>1 && <div className="px-1 text-[11px] text-[var(--muted)]/60">Next up: {deck[1].title} • {deck[1].basePoints}pts</div>}
            </div>
          ) : (
            <div className="rounded-[28px] border bg-[var(--card-bg)] px-6 py-10 text-center relative overflow-hidden" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 38%,var(--card-bg) 100%)", boxShadow:"0 16px 40px rgba(0,0,0,0.12)"}}>
              <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--card-bg)] border shadow-sm" style={{borderColor:"var(--border)"}}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#E07A5F" aria-hidden="true"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg>
              </div>
              <div className="font-display text-[18px] font-semibold" style={{fontFamily:"Fraunces"}}>Deck clear • new drops tomorrow</div>
              <div className="text-[13px] text-[var(--muted)] mt-1">You crushed it. Moon, confetti, warm wash.</div>
              <button onClick={()=> setTab("open")} className="mt-4 h-[52px] rounded-full bg-[#0A0A0A] px-6 text-[13px] font-semibold text-white active:scale-[0.96]" style={{minHeight:52, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>See open • race 1.15×</button>
              <button onClick={()=> setShowAdd(true)} className="ml-2 mt-4 h-[52px] rounded-full border bg-[var(--card-bg)] px-5 text-[12px] font-semibold" style={{borderColor:"var(--border)", minHeight:52}}>Add a chore you hate</button>
            </div>
          )}

          {/* feed 7d */}
          {feed.length>0 && (
            <div className="rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)"}}>
              <div className="text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] font-semibold">Feed • 7d</div>
              {feed.slice(0,4).map(c=>(
                <div key={c.id} className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5"><span className={"h-6 w-6 grid place-items-center rounded-full border text-[10px] font-bold "+(c.completedBy==="aisling"?"bg-[var(--chip-bg)] border-[#C4B5FD]":"bg-[var(--wash-top)] border-[var(--border)]")}>{c.completedBy==="aisling"?"Á":"C"}</span> {PERSONS[c.completedBy as any]?.name||c.completedBy} did {c.title}</span>
                  <span className="text-[11px] text-[var(--muted)]">{c.completedAt? relTime(c.completedAt, nowMs):""}</span>
                </div>
              ))}
              <div className="flex gap-1.5 pt-1">
                {[
                  {k:"flame", svg:<svg width="14" height="14" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 2 C10 6 4 8 4 13 a6 6 0 0012 0 c0-5-6-7-4-11z"/></svg>},
                  {k:"eye", svg:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.4"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>},
                  {k:"sparkle", svg:<svg width="14" height="14" viewBox="0 0 24 24" fill="#A89FDA"><path d="M12 2l2.4 7.6H22l-6.2 4.6 2.4 7.8L12 17.4 5.8 22l2.4-7.8L2 9.6h7.6z"/></svg>},
                ].map(r=> <button key={r.k} onClick={()=>{ try{ const m={...reactionMap}; const arr=m[feed[0]?.id]||[]; if(!arr.includes(r.k)) m[feed[0].id]=[...arr, r.k]; setReactionMap(m);}catch{} }} className="h-[36px] w-[36px] grid place-items-center rounded-full border bg-[var(--card-bg)] active:scale-[0.94]" style={{borderColor:"var(--border)", minHeight:36, minWidth:36}}>{r.svg}</button>)}
              </div>
            </div>
          )}

          <div className="pt-2 border-t mt-4 space-y-2" style={{borderColor:"var(--chip-bg)"}}>
            <div className="flex items-center justify-between px-1">
              <span className="font-display text-[13px]" style={{fontFamily:"Fraunces"}}>This week • {monthScores.pct}% to win</span>
              <button onClick={()=> { try{const el=document.getElementById("stats")?.scrollIntoView();}catch{} }} className="text-[11px] underline text-[var(--muted)]">Stats</button>
            </div>
            <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 flex items-center justify-between" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
              <span className="text-[12px] font-semibold">Aisling</span><span className="font-bold text-[14px]">{(() => { const sevenAgo=Date.now()-7*86400000; let a=0; done.forEach((c:any)=>{ const ts=c.completedAt? new Date(c.completedAt).getTime():0; if(ts>=sevenAgo && c.completedBy==='aisling') a+=effectivePoints(c, isBonusChore(c, ts)); }); return a; })()}</span>
              <span className="text-[11px] text-[var(--muted)]">vs</span>
              <span className="font-bold text-[14px]">{(() => { const sevenAgo=Date.now()-7*86400000; let b=0; done.forEach((c:any)=>{ const ts=c.completedAt? new Date(c.completedAt).getTime():0; if(ts>=sevenAgo && c.completedBy==='ciaran') b+=effectivePoints(c, isBonusChore(c, ts)); }); return b; })()}</span><span className="text-[12px] font-semibold">Ciarán</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#0A0A0A]/10 overflow-hidden flex gap-px">
              <div className="h-full bg-[#A89FDA]" style={{width: (monthScores.a/monthScores.total)*100+"%"}} />
              <div className="h-full bg-[#E07A5F]" style={{width: (monthScores.c/monthScores.total)*100+"%"}} />
            </div>
          </div>
        </>
      ) : tab==="admin" ? (
        <div className="space-y-4">
          <div className="rounded-[28px] border bg-[var(--card-bg)] p-4 space-y-3" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 36%,var(--card-bg) 100%)", boxShadow:"0 16px 40px rgba(0,0,0,0.12)"}}>
            {((import.meta as any).env?.DEV || (()=>{ try{ return localStorage.getItem("nylah_admin")==="1"}catch{return false}})()) && currentUser==="ciaran" ? <div className="font-display text-[17px] font-semibold flex items-center justify-between" style={{fontFamily:"Fraunces"}}>Admin <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2.5 py-1"> {active.length}</span></div> : null}
            <div className="text-[11px] text-[var(--muted)]">Templates one-tap • pain 1-10 • type chips 44px • Mo-Su 44px • points live • delete hold 800ms</div>
            <div className="grid grid-cols-3 gap-2">
              {templates.map(t=>(
                <button key={t.k} onClick={()=>{
                  const nowISO=new Date().toISOString();
                  const nc:any={ id: uid("chk"), title:t.title, type:"one-off", frequency: t.freq as any, createdAt:nowISO, updatedAt:nowISO, pain:6, basePoints:60, swipes:{aisling:null,ciaran:null}, status:"deck", assignedTo:null, multiplier:1, timeWindowHours:24, templateId:t.k, icon:(t as any).icon||"broom" };
                  setChores((p:any)=> [nc, ...p]);
                  setToast(`${t.title} added`);
                  setTimeout(()=>setToast(null),2500);
                }} className="h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[11px] font-semibold active:scale-[0.96] shadow-sm" style={{borderColor:"var(--border)", minHeight:44, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>{t.k}</button>
              ))}
            </div>
            <div className="space-y-2 max-h-[280px] overflow-auto no-scrollbar">
              {active.slice(0,20).map((c:any)=> (
                <button key={c.id} onClick={()=> openEdit(c)} className="w-full text-left flex items-center justify-between gap-2 rounded-[16px] border bg-[var(--card-bg)] px-3 py-2.5 min-h-[44px] active:scale-[0.99]" style={{borderColor:"var(--border)"}}>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.title}</span>
                  <span className="text-[11px] text-[var(--muted)] flex items-center gap-1">{c.frequency||"once"} • {c.pain}/10 {c.multiplier>1?"• 1.15×":""} <span className="h-5 w-5 grid place-items-center rounded-full bg-[#0A0A0A] text-white text-[10px]">{c.basePoints}</span></span>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={()=> { const nowISO=new Date().toISOString(); const all=active.map((c:any)=> ({...c, swipes:{aisling:null, ciaran:null}, status:"deck", updatedAt:nowISO, updatedBy:currentUser})); setChores((p:any)=> { const m=new Map(all.map((a:any)=>[a.id,a])); return (p as any[]).map((x:any)=> m.has(x.id) ? m.get(x.id) : x); }); setToast("Reshuffled");  setTimeout(()=>setToast(null),2000); }} className="h-[44px] rounded-full border bg-[var(--card-bg)] text-[11px] font-semibold active:scale-[0.96]" style={{borderColor:"var(--border)", minHeight:44}}>Reshuffle all</button>
              <button onClick={()=> { const kept = chores.filter((c:any)=> c.status!=="done" || (c.completedAt && toLocalKeyDublin(c.completedAt, HOUSEHOLD_TZ).startsWith(monthKey))); setChores(kept); setToast(`Archived old • kept ${monthKey}`); setTimeout(()=>setToast(null),2000); }} className="h-[44px] rounded-full bg-[#0A0A0A] text-white text-[11px] font-semibold active:scale-[0.96]" style={{minHeight:44}}>Archive old • {monthKey}</button>
            </div>
          </div>

          {editing && (
            <div className="rounded-[28px] border bg-[var(--card-bg)] p-4 space-y-3" style={{borderColor:"var(--border)", boxShadow:"var(--shadow-soft)"}}>
              <div className="font-display text-[15px] font-semibold flex items-center justify-between" style={{fontFamily:"Fraunces"}}>Edit {editing.id.slice(0,6)} <button onClick={()=> setEditing(null)} className="h-8 w-8 grid place-items-center rounded-full border bg-[var(--card-bg)] text-[12px]" style={{borderColor:"var(--border)"}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
              <input value={editTitle} onChange={e=> setEditTitle(e.target.value)} className="w-full h-[48px] rounded-[16px] border bg-[var(--card-bg)] px-4 text-[14px]" style={{borderColor:"var(--border)"}} placeholder="Title" />
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--muted)]">Pick an icon (gives pizazz)</div>
                <div className="grid grid-cols-5 gap-2 max-h-[140px] overflow-y-auto no-scrollbar snap-y pb-1" style={{scrollbarWidth:"thin"}}>
                  {ALL_CHORE_ICON_IDS.map(id=> (
                    <button key={id} onClick={()=> setEditIcon(id)} className="grid h-[48px] w-[48px] place-items-center rounded-full border text-[14px] active:scale-[0.96] transition-all" style={{minHeight:48, minWidth:48, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)", background: editIcon===id ? "#0A0A0A" : "var(--chip-bg)", color: editIcon===id ? "white" : "var(--text)", borderColor: editIcon===id ? "#0A0A0A" : "var(--border)"}}>
                      <ChoreIcon id={id} size={20} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {(["one-off","daily","weekly","monthly"] as const).map(f=> (
                  <button key={f} onClick={()=>{ setEditType(f==="one-off"?"one-off":"repeat"); setEditFreq(f==="one-off"?"once":f as any); if(navigator.vibrate) try{navigator.vibrate(10)}catch{} }} className={"h-[44px] rounded-[12px] border text-[11px] font-semibold capitalize "+( (f==="one-off" && editType==="one-off") || editFreq===f ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)] text-[var(--text-secondary)]")} style={{borderColor:"var(--border)", minHeight:44}}>{f}</button>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d,i)=> (
                  <button key={d} onClick={()=> { const a=[...editWeekdays]; a[i]=!a[i]; setEditWeekdays(a); if(navigator.vibrate) try{navigator.vibrate(10)}catch{} }} className={"h-[44px] rounded-full border text-[11px] font-medium "+(editWeekdays[i]?"bg-[#0A0A0A] text-white border-[#0A0A0A]":"bg-[var(--card-bg)]")} style={{borderColor:"var(--border)", minHeight:44}}>{d}</button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]"><span>Pain {editPain}/10 base {editPain*10}</span><span className="text-[var(--muted)]">→ {(editPain*10*(editBonus?1.15:1)).toFixed(0)} pts {editBonus?"(1.15× bonus)":""}</span></div>
                <input type="range" min={1} max={10} value={editPain} onChange={e=> { setEditPain(Number(e.target.value)); if(navigator.vibrate) try{navigator.vibrate(10)}catch{} }} className="w-full accent-[#0A0A0A] h-[24px]" />
                <div className="text-[11px] text-[var(--muted)]">Preview: {editPain*10}pts → {(editPain*10*1.15).toFixed(0)}pts (2d overdue 1.15×) • {effortHuman(editPain)}</div>
              </div>
              <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={editBonus} onChange={e=> setEditBonus(e.target.checked)} /> Bonus 1.15× (under 10%)</label>
              <div className="flex gap-2">
                <button onClick={saveEdit} className="flex-1 h-[52px] rounded-full bg-[#0A0A0A] text-white text-[13px] font-semibold active:scale-[0.96]" style={{minHeight:52, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Save</button>
                <div className="relative">
                  <button
                    onMouseDown={(e)=>{ 
                      let start=Date.now(); 
                      setHoldProgress(0); 
                      if(holdRef.current) clearInterval(holdRef.current);
                      holdRef.current=setInterval(()=>{
                        const elapsed=Date.now()-start;
                        const pct=Math.min(100, (elapsed/800)*100);
                        setHoldProgress(pct);
                        if(pct>=100){ 
                          clearInterval(holdRef.current); 
                          const nowISO=new Date().toISOString(); 
                          setChores((pp:any)=> pp.map((x:any)=> x.id===editing.id ? {...x, deletedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)); 
                          setEditing(null); 
                          setHoldProgress(0);
                          if(navigator.vibrate) try{navigator.vibrate([10,30,10])}catch{}
                        }
                      }, 16);
                    }}
                    onMouseUp={()=>{ if(holdRef.current) clearInterval(holdRef.current); setHoldProgress(0); }}
                    onMouseLeave={()=>{ if(holdRef.current) clearInterval(holdRef.current); setHoldProgress(0); }}
                    onTouchStart={(e)=>{ 
                      e.preventDefault();
                      let start=Date.now(); 
                      setHoldProgress(0); 
                      if(holdRef.current) clearInterval(holdRef.current);
                      holdRef.current=setInterval(()=>{
                        const elapsed=Date.now()-start;
                        const pct=Math.min(100, (elapsed/800)*100);
                        setHoldProgress(pct);
                        if(pct>=100){ 
                          clearInterval(holdRef.current); 
                          const nowISO=new Date().toISOString(); 
                          setChores((pp:any)=> pp.map((x:any)=> x.id===editing.id ? {...x, deletedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)); 
                          setEditing(null); 
                          setHoldProgress(0);
                          if(navigator.vibrate) try{navigator.vibrate([10,30,10])}catch{}
                        }
                      }, 16);
                    }}
                    onTouchEnd={()=>{ if(holdRef.current) clearInterval(holdRef.current); setHoldProgress(0); }}
                    className="h-[52px] w-[112px] rounded-full border bg-[var(--card-bg)] px-5 text-[11px] text-[#B91C1C] relative overflow-hidden flex items-center justify-center gap-2" style={{borderColor:"var(--border)", minHeight:52}}
                  >
                    <span className="relative z-10 flex items-center gap-1">{holdProgress>8 ? `${Math.round(holdProgress)}%` : "Hold to delete"}</span>
                    {/* progress ring V64 800ms */}
                    <svg className="pointer-events-none absolute inset-0 w-full h-full" viewBox="0 0 52 52" aria-hidden="true">
                      <circle cx="26" cy="26" r="23" fill="none" stroke="#FEF2F2" strokeWidth="2" />
                      <circle cx="26" cy="26" r="23" fill="none" stroke="#B91C1C" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="144.5" strokeDashoffset={144.5 - (144.5*holdProgress/100)} style={{transition:"stroke-dashoffset 16ms linear", transform:"rotate(-90deg)", transformOrigin:"50% 50%"}} />
                    </svg>
                    <span className="absolute inset-0 rounded-full border-2 border-[#B91C1C] pointer-events-none opacity-30" style={{ clipPath:`inset(0 ${100-holdProgress}% 0 0)`}} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* quest rings / steal / contested */}
          <div className="grid gap-2">
            {listForFilter.length===0 ? (
              <div className="rounded-[28px] border border-dashed bg-[var(--card-bg)] px-6 py-10 text-center" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
                <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-[var(--card-bg)] border"><svg width="24" height="24" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 19l-1.4-1.3C5.4 13 2 10.2 2 6.8 2 4 4.1 2 6.8 2c1.5 0 3 1 3.9 2.2C11.6 3 13.1 2 14.6 2 17.3 2 19.4 4 19.4 6.8c0 3.4-3.4 6.2-8.6 10.9L12 19z"/></svg></div>
                <div className="font-display text-[16px]" style={{fontFamily:"Fraunces"}}>No {tab} chores</div>
                <div className="text-[12px] text-[var(--muted)] mt-1">Warm paper, no emoji, 64 circle chip</div>
                <button onClick={()=> setShowAdd(true)} className="mt-3 h-[44px] rounded-full bg-[#0A0A0A] px-5 text-[12px] text-white active:scale-[0.96]" style={{minHeight:44}}>Add a chore you hate</button>
              </div>
            ) : listForFilter.slice(0,18).map(c=>{
              const dueMs=getDueMsChore(c);
              const overdue=dueMs < nowMs;
              const dueToday=Math.abs(dueMs-nowMs)<24*3600000;
              const isContested=c.swipes?.aisling==="right" && c.swipes?.ciaran==="right";
              const hoursOpen=c.updatedAt ? (nowMs - new Date(c.updatedAt).getTime())/3600000 : 0;
              const canSteal=c.assignedTo && c.assignedTo!==currentUser && (hoursOpen>3 || overdue);
              return (
                <div key={c.id} className={"w-full text-left rounded-[22px] border bg-[var(--card-bg)] px-4 py-3 flex items-center gap-3 min-h-[92px] "+(isContested?"border-[#FCA5A5] bg-[var(--card-bg)]/30 animate-pulse":"")} style={{borderColor:isContested?"#FCA5A5":"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.06)", background: isContested?"#FEE2E2": overdue?"var(--card-bg)":"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
                  <span className={"grid h-10 w-10 place-items-center rounded-full border text-[12px] font-bold shrink-0 "+(overdue?"border-[#EF4444] ring-2 ring-[#EF4444]/30": dueToday?"border-[var(--wash-mid)] ring-2 ring-[var(--wash-mid)] animate-pulse":"border-[var(--border)] bg-[var(--card-bg)]")} style={{minHeight:40, minWidth:40}}>{PERSONS[(c.assignedTo||currentUser) as any]?.initial||"•"}</span>
                  <button onClick={()=> setDetailChore(c)} className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-1.5"><span className="font-medium text-[14px] truncate">{c.title}</span>{isContested && <span className="rounded-full bg-[var(--card-bg)] border border-[#FCA5A5] px-2 py-0.5 text-[10px] font-bold text-[#991B1B]">RACE • 1.15×</span>}{c.assignedTo && !isContested && <span className="rounded-full bg-[var(--card-bg)] border px-2 py-0.5 text-[10px]" style={{borderColor:"var(--border)"}}>{c.assignedTo} • clear</span>}</div>
                    <div className="text-[11px] text-[var(--muted)]">{timingLabel(c)} • {effectivePoints(c,isBonusChore(c,nowMs))} pts</div>
                  </button>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={async()=> {
                      const nowISO=new Date().toISOString();
                      try{ const r=await claimChoreOccRpc(c.id, currentUser as any); if(r && !r.claimed){ setToast(`Already by ${r.alreadyBy||'other'}`);} }catch{} try{ completeChoreRpc(c.id, currentUser as any);}catch{};
                      setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, status:"done", completedBy:currentUser, completedAt:nowISO, updatedAt:nowISO, updatedBy:currentUser} : x));
                      triggerPointsPop(c.id, effectivePoints(c,false));
                      confettiByPoints(effectivePoints(c,false));
                      try{ import('./lib/push').then(m=> m.notifyOther(currentUser as any, {title: `${(currentUser==='aisling'?'Aisling':'Ciarán')} did ${c.title}`, body: `+${effectivePoints(c,false)} pts — ${monthKey}`, url: './?standalone'})) }catch{}
                      if(c.assignedTo && c.assignedTo!==currentUser){ setToast(`${PERSONS[currentUser].name} stole ${c.title}`); setTimeout(()=>setToast(null),3000); }
                    }} className="h-[36px] rounded-full bg-[#0A0A0A] px-3 text-[11px] text-white active:scale-[0.96] min-w-[52px]" style={{minHeight:36, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Done</button>
                    {canSteal && <button onClick={()=>{ const nowISO=new Date().toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, assignedTo:currentUser, updatedAt:nowISO}:x)); setToast(`${PERSONS[currentUser].name} stole ${c.title}`); setTimeout(()=>setToast(null),3000); }} className="h-[32px] rounded-full border bg-[var(--card-bg)] px-2.5 text-[10px] font-semibold" style={{borderColor:"var(--border)", minHeight:32}}>Steal</button>}
                    <div className="flex gap-1">
                      <button onClick={()=>{ const nowISO=new Date().toISOString(); const d=new Date(nowMs+48*3600000).toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, dueAt:d, updatedAt:nowISO}:x)); setToast("Snoozed 48h"); setTimeout(()=>setToast(null),2000); }} className="h-[28px] rounded-full border bg-[var(--card-bg)] px-2 text-[10px]" style={{borderColor:"var(--border)"}}>Snooze</button>
                      <button onClick={()=>{ const nowISO=new Date().toISOString(); const other:PersonKey=currentUser==="aisling"?"ciaran":"aisling"; setChores((p:any)=> p.map((x:any)=> x.id===c.id ? {...x, assignedTo: (x.assignedTo===currentUser? other: currentUser) as any, updatedAt:nowISO}:x)); setToast("Delegated"); setTimeout(()=>setToast(null),2000); }} className="h-[28px] rounded-full border bg-[var(--card-bg)] px-2 text-[10px]" style={{borderColor:"var(--border)"}}>Swap</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-[11px] text-[var(--muted)]/60 px-1 flex items-center justify-between"><span>{monthKey} • {active.length} active</span><span className="tabular-nums">{countdown.d}d {countdown.h}h {countdown.m}m</span></div>

          {/* win streak message */}
          {(() => { const sevenAgo=Date.now()-7*86400000; let aStreak=0; let cur=true; const sorted=done.filter((c:any)=> c.completedAt && new Date(c.completedAt).getTime()>=sevenAgo).sort((aa:any,bb:any)=> new Date(bb.completedAt).getTime()-new Date(aa.completedAt).getTime()); for(const ch of sorted){ if(ch.completedBy===currentUser) aStreak++; else break; } return aStreak>=2 ? <div className="rounded-full bg-[#0A0A0A] text-white px-3 py-1.5 text-[11px] inline-flex gap-1 items-center"><svg width="12" height="12" viewBox="0 0 24 24" fill="#FACC15"><path d="M12 2a7 7 0 00-7 7c0 5 7 11 7 11s7-6 7-11a7 7 0 00-7-7z"/></svg> {aStreak} win streak • keep it</div> : null; })()}
        </div>
      )}

      {/* Detail sheet */}
      <BottomSheet open={!!detailChore} onClose={()=> { setDetailChore(null); setFlippedId(null); }} title={detailChore?.title}>
        {detailChore && (
          <div className="space-y-3">
            <div className="rounded-[16px] p-3 border" style={{borderColor:"var(--border)", background:"linear-gradient(180deg,var(--wash-mid) 0%,var(--card-bg) 100%)"}}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{timingLabel(detailChore)}</div>
              <div className="text-[13px] font-medium mt-1">{detailChore.frequencyDetail ? `Repeats: ${detailChore.frequencyDetail}` : `Frequency: ${detailChore.frequency}`} • {detailChore.type}</div>
              <div className="text-[12px] text-[var(--muted)] mt-1">Pain {detailChore.pain}/10 • {effortHuman(detailChore.pain)} • {effectivePoints(detailChore, isBonusChore(detailChore, nowMs))} pts • {detailChore.multiplier>1?"1.15× bonus":"base"} • {detailChore.basePoints} base → {(detailChore.basePoints*1.15).toFixed(0)} (2d overdue 1.15×)</div>
              <div className="text-[12px] mt-1">Due: {new Date(getDueMsChore(detailChore)).toLocaleString("en-GB",{timeZone:HOUSEHOLD_TZ})}</div>
              <div className="text-[11px] mt-1">Streak <span className="inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="#E07A5F"><path d="M12 2 C10 6 4 8 4 13 a6 6 0 0012 0 c0-5-6-7-4-11z"/></svg></span> combo {combo} • {(() => { const q=(()=>{try{return localStorage.getItem("couple_v1_queue_count")||"0"}catch{return "0"}})(); return `Saved • ${active.length} • ${q} synced`; })()}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={async()=> { const nowISO=new Date().toISOString(); try{ const res=await claimChoreOccRpc(detailChore.id, currentUser as any); if(res && !res.claimed && res.alreadyBy){ setToast(`Already done by ${res.alreadyBy}`); setTimeout(()=>setToast(null),2500); } }catch{} try{ completeChoreRpc(detailChore.id, currentUser as any); }catch{} setChores((p:any)=> p.map((x:any)=> x.id===detailChore.id ? {...x, status:"done", completedBy: currentUser, completedAt:nowISO, updatedAt:nowISO, updatedBy:currentUser} : x)); setDetailChore(null); const pts=effectivePoints(detailChore,false); triggerPointsPop(detailChore.id, pts); confettiByPoints(pts); try{ import('./lib/push').then(m=> m.notifyOther(currentUser as any, {title: `${(currentUser==='aisling'?'Aisling':'Ciarán')} did ${detailChore.title}`, body: `+${pts} pts • ${monthKey}`, url: './?standalone'})) }catch{} }} className="flex-1 h-[52px] rounded-[16px] bg-[#0A0A0A] text-white text-[13px] font-semibold active:scale-[0.96]" style={{minHeight:52, transition:"transform 180ms cubic-bezier(0.34,1.56,0.64,1)"}}>Mark done • +{effectivePoints(detailChore,false)}</button>
              <button onClick={()=> { const nowISO=new Date().toISOString(); setChores((p:any)=> p.map((x:any)=> x.id===detailChore.id ? {...x, status:"deck", swipes:{aisling:null,ciaran:null}, updatedAt:nowISO, updatedBy:currentUser}:x)); setDetailChore(null); triggerPointsPop(detailChore.id, 20); confettiByPoints(20); }} className="flex-1 h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[13px] active:scale-[0.96]" style={{borderColor:"var(--border)", minHeight:44}}>Reshuffle</button>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>{ if(!detailChore) return; openEdit(detailChore); }} className="flex-1 h-[44px] rounded-full border bg-[var(--card-bg)] text-[12px]" style={{borderColor:"var(--border)", minHeight:44}}>Edit • Admin</button>
              <button onClick={()=>{ const nowISO=new Date().toISOString(); const half1={...detailChore, id: uid("chk"), title: detailChore.title+" • A", pain: Math.ceil(detailChore.pain/2), basePoints: Math.ceil(detailChore.basePoints/2), updatedAt:nowISO}; const half2={...detailChore, id: uid("chk"), title: detailChore.title+" • B", pain: Math.floor(detailChore.pain/2)||1, basePoints: Math.floor(detailChore.basePoints/2)||5, updatedAt:nowISO}; setChores((p:any)=> [half1, half2, ...p.filter((x:any)=> x.id!==detailChore.id)]); setDetailChore(null); setToast("Split into two"); setTimeout(()=>setToast(null),2000); }} className="flex-1 h-[44px] rounded-full border bg-[var(--card-bg)] text-[11px]" style={{borderColor:"var(--border)", minHeight:44}}>Split • Two</button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={showRules} onClose={()=> setShowRules(false)} title="How chores works">
        <div className="space-y-4 px-1">
          <div className="rounded-[16px] border bg-[var(--chip-bg)]/40 p-3 text-[12px] leading-[1.5]" style={{borderColor:"var(--border)"}}>
            <div className="font-semibold text-[13px] mb-1">The game</div>
            <div>Every chore lives in the Deck. You both swipe through the same deck. Right = you claim it, Left = you pass it on.</div>
          </div>
          <div className="space-y-2 text-[12px]">
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[#0A0A0A] text-white text-[10px] shrink-0">R</span><span><b>Swipe Right = I'll do it</b> — moves to your Mine. You own it. If you finish it, you get the points.</span></div>
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[var(--card-bg)] border text-[10px] shrink-0">L</span><span><b>Swipe Left = Pass</b> — you don't want it, rotates to your partner. If you both pass, it goes back to deck (24h snooze).</span></div>
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[var(--card-bg)] border-[#FCA5A5] border text-[10px] shrink-0">⚡</span><span><b>Both right = Race</b> — you both claimed it → it becomes Open + 1.15× bonus (15% extra). First to complete wins the boosted points.</span></div>
            <div className="flex gap-2"><span className="h-6 w-6 grid place-items-center rounded-full bg-[var(--wash-mid)] text-[10px] shrink-0">↔</span><span><b>Steal / Swap</b> — Mine items stuck &gt;3h or overdue can be stolen by partner. Anyone can swap owner.</span></div>
          </div>
          <div className="rounded-[16px] border bg-[var(--card-bg)] p-3 text-[12px] space-y-1.5" style={{borderColor:"var(--border)"}}>
            <div className="font-semibold text-[13px]">Points = pain × 10</div>
            <div className="text-[11px] text-[var(--muted)]">Pain 1 = Tiny (10pts), 5 = Medium (50pts), 10 = Brutal (100pts). Pain is effort, not priority.</div>
            <div>• Base = pain × 10 (10-100)</div>
            <div>• Bonus 1.15× if you check Bonus when adding (under 10% of chores should be bonus — nasty jobs)</div>
            <div>• Race 1.15× when both claim same chore</div>
            <div>• Overdue 1.15× after 2 days (auto)</div>
            <div>• Capped at 1.5× base max — hardest job 100 → 150 max</div>
            <div className="text-[11px] text-[var(--muted)] mt-1">Championship = calendar month, resets 1st 00:00 {HOUSEHOLD_TZ}. Scoreboard shows total + this week. Archive old after month.</div>
          </div>
          <button onClick={()=> setShowRules(false)} className="w-full h-[48px] rounded-full bg-[#0A0A0A] text-white text-[13px] font-semibold">Got it • Let's play</button>
        </div>
      </BottomSheet>

      <BottomSheet open={showAdd} onClose={()=> setShowAdd(false)} title="Add chore — pain = points">
        <div className="space-y-3.5">
          <input id="chore-title" placeholder="Title — e.g. Clean kitchen, Bins, Dishes" className="w-full h-[52px] rounded-[16px] border bg-[var(--card-bg)] px-4 text-[14px] shadow-sm" style={{borderColor:"var(--border)", minHeight:52}} autoFocus />
          <div className="flex gap-1.5">
            {templates.slice(0,3).map(t=> <button key={t.k} onClick={()=>{ const el=document.getElementById("chore-title") as HTMLInputElement; if(el) el.value=t.title; setAddIcon(t.icon); setAddPain(t.k==="Bins"?3:t.k==="Dishes"?4:6); }} className="h-[36px] rounded-full border bg-[var(--card-bg)] px-3 text-[11px]" style={{borderColor:"var(--border)", minHeight:36}}>{t.k}</button>)}
            <button onClick={()=> setShowRules(true)} className="h-[36px] rounded-full border bg-[var(--chip-bg)] px-3 text-[10px]" style={{borderColor:"var(--border)"}}>How scoring works?</button>
          </div>

          {/* Pain slider - this IS points */}
          <div className="rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)"}}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">How annoying — {addPain}/10</span>
              <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2.5 py-1">{addPain*10}pts {addBonus?"→ "+(addPain*10*1.15).toFixed(0)+" bonus":""}</span>
            </div>
            <input type="range" min={1} max={10} value={addPain} onChange={e=> setAddPain(Number(e.target.value))} className="w-full accent-[#0A0A0A] h-[24px]" />
            <div className="flex justify-between text-[10px] text-[var(--muted)]"><span>1 Tiny 10pts</span><span>5 Medium 50pts</span><span>10 Brutal 100pts</span></div>
            <div className="text-[11px] text-[var(--muted)]"><b>{(() => { const p=addPain; if(p<=2) return "Tiny effort"; if(p<=4) return "Light effort"; if(p<=6) return "Medium effort"; if(p<=8) return "High effort"; return "Brutal"; })()}</b> — {addPain} × 10 = {addPain*10} base. Why not more than 100? Keeps it fair. Overdue or race adds 15% extra, max 1.5×.</div>
            <label className="flex items-center gap-2 text-[11px] pt-1"><input type="checkbox" checked={addBonus} onChange={e=> setAddBonus(e.target.checked)} /> Bonus 1.15× — only for truly awful jobs (under 10% of chores)</label>
          </div>

          {/* Frequency */}
          <div className="grid grid-cols-4 gap-1.5">
            {(["one-off","daily","weekly","monthly"] as const).map(f=> (
              <button key={f} onClick={()=>{ setAddType(f==="one-off"?"one-off":"repeat"); setAddFreq(f==="one-off"?"once":f as any); }} className={"h-[44px] rounded-[12px] border text-[11px] font-semibold capitalize "+( (f==="one-off" && addType==="one-off") || addFreq===f ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)] text-[var(--text-secondary)]")} style={{borderColor:"var(--border)", minHeight:44}}>{f}</button>
            ))}
          </div>
          {addType!=="one-off" && (
            <div className="grid grid-cols-7 gap-1">
              {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d,i)=> (
                <button key={d} onClick={()=> { const a=[...addWeekdays]; a[i]=!a[i]; setAddWeekdays(a); }} className={"h-[40px] rounded-full border text-[10px] font-medium "+(addWeekdays[i]?"bg-[#0A0A0A] text-white border-[#0A0A0A]":"bg-[var(--card-bg)]")} style={{borderColor:"var(--border)", minHeight:40}}>{d}</button>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold tracking-wide uppercase text-[var(--muted)] flex items-center justify-between"><span>Pick an icon</span><span className="text-[10px] font-medium normal-case opacity-60">{addPain*10}pts badge</span></div>
            <div className="grid grid-cols-5 gap-2 max-h-[116px] overflow-y-auto no-scrollbar p-1 rounded-[12px] bg-[var(--chip-bg)]/30">
              {ALL_CHORE_ICON_IDS.map(id=> (
                <button key={id} onClick={()=> setAddIcon(id)} className={"grid h-[44px] w-[44px] place-items-center rounded-full border text-[12px] active:scale-[0.96] transition-all"} style={{minHeight:44, minWidth:44, background: addIcon===id ? "#0A0A0A" : "var(--card-bg)", color: addIcon===id ? "white" : "var(--text)", borderColor: addIcon===id ? "#0A0A0A" : "var(--border)"}}>
                  <ChoreIcon id={id} size={18} />
                </button>
              ))}
            </div>
          </div>

          <button onClick={()=>{
            const el=document.getElementById("chore-title") as HTMLInputElement;
            if(!el?.value.trim()) return;
            const nowISO=new Date().toISOString();
            const pain=Math.min(10, Math.max(1, addPain||5));
            const base=pain*10;
            const mult = addBonus?1.15:1;
            const fd = addType==="one-off" ? undefined : (addWeekdays.some(Boolean) ? ["Mo","Tu","We","Th","Fr","Sa","Su"].filter((_,i)=>addWeekdays[i]).join(",") : addFreq);
            const nc:any={ id: uid("chk"), title:el.value.trim(), type:addType, frequency:addFreq, frequencyDetail: fd, createdAt:nowISO, updatedAt:nowISO, pain, basePoints:base, swipes:{aisling:null,ciaran:null}, status:"deck", assignedTo:null, multiplier:mult, timeWindowHours:24, icon: addIcon };
            setChores((p:any)=> [nc, ...p]); setShowAdd(false);
            setAddPain(5); setAddBonus(false);
            triggerPointsPop(nc.id, base);
            setToast(`${nc.title} • ${base}pts ${addBonus?"1.15×":""} → deck`);
            setTimeout(()=>setToast(null),2500);
          }} className="w-full h-[56px] rounded-[16px] bg-[#0A0A0A] text-white text-[15px] font-semibold active:scale-[0.96]" style={{minHeight:56}}>Add • {addPain*10}pts {addBonus?"1.15× bonus":""} • deck</button>
          <div className="text-[10px] text-[var(--muted)] text-center">Tap "?" top-right any deck card to see details. Championship resets 1st 00:00 {HOUSEHOLD_TZ}.</div>
        </div>
      </BottomSheet>

      {toast && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 -translate-x-1/2 z-[88] rounded-full bg-[#0A0A0A] text-white px-5 py-2.5 text-[12px] font-medium shadow-[0_8px_24px_rgba(0,0,0,0.28)] animate-[popUp_300ms_ease]">{toast}</div>
      )}
    </div>
  );
}






function CalendarPageV2({
  events, setEvents, currentUser, nowMs, chores, setCurrentUser, onCelebrate,
}: {
  events: CalendarEvent[]; setEvents: (up: CalendarEvent[] | ((p: CalendarEvent[]) => CalendarEvent[])) => void;
  currentUser: PersonKey; nowMs: number; chores?: any; setCurrentUser?: any; onCelebrate?: any;
}) {
  // --- Dublin constants ---
  const tz = HOUSEHOLD_TZ;
  const todayDublin = todayKey(tz);

  // --- helpers (pure, no UTC slicing) ---
  function localKeyFromIso(iso?: string): string | null {
    if (!iso) return null;
    const k = toLocalKeyDublin(iso, tz);
    return k || null;
  }
  function daysInMonthDublin(year: number, month0: number): number {
    return new Date(year, month0 + 1, 0).getDate();
  }
  function addDaysKey(base: string, delta: number): string {
    // base YYYY-MM-DD -> add delta calendar days (Dublin wall, using local)
    try {
      const [y,m,d] = base.split("-").map(Number);
      const dt = new Date(y, m-1, d);
      dt.setDate(dt.getDate()+delta);
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth()+1).padStart(2,"0");
      const dd = String(dt.getDate()).padStart(2,"0");
      return `${yy}-${mm}-${dd}`;
    } catch { return base; }
  }
  function toTimeDublin(iso?: string): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", timeZone: tz, hour12:false });
    } catch { return ""; }
  }
  function toLongDateDublin(key: string): string {
    try {
      const [y,m,d] = key.split("-").map(Number);
      const dn = new Date(y, m-1, d).toLocaleDateString("en-GB", { weekday:"long", month:"long", day:"numeric", year:"numeric", timeZone: tz });
      return dn;
    } catch { return key; }
  }

  // migration: swipes -> responses
  function getResponses(ev: CalendarEvent): CalendarEventResponse[] {
    // Pure: only actual responses + legacy swipes migration. No invented proposer yes.
    if (ev.responses && ev.responses.length) return ev.responses as any;
    const res: CalendarEventResponse[] = [];
    if (ev.swipes) {
      if (ev.swipes?.aisling) {
        const v = ev.swipes.aisling as any;
        if (v === "yes" || v === "no" || v === "discuss") res.push({ eventId: ev.id, memberId: "aisling", response: v, respondedAt: ev.updatedAt || ev.createdAt });
      }
      if (ev.swipes?.ciaran) {
        const v = (ev.swipes as any).ciaran as any;
        if (v === "yes" || v === "no" || v === "discuss") res.push({ eventId: ev.id, memberId: "ciaran", response: v, respondedAt: ev.updatedAt || ev.createdAt });
      }
    }
    return res;
  }

  function computeStatusFromResponses(ev: CalendarEvent, responses: CalendarEventResponse[]): CalendarEventStatus {
    // Keep cancelled/completed/draft stable
    if ((ev as any).status === "cancelled" || (ev as any).status === "completed" || (ev as any).status === "draft") return ev.status as any;
    if ((ev as any).status === "dismissed") return "cancelled" as any;

    const attendees: string[] = (ev as any).attendees && (ev as any).attendees.length ? (ev as any).attendees : ["aisling","ciaran"];
    const proposer = (ev as any).proposer as PersonKey | undefined;

    // Single attendee - who it's FOR
    if (attendees.length === 1) {
      const sole = attendees[0] as PersonKey;
      // Personal event: I create for me => agreed immediately
      if (proposer && proposer === sole) return "agreed" as any;
      const soleResp = responses.find(r => r.memberId === sole);
      if (!soleResp) return (`awaiting_${sole}` as any) as any; // awaiting owner
      if (soleResp.response === "yes") return "agreed" as any;
      if (soleResp.response === "no") return "declined" as any;
      if (soleResp.response === "discuss") return "needs_discussion" as any;
      return (`awaiting_${sole}` as any) as any;
    }

    // Both attendees (or undefined -> both)
    const hasA = responses.find(r => r.memberId === "aisling");
    const hasC = responses.find(r => r.memberId === "ciaran");

    // Inject proposer yes implicitly for both-events when no explicit response from proposer yet
    const effectiveHasA = hasA ? hasA : (proposer === "aisling" && !hasA ? { memberId:"aisling", response:"yes" } as any : undefined);
    const effectiveHasC = hasC ? hasC : (proposer === "ciaran" && !hasC ? { memberId:"ciaran", response:"yes" } as any : undefined);

    const eA = effectiveHasA;
    const eC = effectiveHasC;

    if (!eA && !eC) return "proposed" as any;
    if (!eA) {
      if ((eC as any).response === "discuss") return "needs_discussion" as any;
      return "awaiting_aisling" as any;
    }
    if (!eC) {
      if ((eA as any).response === "discuss") return "needs_discussion" as any;
      return "awaiting_ciaran" as any;
    }
    const aR = (eA as any).response as string;
    const cR = (eC as any).response as string;
    if (aR === "yes" && cR === "yes") return "agreed" as any;
    if (aR === "no" && cR === "no") return "declined" as any;
    // mixed yes/no/discuss => needs discussion
    return "needs_discussion" as any;
  }

  function isEventOnDate(ev: CalendarEvent, dateKey: string): boolean {
    const startIso = ev.start || ev.dueAt;
    if (!startIso) return false;
    const sKey = localKeyFromIso(startIso);
    if (!sKey) return false;
    const eKey = ev.end || ev.endAt ? localKeyFromIso(ev.end || ev.endAt) : sKey;
    if (!eKey || sKey === eKey) return sKey === dateKey;
    return sKey <= dateKey && dateKey <= eKey;
  }

  // recurrence — FIXED: Dublin TZ, multi-weekday weekly, biweekly parity, monthly semantic, overrides aware
  function expandTemplateForMonth(template: CalendarEvent, y: number, m0: number): CalendarEvent[] {
    try {
      const tz = HOUSEHOLD_TZ;
      return expandTemplateForMonthDublin(template as any, y, m0, tz) as any;
    } catch (e) {
      console.warn("[calendar] expandTemplateForMonth fallback", e);
      return [];
    }
  }


  // --- state ---
  const [viewMonth, setViewMonth] = useState(() => {
    const ref = nowMs ? new Date(nowMs) : new Date();
    try {
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year:"numeric", month:"numeric"});
      const parts = fmt.formatToParts(ref);
      const y = Number(parts.find(p=> p.type==="year")?.value || ref.getFullYear());
      const m = Number(parts.find(p=> p.type==="month")?.value || ref.getMonth()+1)-1;
      return new Date(y, m, 1);
    } catch { return new Date(ref.getFullYear(), ref.getMonth(), 1); }
  });
  const [selected, setSelected] = useState(() => {
    try{
      const saved = localStorage.getItem("couple_v1_calendar_selected");
      if(saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
    }catch{}
    return todayDublin;
  });
  const [mode, setMode] = useState<"month"|"agenda">(()=> {
    try { const s = localStorage.getItem("couple_v1_calendar_mode"); if(s==="agenda"||s==="month") return s as any; } catch {}
    return "month";
  });
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(()=> viewMonth.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(()=> viewMonth.getMonth());
  const [showHistory, setShowHistory] = useState(false);

  const [calFilter, setCalFilter] = useState<"all"|"both"|"aisling"|"ciaran"|"chores">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent|null>(null);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent|null>(null);
  const [showEditSeriesAsk, setShowEditSeriesAsk] = useState<{ ev: CalendarEvent, draft: CalendarEvent }|null>(null);
  const [menuFor, setMenuFor] = useState<string|null>(null);
  const [commentInputs, setCommentInputs] = useState<Record<string,string>>({});
  const [confirmDialog, setConfirmDialog] = useState<null | {title:string; msg?:string; onConfirm:()=>void}>(null);

  useEffect(()=> {
    try { localStorage.setItem("couple_v1_calendar_mode", mode); } catch {}
  }, [mode]);

  useEffect(()=>{
    // keep picker synced when month changes externally
    setPickerYear(viewMonth.getFullYear());
    setPickerMonth(viewMonth.getMonth());
  }, [viewMonth]);

  useEffect(()=>{
    try{
      const vm = localStorage.getItem("couple_v1_calendar_viewMonth");
      if(vm && /^\d{4}-\d{2}$/.test(vm)){
        const [y,m] = vm.split("-").map(Number);
        setViewMonth(new Date(y, m-1, 1));
        localStorage.removeItem("couple_v1_calendar_viewMonth");
      }
      const sel = localStorage.getItem("couple_v1_calendar_selected");
      if(sel && /^\d{4}-\d{2}-\d{2}$/.test(sel)){
        if(sel!==selected){
          setSelected(sel);
          const [yy,mm] = sel.split("-").map(Number);
          setViewMonth(new Date(yy, mm-1, 1));
        }
        localStorage.removeItem("couple_v1_calendar_selected");
      }
    }catch{}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // month occurrences — fixed to suppress overridden dates to avoid duplication
  const monthOccurrences = useMemo(()=> {
    const y = viewMonth.getFullYear();
    const m0 = viewMonth.getMonth();
    const all: CalendarEvent[] = [];
    const tmplRecurring = events.filter(ev=> !ev.deletedAt && (ev.isTemplate || (ev.type==="repeat" && ev.frequency && ev.frequency!=="once")));
    for (const tmpl of tmplRecurring) {
      const occs = expandTemplateForMonth(tmpl, y, m0);
      // filter out those that have an override stored
      for (const o of occs) {
        if (shouldSuppressGeneratedOccurrence(o.templateId, o.occurrenceId, events)) continue;
        all.push(o);
      }
    }
    // also need next month for agenda later-this-week that may cross month boundary
    const nextM = m0===11 ? 0 : m0+1;
    const nextY = m0===11 ? y+1 : y;
    for (const tmpl of tmplRecurring) {
      const occs = expandTemplateForMonth(tmpl, nextY, nextM);
      for (const o of occs) {
        if (shouldSuppressGeneratedOccurrence(o.templateId, o.occurrenceId, events)) continue;
        all.push(o);
      }
    }
    return all;
  }, [events, viewMonth]);

  const visEvents = useMemo(()=> events.filter(ev=> !(ev as any).deletedAt && !(ev as any).isTemplate), [events]);
  const combinedForMonth = useMemo(()=> [...visEvents, ...monthOccurrences], [visEvents, monthOccurrences]);

  // month grid Mon-start
  const y = viewMonth.getFullYear();
  const m0 = viewMonth.getMonth();
  const firstDayDate = new Date(y, m0, 1);
  const jsWeekday = firstDayDate.getDay();
  const firstWdMon = (jsWeekday + 6) % 7;
  const dim = daysInMonthDublin(y, m0);
  const cells: Array<{ key:string|null, day:number|null, isToday:boolean, isSelected:boolean }> = [];
  for (let i=0;i<firstWdMon;i++) cells.push({key:null, day:null, isToday:false, isSelected:false});
  for (let d=1; d<=dim; d++) {
    const key = y+"-"+String(m0+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    cells.push({key, day:d, isToday:key===todayDublin, isSelected:key===selected});
  }
  while (cells.length % 7 !== 0) cells.push({key:null, day:null, isToday:false, isSelected:false});

  const byDay = useMemo(()=> {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of combinedForMonth) {
      for (let d=1; d<=dim; d++) {
        const dayKey = y+"-"+String(m0+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
        if (isEventOnDate(ev, dayKey)) {
          if (!map.has(dayKey)) map.set(dayKey, []);
          map.get(dayKey)!.push(ev);
        }
      }
    }
    return map;
  }, [combinedForMonth, y, m0, dim]);

  const selectedEvents = useMemo(()=> {
    const arr = combinedForMonth.filter(ev=> isEventOnDate(ev, selected));
    return arr.sort((a,b)=> {
      const ta = a.start ? new Date(a.start).getTime() : new Date(a.dueAt||a.createdAt).getTime();
      const tb = b.start ? new Date(b.start).getTime() : new Date(b.dueAt||b.createdAt).getTime();
      return ta-tb;
    });
  }, [combinedForMonth, selected]);

  const choreOverlay = useMemo(()=> {
    if (!chores) return [];
    return (chores as any[]).filter((c:any)=> {
      if (c.deletedAt) return false;
      const k = c.dueAt ? toLocalKeyDublin(c.dueAt, tz) : null;
      return k===selected;
    }).slice(0,3);
  }, [chores, selected]);

  const filteredSelected = useMemo(()=> {
    if (calFilter === "all") return selectedEvents;
    if (calFilter === "chores") return [] as CalendarEvent[];
    if (calFilter === "both") return selectedEvents.filter(ev => !ev.attendees || ev.attendees.length===2);
    if (calFilter === "aisling") return selectedEvents.filter(ev => ev.attendees?.length===1 && ev.attendees[0]==='aisling');
    if (calFilter === "ciaran") return selectedEvents.filter(ev => ev.attendees?.length===1 && ev.attendees[0]==='ciaran');
    return selectedEvents;
  }, [selectedEvents, calFilter]);

  function updateEvent(id:string, patch: Partial<CalendarEvent>) {
    setEvents((prev:any)=> prev.map((ev: CalendarEvent)=> ev.id===id ? { ...ev, ...patch, updatedAt:new Date().toISOString(), updatedBy: currentUser, mutationId: (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()) } : ev));
  }
  function removeEvent(id:string) {
    setEvents((prev:any)=> prev.map((ev: CalendarEvent)=> ev.id===id ? { ...ev, deletedAt:new Date().toISOString(), updatedAt:new Date().toISOString(), updatedBy: currentUser } : ev));
  }
  function handleResponse(ev: CalendarEvent, kind: CalendarResponseKind, comment?: string) {
    const existing = getResponses(ev);
    const otherComment = commentInputs[ev.id]?.trim();
    const finalComment = comment || otherComment || undefined;
    const nowIso = new Date().toISOString();
    const upserted = [...existing.filter(r=> r.memberId!==currentUser), { eventId: ev.id, memberId: currentUser, response: kind, comment: finalComment, respondedAt: nowIso }];
    const newSwipes = { aisling: null as any, ciaran: null as any };
    upserted.forEach(r=> {
      if (r.memberId==="aisling") newSwipes.aisling = r.response === "discuss" ? null : r.response;
      if (r.memberId==="ciaran") newSwipes.ciaran = r.response === "discuss" ? null : r.response;
    });
    // Single source of truth — no special-case overriding
    const derived = computeStatusFromResponses(ev, upserted as any);
    const patch: any = { responses: upserted, swipes: newSwipes, status: derived, mutationId: (globalThis.crypto as any)?.randomUUID ? (globalThis.crypto as any).randomUUID() : String(Date.now()) };
    const notiKey = ev.id+":"+derived+":"+upserted.map(r=> r.memberId+":"+r.response).join("|");
    if (ev.lastNotifiedState !== notiKey) {
      patch.lastNotifiedState = notiKey;
      try { if (onCelebrate && derived==="agreed") onCelebrate({ kind:"calendar-agreed", id:ev.id }); } catch {}
    }
    updateEvent(ev.id, patch);
    setCommentInputs(c=> ({...c, [ev.id]:""}));
    setActiveEvent(prev=> prev && prev.id===ev.id ? { ...prev, ...patch } as any : prev);
  }

  // pinned + ahead counts
  const pinnedEvent = useMemo(()=> (events as any[]).find((ev:any)=> ev.pinned), [events]);
  const scheduledAhead = useMemo(()=>{
    const now = nowMs || Date.now();
    return (events as any[]).filter((ev:any)=> !ev.deletedAt && ev.status==="agreed" && (new Date(ev.start || ev.dueAt || ev.createdAt).getTime() > now)).sort((a:any,b:any)=> new Date(a.start||a.dueAt||a.createdAt).getTime() - new Date(b.start||b.dueAt||b.createdAt).getTime()).slice(0,20);
  }, [events, nowMs]);
  const proposedAhead = useMemo(()=>{
    const now = nowMs || Date.now();
    return (events as any[]).filter((ev:any)=> !ev.deletedAt && ["proposed","awaiting_aisling","awaiting_ciaran","needs_discussion"].includes(ev.status) && (new Date(ev.start || ev.dueAt || ev.createdAt).getTime() > now)).sort((a:any,b:any)=> new Date(a.start||a.dueAt||a.createdAt).getTime() - new Date(b.start||b.dueAt||b.createdAt).getTime()).slice(0,20);
  }, [events, nowMs]);

  function countdownFor(iso?: string){
    if(!iso) return null;
    const ms = new Date(iso).getTime() - (nowMs || Date.now());
    if (ms <= 0) return { days:0, hours:0, mins:0, past:true, label:"today"};
    const days = Math.floor(ms/86400000);
    const hours = Math.floor((ms % 86400000)/3600000);
    const mins = Math.floor((ms % 3600000)/60000);
    return { days, hours, mins, past:false, label: days>1 ? `${days} days` : days===1 ? "1 day" : `${hours}h ${mins}m` };
  }
  function togglePin(ev: any){
    if(ev.pinned) updateEvent(ev.id, { pinned:false, pinnedAt: undefined } as any);
    else setEvents((prev:any)=> prev.map((x:any)=> x.id===ev.id ? {...x, pinned:true, pinnedAt:new Date().toISOString(), updatedAt:new Date().toISOString()} : {...x, pinned:false, pinnedAt:undefined}));
  }

  // Agenda sections (no declined/cancelled unless history)
  const todayKeyStr = todayDublin;
  const tomorrowKeyStr = addDaysKey(todayKeyStr, 1);
  const laterKeys = [2,3,4,5,6].map(n=> addDaysKey(todayKeyStr, n));

  function eventsForKey(key: string): CalendarEvent[] {
    let arr = combinedForMonth.filter(ev=> isEventOnDate(ev, key));
    if (!showHistory) arr = arr.filter(ev=> !["declined","cancelled"].includes(ev.status as any));
    return arr.sort((a,b)=> {
      const ta = a.start ? new Date(a.start).getTime() : new Date(a.dueAt||a.createdAt).getTime();
      const tb = b.start ? new Date(b.start).getTime() : new Date(b.dueAt||b.createdAt).getTime();
      return ta-tb;
    });
  }

  const todayEvents = useMemo(()=> eventsForKey(todayKeyStr), [combinedForMonth, todayKeyStr, showHistory]);
  const tomorrowEvents = useMemo(()=> eventsForKey(tomorrowKeyStr), [combinedForMonth, tomorrowKeyStr, showHistory]);
  const laterEventsFlat = useMemo(()=> {
    const all: { key:string, ev:CalendarEvent}[] = [];
    for (const k of laterKeys) {
      for (const ev of eventsForKey(k)) all.push({key:k, ev});
    }
    return all;
  }, [combinedForMonth, laterKeys.join("|"), showHistory]);

  function goPrevMonth(){
    const nm = new Date(viewMonth); nm.setMonth(nm.getMonth()-1);
    setViewMonth(new Date(nm.getFullYear(), nm.getMonth(), 1));
  }
  function goNextMonth(){
    const nm = new Date(viewMonth); nm.setMonth(nm.getMonth()+1);
    setViewMonth(new Date(nm.getFullYear(), nm.getMonth(), 1));
  }
  function goToday(){
    try {
      const fmt = new Intl.DateTimeFormat("en-US",{timeZone: tz, year:"numeric", month:"numeric"});
      const p = fmt.formatToParts(new Date());
      const yN = Number(p.find(x=> x.type==="year")?.value);
      const mN = Number(p.find(x=> x.type==="month")?.value)-1;
      setViewMonth(new Date(yN,mN,1));
      setSelected(todayDublin);
    } catch {
      const d=new Date(); setViewMonth(new Date(d.getFullYear(), d.getMonth(),1)); setSelected(todayDublin);
    }
  }

  // --- row components inline - V70 ownership clarity ---
  const AgendaRow = ({ ev, dateKey, compact }: { ev: CalendarEvent, dateKey?: string, compact?: boolean }) => {
    const isPending = ["proposed","awaiting_aisling","awaiting_ciaran","needs_discussion"].includes(ev.status as any);
    const timeStr = ev.allDay ? "All day" : toTimeDublin(ev.start || ev.dueAt);
    const loc = (ev as any).location;
    const attendees = (ev as any).attendees || ["aisling","ciaran"];
    const proposer = (ev as any).proposer as PersonKey | undefined;
    const isBoth = attendees.length!==1;
    // V105 boutique left-rule 3px
    const leftRuleColor = isBoth ? "#8B7357" : (attendees[0]==="aisling" ? "#A89FDA" : "#E07A5F");
    const timeMono = ev.allDay ? "All day" : timeStr;
    // dot pulse check — due within 24h urgent only (premium cut)
    let diffDays = 99;
    try { diffDays = Math.round((new Date(ev.start||ev.dueAt).getTime() - Date.now())/86400000); } catch {}
    const isSoon = Math.abs(diffDays)<=2;
    const forLabel = attendees.length===2 ? "Both" : attendees[0]==="aisling" ? "for Aisling" : "for Ciaran";
    const subStatus = (()=> {
      if (ev.status==="agreed") return "Agreed";
      if ((ev.status as any)==="declined") return "Declined";
      if (ev.status==="needs_discussion") return "Needs reply";
      if ((ev.status as any)==="awaiting_aisling") return "Awaiting Á";
      if ((ev.status as any)==="awaiting_ciaran") return "Awaiting C";
      if (ev.status==="proposed") return proposer ? `by ${PERSONS[proposer as any]?.name||proposer}` : "Proposed";
      return ev.status;
    })();
    const sub = [loc, subStatus].filter(Boolean).join(" · ");
    return (
      <button
        onClick={()=> setActiveEvent(ev)}
        className="w-full text-left flex items-stretch gap-0 rounded-[18px] border bg-[var(--card-bg)] overflow-hidden active:scale-[0.98] transition min-h-[64px] relative"
        style={{ borderColor:"var(--border)", boxShadow:"0 8px 24px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.86)", paddingLeft:3 }}
      >
        <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[18px]" style={{ background: leftRuleColor }} aria-hidden="true" />
        <span className="flex flex-1 items-center gap-3 px-3.5 py-3 min-w-0 ml-[3px]">
          <span className="flex flex-col items-center gap-1.5 shrink-0">
            {/* time mono 12px Inter Tight */}
            <span className="tabular-nums text-[12px] font-medium tracking-[0.02em] rounded-full px-2 py-0.5 border" style={{fontFamily:'Inter Tight, var(--font-ui)', color:'var(--muted)', background:'var(--chip-bg)', border:'1px solid var(--border)'}}>{timeMono}</span>
            <span className="h-[7px] w-[7px] rounded-full" style={{background:leftRuleColor, boxShadow: isSoon?`0 0 0 4px ${leftRuleColor}22, 0 0 10px ${leftRuleColor}55`:'none'}} className={`h-[7px] w-[7px] rounded-full ${isSoon?"nylah-dot nylah-dot--urgent":""}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="block text-[14px] font-semibold tracking-tight truncate" style={{color:'var(--text)', fontFamily:'var(--font-ui)'}}>{ev.title}</span>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5">
              <span className="block text-[11px] truncate max-w-[150px]" style={{color:'var(--muted)'}}>{sub || forLabel}</span>
              {isPending && <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border" style={{background:'#121214', color:'#FFFEFB', borderColor:'rgba(255,255,255,0.08)'}}><span style={{color:'var(--accent)'}}>✦</span> Needs you</span>}
            </span>
          </span>
          <span className="shrink-0 rounded-full h-8 w-8 grid place-items-center border text-[12px]" style={{background:'var(--chip-bg)', borderColor:'var(--border)', color:'var(--muted)'}} aria-hidden="true">›</span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Minimal pinned countdown (kept, adapted) */}
      {pinnedEvent && (
        <div className="rounded-[14px] border bg-[var(--card-bg)] px-3 py-2 flex items-center justify-between" style={{borderColor:"var(--border)"}}>
          <div className="min-w-0 flex items-center gap-2">
            <span className="h-6 w-6 grid place-items-center rounded-full bg-[#0A0A0A] text-white"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"><path d="M12 3v14"/><path d="M5 11l7-8 7 8"/><path d="M5 21h14"/></svg></span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium truncate">{pinnedEvent.title}</div>
              <div className="text-[11px] text-[var(--muted)] truncate">{toLocalKeyDublin(pinnedEvent.start||pinnedEvent.dueAt||"", tz)?.slice(5)} {(pinnedEvent as any).location ? " • "+(pinnedEvent as any).location : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(()=>{ const cd=countdownFor(pinnedEvent.start||pinnedEvent.dueAt); return cd ? <span className="rounded-full bg-[#0A0A0A] text-white px-2.5 py-1 text-[11px] font-medium min-h-[28px] grid place-items-center">{cd.past ? "today" : cd.days>0 ? `${cd.days}d ${cd.hours}h` : `${cd.hours}h ${cd.mins}m`}</span> : null})()}
            <button onClick={()=> togglePin(pinnedEvent)} className="h-[32px] w-[32px] grid place-items-center rounded-full border bg-[var(--card-bg)] text-[11px]" style={{borderColor:"var(--border)"}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
        </div>
      )}

      {/* Header: ‹ August 2026 › Today — tappable month opens picker, no Europe/Dublin badge */}
      <div className="flex items-center justify-between px-1">
        <button onClick={goPrevMonth} className="h-[44px] w-[44px] grid place-items-center rounded-full border bg-[var(--card-bg)] active:scale-[0.96] transition text-[16px]" style={{ borderColor:"var(--border)" }} aria-label="Previous month">‹</button>
        <button
          onClick={()=> setShowMonthPicker(v=> !v)}
          className="h-[44px] rounded-full border bg-[var(--card-bg)] px-4 font-display text-[18px] tracking-tight active:scale-[0.98] transition"
          style={{ borderColor:"var(--border)" }}
          aria-expanded={showMonthPicker}
          aria-haspopup="dialog"
        >
          {viewMonth.toLocaleDateString("en-GB", { month:"long", year:"numeric", timeZone: tz })}
        </button>
        <div className="flex items-center gap-1">
          <button onClick={goToday} className="h-[44px] px-3 rounded-full border bg-[var(--card-bg)] text-[11px] font-medium active:scale-[0.96]" style={{borderColor:"var(--border)"}}>Today</button>
          <button onClick={goNextMonth} className="h-[44px] w-[44px] grid place-items-center rounded-full border bg-[var(--card-bg)] text-[16px]" style={{ borderColor:"var(--border)" }} aria-label="Next month">›</button>
        </div>
      </div>

      {/* Month/Year picker sheet inline (pills, type scale) */}
      {showMonthPicker && (
        <div className="rounded-[16px] border bg-[var(--card-bg)] p-3 space-y-2" style={{borderColor:"var(--border)"}}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Jump to</span>
            <button onClick={()=> setShowMonthPicker(false)} className="h-[32px] rounded-full border bg-[var(--chip-bg)] px-3 text-[11px]" style={{borderColor:"var(--border)"}}>Done</button>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <select value={pickerMonth} onChange={e=> setPickerMonth(Number(e.target.value))} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                {Array.from({length:12}).map((_,i)=> <option key={i} value={i}>{new Date(2020,i,1).toLocaleDateString("en-GB",{month:"long"})}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
            <div className="relative w-[110px]">
              <select value={pickerYear} onChange={e=> setPickerYear(Number(e.target.value))} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                {Array.from({length:9}).map((_,i)=> { const yr = new Date().getFullYear()-3+i; return <option key={yr} value={yr}>{yr}</option>; })}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
            <button onClick={()=> { setViewMonth(new Date(pickerYear, pickerMonth, 1)); setShowMonthPicker(false); }} className="h-[44px] min-h-[44px] rounded-[12px] bg-[#0A0A0A] px-4 text-[12px] font-medium text-white">Go</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({length:12}).map((_,i)=> (
              <button key={i} onClick={()=> setPickerMonth(i)} className={"h-[36px] rounded-full border text-[11px] transition "+(pickerMonth===i ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--chip-bg)] border-[var(--border)]")}>{new Date(2020,i,1).toLocaleDateString("en-GB",{month:"short"})}</button>
            ))}
          </div>
        </div>
      )}

      {/* Segmented — V101 Linear pill classy */}
      <div className="px-1">
        <div className="nylah-seg">
          {(["month","agenda"] as const).map(m=> (
            <button
              key={m}
              onClick={()=> setMode(m)}
              className={mode===m ? "active" : ""}
              style={{fontFamily:'var(--font-ui)'}}
            >
              {m==="month" ? "Month" : "Agenda"}
            </button>
          ))}
        </div>
      </div>

      {mode==="month" ? (
        <>
          {/* V107 boutique calendar — Hume charcoal + linen, Fraunces numbers, orange today */}
          <div className="nylah-arena rounded-[24px] px-5 pt-5 pb-4 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.28] pointer-events-none nylah-arena" style={{}} />
            <div className="relative">
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.13em] text-[var(--muted)] mb-2 px-1" style={{fontFamily:'var(--font-ui)'}}><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
              <div className="grid grid-cols-7 gap-1.5">
                {cells.map((c,i)=>{
                  if (!c.key) return <div key={"empty-"+i} className="min-h-[44px] min-w-[44px]" />;
                  const dayEvs = (byDay.get(c.key!) || []) as any[];
                  const evCount = dayEvs.length;
                  const hasEv = evCount>0;
                  const isSel = c.isSelected;
                  const isToday = c.isToday;
                  return (
                    <button
                      key={c.key}
                      onClick={()=> setSelected(c.key!)}
                      aria-label={c.key + (hasEv ? " has "+evCount+" events" : "")}
                      className={"relative min-h-[44px] w-full rounded-[14px] grid place-items-center border transition-all active:scale-[0.96] py-2.5 " + (isSel ? "" : isToday ? "" : "")}
                      style={{
                        minHeight:44,
                        background: isSel ? '#121214' : isToday ? 'rgba(255,107,38,0.14)' : 'var(--card-bg)',
                        color: isSel ? '#FFFEFB' : 'var(--text)',
                        borderColor: isSel ? '#121214' : isToday ? 'rgba(255,107,38,0.28)' : 'var(--border)',
                        boxShadow: isSel ? '0 8px 20px rgba(0,0,0,0.22), 0 0 0 1px #121214 inset' : isToday ? '0 0 0 4px rgba(255,107,38,0.10), 0 4px 16px rgba(255,107,38,0.12)' : '0 1px 0 rgba(255,255,255,0.86) inset',
                        fontFamily: 'Fraunces, var(--font-display)',
                        fontWeight: isSel || isToday ? 600 : 500,
                        fontSize: '13px'
                      }}
                    >
                      <span className="leading-none">{c.day}</span>
                      {hasEv && (
                        <span className="absolute bottom-[5px] left-1/2 -translate-x-1/2 flex gap-[2.5px] justify-center items-center">
                          {dayEvs.slice(0,3).map((ev:any,j:number)=> {
                            const at = (ev as any).attendees || ["aisling","ciaran"];
                            const col = at.length===1 ? (at[0]==="aisling" ? "#A89FDA" : "#E07A5F") : "#8B7357";
                            const pulse = isToday;
                            return <span key={j} className="rounded-full" style={{ width:'5px', height:'5px', background:col, boxShadow: pulse?`0 0 6px ${col}88`: undefined, animation: pulse?'nylah-dot-subtle 2.8s infinite':undefined }} />;
                          })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Color key - who the dot is for */}
              <div className="mt-3 flex items-center justify-center gap-3 text-[11px] font-medium text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#A89FDA"}}/> Aisling</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#E07A5F"}}/> Ciaran</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-[7px] w-[7px] rounded-full" style={{background:"#8B7357"}}/> Both</span>
              </div>
            </div>
          </div>

          <div className="px-1 flex items-center justify-between">
            <div className="flex items-center gap-2"><span className="font-display text-[14px]">{toLongDateDublin(selected) || selected}</span>{selected===todayDublin && <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2 py-0.5">Today</span>}</div>
            <button onClick={()=> setShowAdd(true)} className="h-[36px] rounded-full bg-[#0A0A0A] px-3 text-[11px] text-white">+ Add</button>
          </div>

          <div className="px-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-[var(--muted)]">Filter</span>
              <span className="text-[11px] text-[var(--muted)]">as {(PERSONS[currentUser]?.name||currentUser||'You')}</span>
            </div>
            <div className="relative">
              <select value={calFilter} onChange={e=> setCalFilter(e.target.value as any)} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
                <option value="all">All</option>
                <option value="both">Both</option>
                <option value="aisling">Aisling</option>
                <option value="ciaran">Ciarán</option>
                <option value="chores">Chores</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
            </div>
          </div>

          {/* Compact selected-day list */}
          <div className="space-y-2">
            {calFilter==="chores" ? (
              <div className="space-y-1">
                <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Chores • {choreOverlay.length}</div>
                {choreOverlay.length>0 ? choreOverlay.map((c:any)=> <div key={c.id} className="rounded-[12px] border bg-[var(--card-bg)] px-3 py-2 text-[11px]" style={{borderColor:"var(--border)"}}>{c.title}</div>) : <div className="rounded-[16px] border-dashed border bg-[var(--card-bg)] px-4 py-6 text-center text-[12px] text-[var(--muted)]">No chores that day</div>}
              </div>
            ) : filteredSelected.length===0 ? (
              <div className="rounded-[16px] border border-dashed bg-[var(--card-bg)] px-6 py-6 text-center" style={{borderColor:"var(--border)"}}>
                <div className="font-display text-[13px]">No plans</div>
                <div className="text-[11px] text-[var(--muted)] mt-1">{selected}</div>
                <button onClick={()=> setShowAdd(true)} className="mt-3 h-[36px] rounded-full bg-[#0A0A0A] px-4 text-[11px] text-white">Add event</button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">{filteredSelected.length} events</div>
                {filteredSelected.map(ev=> <AgendaRow key={ev.id} ev={ev} compact />)}
              </div>
            )}
          </div>
        </>
      ) : (
        // --- AGENDA MODE ---
        <div className="space-y-4">
          {/* Counts row (inside Agenda, not top hero) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[12px] border bg-[var(--card-bg)] px-3 py-2.5" style={{borderColor:"var(--border)"}}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Scheduled • {scheduledAhead.length}</div>
              <div className="mt-1 text-[11px] font-medium">{scheduledAhead.length===0 ? <span className="text-[var(--muted)] font-normal">No agreed dates ahead</span> : `${scheduledAhead[0].title} • ${toLocalKeyDublin(scheduledAhead[0].start||scheduledAhead[0].dueAt,"")?.slice(5)}`}</div>
            </div>
            <div className="rounded-[12px] border bg-[var(--chip-bg)] px-3 py-2.5" style={{borderColor:"var(--border)"}}>
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Proposed • {proposedAhead.length}</div>
              <div className="mt-1 text-[11px]">{proposedAhead.length===0 ? <span className="text-[var(--muted)]">Nothing waiting</span> : <span className="truncate">{proposedAhead[0].title} • needs you</span>}</div>
            </div>
          </div>

          {/* Today */}
          <div>
            <div className="px-1 flex items-center justify-between mb-1">
              <span className="font-display text-[13px]">Today • {todayKeyStr.slice(5)}</span>
              <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-2 py-0.5">{todayEvents.length}</span>
            </div>
            <div className="space-y-1.5">
              {todayEvents.length===0 ? <div className="text-[11px] text-[var(--muted)] px-1">No plans today</div> : todayEvents.map(ev=> <AgendaRow key={ev.id} ev={ev} dateKey={todayKeyStr} />)}
            </div>
          </div>

          <div>
            <div className="px-1 flex items-center justify-between mb-1"><span className="font-display text-[13px]">Tomorrow • {tomorrowKeyStr.slice(5)}</span><span className="text-[11px] text-[var(--muted)] border rounded-full px-2 py-0.5">{tomorrowEvents.length}</span></div>
            <div className="space-y-1.5">
              {tomorrowEvents.length===0 ? <div className="text-[11px] text-[var(--muted)] px-1">Free</div> : tomorrowEvents.map(ev=> <AgendaRow key={ev.id} ev={ev} dateKey={tomorrowKeyStr} />)}
            </div>
          </div>

          <div>
            <div className="px-1 mb-1"><span className="font-display text-[13px]">Later this week</span><span className="ml-2 text-[11px] text-[var(--muted)]">{laterEventsFlat.length} upcoming</span></div>
            <div className="space-y-1.5">
              {laterEventsFlat.length===0 ? <div className="text-[11px] text-[var(--muted)] px-1">Nothing else this week</div> : laterEventsFlat.slice(0,10).map(({key,ev})=> <AgendaRow key={ev.id+"-"+key} ev={ev} dateKey={key} />)}
            </div>
          </div>

          {/* Pending decisions */}
          <div className="rounded-[14px] border bg-[var(--card-bg)] p-2.5" style={{borderColor:"var(--border)"}}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Pending decisions • {proposedAhead.length}</span>
              <button onClick={()=> setShowHistory(v=>!v)} className="text-[11px] underline text-[var(--muted)]">{showHistory ? "Hide history" : "History"}</button>
            </div>
            {proposedAhead.length===0 ? (
              <div className="text-[11px] text-[var(--muted)]">Nothing waiting</div>
            ) : (
              <div className="space-y-1.5 max-h-[240px] overflow-auto no-scrollbar">
                {proposedAhead.slice(0,8).map(ev=> (
                  <button key={ev.id} onClick={()=> setActiveEvent(ev)} className="w-full text-left flex items-center justify-between gap-2 rounded-[10px] bg-[var(--chip-bg)] px-3 py-2 min-h-[44px]">
                    <span className="text-[11px] truncate font-medium">{ev.title}</span>
                    <span className="text-[11px] rounded-full bg-[#0A0A0A] text-white px-1.5 py-0.5 shrink-0">{(ev.status||"").startsWith("awaiting")? "needs you" : "proposed"}</span>
                  </button>
                ))}
              </div>
            )}
            {showHistory && (
              <div className="mt-2 pt-2 border-t" style={{borderColor:"var(--border)"}}>
                <div className="text-[11px] text-[var(--muted)] mb-1">Declined / Cancelled (history)</div>
                <div className="flex flex-wrap gap-1.5">
                  {(events as any[]).filter(ev=> !ev.deletedAt && ["declined","cancelled"].includes(ev.status)).slice(0,8).map(ev=> <span key={ev.id} className="rounded-full border bg-[var(--card-bg)] px-2.5 py-1 text-[11px] line-through" style={{borderColor:"var(--border)"}}>{ev.title}</span>)}
                </div>
              </div>
            )}
          </div>

          <button onClick={()=> setShowAdd(true)} className="w-full h-[44px] rounded-full bg-[#0A0A0A] text-white text-[12px] font-medium">+ Add event</button>
        </div>
      )}

      {/* V62 FAB - 56px black bottom-[88px] bigger shadow 0 12px 24px */}
      <div className="pointer-events-none sticky bottom-[88px] z-10 flex justify-end px-1 mt-2">
        <button onClick={()=> setShowAdd(true)} className="pointer-events-auto grid h-[56px] w-[56px] place-items-center rounded-full bg-[#0A0A0A] text-white shadow-[0_12px_24px_rgba(0,0,0,0.28)] active:scale-[0.98] text-[22px] font-semibold border border-white/10">+</button>
      </div>

      {/* Event detail sheet: V70 ownership clarity */}
      <BottomSheet open={!!activeEvent} onClose={()=> setActiveEvent(null)} title={activeEvent ? activeEvent.title : undefined}>
        {activeEvent && (()=> {
          const ev = activeEvent;
          const k = toLocalKeyDublin(ev.start||ev.dueAt||"", tz) || selected;
          const responses = getResponses(ev);
          const myResp = responses.find(r=> r.memberId===currentUser);
          const timeA = ev.allDay ? "All-day" : toTimeDublin(ev.start||ev.dueAt);
          const timeB = ev.end ? "→ "+toTimeDublin(ev.end) : "";
          const attendees = (ev as any).attendees || ["aisling","ciaran"];
          const proposer = (ev as any).proposer as PersonKey | undefined;
          const isBoth = attendees.length!==1;
          const ownerText = (()=> {
            const pName = proposer ? PERSONS[proposer as any].name : null;
            if (attendees.length===1) {
              const sole = attendees[0]; const soleName = PERSONS[sole as any].name;
              if (proposer && proposer===sole) return `${soleName}'s personal — created by ${pName}`;
              if (proposer) return `Created by ${pName} for ${soleName}`;
              return `${soleName}'s personal`;
            }
            return pName ? `Both — created by ${pName}` : "Both — shared";
          })();
          const myColor = currentUser==="aisling" ? "text-[#6B5CA8]" : "text-[#92400E]";
          return (
            <div className="space-y-3">
              <div className="rounded-[12px] border bg-[var(--card-bg)] px-3 py-2.5 text-[11px] space-y-1.5" style={{borderColor:"var(--border)"}}>
                <div className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 3v3M16 3v3"/></svg> {k} • {toLongDateDublin(k)}</div>
                <div className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> {timeA} {timeB}</div>
                {(ev as any).location && <div className="flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 21s7-6 7-10a7 7 0 1 0-14 0c0 4 7 10 7 10Z"/><circle cx="12" cy="11" r="2.5"/></svg> {(ev as any).location}</div>}
                <div className="flex items-center gap-2 flex-wrap"><span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold" style={{borderColor:'var(--border)', background: isBoth? 'var(--chip-bg)' : attendees[0]==="aisling" ? '#EDE8FF' : '#FFECD6', color: isBoth? '#6B5242' : attendees[0]==="aisling" ? '#6B5CA8':'#92400E'}}><span className={"grid h-[14px] w-[14px] place-items-center rounded-full text-[8px] font-bold text-white "+(isBoth?"bg-[#8B7357]":attendees[0]==="aisling"?"bg-[#A89FDA]":"bg-[#E07A5F]")}>{isBoth?"2":attendees[0]==="aisling"?"Á":"C"}</span>{ownerText}</span><span className={"inline-flex rounded-full border px-2 py-0.5 text-[10px] "+(ev.status==="agreed"?"bg-[var(--chip-bg)] text-[#6B5CA8] border-[#C4B5FD]": (ev.status as any)==="declined"?"bg-[#FFE4E6] text-[#9F1239] border-[#FECDD3]":"bg-[var(--card-bg)] text-[#92400E] border-[#FDBA74]")}>{String(ev.status||"proposed").replace("_"," ")}</span></div>
              </div>
              {ev.notes && <div className="text-[12px] bg-[var(--card-bg)] border rounded-[10px] p-2" style={{borderColor:"var(--border)"}}>{ev.notes}</div>}

              {/* Two-row ownership response matrix */}
              <div className="rounded-[12px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:'var(--border)'}}>
                {["aisling","ciaran"].map(pk=> {
                  const p = PERSONS[pk as any]; const resp = responses.find(r=> r.memberId===pk);
                  const isMe = pk===currentUser;
                  const label = (()=> {
                    if (!resp) return "Waiting";
                    if (resp.response==="yes") return "Yes";
                    if (resp.response==="no") return "No";
                    if (resp.response==="discuss") return "Needs talk";
                    return resp.response;
                  })();
                  const dot = resp?.response==="yes" ? "bg-[#16A34A]" : resp?.response==="no" ? "bg-[#DC2626]" : resp ? "bg-[#F59E0B]" : "bg-[var(--border)]";
                  const rowBg = isMe ? "bg-[var(--card-bg)]" : "bg-[var(--card-bg)]";
                  return (
                    <div key={pk} className={"flex items-center justify-between px-3 py-2 text-[12px] border-b last:border-0 "+rowBg+(isMe?" ring-[0.5px] ring-inset ring-[var(--border)]":"")} style={{borderColor:'var(--border)'}}>
                      <span className="flex items-center gap-2"><span className={"grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-white "+(pk==="aisling"?"bg-[#A89FDA]":"bg-[#E07A5F]")}>{pk==="aisling"?"Á":"C"}</span><span className={"font-medium "+(isMe?myColor:"text-[var(--text)]")}>{p.name}{isMe?" (you)":""}</span></span>
                      <span className="flex items-center gap-1.5"><span className={"h-[7px] w-[7px] rounded-full "+dot}/><span className={"rounded-full border px-2 py-0.5 text-[10px] "+(isMe?"font-semibold bg-[var(--chip-bg)] text-[var(--text)]":"bg-[var(--card-bg)] text-[var(--text-secondary)]") } style={{borderColor:'var(--border)'}}>{label}</span></span>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-1.5">
                <button onClick={()=> handleResponse(ev,"yes")} className={"flex-1 h-[44px] rounded-full text-[11px] font-medium border "+(myResp?.response==="yes" ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)]") } style={{borderColor:"var(--border)"}}>Yes</button>
                <button onClick={()=> handleResponse(ev,"discuss")} className={"flex-1 h-[44px] rounded-full text-[11px] border "+(myResp?.response==="discuss" ? "bg-[var(--chip-bg)] border-[#A89FDA]" : "bg-[var(--chip-bg)]")} style={{borderColor:"var(--border)"}}>Discuss</button>
                <button onClick={()=> handleResponse(ev,"no")} className={"flex-1 h-[44px] rounded-full text-[11px] border "+(myResp?.response==="no" ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-[var(--card-bg)]")} style={{borderColor:"var(--border)"}}>No</button>
              </div>

              <div className="flex gap-1.5">
                <input value={commentInputs[ev.id]||""} onChange={e=> setCommentInputs(c=> ({...c, [ev.id]: e.target.value}))} placeholder='Add a note — "Could we do Saturday?"' className="flex-1 rounded-full border bg-[var(--card-bg)] px-3 h-[44px] text-[11px]" style={{borderColor:"var(--border)"}} />
                <button disabled={!commentInputs[ev.id]?.trim()} onClick={()=> handleResponse(ev, (myResp as any)?.response as any || "discuss", commentInputs[ev.id])} className="rounded-full bg-[#0A0A0A] px-4 h-[44px] text-[11px] text-white disabled:opacity-40">Add note</button>
              </div>

              {responses.length>0 && (
                <div className="text-[11px] text-[var(--muted)]">
                  {responses.map(r=> `${(PERSONS[r.memberId as any]?.name||r.memberId||"?")}: ${r.response}${r.comment ? " — "+r.comment : ""}`).join(" • ")}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button onClick={()=> { setEditing(ev); setActiveEvent(null); }} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[36px] text-[11px]" style={{borderColor:"var(--border)"}}>Edit</button>
                <button onClick={()=> togglePin(ev)} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[36px] text-[11px]" style={{borderColor:"var(--border)"}}>{(ev as any).pinned ? "Unpin" : "Pin countdown"}</button>
                <button onClick={()=> setConfirmDialog({title:"Cancel event?", msg:"It stays visible as cancelled.", onConfirm:()=>{ updateEvent(ev.id, { status:"cancelled" as any }); setActiveEvent(null); setConfirmDialog(null); }})} className="flex-1 rounded-full border bg-[var(--card-bg)] h-[36px] text-[11px] text-[#B91C1C]" style={{borderColor:"var(--border)"}}>Cancel</button>
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      <BottomSheet open={showAdd} onClose={()=> setShowAdd(false)} title="Add event • Dublin">
        <AddEventForm onAdd={(ev:any)=> { setEvents((p:any)=> [ev, ...p]); setShowAdd(false); }} currentUser={currentUser} selectedDate={selected} />
      </BottomSheet>

      <BottomSheet open={!!editing} onClose={()=> setEditing(null)} title={editing ? "Edit event" : undefined}>
        {editing && (
          <div className="space-y-3">
            <AddEventForm onAdd={(ev:any)=> {
              if (editing.templateId || editing.isTemplate) { setShowEditSeriesAsk({ ev: editing, draft: ev }); return; }
              setEvents((prev:any)=> prev.map((x:any)=> x.id===editing.id ? {...x, ...ev, id: x.id} : x));
              setEditing(null);
            }} currentUser={currentUser} selectedDate={selected} initialEvent={editing} />
            <button onClick={()=> setConfirmDialog({title:"Delete proposal?", onConfirm:()=>{ removeEvent(editing!.id); setEditing(null); setConfirmDialog(null); }})} className="w-full rounded-full border bg-[var(--card-bg)] py-2.5 text-[11px] text-[#B91C1C] min-h-[44px]" style={{borderColor:"var(--border)"}}>Delete proposal</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!showEditSeriesAsk} onClose={()=> setShowEditSeriesAsk(null)} title="Edit recurring">
        {showEditSeriesAsk && (
          <div className="space-y-2">
            <div className="text-[12px]">This is a recurring event: {showEditSeriesAsk.ev.title}. How to apply change?</div>
            <button onClick={()=> {
              const { ev, draft } = showEditSeriesAsk;
              const templateId = ev.templateId || ev.id;
              const occurrenceId = ev.occurrenceId || (()=>{ try{ return toLocalKeyDublin(ev.dueAt||ev.start||"", HOUSEHOLD_TZ)||"" }catch{return ""}})();
              const nowISO = new Date().toISOString();
              const override = {
                ...draft,
                id: uid("cal_ovr"),
                templateId,
                occurrenceId,
                occurrenceDate: occurrenceId,
                seriesId: templateId,
                isTemplate: false,
                isOverride: true,
                updatedAt: nowISO,
                createdAt: nowISO,
              };
              setEvents((prev:any)=> {
                const filtered = prev.filter((x:any)=> !(x.templateId===templateId && x.occurrenceId===occurrenceId && x.id!==templateId));
                return [override, ...filtered];
              });
              try{ upsertCalendarOverride({ id: override.id, seriesId: templateId, occurrenceDate: occurrenceId, occurrenceId, data: override, title: (override as any).title }).catch(()=>{}); }catch{}
              setShowEditSeriesAsk(null); setEditing(null);
            }} className="w-full rounded-full bg-[#0A0A0A] h-[44px] text-white text-[11px]">This event only</button>
            <button onClick={()=> {
              const { ev, draft } = showEditSeriesAsk;
              const templateId = ev.templateId || ev.id;
              const occurrenceId = ev.occurrenceId || (()=>{ try{ return toLocalKeyDublin(ev.dueAt||ev.start||"", HOUSEHOLD_TZ)||"" }catch{return ""}})();
              // split series: truncate original at day-1, new series starts at occurrence
              const prevDayKey = occurrenceId ? addDaysKey(occurrenceId, -1) : null;
              const nowISO = new Date().toISOString();
              const draftHourMin = (()=>{ try{ const hm=getDublinHourMinuteFromIso((draft as any).dueAt||(draft as any).start||ev.dueAt||"", HOUSEHOLD_TZ); return hm; }catch{return {h:9,m:0}} })();
              // derive new series dueAt from occurrence wall + draft time if draft provides new time
              let newDueAt = (draft as any).dueAt || (draft as any).start || ev.dueAt;
              // if draft has same time logic, reconstruct from occurrenceId + draft time to avoid device TZ
              try{
                if (occurrenceId) {
                  const [yy,mm,dd] = occurrenceId.split("-").map(Number);
                  if (yy&&mm&&dd) {
                    const h = draftHourMin.h; const m = draftHourMin.m;
                    const { tzWallToUtc: wallToUtc } = (()=>{ try{ return { tzWallToUtc } }catch{return {tzWallToUtc: (a:any,b:any,c:any,d:any,e:any)=> new Date()} } })() as any;
                    // use imported tzWallToUtc directly
                    const probe = tzWallToUtc(yy, mm, dd, h, m, 0, HOUSEHOLD_TZ);
                    newDueAt = probe.toISOString();
                  }
                }
              }catch{}
              const newSeriesId = uid("cal");
              const newSeries = {
                ...draft,
                id: newSeriesId,
                isTemplate: true,
                dueAt: newDueAt,
                start: newDueAt,
                originalDom: (draft as any).originalDom ?? (ev as any).originalDom ?? (()=>{ try{ const [,,dd]=occurrenceId.split("-").map(Number); return dd }catch{return undefined}})(),
                createdAt: nowISO,
                updatedAt: nowISO,
                recurrenceUntil: undefined,
              };
              setEvents((prev:any)=> {
                let out = prev.map((x:any)=> {
                  if (x.id===templateId) {
                    return { ...x, recurrenceUntil: prevDayKey, updatedAt: nowISO };
                  }
                  return x;
                });
                // remove future overrides for old series (occurrence >= this)
                out = out.filter((x:any)=> {
                  if (x.templateId===templateId && x.occurrenceId && occurrenceId) {
                    if (x.occurrenceId >= occurrenceId) return false;
                  }
                  return true;
                });
                return [newSeries, ...out];
              });
              try{ 
                upsertCalendarSeries({ id: templateId } as any).catch(()=>{});
                upsertCalendarSeries({ id: newSeriesId, title: (newSeries as any).title, frequency: (newSeries as any).frequency, frequencyDetail: (newSeries as any).frequencyDetail, timezone: HOUSEHOLD_TZ } as any).catch(()=>{});
              }catch{}
              setShowEditSeriesAsk(null); setEditing(null);
            }} className="w-full rounded-full border bg-[var(--card-bg)] h-[44px] text-[11px]" style={{borderColor:"var(--border)"}}>This and future events</button>
            <button onClick={()=> {
              const { draft } = showEditSeriesAsk;
              const templateId = showEditSeriesAsk.ev.templateId || showEditSeriesAsk.ev.id;
              const nowISO = new Date().toISOString();
              setEvents((prev:any)=> prev.map((x:any)=> x.id===templateId ? {...x, ...draft, id: templateId, isTemplate:true, updatedAt: nowISO} : x).filter((x:any)=> !(x.templateId===templateId && x.id!==templateId)));
              try{ upsertCalendarSeries({ id: templateId, title: (draft as any).title, frequency: (draft as any).frequency, frequencyDetail: (draft as any).frequencyDetail, timezone: HOUSEHOLD_TZ } as any).catch(()=>{}); }catch{}
              setShowEditSeriesAsk(null); setEditing(null);
            }} className="w-full rounded-full border bg-[var(--card-bg)] h-[44px] text-[11px]" style={{borderColor:"var(--border)"}}>Entire series</button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={!!confirmDialog} onClose={()=> setConfirmDialog(null)} title={confirmDialog?.title || "Confirm"}>
        {confirmDialog && (
          <div className="space-y-3">
            {confirmDialog.msg && <div className="text-[12px] text-[var(--muted)]">{confirmDialog.msg}</div>}
            <div className="flex gap-2">
              <button onClick={()=> setConfirmDialog(null)} className="flex-1 rounded-full border bg-[var(--card-bg)] py-2.5 text-[12px] min-h-[44px]" style={{borderColor:"var(--border)"}}>Cancel</button>
              <button onClick={()=> { confirmDialog.onConfirm(); }} className="flex-1 rounded-full bg-[#0A0A0A] py-2.5 text-[12px] text-white min-h-[44px]">Confirm</button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}



function IconCat({ cat, size=16, active }: {cat: ShoppingCategory; size?: number; active?: boolean}) {
  const stroke = active ? "#0A0A0A" : "#8B7357";
  const s = size;
  if (cat==="Food") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 7c-2-2-7-1.5-5 3 1.2 2.6 5 5 5 5s3.8-2.4 5-5c2-4.5-3-5-5-3Z"/><path d="M12 7V4"/><path d="M9 4c0.5-0.8 2.5-1 3 0"/></svg>;
  if (cat==="Household") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><path d="M7 10l3 8 2-4 2 4 3-8"/><path d="M12 2v3"/><path d="M9 22h6"/></svg>;
  if (cat==="Toiletries") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><path d="M12 2.8c0 0-7 8.2-7 13.2a7 7 0 0 0 14 0C19 11 12 2.8 12 2.8Z"/></svg>;
  if (cat==="Clothes") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><path d="M9 3l-5 5 2 2 3-2.5V20h6V7.5L18 10l2-2-5-5H9Z"/></svg>;
  if (cat==="Bills") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><path d="M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>;
  if (cat==="Trips") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><rect x="6" y="7" width="12" height="10" rx="2"/><path d="M9 7V5h6v2"/><path d="M8 12h8"/></svg>;
  if (cat==="Entertainment") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3l-3 3-3-3H6a2 2 0 0 1-2-2V7Z"/><circle cx="12" cy="10" r="1.2"/><circle cx="9" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/></svg>;
  if (cat==="Personal") return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><circle cx="12" cy="8" r="3.2"/><path d="M6 20a6 6 0 0 1 12 0"/></svg>;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.5}><path d="M6 7h12v10H6z"/><path d="M9 7V5h6v2"/></svg>;
}

function ShoppingPageFacelift({
  items, setItems, currentUser, onCelebrate, nowMs,
}: {
  items: ShoppingItemV2[]; setItems: any; currentUser: PersonKey; onCelebrate?: any; nowMs: number;
}) {
  const [tripMode, setTripMode] = useState(false);
  const [segment, setSegment] = useState<"household"|"aisling"|"ciaran">("household");
  const [catFilter, setCatFilter] = useState<ShoppingCategory|"All">("All");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addText, setAddText] = useState("");
  const [addCat, setAddCat] = useState<ShoppingCategory>("Food");
  const [addFreq, setAddFreq] = useState<ShoppingFrequency>("as-needed");
  const [addQty, setAddQty] = useState(1);
  const [addNeedDays, setAddNeedDays] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [editing, setEditing] = useState<ShoppingItemV2|null>(null);
  const [editQty, setEditQty] = useState(1);
  const [editCat, setEditCat] = useState<ShoppingCategory>("Food");
  const [editFreq, setEditFreq] = useState<ShoppingFrequency>("as-needed");
  const [editNeedDays, setEditNeedDays] = useState<boolean[]>(()=>[false,false,false,false,false,false,false]);
  const [editNotes, setEditNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBought, setShowBought] = useState(false);
  const [confirmDelId, setConfirmDelId] = useState<string|null>(null);

  const activeItems = useMemo(()=> items.filter((s:any)=> !(s as any).deletedAt && !(s as any).archivedAt && (s as any).item?.trim()), [items]);
  const boughtAll = useMemo(()=> activeItems.filter(s=> s.purchased).sort((a,b)=> new Date((b as any).lastDoneAt||b.createdAt).getTime()-new Date((a as any).lastDoneAt||a.createdAt).getTime()), [activeItems]);

  const filtered = useMemo(()=>{
    let list = activeItems;
    if(segment==="household") list = list.filter(i=> !(i as any).tags?.some((t:string)=> t.includes("aisling")||t.includes("ciaran")) || (i as any).templateKind);
    else if(segment==="aisling") list = list.filter(i=> (i as any).addedBy==="aisling" || (i as any).templateOwner==="aisling" || (i as any).tags?.some((t:string)=> t.includes("aisling")));
    else list = list.filter(i=> (i as any).addedBy==="ciaran" || (i as any).templateOwner==="ciaran" || (i as any).tags?.some((t:string)=> t.includes("ciaran")));
    if(catFilter!=="All") list = list.filter(i=> i.cat===catFilter);
    if(query.trim()){
      const q=query.toLowerCase();
      list = list.filter(i=> i.item.toLowerCase().includes(q) || i.cat.toLowerCase().includes(q));
    }
    return list;
  }, [activeItems, segment, catFilter, query]);

  const todo = useMemo(()=> filtered.filter(s=> !s.purchased).sort((a,b)=> CATS.indexOf(a.cat)-CATS.indexOf(b.cat)), [filtered]);
  const bought = useMemo(()=> filtered.filter(s=> s.purchased), [filtered]);
  const countTodo = todo.length;
  const suggested = useMemo(()=> boughtAll.slice(0,3), [boughtAll]);

  const grouped = useMemo(()=>{
    const map = new Map<ShoppingCategory, ShoppingItemV2[]>();
    for(const it of todo){
      const k = it.cat as ShoppingCategory;
      if(!map.has(k)) map.set(k, []);
      map.get(k)!.push(it as any);
    }
    const ordered: {cat: ShoppingCategory; items: ShoppingItemV2[]}[] = [];
    for(const c of CATS){ if(map.has(c)) ordered.push({cat:c, items: map.get(c)!}); }
    for(const [k,v] of map.entries()){ if(!(CATS as any).includes(k)) ordered.push({cat:k, items:v}); }
    return ordered;
  }, [todo]);

  const tripProgress = useMemo(()=>{
    const total = activeItems.filter(s=> !s.purchased).length + activeItems.filter(s=> s.purchased).length;
    const done = activeItems.filter(s=> s.purchased).length;
    return { done, total: total||1, left: Math.max(0, total-done) };
  }, [activeItems]);

  function addItem(){
    if(!addText.trim()) return;
    const now = new Date();
    const needStr = (addFreq==="weekly" || addFreq==="biweekly") ? boolToNeedDaysString(addNeedDays) : undefined;
    const it: ShoppingItemV2 = {
      id: uid("shop"),
      item: addText.trim(),
      qty: addQty,
      cat: addCat,
      purchased: false,
      addedBy: currentUser,
      createdAt: now.toISOString(),
      repeatCount: 0,
      frequency: addFreq,
      needDays: needStr,
      notes: undefined,
      updatedAt: now.toISOString(),
      updatedBy: currentUser,
      originalDom: addFreq === "monthly" ? now.getDate() : undefined,
    } as any;
    setItems((p:any)=> [it, ...p]);
    setAddText(""); setAddOpen(false);
    setAddCat("Food"); setAddFreq("as-needed" as any); setAddQty(1);
    setAddNeedDays([false,false,false,false,false,false,false]);
    setShowAdvanced(false);
  }

  function togglePurchased(it: ShoppingItemV2){
    const nowISO = new Date().toISOString();
    setItems((prev:any)=> prev.map((x:any)=> x.id===it.id ? {...x, purchased: !x.purchased, lastDoneAt: !x.purchased ? nowISO : x.lastDoneAt, updatedAt: nowISO, updatedBy: currentUser} : x));
    if(!it.purchased){ try{ onCelebrate?.(it); }catch{} }
  }

  function saveEdit(){
    if(!editing) return;
    const needStr = (editFreq==="weekly" || editFreq==="biweekly") ? boolToNeedDaysString(editNeedDays) : undefined;
    setItems((prev:any)=> prev.map((x:any)=> x.id===editing.id ? {...x, qty: editQty, cat: editCat, frequency: editFreq, needDays: needStr, notes: editNotes||undefined, updatedAt: new Date().toISOString(), updatedBy: currentUser} : x));
    setEditing(null); setConfirmDelId(null);
  }

  function handleDelete(id: string){
    const nowISO = new Date().toISOString();
    setItems((p:any)=> p.map((x:any)=> x.id===id ? {...x, deletedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x));
    setEditing(null); setConfirmDelId(null);
  }

  function handleArchive(id: string){
    const nowISO = new Date().toISOString();
    setItems((p:any)=> p.map((x:any)=> x.id===id ? {...x, archivedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x));
    setEditing(null);
  }

  // Trip grouped
  const tripGrouped = useMemo(()=>{
    const list = activeItems.filter(s=> !s.purchased);
    const map = new Map<ShoppingCategory, ShoppingItemV2[]>();
    for(const it of list){ const k=it.cat as ShoppingCategory; if(!map.has(k)) map.set(k,[]); map.get(k)!.push(it as any); }
    const ordered:any[]=[];
    for(const c of CATS){ if(map.has(c)) ordered.push({cat:c, items: map.get(c)}); }
    for(const [k,v] of map.entries()) if(!(CATS as any).includes(k)) ordered.push({cat:k, items:v});
    return ordered as {cat:ShoppingCategory, items:ShoppingItemV2[]}[];
  }, [activeItems]);

  const tripDone = activeItems.filter(s=> s.purchased);

  if(tripMode){
    const left = tripProgress.left;
    return createPortal(
      <div className="fixed inset-0 z-[80] flex flex-col bg-[var(--chip-bg)] safe-trip">
        {/* progress rail 2px */}
        <div className="h-[2px] w-full bg-[var(--wash-mid)]">
          <div className="h-[2px] bg-[#0A0A0A] transition-all duration-500" style={{width: tripProgress.total? (tripProgress.done/tripProgress.total*100)+'%' : '0%'}}/>
        </div>
        <div className="flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-3 border-b bg-[var(--card-bg)]" style={{borderColor:'var(--border)'}}>
          <button onClick={()=> setTripMode(false)} className="grid h-[44px] w-[44px] place-items-center rounded-full border bg-[var(--card-bg)] active:scale-[0.97]" style={{borderColor:'var(--border)'}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
          <div className="text-center">
            <div className="font-display text-[15px] font-semibold">Shop</div>
            <div className="text-[11px] text-[var(--muted)]">{tripProgress.done} of {tripProgress.total} • {left} left</div>
          </div>
          <div className="w-[44px]"/>
        </div>
        <div className="flex-1 overflow-auto px-4 py-4 space-y-6 pb-[120px]">
          {tripGrouped.length===0 && tripDone.length===0 && <div className="py-16 text-center text-[13px] text-[var(--muted)]">Nothing to buy — add from pantry first.</div>}
          {tripGrouped.map(g=> (
            <div key={g.cat as any} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)]">{g.cat}</span>
                <span className="h-[1px] flex-1 bg-[var(--border)]"/>
                <span className="text-[11px] text-[#9A8A7D]">{g.items.length}</span>
              </div>
              <div className="space-y-2">
                {g.items.map(it=> (
                  <button key={it.id} onClick={()=> togglePurchased(it)} className="w-full flex items-center gap-3 px-3 min-h-[64px] rounded-[16px] border bg-[var(--card-bg)] text-left active:scale-[0.97] transition-transform" style={{borderColor:'var(--border)', minHeight:64}}>
                    <span className="grid h-[28px] w-[28px] place-items-center rounded-full border bg-[var(--card-bg)] shrink-0" style={{borderColor:'var(--border)'}}><span className="h-[8px] w-[8px] rounded-full border border-[#8B7357]"/></span>
                    <span className="text-[15px] font-medium text-[var(--text)]">{it.item}<span className="ml-2 text-[13px] text-[var(--muted)]">{it.qty>1? `×${it.qty}`:''}</span></span>
                    <span className="ml-auto grid h-6 w-6 place-items-center rounded-full bg-[var(--chip-bg)]"><IconCat cat={it.cat as any} size={10}/></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {tripDone.length>0 && (
            <div className="pt-4 border-t border-dashed" style={{borderColor:'var(--border)'}}>
              <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)] mb-2">Picked • {tripDone.length}</div>
              {tripDone.slice(0,20).map(it=> (
                <div key={it.id} className="flex items-center gap-3 px-3 min-h-[48px] rounded-[12px] bg-[var(--chip-bg)]/70 mb-1">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0A0A0A] text-white"><IconCheckTiny size={11}/></span>
                  <span className="text-[13px] line-through text-[var(--muted)] flex-1 truncate">{it.item}</span>
                  <button onClick={()=> togglePurchased(it as any)} className="text-[11px] underline text-[var(--text-secondary)] min-h-[44px] px-2">Undo</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sticky bottom-0 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 bg-[var(--card-bg)] border-t" style={{borderColor:'var(--border)'}}>
          <button onClick={()=> { try{ onCelebrate?.({confetti:true, count:36}); }catch{} setTripMode(false); }} className="w-full h-[56px] rounded-[16px] bg-[#0A0A0A] text-white text-[15px] font-semibold active:scale-[0.97] transition-transform shadow-[0_10px_24px_rgba(0,0,0,0.2)]" style={{transitionTimingFunction:'cubic-bezier(0.34,1.56,0.64,1)'}}>
            Finish trip • {left} left
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return (
    <div className="space-y-5">
      {/* calm header */}
      <div className="px-1 pt-1">
        <h2 className="font-display text-[28px] font-semibold tracking-tight text-[var(--text)] leading-[1.05]">Pantry</h2>
        <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{countTodo===0 ? "All stocked" : `${countTodo} to buy`}</div>
      </div>

      {/* unified control bar - 3 controls same height radius border */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="5"/><path d="M20 20l-3.5-3.5"/></svg></span>
          <input value={query} onChange={e=> setQuery(e.target.value)} placeholder="Search pantry…" className="w-full h-[44px] rounded-[12px] border bg-[var(--card-bg)] pl-9 pr-3 text-[13px] placeholder:text-[#9A8A7D] outline-none focus:border-[#CFC2B6]" style={{borderColor:'var(--border)'}} />
          {query && <button onClick={()=> setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full bg-[var(--chip-bg)] text-[10px]">✕</button>}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 sm:w-[160px]">
            <select value={catFilter as any} onChange={e=> setCatFilter(e.target.value as any)} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none outline-none focus:border-[#CFC2B6]" style={{borderColor:"var(--border)"}}>
              <option value="All">All categories</option>
              {CATS.map(c=> <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/></svg></span>
          </div>
          <div className="relative flex-1 sm:w-[140px]">
            <select value={segment} onChange={e=> setSegment(e.target.value as any)} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none outline-none focus:border-[#CFC2B6]" style={{borderColor:"var(--border)"}}>
              <option value="household">Household</option>
              <option value="aisling">Aisling</option>
              <option value="ciaran">Ciaran</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/></svg></span>
          </div>
        </div>
      </div>

      <button onClick={()=> setAddOpen(true)} className="w-full flex items-center justify-between rounded-[16px] border border-dashed bg-[var(--card-bg)] px-4 h-[48px] text-left active:scale-[0.98] transition-transform hover:border-[#CFC2B6]" style={{borderColor:"var(--border)"}}>
        <span className="text-[13px] text-[var(--text-secondary)] flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#0A0A0A] text-white"><svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="1.6"><path d="M6 1v10M1 6h10"/></svg></span>Add something you need…</span>
        <span className="text-[11px] text-[var(--muted)]">Tap to add</span>
      </button>

      <div className="space-y-6">
        {todo.length===0 ? (
          <div className="rounded-[20px] border bg-[var(--card-bg)] px-6 py-12 text-center" style={{borderColor:"var(--border)"}}>
            <div className="mx-auto grid h-[64px] w-[64px] place-items-center rounded-full bg-[var(--chip-bg)] border" style={{borderColor:"var(--border)"}}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.2"><path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
            </div>
            <div className="mt-3 font-display text-[15px] font-medium text-[var(--text)]">All stocked</div>
            <div className="mt-1 text-[12px] text-[var(--muted)]">Running low? Quick-add below.</div>
            {suggested.length>0 && (
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {suggested.map(it=> (
                  <button key={it.id} onClick={()=> { 
                    const nowISO=new Date().toISOString();
                    const ex=activeItems.find((x:any)=> x.item===it.item && !(x as any).purchased);
                    if(ex){ setItems((p:any)=> p.map((x:any)=> x.id===ex.id? {...x, qty: (x.qty||1)+1, updatedAt:nowISO, updatedBy: currentUser}:x)); }
                    else { setItems((p:any)=> [{id: uid("shop"), item: it.item, qty:1, cat: it.cat, purchased:false, addedBy: currentUser, createdAt:nowISO, repeatCount:0, frequency:"as-needed" as any, updatedAt:nowISO, updatedBy: currentUser } as any, ...p]); }
                  }} className="h-[44px] rounded-full border bg-[var(--card-bg)] px-3.5 text-[12px] active:scale-[0.96]" style={{borderColor:'var(--border)'}}>+ {it.item}</button>
                ))}
              </div>
            )}
            <button onClick={()=> setTripMode(true)} className="mt-5 h-[44px] rounded-full bg-[#0A0A0A] px-5 text-[12px] font-semibold text-white">Start trip</button>
          </div>
        ) : grouped.map(g=> (
          <div key={g.cat as any} className="space-y-2">
            <div className="flex items-center gap-2 px-1 h-[24px] border-b" style={{borderColor:'var(--border)'}}>
              <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[var(--muted)]">{g.cat}</span>
              <span className="text-[11px] text-[#9A8A7D]">{g.items.length}</span>
              <span className="flex-1 h-[1px] bg-[var(--border)] ml-2"/>
            </div>
            <div className="grid gap-2">
              {g.items.map(it=> (
                <div key={it.id} className="group flex items-center gap-0 rounded-[16px] border bg-[var(--card-bg)] px-1 py-1 min-h-[56px] hover:border-[#CFC2B6] transition-colors" style={{borderColor:'var(--border)'}}>
                  <button onClick={()=> togglePurchased(it)} className="grid h-[44px] w-[44px] place-items-center shrink-0 active:scale-[0.92]" aria-label="toggle">
                    <span className="grid h-[24px] w-[24px] place-items-center rounded-full border bg-[var(--card-bg)]" style={{borderColor:'#CFC2B6'}}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="transparent"><path d="M5 12.5l4 4L19 7" strokeWidth="2"/></svg>
                    </span>
                  </button>
                  <button onClick={()=> { setEditing(it as any); setEditQty(it.qty); setEditCat(it.cat); setEditFreq(it.frequency||"as-needed" as any); setEditNeedDays(parseNeedDaysToBool((it as any).needDays)); setEditNotes((it as any).notes||""); setConfirmDelId(null); }} className="flex-1 text-left min-w-0 flex items-center gap-2 pr-2">
                    <span className="text-[15px] font-[500] text-[var(--text)] truncate">{it.item}</span>
                    {it.qty>1 && <span className="text-[13px] text-[var(--muted)]">×{it.qty}</span>}
                  </button>
                  <span className="h-[6px] w-[6px] rounded-full bg-[var(--border)] mr-2"/>
                  <button onClick={()=> { setEditing(it as any); setEditQty(it.qty); setEditCat(it.cat); setEditFreq(it.frequency||"as-needed" as any); setEditNeedDays(parseNeedDaysToBool((it as any).needDays)); setEditNotes((it as any).notes||""); }} className="grid h-[44px] w-[44px] place-items-center text-[#9A8A7D]"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M9 18l6-6"/><path d="M14 8l2-2"/><circle cx="11" cy="11" r="2"/></svg></button>
                </div>
              ))}
            </div>
          </div>
        ))}
        {bought.length>0 && (
          <div className="pt-2">
            <button onClick={()=> setShowBought(v=>!v)} className="w-full flex items-center gap-2 px-1 h-[44px] text-left">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Bought</span>
              <span className="text-[11px] text-[#9A8A7D]">{bought.length}</span>
              <span className="flex-1 h-[1px] bg-[var(--border)] ml-2"/>
              <span className="text-[11px] text-[var(--text-secondary)]">{showBought? "Hide":"Show"}</span>
            </button>
            {showBought && (
              <div className="grid gap-1.5 mt-2">
                {bought.slice(0,12).map(it=> (
                  <div key={it.id} className="flex items-center gap-3 rounded-[12px] border border-dashed bg-[var(--chip-bg)]/60 px-3 py-2 min-h-[40px] opacity-[0.65]" style={{borderColor:'var(--border)'}}>
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0A0A0A] text-white"><IconCheckTiny size={10}/></span>
                    <span className="text-[13px] line-through decoration-[1px] text-[var(--muted)] truncate flex-1">{it.item}</span>
                    <button onClick={()=> togglePurchased(it)} className="text-[11px] underline text-[var(--text-secondary)] min-h-[44px] px-2">Undo</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pt-2 pb-6 flex justify-center">
        <button onClick={()=> setTripMode(true)} disabled={countTodo===0} className="h-[44px] rounded-full border bg-[var(--card-bg)] px-5 text-[12px] font-medium disabled:opacity-40 active:scale-[0.97]" style={{borderColor:'var(--border)'}}>Trip • {countTodo>0? `${countTodo} items`:"All done"}</button>
      </div>

      {/* Add sheet - progressive */}
      <BottomSheet open={addOpen} onClose={()=> setAddOpen(false)} title="Add to pantry">
        <div className="space-y-4">
          <input value={addText} onChange={e=> setAddText(e.target.value)} placeholder="Milk, bread, eggs…" className="w-full h-[48px] rounded-[12px] border bg-[var(--card-bg)] px-4 text-[14px] outline-none focus:border-[#CFC2B6]" style={{borderColor:"var(--border)"}} autoFocus />
          <div className="grid grid-cols-3 gap-2">
            <select value={addCat} onChange={e=> setAddCat(e.target.value as any)} className="h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-2 text-[12px]" style={{borderColor:"var(--border)"}}>{CATS.map(c=> <option key={c} value={c}>{c}</option>)}</select>
            <div className="flex items-center rounded-[12px] border bg-[var(--card-bg)] px-2" style={{borderColor:'var(--border)'}}>
              <button onClick={()=> setAddQty(q=> Math.max(1,q-1))} className="h-[36px] w-[36px] rounded-full border bg-[var(--card-bg)] flex items-center justify-center">−</button>
              <span className="w-8 text-center text-[13px] font-medium">{addQty}</span>
              <button onClick={()=> setAddQty(q=> q+1)} className="h-[36px] w-[36px] rounded-full border bg-[var(--card-bg)] flex items-center justify-center">+</button>
            </div>
            <button onClick={()=> setShowAdvanced(v=>!v)} className="h-[44px] rounded-[12px] border bg-[var(--card-bg)] text-[11px]">{showAdvanced? "Hide":"Advanced"}</button>
          </div>
          {showAdvanced && (
            <div className="space-y-2 rounded-[12px] border bg-[var(--card-bg)] p-3" style={{borderColor:'var(--border)'}}>
              <select value={addFreq} onChange={e=> setAddFreq(e.target.value as any)} className="w-full h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 text-[12px]" style={{borderColor:"var(--border)"}}><option value="as-needed">As needed</option><option value="daily">Daily</option><option value="every-2d">Every 2d</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select>
              {(addFreq==="weekly" || addFreq==="biweekly") && (
                <div className="grid grid-cols-7 gap-1">
                  {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d,i)=> (
                    <button key={d} onClick={()=> { const nxt=[...addNeedDays]; nxt[i]=!nxt[i]; setAddNeedDays(nxt); }} className={"h-[44px] rounded-full border text-[11px] grid place-items-center "+(addNeedDays[i]?"bg-[#0A0A0A] text-white border-[#0A0A0A]":"bg-[var(--card-bg)] border-[var(--border)]")}>{d}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={addItem} disabled={!addText.trim()} className="w-full h-[52px] rounded-[16px] bg-[#0A0A0A] text-white text-[14px] font-semibold disabled:opacity-40 active:scale-[0.98]">Add to pantry</button>
        </div>
      </BottomSheet>

      {/* Edit sheet - proper form */}
      <BottomSheet open={!!editing} onClose={()=> { setEditing(null); setConfirmDelId(null); }} title={editing?.item}>
        {editing && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-[12px] border bg-[var(--card-bg)] px-3 py-2" style={{borderColor:'var(--border)'}}>
              <button onClick={()=> setEditQty(q=> Math.max(1,q-1))} className="grid h-[44px] w-[44px] place-items-center rounded-full border bg-[var(--card-bg)]"><svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><path d="M5 12h14"/></svg></button>
              <span className="w-10 text-center text-[15px] font-medium">{editQty}</span>
              <button onClick={()=> setEditQty(q=> q+1)} className="grid h-[44px] w-[44px] place-items-center rounded-full border bg-[var(--card-bg)]"><svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.6"><path d="M12 5v14M5 12h14"/></svg></button>
              <span className="ml-auto text-[11px] text-[var(--muted)]">Quantity</span>
            </div>
            <select value={editCat} onChange={e=> setEditCat(e.target.value as any)} className="w-full h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 text-[12px]" style={{borderColor:'var(--border)'}}>{CATS.map(c=> <option key={c}>{c}</option>)}</select>

            <button onClick={()=> setShowAdvanced(v=>!v)} className="text-[11px] underline text-[var(--muted)]">{showAdvanced? "Hide advanced":"Advanced • frequency"}</button>
            {showAdvanced && (
              <div className="space-y-2">
                <select value={editFreq} onChange={e=> setEditFreq(e.target.value as any)} className="w-full h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 text-[12px]" style={{borderColor:'var(--border)'}}><option value="as-needed">As needed</option><option value="daily">Daily</option><option value="every-2d">Every 2d</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option></select>
                {(editFreq==="weekly" || editFreq==="biweekly") && (
                  <div className="grid grid-cols-7 gap-1">
                    {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d,i)=> (
                      <button key={d} onClick={()=> { const nxt=[...editNeedDays]; nxt[i]=!nxt[i]; setEditNeedDays(nxt); }} className={"h-[44px] rounded-full border text-[11px] grid place-items-center "+(editNeedDays[i]?"bg-[#0A0A0A] text-white border-[#0A0A0A]":"bg-[var(--card-bg)] border-[var(--border)]")}>{d}</button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <textarea value={editNotes} onChange={e=> setEditNotes(e.target.value)} placeholder="Notes — brand, aisle…" className="w-full rounded-[12px] border bg-[var(--card-bg)] px-3 py-3 text-[12px] min-h-[80px] outline-none focus:border-[#CFC2B6]" style={{borderColor:'var(--border)'}} />

            <div className="flex gap-2">
              <button onClick={saveEdit} className="flex-1 h-[44px] rounded-[16px] bg-[#0A0A0A] text-white text-[13px] font-medium active:scale-[0.98]">Save</button>
              <button onClick={()=> handleArchive(editing.id)} className="h-[44px] rounded-[16px] border bg-[var(--card-bg)] px-4 text-[12px] text-[var(--text-secondary)]">Archive</button>
            </div>

            <div className="pt-2 border-t flex justify-between" style={{borderColor:'var(--border)'}}>
              {confirmDelId===editing.id ? (
                <div className="flex gap-2 w-full">
                  <span className="text-[11px] text-[#991B1B] flex-1 pt-2">Really delete?</span>
                  <button onClick={()=> setConfirmDelId(null)} className="h-[44px] rounded-full border px-4 text-[11px]">Cancel</button>
                  <button onClick={()=> handleDelete(editing.id)} className="h-[44px] rounded-full bg-[#B91C1C] text-white px-4 text-[11px]">Delete</button>
                </div>
              ) : (
                <button onClick={()=> setConfirmDelId(editing.id)} className="text-[11px] text-[#B91C1C] underline">Delete item</button>
              )}
            </div>

          </div>
        )}
      </BottomSheet>
    </div>
  );
}


function PersonalAdd({ onAdd, placeholder }: { onAdd:(v:string)=>void; placeholder?:string }){
  const [v,setV]=useState("");
  return (
    <div className="mt-1.5 flex gap-1.5">
      <input value={v} onChange={e=> setV(e.target.value)} placeholder={placeholder} className="flex-1 rounded-full border bg-[var(--card-bg)] px-2.5 py-1 text-[11px] outline-none" style={{ borderColor:"var(--border)" }} onKeyDown={e=>{ if(e.key==="Enter"){ onAdd(v); setV(""); }}} />
      <button onClick={()=>{ onAdd(v); setV(""); }} className="rounded-full bg-[#0A0A0A] px-3 py-1 text-[11px] text-white">+</button>
    </div>
  );
}

function NotesMemoPage({
  notes, setNotes, currentUser, nowMs,
}: {
  notes: NoteMemo[]; setNotes: any; currentUser: PersonKey; nowMs: number;
}) {
  const [filter, setFilter] = useState<"all"|"unread"|"pinned"|"love"|"archive">("all");
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addBody, setAddBody] = useState("");
  const [addIsLove, setAddIsLove] = useState(false);
  const [addPhotoDataUrl, setAddPhotoDataUrl] = useState<string|undefined>(undefined);
  const [addThumbDataUrl, setAddThumbDataUrl] = useState<string|undefined>(undefined);
  const [isResizing, setIsResizing] = useState(false);
  const [selected, setSelected] = useState<NoteMemo|null>(null);

  const activeNotes = useMemo(()=> notes.filter((n:any)=> !(n as any).deletedAt && !(n as any).archived_at && !(n as any).archivedAt), [notes]);
  const partner: PersonKey = currentUser==="aisling"?"ciaran":"aisling";

  const filtered = useMemo(()=>{
    let list = activeNotes;
    if(filter==="unread") list = list.filter(n=> n.author===partner && !((n.seenBy as any)?.[currentUser]));
    else if(filter==="pinned") list = list.filter(n=> (n as any).pinned_at || (n as any).pinnedAt);
    else if(filter==="love") list = list.filter(n=> n.isLove);
    else if(filter==="archive") {
      const arch = notes.filter((n:any)=> (n as any).archivedAt || (n as any).archived_at);
      list = arch as any;
    }
    if(query.trim()){
      const q=query.toLowerCase();
      list = list.filter(n=> n.body.toLowerCase().includes(q));
    }
    return list.sort((a,b)=> new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  }, [activeNotes, filter, query, notes, partner, currentUser]);

  const featured = filtered[0] || null;
  const pinned = useMemo(()=> filtered.filter(n=> (n as any).pinned_at || (n as any).pinnedAt).slice(0,4), [filtered]);
  const older = useMemo(()=> filtered.slice(featured ? 1 : 0).slice(0,12), [filtered, featured]);

  async function handlePhotoFile(file: File) {
    try {
      setIsResizing(true);
      const reader = new FileReader();
      const base64: string = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      // V37 resize to max 900 jpeg 0.82 then 180 thumb 0.8 — sharper but still <200k
      const full = await resizeToDataUrl(base64, 900, "image/jpeg", 0.82);
      const thumb = await createThumbnail(full, 180, "image/jpeg", 0.8);
      setAddPhotoDataUrl(full);
      setAddThumbDataUrl(thumb);
    } catch {
      // fallback original
    } finally { setIsResizing(false); }
  }

  async function addNote(){
    if(!addBody.trim()) return;
    // ensure any large photo is compressed to 900 + thumb 180 before persist
    let finalFull = addPhotoDataUrl;
    let finalThumb = addThumbDataUrl;
    if (finalFull && finalFull.length > 8000) {
      try {
        // re-compress to target sizes if oversized or old 600
        if (finalFull.length < 40000 && finalThumb) {
          // already 900px range, keep
        } else {
          finalFull = await resizeToDataUrl(finalFull, 900, "image/jpeg", 0.82);
          finalThumb = await createThumbnail(finalFull, 180, "image/jpeg", 0.8);
        }
      } catch {}
    }
    const n: NoteMemo = {
      id: uid("note"),
      body: addBody.trim(),
      author: currentUser,
      createdAt: new Date().toISOString(),
      seenBy: { aisling: currentUser==="aisling", ciaran: currentUser==="ciaran" } as any,
      isLove: addIsLove,
      photoDataUrl: finalFull,
      photoThumbDataUrl: finalThumb,
      rotation: rotForId(uid("r")),
      updatedAt: new Date().toISOString(),
    } as any;
    setNotes((p:any)=> [n, ...p]);
    setAddBody(""); setAddIsLove(false); setAddPhotoDataUrl(undefined); setAddThumbDataUrl(undefined); setShowAdd(false);
  }

  return (
    <div className="w-full space-y-4">
      <div className="rounded-[24px] border px-5 pt-5 pb-4 relative overflow-hidden" style={{ background:'linear-gradient(180deg,var(--wash-top) 0%,var(--wash-mid) 18%,var(--wash-top) 28%,var(--card-bg) 100%)', borderColor:'var(--border)', boxShadow:'0 12px 32px rgba(0,0,0,0.10), 0 4px 12px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center justify-between h-[44px]">
          <h2 className="font-display text-[26px] font-semibold tracking-tight text-[var(--text)]">Notes</h2>
          <button onClick={()=> setShowAdd(true)} className="grid h-11 w-11 place-items-center rounded-full bg-[#0A0A0A] text-white text-[16px] shadow-[0_6px_18px_rgba(0,0,0,0.18)]" style={{minHeight:44, minWidth:44}}>＋</button>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={query} onChange={e=> setQuery(e.target.value)} placeholder="Search notes…" className="flex-1 h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-4 text-[12px] shadow-sm" style={{borderColor:'var(--border)'}} />
          <div className="relative">
            <select value={filter} onChange={e=> setFilter(e.target.value as any)} className="h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="pinned">Pinned</option>
              <option value="love">Love</option>
              <option value="archive">Archive</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
          </div>
        </div>
      </div>

      {/* FROM ... Large featured - polaroid obvious */}
      {featured && (
        <button onClick={()=> setSelected(featured)} className="relative w-full text-left rounded-[20px] border bg-[var(--card-bg)] px-5 py-5 shadow-[0_12px_32px_rgba(41,26,12,0.12)]" style={{borderColor: featured.isLove ? "#F9A8D4" : "var(--border)"}}>
          <span className="absolute right-4 top-3 h-2 w-6 rounded-full bg-[var(--chip-bg)] border shadow-sm" style={{borderColor:'var(--border)'}} aria-hidden="true" />
          <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[var(--muted)] flex items-center gap-1.5">FROM {(PERSONS[featured.author as any]?.name||featured.author||"?").toUpperCase()} <svg viewBox="0 0 16 16" className={"h-[12px] w-[12px] "+(featured.isLove ? "fill-[#E07A5F]" : "fill-white stroke-[var(--border)]")}><path d="M8 13.1 4.2 9.6A3.6 3.6 0 0 1 3 7c0-1.7 1.25-2.9 2.9-2.9 1 0 1.65.45 2.1 1.2.45-.75 1.1-1.2 2.1-1.2C11.75 4.1 13 5.3 13 7c0 .9-.4 1.9-1.2 2.9L8 13.1Z"/></svg></div>
          <div className="mt-3 font-display text-[17px] leading-[24px] line-clamp-6 text-[var(--text)]">{featured.body}</div>
          {featured.photoDataUrl && <span className="mt-4 inline-block rounded-[10px] border bg-[var(--card-bg)] p-2 shadow-sm"><img src={featured.photoDataUrl} alt="" className="w-[160px] h-[120px] rounded-[6px] object-cover" loading="lazy" /></span>}
          <div className="mt-3 text-[11px] text-[var(--muted)]">{relTime(featured.createdAt, nowMs)} • {featured.isLove ? "Love" : "Note"}</div>
        </button>
      )}

      {/* PINNED medium grid */}
      {pinned.length>0 && (
        <div className="space-y-2">
          <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Pinned</div>
          <div className="grid grid-cols-2 gap-2">
            {pinned.slice(0,4).map(n=> (
              <button key={n.id} onClick={()=> setSelected(n)} className="rounded-[16px] border bg-[var(--card-bg)] px-3 py-3 text-left min-h-[84px]" style={{borderColor:"var(--border)"}}>
                <div className="text-[13px] line-clamp-3">{n.body}</div>
                <div className="mt-2 text-[11px] text-[var(--muted)]">{relTime(n.createdAt, nowMs)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* OLDER compact rows */}
      <div className="space-y-1">
        <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Older</div>
        {older.length===0 ? (
          <div className="rounded-[16px] border border-dashed bg-[var(--card-bg)] px-4 py-6 text-center text-[12px] text-[var(--muted)]">No notes</div>
        ) : older.map(n=> (
          <button key={n.id} onClick={()=> setSelected(n)} className="w-full text-left flex items-center gap-3 rounded-[16px] border bg-[var(--card-bg)] px-3 py-3 min-h-[52px]" style={{borderColor:"var(--border)"}}>
            <span className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold text-white shrink-0" style={{background: (PERSONS[n.author as any]?.accent2||"#A89FDA")}}>{(PERSONS[n.author as any]?.initial||"?")}</span>
            <span className="flex-1 min-w-0"><span className="block text-[13px] truncate">{n.body}</span><span className="block text-[11px] text-[var(--muted)]">{relTime(n.createdAt, nowMs)} • {n.isLove?"Love":""}</span></span>
          </button>
        ))}
      </div>

      <BottomSheet open={showFilter} onClose={()=> setShowFilter(false)} title="Filter">
        <div className="space-y-3 py-2">
          <div className="relative">
            <select value={filter} onChange={e=> { setFilter(e.target.value as any); setShowFilter(false); }} className="w-full h-[44px] min-h-[44px] rounded-[12px] border bg-[var(--card-bg)] px-3 pr-8 text-[12px] font-medium appearance-none bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="pinned">Pinned</option>
              <option value="love">Love</option>
              <option value="archive">Archive</option>
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg></span>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={showAdd} onClose={()=> setShowAdd(false)} title="Add note">
        <div className="space-y-3">
          <textarea value={addBody} onChange={e=> setAddBody(e.target.value)} placeholder="Write a note for your person…" className="w-full rounded-[12px] border bg-[var(--card-bg)] px-3 py-3 text-[14px] min-h-[96px]" style={{borderColor:"var(--border)"}} />
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={addIsLove} onChange={e=> setAddIsLove(e.target.checked)} /> Love note <svg width="12" height="12" viewBox="0 0 16 16" fill="#E07A5F"><path d="M8 13.1 4.2 9.6A3.6 3.6 0 0 1 3 7c0-1.7 1.25-2.9 2.9-2.9 1 0 1.65.45 2.1 1.2.45-.75 1.1-1.2 2.1-1.2C11.75 4.1 13 5.3 13 7c0 .9-.4 1.9-1.2 2.9L8 13.1Z"/></svg></label>
          {/* Obvious photo upload */}
          <div className="w-full">
            <input id="note-photo-input" type="file" accept="image/*" onChange={e=>{ const f=e.target.files?.[0]; if(f) handlePhotoFile(f); }} className="sr-only" />
            <label htmlFor="note-photo-input" className="flex h-[64px] w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] border-2 border-dashed bg-[var(--card-bg)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--chip-bg)] active:scale-[0.99]" style={{borderColor:"var(--border)"}}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] border" style={{borderColor:"var(--border)"}}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 6l1-2h4l1 2"/></svg></span>
              {isResizing ? "Resizing…" : addPhotoDataUrl ? "Change photo" : "Tap to add photo"}
            </label>
            {isResizing && <span className="mt-1 block text-[11px] text-[var(--muted)]">Compressing to 900px…</span>}
          </div>
          {addPhotoDataUrl && (
            <div className="flex gap-3 items-start rounded-[12px] border bg-[var(--card-bg)] p-2" style={{borderColor:"var(--border)"}}>
              <img src={addThumbDataUrl || addPhotoDataUrl} alt="preview" className="h-[96px] w-[96px] rounded-[10px] object-cover border shadow-sm" style={{borderColor:"var(--border)"}} />
              <div className="text-[11px] text-[var(--text-secondary)] leading-[1.4]">Sharper 900px • 180px thumb JPEG 0.82<br/><span className="text-[11px] text-[var(--muted)]">Looks crisp on phone</span><br/><button onClick={()=>{ setAddPhotoDataUrl(undefined); setAddThumbDataUrl(undefined); }} className="mt-1 text-[11px] underline text-[#B91C1C]">Remove</button></div>
            </div>
          )}
          <button onClick={addNote} disabled={!addBody.trim() || isResizing} className="w-full h-[52px] rounded-[16px] bg-[#0A0A0A] text-white text-[15px] font-semibold disabled:opacity-40">Add</button>
        </div>
      </BottomSheet>

      <BottomSheet open={!!selected} onClose={()=> setSelected(null)} title={selected ? (PERSONS[selected.author as any]?.name||selected.author||"?") : undefined}>
        {selected && (
          <div className="space-y-3">
            <div className="text-[15px] leading-[21px]">{selected.body}</div>
            {selected.photoDataUrl && <img src={selected.photoDataUrl} alt="" className="w-full rounded-[12px] border" style={{borderColor:"var(--border)"}} />}
            <div className="text-[11px] text-[var(--muted)]">{relTime(selected.createdAt, nowMs)}</div>
            <div className="flex gap-2">
              <button onClick={()=> { (() => { const nowISO=new Date().toISOString(); return setNotes((p:any)=> p.map((x:any)=> x.id===selected.id ? {...x, pinned_at: (x as any).pinned_at ? null : nowISO, pinnedAt: (x as any).pinned_at ? null : nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)) })(); setSelected(null); }} className="flex-1 h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[12px]">Pin</button>
              <button onClick={()=> { (() => { const nowISO=new Date().toISOString(); return setNotes((p:any)=> p.map((x:any)=> x.id===selected.id ? {...x, archived_at: nowISO, archivedAt: nowISO, updatedAt: nowISO, updatedBy: currentUser } : x)) })(); setSelected(null); }} className="flex-1 h-[44px] rounded-[16px] border bg-[var(--card-bg)] text-[12px] text-[#B91C1C]">Archive</button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}


function DebugCenter({
  choresRaw, calendarRaw, shoppingRaw, notesRaw,
  setChoresRaw, setCalendarRaw, setShoppingRaw, setNotesRaw,
}: {
  choresRaw?: any[]; calendarRaw?: any[]; shoppingRaw?: any[]; notesRaw?: any[];
  setChoresRaw?: (v: any) => void; setCalendarRaw?: (v: any) => void; setShoppingRaw?: (v: any) => void; setNotesRaw?: (v: any) => void;
}) {
  // Only shown when useIsDebug() === true. Early guard in parent, but also here.
  const isDebug = useIsDebug();
  if (!isDebug) return null;
  const [supabaseUrl, setSupabaseUrl] = useLocalState<string>("couple_v1_supabase_url", "");
  const [supabaseAnon, setSupabaseAnon] = useLocalState<string>("couple_v1_supabase_anon", "");
  const [sbTestMsg, setSbTestMsg] = useState<string | null>(null);
  const [sbTesting, setSbTesting] = useState(false);
  const [sbLive, setSbLive] = useState<{c:number, cal:number, s:number, n:number, upd:string} | null>(null);
  const [rawView, setRawView] = useState<any>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | {title:string; msg?:string; onConfirm:()=>void}>(null);
  useEffect(() => { if (!sbTestMsg) return; const t = setTimeout(() => setSbTestMsg(null), 5000); return () => clearTimeout(t); }, [sbTestMsg]);

  async function doTest() {
    setSbTesting(true); setSbTestMsg(null);
    try {
      const { remoteLoad } = await import('./lib/remoteSync');
      const remote = await remoteLoad();
      if (remote) {
        const total = (remote.chores?.length||0)+(remote.calendar?.length||0)+(remote.shopping?.length||0)+(remote.notes?.length||0);
        setSbLive({ c: remote.chores.length, cal: remote.calendar.length, s: remote.shopping.length, n: remote.notes.length, upd: (remote.updated_at||'').slice(0,19)});
        setRawView(remote);
        setSbTestMsg(`OK remote c:${remote.chores.length} cal:${remote.calendar.length} s:${remote.shopping.length} n:${remote.notes.length} total:${total} upd:${(remote.updated_at||'').slice(0,19)}`);
      } else {
        setSbTestMsg('no row / no config - will init on first save');
        setSbLive(null);
      }
    } catch(e:any){ setSbTestMsg('ex: '+String(e?.message||e).slice(0,160)) }
    setSbTesting(false);
  }

  useEffect(()=>{ doTest() }, []);

  function envSrc() {
    try {
      const w:any = window as any;
      const hasWin = !!(w.__SUPABASE_URL__ && w.__SUPABASE_ANON__);
      // @ts-ignore
      const hasVite = !!(import.meta as any).env?.VITE_SUPABASE_URL;
      return hasWin? 'window ok baked' : hasVite? 'VITE ok' : 'LS / none';
    } catch { return 'LS only' }
  }

  function copyDebug() {
    const info = {
      id: ROW_ID,
      table: TABLE,
      token: SB_TOKEN,
      envSrc: envSrc(),
      live: sbLive,
      localCounts: { c: choresRaw?.length||0, cal: calendarRaw?.length||0, s: shoppingRaw?.length||0, n: notesRaw?.length||0 },
      lastSync: (()=>{ try{ return localStorage.getItem('couple_v1_last_sync')}catch{return null}})(),
      lastErr: (()=>{ try{ return localStorage.getItem('couple_v1_last_push_err')}catch{return null}})(),
      hadRemote: (()=>{ try{ return localStorage.getItem('couple_v1_had_remote')}catch{return null}})(),
      raw: rawView || undefined
    };
    try { navigator.clipboard.writeText(JSON.stringify(info,null,2)); setSbTestMsg('copied debug json ok') } catch { setSbTestMsg('copy failed') }
  }

  return (
    <div className="rounded-[20px] border bg-[var(--card-bg)] px-4 py-4" style={{ borderColor: "#FDBA74" }}>
      <div className="flex items-center justify-between">
        <div className="font-display text-[13px] font-semibold">Debug Center • only with ?debug=1</div>
        <span className={"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] "+(typeof hasSupabaseConfig==='function' && hasSupabaseConfig() ? "bg-[#E8F5E9] border-[#A3D9A5] text-[#166534]" : "bg-[#FEF3C7] border-[#FCD34D] text-[#92400E]")}>
          <span className={"h-1.5 w-1.5 rounded-full "+(typeof hasSupabaseConfig==='function' && hasSupabaseConfig() ? "bg-[#22C55E] animate-pulse" : "bg-[#F59E0B]")} />{typeof hasSupabaseConfig==='function' && hasSupabaseConfig() ? "live linked" : "local-only"}
        </span>
      </div>
      <div className="mt-2 text-[11px] text-[var(--muted)]">Row <code className="rounded bg-[var(--chip-bg)] px-1 py-0.5">{ROW_ID}</code> Table <code className="rounded bg-[var(--chip-bg)] px-1 py-0.5">{TABLE}</code> Token <code className="rounded bg-[var(--chip-bg)] px-1 py-0.5">{SB_TOKEN}</code> • {envSrc()}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div className="rounded-[12px] bg-[var(--card-bg)] px-2.5 py-2 border" style={{borderColor:"var(--border)"}}><div className="text-[11px] text-[var(--muted)]">remote</div><div className="font-medium">c:{sbLive?.c ?? '…'} cal:{sbLive?.cal ?? '…'} s:{sbLive?.s ?? '…'} n:{sbLive?.n ?? '…'}</div></div>
        <div className="rounded-[12px] bg-[var(--card-bg)] px-2.5 py-2 border" style={{borderColor:"var(--border)"}}><div className="text-[11px] text-[var(--muted)]">local</div><div className="font-medium">c:{choresRaw?.length||0} cal:{calendarRaw?.length||0} s:{shoppingRaw?.length||0} n:{notesRaw?.length||0}</div></div>
        <div className="rounded-[12px] bg-[var(--card-bg)] px-2.5 py-2 border" style={{borderColor:"var(--border)"}}><div className="text-[11px] text-[var(--muted)]">updated_at</div><div className="font-medium truncate">{sbLive?.upd || '—'}</div></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={doTest} className="rounded-full bg-[#0A0A0A] px-3.5 py-2 text-[11px] text-white disabled:opacity-60" disabled={sbTesting}>{sbTesting? 'Testing…' : 'Test Supabase'}</button>
        <button onClick={async()=>{
          try {
            const { remoteLoad } = await import('./lib/remoteSync');
            const r = await remoteLoad();
            if(!r){ setSbTestMsg('no remote to pull'); return }
            if(setChoresRaw) setChoresRaw(r.chores as any);
            if(setCalendarRaw) setCalendarRaw(r.calendar as any);
            if(setShoppingRaw) setShoppingRaw(r.shopping as any);
            if(setNotesRaw) setNotesRaw(r.notes as any);
            try { localStorage.setItem('couple_v1_had_remote','1'); } catch{}
            setSbTestMsg('Force pull OK ok');
            setSbLive({ c:r.chores.length, cal:r.calendar.length, s:r.shopping.length, n:r.notes.length, upd:(r.updated_at||'').slice(0,19)});
            setRawView(r);
          } catch(e:any){ setSbTestMsg('pull ex '+String(e?.message||e).slice(0,80)) }
        }} className="rounded-full bg-[#E8F5E9] border px-3.5 py-2 text-[11px] text-[#166534] border-[#A3D9A5]">Force pull</button>
        <button onClick={()=> setConfirmAction({title:'Nuke local cache?', msg:'Clears localStorage+IDB and reloads fresh from Supabase. DB is kept.', onConfirm: async()=>{ try{ Object.keys(localStorage).filter(k=>k.startsWith('couple_v1_') && !k.includes('supabase')).forEach(k=>{ try{ localStorage.removeItem(k)}catch{} }); try{ const {clearAllIDB}=await import('./lib/idb'); await clearAllIDB?.(); }catch{} try{ indexedDB.deleteDatabase('keyval-store'); }catch{} try{ indexedDB.deleteDatabase('couple-fridge'); }catch{} localStorage.setItem('couple_v1_had_remote','1'); location.reload(); }catch(e){ alert('nuke failed '+String((e as any)?.message||e).slice(0,80)) } finally{ setConfirmAction(null);} }})} className="rounded-full bg-[#FEF3C7] border px-3.5 py-2 text-[11px] text-[#92400E] border-[#FCD34D]">Nuke local & reload</button>
        <button onClick={copyDebug} className="rounded-full bg-[var(--card-bg)] border px-3.5 py-2 text-[11px]">Copy debug JSON</button>
        <button onClick={()=> setConfirmAction({title:'Delete ALL remote data?', msg:'Irreversible — will set remote to []', onConfirm: async()=>{ try{ const {remoteSave}=await import('./lib/remoteSync'); const ok=await remoteSave({ chores:[], calendar:[], shopping:[], notes:[], allowEmpty:true } as any); if(ok){ setSbTestMsg('Remote wiped ok'); setSbLive({c:0,cal:0,s:0,n:0,upd:new Date().toISOString().slice(0,19)}); if(setChoresRaw) setChoresRaw([]); if(setCalendarRaw) setCalendarRaw([]); if(setShoppingRaw) setShoppingRaw([]); if(setNotesRaw) setNotesRaw([]); } else setSbTestMsg('wipe failed'); }catch(e:any){ setSbTestMsg('wipe ex '+String(e?.message||e).slice(0,80)) } finally{ setConfirmAction(null);} }})} className="rounded-full bg-[#FFE4E6] border px-3 py-1.5 text-[11px] text-[#9F1239] border-[#FECDD3]">Delete all remote</button>
        <button onClick={()=> setShowRaw(v=>!v)} className="rounded-full bg-[var(--card-bg)] border px-3 py-1.5 text-[11px] border-[var(--border)]">{showRaw? 'Hide raw' : 'Show raw'}</button>
      </div>
      {sbTestMsg && <div className="mt-2 inline-flex max-w-full rounded-[10px] bg-[var(--card-bg)] px-3 py-1.5 text-[11px] border break-words" style={{borderColor:"var(--border)"}}>{sbTestMsg}</div>}
      {confirmAction && (
        <div className="fixed inset-0 z-[90] bg-black/30 backdrop-blur-[2px] grid place-items-center p-4">
          <div className="rounded-[16px] bg-[var(--card-bg)] border w-full max-w-[320px] p-4 shadow-xl" style={{borderColor:"var(--border)"}}>
            <div className="font-display text-[13px] font-medium">{confirmAction.title}</div>
            {confirmAction.msg && <div className="mt-1 text-[11px] text-[var(--muted)]">{confirmAction.msg}</div>}
            <div className="mt-3 flex gap-2 justify-end">
              <button onClick={()=> setConfirmAction(null)} className="rounded-full bg-[var(--chip-bg)] px-3 py-1.5 text-[11px] border" style={{borderColor:"var(--border)"}}>Cancel</button>
              <button onClick={()=> confirmAction.onConfirm()} className="rounded-full bg-[#0A0A0A] text-white px-3 py-1.5 text-[11px]">Confirm</button>
            </div>
          </div>
        </div>
      )}
      {showRaw && rawView && (
        <pre className="mt-3 max-h-[280px] overflow-auto rounded-[12px] bg-[#0A0A0A] p-3 text-[11px] text-white whitespace-pre-wrap">{JSON.stringify(rawView,null,2).slice(0,8000)}</pre>
      )}
      <div className="mt-4 rounded-[14px] border bg-[var(--card-bg)] px-3 py-3" style={{ borderColor: "var(--border)" }}>
        <div className="font-display text-[12px] font-semibold">DB health</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={async()=>{
            setSbTesting(true);
            try {
              const sb = (await import('./lib/supabase')).getSupabase();
              if(!sb){ setSbTestMsg('no sb'); setSbTesting(false); return; }
              const { data, error } = await sb.from('couple_data').select('id,updated_at').eq('id', ROW_ID).maybeSingle();
              if(error) setSbTestMsg('health err: '+error.message.slice(0,80));
              else if(!data) setSbTestMsg('health: no row');
              else setSbTestMsg('health OK '+ (data as any).id);
            } catch(e:any){ setSbTestMsg('health ex '+String(e?.message||e).slice(0,80)) }
            setSbTesting(false);
          }} className="rounded-full bg-[#0A0A0A] px-3 py-1.5 text-[11px] text-white">Check row age</button>
          <button onClick={async()=>{
            try {
              const sb = (await import('./lib/supabase')).getSupabase();
              if(!sb){ setSbTestMsg('no sb'); return;}
              const ch = sb.channel('health_'+Date.now()).subscribe((s:any)=>{ if(s==='SUBSCRIBED'){ setSbTestMsg('realtime OK ok'); try{ sb.removeChannel(ch)}catch{} } });
              setTimeout(()=>{ try{ sb.removeChannel(ch)}catch{} }, 4000);
            } catch(e:any){ setSbTestMsg('realtime ex '+String(e?.message||e).slice(0,80)) }
          }} className="rounded-full bg-[#EDE9FE] border px-3 py-1.5 text-[11px] border-[#C4B5FD]">Realtime ping</button>
        </div>
      </div>
      <div className="mt-3 rounded-[12px] bg-[var(--card-bg)] border px-3 py-2" style={{borderColor:"var(--border)"}}>
        <div className="text-[11px] font-medium">Manual Supabase override</div>
        <div className="mt-2 space-y-2">
          <input value={(() => { try { const raw = supabaseUrl as any; if (typeof raw === 'string' && raw.startsWith('http')) return raw; try { const p = JSON.parse(raw as any); if (typeof p === 'string') return p; } catch {} return (raw as any) || ''; } catch { return ''; } })()} onChange={e => { try { setSupabaseUrl(e.target.value); saveSupabaseConfig(e.target.value, (() => { try { const r = supabaseAnon as any; if (typeof r === 'string' && r.length > 20 && !r.startsWith('"')) return r; try { const p = JSON.parse(r as any); return typeof p === 'string' ? p : r; } catch { return r; } } catch { return supabaseAnon as any; } })()); } catch {} }} placeholder="https://xxxx.supabase.co" className="w-full rounded-full border bg-[var(--card-bg)] px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)" }} />
          <input value={(() => { try { const raw = supabaseAnon as any; if (typeof raw === 'string' && raw.length > 20 && !raw.startsWith('"')) { if (raw.startsWith('eyJ')) return raw; } try { const p = JSON.parse(raw as any); if (typeof p === 'string') return p; } catch {} return raw || ''; } catch { return ''; } })()} onChange={e => { try { setSupabaseAnon(e.target.value); const curUrl = (() => { try { const r = supabaseUrl as any; if (typeof r === 'string' && r.startsWith('http')) return r; try { const p = JSON.parse(r as any); if (typeof p === 'string') return p; } catch {} return r || ''; } catch { return ''; } })(); saveSupabaseConfig(curUrl, e.target.value); } catch {} }} placeholder="eyJ..." type="password" className="w-full rounded-full border bg-[var(--card-bg)] px-3 py-2 text-[11px]" style={{ borderColor: "var(--border)" }} />
          <div className="text-[11px] text-[var(--muted)]">Baked env preferred — LS override only for debugging.</div>
        </div>
      </div>
    </div>
  );
}

function PushToggle({ currentUser, compact }: { currentUser?: string; compact?: boolean }){
  const [state, setState] = useState(()=>{ try{ return (Notification as any)?.permission || 'default'; }catch{return 'default';} });
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(()=>{ try{ return localStorage.getItem('couple_v1_push_enabled')==='1'; }catch{return false;}});
  const [subCount, setSubCount] = useState<number>(0);
  const [lastTest, setLastTest] = useState<string>('');
  useEffect(()=>{ try{ if(!('PushManager' in window)) setSupported(false);}catch{ setSupported(false); }
    try{
      const pf = localStorage.getItem('couple_v1_push_sub_aisling');
      const pc = localStorage.getItem('couple_v1_push_sub_ciaran');
      let c=0; if(pf) c++; if(pc) c++; setSubCount(c);
    }catch{}
    // listen for permission changes
    try{
      const id=setInterval(()=>{ if(document.hidden) return; try{ const cur=Notification.permission; if(cur!==state) setState(cur as any);}catch{} }, 4000);
      return ()=>clearInterval(id);
    }catch{}
  },[]);
  async function toggle(){
    if(!supported) return;
    setLoading(true);
    try{
      const { subscribePush, unsubscribePush, getPermissionState } = await import('./lib/push');
      if(enabled){
        await unsubscribePush();
        setEnabled(false);
        setSubCount(0);
      }else{
        const userKey = (currentUser || (localStorage.getItem('couple_v1_push_user') as any) || 'ciaran') as any;
        const uk = (userKey === 'aisling' || userKey === 'ciaran') ? userKey : 'ciaran';
        const sub = await subscribePush(uk);
        if(sub) { setEnabled(true); setSubCount(1); }
      }
      try{ setState(getPermissionState() as any); }catch{ try{ setState(Notification.permission as any);}catch{}}
    }catch(e:any){
      console.warn('[pushToggle]', e?.message||e);
      try{ setState(Notification.permission as any); }catch{}
      // toast fallback
      try{ window.dispatchEvent(new CustomEvent('couple-push-fallback-toast',{detail:{title:'Push error', body: String(e?.message||e).slice(0,80)}})) }catch{}
    }finally{ setLoading(false); }
  }
  async function sendTest(){
    try{
      const { localNotify } = await import('./lib/push');
      const name = currentUser==='aisling'?'Aisling':'Ciarán';
      const ok = await localNotify(`Test buzz for ${name}`, `If you see this, open-app notify works • ${new Date().toLocaleTimeString()}`, './?standalone');
      setLastTest(ok? 'Sent • check notification shade' : 'Fallback toast — permission '+state);
      try{ if('vibrate' in navigator) (navigator as any).vibrate([80,40,80]) }catch{}
    }catch(e:any){ setLastTest('Error '+String(e?.message||e).slice(0,60)) }
  }
  if(!supported) return <span className="text-[11px] rounded-full border bg-[var(--chip-bg)] px-2.5 py-1" style={{borderColor:"var(--border)"}}>No support</span>;
  if(compact){
    if(state==='denied') return <span className="text-[11px] text-[#991B1B]">Blocked — enable in Settings</span>;
    return (
      <button onClick={toggle} disabled={loading} className="h-[32px] rounded-full border px-3 text-[11px] font-semibold disabled:opacity-60 active:scale-[0.96]" style={{borderColor:"var(--border)", background: enabled ? "#0A0A0A" : "var(--chip-bg)", color: enabled ? "white" : "inherit", minHeight:32, minWidth:56}}>
        {loading ? "…" : enabled ? "On • "+ (subCount||1) : "Off"}
      </button>
    );
  }
  // Full card mode used in Blueprint
  return (
    <div className="w-full rounded-[20px] border bg-[var(--card-bg)] px-4 py-3 space-y-3" style={{borderColor: enabled ? "#0A0A0A" : "var(--border)", boxShadow: enabled ? "0 6px 18px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.04)"}}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">Notifications</span>
            <span className={"inline-flex h-[18px] items-center rounded-full px-2 text-[10px] font-bold "+(enabled ? "bg-[#0A0A0A] text-white" : "bg-[var(--chip-bg)] text-[var(--text-secondary)] border")} style={{borderColor: enabled ? "#0A0A0A" : "var(--border)"}}>{enabled ? "ON" : "OFF"}</span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-secondary)] leading-[1.4]">Get buzzed when Ash claims/drops a chore • New chore for you • {currentUser==='aisling'?'Ciarán':'Aisling'} did it</div>
          <div className="mt-1 text-[10px] text-[var(--muted)]">Permission: {state} • Subscribed • {subCount|| (enabled?1:0)} • {typeof navigator!=='undefined' && 'standalone' in (navigator as any) ? "PWA" : "Browser"}</div>
        </div>
        <button onClick={toggle} disabled={loading} className="ml-3 h-[40px] min-w-[72px] rounded-full border px-4 text-[11px] font-bold disabled:opacity-60 active:scale-[0.96] shadow-sm" style={{borderColor: enabled ? "#0A0A0A" : "var(--border)", background: enabled ? "#0A0A0A" : "white", color: enabled ? "white" : "#2D2118", minHeight:44}}>
          {loading ? "…" : enabled ? "On" : "Off"}
        </button>
      </div>
      {state==='denied' && (
        <div className="rounded-[12px] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-[11px] text-[#991B1B]">
          Blocked — enable Notifications in iOS Settings → Nylah → Allow Notifications, then reinstall PWA. Open-app buzz will use in-app toast until allowed.
        </div>
      )}
      {state==='default' && !enabled && (
        <div className="rounded-[12px] bg-[#FEF3C7] border border-[#FDE68A] px-3 py-2 text-[11px] text-[#92400E]">
          Tap On → Allow → you'll get buzzed. iOS 16.4+ needs Add to Home Screen first.
        </div>
      )}
      <div className="flex items-center gap-2">
        <button onClick={sendTest} className="flex-1 h-[44px] rounded-[14px] bg-[#0A0A0A] text-white text-[12px] font-semibold active:scale-[0.97]" style={{minHeight:44}}>Send test push to me</button>
        <button onClick={()=>{ try{ localStorage.removeItem('couple_v1_push_enabled'); location.reload(); }catch{} }} className="h-[44px] rounded-[14px] border bg-[var(--card-bg)] px-3 text-[11px]" style={{borderColor:"var(--border)", minHeight:44}}>Reset</button>
      </div>
      {lastTest && <div className="text-[10px] text-[var(--text-secondary)]">{lastTest}</div>}
    </div>
  );
}

function BiometricToggle({ currentUser }: { currentUser: PersonKey }){
  const [supported, setSupported] = useState<boolean|null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const ok = await canDoPlatformBiometric();
        if (cancelled) return;
        setSupported(ok);
        const has = !!localStorage.getItem(webAuthnIdKey(currentUser));
        setEnrolled(has);
      }catch{ setSupported(false); }
    })();
    return ()=>{ cancelled=true; };
  }, [currentUser]);
  const toggle = async ()=>{
    setLoading(true); setMsg("");
    try{
      if (enrolled){
        try{ localStorage.removeItem(webAuthnIdKey(currentUser)); }catch{}
        setEnrolled(false);
        setMsg("Removed — PIN only now");
      }else{
        const id = await registerBiometric(currentUser);
        if (id){
          setEnrolled(true);
          setMsg("Enabled — Face ID / fingerprint will unlock next time");
        }else{
          setMsg("Not enabled — cancelled or not allowed");
        }
      }
    }catch(e:any){
      setMsg("Error: "+String(e?.message||e).slice(0,60));
    }finally{ setLoading(false); }
  };
  if (supported===null) return <div className="w-full flex items-center justify-between min-h-[52px] px-4 rounded-[16px] border bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}><span className="text-[14px]">Face ID / Fingerprint</span><span className="text-[11px] text-[var(--muted)]">Checking…</span></div>;
  if (supported===false){
    return <div className="w-full flex items-center justify-between min-h-[52px] px-4 rounded-[16px] border bg-[var(--card-bg)] opacity-60" style={{borderColor:"var(--border)"}}><span className="text-[14px]">Face ID / Fingerprint</span><span className="text-[11px] text-[var(--muted)]">Not on this device</span></div>;
  }
  return (
    <div className="w-full rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor: enrolled ? "#0A0A0A" : "var(--border)"}}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[14px] font-medium flex items-center gap-2">Face ID / Fingerprint {enrolled && <span className="text-[10px] rounded-full bg-[#0A0A0A] text-white px-2 py-0.5">ON</span>}</div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">{PERSONS[currentUser].name} • unlocks PIN screen • stays on this phone only</div>
        </div>
        <button onClick={toggle} disabled={loading} className="ml-3 h-[36px] rounded-full border px-4 text-[11px] font-semibold disabled:opacity-60 active:scale-[0.96]" style={{borderColor: enrolled ? "#0A0A0A" : "var(--border)", background: enrolled ? "#0A0A0A" : "var(--chip-bg)", color: enrolled ? "white" : "var(--text)"}}>{loading ? "…" : enrolled ? "On" : "Set up"}</button>
      </div>
      {msg && <div className="text-[11px] text-[var(--text-secondary)]">{msg}</div>}
      <div className="text-[10px] text-[var(--muted)]">Uses built-in Face ID / Touch ID / Windows Hello. No data leaves your phone — just a local key.</div>
    </div>
  );
}

function BlueprintPanel({
  theme, setTheme, onConfetti, choresRaw, calendarRaw, shoppingRaw, notesRaw, setChoresRaw, setCalendarRaw, setShoppingRaw, setNotesRaw, currentUser,
}: {
  theme: Theme; setTheme: any; onConfetti?: any; choresRaw:any; calendarRaw:any; shoppingRaw:any; notesRaw:any; setChoresRaw:any; setCalendarRaw:any; setShoppingRaw:any; setNotesRaw:any; currentUser: PersonKey;
}) {
  const [showDev, setShowDev] = useState(false);
  const [householdName, setHouseholdName] = useState(()=> {
    try { return localStorage.getItem("couple_v1_household_name") || "Aisling & Ciaran"; } catch { return "Aisling & Ciaran"; }
  });

  function updateHouseholdName(name:string){
    setHouseholdName(name);
    try { localStorage.setItem("couple_v1_household_name", name); } catch {}
  }

  const [openGroups, setOpenGroups] = useState<Record<string,boolean>>(()=>({appearance:true, household:false, notifications:false, data:false, advanced:false}));
  const toggleGroup = (k:string)=> setOpenGroups(p=>({...p, [k]:!p[k]}));
  return (
    <div className="space-y-3 py-2">
      {/* Grouped dropdown — fixes 2 confusing pages into one */}
      {/* Appearance */}
      <div className="rounded-[16px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:"var(--border)"}}>
        <button onClick={()=>toggleGroup('appearance')} className="w-full flex items-center justify-between min-h-[52px] px-4 text-left active:scale-[0.98] transition" style={{minHeight:52}}>
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px]">🎨</span><div><div className="text-[14px] font-medium leading-[1.1]">Appearance</div><div className="text-[11px] text-[var(--muted)]">{theme.name||"Beige"} • charcoal orange Hume</div></div></div>
          <span className="text-[12px] text-[var(--muted)]">{openGroups.appearance?"▲":"▼"}</span>
        </button>
        {openGroups.appearance && (
          <div className="px-4 pb-3 pt-1 space-y-3 border-t" style={{borderColor:"var(--border)"}}>
            <button onClick={()=> { const i = THEMES.findIndex(t=>t.id===theme.id); const n = THEMES[(i+1)%THEMES.length]; setTheme(n.id); onConfetti?.(); }} className="w-full flex items-center justify-between min-h-[48px] px-3 rounded-[12px] border bg-[var(--chip-bg)] text-left" style={{borderColor:"var(--border)"}}>
              <span className="text-[13px]">Theme</span><span className="flex items-center gap-2 text-[12px]"><span className="h-3 w-3 rounded-full" style={{background: theme.id==='ink'?'#FF6B26':'#FFDCC7', border:'1px solid var(--border)'}} />{theme.name||"Beige"}</span>
            </button>
            <div className="text-[11px] text-[var(--muted)]">Beige = warm paper #FFFEFB • Charcoal = Hume #121214 with orange #FF6B26 active</div>
          </div>
        )}
      </div>

      {/* Household */}
      <div className="rounded-[16px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:"var(--border)"}}>
        <button onClick={()=>toggleGroup('household')} className="w-full flex items-center justify-between min-h-[52px] px-4 text-left" style={{minHeight:52}}>
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px]">👥</span><div><div className="text-[14px] font-medium leading-[1.1]">Household</div><div className="text-[11px] text-[var(--muted)]">{householdName}</div></div></div>
          <span className="text-[12px] text-[var(--muted)]">{openGroups.household?"▲":"▼"}</span>
        </button>
        {openGroups.household && (
          <div className="px-4 pb-3 pt-1 space-y-3 border-t" style={{borderColor:"var(--border)"}}>
            <div className="flex items-center gap-2 w-full rounded-[16px] border bg-[var(--card-bg)] px-4 py-3" style={{borderColor:"var(--border)"}}>
              <span className="grid h-11 w-11 place-items-center rounded-full border text-[13px] font-bold" style={{background: theme.accent, borderColor:"var(--border)"}}>C</span>
              <div className="min-w-0 flex-1"><div className="text-[15px] font-semibold">Ciaran</div><div className="text-[12px] text-[var(--muted)]">Current profile</div></div>
            </div>
            <div className="w-full rounded-[16px] border bg-[var(--card-bg)] px-4 py-3 space-y-2" style={{borderColor:"var(--border)"}}>
              <div className="flex items-center justify-between">
                <div><div className="text-[13px] font-medium">Invite your partner</div><div className="text-[11px] text-[var(--muted)] mt-0.5">{(()=>{ try{ const code = localStorage.getItem("couple_v1_household_code"); const hid = localStorage.getItem("couple_v1_household_id")||"ash-ciaran-2026"; const name = localStorage.getItem("couple_v1_household_name")||"Your space"; if(code) return `${name} • Code: ${code}`; return `${name} • ${hid.slice(0,14)}…`; }catch{return "Your couple space"} })()}</div></div>
                <button onClick={async()=>{ try{ const code = localStorage.getItem("couple_v1_household_code")||""; const url = `${location.origin}${location.pathname}?code=${code}`; const txt = code ? `Join us on Beirt — Code: ${code} — ${url}` : url; if ((navigator as any).share) await (navigator as any).share({title:"Join us on Beirt", text:txt, url}); else { await navigator.clipboard.writeText(txt); (window as any).toast?.("Link copied"); } }catch{} }} className="h-[34px] rounded-full bg-[#0A0A0A] text-white px-3 text-[11px] font-semibold">Share</button>
              </div>
              <div className="flex items-center gap-2"><div className="text-[11px] font-mono tracking-[0.14em] rounded-full border bg-[var(--chip-bg)] px-2.5 py-1" style={{borderColor:"var(--border)"}}>{(()=>{ try{ const c = localStorage.getItem("couple_v1_household_code"); return c?c.toUpperCase(): (localStorage.getItem("couple_v1_household_id")||"").slice(-6).toUpperCase() || "COUPLE"; }catch{return "COUPLE"} })()}</div><button onClick={async()=>{ try{ const code = localStorage.getItem("couple_v1_household_code")||""; await navigator.clipboard.writeText(code); }catch{} }} className="text-[10px] text-[var(--muted)] underline">Copy code</button><div className="text-[10px] text-[var(--muted)] ml-auto">Private to you two</div></div>
            </div>
            <div className="w-full flex items-center justify-between min-h-[48px] px-4 rounded-[12px] border bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}><input value={householdName} onChange={e=> updateHouseholdName(e.target.value)} className="flex-1 bg-transparent text-[13px] outline-none" /><span className="text-[11px] text-[var(--muted)] ml-2">Name</span></div>
            <div className="w-full flex items-center justify-between min-h-[48px] px-4 rounded-[12px] border bg-[var(--card-bg)]" style={{borderColor:"var(--border)"}}>
              <span className="text-[13px]">Stay logged in</span>
              <button onClick={()=>{ try{ const cur = localStorage.getItem("couple_v1_remember_user"); const isOn = (cur==="1"||cur==="\"1\""||cur==="true"); const next = !isOn; localStorage.setItem("couple_v1_remember_user", next?"1":"0"); if(!next){ try{ sessionStorage.setItem("couple_v1_ephemeral_session","1"); }catch{} } else { try{ sessionStorage.removeItem("couple_v1_ephemeral_session"); }catch{} } location.reload(); }catch{} }} className="ml-3 h-[34px] rounded-full border px-4 text-[11px] font-semibold" style={{borderColor: (()=>{ try{ const r=localStorage.getItem("couple_v1_remember_user"); const on = (r==="1"||r==="\"1\""||r==="true"); return on?"#0A0A0A":"var(--border)" }catch{return "var(--border)"} })(), background: (()=>{ try{ const r=localStorage.getItem("couple_v1_remember_user"); const on = (r==="1"||r==="\"1\""||r==="true"); return on?"#0A0A0A":"var(--chip-bg)"}catch{return "white"} })(), color: (()=>{ try{ const r=localStorage.getItem("couple_v1_remember_user"); const on = (r==="1"||r==="\"1\""||r==="true"); return on?"white":"var(--text)"}catch{return "var(--text)"} })()}}>{(()=>{ try{ const r=localStorage.getItem("couple_v1_remember_user"); const on = (r==="1"||r==="\"1\""||r==="true"); return on?"On":"Off" }catch{return "Off"} })()}</button>
            </div>
            <div className="text-[10px] text-[var(--muted)]">Default Off — you get fingerprint or PIN every time. On = no lock.</div>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="rounded-[16px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:"var(--border)"}}>
        <button onClick={()=>toggleGroup('notifications')} className="w-full flex items-center justify-between min-h-[52px] px-4 text-left" style={{minHeight:52}}>
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px]">🔔</span><div><div className="text-[14px] font-medium leading-[1.1]">Notifications</div><div className="text-[11px] text-[var(--muted)]">Buzz when partner claims/drops</div></div></div>
          <span className="text-[12px] text-[var(--muted)]">{openGroups.notifications?"▲":"▼"}</span>
        </button>
        {openGroups.notifications && (
          <div className="px-4 pb-3 pt-2 border-t space-y-3" style={{borderColor:"var(--border)"}}>
            <PushToggle currentUser={currentUser as any} />
            <BiometricToggle currentUser={currentUser as any} />
          </div>
        )}
      </div>

      {/* Data & Sound */}
      <div className="rounded-[16px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:"var(--border)"}}>
        <button onClick={()=>toggleGroup('data')} className="w-full flex items-center justify-between min-h-[52px] px-4 text-left" style={{minHeight:52}}>
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px]">💾</span><div><div className="text-[14px] font-medium leading-[1.1]">Data & Sound</div><div className="text-[11px] text-[var(--muted)]">Storage • Game Sound</div></div></div>
          <span className="text-[12px] text-[var(--muted)]">{openGroups.data?"▲":"▼"}</span>
        </button>
        {openGroups.data && (
          <div className="px-4 pb-3 pt-2 border-t space-y-2" style={{borderColor:"var(--border)"}}>
            <div className="w-full flex items-center justify-between min-h-[52px] px-4 rounded-[12px] border bg-[var(--chip-bg)]" style={{borderColor:"var(--border)"}}>
              <span className="text-[13px]">Game Sound</span>
              <button
                onClick={()=>{
                  try{
                    const cur=localStorage.getItem("couple_v1_sound_on")==="1";
                    const next=!cur;
                    localStorage.setItem("couple_v1_sound_on", next?"1":"0");
                    (window as any).dispatchEvent(new CustomEvent("couple-sound-toggle",{detail:next}));
                    location.reload();
                  }catch{}
                }}
                className="h-[32px] rounded-full border px-3 text-[11px] font-medium"
                style={{borderColor:"var(--border)", background: (typeof localStorage!=="undefined" && localStorage.getItem("couple_v1_sound_on")==="1")?"#0A0A0A":"var(--card-bg)", color: (typeof localStorage!=="undefined" && localStorage.getItem("couple_v1_sound_on")==="1")?"white":"inherit"}}
              >
                {(typeof localStorage!=="undefined" && localStorage.getItem("couple_v1_sound_on")==="1")?"On • 1.2s confetti":"Off"}
              </button>
            </div>
            <div className="w-full flex items-center justify-between min-h-[48px] px-4 rounded-[12px] border bg-[var(--chip-bg)]" style={{borderColor:"var(--border)"}}><span className="text-[13px]">Version</span><span className="text-[11px] text-[var(--muted)]">{(() => { try { const localCode = (()=>{ try{ const c = localStorage.getItem("couple_v1_build_code"); return c? c : "107" } catch{ return "107" } })(); const lastCheck = (()=>{ try{ return localStorage.getItem("couple_v1_last_version_check") } catch{ return null } })(); return `v${localCode}${lastCheck ? "" : ""}`; } catch { return "v107" } })()}</span></div>
            <div className="w-full flex items-center justify-between min-h-[48px] px-4 rounded-[12px] border bg-[var(--chip-bg)]" style={{borderColor:"var(--border)"}}><span className="text-[13px]">Update</span><span className="text-[11px] text-[var(--muted)]">{(() => { try { const remote = (()=>{ try{ const j = localStorage.getItem("couple_v1_last_remote_version"); return j? JSON.parse(j) : null } catch{ return null } })(); if (remote && remote.code) { const lc = (()=>{ try{ return Number(localStorage.getItem("couple_v1_build_code")||"107") } catch{ return 107 } })(); if (Number(remote.code)>lc) return `New ${remote.version||remote.code} available`; return "Up to date"; } return "Checking server..."; } catch { return "Up to date"; } })()}</span></div>
            <div className="rounded-[12px] bg-[var(--chip-bg)] px-3 py-2 border text-[11px]" style={{borderColor:"var(--border)"}}><div className="text-[11px] font-semibold">Storage</div><div className="mt-1 text-[11px] text-[var(--muted)]">c:{choresRaw?.length||0} cal:{calendarRaw?.length||0} s:{shoppingRaw?.length||0} n:{notesRaw?.length||0}</div></div>
          </div>
        )}
      </div>

      {/* Advanced / Developer */}
      <div className="rounded-[16px] border bg-[var(--card-bg)] overflow-hidden" style={{borderColor:"var(--border)"}}>
        <button onClick={()=>toggleGroup('advanced')} className="w-full flex items-center justify-between min-h-[52px] px-4 text-left" style={{minHeight:52}}>
          <div className="flex items-center gap-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--chip-bg)] text-[12px]">🛠️</span><div><div className="text-[14px] font-medium leading-[1.1]">Advanced</div><div className="text-[11px] text-[var(--muted)]">Developer • Privacy • About</div></div></div>
          <span className="text-[12px] text-[var(--muted)]">{openGroups.advanced?"▲":"▼"}</span>
        </button>
        {openGroups.advanced && (
          <div className="px-4 pb-3 pt-2 border-t space-y-2" style={{borderColor:"var(--border)"}}>
            <button className="w-full flex items-center justify-between min-h-[48px] px-4 rounded-[12px] border bg-[var(--chip-bg)] text-left" style={{borderColor:"var(--border)"}}><span className="text-[13px]">Privacy</span><span className="text-[11px] text-[var(--muted)]">›</span></button>
            <div className="w-full flex items-center justify-between min-h-[48px] px-4 rounded-[12px] border bg-[var(--chip-bg)]" style={{borderColor:"var(--border)"}}><span className="text-[13px]">About</span><span className="text-[11px] text-[var(--muted)]">Beirt</span></div>
            <button onClick={()=> setShowDev(v=> !v)} className="text-[11px] underline text-[var(--muted)] px-1">{showDev ? "Hide developer" : "Developer"}</button>
            {showDev && (
              <div className="space-y-2 rounded-[12px] border bg-[var(--chip-bg)] p-3 text-[11px]" style={{borderColor:"var(--border)"}}>
                <div className="text-[11px] font-semibold">Debug diagnostics</div>
                <div>Row {ROW_ID} • Table {TABLE} • TZ {HOUSEHOLD_TZ}</div>
                <div className="pt-2 flex flex-wrap gap-1.5">
                  <button onClick={()=> { try{ localStorage.removeItem("couple_v1_debug"); location.reload(); }catch{} }} className="h-[32px] rounded-full border bg-[var(--card-bg)] px-3 text-[11px]">Disable debug</button>
                  <button onClick={()=> { try{ localStorage.setItem("couple_v1_debug","1"); location.reload(); }catch{} }} className="h-[32px] rounded-full border bg-[var(--card-bg)] px-3 text-[11px]">Enable debug (?debug=1 hidden)</button>
                </div>
              </div>
            )}
            {showDev && (
              <DebugCenter choresRaw={choresRaw as any} calendarRaw={calendarRaw as any} shoppingRaw={shoppingRaw as any} notesRaw={notesRaw as any} setChoresRaw={setChoresRaw as any} setCalendarRaw={setCalendarRaw as any} setShoppingRaw={setShoppingRaw as any} setNotesRaw={setNotesRaw as any} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}






function usePrefersReducedMotion(){ const [rm,setRm]=useState(false); useEffect(()=>{ try{ const m=window.matchMedia('(prefers-reduced-motion: reduce)'); setRm(m.matches); const l=()=>setRm(m.matches); const add = (m as any).addEventListener ? ()=>(m as any).addEventListener('change',l) : ()=>(m as any).addListener(l); const rem = (m as any).removeEventListener ? ()=>(m as any).removeEventListener('change',l) : ()=>(m as any).removeListener(l); add(); return()=>{ try{ rem(); }catch{} } }catch{} },[]); return rm; }
function V1AppShell({
  currentUser, setCurrentUser, themeId, setThemeId, nowMs, setNowMs,
}: {
  currentUser: PersonKey; setCurrentUser: (k: PersonKey) => void; themeId: string; setThemeId: (s: string) => void; nowMs: number; setNowMs: (n: number) => void;
}) {
  const standalone = useIsStandalone();
  const [tab, setTab] = useState<TabKey>("fridge");
  // ── Truthful sync state: single source owned by shell, NOT each SyncStatusIsolated ──
  // Starts as unknown — not "Saved". Only becomes Saved after verified Supabase write
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => {
    try {
      const q = localStorage.getItem('couple_v1_queue_count')
      const n = q ? Number(q) : 0
      if (n > 0) return { kind: 'offline-queued', queueCount: n } as SyncStatus
    } catch {}
    // Don't lie with Saved before we've actually loaded/verified
    return { kind: 'saving' } as SyncStatus
  });
  // keep compat: old code referenced syncState — map to new
  const syncState = syncStatus;
  const setSyncState = (s:any)=>{ /* legacy compat no-op, use setSyncStatus */ };
  const [showSwitch, setShowSwitch] = useState(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [pendingSwitchTo, setPendingSwitchTo] = useState<PersonKey|null>(null);
  const [switchPin, setSwitchPin] = useState("");
  const [switchPinWrong, setSwitchPinWrong] = useState(false);
  const phoneInnerRef = useRef<HTMLDivElement>(null);
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0]!;

  // ── Loop-break guards (fix feedback loop) ──
  const applyingRemoteRef = useRef(false);
  const lastLocalMutationIdRef = useRef<string | null>(null);
  const lastSnapshotHashRef = useRef<string | null>(null);
  const prevChoresRef = useRef<Map<string, any>>(new Map());
  const [pushToast, setPushToast] = useState<{title:string; body:string}|null>(null);
  useEffect(()=>{
    const onToast=(e:any)=>{ try{ const d=e?.detail||{}; setPushToast({title:d.title||'Beirt', body:d.body||''}); setTimeout(()=>setPushToast(null), 3500); }catch{} };
    try{ window.addEventListener('couple-push-fallback-toast', onToast as any); }catch{}
    return ()=>{ try{ window.removeEventListener('couple-push-fallback-toast', onToast as any);}catch{} };
  },[]);
  function stableHash(o: any): string {

    try {
      // deterministic: sort keys, stable array order by id
      const s = JSON.stringify(o, (_k, v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const keys = Object.keys(v).sort();
          const out: any = {};
          for (const k of keys) out[k] = (v as any)[k];
          return out;
        }
        return v;
      });
      // tiny hash to keep ref small but unique enough – keep full string for equality (data tiny)
      return s;
    } catch { return String(Date.now()); }
  }
  function deepEqual(a: any, b: any): boolean {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }

  // ── Mutation Queue (concept + implementation) ──
  // Every remoteSave gets mutationId = crypto.randomUUID()
  // Dedup guard: localStorage last_mutation + IDB queue dedup
  // Revision CAS: expectedRevision from LS, eq(revision) in Supabase
  // Queue persisted in IDB 'mutation_queue' + memory ref for offline
  type QueuedMutation = { mutationId: string; revision: number; payload: any; createdAt: string; retries: number };
  const mutationQueueRef = useRef<QueuedMutation[]>([]);
  const queueHydratedRef = useRef(false);

  // V16: offline robustness – consecutive fail counter + Supabase reachability probe (iOS PWA navigator.onLine lies)
  // V21: force online always – navigator.onLine lies and HEAD probe fails CORS on gh pages, so always return true
  const offlineFailCountRef = useRef(0);
  const lastOnlineProbeRef = useRef<number>(0);
  const reallyOnline = async (): Promise<boolean> => {
    // V21 restored: GH Pages HEAD probe fails CORS and lies → always assume online unless navigator says offline
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).onLine === false) return false
    } catch {}
    return true
  };

  // IDB hydration for queue + photos
  useEffect(()=>{
    (async()=>{
      try {
        const db = await openIdb();
        if (!db) return;
        // queue – V22 filter empty payloads that got stuck
        const q = await idbGet<QueuedMutation[]>('mutation_queue');
        if (Array.isArray(q) && q.length>0) {
          const filtered = q.filter((m:any)=>{
            try {
              const p = (m as any).payload || {}
              const tot = (Array.isArray(p.chores)? p.chores.length:0)+(Array.isArray(p.calendar)? p.calendar.length:0)+(Array.isArray(p.shopping)? p.shopping.length:0)+(Array.isArray(p.notes)? p.notes.length:0)
              if (tot===0) return false
              return true
            } catch { return true }
          })
          if (filtered.length !== q.length) {
            console.log(`[sync] V22 cleared ${q.length-filtered.length} empty queued items`)
            try { await idbSet('mutation_queue', filtered); } catch{}
            try { localStorage.setItem('couple_v1_queue_count', String(filtered.length)); } catch{}
          }
          if (filtered.length>0) {
            mutationQueueRef.current = filtered as any;
            queueHydratedRef.current = true;
            setSyncStatus(s=> s.kind==='saved' ? { kind:'offline-queued', queueCount: filtered.length, lastSavedAt: s.lastSavedAt } : s);
          } else {
            mutationQueueRef.current = []
            try { localStorage.setItem('couple_v1_queue_count','0'); } catch{}
          }
          // if we cleared all, DON'T fabricate Saved – keep previous confirmed time.
          // Reads/reconnects/queue cleanup must not set Saved unless latest write reached Supabase.
          if (filtered.length===0) {
            // Preserve last confirmed time from localStorage if we have it, else keep existing status.
            try {
              const prev = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
              if (prev) {
                setSyncStatus(s=> s.kind==='saving' ? { kind:'saved', lastSavedAt: prev } as any : s)
              }
            } catch {}
          }
        }
        // photos -> notesRaw will hydrate separately in its own effect below
      } catch {}
    })();
  }, []);

  const persistQueue = async ()=>{
    try { await idbSet('mutation_queue', mutationQueueRef.current); } catch{}
    try { localStorage.setItem('couple_v1_queue_count', String(mutationQueueRef.current.length)); } catch{}
  };

  const drainQueue = async ()=>{
    if (mutationQueueRef.current.length===0) {
      offlineFailCountRef.current = 0;
      return;
    }
    // V22: drop any total-0 payloads instantly – they are the stuck queue cause
    const before = mutationQueueRef.current.length
    const nonEmpty = mutationQueueRef.current.filter((m:any)=>{
      try {
        const p = (m as any).payload||{}
        const tot = (Array.isArray(p.chores)?p.chores.length:0)+(Array.isArray(p.calendar)?p.calendar.length:0)+(Array.isArray(p.shopping)?p.shopping.length:0)+(Array.isArray(p.notes)?p.notes.length:0)
        return tot>0
      } catch { return true }
    })
    if (nonEmpty.length !== before) {
      console.log(`[sync] V22 drainQueue dropped ${before-nonEmpty.length} empty`)
      mutationQueueRef.current = nonEmpty as any
      await persistQueue()
      if (mutationQueueRef.current.length===0) {
        // Queue cleaned of empty payloads is NOT a confirmed write – keep last confirmed time
        try {
          const last = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
          if (last) setSyncStatus({ kind:'saved', lastSavedAt: last } as any)
          else setSyncStatus(s=> s.kind==='saving' ? s : ({ kind:'saved', lastSavedAt: s.lastSavedAt } as any))
        } catch { setSyncStatus(s=> s as any) }
        return
      }
    }
    // V16: don't trust navigator.onLine alone – try Supabase reachability
    const online = await reallyOnline();
    if (!online) {
      offlineFailCountRef.current++;
      // only show offline banner after 3 consecutive fails
      if (offlineFailCountRef.current >= 3) {
        setSyncStatus(s=>({ kind:'offline-queued', queueCount: mutationQueueRef.current.length, lastSavedAt: s.lastSavedAt } as any));
      } else {
        setSyncStatus({ kind:'saving' } as any);
      }
      return;
    }
    if (!hasSupabaseConfig() || !getSupabase()) return;
    const next = [...mutationQueueRef.current];
    for (const m of next) {
      try {
        setSyncStatus({ kind:'saving' });
        // eslint-disable-next-line no-await-in-loop
        const ok = await remoteSave({ ...(m.payload||{}), mutationId: m.mutationId, expectedRevision: m.revision }) as any;
        if (ok) {
          mutationQueueRef.current = mutationQueueRef.current.filter(x=> x.mutationId!==m.mutationId);
          await persistQueue();
          offlineFailCountRef.current = 0;
          const confirmedAt = typeof ok === 'string' ? ok : (localStorage.getItem('couple_v1_last_confirmed_at') || new Date().toISOString());
          setSyncStatus({ kind:'saved', lastSavedAt: confirmedAt, queueCount: mutationQueueRef.current.length });
        } else {
          // keep for retry, bump retries – V16 auto-heal: if CAS 0 rows, bump local rev to remote
          m.retries++;
          offlineFailCountRef.current++;
          try {
            // probe remote revision to heal drift (LS 2704 vs remote 2705)
            const sb = getSupabase();
            if (sb) {
              const { data: fresh } = await sb.from(TABLE).select('revision').eq('id', ROW_ID).maybeSingle();
              if (fresh && typeof (fresh as any).revision === 'number') {
                try { localStorage.setItem('couple_v1_revision', String((fresh as any).revision)); } catch {}
                // update queued item's expected revision to fresh so next drain matches
                m.revision = (fresh as any).revision;
                await persistQueue();
              }
            }
          } catch {}
          if (m.retries>=3) {
            // after 3 fails, only show failed if truly unreachable 3 times
            if (offlineFailCountRef.current >= 3) {
              setSyncStatus({ kind:'failed', error:'sync failed — will retry', queueCount: mutationQueueRef.current.length });
            } else {
              setSyncStatus({ kind:'saving' } as any);
            }
            break;
          }
        }
      } catch (e:any) {
        m.retries++;
        offlineFailCountRef.current++;
        await persistQueue();
        if (offlineFailCountRef.current >= 3) {
          setSyncStatus({ kind:'failed', error: String(e?.message||e).slice(0,30), queueCount: mutationQueueRef.current.length });
        } else {
          setSyncStatus({ kind:'saving' } as any);
        }
        break;
      }
    }
    await persistQueue();
  };

  const enqueueMutation = async (payload:any)=>{
    // V22: skip empty payloads that would wipe row & get stuck in IDB queue
    try {
      const totalCheck = (Array.isArray((payload as any).chores) ? (payload as any).chores.length : 0)
        + (Array.isArray((payload as any).calendar) ? (payload as any).calendar.length : 0)
        + (Array.isArray((payload as any).shopping) ? (payload as any).shopping.length : 0)
        + (Array.isArray((payload as any).notes) ? (payload as any).notes.length : 0)
      if (totalCheck === 0) {
        console.log('[sync] V22 skip enqueue total 0 – not queuing empty')
        return true
      }
    } catch {}
    // reuse mutationId from caller's guarded snapshot if provided (echo guard)
    const provided = (payload as any)?.meta?.lastMutationId || (payload as any)?.lastMutationId
    const mutationId = provided || ((typeof crypto!=='undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `mut_${Date.now()}_${Math.random().toString(36).slice(2,7)}`)
    // ensure payload carries it for realtime echo detection
    try { if ((payload as any).meta) (payload as any).meta.lastMutationId = mutationId; else (payload as any).meta = { lastMutationId: mutationId } } catch {}
    let rev = 0;
    try { rev = Number(localStorage.getItem('couple_v1_revision')||'0') } catch{}
    const item: QueuedMutation = { mutationId, revision: rev, payload, createdAt: new Date().toISOString(), retries:0 };
    // dedup guard: if last mutation same id skip
    try {
      const last = localStorage.getItem('couple_v1_last_mutation');
      if (last && mutationId===last) {
        // already sent this exact mutation — don't requeue, but still ensure refs are correct
        lastLocalMutationIdRef.current = mutationId
        return true;
      }
    } catch{}
    mutationQueueRef.current.push(item);
    await persistQueue();
    // V16: probe reality, don't trust navigator.onLine alone
    const onlineNow = await reallyOnline();
    if (!onlineNow) {
      offlineFailCountRef.current++;
      if (offlineFailCountRef.current >= 3) {
        setSyncStatus({ kind:'offline-queued', queueCount: mutationQueueRef.current.length });
      } else {
        setSyncStatus({ kind:'saving' } as any);
      }
      // don't try remote now — DO NOT mark as processed yet
      // last_mutation is only set after confirmed Supabase write
      return false;
    }
    // try immediate save with CAS
    try {
      setSyncStatus({ kind:'saving' });
      const ok = await remoteSave({ ...payload, mutationId, expectedRevision: rev }) as any;
      if (ok) {
        mutationQueueRef.current = mutationQueueRef.current.filter(x=> x.mutationId!==mutationId);
        await persistQueue();
        offlineFailCountRef.current = 0;
        // Revision & last_mutation come from server verification inside remoteSave — don't assume rev+1
        // last_sync is already set inside remoteSave after verified write
        const confirmedAtEnq = typeof ok === 'string' ? ok : (localStorage.getItem('couple_v1_last_confirmed_at') || new Date().toISOString());
        setSyncStatus({ kind:'saved', lastSavedAt: confirmedAtEnq });
        return true;
      } else {
        // leave in queue for retry – V16 auto-heal rev drift
        try {
          const sb = getSupabase();
          if (sb) {
            const { data: fresh } = await sb.from(TABLE).select('revision').eq('id', ROW_ID).maybeSingle();
            if (fresh && typeof (fresh as any).revision === 'number') {
              try { localStorage.setItem('couple_v1_revision', String((fresh as any).revision)); } catch {}
              item.revision = (fresh as any).revision;
              await persistQueue();
            }
          }
        } catch {}
        offlineFailCountRef.current++;
        if (offlineFailCountRef.current >= 3) {
          setSyncStatus({ kind:'failed', error:'conflict or offline', queueCount: mutationQueueRef.current.length });
        } else {
          setSyncStatus({ kind:'saving' } as any);
        }
        return false;
      }
    } catch (e:any) {
      offlineFailCountRef.current++;
      if (offlineFailCountRef.current >= 3) {
        setSyncStatus({ kind:'failed', error: String(e?.message||e).slice(0,24), queueCount: mutationQueueRef.current.length });
      } else {
        setSyncStatus({ kind:'saving' } as any);
      }
      return false;
    }
  };
    // Theme is owned by CSS — JS only flips html[data-theme] + migrates legacy ids
  useEffect(()=>{
    try {
      const legacyMap: Record<string,string> = { peach:'beige', butter:'beige', lavender:'beige', terracotta:'beige', mint:'beige', paper:'beige', cream:'beige', midnight:'ink' };
      const rawId = (theme as any)?.id || themeId || 'beige';
      const mappedId = legacyMap[rawId] || rawId;
      const isInk = mappedId === 'ink';
      const r = document.documentElement;
      r.setAttribute('data-theme', isInk ? 'ink' : 'beige');
      if (rawId !== mappedId) {
        try { localStorage.setItem('couple_v1_theme', JSON.stringify(mappedId)); } catch {}
        try { setThemeId(mappedId); } catch {}
      }
    } catch {}
  }, [theme, themeId, setThemeId]);

  // One clock for relative times (30s) — event-driven sync status separate, no 1s interval.
  useEffect(() => { let i:any=setInterval(()=>{ if(document.hidden) return; setNowMs(Date.now()); }, 30000); const onVis=()=>{ if(!document.hidden) setNowMs(Date.now()); }; document.addEventListener("visibilitychange", onVis); return ()=>{ clearInterval(i); document.removeEventListener("visibilitychange", onVis); }; }, [setNowMs]);

  // One unified truthful sync signal — replaces multiple leaked listeners – V16 less aggressive
  useEffect(()=>{
    const onOnline = async ()=>{
      offlineFailCountRef.current = 0;
      await drainQueue();
      if (mutationQueueRef.current.length>0) setSyncStatus(s=>({ kind:'offline-queued', queueCount: mutationQueueRef.current.length, lastSavedAt: s.lastSavedAt }));
      else {
        // Only keep previous confirmed Saved, don't fabricate new timestamp on reconnect
        const last = (()=>{ try{ return localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync') } catch { return null } })();
        if (last) setSyncStatus(s=>({ kind:'saved', lastSavedAt: last }));
        // else keep existing, don't invent
      }
    };
    const onOffline = async ()=>{
      const stillOnline = await reallyOnline();
      if (stillOnline) {
        offlineFailCountRef.current = 0;
        setSyncStatus(s=>({ kind:'saved', lastSavedAt: s.lastSavedAt } as any));
        drainQueue();
        return;
      }
      offlineFailCountRef.current++;
      if (offlineFailCountRef.current >= 3) {
        setSyncStatus(s=>({ kind:'offline-queued', queueCount: mutationQueueRef.current.length || undefined, lastSavedAt: s.lastSavedAt }));
      } else {
        setSyncStatus(s=>({ kind:'saving' } as any));
      }
    };
    const onCoupleSync = (ev:any)=>{
      const d = ev?.detail;
      if (d==='saving') setSyncStatus(s=>({ ...s, kind:'saving' }));
      else if (d==='failed') {
        offlineFailCountRef.current++;
        if (offlineFailCountRef.current >= 3) {
          setSyncStatus(s=>({ kind:'failed', error: s.lastSavedAt ? undefined : 'failed', queueCount: s.queueCount, lastSavedAt: s.lastSavedAt }));
        } else {
          setSyncStatus(s=>({ kind:'saving' } as any));
        }
      }
      else if (d==='offline') {
        // debounce: probe before trusting
        onOffline();
        return;
      }
      else if (d==='updated-elsewhere') setSyncStatus(s=>({ kind:'updated-elsewhere', lastSavedAt: s.lastSavedAt }));
      else if (d==='saved') {
        offlineFailCountRef.current = 0;
        try {
          const ca = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
          setSyncStatus({ kind:'saved', lastSavedAt: ca || new Date().toISOString() });
        } catch {
          setSyncStatus({ kind:'saved', lastSavedAt: new Date().toISOString() });
        }
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('couple-sync' as any, onCoupleSync as any);
    return ()=>{ window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.removeEventListener('couple-sync' as any, onCoupleSync as any); };
  }, []);

  // ── V11 Auto-Update: polls version.json network-first every 5min + on focus/online/visibility ──
  // Requirement: App.tsx useEffect for updater exists, uses fetch cache: no-cache, if newer code > current, dispatch couple-sync or show banner.
  // Preserves Supabase realtime primary.
  useEffect(()=>{
    let cancelled = false;
    let timer: any = null;
    const checkVersion = async ()=>{
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      } catch {}
      try {
        // dynamic import to avoid circular: use updater lib directly with network-first
        const { checkForUpdate, isNewer, isNewerCode, getCurrentVersion, getCurrentCode } = await import("./lib/updater");
        const localVer = getCurrentVersion();
        const localCode = getCurrentCode();
        // network-first explicit fetch as spec
        const bustUrl = `./version.json?t=${Date.now()}`;
        try {
          const r = await fetch(bustUrl, { cache: "no-store" as any, headers: { "Cache-Control": "no-cache" } as any });
          if (r.ok) {
            const j = await r.json();
            if (j?.version) {
              const remoteVer = j.version as string;
              const remoteCode = (j as any).code ?? (j as any).buildNumber ?? (j as any).build;
              const codeNewer = remoteCode != null && isNewerCode(Number(remoteCode), localCode);
              const verNewer = isNewer(remoteVer, localVer);
              if (codeNewer || verNewer) {
                console.log(`[updater:App] newer detected ${localVer}(${localCode}) -> ${remoteVer}(${remoteCode})`);
                try { window.dispatchEvent(new CustomEvent('couple-update-available', { detail: j })); } catch {}
                try { window.dispatchEvent(new CustomEvent('couple-sync', { detail: 'update-available' })); } catch {}
                // banner handled by UpdaterBanner via event; also allow App UI to react
                return;
              }
            }
          }
        } catch {}
        // fallback via lib (tries multiple candidates)
        const res = await checkForUpdate();
        if (cancelled) return;
        if (res.available && res.remote) {
          try { window.dispatchEvent(new CustomEvent('couple-update-available', { detail: res.remote })); } catch {}
          try { window.dispatchEvent(new CustomEvent('couple-sync', { detail: 'update-available' })); } catch {}
        }
      } catch (e) {
        console.warn("[updater:App] check failed", e);
      }
    };
    checkVersion();
    timer = window.setInterval(checkVersion, 5*60*1000);
    const onFocus = ()=> checkVersion();
    const onVis = ()=> { if (document.visibilityState === "visible") checkVersion(); };
    const onOnline = ()=> checkVersion();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline as any);
    // also react to update-available from Banner to ensure sync flush before reload
    const onUpdateEvt = (ev:any)=>{
      try { console.log("[updater:App] update event", ev?.detail?.version); } catch {}
    };
    window.addEventListener("couple-update-available" as any, onUpdateEvt as any);
    return ()=>{
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline as any);
      window.removeEventListener("couple-update-available" as any, onUpdateEvt as any);
    };
  }, []);

  const touchSync = () => {
    // No longer fabricates Saved — only checks queue state
    if (mutationQueueRef.current.length > 0) {
      setSyncStatus(s=> ({ kind:'offline-queued', queueCount: mutationQueueRef.current.length, lastSavedAt: s.lastSavedAt } as any))
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncStatus(s=> ({ kind:'offline-queued', queueCount: 1, lastSavedAt: s.lastSavedAt } as any))
    }
    drainQueue()
  };
  function triggerConfetti(origin?: any) {
    const hostParent = phoneInnerRef.current; if (!hostParent) return;
    const existing = hostParent.querySelectorAll(".confetti-host"); if (existing.length >= 2) existing[0]?.remove();
    const host = document.createElement("div"); (host as any).className = "confetti-host confetti-host--race"; (host as any).style.position = "absolute"; (host as any).style.inset = "0"; (host as any).style.pointerEvents = "none"; (host as any).style.zIndex = "50"; (host as any).style.overflow = "hidden"; (host as any).style.borderRadius = "28px"; hostParent.appendChild(host);
    let cx = 0.5, cy = 0.38;
    try {
      const anyOrigin: any = origin;
      if (anyOrigin && typeof anyOrigin.clientX === "number") { const rect = hostParent.getBoundingClientRect(); cx = (anyOrigin.clientX - rect.left) / rect.width; cy = (anyOrigin.clientY - rect.top) / rect.height; }
      else if (anyOrigin instanceof Element) { const r = anyOrigin.getBoundingClientRect(); const pr = hostParent.getBoundingClientRect(); cx = ((r.left + r.width / 2) - pr.left) / pr.width; cy = ((r.top + r.height / 2) - pr.top) / pr.height; }
    } catch { }
    cx = Math.min(0.85, Math.max(0.15, cx)); cy = Math.min(0.78, Math.max(0.12, cy));
    const colors = ["#A89FDA", "var(--border)", "#D0A1EA", "var(--wash-top)", "#FACC15", "#6EE7B7", "#FB923C"];
    const finalCount = 24 + Math.floor(Math.random() * 7);
    for (let i = 0; i < finalCount; i++) {
      const el = document.createElement("div"); (el as any).className = "confetti-node";
      const roll = Math.random(); const color = colors[Math.floor(Math.random() * colors.length)]!;
      const angle = Math.random() * Math.PI * 2; const dist0 = Math.random() * 16; const dist1 = 42 + Math.random() * 94;
      const x0 = Math.cos(angle) * dist0; const y0 = Math.sin(angle) * dist0 * 0.5 - Math.random() * 12;
      const x1 = Math.cos(angle) * dist1 + (Math.random() - 0.5) * 28; const yDrift = 110 + Math.random() * 150;
      const leftBase = cx * 100; const leftJitter = (Math.random() - 0.5) * 16; const left = Math.min(85, Math.max(15, leftBase + leftJitter + x0 / 3.2));
      const r0 = Math.floor(Math.random() * 360); const r1 = r0 + (180 + Math.random() * 540) * (Math.random() < 0.5 ? -1 : 1);
      const delay = Math.floor(Math.random() * 80); const dur = 650 + Math.floor(Math.random() * 250); const scale = 0.82 + Math.random() * 0.6;
      (el as any).style.left = left + "%"; (el as any).style.top = cy * 100 + "%";
      (el as any).style.setProperty("--x0", x0 + "px"); (el as any).style.setProperty("--y0", y0 + "px");
      (el as any).style.setProperty("--x1", x1 + "px"); (el as any).style.setProperty("--y1", yDrift + "px");
      (el as any).style.setProperty("--r0", r0 + "deg"); (el as any).style.setProperty("--r1", r1 + "deg");
      (el as any).style.setProperty("--s", scale.toString()); (el as any).style.animationDelay = delay + "ms"; (el as any).style.animationDuration = dur + "ms";
      if (roll < 0.33) { (el as any).style.width = "6px"; (el as any).style.height = "6px"; (el as any).style.borderRadius = "999px"; (el as any).style.background = color; }
      else if (roll < 0.66) { (el as any).style.width = "6px"; (el as any).style.height = "6px"; (el as any).style.borderRadius = "1.5px"; (el as any).style.background = color; }
      else if (roll < 0.86) { (el as any).style.width = "8px"; (el as any).style.height = "3px"; (el as any).style.borderRadius = "2px"; (el as any).style.background = color; }
      else { (el as any).style.width = "10px"; (el as any).style.height = "10px"; (el as any).style.background = "transparent"; (el as any).innerHTML = "<svg viewBox='0 0 10 10' width='10' height='10'><path d='M5 0 L6.15 3.2 L9.5 3.2 L6.72 5.28 L7.62 8.7 L5 6.64 L2.38 8.7 L3.28 5.28 L0.5 3.2 L3.85 3.2 Z' fill='" + color + "'/></svg>"; }
      host.appendChild(el);
    }
    window.setTimeout(() => { host.remove(); }, 1150);
  }
  // migrate chores from old a/b shape and localStorage -- clean slate (no demo)
  const [choresRaw, setChoresRaw] = useLocalState<any[]>("couple_v1_chores", []);
  const chores: ChoreV2[] = (choresRaw as any[]).map((c: any) => {
    if (c && c.swipes && (c.swipes.aisling !== undefined || c.swipes.ciaran !== undefined)) return c as ChoreV2;
    if (c && c.swipes && (c.swipes.a !== undefined || c.swipes.b !== undefined)) {
      return { ...c, swipes: { aisling: c.swipes.a, ciaran: c.swipes.b }, assignedTo: c.assignedTo === 'a' ? 'aisling' : c.assignedTo === 'b' ? 'ciaran' : c.assignedTo, completedBy: c.completedBy === 'a' ? 'aisling' : c.completedBy === 'b' ? 'ciaran' : c.completedBy } as ChoreV2;
    }
    return { id: c.id || uid("chk"), title: c.title || "Untitled", type: "one-off", frequency: "once", createdAt: c.createdAt || new Date().toISOString(), pain: 5, basePoints: 50, swipes: { aisling: null, ciaran: null }, status: c.completed ? "done" : "deck", assignedTo: c.assignedTo === "Alex" ? "aisling" : "ciaran", multiplier: 1, timeWindowHours: 24 } as ChoreV2;
  });
  const setChores = (up: any) => {
    if (typeof up === "function") {
      setChoresRaw((prev: any) => {
        const cur = (prev as any[]).map((c: any) => {
          if (c && c.swipes && (c.swipes.aisling !== undefined || c.swipes.ciaran !== undefined)) return c;
          if (c && c.swipes && (c.swipes.a !== undefined || c.swipes.b !== undefined)) return { ...c, swipes: { aisling: c.swipes.a, ciaran: c.swipes.b }, assignedTo: c.assignedTo === 'a' ? 'aisling' : c.assignedTo === 'b' ? 'ciaran' : c.assignedTo, completedBy: c.completedBy === 'a' ? 'aisling' : c.completedBy === 'b' ? 'ciaran' : c.completedBy };
          return c;
        });
        return up(cur);
      });
    } else setChoresRaw(up);
  };
  const [calendarRaw, setCalendarRaw] = useLocalState<CalendarEventV2[]>("couple_v1_calendar_v2", []);
  const [shoppingRaw, setShoppingRaw] = useLocalState<ShoppingItemV2[]>("couple_v1_shopping_v2", []);
  const [notesRaw, setNotesRaw] = useLocalState<NoteMemo[]>("couple_v1_notes_memo", []);

  // migrate old shopping cats → new taxonomy to prevent invisible items
  useEffect(() => {
    try {
      if (!Array.isArray(shoppingRaw) || shoppingRaw.length === 0) return;
      let needs = false;
      for (const it of shoppingRaw as any[]) {
        if (!it || typeof it.cat !== "string") continue;
        if (!(CATS as string[]).includes(it.cat)) { needs = true; break; }
      }
      if (!needs) return;
      const migrated = (shoppingRaw as any[]).map((it: any) => {
        try { return { ...it, cat: mapOldCat(it.cat) }; } catch { return it; }
      });
      setShoppingRaw(migrated as any);
    } catch {}
  }, [shoppingRaw]);

  // ── STORAGE: Supabase first, realtime guarded ──
  useEffect(() => {
    let cancelled = false

    // ── guarded remote apply (breaks echo loop) ──
    const applyRemoteSnapshot = (remote: any, opts?: { force?: boolean }) => {
      if (!remote) return
      const force = !!opts?.force
      try {
        // 1) echo guard: ignore our own write that came back via realtime - skip when force (fresh load)
        if (!force) {
          const remoteMut = (remote.meta as any)?.lastMutationId || (remote as any).lastMutationId
          if (remoteMut && remoteMut === lastLocalMutationIdRef.current) {
            // own echo — update hash so auto-push won't re-fire, but don't re-apply arrays
            const h = stableHash({ chores: remote.chores, calendar: remote.calendar, shopping: remote.shopping, notes: remote.notes })
            lastSnapshotHashRef.current = h
            return
          }
        }
        // 2) snapshot hash guard - skip when force so fresh installs always hydrate
        const nextHash = stableHash({ chores: remote.chores, calendar: remote.calendar, shopping: remote.shopping, notes: remote.notes })
        if (!force && nextHash === lastSnapshotHashRef.current) {
          return
        }

        applyingRemoteRef.current = true
        lastSnapshotHashRef.current = nextHash

        // ── V52 realtime cross-notify (no edge needed when app open) ──
        try {
          if (!force && Array.isArray(remote.chores) && remote.chores.length > 0) {
            const partner: PersonKey = currentUser === 'aisling' ? 'ciaran' : 'aisling';
            const curMap = prevChoresRef.current;
            if (curMap.size === 0 && Array.isArray(choresRaw) && choresRaw.length > 0) {
              // seed from current local on first realtime after load
              choresRaw.forEach((c:any)=> { try{ curMap.set(String(c.id), c); }catch{} });
            }
            for (const rc of remote.chores as any[]) {
              const id = String(rc.id || '');
              if (!id) continue;
              const prev = curMap.get(id);
              const nowAssigned = rc.assignedTo;
              const prevAssigned = prev?.assignedTo;
              const nowDoneBy = rc.completedBy;
              const prevDoneBy = prev?.completedBy;
              const nowSwipesOther = rc.swipes?.[partner];
              const prevSwipesOther = prev?.swipes?.[partner];
              // sender detection: if updatedBy field present use it, else infer from who changed
              const updatedBy = (rc as any).updatedBy || (rc as any).updated_by || (remote.meta as any)?.lastMutationBy;
              const isOwn = updatedBy ? updatedBy === currentUser : false;
              // 1) New chore assigned TO current user
              if (nowAssigned === currentUser && prevAssigned !== currentUser && !isOwn) {
                try { import('./lib/push').then(m=> m.localNotify(`New chore for you`, `${rc.title} • assigned to you` as any)) } catch {}
              }
              // 2) Chore completed by partner
              if (nowDoneBy === partner && prevDoneBy !== partner && !isOwn && rc.status === 'done') {
                try { import('./lib/push').then(m=> m.localNotify(`${partner==='aisling'?'Aisling':'Ciarán'} did ${rc.title}`, `+pts • finished` as any)) } catch {}
              }
              // 3) Partner swiped right (claimed interest) on something you hadn't seen
              if (nowSwipesOther === 'right' && prevSwipesOther !== 'right' && !isOwn) {
                // only notify if you also might care (deck or open)
                if (rc.status !== 'done') {
                  try { import('./lib/push').then(m=> m.localNotify(`${partner==='aisling'?'Aisling':'Ciarán'} wants ${rc.title}`, `Tap to decide`)) } catch {}
                }
              }
              // 4) Both-right race created
              if (rc.status === 'open' && rc.swipes?.aisling === 'right' && rc.swipes?.ciaran === 'right' && prev?.status !== 'open') {
                if (!isOwn) {
                  try { import('./lib/push').then(m=> m.localNotify(`Race on ${rc.title}`, `Both want it — first to do wins bonus`)) } catch {}
                }
              }
            }
            // refresh map for next diff
            const newMap = new Map<string, any>();
            (remote.chores as any[]).forEach((c:any)=> { try{ newMap.set(String(c.id), c); }catch{} });
            prevChoresRef.current = newMap;
          } else if (Array.isArray(remote.chores)) {
            // seed on force
            const m = new Map<string, any>();
            (remote.chores as any[]).forEach((c:any)=> { try{ m.set(String(c.id), c); }catch{} });
            prevChoresRef.current = m;
          }
        } catch {}

        // ── minimal additive merge but with deepEqual identity preservation ──
        const totalRemote = (Array.isArray(remote.chores)? remote.chores.length:0)+(Array.isArray(remote.calendar)? remote.calendar.length:0)+(Array.isArray(remote.shopping)? remote.shopping.length:0)+(Array.isArray(remote.notes)? remote.notes.length:0)
        const totalLocal = (choresRaw as any[]).length + (calendarRaw as any[]).length + (shoppingRaw as any[]).length + (notesRaw as any[]).length
        if (totalRemote === 0 && !force) {
          console.log('[sync] realtime skip — remote total 0 guard')
          queueMicrotask(()=>{ applyingRemoteRef.current = false })
          return
        }

        // use functional setters with deepEqual preservation — prevents new array object churn
        const { chores, calendar, shopping, notes } = remote

        if (Array.isArray(chores)) {
          setChoresRaw((prev:any)=>{
            if (deepEqual(prev, chores)) return prev;
            // merged by id using updatedAt/completedAt — preserves local done/assigned newer than remote stale
            const remoteById = new Map<string, any>();
            (chores as any[]).forEach((rc:any)=> { try{ remoteById.set(String(rc.id), rc); }catch{} });
            const prevArr = Array.isArray(prev) ? prev : [];
            // keep set of ids to merge
            if (!force) {
              const now = Date.now();
              const merged: any[] = [];
              const seen = new Set<string>();
              // remote first, but if local newer wins, replace - V64 tombstone aware
              (chores as any[]).forEach((rc:any)=>{
                const id = String(rc.id);
                seen.add(id);
                const local = prevArr.find((l:any)=> String(l.id)===id);
                if (!local) { merged.push(rc); return; }
                // compare timestamps including deletedAt for tombstone wins
                const localTs = (()=>{ try{ const t = local.updatedAt || local.deletedAt || local.completedAt || local.createdAt; return t? new Date(t).getTime():0; }catch{return 0} })();
                const remoteTs = (()=>{ try{ const t = rc.updatedAt || rc.deletedAt || rc.completedAt || rc.createdAt; return t? new Date(t).getTime():0; }catch{return 0} })();
                const lHasDel = !!(local as any).deletedAt;
                const rHasDel = !!(rc as any).deletedAt;
                if (lHasDel || rHasDel) {
                  const lDelTs = lHasDel ? new Date((local as any).deletedAt).getTime() : 0;
                  const rDelTs = rHasDel ? new Date((rc as any).deletedAt).getTime() : 0;
                  const lEff = Math.max(lDelTs, localTs);
                  const rEff = Math.max(rDelTs, remoteTs);
                  if (lHasDel && lEff >= rEff) { merged.push(local); return; }
                  if (rHasDel && rEff > lEff) { merged.push(rc); return; }
                }
                // if local status is done and remote not done, prefer local even if slightly older (user action should win)
                const localDone = local.status === 'done';
                const remoteDone = rc.status === 'done';
                if (localDone && !remoteDone) { merged.push(local); return; }
                if (localTs > remoteTs) { merged.push(local); return; }
                // equal but local had an update (updatedAt exists and remote not) keep local
                if (local.updatedAt && !rc.updatedAt && localTs >= remoteTs) { merged.push(local); return; }
                merged.push(rc);
              });
              // add local-only items (new creations < 5min or any not in remote)
              prevArr.forEach((lc:any)=>{
                const id = String(lc.id||'');
                if (seen.has(id)) return;
                const created = lc.createdAt ? new Date(lc.createdAt).getTime() : 0;
                const isRecent = created && (now-created)<300000;
                // always keep local-only that isn't in remote (could be pending push)
                if (!remoteById.has(id) || isRecent) merged.push(lc);
              });
              return merged as any;
            } else {
// force=true initial load: still merge preferring newer local if local exists and is newer, not blind replace + tombstone wins
              if (!prevArr || prevArr.length===0) return chores as any;
              const seenF = new Set<string>();
              const mergedForce: any[] = (chores as any[]).map((rc:any)=>{
                const id = String(rc.id);
                seenF.add(id);
                const local = prevArr.find((l:any)=> String(l.id)===id);
                if (!local) return rc;
                const localTs = (()=>{ try{ const t = local.updatedAt || local.deletedAt || local.completedAt || local.createdAt; return t? new Date(t).getTime():0; }catch{return 0} })();
                const remoteTs = (()=>{ try{ const t = rc.updatedAt || rc.deletedAt || rc.completedAt || rc.createdAt; return t? new Date(t).getTime():0; }catch{return 0} })();
                const lHasDel = !!(local as any).deletedAt;
                const rHasDel = !!(rc as any).deletedAt;
                if (lHasDel || rHasDel) {
                  const lDelTs = lHasDel ? new Date((local as any).deletedAt).getTime() : 0;
                  const rDelTs = rHasDel ? new Date((rc as any).deletedAt).getTime() : 0;
                  const lEff = Math.max(lDelTs, localTs);
                  const rEff = Math.max(rDelTs, remoteTs);
                  if (lHasDel && lEff >= rEff) return local;
                  if (rHasDel && rEff > lEff) return rc;
                }
                if (local.status==='done' && rc.status!=='done') return local;
                if (localTs > remoteTs) return local;
                return rc;
              });
              prevArr.forEach((lc:any)=>{ const id=String(lc.id||''); if(!seenF.has(id)) mergedForce.push(lc); });
              return mergedForce as any;
            }
          })
        }
        if (Array.isArray(calendar)) {
          setCalendarRaw((prev:any)=>{
            if (deepEqual(prev, calendar)) return prev
            // merge by id with updatedAt to keep tombstones
            if (!force && Array.isArray(prev) && prev.length>0) {
              const byId = new Map<string, any>()
              ;(calendar as any[]).forEach((rc:any)=>{ try{ byId.set(String(rc.id), rc)}catch{} })
              const merged: any[] = []
              const seen = new Set<string>()
              ;(calendar as any[]).forEach((rc:any)=>{
                const id=String(rc.id); seen.add(id)
                const local = (prev as any[]).find((l:any)=>String(l.id)===id)
                if (!local) { merged.push(rc); return; }
                const lTs = (()=>{ try{ const v=local.updatedAt||local.deletedAt||local.createdAt; return v?new Date(v).getTime():0}catch{return 0}})()
                const rTs = (()=>{ try{ const v=rc.updatedAt||rc.deletedAt||rc.createdAt; return v?new Date(v).getTime():0}catch{return 0}})()
                if ((local as any).deletedAt && (!(rc as any).deletedAt || lTs>=rTs)) { merged.push(local); return; }
                if (lTs>rTs) { merged.push(local); return; }
                merged.push(rc)
              })
              ;(prev as any[]).forEach((lc:any)=>{ const id=String(lc.id||''); if(!seen.has(id)) merged.push(lc); })
              return merged as any
            }
            return calendar as any
          })
        }
        if (Array.isArray(shopping)) {
          setShoppingRaw((prev:any)=>{
            if (deepEqual(prev, shopping)) return prev
            if (!force && Array.isArray(prev) && prev.length>0) {
              const merged: any[]=[]
              const seen=new Set<string>()
              ;(shopping as any[]).forEach((rc:any)=>{
                const id=String(rc.id); seen.add(id)
                const local=(prev as any[]).find((l:any)=>String(l.id)===id)
                if (!local){ merged.push(rc); return; }
                const lTs=(()=>{ try{ const v=local.updatedAt||local.deletedAt||local.archivedAt||local.createdAt; return v?new Date(v).getTime():0}catch{return 0}})()
                const rTs=(()=>{ try{ const v=rc.updatedAt||rc.deletedAt||rc.archivedAt||rc.createdAt; return v?new Date(v).getTime():0}catch{return 0}})()
                if ((local as any).deletedAt || (local as any).archivedAt) {
                  if (lTs>=rTs) { merged.push(local); return; }
                }
                if (lTs>rTs) { merged.push(local); return; }
                merged.push(rc)
              })
              ;(prev as any[]).forEach((lc:any)=>{ const id=String(lc.id||''); if(!seen.has(id)) merged.push(lc); })
              return merged as any
            }
            return shopping as any
          })
        }
        if (Array.isArray(notes)) {
          setNotesRaw((prev:any)=>{
            if (deepEqual(prev, notes)) return prev
            if (!force && Array.isArray(prev) && prev.length>0) {
              const merged: any[]=[]
              const seen=new Set<string>()
              ;(notes as any[]).forEach((rc:any)=>{
                const id=String(rc.id); seen.add(id)
                const local=(prev as any[]).find((l:any)=>String(l.id)===id)
                if (!local){ merged.push(rc); return; }
                const lTs=(()=>{ try{ const v=local.updatedAt||local.deletedAt||local.archivedAt||local.archived_at||local.createdAt; return v?new Date(v).getTime():0}catch{return 0}})()
                const rTs=(()=>{ try{ const v=rc.updatedAt||rc.deletedAt||rc.archivedAt||rc.archived_at||rc.createdAt; return v?new Date(v).getTime():0}catch{return 0}})()
                // keep tombstone if newer
                if ((local as any).deletedAt || (local as any).archivedAt || (local as any).archived_at) {
                  if (lTs>=rTs) {
                    // preserve photo from either if missing
                    if ((local as any).photoDataUrl && !(rc as any).photoDataUrl) rc=( {...rc, photoDataUrl: local.photoDataUrl, photoThumbDataUrl: local.photoThumbDataUrl} as any)
                    merged.push(local); return;
                  }
                }
                if (lTs>rTs) { merged.push(local); return; }
                // preserve local photo if remote stripped
                if ((local as any).photoDataUrl && !(rc as any).photoDataUrl) {
                  merged.push({...rc, photoDataUrl: local.photoDataUrl, photoThumbDataUrl: local.photoThumbDataUrl||rc.photoThumbDataUrl});
                  return;
                }
                merged.push(rc)
              })
              ;(prev as any[]).forEach((lc:any)=>{
                const id=String(lc.id||'');
                if(!seen.has(id)) merged.push(lc);
                else if (lc.createdAt) {
                  const ts=new Date(lc.createdAt).getTime();
                  if (ts && Date.now()-ts<120000 && !seen.has(id)) merged.push(lc);
                }
              })
              return merged as any
            }
            // force initial load: keep local-only recent
            if (Array.isArray(prev) && prev.length>0) {
              const recent=(prev as any[]).filter((lc:any)=>{
                const id=String(lc.id||'')
                if ((notes as any[]).some((rc:any)=> String(rc.id)===id)) return false
                const ts=lc.createdAt?new Date(lc.createdAt).getTime(): lc.ts?new Date(lc.ts).getTime():0
                return ts && (Date.now()-ts)<120000
              })
              return recent.length>0 ? [...notes as any[], ...recent] as any : notes as any
            }
            return notes as any
          })
        }

        // Don't mark Saved here — applying remote data is not a confirmed write of your change
        queueMicrotask(()=>{ applyingRemoteRef.current = false })
      } catch {
        applyingRemoteRef.current = false
      }
    }

    const trySupabaseLoad = async () => {
      if (!hasSupabaseConfig() || !getSupabase()) {
        console.warn('[sync] trySupabaseLoad skip – no config')
        return false
      }
      try {
        console.log('[sync] trySupabaseLoad start v22-queue-clear')
        const remote = await remoteLoad()
        if (!remote) {
          console.warn('[sync] supabase empty / no row yet – will retry')
          return false
        }
        if (cancelled) return true
        console.log('[sync] supabase load ok v23 fresh-fix', { c: remote.chores.length, cal: remote.calendar.length, s: remote.shopping.length, n: remote.notes.length, rev: (remote as any).revision })
        // V23: hydrate FIRST before seeding guards - fresh installs were blocked because hash/mutation were seeded then apply returned early
        applyRemoteSnapshot(remote, { force: true })
        // V23: now mark that we did get remote so UI stops showing Saving/never
        try {
          localStorage.setItem('couple_v1_last_sync', new Date().toISOString())
          localStorage.setItem('couple_v1_had_remote','1')
          localStorage.setItem('couple_v1_last_push_err','')
          const revVal = (remote as any).revision
          if (typeof revVal === 'number') localStorage.setItem('couple_v1_revision', String(revVal))
          // if queue was just empty stuck entry, clear counter now
          const qRaw = localStorage.getItem('couple_v1_queue_count')
          if (qRaw==='1' || qRaw==='0') {
            // we'll let IDB filter handle, but pre-clear LS count
            if (remote.chores.length>0 || remote.calendar.length>0 || remote.shopping.length>0 || remote.notes.length>0) {
              localStorage.setItem('couple_v1_queue_count','0')
            }
          }
        } catch {}
        // clear IDB mutation_queue if it was only empty entries – V23 self-heal
        try {
          const q = await idbGet<any>('mutation_queue')
          if (Array.isArray(q)) {
            const onlyEmpty = q.every((m:any)=>{
              const p = m.payload||{}
              return (Array.isArray(p.chores)?p.chores.length:0)+(Array.isArray(p.calendar)?p.calendar.length:0)+(Array.isArray(p.shopping)?p.shopping.length:0)+(Array.isArray(p.notes)?p.notes.length:0)===0
            })
            if (onlyEmpty) {
              await idbSet('mutation_queue', [])
              mutationQueueRef.current = []
              localStorage.setItem('couple_v1_queue_count','0')
              try {
                const lastConfirmed = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
                if (lastConfirmed) setSyncStatus({ kind:'saved', lastSavedAt: lastConfirmed } as any)
                else setSyncStatus(s=> s as any)
              } catch { setSyncStatus(s=> s as any) }
            }
          }
        } catch {}
        // seed guards AFTER apply so future realtime dedup works, but don't block initial hydrate
        try { 
          if (lastSnapshotHashRef.current === '' || lastSnapshotHashRef.current == null) {
            lastSnapshotHashRef.current = stableHash({ chores: remote.chores, calendar: remote.calendar, shopping: remote.shopping, notes: remote.notes })
          }
        } catch {}
        if (remote.meta && (remote.meta as any).lastMutationId) {
          if (!lastLocalMutationIdRef.current) {
            lastLocalMutationIdRef.current = (remote.meta as any).lastMutationId
          }
        }
        return true
      } catch(e:any){ console.warn('[sync] supabase load fail', e?.message||e); return false }
    }

    const syncFromRemote = async () => {
      if (cancelled) return
      const ok = await trySupabaseLoad()
      // V22: if first pull got 0 total but we expect remote has data, retry once after tiny delay
      if (!ok) {
        setTimeout(async()=> {
          if (cancelled) return
          console.log('[sync] V22 retry pull scheduled')
          await trySupabaseLoad()
        }, 1200)
      } else {
        // even on ok, if local still 0 after apply, force second check to ensure UI hydrated
        const totalLocal = (choresRaw as any[]).length + (calendarRaw as any[]).length + (shoppingRaw as any[]).length + (notesRaw as any[]).length
        if (totalLocal===0) {
          setTimeout(()=> { if (!cancelled) trySupabaseLoad() }, 900)
        }
      }
    }

    syncFromRemote()
    let lastSyncOk = Date.now()
    const focus = () => {
      const stale = Date.now() - lastSyncOk > 5*60*1000
      const disconnected = !(hasSupabaseConfig() && getSupabase())
      if (stale || disconnected) { syncFromRemote() }
    }
    const onVis = () => { if (document.visibilityState==="visible") focus() }
    window.addEventListener("focus", focus)
    document.addEventListener("visibilitychange", onVis)

    let unsubReal: ()=>void = ()=>{}
    try {
      if (hasSupabaseConfig()) {
        unsubReal = subscribeRemote((remote)=>{
          if (cancelled) return
          lastSyncOk = Date.now()
          console.log('[sync] realtime push', (remote as any).updated_at, 'mut', (remote.meta as any)?.lastMutationId?.slice?.(0,8))
          applyRemoteSnapshot(remote, { force: false })
        })
      }
    } catch {}

    return () => { cancelled=true; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", onVis); try{ unsubReal() } catch{} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pushToSheet(_sheetId?: string) {
    try {
      try {
        const total = (choresRaw?.length||0)+(calendarRaw?.length||0)+(shoppingRaw?.length||0)+(notesRaw?.length||0)
        if (total===0) { console.log("[sync] skip push local total 0 - guard"); return }
      } catch {}
      if (hasSupabaseConfig() && getSupabase()) {
        // include lastMutationId in meta for echo guard
        const mut = lastLocalMutationIdRef.current || (typeof crypto!=='undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `mut_${Date.now()}`)
        if (!lastLocalMutationIdRef.current) lastLocalMutationIdRef.current = mut
        enqueueMutation({ chores: choresRaw as any, calendar: calendarRaw as any, shopping: shoppingRaw as any, notes: notesRaw as any, meta:{ syncedAt: new Date().toISOString(), householdId: BUILD_HOUSEHOLD_ID, householdTz: HOUSEHOLD_TZ, lastMutationId: mut } });
      }
    } catch(e){ console.error("[sync] push ex", e) }
  }

  // ── auto-push REPLACED: guarded, refuses to run after remote apply, hash-checked ──
  useEffect(() => {
    // IDB hydration kept only for offline-first case (no supabase)
    (async()=>{
      try {
        if (!hasSupabaseConfig()) {
          const cachedNotes = await idbGet<NoteMemo[]>('couple_v1_notes_memo');
          if (Array.isArray(cachedNotes) && cachedNotes.length>0 && (notesRaw as any[]).length===0) {
            setNotesRaw(cachedNotes as any);
          }
        }
      } catch {}
    })();
    try{
      const raw=localStorage.getItem("couple_v1_auto_push")
      if(raw!==null){ try{ const p=JSON.parse(raw); if(p===false) return; if(p==="off"||p==='"off"') return } catch{ if(raw==="off"||raw.includes("off")) return } }
    } catch{}
    // stop immediately if we're currently applying a remote snapshot — prevents echo
    if (applyingRemoteRef.current) return

    if (!hasSupabaseConfig() || !getSupabase()) return

    const snapshot = { chores: choresRaw as any, calendar: calendarRaw as any, shopping: shoppingRaw as any, notes: notesRaw as any }
    const snapshotHash = stableHash(snapshot)
    if (snapshotHash === lastSnapshotHashRef.current) return

    // we have a real local change -> prepare mutationId and hash before timer (so concurrent remote echo ignored)
    const mutationId = typeof crypto!=='undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `mut_${Date.now()}_${Math.random().toString(36).slice(2,6)}`
    lastLocalMutationIdRef.current = mutationId
    lastSnapshotHashRef.current = snapshotHash

    try { setSyncStatus({ kind:'saving' } as any); } catch{}
    const h=setTimeout(async()=>{
      if (applyingRemoteRef.current) return
      try{
        const rev = (()=>{ try { return Number(localStorage.getItem('couple_v1_revision')||'0') } catch{return 0}})()
        console.log("[sync] guarded push 800ms, rev", rev, "mut", mutationId.slice(0,8));
        const ok = await enqueueMutation({ ...snapshot, meta:{ syncedAt: new Date().toISOString(), householdId: BUILD_HOUSEHOLD_ID, householdTz: HOUSEHOLD_TZ, lastMutationId: mutationId } });
        if (ok) {
          try { window.dispatchEvent(new CustomEvent('couple-sync',{detail:'saved'})) } catch{}
        } else {
          try { if (typeof navigator!=='undefined' && navigator.onLine===false) setSyncStatus({ kind:'offline-queued', queueCount: mutationQueueRef.current.length||1 } as any); else setSyncStatus({ kind:'failed', queueCount: mutationQueueRef.current.length } as any); } catch{}
        }
      } catch(e){ console.warn(e); try{ setSyncStatus({ kind:'failed' } as any) } catch{} }
    }, 800)
    return ()=>clearTimeout(h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choresRaw, calendarRaw, shoppingRaw, notesRaw])
  return (
    <>
      <style>{`
        /* V77 Spotify polish - buttons min-h 44px active 0.96-0.98 180ms cubic-bezier(0.34,1.56,0.64,1) */
        button, [role="button"] {
          min-height: 44px;
          transition: transform 180ms cubic-bezier(0.34,1.56,0.64,1), background-color 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
        }
        button:active, [role="button"]:active {
          transform: scale(0.97);
        }
        /* cards rounded 24-28px border var(--border) shadow var(--shadow-soft) hover lift */
        .card, .card-v11, .continuous-card, .polaroid-v11, .card-flat {
          border-radius: 24px;
          border: 1px solid var(--border);
          background: var(--card-bg);
          box-shadow: var(--shadow-soft);
          transition: transform 180ms cubic-bezier(0.34,1.56,0.64,1), box-shadow 180ms ease;
        }
        .card:hover, .card-v11:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-raised, 0 12px 28px rgba(0,0,0,0.08));
        }
        /* theme-aware lists separators */
        .continuous-card > * + * { border-top: 1px solid var(--border); }
        .list-separated > * + * { border-top: 1px solid var(--border); }
        /* nav bottom-nav-v11 64px portal blur safe area */
        .bottom-nav-v11 {
          height: 64px;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          padding-bottom: env(safe-area-inset-bottom);
          border-top: 1px solid var(--border);
          background: var(--nav-bg);
        }
        /* empty states doodle */
        .empty-illustrated .empty-doodle {
          width: 80px; height: 80px;
          border-radius: 999px;
          background: var(--chip-bg);
          border: 1.5px dashed var(--border);
          display: grid; place-items: center;
          font-size: 28px;
        }
        .empty-illustrated {
          border: 1.5px dashed var(--border);
          background: var(--card-bg);
          border-radius: 24px;
          padding: 28px 20px;
          text-align: center;
        }
        /* ensure var consumption for wash gradients */
        .wash-gradient {
          background: linear-gradient(180deg,var(--wash-top) 0%,var(--wash-mid) 22%,var(--card-bg) 100%);
        }
        /* confetti preserve */
        .confetti-host { pointer-events: none; }
      `}</style>

    <div className={standalone ? "relative w-full max-w-[100vw] w-[100vw] min-h-screen min-h-dvh flex flex-col border-0 rounded-none" : "relative mx-auto w-full max-w-[390px] overflow-hidden rounded-[36px] border-0 flex flex-col"} style={{ background: theme.bg, width: standalone ? "100vw" : undefined, maxWidth: standalone ? "100vw" : undefined } as any}>
      {pushToast && (
        <div className="fixed top-[12px] left-1/2 -translate-x-1/2 z-[80] rounded-full bg-[#0A0A0A] text-white px-4 py-2 text-[12px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.22)] max-w-[90%] truncate">
          <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" />{pushToast.title}: {pushToast.body}</span>
        </div>
      )}
      <div ref={phoneInnerRef} className={standalone ? "relative flex flex-1 min-h-0 flex-col overflow-hidden w-full max-w-[100vw] rounded-none" : "relative flex h-[800px] flex-col overflow-hidden rounded-[28px]"}>
        {/* V38: Transparent header - sits over content, no peach wash */}
        <div className="sticky top-0 z-30 flex flex-col bg-transparent border-0 shadow-none backdrop-blur-[1px] topbar-transparent" style={{ background: "transparent" }}>
          <div className="flex h-[56px] items-center justify-between px-4">
            <h1 className="text-[26px] font-semibold leading-[32px] tracking-[-0.02em] text-[var(--text)]" style={{fontFamily:"Fraunces, Instrument Serif, Georgia, serif"}}>
              {getPageTitle(tab as any)}
            </h1>
            <button
              onClick={() => setShowSwitch(true)}
              aria-label="Open account"
              className="grid h-11 w-11 place-items-center rounded-full border-2 text-[13px] font-bold active:scale-[0.96] transition ring-1 ring-[var(--border)]"
              style={{ background: (PERSONS[currentUser]?.wash||'var(--wash-top)'), borderColor: "var(--border)", color: "var(--text)", minHeight: 44, minWidth: 44 }}
            >
              {(PERSONS[currentUser]?.initial||'?')}
            </button>
          </div>
          {/* Sync truth: only when wrong */}
          {(() => {
            const k = syncStatus?.kind;
            if (!k || k === "saved" || k === "saving") return null;
            let msg: string | null = null;
            let tone = "bg-amber-50 text-amber-900 border-amber-200";
            if (k === "offline-queued" || (k as any) === "offline" || (k as any) === "queued") {
              const n = (syncStatus as any).queueCount ?? 1;
              msg = n > 1 ? `${n} changes waiting` : "Offline";
              tone = "bg-neutral-100 text-neutral-800 border-neutral-200";
            } else if (k === "failed") {
              msg = "Sync failed — tap retry";
              tone = "bg-red-50 text-red-800 border-red-200";
            } else if (k === "updated-elsewhere") {
              msg = "Updated elsewhere";
              tone = "bg-violet-50 text-violet-800 border-violet-200";
            }
            if (!msg) return null;
            return (
              <button onClick={() => drainQueue()} className={`mx-3 mb-2 flex h-[36px] items-center rounded-[12px] border px-3 text-[12px] font-medium leading-[17px] ${tone}`}>
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-70 mr-2" />
                {msg}
              </button>
            );
          })()}
        </div>
        <div className="flex-1 overflow-auto no-scrollbar px-4 pt-3 pb-[112px]" style={{ background: theme.bg }}>
          {(tab as any) === "fridge" && <FridgePage currentUser={currentUser} chores={chores as any} calendar={calendarRaw} shopping={shoppingRaw} notes={notesRaw} setTab={setTab as any} nowMs={nowMs} theme={theme} syncStatus={syncStatus} />}
          {(tab as any) === "calendar" && <CalendarPageV2 events={calendarRaw} chores={choresRaw as any} setEvents={setCalendarRaw as any} currentUser={currentUser} setCurrentUser={setCurrentUser} nowMs={nowMs} onCelebrate={triggerConfetti} />}
          {(tab as any) === "plans" && <CalendarPageV2 events={calendarRaw} chores={choresRaw as any} setEvents={setCalendarRaw as any} currentUser={currentUser} setCurrentUser={setCurrentUser} nowMs={nowMs} onCelebrate={triggerConfetti} />}
          {tab === "chores" && <ChoresPage chores={chores as any} setChores={setChores as any} currentUser={currentUser} setCurrentUser={setCurrentUser} onCelebrate={triggerConfetti} nowMs={nowMs} />}
          {tab === "shopping" && <ShoppingPageFacelift items={shoppingRaw} setItems={setShoppingRaw as any} currentUser={currentUser} onCelebrate={triggerConfetti} nowMs={nowMs} />}
          {tab === "notes" && <NotesMemoPage notes={notesRaw} setNotes={setNotesRaw as any} currentUser={currentUser} nowMs={nowMs} />}
          {tab === "blueprint" && <BlueprintPanel theme={theme} setTheme={setThemeId as any} onConfetti={triggerConfetti} choresRaw={choresRaw} calendarRaw={calendarRaw} shoppingRaw={shoppingRaw} notesRaw={notesRaw} setChoresRaw={setChoresRaw as any} setCalendarRaw={setCalendarRaw as any} setShoppingRaw={setShoppingRaw as any} setNotesRaw={setNotesRaw as any} currentUser={currentUser} />}
        </div>

      </div>

        {/* V38 true fullscreen nav — edge-to-edge 100vw, inset-x-0, no 390 cap */}
        <nav className="absolute inset-x-0 bottom-0 left-0 right-0 z-[60] flex h-[64px] w-full max-w-none items-center justify-around bottom-nav-v11 backdrop-blur-[12px] pb-[env(safe-area-inset-bottom)]" style={{ borderColor: "var(--border)" }}>
          {(TABS as any).map((it: any) => {
            const isPlans = it.k === "plans";
            const currentIsPlans = (tab as any) === "plans" || (tab as any) === "calendar";
            const isActive = isPlans ? currentIsPlans : tab === it.k;
            return (
              <button
                key={it.k}
                onClick={() => { const target = it.k === "plans" ? "plans" : it.k; setTab(target); }}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 active:scale-[0.94] select-none ${isActive ? "nav-item-active" : ""}`}
                style={{ minHeight: 52, height: 52, minWidth: 44 }}
              >
                <span className={`nav-icon grid h-6 w-6 place-items-center transition-colors`} style={{ color: isActive ? "#8B5E3C" : "var(--muted)" }}><TabIcon k={it.k} active={isActive} /></span>
                <span className={`nav-label text-[12px] leading-[17px] tracking-[-0.01em] ${isActive ? "font-semibold" : "font-medium"}`} style={{ color: isActive ? "#8B5E3C" : "var(--muted)" }}>{it.label}</span>
              </button>
            );
          })}
        </nav>

        {showSwitch && (
          <BottomSheet open={showSwitch} onClose={() => { setShowSwitch(false); setPendingSwitchTo(null); setSwitchPin(""); setSwitchPinWrong(false); }} title="Settings">
            {pendingSwitchTo ? (
              <div className="py-4 space-y-3">
                <div className="text-[13px] font-medium">Enter PIN for {(PERSONS[pendingSwitchTo as any]?.name||pendingSwitchTo||"?")}</div>
                <div className="flex gap-2">
                  <input value={switchPin} onChange={e=> { const v=e.target.value.replace(/\D/g,"").slice(0,4); setSwitchPin(v); setSwitchPinWrong(false); }} inputMode="numeric" placeholder="••••" className="flex-1 rounded-[12px] border bg-[var(--card-bg)] px-4 h-[48px] text-center tracking-widest text-[14px]" style={{ borderColor: switchPinWrong ? "#E07A5F" : "var(--border)" }} />
                  <button onClick={async()=>{
                    const who = await verifyPin(switchPin);
                    if (who===pendingSwitchTo) {
                      setCurrentUser(who as PersonKey);
                      try { localStorage.setItem("couple_v1_currentUser", JSON.stringify(who)); } catch{}
                      try { idbSet("couple_v1_currentUser", who); } catch{}
                      setShowSwitch(false); setPendingSwitchTo(null); setSwitchPin("");
                    } else {
                      setSwitchPinWrong(true);
                      setTimeout(()=> setSwitchPin(""), 300);
                    }
                  }} className="rounded-[16px] bg-[#0A0A0A] px-4 h-[48px] text-white text-[13px]">Switch</button>
                </div>
                {switchPinWrong && <div className="text-[11px] text-[#B91C1C]">wrong PIN</div>}
                <button onClick={()=> { setPendingSwitchTo(null); setSwitchPin(""); }} className="text-[11px] underline">cancel</button>
              </div>
            ) : (
              <div className="space-y-1 py-2">
                <div className="px-3 pb-3 flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full border text-[13px] font-bold" style={{ background: (PERSONS[currentUser]?.wash||'var(--wash-top)'), borderColor: "var(--border)" }}>{(PERSONS[currentUser]?.initial||'?')}</span>
                  <div><div className="text-[15px] font-semibold">{(PERSONS[currentUser]?.name||currentUser||'You')}</div><div className="text-[12px] text-[var(--muted)]">Current profile</div></div>
                </div>
                <button onClick={()=> { setShowSwitch(false); setTab("fridge" as any); }} className="flex min-h-[52px] w-full items-center justify-between rounded-[16px] px-4 text-[14px] leading-[20px] hover:bg-[var(--chip-bg)] active:scale-[0.98]"><span>Profile</span><span className="text-[11px] text-[var(--muted)]">{(PERSONS[currentUser]?.name||currentUser||'You')}</span></button>
                <div className="flex min-h-[52px] w-full items-center justify-between rounded-[16px] px-4 text-[14px] leading-[20px]"><span>Sync status</span><span className="text-[11px] text-[var(--muted)]">{(() => {
                  const k = syncStatus?.kind
                  if (k==='failed') return 'Failed — will retry'
                  if (k==='offline-queued' || (syncStatus as any)?.kind==='offline') {
                    const n = (syncStatus as any)?.queueCount||1
                    return `${n} queued — server not reached`
                  }
                  if (k==='saving') return 'Saving to server...'
                  const last = syncStatus?.lastSavedAt
                  if (last) {
                    try {
                      const t = new Date(last).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})
                      return `Saved ${t} server ✓`
                    } catch { return 'Saved server ✓' }
                  }
                  return 'No confirmed save yet'
                })()}</span></div>
                <button onClick={()=> { setShowSwitch(false); setShowBlueprint(true); }} className="flex min-h-[52px] w-full items-center justify-between rounded-[16px] px-4 text-[14px] leading-[20px] hover:bg-[var(--chip-bg)] active:scale-[0.98]"><span>Appearance</span><span className="text-[11px] text-[var(--muted)]">{THEMES.find(t=> t.id===themeId)?.name || "Beige"}</span></button>
                <button onClick={()=> { setShowSwitch(false); setShowBlueprint(true); }} className="flex min-h-[52px] w-full items-center justify-between rounded-[16px] px-4 text-[14px] leading-[20px] hover:bg-[var(--chip-bg)] active:scale-[0.98]">Settings<span className="text-[11px] text-[var(--muted)]">›</span></button>
                <div className="pt-3 border-t mt-2" style={{ borderColor:"var(--border)"}}>
                  <div className="text-[11px] text-[var(--muted)] px-2 mb-2">Switch to</div>
                  <div className="flex items-center gap-3 px-2">
                    {(["aisling","ciaran"] as const).map(k=> (
                      <button key={k} onClick={()=> { if(k===currentUser){ setShowSwitch(false); return;} setPendingSwitchTo(k); }} className={"flex flex-col items-center gap-1.5 active:scale-[0.98] "+(currentUser===k?"opacity-100":"opacity-70")}>
                        <span className={"grid h-11 w-11 place-items-center rounded-full border text-[13px] font-bold "+(currentUser===k?"ring-2 ring-[#0A0A0A] ring-offset-2":"")} style={{ background: PERSONS[k].wash, borderColor: PERSONS[k].accent }}>{PERSONS[k].initial}</span>
                        <span className="text-[11px]">{PERSONS[k].name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </BottomSheet>
        )}

        {showBlueprint && (
          <BottomSheet open={showBlueprint} onClose={() => setShowBlueprint(false)} title="Settings + Blueprint">
            <BlueprintPanel theme={theme} setTheme={setThemeId} onConfetti={triggerConfetti} choresRaw={choresRaw} calendarRaw={calendarRaw} shoppingRaw={shoppingRaw} notesRaw={notesRaw} setChoresRaw={setChoresRaw as any} setCalendarRaw={setCalendarRaw as any} setShoppingRaw={setShoppingRaw as any} setNotesRaw={setNotesRaw as any} currentUser={currentUser} />
          </BottomSheet>
        )}
    </div>
    </>
  );
}
export function App() {
  // --- Friends beta onboarding gate ---
  const [onboardingDone, setOnboardingDone] = useState<boolean>(()=> !shouldShowOnboarding());
  // allow ?code=XXXX to auto-trigger join via onboarding even if legacy data? If code param present and showOnboarding would be hidden for legacy, still respect explicit code linking
  const [urlInviteCode] = useState<string>(()=>{ try { const sp = new URLSearchParams(location.search); const c = sp.get("code"); if (c && c.length>=4) return c.toUpperCase(); } catch {} return ""; });
  useEffect(()=>{
    if (urlInviteCode && onboardingDone) {
      // if we have a code param and already have household, still allow user to switch? For safety only auto-show onboarding if fresh
      // if code param present and no household id set, force onboarding open to join
      try {
        const hid = getStoredHouseholdId();
        if (!hid) setOnboardingDone(false);
      } catch {}
    }
  }, [urlInviteCode, onboardingDone]);
  if (!onboardingDone) {
    return (
      <div className="min-h-dvh w-full max-w-[100vw] flex items-center justify-center bg-[var(--bg)]">
        <OnboardingFlow onComplete={(hid: string)=>{ setOnboardingDone(true); try { applyCustomPersonNames(); } catch {}; }} />
      </div>
    );
  }

  const standalone = useIsStandalone();
  const [sessionUser, setSessionUser] = useState<PersonKey | null>(null);
  const [persistedUserRaw, setPersistedUserRaw] = useLocalState<PersonKey | null>("couple_v1_currentUser", null);
  const [themeId, setThemeId] = useLocalState<string>("couple_v1_theme", "beige");
  const [nowMs, setNowMs] = useState(() => Date.now());
  // helper — remember opt-in (new default FALSE — matches "fingerprint every time or PIN")
  const isRememberOptedIn = () => {
    try {
      const r = localStorage.getItem("couple_v1_remember_user");
      return (r==="1" || r==="\"1\"" || r==="true");
    } catch { return false; }
  };
  // standalone — if remember OFF, always clear auto-login so lock shows every open
  useEffect(() => {
    if (!standalone) return;
    try {
      const remember = localStorage.getItem("couple_v1_remember_user");
      const ephemeral = (()=>{ try{ return sessionStorage.getItem("couple_v1_ephemeral_session")==="1"; }catch{return false} })();
      const stayLoggedIn = (remember==="1" || remember==="\"1\"" || remember==="true");
      const shouldClear = !stayLoggedIn || ephemeral;
      if (!shouldClear) return; // user explicitly wants stay logged in — allow auto-login
      try { localStorage.removeItem("couple_v1_currentUser"); } catch {}
      try {
        idbSet("couple_v1_currentUser", null as any);
        openIdb().then(db=>{ try{ const tx=db!.transaction("kv","readwrite"); tx.objectStore("kv").delete("couple_v1_currentUser"); }catch{} });
      } catch {}
    } catch {}
  }, [standalone]);
  // hydrate standalone session from persisted if remember is on — fixes "remember does nothing in PWA"
  useEffect(()=>{
    if (!standalone) return;
    if (sessionUser) return;
    if (!isRememberOptedIn()) return;
    if (persistedUserRaw && (persistedUserRaw==="aisling" || persistedUserRaw==="ciaran" || (persistedUserRaw as any)==="aisling" || (persistedUserRaw as any)==="ciaran")) {
      setSessionUser(persistedUserRaw as any);
    }
  }, [standalone, persistedUserRaw, sessionUser]);
  const currentUserRaw = standalone ? (sessionUser ?? (isRememberOptedIn() ? persistedUserRaw : null)) : persistedUserRaw;
  const setCurrentUserRaw = (v: any) => {
    if (standalone) {
      const resolve = typeof v === 'function' ? v(sessionUser ?? persistedUserRaw) : v;
      setSessionUser(resolve as any);
      // also persist for reload if remember is on
      try {
        if (isRememberOptedIn()) {
          (setPersistedUserRaw as any)(resolve);
        }
      } catch { try { (setPersistedUserRaw as any)(resolve); } catch {} }
    } else {
      (setPersistedUserRaw as any)(v);
    }
  };
  // migrate old Alex/Sam currentUser? if stored as string "Alex" etc
  const currentUser: PersonKey | null = (() => {
    if (!currentUserRaw) return null;
    const v = currentUserRaw as any;
    if (v === "aisling" || v === "ciaran") return v;
    if (typeof v === "string") {
      const low = v.toLowerCase();
      if (low.includes("ais")) return "aisling";
      if (low.includes("cia") || low.includes("ciaran")) return "ciaran";
      if (low === "a" || low === "alex") return "aisling";
      if (low === "b" || low === "sam") return "ciaran";
    }
    return null;
  })();
  const setCurrentUser = (k: PersonKey) => setCurrentUserRaw(k);
  if (!currentUser) {
    if (standalone) {
      return (
        <div className="min-h-dvh w-full max-w-[100vw] w-[100vw] bg-[var(--bg)] font-body text-[var(--text)] flex flex-col">
          <div className="w-full max-w-[100vw] w-[100vw] min-h-dvh relative flex flex-col">
            <WhoScreen onSelect={k => { setCurrentUserRaw(k); }} />
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-[var(--bg)] p-0 flex flex-col items-center gap-0 font-body text-[var(--text)]">
        <div className="w-full max-w-[390px] relative min-h-[640px]"><WhoScreen onSelect={k => { setCurrentUserRaw(k); }} /></div>
      </div>
    );
  }
  if (standalone) {
    return (
      <div className="min-h-dvh w-full max-w-[100vw] w-[100vw] bg-[var(--bg)] font-body text-[var(--text)] flex flex-col">
        <div className="w-full max-w-[100vw] w-[100vw] min-h-dvh relative flex flex-col">
          <V1AppShell currentUser={currentUser} setCurrentUser={setCurrentUser} themeId={themeId} setThemeId={setThemeId} nowMs={nowMs} setNowMs={setNowMs} />
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-[var(--bg)] p-0 flex flex-col items-center gap-0 font-body text-[var(--text)]">
      <div className="w-full max-w-[390px]"><V1AppShell currentUser={currentUser} setCurrentUser={setCurrentUser} themeId={themeId} setThemeId={setThemeId} nowMs={nowMs} setNowMs={setNowMs} /></div>
    </div>
  );
}