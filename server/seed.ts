import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "./db";
import { ceramicClients } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";

const DEMO_CLIENT_NAME = "Shree Tiles Pvt Ltd (Demo)";
export const DEMO_CLIENT_SLUG = "demo";

let cachedId: string | null = null;

/** Ensure exactly one demo client exists; return its id (cached after first call). */
export async function ensureDemoClient(): Promise<string> {
  if (cachedId) return cachedId;
  const [existing] = await db
    .select()
    .from(ceramicClients)
    .where(eq(ceramicClients.name, DEMO_CLIENT_NAME))
    .limit(1);
  if (existing) {
    cachedId = existing.id;
    // Backfill the slug on existing demo rows from before the column existed.
    if (!existing.slug) {
      await storage.updateClient(cachedId, { slug: DEMO_CLIENT_SLUG });
    }
    return cachedId;
  }
  const created = await storage.createClient({
    slug: DEMO_CLIENT_SLUG,
    name: DEMO_CLIENT_NAME,
    mode: "factory",
    ownerName: "Demo Owner",
    ownerWhatsapp: "+910000000000",
    ownerEmail: "owner@example.com",
    catalogUrl: "https://aurexauto.com/demo/catalog-factory.pdf",
    exportCatalogUrl: "https://aurexauto.com/demo/catalog-export.pdf",
  });
  cachedId = created.id;
  return cachedId;
}

const BCRYPT_ROUNDS = 12;

/**
 * Bootstrap the panel logins. Idempotent — safe to run every boot.
 *
 *  1. A cross-tenant **superadmin** (Aurex Auto operator). Created from
 *     SUPERADMIN_USERNAME / SUPERADMIN_PASSWORD env, or a generated password
 *     printed once to stdout if no password is set. clientId is null.
 *  2. A **factory admin** bound to the demo client, seeded from the existing
 *     ADMIN_USERNAME / ADMIN_PASSWORD env (defaults admin / admin123) so the
 *     current demo login keeps working after the auth migration.
 *
 * Nothing is overwritten: if a user with the target username already exists we
 * leave it untouched (so a manually-changed password isn't clobbered).
 */
export async function seedAdminUsers(): Promise<void> {
  // ── superadmin ──
  const username = process.env.SUPERADMIN_USERNAME ?? "superadmin";
  const envPw = process.env.SUPERADMIN_PASSWORD;
  const existing = await storage.getAdminUserByUsername(username);

  if (!existing) {
    // First boot for this superadmin username — create it.
    const password = envPw ?? crypto.randomBytes(12).toString("base64url");
    await storage.createAdminUser({
      clientId: null,
      username,
      password: await bcrypt.hash(password, BCRYPT_ROUNDS),
      name: "Super Admin",
      role: "superadmin",
      active: true,
    });
    if (envPw) {
      console.log(`[seed] superadmin created (username: ${username})`);
    } else {
      // Printed ONCE, never written to a file. Operator must copy it now.
      console.log(
        `[seed] superadmin created — username: ${username}  password: ${password}\n` +
          `[seed] ^ set SUPERADMIN_PASSWORD to control this; copy it now, it won't be shown again.`,
      );
    }
  } else if (envPw && existing.role === "superadmin") {
    // The superadmin already exists. Treat SUPERADMIN_PASSWORD as the source of
    // truth: if it's set and doesn't match the stored hash, re-sync it. This
    // makes "set the env var and redeploy" actually change the password (the
    // earlier create-only behaviour silently ignored env changes after the
    // first boot). No-op when the password already matches.
    const matches = await bcrypt.compare(envPw, existing.password);
    if (!matches) {
      await storage.updateAdminUser(existing.id, {
        password: await bcrypt.hash(envPw, BCRYPT_ROUNDS),
      });
      console.log(`[seed] superadmin password re-synced from SUPERADMIN_PASSWORD (username: ${username})`);
    }
  }

  // ── demo factory admin (keeps the existing demo login working) ──
  const demoUsername = process.env.ADMIN_USERNAME ?? "admin";
  const existingDemoAdmin = await storage.getAdminUserByUsername(demoUsername);
  if (!existingDemoAdmin) {
    const demoClientId = await ensureDemoClient();
    const demoPassword = process.env.ADMIN_PASSWORD ?? "admin123";
    await storage.createAdminUser({
      clientId: demoClientId,
      username: demoUsername,
      password: await bcrypt.hash(demoPassword, BCRYPT_ROUNDS),
      name: "Demo Factory Admin",
      role: "factory",
      active: true,
    });
    console.log(`[seed] demo factory admin created (username: ${demoUsername})`);
  }
}
