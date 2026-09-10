/// <reference lib="webworker" />
// Custom service worker source used by vite-plugin-pwa's injectManifest strategy.
// Workbox injects the precache manifest into self.__WB_MANIFEST at build time.

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// Precache the built assets injected by workbox-build.
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// HTML navigations — NetworkFirst so users get fresh HTML online,
// fall back to cached shell offline.
registerRoute(
  ({ request, url }) =>
    request.mode === "navigate" &&
    !url.pathname.startsWith("/~oauth") &&
    !url.pathname.startsWith("/api/"),
  new NetworkFirst({
    cacheName: "html-navigations",
    networkTimeoutSeconds: 3,
    plugins: [new ExpirationPlugin({ maxEntries: 32 })],
  }),
);

// Same-origin built assets (hashed JS/CSS/worker) — cache-first for
// instant offline cold-start of the app shell.
registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin &&
    (request.destination === "script" ||
      request.destination === "style" ||
      request.destination === "worker") &&
    !url.pathname.startsWith("/~oauth") &&
    !url.pathname.startsWith("/api/"),
  new CacheFirst({
    cacheName: "app-shell-assets",
    plugins: [new ExpirationPlugin({ maxEntries: 128 })],
  }),
);

// Offline navigation fallback — serve the precached "/" shell.
setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const cache = await caches.open("html-navigations");
    const cached = await cache.match("/");
    if (cached) return cached;

    // Defensive fallback: some Workbox precache manifests are stored under
    // a "precache" or "workbox-" cache name rather than our custom navigations
    // cache. Do a single "/" lookup there before giving up.
    try {
      const names = await caches.keys();
      for (const name of names) {
        const lower = name.toLowerCase();
        if (lower.includes("precache") || name.startsWith("workbox-")) {
          const fallbackCache = await caches.open(name);
          const fallback = await fallbackCache.match("/");
          if (fallback) return fallback;
        }
      }
    } catch {
      // Ignore and fall through to Response.error().
    }
  }
  return Response.error();
});

// Take over as soon as a new version installs so users always get the
// latest code the next time the app is backgrounded/reopened. The app
// side defers the reload to a safe moment.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Legacy: still honor an explicit SKIP_WAITING message if anything sends one.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
