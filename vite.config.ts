// PWA (vite-plugin-pwa) deferred: half-configured service worker is worse than none. Add later.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: { "~": new URL("./src", import.meta.url).pathname },
  },
});
