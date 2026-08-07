import { getSupabase, getEffectiveRowId } from './supabase'

export const HOUSEHOLD_ID = (()=>{ try { return localStorage.getItem('couple_v1_household_id')||'unknown' } catch { return 'unknown' } })() as unknown as string
export function getHouseholdId(): string {
  try { return getEffectiveRowId() } catch { return HOUSEHOLD_ID }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export function getVapidPublicKey(): string | null {
  try {
    const w: any = typeof window !== 'undefined' ? (window as any) : null
    if (w?.__VAPID_PUBLIC_KEY__) return w.__VAPID_PUBLIC_KEY__ as string
  } catch {}
  try {
    // @ts-ignore
    const envKey = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY
    if (envKey) return envKey as string
  } catch {}
  return null
}

export function isPushSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  try { return Notification.permission as NotificationPermission } catch { return 'default' }
}

export async function subscribePush(userKey: 'aisling'|'ciaran'): Promise<PushSubscription | null> {
  if (!isPushSupported()) throw new Error('push unsupported')
  const vapid = getVapidPublicKey()
  if (!vapid) throw new Error('no VAPID key')
  if (Notification.permission === 'denied') throw new Error('permission denied')
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') throw new Error('permission not granted: '+perm)
  }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid) as any,
    })
  }
  await saveSubscription(sub, userKey)
  try { localStorage.setItem('couple_v1_push_enabled', '1') } catch {}
  try { localStorage.setItem('couple_v1_push_user', userKey) } catch {}
  return sub
}

export async function saveSubscription(sub: PushSubscription, userKey: string) {
  const sb = getSupabase()
  if (!sb) throw new Error('no supabase')
  const json = sub.toJSON() as any
  const endpoint = (json as any).endpoint as string
  const keys = json.keys
  const payload = {
    household_id: getHouseholdId(),
    user_key: userKey,
    endpoint,
    keys,
  }
  // try push_subscriptions table
  try {
    const { error } = await sb.from('push_subscriptions').upsert(payload, { onConflict: 'endpoint' })
    if (!error) return
    console.warn('[push] upsert table error, fallback', error?.message)
  } catch (e) { console.warn('[push] upsert exception', e) }
  // fallback: store in localStorage and in couple_data meta via remoteSync if possible
  try {
    const fallbackKey = `couple_v1_push_sub_${userKey}`
    localStorage.setItem(fallbackKey, JSON.stringify(payload))
  } catch {}
  // also try store in couple_data row as push_fallback json
  try {
    const { remoteLoad, remoteSave } = await import('./remoteSync')
    const remote = await remoteLoad()
    if (remote) {
      const meta = (remote as any).meta || {}
      const pf = meta.push_fallback || {}
      pf[userKey] = { endpoint, keys, updatedAt: new Date().toISOString() }
      await remoteSave({ meta: { ...meta, push_fallback: pf } } as any)
    }
  } catch {}
}

export async function unsubscribePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      const endpoint = sub.endpoint
      try {
        const sb = getSupabase()
        if (sb && endpoint) await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)
      } catch {}
      await sub.unsubscribe()
    }
    try { localStorage.setItem('couple_v1_push_enabled', '0') } catch {}
  } catch {}
}

export async function localNotify(title: string, body: string, url?: string): Promise<boolean> {
  try {
    try { if ('vibrate' in navigator) (navigator as any).vibrate?.([100,50,100]) } catch {}
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      try { window.dispatchEvent(new CustomEvent('couple-push-fallback-toast', { detail: { title, body } })) } catch {}
      return false
    }
    if (Notification.permission !== 'granted') {
      try { window.dispatchEvent(new CustomEvent('couple-push-fallback-toast', { detail: { title, body, reason: 'permission-'+Notification.permission } })) } catch {}
      return false
    }
    try {
      const reg = await navigator.serviceWorker.ready
      await (reg as any).showNotification(title, {
        body,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'nylah-'+Date.now(),
        renotify: true,
        requireInteraction: false,
        data: { url: url || './?standalone' },
        vibrate: [100,50,100],
      } as any)
      return true
    } catch {
      try { new Notification(title, { body, icon: './icon-192.png' } as any) ; return true } catch {}
    }
    try { window.dispatchEvent(new CustomEvent('couple-push-fallback-toast', { detail: { title, body } })) } catch {}
    return false
  } catch { return false }
}

export async function notifyOther(sender: 'aisling'|'ciaran', payload: { title: string; body: string; url?: string }) {
  // first local vibrate for sender as proof that push stack works even without table
  try { await localNotify(payload.title, payload.body, payload.url) } catch {}
  const sbUrl = (() => {
    try {
      const w: any = (window as any)
      if (w?.__SUPABASE_URL__) return w.__SUPABASE_URL__
      // @ts-ignore
      return (import.meta as any).env?.VITE_SUPABASE_URL || 'https://zlllebsjtgihsxhcmcvb.supabase.co'
    } catch { return 'https://zlllebsjtgihsxhcmcvb.supabase.co' }
  })()
  const fnUrl = `${sbUrl}/functions/v1/push-notify`
  try {
    const anon = (() => {
      try {
        const w: any = (window as any)
        return w?.__SUPABASE_ANON_KEY__ || w?.__SUPABASE_ANON__
      } catch { return '' }
    })()
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anon,
        'Authorization': `Bearer ${anon}`,
      },
      body: JSON.stringify({ sender, ...payload }),
    })
    if (res.ok) return await res.json().catch(()=>({}))
    console.warn('[push] notifyOther edge status', res.status)
    return null
  } catch (e) {
    console.warn('[push] notifyOther failed', e)
    return null
  }
}
