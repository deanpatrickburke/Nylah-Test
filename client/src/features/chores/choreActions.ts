// choreActions.ts — RPC/DB actions extracted from App.tsx / ChoresScreen.tsx
// Zero logic change — preserves offline queue handling, reallyOnline, Saved timestamp logic contract
import { getSupabase } from "../../lib/supabase";

const HOUSEHOLD = (()=>{ try { return localStorage.getItem('couple_v1_household_id')||'unknown' } catch { return 'unknown' } })();

// Canonical implementations re-exported from lib/normalized (single source of truth)
export { claimChoreViaRpc as claimChoreViaRpc } from "../../lib/normalized";
export { completeChoreOccurrence as completeChoreRpc } from "../../lib/normalized";
export { insertChoreOccurrence as upsertChoreOcc } from "../../lib/normalized";
export { syncChoreOccurrencesToSupabase as syncChoreOccurrences } from "../../lib/normalized";

// Legacy aliases for code that imported via older names
export const claimChoreOccRpc = async (id: string, member: 'aisling'|'ciaran') => {
  try {
    const mod = await import("../../lib/normalized");
    return mod.claimChoreViaRpc(id, member);
  } catch { return null; }
};

export const completeChoreOccurrence = async (id: string, member: 'aisling'|'ciaran') => {
  try {
    const mod = await import("../../lib/normalized");
    return mod.completeChoreOccurrence(id, member);
  } catch { return false; }
};

// Offline queue & Saved timestamp logic preserved (do not change)
// Uses localStorage keys from monolith: couple_v1_last_local_write, couple_v1_chore_streak, couple_v1_queue_count

export function recordLocalWrite(nowISO: string) {
  try { localStorage.setItem("couple_v1_last_local_write", nowISO); } catch {}
}

export function bumpStreak(delta = 1) {
  try {
    const cur = Number(localStorage.getItem("couple_v1_chore_streak")||0);
    localStorage.setItem("couple_v1_chore_streak", String(cur+delta));
    return cur+delta;
  } catch { return delta; }
}

export function getQueueCount(): string {
  try { return localStorage.getItem("couple_v1_queue_count") || "0"; } catch { return "0"; }
}

export function getStreak(): number {
  try { return Number(localStorage.getItem("couple_v1_chore_streak")||0); } catch { return 0; }
}

// reallyOnline force-online logic preserved comment (network handling owned by parent sync engine)
// The chores actions attempt RPC but never block UI; local optimistic update is source of truth.
// If navigator.onLine is false, queue is incremented and mutation is stored in idb queue (handled by remoteSync).

export async function tryNotifyOther(me: 'aisling'|'ciaran', payload: {title:string, body:string, url:string}) {
  try {
    const m = await import('../../lib/push');
    return (m as any).notifyOther(me, payload);
  } catch { /* noop */ }
}

// upsert helper for template occurrences preserving exact row shape from normalized.ts
export async function upsertChoreOccWrapper(chore: any) {
  try {
    const sb = getSupabase();
    if (!sb) return false;
    const row = {
      id: chore.id,
      household_id: HOUSEHOLD,
      template_id: chore.templateId || chore.id,
      title: chore.title,
      due_at: chore.dueAt ? new Date(chore.dueAt).toISOString() : null,
      status: chore.status || 'deck',
      assigned_to: chore.assignedTo,
      base_points: chore.basePoints || 10,
    };
    const { error } = await sb.from('chore_occurrences').upsert(row as any, { onConflict: 'id' });
    if (error) return false;
    return true;
  } catch { return false; }
}
