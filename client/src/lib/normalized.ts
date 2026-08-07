import { getSupabase } from './supabase'

const HOUSEHOLD = ((): string => { try { return localStorage.getItem('couple_v1_household_id')||'unknown' } catch { return 'unknown' } })()

export async function claimChoreViaRpc(occurrenceId: string, member: 'aisling'|'ciaran'): Promise<{claimed:boolean, alreadyBy?:string}|null> {
  try {
    const sb = getSupabase()
    if (!sb) return null
    const { data, error } = await sb.rpc('claim_chore_occurrence', { p_id: occurrenceId, p_member: member } as any)
    if (error) {
      console.warn('[normalized] claim RPC error', error.message)
      return null
    }
    if (Array.isArray(data) && data.length>0) {
      const row = data[0] as any
      return { claimed: !!row.claimed, alreadyBy: row.claimed_by || row.completed_by }
    }
    if (data && typeof data === 'object') {
      const row = data as any
      return { claimed: !!row.claimed, alreadyBy: row.claimed_by || row.completed_by }
    }
    return null
  } catch(e:any){ console.warn('[normalized] claim ex', e?.message||e); return null }
}

export async function completeChoreOccurrence(occurrenceId: string, member: 'aisling'|'ciaran'): Promise<boolean> {
  try {
    const sb = getSupabase()
    if (!sb) return false
    const { data, error } = await sb.rpc('complete_chore_occurrence', { p_occurrence_id: occurrenceId, p_household_id: HOUSEHOLD, p_member: member } as any)
    if (error) { console.warn('[normalized] complete RPC error', error.message); return false }
    const claimed = (data as any)?.claimed
    return !!claimed || (data as any)?.already === false // if RPC succeeded, treat as truthy
  } catch { return false }
}

export async function insertChoreOccurrence(chore: any) {
  try {
    const sb = getSupabase()
    if (!sb) return false
    const row = {
      id: chore.id,
      household_id: HOUSEHOLD,
      template_id: chore.templateId || chore.id,
      title: chore.title,
      due_at: chore.dueAt ? new Date(chore.dueAt).toISOString() : null,
      status: chore.status || 'deck',
      assigned_to: chore.assignedTo,
      base_points: chore.basePoints || chore.base_points || 10,
    }
    const { error } = await sb.from('chore_occurrences').upsert(row as any, { onConflict: 'id' })
    if (error) { console.warn('[normalized] insert occurrence error', error.message); return false }
    return true
  } catch(e:any){ console.warn('[normalized] insert ex', e?.message||e); return false }
}

export async function syncChoreOccurrencesToSupabase(chores: any[]) {
  try {
    const enabled = (()=>{ try{ return localStorage.getItem('couple_v1_use_normalized')!=='0' }catch{return true} })()
    if (!enabled) return
    const sb = getSupabase()
    if (!sb) return
    // Only sync up to 50 to avoid rate-limit
    const slice = chores.slice(0,50)
    for (const c of slice) {
      const row:any = {
        id: c.id,
        household_id: HOUSEHOLD,
        template_id: c.templateId || c.id,
        title: c.title,
        due_at: c.dueAt ? new Date(c.dueAt).toISOString() : null,
        "dueAt": c.dueAt || null,
        status: c.status,
        assigned_to: c.assignedTo || null,
        "assignedTo": c.assignedTo || null,
        completed_by: c.completedBy || null,
        "completedBy": c.completedBy || null,
        completed_at: c.completedAt ? new Date(c.completedAt).toISOString() : null,
        "completedAt": c.completedAt || null,
        base_points: c.basePoints || 10,
        "basePoints": c.basePoints || 10,
        updated_at: new Date().toISOString(),
      }
      await sb.from('chore_occurrences').upsert(row, { onConflict: 'id' })
    }
  } catch {}
}

export async function fetchCalendarSeries() {
  try {
    const sb = getSupabase()
    if (!sb) return []
    const { data } = await sb.from('calendar_series').select('*').eq('household_id', HOUSEHOLD).limit(200)
    return data || []
  } catch { return [] }
}

export async function upsertCalendarSeries(series: any) {
  try {
    const sb = getSupabase()
    if (!sb) return false
    const row:any = {
      id: series.id,
      household_id: HOUSEHOLD,
      title: series.title,
      frequency: series.frequency,
      recurrence_rule: series.recurrenceRule,
      frequency_detail: series.frequencyDetail,
      weekdays: series.weekdays || [false,false,false,false,false,false,false],
      timezone: series.timezone || 'Europe/Dublin',
      status: series.status,
      proposer: series.proposer,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('calendar_series').upsert(row, { onConflict: 'id' })
    if (error) { console.warn('[normalized] upsert series error', error.message); return false }
    return true
  } catch { return false }
}

export async function upsertCalendarOverride(override: any) {
  try {
    const sb = getSupabase()
    if (!sb) return false
    const row:any = {
      id: override.id,
      household_id: HOUSEHOLD,
      series_id: override.seriesId,
      seriesId: override.seriesId,
      occurrence_date: override.occurrenceDate,
      occurrenceDate: override.occurrenceDate,
      deleted: !!override.deleted,
      title: override.title || null,
      data: override.data || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await sb.from('calendar_occurrence_overrides').upsert(row, { onConflict: 'id' })
    if (error) { console.warn('[normalized] override err', error.message); return false }
    return true
  } catch { return false }
}
