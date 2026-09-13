import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

export default defineConfig({
  // This container's networking doesn't support the IPv6 wildcard bind Vite's
  // preview server defaults to, which the SPA-shell prerender step above uses
  // internally at build time — force IPv4 so that step can run.
  vite: { base: "/floor/dist/", preview: { host: "127.0.0.1" } },
  // The Cloudflare-oriented "nitro" build restructures server output in a way
  // the SPA prerender step (which just needs a plain Node server build to
  // render the static shell once, at build time) doesn't recognize. Disabling
  // it here only affects this static-shell build path.
  nitro: false,
  tanstackStart: {
    server: { entry: "server" },
    // Toolbox cabinet integration: this app is served as a static SPA at
    // /floor/dist/ inside the Toolbox site instead of its own Cloudflare
    // Worker, so it needs a prerendered shell (spa) and a basepath matching
    // where it's actually hosted. Build-config only — no component changes.
    router: { basepath: "/floor/dist" },
    spa: { enabled: true },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      devOptions: { enabled: false },
      injectManifest: {
        swDest: resolve(process.cwd(), "dist/sw.js"),
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        globIgnores: ["**/node_modules/**", "**/*.map", "sw.js", "workbox-*.js"],
        manifestTransforms: [
          async (entries) => {
            const manifest = entries
              .filter((entry) => !entry.url.startsWith("server/"))
              .map((entry) =>
                entry.url.startsWith("client/")
                  ? { ...entry, url: entry.url.slice("client/".length) }
                  : entry,
              );
            return { manifest, warnings: [] };
          },
        ],
        additionalManifestEntries: [{ url: "/", revision: null }],
      },
    }),
  ],
});
