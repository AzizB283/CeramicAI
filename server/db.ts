import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Apply pending Drizzle migrations against the connected database. Intended
 * to be called once at boot on Render (RUN_MIGRATIONS=true) so a fresh
 * deploy schemas itself. Safe to no-op when nothing has changed.
 *
 * The migrations folder lives at the repo root. Resolve it relative to this
 * file so it works both for the TS source (server/db.ts → ../migrations)
 * and the bundled CJS (dist/server.cjs → ../migrations).
 */
export async function runMigrations(): Promise<void> {
  // Resolve the migrations folder to <repoRoot>/migrations in both runtime
  // contexts:
  //   - dev (tsx in ESM mode): __dirname is NOT defined; derive from
  //     import.meta.url. server/db.ts → server/.. = repo root.
  //   - prod (bundled CJS): __dirname IS defined; import.meta.url isn't.
  //     dist/server.cjs → dist/.. = repo root.
  const here =
    typeof __dirname !== "undefined"
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, "..", "migrations");
  console.log(`[db] applying migrations from ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log("[db] migrations up to date");
}
