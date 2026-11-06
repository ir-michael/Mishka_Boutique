// Service worker : l'application démarre instantanément et reste utilisable sans réseau.
// Stratégie : réseau d'abord pour nos fichiers (toujours la dernière version), cache en secours.
// Firebase (données) gère lui-même le mode hors ligne via son cache local.
const CACHE = "boutique-v1";
const SHELL = ["./", "index.html", "css/style.css", "manifest.webmanifest", "icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin;
  const lib = /(^|\.)gstatic\.com$|cdn\.jsdelivr\.net$/.test(url.hostname);   // SDK Firebase + Chart.js
  if (!ours && !lib) return;                                                // Firestore, Cloudinary… : jamais en cache
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
