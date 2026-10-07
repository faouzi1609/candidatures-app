// Met l'appli en cache pour l'installer et l'ouvrir vite ; les données GitHub ne sont jamais mises en cache.
const VERSION = "candidatures-v1";
const COQUILLE = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Réseau d'abord (pour toujours avoir la dernière version), cache en secours hors connexion.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copie = r.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copie));
        return r;
      })
      .catch(() => caches.match(e.request)),
  );
});
