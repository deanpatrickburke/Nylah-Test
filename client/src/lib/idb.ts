/**
 * Nylah OS — durable IndexedDB queue + kv + photos
 * DB: couple_v1_idb v2
 * Stores:
 *  - kv (out-of-line key string) -> JSON stringified values
 *  - mutation_queue (keyPath: mutationId) -> {mutationId, revision, payload, createdAt, retries}
 *  - note_photos (keyPath: id) -> {id, dataUrl/url, updatedAt}
 *  - photos (generic out-of-line) -> any
 *
 * Falls back to localStorage (idb_ prefix) when IDB unavailable (Safari private / iframe tests).
 * Maintains backward compatibility with earlier LS-shim that stored JSON strings in kv.
 */

const DB_NAME = "couple_v1_idb";
const DB_VER = 2;

const STORE_KV = "kv";
const STORE_Q = "mutation_queue";
const STORE_NOTE_PHOTOS = "note_photos";
const STORE_PHOTOS = "photos";

/* ---------- types ---------- */
export type PersistedMutation = {
  mutationId: string;
  revision: number;
  payload: any;
  createdAt: string;
  retries: number;
  [extra: string]: any;
};

type PhotoRow = {
  id: string;
  dataUrl?: string;
  url?: string;
  val?: string;
  updatedAt?: string;
};

/* ---------- LS helpers (safe) ---------- */
function safeLSGet(k: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeLSSet(k: string, v: string) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(k, v);
  } catch {}
}
function safeLSRemove(k: string) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(k);
  } catch {}
}

function canUseIdb(): boolean {
  try {
    return typeof indexedDB !== "undefined" && typeof (indexedDB as any).open === "function";
  } catch {
    return false;
  }
}

/* ---------- openIdb with caching ---------- */
let _dbInstance: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase | null> | null = null;

export function openIdb(): Promise<IDBDatabase | null> {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  if (_dbPromise) return _dbPromise;
  if (!canUseIdb()) return Promise.resolve(null);

  _dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = () => {
        const db = (req as any).result as IDBDatabase;
        // typed as IDBVersionChangeEvent in lib.dom, but access via any for oldVersion
        const oldVersion = (req as any).oldVersion ?? (req as unknown as IDBVersionChangeEvent).oldVersion ?? 0;

        // kv — out-of-line
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }

        // mutation_queue — version 2 introduces keyPath store
        if (!db.objectStoreNames.contains(STORE_Q)) {
          if (oldVersion < 2) {
            try {
              db.createObjectStore(STORE_Q, { keyPath: "mutationId" });
            } catch {
              // Fallback: some browsers may not allow keyPath creation if conflicting old store existed
              try {
                // attempt delete + recreate if somehow present (defensive)
                if (db.objectStoreNames.contains(STORE_Q)) {
                  (db as any).deleteObjectStore?.(STORE_Q);
                }
              } catch {}
              try {
                db.createObjectStore(STORE_Q, { keyPath: "mutationId" });
              } catch {
                // ultimate fallback: generic store
                try {
                  db.createObjectStore(STORE_Q);
                } catch {}
              }
            }
          } else {
            // oldVersion >=2 but store missing (abnormal) — create with keyPath
            try {
              db.createObjectStore(STORE_Q, { keyPath: "mutationId" });
            } catch {
              try {
                db.createObjectStore(STORE_Q);
              } catch {}
            }
          }
        }

        if (!db.objectStoreNames.contains(STORE_NOTE_PHOTOS)) {
          try {
            db.createObjectStore(STORE_NOTE_PHOTOS, { keyPath: "id" });
          } catch {
            try {
              db.createObjectStore(STORE_NOTE_PHOTOS);
            } catch {}
          }
        }

        if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
          try {
            db.createObjectStore(STORE_PHOTOS);
          } catch {}
        }
      };

      req.onsuccess = () => {
        const db = req.result as IDBDatabase;
        // handle external version change / close
        db.onversionchange = () => {
          try {
            db.close();
          } catch {}
          _dbInstance = null;
          _dbPromise = null;
        };
        _dbInstance = db;
        resolve(db);
      };

      req.onerror = () => {
        resolve(null);
      };

      req.onblocked = () => {
        try {
          // resolve with result if available to unblock callers
          const maybeDb = (req as any).result as IDBDatabase | undefined;
          if (maybeDb) {
            _dbInstance = maybeDb;
            resolve(maybeDb);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  }).then((db) => {
    // clear promise cache but keep instance
    _dbPromise = null;
    return db;
  });

  return _dbPromise;
}

// alias for older code expecting openDB
export const openDB = openIdb;

/* ---------- kv primitives ---------- */

export async function idbGet<T = any>(key: string): Promise<T | undefined> {
  // IDB first
  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_KV)) {
      const raw = await new Promise<any>((res, rej) => {
        try {
          const tx = db.transaction(STORE_KV, "readonly");
          const st = tx.objectStore(STORE_KV);
          const r = st.get(key);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) {
          rej(e);
        }
      }).catch(() => undefined);

      if (raw !== undefined) {
        try {
          if (typeof raw === "string") {
            try {
              return JSON.parse(raw) as T;
            } catch {
              return raw as unknown as T;
            }
          }
          return raw as T;
        } catch {
          // fall through to LS
        }
      }
    }
  } catch {}

  // LS fallback: primary idb_ prefix
  try {
    const ls = safeLSGet(`idb_${key}`);
    if (ls != null) {
      try {
        return JSON.parse(ls) as T;
      } catch {
        // if parse fails, treat as undefined (original shim returned undefined)
        return undefined;
      }
    }
  } catch {}
  return undefined;
}

export async function idbSet(key: string, val: any): Promise<void> {
  let str: string;
  try {
    str = JSON.stringify(val);
  } catch {
    str = String(val);
  }

  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_KV)) {
      await new Promise<void>((res) => {
        try {
          const tx = db.transaction(STORE_KV, "readwrite");
          const st = tx.objectStore(STORE_KV);
          const r = st.put(str, key);
          r.onsuccess = () => res();
          r.onerror = () => res();
          tx.oncomplete = () => res();
          tx.onerror = () => res();
          tx.onabort = () => res();
        } catch {
          res();
        }
      });
    }
  } catch {}

  try {
    safeLSSet(`idb_${key}`, str);
  } catch {}
}

export async function idbDel(key: string): Promise<void> {
  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_KV)) {
      await new Promise<void>((res) => {
        try {
          const tx = db.transaction(STORE_KV, "readwrite");
          const st = tx.objectStore(STORE_KV);
          const r = st.delete(key);
          r.onsuccess = () => res();
          r.onerror = () => res();
          tx.oncomplete = () => res();
          tx.onerror = () => res();
          tx.onabort = () => res();
        } catch {
          res();
        }
      });
    }
  } catch {}

  try {
    safeLSRemove(`idb_${key}`);
  } catch {}
}

export async function clearAllIDB(): Promise<void> {
  try {
    const db = await openIdb();
    if (db) {
      const targets: string[] = [];
      if (db.objectStoreNames.contains(STORE_KV)) targets.push(STORE_KV);
      if (db.objectStoreNames.contains(STORE_Q)) targets.push(STORE_Q);
      if (db.objectStoreNames.contains(STORE_NOTE_PHOTOS)) targets.push(STORE_NOTE_PHOTOS);
      if (db.objectStoreNames.contains(STORE_PHOTOS)) targets.push(STORE_PHOTOS);

      if (targets.length) {
        await new Promise<void>((res) => {
          try {
            const tx = db.transaction(targets, "readwrite");
            for (const s of targets) {
              try {
                tx.objectStore(s).clear();
              } catch {}
            }
            tx.oncomplete = () => res();
            tx.onerror = () => res();
            tx.onabort = () => res();
          } catch {
            res();
          }
        });
      }
    }
  } catch {}

  // LS cleanup for idb_ prefix
  try {
    if (typeof localStorage !== "undefined") {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("idb_")) toRemove.push(k);
      }
      for (const k of toRemove) {
        try {
          localStorage.removeItem(k);
        } catch {}
      }
    }
  } catch {}
}

/* ---------- queue LS helpers ---------- */

function lsQueueGet(): PersistedMutation[] {
  try {
    const candidates = ["idb_mutation_queue", "idb_queue", "idb_mutationQueue"];
    for (const ck of candidates) {
      const raw = safeLSGet(ck);
      if (!raw) continue;
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr as PersistedMutation[];
      } catch {}
    }
  } catch {}
  return [];
}

function lsQueueSet(list: PersistedMutation[]) {
  try {
    const s = JSON.stringify(list);
    safeLSSet("idb_mutation_queue", s);
    // keep secondary key for older fallbacks
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem("idb_queue", s);
    } catch {}
  } catch {}
}

/* ---------- durable queue ---------- */

export async function idbGetQueue(): Promise<PersistedMutation[]> {
  // 1. Try mutation_queue store (primary)
  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_Q)) {
      const all = await new Promise<any[]>((res) => {
        try {
          const tx = db.transaction(STORE_Q, "readonly");
          const st = tx.objectStore(STORE_Q);
          const req = st.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        } catch {
          res([]);
        }
      });
      if (all && all.length) {
        const parsed = all
          .map((v) => {
            if (!v) return null;
            if (typeof v === "string") {
              try {
                return JSON.parse(v);
              } catch {
                return null;
              }
            }
            return v;
          })
          .filter(Boolean) as PersistedMutation[];
        if (parsed.length) return parsed;
      }
    }
  } catch {}

  // 2. Try kv fallback where App.tsx local wrapper stored array under key 'mutation_queue'
  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_KV)) {
      const kvRaw = await new Promise<any>((res) => {
        try {
          const tx = db.transaction(STORE_KV, "readonly");
          const st = tx.objectStore(STORE_KV);
          const req = st.get("mutation_queue");
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(undefined);
        } catch {
          res(undefined);
        }
      });
      if (kvRaw !== undefined) {
        try {
          const arr = typeof kvRaw === "string" ? JSON.parse(kvRaw) : kvRaw;
          if (Array.isArray(arr) && arr.length) return arr as PersistedMutation[];
        } catch {}
      }
    }
  } catch {}

  // 3. LS fallback
  return lsQueueGet();
}

export async function idbSetQueue(list: PersistedMutation[]): Promise<void> {
  const safeList = Array.isArray(list) ? list.filter((m) => m && (m as any).mutationId) : [];

  try {
    const db = await openIdb();
    if (db) {
      if (db.objectStoreNames.contains(STORE_Q)) {
        await new Promise<void>((res) => {
          try {
            const tx = db.transaction(STORE_Q, "readwrite");
            const st = tx.objectStore(STORE_Q);
            try {
              st.clear();
            } catch {}
            for (const m of safeList) {
              try {
                st.put(m);
              } catch {
                try {
                  (st as any).put(JSON.stringify(m), (m as any).mutationId);
                } catch {}
              }
            }
            tx.oncomplete = () => res();
            tx.onerror = () => res();
            tx.onabort = () => res();
          } catch {
            res();
          }
        });
      }
      if (db.objectStoreNames.contains(STORE_KV)) {
        try {
          const tx = db.transaction(STORE_KV, "readwrite");
          tx.objectStore(STORE_KV).put(JSON.stringify(safeList), "mutation_queue");
        } catch {}
      }
    }
  } catch {}

  lsQueueSet(safeList);
}

export async function idbAddMutation(entry: PersistedMutation): Promise<void> {
  if (!entry || !entry.mutationId) return;

  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_Q)) {
      await new Promise<void>((res) => {
        try {
          const tx = db.transaction(STORE_Q, "readwrite");
          const st = tx.objectStore(STORE_Q);
          try {
            st.put(entry);
          } catch {
            try {
              (st as any).put(JSON.stringify(entry), entry.mutationId);
            } catch {}
          }
          tx.oncomplete = () => res();
          tx.onerror = () => res();
          tx.onabort = () => res();
        } catch {
          res();
        }
      });
    }
  } catch {}

  // LS additive mirror
  try {
    const cur = lsQueueGet();
    const idx = cur.findIndex((m) => m.mutationId === entry.mutationId);
    if (idx >= 0) cur[idx] = entry;
    else cur.push(entry);
    lsQueueSet(cur);
  } catch {}

  // also keep kv mirror for legacy local idbGet
  try {
    const cur = lsQueueGet();
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_KV)) {
      try {
        const tx = db.transaction(STORE_KV, "readwrite");
        tx.objectStore(STORE_KV).put(JSON.stringify(cur), "mutation_queue");
      } catch {}
    }
  } catch {}
}

export async function idbRemoveMutation(mutationId: string): Promise<void> {
  if (!mutationId) return;

  try {
    const db = await openIdb();
    if (db) {
      if (db.objectStoreNames.contains(STORE_Q)) {
        await new Promise<void>((res) => {
          try {
            const tx = db.transaction(STORE_Q, "readwrite");
            const st = tx.objectStore(STORE_Q);
            try {
              st.delete(mutationId);
            } catch {}
            tx.oncomplete = () => res();
            tx.onerror = () => res();
            tx.onabort = () => res();
          } catch {
            res();
          }
        });
      }
      if (db.objectStoreNames.contains(STORE_KV)) {
        try {
          const kvRaw = await new Promise<any>((res) => {
            try {
              const tx = db.transaction(STORE_KV, "readonly");
              const req = tx.objectStore(STORE_KV).get("mutation_queue");
              req.onsuccess = () => res(req.result);
              req.onerror = () => res(undefined);
            } catch {
              res(undefined);
            }
          });
          if (kvRaw !== undefined) {
            try {
              const arr = typeof kvRaw === "string" ? JSON.parse(kvRaw) : kvRaw;
              if (Array.isArray(arr)) {
                const filtered = arr.filter((m: any) => m?.mutationId !== mutationId);
                const tx2 = db.transaction(STORE_KV, "readwrite");
                tx2.objectStore(STORE_KV).put(JSON.stringify(filtered), "mutation_queue");
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch {}

  try {
    const cur = lsQueueGet();
    const filtered = cur.filter((m) => m.mutationId !== mutationId);
    lsQueueSet(filtered);
  } catch {}
}

export async function idbClearQueue(): Promise<void> {
  try {
    const db = await openIdb();
    if (db) {
      if (db.objectStoreNames.contains(STORE_Q)) {
        await new Promise<void>((res) => {
          try {
            const tx = db.transaction(STORE_Q, "readwrite");
            tx.objectStore(STORE_Q).clear();
            tx.oncomplete = () => res();
            tx.onerror = () => res();
            tx.onabort = () => res();
          } catch {
            res();
          }
        });
      }
      if (db.objectStoreNames.contains(STORE_KV)) {
        try {
          const tx = db.transaction(STORE_KV, "readwrite");
          tx.objectStore(STORE_KV).delete("mutation_queue");
        } catch {}
      }
    }
  } catch {}

  try {
    safeLSRemove("idb_mutation_queue");
  } catch {}
  try {
    safeLSRemove("idb_queue");
  } catch {}
}

/* Alias exports for App.tsx future integration */
export const getMutationQueue = idbGetQueue;
export const setMutationQueue = idbSetQueue;
export const addToQueue = idbAddMutation;
export const removeFromQueue = idbRemoveMutation;

/* Back-compat queue helpers previously exported */
export const queueGetAll = idbGetQueue;
export const queueSetAll = idbSetQueue;

/* ---------- photo map ---------- */

export async function idbGetPhotoMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  // 1. note_photos object store individual rows
  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_NOTE_PHOTOS)) {
      const all = await new Promise<any[]>((res) => {
        try {
          const tx = db.transaction(STORE_NOTE_PHOTOS, "readonly");
          const st = tx.objectStore(STORE_NOTE_PHOTOS);
          const req = st.getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        } catch {
          res([]);
        }
      });
      for (const row of all) {
        if (!row) continue;
        if (typeof row === "object") {
          const id = (row as PhotoRow).id;
          const url = (row as PhotoRow).dataUrl || (row as PhotoRow).url || (row as PhotoRow).val;
          if (id && typeof url === "string") out[id] = url;
        }
      }
    }

    // 2. photos generic store may contain map objects (defensive)
    if (db && db.objectStoreNames.contains(STORE_PHOTOS)) {
      try {
        const rows = await new Promise<any[]>((res) => {
          try {
            const tx = db.transaction(STORE_PHOTOS, "readonly");
            const st = tx.objectStore(STORE_PHOTOS);
            const req = st.getAll();
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => res([]);
          } catch {
            res([]);
          }
        });
        for (const r of rows) {
          if (!r || typeof r !== "object" || Array.isArray(r)) continue;
          if ((r as any).id) continue; // already handled as photo row
          for (const [k, v] of Object.entries(r as Record<string, any>)) {
            if (typeof v === "string" && v.startsWith("data:") && !out[k]) out[k] = v;
          }
        }
      } catch {}
    }
  } catch {}

  // 3. kv store 'note_photos' map
  try {
    const db = await openIdb();
    if (db && db.objectStoreNames.contains(STORE_KV)) {
      const kvRaw = await new Promise<any>((res) => {
        try {
          const tx = db.transaction(STORE_KV, "readonly");
          const req = tx.objectStore(STORE_KV).get("note_photos");
          req.onsuccess = () => res(req.result);
          req.onerror = () => res(undefined);
        } catch {
          res(undefined);
        }
      });
      if (kvRaw !== undefined) {
        try {
          const parsed = typeof kvRaw === "string" ? JSON.parse(kvRaw) : kvRaw;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
              if (typeof v === "string" && !out[k]) out[k] = v;
            }
          }
        } catch {}
      }
    }
  } catch {}

  // 4. LS fallbacks
  try {
    const raw = safeLSGet("idb_note_photos");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
            if (typeof v === "string" && !out[k]) out[k] = v;
          }
        }
      } catch {}
    }
  } catch {}

  try {
    const raw2 = safeLSGet("idb_photos");
    if (raw2) {
      try {
        const parsed = JSON.parse(raw2);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
            if (typeof v === "string" && v.startsWith("data:") && !out[k]) out[k] = v;
          }
        }
      } catch {}
    }
  } catch {}

  return out;
}

export async function idbSetPhotoMap(map: Record<string, string>): Promise<void> {
  if (!map || typeof map !== "object") return;
  const entries = Object.entries(map).filter(([k, v]) => k && typeof v === "string");
  if (!entries.length) return;

  try {
    const db = await openIdb();
    if (db) {
      if (db.objectStoreNames.contains(STORE_NOTE_PHOTOS)) {
        await new Promise<void>((res) => {
          try {
            const tx = db.transaction(STORE_NOTE_PHOTOS, "readwrite");
            const st = tx.objectStore(STORE_NOTE_PHOTOS);
            for (const [id, url] of entries) {
              try {
                st.put({ id, dataUrl: url, url, updatedAt: new Date().toISOString() } as any);
              } catch {
                try {
                  (st as any).put({ id, dataUrl: url, updatedAt: new Date().toISOString() }, id);
                } catch {}
              }
            }
            tx.oncomplete = () => res();
            tx.onerror = () => res();
            tx.onabort = () => res();
          } catch {
            res();
          }
        });
      }

      if (db.objectStoreNames.contains(STORE_KV)) {
        try {
          // merge with existing kv map for compat
          const existingRaw = await new Promise<any>((resInner) => {
            try {
              const tx = db.transaction(STORE_KV, "readonly");
              const req = tx.objectStore(STORE_KV).get("note_photos");
              req.onsuccess = () => resInner(req.result);
              req.onerror = () => resInner(undefined);
            } catch {
              resInner(undefined);
            }
          });
          let merged: Record<string, string> = {};
          if (existingRaw !== undefined) {
            try {
              const parsed = typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) merged = parsed as Record<string, string>;
            } catch {}
          }
          merged = { ...merged, ...Object.fromEntries(entries) };
          const tx2 = db.transaction(STORE_KV, "readwrite");
          tx2.objectStore(STORE_KV).put(JSON.stringify(merged), "note_photos");
        } catch {}
      }

      if (db.objectStoreNames.contains(STORE_PHOTOS)) {
        try {
          const tx = db.transaction(STORE_PHOTOS, "readwrite");
          // store merged map as single entry keyed 'photo_map' if generic store is out-of-line
          try {
            tx.objectStore(STORE_PHOTOS).put(JSON.stringify(Object.fromEntries(entries)), "photo_map");
          } catch {
            // if store is keyPath-less, put without key may fail silently — ignore
          }
        } catch {}
      }
    }
  } catch {}

  // LS merge + write (keep light)
  try {
    const rawPrev = safeLSGet("idb_note_photos");
    let merged: Record<string, string> = {};
    if (rawPrev) {
      try {
        const prev = JSON.parse(rawPrev);
        if (prev && typeof prev === "object" && !Array.isArray(prev)) merged = prev;
      } catch {}
    }
    merged = { ...merged, ...Object.fromEntries(entries) };
    safeLSSet("idb_note_photos", JSON.stringify(merged));
  } catch {}
}

/* ---------- public idb bag ---------- */

export const idb = {
  get: idbGet,
  set: idbSet,
  del: idbDel,
  clear: clearAllIDB,
  queueGetAll: idbGetQueue,
  queueSetAll: idbSetQueue,
};
