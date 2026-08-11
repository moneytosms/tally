import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "tally",
        short_name: "tally",
        description: "Self-hosted expense splitting for friend groups.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#5c7355",
        background_color: "#f7f4ec",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the built shell and bundles — and NOTHING else.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // There is deliberately NO runtimeCaching rule.
        //
        // "Never cache API responses in the service worker. A stale balance is
        // worse than no balance." (CLAUDE.md, SPEC §10.) A catch-all rule that
        // merely excludes /api/ is the wrong shape for that requirement: it
        // caches by default and relies on an exclusion staying correct forever.
        // Precaching the shell is an allowlist and cannot drift.
        //
        // It would also fight "updates prompt, never auto-reload" — a
        // CacheFirst HTML document serves a stale shell to someone who
        // dismissed the prompt.
      },
    }),
  ],
  resolve: {
    alias: { "~": new URL("./src", import.meta.url).pathname },
  },
});
