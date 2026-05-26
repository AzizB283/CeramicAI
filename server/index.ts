// IMPORTANT: this side-effect import MUST be first — it loads `.env` /
// `.env.local` before any module that reads `process.env` at top-level.
import "./env";

import { buildApp } from "./app";
import { ensureDemoClient } from "./seed";
import { runMigrations } from "./db";

const PORT = Number(process.env.PORT ?? 5000);

async function main() {
  // Always apply pending migrations on boot. Drizzle's migrator is idempotent —
  // it tracks applied migrations in `drizzle.__drizzle_migrations` and no-ops
  // when everything is up to date — so running this every start is safe and
  // removes one thing that can be misconfigured per environment. Matches
  // clinic-ai's pattern.
  await runMigrations();

  await ensureDemoClient(); // seed before accepting traffic

  const app = buildApp();
  app.listen(PORT, () => {
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    console.log(
      `[server] CeramicBot ${mode} server listening on http://localhost:${PORT}`,
    );
  });
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
