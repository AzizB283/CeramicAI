/**
 * Env preloader. Imported (as a side effect) by `server/index.ts` before any
 * module that reads `process.env` at top-level — notably `db.ts`, which
 * throws if `DATABASE_URL` is missing at load time.
 *
 * - In dev: loads `.env` then `.env.local` (override) from the repo cwd, so
 *   `npm run dev:server` or `tsx server/index.ts` both work without flag
 *   gymnastics.
 * - In prod on Render: the platform injects env vars directly; the files
 *   don't exist and dotenv simply no-ops with a warning, which is fine.
 *
 * Why this exists as its own module: a plain `dotenv.config()` call at the
 * top of index.ts runs AFTER imports finish resolving, and any imported
 * module that touches process.env at load time has already failed by then.
 * A side-effect import is the ESM-equivalent of `-r dotenv/config`.
 */

import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });
