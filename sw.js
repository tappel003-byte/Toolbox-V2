// Toolbox app-shell service worker. Caches the static files (HTML/CSS/JS/
// vendor libs/icons) so the app itself loads with zero connectivity after
// the first visit — customer data was already offline-safe in IndexedDB,
// this closes the other half: the field crew's actual jobsite usually has
// no reliable signal, and the app shell shouldn't need one either.
//
// Bump CACHE_NAME on any real deploy so activate() cleans out the old
// shell instead of serving stale files forever.
const CACHE_NAME = 'toolbox-shell-v1';

const PRECACHE_URLS = [
  './',
  'index.html',
  'job.html',
  'customer.html',
  'report.html',
  'diagnostics.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/util.js',
  'js/db.js',
  'js/home.js',
  'js/job.js',
  'js/room-ocr.js',
  'js/customer.js',
  'js/drawer-import.js',
  'js/report.js',
  'js/floor-survey-math.js',
  'js/topo-grid.js',
  'js/diagnostics.js',
  'js/vendor/jspdf.umd.min.js',
  'js/vendor/three.min.js',
  'js/vendor/OrbitControls.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first for everything this app actually serves (same-origin GET).
// A hit returns instantly and offline; a miss falls back to the network
// and quietly stores the result for next time. Never intercepts anything
// cross-origin or non-GET — there isn't a server here to proxy for.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    // ignoreSearch matters here: almost every real navigation in this app
    // carries a ?job=<key> query string (job.html?job=..., report.html?job=...,
    // etc.) — without it, the Cache API's default exact-URL match would miss
    // every one of those against the plain "job.html" precache entry, and
    // every navigation past the very first index.html load would require
    // network, defeating the entire point of precaching the shell.
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Not precached and offline: nothing sensible to fall back to (a
    // customer's plan photo Blob lives in IndexedDB, not here, so this
    // path only fires for something outside the app shell) — let the
    // fetch rejection surface normally.
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  })());
});
