import { getSupabase, TABLE, ROW_ID, getEffectiveRowId, getEffectiveTable } from './supabase'

function getRowId(): string {
  try { return getEffectiveRowId() } catch { return ROW_ID }
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
  updatedAt?: string // alias
  deletedAt?: string
}

async function reallyOnline(): Promise<boolean> {
  // Real reachability check: distinguish offline, online but Supabase unreachable, and reachable
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).onLine === false) return false;
  } catch {}
  // Lightweight Supabase reachability HEAD with 2s timeout
  try {
    const url = "https://zlllebsjtgihsxhcmcvb.supabase.co/rest/v1/";
    // anon key from env or hardcoded fallback (anon is public)
    let anon = "";
    try {
      // @ts-ignore
      const w:any = typeof window !== 'undefined' ? (window as any) : null;
      if (w && (w.__SUPABASE_ANON__ || w.__SUPABASE_ANON_KEY__)) anon = (w.__SUPABASE_ANON__ || w.__SUPABASE_ANON_KEY__) as string;
    } catch {}
    if (!anon) {
      try {
        // @ts-ignore
        const u = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;
        if (u) anon = u as string;
      } catch {}
    }
    if (!anon) anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsbGxlYnNqdGdpaHN4aGNtY3ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3NDQxMjQsImV4cCI6MjEwMTMyMDEyNH0.Q6PuA6nvTI__DEB0i7akLusljjjeYu_0IxQICOc5oSQ";
    const controller = new AbortController();
    const timeout = setTimeout(()=> controller.abort(), 2000);
    const resp = await fetch(url, { method: 'HEAD', headers: { apikey: anon } as any, signal: controller.signal } as any);
    clearTimeout(timeout);
    // Any response from Supabase (ok or 401/404) means reachable - anon key may cause 401 but that's reachable
    return resp.ok || resp.status===401 || resp.status===404 || resp.status===400;
  } catch {
    return false;
  }
}


export async function remoteLoad(): Promise<RemoteData | null> {
  const sb = getSupabase()
  if (!sb) {
    console.warn('[supabase] load skip – no config (check VITE_SUPABASE_URL / anon present eyJ...?)')
    return null
  }
  // Offline detection: if definitely offline, skip network load and rely on local cache
  try {
    const online = await Promise.resolve(reallyOnline()).catch(()=>false)
    if (!online) {
      console.warn('[supabase] offline – queueing, skipping load, using cache')
      return null
    }
  } catch {}

  try {
    const { data, error } = await sb.from(getTable()).select('*').eq('id', getRowId()).maybeSingle()
    if (error) {
      console.warn('[supabase] load error', error.message, '| anon?', !!((sb as any)?.supabaseKey || true), 'row', getRowId())
      return null
    }
    if (!data) {
      console.warn('[supabase] load empty – row', getRowId(), 'not found')
      return null
    }
    try {
      // Don't fabricate Saved here - loading is not a confirmed write
      if ((data as any).revision != null) localStorage.setItem('couple_v1_revision', String((data as any).revision));
      // had_remote is set only after verified save, not on load
    } catch {}
    // verbose ok log – redact keys, show revision + anon presence
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
      console.log(`[supabase] loaded ok rev=${rev} anon=${anonPresent ? 'eyJ...'+anonTail : 'no'} counts c:${c} cal:${cal} s:${sh} n:${n}`)
    } catch {}
    // sync household pinHashes + persons for beta multi-household linking
    try {
      const meta = (data as any).meta;
      if (meta) {
        const hid = getRowId();
        if (meta.pinHashes && typeof meta.pinHashes === 'object') {
          try { localStorage.setItem(`couple_v1_household_pins_${hid}`, JSON.stringify(meta.pinHashes)); } catch {}
          try { (window as any).__HOUSEHOLD_PINS__ = meta.pinHashes; } catch {}
        }
        if (meta.persons && Array.isArray(meta.persons)) {
          try {
            localStorage.setItem(`couple_v1_household_persons_${hid}`, JSON.stringify(meta.persons));
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
      // keep small photos (<200k) for quality, drop huge ones to avoid row bloat
      try {
        const len = typeof n.photoDataUrl === 'string' ? n.photoDataUrl.length : 0
        if (len > 0 && len < 200000) return n
        // if big, keep thumb but drop full to save space — but preserve if thumb missing?
        if (n.photoThumbDataUrl) {
          const { photoDataUrl, ...rest } = n
          void photoDataUrl
          // keep thumb only to save space but allow mergeById to preserve from other side
          return rest
        }
        // no thumb, keep small else drop
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
    // Preserve existing timestamps, but consider deletedAt/archivedAt for recency
    // When a delete sets deletedAt + updatedAt, updatedAt wins. If only deletedAt set, use it.
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
  // helper to get effective timestamp for recency
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
      // tie-breaker: deletion wins tie, then photo preservation, then existing
      const existingDel = !!(existing as any).deletedAt
      const itDel = !!(it as any).deletedAt
      if (itDel && !existingDel) winner = it
      else if ((it as any).photoDataUrl && !(existing as any).photoDataUrl) winner = it
      else winner = existing
    }
    // Preserve photoDataUrl if winner lacks it but loser has it
    if ((existing as any).photoDataUrl && !(winner as any).photoDataUrl) {
      winner = { ...winner, photoDataUrl: (existing as any).photoDataUrl, photoThumbDataUrl: (existing as any).photoThumbDataUrl || winner.photoThumbDataUrl }
    }
    if ((it as any).photoDataUrl && !(winner as any).photoDataUrl) {
      winner = { ...winner, photoDataUrl: (it as any).photoDataUrl, photoThumbDataUrl: (it as any).photoThumbDataUrl || winner.photoThumbDataUrl }
    }
    // Preserve tombstone if newer or tie: if either has deletedAt and its ts >= other's, keep deleted version
    if ((it as any).deletedAt || (existing as any).deletedAt) {
      // if winner doesn't have deletedAt but loser does and loser ts >= winner ts, swap to deleted one
      const winnerHasDel = !!(winner as any).deletedAt
      if (!winnerHasDel) {
        const candidateWithDel = (it as any).deletedAt ? it : existing
        if (effTs(candidateWithDel) >= effTs(winner)) {
          winner = candidateWithDel
        }
      }
    }
    // Preserve archivedAt similarly
    if ((it as any).archivedAt && !(winner as any).archivedAt) {
      if (effTs(it) >= effTs(winner)) winner = { ...winner, archivedAt: (it as any).archivedAt }
    }
    if ((it as any).archived_at && !(winner as any).archived_at) {
      if (effTs(it) >= effTs(winner)) winner = { ...winner, archived_at: (it as any).archived_at }
    }
    map.set(id, winner)
  }
  // Keep tombstones for 7d in merge (don't purge immediately) — UI filters them, purge only after 7d to keep DB tidy
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

// True multiplayer: revision compare-and-swap
export async function remoteSave(partial: Partial<RemoteData> & { allowEmpty?: boolean, expectedRevision?: number, mutationId?: string }): Promise<string | false> { // returns server updated_at ISO on success, false on failure
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
    // last mutation dedup - verify against remote before skipping
    // Local-only check can cause data loss for offline mutations (bug: marked processed before write)
    try {
      const last = localStorage.getItem('couple_v1_last_mutation')
      if (last && last===mutationId) {
        // Verify remote actually has this mutation before treating as duplicate
        try {
          const sbCheck = getSupabase()
          if (sbCheck) {
            const { data: checkData } = await sbCheck.from(getTable()).select('meta').eq('id', getRowId()).maybeSingle()
            const remoteLast = (checkData as any)?.meta?.lastMutationId
            if (remoteLast === mutationId) {
              console.log('[sync] duplicate mutation confirmed on remote, skip', mutationId)
              return true
            }
            // local thinks it's done but remote doesn't have it — must write
            console.log('[sync] local duplicate but remote missing, proceeding to write', mutationId)
          } else {
            // No supabase client, can't verify — be safe and skip only if we're offline? Actually safer to write
            // But if offline, remoteSave would fail anyway, so skip the early return
            console.log('[sync] duplicate marker but no client to verify, proceeding')
          }
        } catch {
          console.log('[sync] duplicate check failed, proceeding to write')
        }
      }
    } catch {}

    let existing: any = null
    let existingRevision = 0
    try {
      const { data } = await sb.from(getTable()).select('id,chores,calendar,shopping,notes,meta,updated_at,revision').eq('id', getRowId()).maybeSingle()
      if (data) { existing = data; existingRevision = (data as any).revision ?? 0 }
    } catch (e:any) {
      // revision column may not exist yet – try without revision
      try {
        const { data } = await sb.from(getTable()).select('id,chores,calendar,shopping,notes,meta,updated_at').eq('id', getRowId()).maybeSingle()
        if (data) existing = data
      } catch {}
      console.warn('[supabase] revision column missing? continuing without CAS', e?.message)
    }

    const expectedRev = (partial as any).expectedRevision ?? existingRevision
    const payload: any = {
      updated_at: new Date().toISOString(),
    }

    // Perfect multiplayer: always merge local partial with remote existing, never blind overwrite
    // This stops a stale device from wiping the other person's recent add
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
      // mergeById preserves photoDataUrl across stripped remote vs local with photo
      payload.notes = mergeById(local, remote)
    } else if (existing?.notes) payload.notes = stripNotesPhotos(existing.notes)

    // chore_game persistence — embedded in meta to avoid needing ALTER TABLE (anon cannot add column)
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
    // ensure no stray top-level chore_game column is sent — anon can't ALTER
    if ((payload as any).chore_game) delete (payload as any).chore_game;

    // try revision bump if column exists - only if remote actually has revision
    const revisionSupported = existing != null && typeof (existing as any).revision === 'number';
    if (revisionSupported) {
      payload.revision = (existing as any).revision + 1;
    } else {
      // revision column missing or row is new - do not send revision
      // will be retried without revision, or migration will add it
    }

    if (!existing) {
      const insertPayload: any = { id: getRowId(), ...payload }
      if (!insertPayload.chores) insertPayload.chores = []
      if (!insertPayload.calendar) insertPayload.calendar = []
      if (!insertPayload.shopping) insertPayload.shopping = []
      if (!insertPayload.notes) insertPayload.notes = []
      if (insertPayload.revision == null) delete insertPayload.revision // allow table without revision
      const { error } = await sb.from(getTable()).insert(insertPayload)
      if (error) {
        const { error: upErr, data: upData } = await sb.from(getTable()).upsert({ id: getRowId(), ...payload, chores: payload.chores||[], calendar: payload.calendar||[], shopping: payload.shopping||[], notes: payload.notes||[] }, { onConflict: 'id' }).select()
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
      // compare-and-swap if revision column present
      let res:any = null
      let err:any = null
      if (payload.revision != null) {
        const q = await sb.from(getTable()).update(payload).eq('id', getRowId()).eq('revision', expectedRev).select()
        res = q.data; err = q.error
        if (!err && (!res || res.length===0)) {
          console.warn('[sync] revision conflict expected', expectedRev, 'got', existingRevision, '- reloading & merging')
          // conflict: reload and merge per item, retry once
          try {
            const { data: fresh } = await sb.from(getTable()).select('*').eq('id', getRowId()).maybeSingle()
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
                ? sb.from(getTable()).update(merged).eq('id', getRowId()).eq('revision', (fresh as any).revision).select()
                : sb.from(getTable()).update(merged).eq('id', getRowId()).select()
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
                const srvAt = (retry && retry.data && retry.data[0] && ((retry.data[0] as any).updated_at || (retry.data[0] as any).updatedAt)) || (merged as any).updated_at || null
              if (!srvAt) {
                console.warn('[sync] no server timestamp on retry merge, failing closed');
                return null as any;
              }
                localStorage.setItem('couple_v1_last_sync', srvAt); localStorage.setItem('couple_v1_last_push_err',''); localStorage.setItem('couple_v1_had_remote','1'); localStorage.setItem('couple_v1_last_mutation', mutationId); if (srvAt) { try { localStorage.setItem('couple_v1_last_confirmed_at', srvAt); localStorage.setItem('couple_v1_last_sync', srvAt); } catch {} }
              } catch {}
              // @ts-ignore retry may hold merged timestamp
              try { const ts = (retry && retry.data && retry.data[0] && ((retry.data[0] as any).updated_at || (retry.data[0] as any).updatedAt)) || (typeof merged !== 'undefined' ? (merged as any).updated_at : null); if (!ts) return null as any; return ts as any; } catch { return null as any }
            }
          } catch (e:any) { console.warn('[sync] merge retry ex', e?.message||e) }
          // if still conflict, treat as failed but reload will recover
          return false
        }
      } else {
        // no revision column - simple update
        const q = await sb.from(getTable()).update(payload).eq('id', getRowId()).select()
        res = q.data; err = q.error
      }
      if (err) {
        console.warn('[supabase] update error', err.message)
        try { localStorage.setItem('couple_v1_last_push_err', err.message.slice(0,180)) } catch {}
        return false
      }
      // Verify server actually stored our mutation — prevents false Saved
      if (res && res[0]) {
        const serverMut = (res[0] as any)?.meta?.lastMutationId
        if (serverMut && serverMut !== mutationId) {
          console.warn('[sync] server mutation mismatch expected', mutationId.slice(0,8), 'got', String(serverMut).slice(0,8))
          // Don't treat as fatal yet, but ensure we don't lie about revision
        }
        // Verify revision advanced
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
    // Optional normalized mirror (non-blocking) for chore_occurrences path forward
    try {
      const choresForNorm = (payload as any).chores
      if (Array.isArray(choresForNorm) && choresForNorm.length>0) {
        import('./normalized').then(m=> m.syncChoreOccurrencesToSupabase(choresForNorm as any)).catch(()=>{})
      }
    } catch {}
    // Only set had_remote / last_sync after verified server write — not on load
    // Use server-confirmed timestamp if available, else our payload timestamp, else now. This becomes the truthful Saved time.
    let confirmedAt = payload.updated_at
    try {
      // res from last successful update holds server row, if not, try to read from latest res
      // @ts-ignore res may be undefined in insert path, fallback to payload
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
  const sb = getSupabase()
  if (!sb) return ()=>{}
  try {
    const ch = sb.channel('couple_data_'+getRowId())
      .on('postgres_changes', { event: '*', schema: 'public', table: getTable(), filter: `id=eq.${getRowId()}` }, (payload:any)=>{
        if (payload.eventType === 'DELETE') {
          // DELETE emits old row – do NOT treat as current data (stale emit bug)
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
