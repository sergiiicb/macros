// Service worker: l'app funciona sense connexió un cop oberta per primer cop.
const VERSION = "macros-v1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "core.js", "foods.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== "macros-cdn").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Fitxers de l'app: xarxa primer (per rebre actualitzacions), memòria cau si no hi ha connexió
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
    return;
  }
  // Lector d'etiquetes (Tesseract) des del CDN: memòria cau primer
  if (url.hostname === "cdn.jsdelivr.net" || url.hostname.endsWith("projectnaptha.com")) {
    e.respondWith(caches.open("macros-cdn").then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
  }
});
