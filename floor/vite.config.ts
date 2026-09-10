import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
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
