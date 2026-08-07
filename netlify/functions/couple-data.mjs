// Hardened Netlify Blobs function - v2 API only
import { getStore } from "@netlify/blobs";

const TOKEN = "ash-ciaran-2026";
const STORE_NAME = "nylah-os-ash-v1";

function headers(extra={}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Content-Type": "application/json",
    ...extra,
  };
}

function needStrong() {
  try { return { name: STORE_NAME, consistency: "strong" }; }
  catch { return STORE_NAME; }
}

export default async (req, context) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const cb = url.searchParams.get("callback") || "";
  const debug = url.searchParams.has("debug");

  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: headers() });
  }

  // Build store - v2 auto-injects siteID/token in prod. Provide fallback debug.
  let store;
  let storeErr = null;
  try {
    // Preferred: object form with strong consistency
    store = getStore({ name: STORE_NAME, consistency: "strong" });
  } catch (e1) {
    try {
      // Fallback: string name form
      store = getStore(STORE_NAME);
    } catch (e2) {
      storeErr = (e1?.message||e1) + " | " + (e2?.message||e2);
    }
  }

  if (!store) {
    const payload = { ok: false, error: "store init failed", detail: String(storeErr), env: { hasBLOBS_CTX: !!process.env.NETLIFY_BLOBS_CONTEXT, hasSITE_ID: !!process.env.SITE_ID, node: process.version, contextKeys: context ? Object.keys(context) : null } };
    if (cb) return new Response(`${cb}(${JSON.stringify(payload)})`, { headers: { "Content-Type":"text/javascript", ...headers() }});
    return new Response(JSON.stringify(payload), { status: 500, headers: headers() });
  }

  if (req.method === "GET") {
    if (token && token !== TOKEN) {
      return new Response(JSON.stringify({ ok:false, error:"forbidden" }), { status:403, headers: headers() });
    }
    try {
      // Read each blob with strong consistency when possible
      const [chores, calendar, shopping, notes, meta] = await Promise.all([
        store.get("chores", { type:"json", consistency:"strong" }).then(v=>v||[]).catch(()=>[]),
        store.get("calendar", { type:"json", consistency:"strong" }).then(v=>v||[]).catch(()=>[]),
        store.get("shopping", { type:"json", consistency:"strong" }).then(v=>v||[]).catch(()=>[]),
        store.get("notes", { type:"json", consistency:"strong" }).then(v=>v||[]).catch(()=>[]),
        store.get("meta", { type:"json", consistency:"strong" }).then(v=>v||null).catch(()=>null),
      ]);
      const payload = {
        ok:true,
        data: { Chores: chores, Calendar: calendar, Shopping: shopping, Notes: notes, "Love Notes": [], meta },
        ts: new Date().toISOString(),
        store: STORE_NAME,
        counts: { c: chores.length, cal: calendar.length, s: shopping.length, n: notes.length },
        debug: debug ? { storeErr, envCheck: !!process.env.NETLIFY_BLOBS_CONTEXT } : undefined
      };
      const body = JSON.stringify(payload);
      if (cb) return new Response(`${cb}(${body})`, { headers: { "Content-Type":"text/javascript", ...headers() }});
      return new Response(body, { headers: headers() });
    } catch(e) {
      return new Response(JSON.stringify({ ok:false, error: String(e), stack: e.stack }), { status:500, headers: headers() });
    }
  }

  if (req.method === "POST") {
    let txt=""; try { txt = await req.text(); } catch {}
    let data=null;
    if (txt) {
      try {
        data = JSON.parse(txt);
        // If frontend wrapped as {data: "urlencodedjson"}
        if (data && typeof data.data === "string") {
          try { data = JSON.parse(decodeURIComponent(data.data)); } catch {}
        }
      } catch {
        if (txt.startsWith("data=")) {
          try {
            let raw = txt.slice(5);
            try { raw = decodeURIComponent(raw); } catch {}
            data = JSON.parse(raw);
          } catch {}
        }
      }
    }
    if (!data) data = {};
    if (!data.token) data.token = token;
    if (data.token !== TOKEN && token !== TOKEN) {
      return new Response(JSON.stringify({ ok:false, error:"forbidden" }), { status:403, headers: headers() });
    }
    try {
      const wrote=[];
      // IMPORTANT: only overwrite lists that are actually provided AND non-empty unless explicit allowEmpty
      // Prevents empty incognito tab from wiping your real data
      const allowEmpty = !!data.allowEmpty;

      if (Array.isArray(data.chores)) {
        if (data.chores.length>0 || allowEmpty) { await store.setJSON("chores", data.chores); wrote.push("c"+data.chores.length); }
      }
      if (Array.isArray(data.calendar)) {
        if (data.calendar.length>0 || allowEmpty) { await store.setJSON("calendar", data.calendar); wrote.push("cal"+data.calendar.length); }
      }
      if (Array.isArray(data.shopping)) {
        if (data.shopping.length>0 || allowEmpty) { await store.setJSON("shopping", data.shopping); wrote.push("s"+data.shopping.length); }
      }
      if (Array.isArray(data.notes)) {
        if (data.notes.length>0 || allowEmpty) { await store.setJSON("notes", data.notes); wrote.push("n"+data.notes.length); }
      }
      if (data.fridgeMeta || data.meta) {
        await store.setJSON("meta", data.fridgeMeta || data.meta);
        wrote.push("meta");
      }

      return new Response(JSON.stringify({ ok:true, wrote: wrote.join(","), strong:true }), { headers: headers() });
    } catch(e) {
      return new Response(JSON.stringify({ ok:false, error: String(e) }), { status:500, headers: headers() });
    }
  }

  return new Response(JSON.stringify({ ok:false, error:"method not allowed" }), { status:405, headers: headers() });
};
