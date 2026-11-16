// Service worker: deja la app lista para funcionar sin internet.
// - Archivos de la app: se guardan al instalar y se actualizan solos en segundo plano.
// - Mosaicos del mapa y Leaflet: se guardan a medida que se ven (para tener el mapa a mano sin señal).
const VERSION = "v1";
const CACHE_APP = "acqua-app-" + VERSION;
const CACHE_MAPA = "acqua-mapa-v1";
const MAX_MOSAICOS = 600;

const ARCHIVOS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/geo.js",
  "./js/map.js",
  "./js/summary.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./lib/leaflet/leaflet.js",
  "./lib/leaflet/leaflet.css"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((k) => k.startsWith("acqua-app-") && k !== CACHE_APP).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function recortar(cache) {
  const claves = await cache.keys();
  if (claves.length > MAX_MOSAICOS) {
    await Promise.all(claves.slice(0, claves.length - MAX_MOSAICOS).map((k) => cache.delete(k)));
  }
}

async function conActualizacion(req, nombreCache, recortarCache) {
  const cache = await caches.open(nombreCache);
  const guardado = await cache.match(req);
  const red = fetch(req)
    .then((resp) => {
      if (resp && (resp.ok || resp.type === "opaque")) {
        cache.put(req, resp.clone()).then(() => recortarCache && recortar(cache));
      }
      return resp;
    })
    .catch(() => null);
  return guardado || (await red) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") {
      e.respondWith(
        caches.match("./index.html").then((r) => r || fetch(req)).catch(() => caches.match("./index.html")),
      );
      return;
    }
    e.respondWith(conActualizacion(req, CACHE_APP, false));
    return;
  }

  const hosts = ["tile.openstreetmap.org", "server.arcgisonline.com", "unpkg.com"];
  if (hosts.includes(url.hostname)) {
    e.respondWith(conActualizacion(req, CACHE_MAPA, true));
  }
});
