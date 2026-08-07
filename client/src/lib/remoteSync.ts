import { getSupabase, TABLE, getEffectiveRowId, getEffectiveTable, ROW_ID_LEGACY } from './supabase';

export type SyncKind = 'saving' | 'saved' | 'synced' | 'offline-queued' | 'failed' | 'updated-elsewhere';
export type SyncStatus = {
  kind: SyncKind;
  lastSavedAt?: string;
  queueCount?: number;
  error?: string;
  [k:string]: any;
};

function getRowId(): string | null {
  try { return getEffectiveRowId() } catch { return null }
}
function requireRowId(): string {
  const id = getRowId()
  if (!id) throw new Error("No household — recover or create")
  return id
}
function getTable(): string {
  try { return getEffectiveTable() } catch { return TABLE }
}

export type RemoteData = {
  chores: any[]
  calendar: any[]
  shopping: any[]
  notes: any[]
  chore_game?: any
  meta?: any
  updated_at?: string
  revision?: number
  updatedAt?: string
  deletedAt?: string
}

async function reallyOnline(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).onLine === false) return false
  } catch {}
  // Also do a quick HEAD to guard against captive portal lying about online? Respect offline, don't force true.
  return true
}

export async function remoteLoad(): Promise<RemoteData | null> {
  const hid = getRowId()
  if (!hid) {
    console.warn('[supabase] load skip — no household_id, need onboarding/recover')
    return null
  }
  const sb = getSupabase()
  if (!sb) {
    console.warn('[supabase] load skip – no config')
    return null
  }
  try {
    const online = await Promise.resolve(reallyOnline()).catch(()=>false)
    if (!online) {
      console.warn('[supabase] offline – queueing, skipping load, using cache')
      return null
    }
  } catch {}

  try {
    // Try normalized household first? For now still couple_data blob for compat, but also check households table existence via meta
    let { data, error } = await sb.from(getTable()).select('*').eq('id', hid).maybeSingle()
    if (error && error.code === 'PGRST116') {
      // no row
      console.warn('[supabase] load empty – row', hid, 'not found')
      return null
    }
    if (error) {
      console.warn('[supabase] load error', error.message, 'row', hid)
      // If new household not yet in couple_data but exists in households table, return empty shape
      try {
        const { data: h } = await sb.from("households").select('id').eq('id', hid).maybeSingle()
        if (h) return { chores: [], calendar: [], shopping: [], notes: [], meta: null, updated_at: undefined, revision: 0 }
      } catch {}
      return null
    }
    if (!data) {
      console.warn('[supabase] load empty – row', hid, 'not found')
      // try households registry fallback
      try {
        const { data: h } = await sb.from("households").select('id').eq('id', hid).maybeSingle()
        if (h) return { chores: [], calendar: [], shopping: [], notes: [], meta: null, updated_at: undefined, revision: 0 }
      } catch {}
      return null
    }
    try {
      if ((data as any).revision != null) localStorage.setItem('couple_v1_revision', String((data as any).revision));
    } catch {}
    try {
      let anonPresent = false
      let anonTail = '????'
      try {
        // @ts-ignore window
        const w:any = typeof window!=='undefined' ? window : null
        const candidate = w?.__SUPABASE_ANON__ || w?.__SUPABASE_ANON_KEY__
        if (candidate) { anonPresent = true; anonTail = String(candidate).slice(-4) }
        else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const envUrl = (import.meta as any)?.env?.VITE_SUPABASE_ANON_KEY || (import.meta as any)?.env?.VITE_SUPABASE_ANON__
          if (envUrl) { anonPresent = true; anonTail = String(envUrl).slice(-4) }
        }
      } catch {}
      const rev = (data as any).revision ?? 0
      const c = Array.isArray((data as any).chores) ? (data as any).chores.length : 0
      const cal = Array.isArray((data as any).calendar) ? (data as any).calendar.length : 0
      const sh = Array.isArray((data as any).shopping) ? (data as any).shopping.length : 0
      const n = Array.isArray((data as any).notes) ? (data as any).notes.length : 0
      console.log(`[supabase] loaded ok rev=${rev} anon=${anonPresent ? 'eyJ...'+anonTail : 'no'} hid=${hid.slice(0,12)} counts c:${c} cal:${cal} s:${sh} n:${n}`)
    } catch {}
    try {
      const meta = (data as any).meta;
      if (meta) {
        const hidLocal = hid;
        if (meta.persons && Array.isArray(meta.persons)) {
          try {
            localStorage.setItem(`couple_v1_household_persons_${hidLocal}`, JSON.stringify(meta.persons));
            localStorage.setItem(`couple_v1_household_persons`, JSON.stringify(meta.persons));
            if (meta.householdName) localStorage.setItem(`couple_v1_household_name`, meta.householdName);
            if (meta.inviteCode) localStorage.setItem(`couple_v1_household_code`, meta.inviteCode);
          } catch {}
        }
      }
    } catch {}
    return {
      chores: Array.isArray((data as any).chores) ? (data as any).chores : [],
      calendar: Array.isArray((data as any).calendar) ? (data as any).calendar : [],
      shopping: Array.isArray((data as any).shopping) ? (data as any).shopping : [],
      notes: Array.isArray((data as any).notes) ? (data as any).notes : [],
      chore_game: (data as any).chore_game || (data as any).choreGame || (data as any)?.meta?.choreGame || (data as any)?.meta?.chore_game || null,
      meta: (data as any).meta || null,
      updated_at: (data as any).updated_at,
      revision: (data as any).revision ?? 0,
    }
  } catch (e:any) {
    console.warn('[supabase] load ex', e?.message||e)
    return null
  }
}

function stripNotesPhotos(arr: any[]): any[] {
  if (!Array.isArray(arr)) return arr as any
  return arr.map((n:any)=>{
    if (n && typeof n === 'object' && 'photoDataUrl' in n && n.photoDataUrl) {
      try {
        const len = typeof n.photoDataUrl === 'string' ? n.photoDataUrl.length : 0
        if (len > 0 && len < 200000) return n
        if (n.photoThumbDataUrl) {
          const { photoDataUrl, ...rest } = n
          void photoDataUrl
          return rest
        }
        if (len >= 200000) {
          const { photoDataUrl, ...rest } = n
          void photoDataUrl
          return rest
        }
      } catch {}
      return n
    }
    return n
  })
}

function withTimestamps<T extends any>(arr: T[], updatedBy?: string): T[] {
  return arr.map((it:any)=> {
    const candidate = it.updatedAt || it.updated_at || it.deletedAt || (it as any).archivedAt || (it as any).archived_at || it.createdAt || undefined
    return {
      ...it,
      updatedAt: candidate,
      updatedBy: it.updatedBy || it.author || updatedBy || 'unknown',
    }
  })
}

export function mergeById(local: any[], remote: any[]): any[] {
  const map = new Map<string, any>()
  const all = [...remote, ...local]
  const effTs = (it:any): number => {
    try {
      const candidates = [
        it.updatedAt ? new Date(it.updatedAt).getTime() : 0,
        it.updated_at ? new Date(it.updated_at).getTime() : 0,
        it.deletedAt ? new Date(it.deletedAt).getTime() : 0,
        (it as any).archivedAt ? new Date((it as any).archivedAt).getTime() : 0,
        (it as any).archived_at ? new Date((it as any).archived_at).getTime() : 0,
        it.createdAt ? new Date(it.createdAt).getTime() : 0,
        0
      ]
      return Math.max(...candidates.filter(n=>!isNaN(n) && n>0), 0)
    } catch { return 0 }
  }
  for (const it of all) {
    const id = String(it.id || '')
    if (!id) continue
    const existing = map.get(id)
    if (!existing) { map.set(id, it); continue }
    const a = effTs(existing)
    const b = effTs(it)
    let winner = existing
    if (b > a) winner = it
    else if (b === a) {
      const existingDel = !!(existing as any).deletedAt
      const itDel = !!(it as any).deletedAt
      if (itDel && !existingDel) winner = it
      else if ((it as any).photoDataUrl && !(existing as any).photoDataUrl) winner = it
      else winner = existing
    }
    if ((existing as any).photoDataUrl && !(winner as any).photoDataUrl) {
      winner = { ...winner, photoDataUrl: (existing as any).photoDataUrl, photoThumbDataUrl: (existing as any).photoThumbDataUrl || winner.photoThumbDataUrl }
    }
    if ((it as any).photoDataUrl && !(winner as any).photoDataUrl) {
      winner = { ...winner, photoDataUrl: (it as any).photoDataUrl, photoThumbDataUrl: (it as any).photoThumbDataUrl || winner.photoThumbDataUrl }
    }
    if ((it as any).deletedAt || (existing as any).deletedAt) {
      const winnerHasDel = !!(winner as any).deletedAt
      if (!winnerHasDel) {
        const candidateWithDel = (it as any).deletedAt ? it : existing
        if (effTs(candidateWithDel) >= effTs(winner)) {
          winner = candidateWithDel
        }
      }
    }
    if ((it as any).archivedAt && !(winner as any).archivedAt) {
      if (effTs(it) >= effTs(winner)) winner = { ...winner, archivedAt: (it as any).archivedAt }
    }
    if ((it as any).archived_at && !(winner as any).archived_at) {
      if (effTs(it) >= effTs(winner)) winner = { ...winner, archived_at: (it as any).archived_at }
    }
    map.set(id, winner)
  }
  const now = Date.now()
  const out: any[] = []
  for (const v of map.values()) {
    if (v.deletedAt) {
      const t = new Date(v.deletedAt).getTime()
      if (isNaN(t) || (now - t) < 7*24*3600*1000) {
        out.push(v)
      } else {
        continue
      }
    } else out.push(v)
  }
  return out
}

export async function remoteSave(partial: Partial<RemoteData> & { allowEmpty?: boolean, expectedRevision?: number, mutationId?: string }): Promise<string | false> {
  const hid = getRowId()
  if (!hid) {
    console.warn('[supabase] save blocked — no household id')
    return false
  }
  const sb = getSupabase()
  if (!sb) {
    console.log('[supabase] save skipped - no config')
    return false
  }
  try {
    const relevantKeys = ['chores','calendar','shopping','notes'] as const
    const isTryingToWriteData = relevantKeys.some(k => Array.isArray((partial as any)[k]))
    const total = (partial.chores?.length||0)+(partial.calendar?.length||0)+(partial.shopping?.length||0)+(partial.notes?.length||0)
    const allowEmpty = !!(partial as any).allowEmpty
    if (total === 0 && isTryingToWriteData && !allowEmpty) {
      console.log('[supabase] block empty write - would wipe row. Pass allowEmpty true only for explicit wipe.')
      return false
    }

    const mutationId = (partial as any).mutationId || (typeof crypto!=='undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : String(Date.now()))
    try {
      const last = localStorage.getItem('couple_v1_last_mutation')
      if (last && last===mutationId) {
        try {
          const sbCheck = getSupabase()
          if (sbCheck) {
            const { data: checkData } = await sbCheck.from(getTable()).select('meta').eq('id', hid).maybeSingle()
            const remoteLast = (checkData as any)?.meta?.lastMutationId
            if (remoteLast === mutationId) {
              console.log('[sync] duplicate mutation confirmed on remote, skip', mutationId)
              return true as any
            }
            console.log('[sync] local duplicate but remote missing, proceeding to write', mutationId)
          }
        } catch {
          console.log('[sync] duplicate check failed, proceeding to write')
        }
      }
    } catch {}

    let existing: any = null
    let existingRevision = 0
    try {
      const { data } = await sb.from(getTable()).select('id,chores,calendar,shopping,notes,meta,updated_at,revision').eq('id', hid).maybeSingle()
      if (data) { existing = data; existingRevision = (data as any).revision ?? 0 }
    } catch (e:any) {
      try {
        const { data } = await sb.from(getTable()).select('id,chores,calendar,shopping,notes,meta,updated_at').eq('id', hid).maybeSingle()
        if (data) existing = data
      } catch {}
      console.warn('[supabase] revision column missing? continuing without CAS', e?.message)
    }

    const expectedRev = (partial as any).expectedRevision ?? existingRevision
    const payload: any = {
      updated_at: new Date().toISOString(),
    }

    if (Array.isArray(partial.chores)) {
      const local = withTimestamps(partial.chores)
      const remote = Array.isArray(existing?.chores) ? existing.chores : []
      payload.chores = mergeById(local, remote)
    } else if (existing?.chores) payload.chores = existing.chores

    if (Array.isArray(partial.calendar)) {
      const local = withTimestamps(partial.calendar)
      const remote = Array.isArray(existing?.calendar) ? existing.calendar : []
      payload.calendar = mergeById(local, remote)
    } else if (existing?.calendar) payload.calendar = existing.calendar

    if (Array.isArray(partial.shopping)) {
      const local = withTimestamps(partial.shopping)
      const remote = Array.isArray(existing?.shopping) ? existing.shopping : []
      payload.shopping = mergeById(local, remote)
    } else if (existing?.shopping) payload.shopping = existing.shopping

    if (Array.isArray(partial.notes)) {
      const local = withTimestamps(stripNotesPhotos(partial.notes as any) as any) as any
      const remote = Array.isArray(existing?.notes) ? existing.notes : []
      payload.notes = mergeById(local, remote)
    } else if (existing?.notes) payload.notes = stripNotesPhotos(existing.notes)

    const choreGameFromPartial = (partial as any).chore_game || (partial as any).meta?.choreGame || (partial as any).meta?.chore_game
    const existingCG = (existing as any)?.chore_game || (existing as any)?.meta?.choreGame || (existing as any)?.meta?.chore_game || null
    const finalCG = choreGameFromPartial || existingCG || null

    const nowIso = new Date().toISOString()
    if (partial.meta) {
      payload.meta = { ...(existing?.meta||{}), ...partial.meta, lastMutationId: mutationId, lastSyncedAt: nowIso }
      if (finalCG) (payload.meta as any).choreGame = finalCG;
    } else if (existing?.meta) {
      payload.meta = { ...existing.meta, lastMutationId: mutationId, lastSyncedAt: nowIso }
      if (finalCG) (payload.meta as any).choreGame = finalCG;
    } else {
      payload.meta = { lastMutationId: mutationId, lastSyncedAt: nowIso }
      if (finalCG) (payload.meta as any).choreGame = finalCG;
    }
    if ((payload as any).chore_game) delete (payload as any).chore_game;

    const revisionSupported = existing != null && typeof (existing as any).revision === 'number';
    if (revisionSupported) {
      payload.revision = (existing as any).revision + 1;
    }

    if (!existing) {
      const insertPayload: any = { id: hid, ...payload }
      if (!insertPayload.chores) insertPayload.chores = []
      if (!insertPayload.calendar) insertPayload.calendar = []
      if (!insertPayload.shopping) insertPayload.shopping = []
      if (!insertPayload.notes) insertPayload.notes = []
      if (insertPayload.revision == null) delete insertPayload.revision
      // Ensure households registry has this id (scalable)
      try {
        const persons = (payload.meta as any)?.persons
        const name = (payload.meta as any)?.householdName || hid
        const code = (payload.meta as any)?.inviteCode ? String((payload.meta as any).inviteCode).toUpperCase() : hid.replace('nylah-','').toUpperCase()
        await sb.from("households").upsert({ id: hid, code, name, meta: payload.meta||{} }, { onConflict: 'id' } as any)
        if (code) await sb.from("household_invites").upsert({ code, household_id: hid } as any, { onConflict: 'code' } as any)
      } catch {}
      const { error } = await sb.from(getTable()).insert(insertPayload)
      if (error) {
        const { error: upErr, data: upData } = await sb.from(getTable()).upsert({ id: hid, ...payload, chores: payload.chores||[], calendar: payload.calendar||[], shopping: payload.shopping||[], notes: payload.notes||[] }, { onConflict: 'id' }).select()
        if (upErr) {
          console.warn('[supabase] insert/upsert error', upErr.message)
          try { localStorage.setItem('couple_v1_last_push_err', upErr.message.slice(0,180)) } catch {}
          return false
        }
        if (upData && upData[0] && upData[0].revision != null) {
          try { localStorage.setItem('couple_v1_revision', String(upData[0].revision)) } catch {}
        }
      } else {
        try { localStorage.setItem('couple_v1_revision', String(insertPayload.revision||1)) } catch {}
      }
    } else {
      let res:any = null
      let err:any = null
      if (payload.revision != null) {
        const q = await sb.from(getTable()).update(payload).eq('id', hid).eq('revision', expectedRev).select()
        res = q.data; err = q.error
        if (!err && (!res || res.length===0)) {
          console.warn('[sync] revision conflict expected', expectedRev, 'got', existingRevision, '- reloading & merging')
          try {
            const { data: fresh } = await sb.from(getTable()).select('*').eq('id', hid).maybeSingle()
            if (fresh) {
              const freshHasRev = typeof (fresh as any).revision === 'number'
              const merged: any = {
                chores: mergeById(payload.chores||[], (fresh as any).chores||[]),
                calendar: mergeById(payload.calendar||[], (fresh as any).calendar||[]),
                shopping: mergeById(payload.shopping||[], (fresh as any).shopping||[]),
                notes: mergeById(payload.notes||[], (fresh as any).notes||[]),
                meta: payload.meta,
                updated_at: new Date().toISOString(),
              }
              if (freshHasRev) merged.revision = (fresh as any).revision + 1
              const retryQuery = freshHasRev
                ? sb.from(getTable()).update(merged).eq('id', hid).eq('revision', (fresh as any).revision).select()
                : sb.from(getTable()).update(merged).eq('id', hid).select()
              const retry = await retryQuery
              if (retry.error) {
                console.warn('[supabase] retry merge failed', retry.error.message)
                try { localStorage.setItem('couple_v1_last_push_err', retry.error.message.slice(0,180)) } catch {}
                return false
              }
              if (retry.data && retry.data[0]) {
                try { localStorage.setItem('couple_v1_revision', String(retry.data[0].revision)) } catch {}
              }
              try {
                const srvAt = (retry && retry.data && retry.data[0] && ((retry.data[0] as any).updated_at || (retry.data[0] as any).updatedAt)) || merged.updated_at || new Date().toISOString()
                localStorage.setItem('couple_v1_last_sync', srvAt); localStorage.setItem('couple_v1_last_push_err',''); localStorage.setItem('couple_v1_had_remote','1'); localStorage.setItem('couple_v1_last_mutation', mutationId); localStorage.setItem('couple_v1_last_confirmed_at', srvAt)
              } catch {}
              try { return (retry && retry.data && retry.data[0] && ((retry.data[0] as any).updated_at || (retry.data[0] as any).updatedAt)) || (typeof merged !== 'undefined' ? merged.updated_at : new Date().toISOString()) } catch { return new Date().toISOString() }
            }
          } catch (e:any) { console.warn('[sync] merge retry ex', e?.message||e) }
          return false
        }
      } else {
        const q = await sb.from(getTable()).update(payload).eq('id', hid).select()
        res = q.data; err = q.error
      }
      if (err) {
        console.warn('[supabase] update error', err.message)
        try { localStorage.setItem('couple_v1_last_push_err', err.message.slice(0,180)) } catch {}
        return false
      }
      if (res && res[0]) {
        const serverMut = (res[0] as any)?.meta?.lastMutationId
        if (serverMut && serverMut !== mutationId) {
          console.warn('[sync] server mutation mismatch expected', mutationId.slice(0,8), 'got', String(serverMut).slice(0,8))
        }
        if (typeof (res[0] as any).revision === 'number' && (res[0] as any).revision <= expectedRev) {
          console.warn('[sync] revision did not advance', expectedRev, '->', (res[0] as any).revision)
        }
      }
      if (res && res[0] && res[0].revision != null) {
        try { localStorage.setItem('couple_v1_revision', String(res[0].revision)) } catch {}
      } else if (payload.revision != null) {
        try { localStorage.setItem('couple_v1_revision', String(payload.revision)) } catch {}
      }
    }
    try {
      const choresForNorm = (payload as any).chores
      if (Array.isArray(choresForNorm) && choresForNorm.length>0) {
        import('./normalized').then(m=> m.syncChoreOccurrencesToSupabase(choresForNorm as any)).catch(()=>{})
      }
    } catch {}
    let confirmedAt = payload.updated_at
    try {
      // @ts-ignore res may be undefined in insert path
      const serverAt = (typeof res !== 'undefined' && res && res[0] && ((res[0] as any).updated_at || (res[0] as any).updatedAt)) || payload.updated_at
      if (serverAt) confirmedAt = serverAt
    } catch {}
    try { localStorage.setItem('couple_v1_last_sync', confirmedAt); localStorage.setItem('couple_v1_last_push_err',''); localStorage.setItem('couple_v1_had_remote','1'); localStorage.setItem('couple_v1_last_mutation', mutationId); localStorage.setItem('couple_v1_last_confirmed_at', confirmedAt) } catch {}
    return confirmedAt
  } catch(e:any){
    console.warn('[supabase] save ex', e?.message||e)
    try { localStorage.setItem('couple_v1_last_push_err', String(e?.message||e).slice(0,180)) } catch {}
    return false
  }
}

export function subscribeRemote(cb: (data: RemoteData)=>void) {
  const hid = getRowId()
  if (!hid) return ()=>{}
  const sb = getSupabase()
  if (!sb) return ()=>{}
  try {
    const ch = sb.channel('couple_data_'+hid)
      .on('postgres_changes', { event: '*', schema: 'public', table: getTable(), filter: `id=eq.${hid}` }, (payload:any)=>{
        if (payload.eventType === 'DELETE') {
          console.warn('[sync] realtime DELETE ignored — not applying old snapshot')
          return
        }
        const r = payload.new
        if(!r) return
        try {
          if (r.revision != null) localStorage.setItem('couple_v1_revision', String(r.revision))
        } catch {}
        cb({
          chores: r.chores||[],
          calendar: r.calendar||[],
          shopping: r.shopping||[],
          notes: r.notes||[],
          chore_game: (r as any).chore_game || (r as any).choreGame || (r as any)?.meta?.choreGame || (r as any)?.meta?.chore_game || null,
          meta: r.meta,
          updated_at: r.updated_at,
          revision: r.revision,
        })
      })
      .subscribe()
    return ()=>{ try { sb.removeChannel(ch) } catch{} }
  } catch { return ()=>{} }
}
