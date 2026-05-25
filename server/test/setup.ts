import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

// Env lives at the repo root: server/test/setup.ts → ../../ → repo root.
const root = fileURLToPath(new URL("../../", import.meta.url));
dotenv.config({ path: `${root}.env` });
dotenv.config({ path: `${root}.env.local`, override: true });

// A 32-byte hex test key so encryption helpers work in tests if not set.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
}
