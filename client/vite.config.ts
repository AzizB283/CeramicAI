import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": here("./src"),
      "@shared": here("../shared"),
    },
  },
  server: {
    port: 5173,
    host: true,
    // Accept any Host header. Needed when fronting the dev server with a
    // tunnel (ngrok / Cloudflare Tunnel / Render preview) so requests with
    // arbitrary hostnames aren't rejected by Vite's host check.
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:5000",
    },
    // Poll instead of OS inotify watchers — avoids ENOSPC "file watchers
    // limit reached" on systems with a low fs.inotify.max_user_watches.
    watch: { usePolling: true, interval: 300 },
  },
});
