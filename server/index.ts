// IMPORTANT: this side-effect import MUST be first — it loads `.env` /
// `.env.local` before any module that reads `process.env` at top-level.
import "./env";

import { buildApp } from "./app";
import { ensureDemoClient, seedAdminUsers } from "./seed";
import { runMigrations } from "./db";
import { startKeepAlive } from "./services/keepAlive";
import { startEmailScheduler } from "./services/emailScheduler";

const PORT = Number(process.env.PORT ?? 5000);

async function main() {
  // Always apply pending migrations on boot. Drizzle's migrator is idempotent —
  // it tracks applied migrations in `drizzle.__drizzle_migrations` and no-ops
  // when everything is up to date — so running this every start is safe and
  // removes one thing that can be misconfigured per environment. Matches
  // clinic-ai's pattern.
  await runMigrations();

  await ensureDemoClient(); // seed the demo factory before accepting traffic
  await seedAdminUsers(); // bootstrap superadmin + demo factory-admin logins

  const app = buildApp();
  app.listen(PORT, () => {
    const mode = process.env.NODE_ENV === "production" ? "production" : "development";
    console.log(
      `[server] CeramicBot ${mode} server listening on http://localhost:${PORT}`,
    );
    // Keep the Render free-tier instance warm by self-pinging /health every
    // 10 min. Only in production — locally there's no idle-spindown to fight,
    // and a dev self-ping just spams the console.
    if (process.env.NODE_ENV === "production") {
      startKeepAlive(PORT);
    }
    // Poll connected Gmail inboxes every 5 min. No-ops (with a logged warning)
    // when Google OAuth isn't configured, so dev without creds stays quiet.
    startEmailScheduler();
  });
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
