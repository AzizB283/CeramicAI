import express, { type Express } from "express";
import fs from "node:fs";
import path from "node:path";

/**
 * In production the server serves the built client (Vite output) and
 * falls back to index.html for any path it didn't handle — so client-side
 * routes like /admin/leads or /chat still work on direct visit.
 *
 * This module is only called from the bundled CJS at dist/server.cjs, so
 * `__dirname` is always defined here. The built client sits at dist/public/
 * alongside the bundle.
 */
export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

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
