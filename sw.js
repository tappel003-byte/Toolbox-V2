// Toolbox app-shell service worker.
// Bump CACHE_NAME on any real deploy so activate() drops a poisoned cache.
const CACHE_NAME = 'toolbox-shell-v2';

const PRECACHE_URLS = [
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

function isRedirect(res) {
  return !res || res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400) || res.redirected;
}

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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const url = new URL(req.url);
    const path = url.pathname;
    const isRootNav = req.mode === 'navigate' && (path === '/' || path === '');

    const matchReq = isRootNav ? new Request(new URL('index.html', self.registration.scope)) : req;
    const cached = await caches.match(matchReq, { ignoreSearch: true });
    if (cached && !isRedirect(cached)) return cached;

    const res = await fetch(req, { redirect: 'follow' });
    if (isRedirect(res)) {
      const followed = await fetch(isRootNav ? new URL('index.html', self.registration.scope) : req, { redirect: 'follow' });
      if (followed.ok && !isRedirect(followed)) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(isRootNav ? 'index.html' : req, followed.clone());
        return followed;
      }
    }
    if (res.ok && !isRedirect(res)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(isRootNav ? 'index.html' : req, res.clone());
    }
    return res;
  })());
});
