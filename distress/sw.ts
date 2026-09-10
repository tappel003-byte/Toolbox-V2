/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { NetworkFirst, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

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

setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const cache = await caches.open("html-navigations");
    const cached =
      (await cache.match("/survey.html")) ||
      (await cache.match("/"));
    if (cached) return cached;

    const allCacheNames = await caches.keys();

    for (const name of allCacheNames) {
      const looksLikePrecache =
        name.toLowerCase().includes("precache") || name.startsWith("workbox-");
      if (!looksLikePrecache) continue;
      const precache = await caches.open(name);
      const precachedResponse =
        (await precache.match("/survey.html")) ||
        (await precache.match("/"));
      if (precachedResponse) return precachedResponse;
    }

    const htmlNavKeys = await cache.keys().then((keys) => keys.map((k) => k.url));

    const precacheMatches: Array<{
      name: string;
      hasSurvey: boolean;
      hasRequest: boolean;
    }> = [];
    for (const name of allCacheNames) {
      const looksLikePrecache =
        name.toLowerCase().includes("precache") || name.startsWith("workbox-");
      if (!looksLikePrecache) continue;
      const precache = await caches.open(name);
      const [hasSurvey, hasRequest] = await Promise.all([
        precache
          .match(new Request("/survey.html"))
          .then((r) => !!r)
          .catch(() => false),
        precache
          .match(new Request(request.url))
          .then((r) => !!r)
          .catch(() => false),
      ]);
      if (looksLikePrecache || hasSurvey || hasRequest) {
        precacheMatches.push({ name, hasSurvey, hasRequest });
      }
    }

    function escapeHtml(str: string): string {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Offline Diagnostic</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 1rem; line-height: 1.5; color: #111; background: #f4f0e8; }
  h1 { font-size: 1.1rem; margin-top: 0; }
  pre { white-space: pre-wrap; word-break: break-all; background: #fff; padding: .75rem; border: 1px solid #ccc; border-radius: .25rem; font-size: .85rem; }
  .section { margin-bottom: 1.25rem; }
</style>
</head>
<body>
  <h1>App could not load offline</h1>
  <div class="section">
    <strong>Requested URL</strong>
    <pre>${escapeHtml(request.url)}</pre>
  </div>
  <div class="section">
    <strong>Cache names currently present</strong>
    <pre>${allCacheNames.length ? allCacheNames.map(escapeHtml).join("\n") : "(none)"}</pre>
  </div>
  <div class="section">
    <strong>Keys in "html-navigations"</strong>
    <pre>${htmlNavKeys.length ? htmlNavKeys.map(escapeHtml).join("\n") : "(none)"}</pre>
  </div>
  <div class="section">
    <strong>Workbox precache matches</strong>
    <pre>${precacheMatches.length
      ? precacheMatches
          .map(
            (m) =>
              `${escapeHtml(m.name)}\n  /survey.html: ${m.hasSurvey ? "YES" : "no"}\n  ${escapeHtml(request.url)}: ${m.hasRequest ? "YES" : "no"}`,
          )
          .join("\n")
      : "(no workbox precache cache found)"}</pre>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }
  return Response.error();
});

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
