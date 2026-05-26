import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * In production the server serves the built client (Vite output) and
 * falls back to index.html for any path it didn't handle — so client-side
 * routes like /admin/leads or /chat still work on direct visit.
 *
 * In production this runs inside the bundled CJS at dist/server.cjs, so
 * dist/public/ is the right relative location. In dev this isn't called
 * (the guard in app.ts skips it when NODE_ENV !== "production"), but we
 * still use the same dual-path trick as db.ts so the file is safe under
 * both runtimes.
 */
export function serveStatic(app: Express) {
  const here =
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(here, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the built client at ${distPath}. ` +
        `Make sure to run \`npm run build\` before \`npm start\`.`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback: anything we didn't already route gets index.html so the
  // client-side router takes over.
  app.use((_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
