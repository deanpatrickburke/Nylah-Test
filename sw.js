// Beirt SW v130 onboarding fix - fresh browser shows Create our space
const CACHE_NAME = "beirt-v131-championship-arena";
const URLS = ["./","./index.html","./manifest.webmanifest"];
self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(URLS.map(u=>new Request(u,{cache:"reload"}))).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener("activate", e=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.map(k=> k!==CACHE_NAME ? caches.delete(k) : null))));
  self.clients.claim();
});
self.addEventListener("push", e=>{
  const data = e.data ? e.data.json() : {};
  const title = data.title || "Beirt";
  const body = data.body || "New chore for you";
  e.waitUntil(self.registration.showNotification(title, {body, vibrate:[200,100,200], data:{url:data.url||"./"}}));
});
self.addEventListener("notificationclick", e=>{
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url || "./"));
});
self.addEventListener("fetch", e=>{
  if(e.request.method!=="GET") return;
  const url = new URL(e.request.url);
  if(url.origin!==location.origin) return;
  if(url.pathname.includes("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".webmanifest")){
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request).then(res=>{
      const clone=res.clone(); caches.open(CACHE_NAME).then(c=>c.put(e.request, clone)).catch(()=>{});
      return res;
    }).catch(()=>caches.match("./index.html"))));
    return;
  }
  if(e.request.mode==="navigate"){
    e.respondWith(fetch(e.request).catch(()=>caches.match("./index.html").then(r=>r||caches.match("./"))));
  }
});
