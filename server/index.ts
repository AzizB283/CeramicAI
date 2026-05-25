import dotenv from "dotenv";
import { buildApp } from "./app";
import { ensureDemoClient } from "./seed";

// Load env from the repo root (server runs from there via the root script).
dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const PORT = Number(process.env.PORT ?? 5000);

async function main() {
  await ensureDemoClient(); // seed before accepting traffic
  const app = buildApp();
  app.listen(PORT, () => {
    console.log(`[server] CeramicBot API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
