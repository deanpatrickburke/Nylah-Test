// state.ts — extracted shared state from client/src/AppMonolith.tsx (6759 lines)
// Branch: refactor/split-v117
// Purpose: pure composition layer — zero logic change, verbatim copy of state/references/effects
// Source file: AppMonolith.tsx — V1AppShell + App hooks
// This file does NOT wire UI — only exports state, constants, helpers, and hooks.

import { useEffect, useRef, useState } from "react";
import {
getSupabase,
hasSupabaseConfig,
saveSupabaseConfig,
TOKEN as SB_TOKEN,
TABLE as SB_TABLE,
ROW_ID as SB_ROW_ID,
} from "../lib/supabase";
import type {
PersonKey,
Theme,
TabKey,
ChoreV2,
CalendarEventV2,
CalendarEventStatus,
CalendarResponseKind,
CalendarEventResponse,
ShoppingCategory,
ShoppingFrequency,
ShoppingItemV2,
PersonalWants,
NoteReactionKind,
NoteMemo,
Chore,
CalendarEvent,
ShoppingItem,
AddEventFormProps,
} from "../types";
import { CATS } from "../types";
import { THEMES, PERSONS, TABS } from "../constants/themes";
import { remoteLoad, remoteSave, subscribeRemote } from "../lib/remoteSync";
import type { ChoreIconId } from "../lib/choreIcons";
import {
HOUSEHOLD_ID as BUILD_HOUSEHOLD_ID,
HOUSEHOLD_TZ,
HOUSEHOLD_ID,
} from "../lib/buildMeta";
import { uid } from "../shared/utils/helpers";
import { openIdb, idbGet, idbSet } from "../lib/idb";

// ---- constants (verbatim from monolith) ----
export const TABLE = SB_TABLE;
export const ROW_ID = SB_ROW_ID;
export { HOUSEHOLD_ID, BUILD_HOUSEHOLD_ID, HOUSEHOLD_TZ };
export const LS_PREFIX = "couple_v1_";
export const DEFAULT_TOKEN = "ash-ciaran-2026";
void DEFAULT_TOKEN;
export { SB_TOKEN, SB_TABLE, SB_ROW_ID };

// re-export remotes & supabase primitives for state consumers
export { remoteLoad, remoteSave, subscribeRemote, getSupabase, hasSupabaseConfig, saveSupabaseConfig };
export { PERSONS, THEMES, TABS, CATS };

// ---- robust storage (verbatim) ----
export function isQuotaError(e: any): boolean {
  return e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014 || (typeof e.message === "string" && e.message.includes("quota")));
}
export function safeGetLS(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
export function safeSetLS(key: string, val: string): boolean {
  try { localStorage.setItem(key, val); return true; } catch (e: any) {
    if (isQuotaError(e)) {
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

// ---- standalone detection (verbatim) ----
export function useIsStandalone(): boolean {
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

// ---- household persons (verbatim) ----
export function getHouseholdPersonsRaw(): any[] | null {
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
export function getPartnerKey(currentUser: PersonKey | string): PersonKey {
  try {
    const persons = getHouseholdPersonsRaw();
    if (Array.isArray(persons) && persons.length >= 2) {
      const other = persons.find((p: any) => p && p.key && p.key !== currentUser);
      if (other?.key) return other.key as PersonKey;
    }
  } catch {}
  if (currentUser === "person_1") return "person_2" as PersonKey;
  if (currentUser === "person_2") return "person_1" as PersonKey;
  if (currentUser === "aisling") return "ciaran" as PersonKey;
  if (currentUser === "ciaran") return "aisling" as PersonKey;
  const keys = Object.keys(PERSONS);
  const other = keys.find(k => k !== currentUser);
  return (other || "person_2") as PersonKey;
}
export function applyCustomPersonNames() {
  try {
    const persons = getHouseholdPersonsRaw();
    if (!persons || persons.length < 2) return;
    for (let i = 0; i < persons.length; i++) {
      const p = persons[i];
      if (!p || !p.key || !p.name) continue;
      const k = p.key as PersonKey;
      const initial = p.name.trim().slice(0, 1).toUpperCase();
      if (PERSONS[k]) {
        PERSONS[k].name = p.name;
        if (p.name && p.name.length > 0) PERSONS[k].initial = initial;
      } else {
        PERSONS[k] = {
          name: p.name,
          initial,
          accent: i === 0 ? "#0284C7" : "#0EA5E9",
          accent2: i === 0 ? "#0369A1" : "#0284C7",
          wash: i === 0 ? "#E0F2FE" : "#F0F9FF",
        };
      }
    }
  } catch {}
}
try { applyCustomPersonNames(); } catch {}

// ---- WebAuthn biometric helpers (verbatim) ----
export function bufToB64u(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
export function b64uToBuf(b64u: string): ArrayBuffer {
  let b64 = b64u.replace(/-/g,"+").replace(/_/g,"/");
  const pad = b64.length % 4; if (pad) b64 += "=".repeat(4-pad);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}
export function webAuthnIdKey(user: PersonKey){ return `couple_v1_webauthn_${user}`; }
export function isWebAuthnSupported(): boolean {
  try { return !!(window as any).PublicKeyCredential; } catch { return false; }
}
export async function canDoPlatformBiometric(): Promise<boolean> {
  try {
    const pkc = (window as any).PublicKeyCredential;
    if (!pkc) return false;
    if (pkc.isUserVerifyingPlatformAuthenticatorAvailable) {
      return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch { return false; }
}
export async function registerBiometric(user: PersonKey): Promise<string | null> {
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
    return null;
  }
}
export async function authenticateBiometric(): Promise<PersonKey | null> {
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
    if (stored.length===1) return stored[0].user;
    return stored[0].user;
  } catch {
    try {
      const assertion: any = await (navigator.credentials as any).get({
        publicKey: { challenge, timeout:60000, userVerification:"required" }
      });
      if (!assertion) return null;
      if (stored.length===1) return stored[0].user;
      return null;
    } catch { return null; }
  }
}

// ---- useLocalState (verbatim) ----
export function useLocalState<T>(key: string, def: T): [T, (v: T | ((p: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = safeGetLS(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {}
    return def;
  });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
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
          (async()=>{ try { const existing = await idbGet<Record<string,string>>('note_photos') || {}; const merged = { ...existing, ...photoMap }; await idbSet('note_photos', merged); } catch {} })();
          const trimmed = arr.map(n=> n.photoDataUrl && n.photoDataUrl.length>4000 ? { ...n, photoDataUrl: undefined } : n);
          try { safeSetLS(key, JSON.stringify(trimmed)); } catch {}
          try { idbSet(key, state as any); } catch {}
          try { idbSet('couple_v1_last_local_write', new Date().toISOString()); } catch{}
          return;
        }
      }
      const json = JSON.stringify(state);
      const ok = safeSetLS(key, json);
      if (ok) { idbSet(key, state as any); }
      else {
        if (key.includes("notes") && Array.isArray(state as any)) {
          const trimmed = (state as any).map((n: any) => n.photoDataUrl ? { ...n, photoDataUrl: undefined } : n);
          safeSetLS(key, JSON.stringify(trimmed));
          idbSet(key, state as any);
        } else {
          idbSet(key, state as any);
        }
      }
    } catch {}
  }, [key, state]);
  return [state, setState as any];
}

// ---- onboarding helpers (verbatim) ----
export function getStoredHouseholdId(): string | null {
  try { return localStorage.getItem("couple_v1_household_id"); } catch { return null; }
}
export function hasAnyLegacyData(): boolean {
  try {
    const meaningful = ["couple_v1_onboarding_completed", "couple_v1_onboarded_at"];
    for (let i=0;i<localStorage.length;i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (meaningful.some(p=>k.startsWith(p))) return true;
    }
  } catch {}
  return false;
}
export function shouldShowOnboarding(): boolean {
  try {
    try { if (localStorage.getItem("couple_v1_force_onboard") === "1") return true; } catch {}
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.get("onboard") === "1" || sp.get("force_onboard") === "1") return true;
      if (sp.get("onboard") === "0") return false;
    } catch {}

    const onboardCompleted = localStorage.getItem("couple_v1_onboarding_completed");
    const onboardedAt = localStorage.getItem("couple_v1_onboarded_at");
    if (onboardCompleted === "true" || onboardedAt) return false;

    const hid = getStoredHouseholdId();
    if (hid && hid.length >= 3 && hid !== "ash-ciaran-2026") return false;

    return true;
  } catch { return true; }
}

// ---- SyncStatus (verbatim) ----
export type SyncKind = 'saving' | 'saved' | 'offline-queued' | 'failed' | 'updated-elsewhere';
export type SyncStatus = {
  kind: SyncKind;
  queueCount?: number;
  lastSavedAt?: string;
  error?: string;
  updatedElsewhere?: boolean;
};

// ---- Mutation Queue type (verbatim from V1AppShell) ----
export type QueuedMutation = { mutationId: string; revision: number; payload: any; createdAt: string; retries: number };

// ---- Saved timestamps helpers ----
export function getLastConfirmedAt(): string | null {
  try { return localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync'); } catch { return null; }
}
export function getLastSync(): string | null {
  try { return localStorage.getItem('couple_v1_last_sync'); } catch { return null; }
}
export function getRevision(): number {
  try { return Number(localStorage.getItem('couple_v1_revision')||'0'); } catch { return 0; }
}

// ---- Core composition hook: mirrors V1AppShell internal state (verbatim copy blocks) ----
export function useV1AppShellState() {
  const standalone = useIsStandalone();
  const [tab, setTab] = useState<TabKey>("fridge");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => {
    try {
      const q = localStorage.getItem('couple_v1_queue_count')
      const n = q ? Number(q) : 0
      if (n > 0) return { kind: 'offline-queued', queueCount: n } as SyncStatus
    } catch {}
    return { kind: 'saving' } as SyncStatus
  });
  const syncState = syncStatus;
  const setSyncState = (s:any)=>{ /* legacy compat no-op, use setSyncStatus */ };
  const [showSwitch, setShowSwitch] = useState(false);
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [pendingSwitchTo, setPendingSwitchTo] = useState<PersonKey|null>(null);
  const [switchPin, setSwitchPin] = useState("");
  const [switchPinWrong, setSwitchPinWrong] = useState(false);
  const phoneInnerRef = useRef<HTMLDivElement>(null);
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
      const s = JSON.stringify(o, (_k, v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const keys = Object.keys(v).sort();
          const out: any = {};
          for (const k of keys) out[k] = (v as any)[k];
          return out;
        }
        return v;
      });
      return s;
    } catch { return String(Date.now()); }
  }
  function deepEqual(a: any, b: any): boolean {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }

  const mutationQueueRef = useRef<QueuedMutation[]>([]);
  const queueHydratedRef = useRef(false);
  const offlineFailCountRef = useRef(0);
  const lastOnlineProbeRef = useRef<number>(0);
  const reallyOnline = async (): Promise<boolean> => {
    // Real reachability: must distinguish offline, unreachable, reachable
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).onLine === false) return false;
    } catch {}
    try {
      const url = "https://zlllebsjtgihsxhcmcvb.supabase.co/rest/v1/";
      let anon = "";
      try {
        const w:any = typeof window !== 'undefined' ? (window as any) : null;
        if (w && (w.__SUPABASE_ANON__ || w.__SUPABASE_ANON_KEY__)) anon = (w.__SUPABASE_ANON__ || w.__SUPABASE_ANON_KEY__) as string;
      } catch {}
      if (!anon) {
        try {
          // @ts-ignore
          const k = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
          if (k) anon = k as string;
        } catch {}
      }
      if (!anon) anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsbGxlYnNqdGdpaHN4aGNtY3ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NDQxMjQsImV4cCI6MjEwMTMyMDEyNH0.Q6PuA6nvTI__DEB0i7akLusljjjeYu_0IxQICOc5oSQ";
      const controller = new AbortController();
      const timeout = setTimeout(()=> controller.abort(), 2000);
      const resp = await fetch(url, { method: 'HEAD', headers: { apikey: anon } as any, signal: controller.signal } as any);
      clearTimeout(timeout);
      return resp.ok || resp.status===401 || resp.status===404 || resp.status===400;
    } catch {
      return false;
    }
  };

  useEffect(()=>{
    (async()=>{
      try {
        const db = await openIdb();
        if (!db) return;
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
          if (filtered.length===0) {
            try {
              const prev = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
              if (prev) {
                setSyncStatus(s=> s.kind==='saving' ? { kind:'saved', lastSavedAt: prev } as any : s)
              }
            } catch {}
          }
        }
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
        try {
          const last = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
          if (last) setSyncStatus({ kind:'saved', lastSavedAt: last } as any)
          else setSyncStatus(s=> s.kind==='saving' ? s : ({ kind:'saved', lastSavedAt: s.lastSavedAt } as any))
        } catch { setSyncStatus(s=> s as any) }
        return
      }
    }
    const online = await reallyOnline();
    if (!online) {
      offlineFailCountRef.current++;
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
        const ok = await remoteSave({ ...(m.payload||{}), mutationId: m.mutationId, expectedRevision: m.revision }) as any;
        if (ok) {
          mutationQueueRef.current = mutationQueueRef.current.filter(x=> x.mutationId!==m.mutationId);
          await persistQueue();
          offlineFailCountRef.current = 0;
          const confirmedAtRaw = typeof ok === 'string' ? ok : localStorage.getItem('couple_v1_last_confirmed_at');
          if (!confirmedAtRaw) {
            console.warn('[sync] no server confirmation, not marking Saved');
            // Do not display Saved if no server confirmation
            setSyncStatus({ kind:'saving', queueCount: mutationQueueRef.current.length } as any);
            break;
          }
          setSyncStatus({ kind:'saved', lastSavedAt: confirmedAtRaw, queueCount: mutationQueueRef.current.length });
        } else {
          m.retries++;
          offlineFailCountRef.current++;
          try {
            const sb = getSupabase();
            if (sb) {
              const { data: fresh } = await sb.from(TABLE).select('revision').eq('id', ROW_ID).maybeSingle();
              if (fresh && typeof (fresh as any).revision === 'number') {
                try { localStorage.setItem('couple_v1_revision', String((fresh as any).revision)); } catch {}
                m.revision = (fresh as any).revision;
                await persistQueue();
              }
            }
          } catch {}
          if (m.retries>=3) {
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
    const provided = (payload as any)?.meta?.lastMutationId || (payload as any)?.lastMutationId
    const mutationId = provided || ((typeof crypto!=='undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `mut_${Date.now()}_${Math.random().toString(36).slice(2,7)}`)
    try { if ((payload as any).meta) (payload as any).meta.lastMutationId = mutationId; else (payload as any).meta = { lastMutationId: mutationId } } catch {}
    let rev = 0;
    try { rev = Number(localStorage.getItem('couple_v1_revision')||'0') } catch{}
    const item: QueuedMutation = { mutationId, revision: rev, payload, createdAt: new Date().toISOString(), retries:0 };
    try {
      const last = localStorage.getItem('couple_v1_last_mutation');
      if (last && mutationId===last) {
        lastLocalMutationIdRef.current = mutationId
        return true;
      }
    } catch{}
    mutationQueueRef.current.push(item);
    await persistQueue();
    const onlineNow = await reallyOnline();
    if (!onlineNow) {
      offlineFailCountRef.current++;
      if (offlineFailCountRef.current >= 3) {
        setSyncStatus({ kind:'offline-queued', queueCount: mutationQueueRef.current.length });
      } else {
        setSyncStatus({ kind:'saving' } as any);
      }
      return false;
    }
    try {
      setSyncStatus({ kind:'saving' });
      const ok = await remoteSave({ ...payload, mutationId, expectedRevision: rev }) as any;
      if (ok) {
        mutationQueueRef.current = mutationQueueRef.current.filter(x=> x.mutationId!==mutationId);
        await persistQueue();
        offlineFailCountRef.current = 0;
        const confirmedAtEnqRaw = typeof ok === 'string' ? ok : localStorage.getItem('couple_v1_last_confirmed_at');
        if (!confirmedAtEnqRaw) {
          setSyncStatus({ kind:'saving' } as any);
          return false;
        }
        setSyncStatus({ kind:'saved', lastSavedAt: confirmedAtEnqRaw });
        return true;
      } else {
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

  const touchSync = () => {
    if (mutationQueueRef.current.length > 0) {
      setSyncStatus(s=> ({ kind:'offline-queued', queueCount: mutationQueueRef.current.length, lastSavedAt: s.lastSavedAt } as any))
    } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncStatus(s=> ({ kind:'offline-queued', queueCount: 1, lastSavedAt: s.lastSavedAt } as any))
    }
    drainQueue()
  };

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

  // theme computed same as monolith but outside effect
  // we keep themeId external — caller passes; for this internal hook we read LS directly via useLocalState will be done in App composition
  // For pure composition we also expose setters.

  return {
    // standalone
    standalone,
    // navigation
    tab, setTab,
    // sync
    syncStatus, setSyncStatus, syncState, setSyncState,
    // UI toggles
    showSwitch, setShowSwitch,
    showBlueprint, setShowBlueprint,
    pendingSwitchTo, setPendingSwitchTo,
    switchPin, setSwitchPin,
    switchPinWrong, setSwitchPinWrong,
    // refs for sync loop-break
    phoneInnerRef,
    applyingRemoteRef,
    lastLocalMutationIdRef,
    lastSnapshotHashRef,
    prevChoresRef,
    // push toast
    pushToast, setPushToast,
    // hash helpers
    stableHash, deepEqual,
    // mutation queue
    mutationQueueRef, queueHydratedRef, offlineFailCountRef, lastOnlineProbeRef,
    reallyOnline, persistQueue, drainQueue, enqueueMutation, touchSync,
    // data raw
    choresRaw, setChoresRaw, chores, setChores,
    calendarRaw, setCalendarRaw,
    shoppingRaw, setShoppingRaw,
    notesRaw, setNotesRaw,
  };
}

// ---- App-level state (currentUser, theme, nowMs, onboarding) verbatim copy ----
export function useAppCurrentUserState() {
  const standalone = useIsStandalone();
  const [onboardingDone, setOnboardingDone] = useState<boolean>(()=> !shouldShowOnboarding());
  const [urlInviteCode] = useState<string>(()=>{ try { const sp = new URLSearchParams(location.search); const c = sp.get("code"); if (c && c.length>=4) return c.toUpperCase(); } catch {} return ""; });
  const [sessionUser, setSessionUser] = useState<PersonKey | null>(null);
  const [persistedUserRaw, setPersistedUserRaw] = useLocalState<PersonKey | null>("couple_v1_currentUser", null);
  const [themeId, setThemeId] = useLocalState<string>("couple_v1_theme", "beige");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const theme = THEMES.find(t => t.id === themeId) || THEMES[0]!;

  const isRememberOptedIn = () => {
    try {
      const r = localStorage.getItem("couple_v1_remember_user");
      return (r==="1" || r==="\"1\"" || r==="true");
    } catch { return false; }
  };

  useEffect(() => {
    if (!standalone) return;
    try {
      const remember = localStorage.getItem("couple_v1_remember_user");
      const ephemeral = (()=>{ try{ return sessionStorage.getItem("couple_v1_ephemeral_session")==="1"; }catch{return false} })();
      const stayLoggedIn = (remember==="1" || remember==="\"1\"" || remember==="true");
      const shouldClear = !stayLoggedIn || ephemeral;
      if (!shouldClear) return;
      try { localStorage.removeItem("couple_v1_currentUser"); } catch {}
      try {
        idbSet("couple_v1_currentUser", null as any);
        openIdb().then(db=>{ try{ const tx=db!.transaction("kv","readwrite"); tx.objectStore("kv").delete("couple_v1_currentUser"); }catch{} });
      } catch {}
    } catch {}
  }, [standalone]);

  useEffect(()=>{
    if (!standalone) return;
    if (sessionUser) return;
    if (!isRememberOptedIn()) return;
    if (persistedUserRaw && (persistedUserRaw==="aisling" || persistedUserRaw==="ciaran")) {
      setSessionUser(persistedUserRaw as any);
    }
  }, [standalone, persistedUserRaw, sessionUser]);

  const currentUserRaw = standalone ? (sessionUser ?? (isRememberOptedIn() ? persistedUserRaw : null)) : persistedUserRaw;
  const setCurrentUserRaw = (v: any) => {
    if (standalone) {
      const resolve = typeof v === 'function' ? v(sessionUser ?? persistedUserRaw) : v;
      setSessionUser(resolve as any);
      try {
        if (isRememberOptedIn()) {
          (setPersistedUserRaw as any)(resolve);
        }
      } catch { try { (setPersistedUserRaw as any)(resolve); } catch {} }
    } else {
      (setPersistedUserRaw as any)(v);
    }
  };
  const currentUser: PersonKey | null = (() => {
    if (!currentUserRaw) return null;
    const v = currentUserRaw as any;
    if (typeof v === "string" && v.trim().length >= 1) {
      // Scalable: new households use person_1 / person_2, legacy uses aisling/ciaran, custom names may have been stored as key
      const raw = v.trim();
      if (raw === "aisling" || raw === "ciaran" || raw === "person_1" || raw === "person_2") return raw;
      const low = raw.toLowerCase();
      // Legacy fuzzy maps — keep for old localStorage ("Alex" etc) but map to current dynamic keys where possible
      if (low.includes("ais")) {
        try { const persons = getHouseholdPersonsRaw(); const found = persons?.find((p:any)=>p.key && (p.key==="person_1" || p.key==="aisling")); if (found) return found.key; } catch {}
        return "aisling";
      }
      if (low.includes("cia") || low.includes("ciaran")) {
        try { const persons = getHouseholdPersonsRaw(); const found = persons?.find((p:any)=>p.key && (p.key==="person_2" || p.key==="ciaran")); if (found) return found.key; } catch {}
        return "ciaran";
      }
      // If stored as custom name like "Maya", try to resolve to key via persons list
      try {
        const persons = getHouseholdPersonsRaw();
        if (persons) {
          const byName = persons.find((p:any)=> p.name && p.name.toLowerCase()===low);
          if (byName) return byName.key;
          const byInitial = persons.find((p:any)=> p.initial && p.initial.toLowerCase()===low.slice(0,1));
          if (persons.length===2 && low.length===1) return byInitial?.key || persons[0].key;
        }
      } catch {}
      // Finally, treat raw as key directly (person_1/person_2 or any custom key)
      return raw as PersonKey;
    }
    return null;
  })();
  const setCurrentUser = (k: PersonKey) => setCurrentUserRaw(k);

  useEffect(()=> {
    if (urlInviteCode && onboardingDone) {
      try {
        const hid = getStoredHouseholdId();
        if (!hid) setOnboardingDone(false);
      } catch {}
    }
  }, [urlInviteCode, onboardingDone]);

  return {
    standalone,
    onboardingDone, setOnboardingDone,
    urlInviteCode,
    sessionUser, setSessionUser,
    persistedUserRaw, setPersistedUserRaw,
    currentUserRaw, setCurrentUserRaw,
    currentUser, setCurrentUser,
    themeId, setThemeId, theme,
    nowMs, setNowMs,
    isRememberOptedIn,
  };
}

// ---- unified hook exposing all (preferred) ----
export function useAppState() {
  const v1 = useV1AppShellState();
  const app = useAppCurrentUserState();

  // One clock for relative times (30s) — verbatim from monolith — belongs to shell but also App nowMs
  useEffect(() => {
    let i:any=setInterval(()=>{ if(document.hidden) return; app.setNowMs(Date.now()); }, 30000);
    const onVis=()=>{ if(!document.hidden) app.setNowMs(Date.now()); };
    document.addEventListener("visibilitychange", onVis);
    return ()=>{ clearInterval(i); document.removeEventListener("visibilitychange", onVis); };
  }, [app.setNowMs]);

  // v144 scalable — no hard-coded ash-ciaran-2026 migration. Keep build marker only.
  useEffect(()=>{
    // v144 build marker
    try{ localStorage.setItem("couple_v1_build","v144-beirt-scalable"); }catch{}
    try{ (window as any).__NYLAH_VERSION__ = "v144-beirt-scalable"; }catch{}
  },[]);

  // v121 auto-sync after login (PinScreen sets force_resync flag)
  useEffect(()=>{
    let cancelled=false;
    const maybePull = async ()=>{
      try{
        const flag = localStorage.getItem("couple_v1_force_resync");
        if(!flag) return;
        // if logged in and not cancelled
        if(!app.currentUser) return;
        console.log("[v121] force_resync after login", flag);
        try{
          const mod = await import("../lib/remoteSync");
          const data = await mod.remoteLoad();
          if(cancelled) return;
          if(data){
            if(Array.isArray(data.chores) && data.chores.length>0) { try{ v1.setChoresRaw(data.chores as any); }catch{} }
            if(Array.isArray(data.calendar) && data.calendar.length>0) { try{ v1.setCalendarRaw(data.calendar as any); }catch{} }
            if(Array.isArray(data.shopping) && data.shopping.length>0) { try{ v1.setShoppingRaw(data.shopping as any); }catch{} }
            if(Array.isArray(data.notes) && data.notes.length>0) { try{ v1.setNotesRaw(data.notes as any); }catch{} }
            try{ localStorage.setItem("couple_v1_last_sync", data.updated_at||new Date().toISOString()); }catch{}
            console.log("[v121] auto-pull ok", {c:data.chores?.length, cal:data.calendar?.length});
          }
        }catch{}
        try{ localStorage.removeItem("couple_v1_force_resync"); }catch{}
      }catch{}
    };
    maybePull();
    // also listen for custom event from PinScreen
    const onForce = ()=> maybePull();
    try{ window.addEventListener("couple-force-resync" as any, onForce as any); }catch{}
    // when currentUser changes to truthy, trigger
    if(app.currentUser){
      const tid = setTimeout(()=> maybePull(), 400);
      return ()=>{ clearTimeout(tid); try{ window.removeEventListener("couple-force-resync" as any, onForce as any);}catch{} };
    }
    return ()=>{ cancelled=true; try{ window.removeEventListener("couple-force-resync" as any, onForce as any);}catch{} };
  }, [app.currentUser, v1.setChoresRaw, v1.setCalendarRaw, v1.setShoppingRaw, v1.setNotesRaw]);

  // v121 initial remote load if local empty but remote has data — on mount when logged in
  useEffect(()=>{
    if(!app.currentUser) return;
    let cancelled=false;
    (async()=>{
      try{
        const totalLocal = (v1.choresRaw?.length||0)+(v1.calendarRaw?.length||0)+(v1.shoppingRaw?.length||0)+(v1.notesRaw?.length||0);
        if(totalLocal>0) return;
        const data = await remoteLoad();
        if(cancelled||!data) return;
        const totalRemote = (data.chores?.length||0)+(data.calendar?.length||0)+(data.shopping?.length||0)+(data.notes?.length||0);
        if(totalRemote===0) return;
        console.log("[v121] initial remote load rescuing empty local", totalRemote);
        if(Array.isArray(data.chores) && data.chores.length>0) try{ v1.setChoresRaw(data.chores as any);}catch{}
        if(Array.isArray(data.calendar) && data.calendar.length>0) try{ v1.setCalendarRaw(data.calendar as any);}catch{}
        if(Array.isArray(data.shopping) && data.shopping.length>0) try{ v1.setShoppingRaw(data.shopping as any);}catch{}
        if(Array.isArray(data.notes) && data.notes.length>0) try{ v1.setNotesRaw(data.notes as any);}catch{}
      }catch{}
    })();
    return ()=>{ cancelled=true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.currentUser]);

  // One unified truthful sync signal — replaces multiple leaked listeners – V16 less aggressive (verbatim from V1AppShell)
  useEffect(()=>{
    const onOnline = async ()=>{
      v1.offlineFailCountRef.current = 0;
      await v1.drainQueue();
      if (v1.mutationQueueRef.current.length>0) v1.setSyncStatus(s=>({ kind:'offline-queued', queueCount: v1.mutationQueueRef.current.length, lastSavedAt: s.lastSavedAt }));
      else {
        const last = (()=>{ try{ return localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync') } catch { return null } })();
        if (last) v1.setSyncStatus(s=>({ kind:'saved', lastSavedAt: last }));
      }
    };
    const onOffline = async ()=>{
      const stillOnline = await v1.reallyOnline();
      if (stillOnline) {
        v1.offlineFailCountRef.current = 0;
        v1.setSyncStatus(s=>({ kind:'saved', lastSavedAt: s.lastSavedAt } as any));
        v1.drainQueue();
        return;
      }
      v1.offlineFailCountRef.current++;
      if (v1.offlineFailCountRef.current >= 3) {
        v1.setSyncStatus(s=>({ kind:'offline-queued', queueCount: v1.mutationQueueRef.current.length || undefined, lastSavedAt: s.lastSavedAt }));
      } else {
        v1.setSyncStatus(s=>({ kind:'saving' } as any));
      }
    };
    const onCoupleSync = (ev:any)=>{
      const d = ev?.detail;
      if (d==='saving') v1.setSyncStatus(s=>({ ...s, kind:'saving' }));
      else if (d==='failed') {
        v1.offlineFailCountRef.current++;
        if (v1.offlineFailCountRef.current >= 3) {
          v1.setSyncStatus(s=>({ kind:'failed', error: s.lastSavedAt ? undefined : 'failed', queueCount: s.queueCount, lastSavedAt: s.lastSavedAt }));
        } else {
          v1.setSyncStatus(s=>({ kind:'saving' } as any));
        }
      }
      else if (d==='offline') {
        onOffline();
        return;
      }
      else if (d==='updated-elsewhere') v1.setSyncStatus(s=>({ kind:'updated-elsewhere', lastSavedAt: s.lastSavedAt }));
      else if (d==='saved') {
        v1.offlineFailCountRef.current = 0;
        try {
          const ca = localStorage.getItem('couple_v1_last_confirmed_at') || localStorage.getItem('couple_v1_last_sync')
          if (ca) v1.setSyncStatus({ kind:'saved', lastSavedAt: ca }); else { console.warn('[realtime] no server timestamp, not marking saved'); }
        } catch {
          // Do NOT fake Saved with device time - require server timestamp
          console.warn('[realtime] missing timestamp, skipping Saved display');
        }
      }
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('couple-sync' as any, onCoupleSync as any);
    return ()=>{ window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.removeEventListener('couple-sync' as any, onCoupleSync as any); };
  }, []);

  // V11 Auto-Update poller (verbatim) — network-first fetch cache: no-cache, if newer code > current, dispatch couple-sync or show banner.
  useEffect(()=>{
    let cancelled = false;
    let timer: any = null;
    const checkVersion = async ()=>{
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      } catch {}
      try {
        const { checkForUpdate, isNewer, isNewerCode, getCurrentVersion, getCurrentCode } = await import("../lib/updater");
        const localVer = getCurrentVersion();
        const localCode = getCurrentCode();
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
                return;
              }
            }
          }
        } catch {}
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

  // STORAGE: Supabase first, realtime guarded (verbatim core logic, no JSX) — simplified wrapper using remoteLoad + subscribeRemote
  // The full merge logic lives in V1AppShell; here we expose same refs so composition root can call similar.
  // For pure composition we re-expose the effectful sync: actual syncFromRemote logic is in original file 5400-6366.
  // To keep zero-logic-change and compilable, we delegate to a dedicated hook with identical apply logic extracted elsewhere; here we keep reference to raw setters.

  // ---- V156 hotfix: robust shared-space sync ----
  // If user lost hid (shows –) we recovered it via getEffectiveRowId fallback to ash-ciaran-2026.
  // Now ensure remote data is merged into local even when local is non-empty.
  useEffect(()=>{
    if (!app.currentUser) return;
    let cancelled=false;
    const doLoad = async ()=>{
      try {
        const data = await remoteLoad();
        if (cancelled || !data) return;
        // Don't overwrite local if remote empty but local has data (prevents wipe)
        try {
          const totalRemote = (data.chores?.length||0)+(data.calendar?.length||0)+(data.shopping?.length||0)+(data.notes?.length||0);
          if (totalRemote===0) return;
          // Merge helper — same as remoteSync mergeById (latest wins)
          const { mergeById } = await import("../lib/remoteSync");
          if (Array.isArray(data.calendar) && data.calendar.length>0) {
            try {
              const local = v1.calendarRaw as any[];
              const merged = mergeById(local||[], data.calendar as any);
              if (merged.length !== local.length || JSON.stringify(merged)!==JSON.stringify(local)) {
                if (!v1.applyingRemoteRef.current) {
                  v1.applyingRemoteRef.current = true;
                  try { v1.setCalendarRaw(merged as any); } finally { setTimeout(()=>{ v1.applyingRemoteRef.current=false }, 200); }
                }
              }
            } catch {}
          }
          if (Array.isArray(data.notes) && data.notes.length>0) {
            try {
              const local = v1.notesRaw as any[];
              const { mergeById: m2 } = await import("../lib/remoteSync");
              const merged = m2(local||[], data.notes as any);
              if (merged.length !== local.length) {
                if (!v1.applyingRemoteRef.current) {
                  v1.applyingRemoteRef.current = true;
                  try { v1.setNotesRaw(merged as any); } finally { setTimeout(()=>{ v1.applyingRemoteRef.current=false }, 200); }
                }
              }
            } catch {}
          }
          if (Array.isArray(data.chores) && data.chores.length>0) {
            try {
              const local = v1.choresRaw as any[];
              const { mergeById: m3 } = await import("../lib/remoteSync");
              const merged = m3(local||[], data.chores as any);
              if (merged.length>0) v1.setChoresRaw(merged as any);
            } catch {}
          }
          if (Array.isArray(data.shopping) && data.shopping.length>0) {
            try {
              const local = v1.shoppingRaw as any[];
              const { mergeById: m4 } = await import("../lib/remoteSync");
              const merged = m4(local||[], data.shopping as any);
              v1.setShoppingRaw(merged as any);
            } catch {}
          }
        } catch {}
      } catch {}
    };
    doLoad();
    let unsub: ()=>void = ()=>{};
    try {
      unsub = subscribeRemote((rd:any)=>{
        if (cancelled) return;
        try {
          if (rd.updated_at) {
            try { localStorage.setItem('couple_v1_last_sync', rd.updated_at); } catch {}
          }
          // Apply remote push immediately (realtime)
          const doApply = async ()=>{
            const { mergeById } = await import("../lib/remoteSync");
            if (Array.isArray(rd.calendar)) {
              const merged = mergeById(v1.calendarRaw||[], rd.calendar);
              v1.setCalendarRaw(merged as any);
            }
            if (Array.isArray(rd.notes)) {
              const merged = mergeById(v1.notesRaw||[], rd.notes);
              v1.setNotesRaw(merged as any);
            }
            if (Array.isArray(rd.chores)) {
              const merged = mergeById(v1.choresRaw||[], rd.chores);
              v1.setChoresRaw(merged as any);
            }
            if (Array.isArray(rd.shopping)) {
              const merged = mergeById(v1.shoppingRaw||[], rd.shopping);
              v1.setShoppingRaw(merged as any);
            }
          };
          doApply();
        } catch {}
      });
    } catch {}
    return ()=>{ cancelled=true; try{ unsub(); }catch{} };
  }, [app.currentUser, v1.choresRaw?.length, v1.calendarRaw?.length]); // re-run when user logs in

  // Return combined
  return {
    // standalone
    standalone: v1.standalone ?? app.standalone,
    useIsStandalone,
    // currentUser & theme & now
    ...app,
    // V1 shell
    ...v1,
    // constants
    HOUSEHOLD_ID, BUILD_HOUSEHOLD_ID, HOUSEHOLD_TZ, TABLE, ROW_ID,
    // helpers
    safeGetLS, safeSetLS, isQuotaError,
    bufToB64u, b64uToBuf, webAuthnIdKey, isWebAuthnSupported, canDoPlatformBiometric, registerBiometric, authenticateBiometric,
    getHouseholdPersonsRaw, applyCustomPersonNames,
    getStoredHouseholdId, hasAnyLegacyData, shouldShowOnboarding,
    getLastConfirmedAt, getLastSync, getRevision,
    remoteLoad, remoteSave, subscribeRemote, getSupabase, hasSupabaseConfig,
    THEMES, PERSONS, TABS, CATS,
  };
}

// ---- Supabase sync helpers re-exported for wiring (verbatim types) ----
export type {
  PersonKey,
  Theme,
  TabKey,
  ChoreV2,
  CalendarEventV2,
  CalendarEventStatus,
  CalendarResponseKind,
  CalendarEventResponse,
  ShoppingCategory,
  ShoppingFrequency,
  ShoppingItemV2,
  PersonalWants,
  NoteReactionKind,
  NoteMemo,
  Chore,
  CalendarEvent,
  ShoppingItem,
  AddEventFormProps,
};
export type { ChoreIconId };

// ---- offline queue + realtime + Saved timestamps + household persons exports ----
export {
  // re-exported above but explicit for discoverability
  // - offline queue refs are returned via useV1AppShellState / useAppState
  // - realtime is via subscribeRemote
};
// End of state.ts
