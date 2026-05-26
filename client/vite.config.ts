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
    proxy: {
      "/api": "http://localhost:5000",
    },
    // Poll instead of OS inotify watchers — avoids ENOSPC "file watchers
    // limit reached" on systems with a low fs.inotify.max_user_watches.
    watch: { usePolling: true, interval: 300 },
  },
});
