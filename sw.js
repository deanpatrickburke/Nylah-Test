// Beirt SW v132 transparent logo
const CACHE_NAME = 'beirt-v132-v3-clear';
const URLS = ["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(URLS.map(u=>new Request(u,{cache:"reload"}))).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.map(k=> k!==CACHE_NAME ? caches.delete(k) : null))));
  self.clients.claim();
});
self.addEventListener("fetch", e=>{
  if (e.request.method!=="GET") return;
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fetchPromise = fetch(e.request).then(res=>{
        if(res && res.status===200 && res.type==="basic"){
          const clone=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request, clone)).catch(()=>{});
        }
        return res;
      }).catch(()=> cached);
      return cached || fetchPromise;
    })
  );
});
