// Офлайн-кеш для планшета в цеху: спершу мережа (свіжа версія), без мережі — остання збережена копія.
const CACHE = "assembly-v1";
const CORE = ["index.html", "model.html", "qr.html", "assets/style.css", "assets/model.js", "assets/viewer3d.js",
  "assets/drawings.js", "vendor/three.min.js", "vendor/OrbitControls.js", "vendor/qrcode.js", "data/models/index.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: !url.pathname.includes("/data/") })));
});
