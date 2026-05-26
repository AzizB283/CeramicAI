import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "node:path";
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
  // `__dirname` is defined under tsx (CJS shim) and the bundled CJS alike,
  // so this resolves to <repoRoot>/migrations in both contexts: dev (tsx
  // running server/db.ts → server/.. = repo root) and prod (bundle at
  // dist/server.cjs → dist/.. = repo root).
  const migrationsFolder = path.resolve(__dirname, "..", "migrations");
  console.log(`[db] applying migrations from ${migrationsFolder}…`);
  await migrate(db, { migrationsFolder });
  console.log("[db] migrations up to date");
}
