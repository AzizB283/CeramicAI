// IMPORTANT: this side-effect import MUST be first — it loads `.env` /
// `.env.local` before any module that reads `process.env` at top-level.
import "./env";

import { buildApp } from "./app";
import { ensureDemoClient } from "./seed";
import { runMigrations } from "./db";

const PORT = Number(process.env.PORT ?? 5000);

async function main() {
  // Apply pending migrations on boot when explicitly enabled. On Render this
  // is set to "true" so a fresh deploy schemas itself; locally we keep it
  // false to avoid surprises during development (use `npm run db:push`).
  if (process.env.RUN_MIGRATIONS === "true") {
    await runMigrations();
  }

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
