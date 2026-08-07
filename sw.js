// Beirt SW v134 light scoreboard
const CACHE_NAME = 'beirt-v135-editorial-board
const URLS = ["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(URLS.map(u=>new Request(u,{cache:"reload"}))).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch", e=>{
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r=>{ if (r.ok) { const clone=r.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request,clone)); } return r; }).catch(()=>caches.match(e.request)));
});
