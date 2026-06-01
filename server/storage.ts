import { eq, and, lte, desc, asc, sql, count, type SQL } from "drizzle-orm";
import { db } from "./db";
import { currentClientId, getTenantMode } from "./middleware/tenant";
import {
  ceramicClients,
  ceramicLeads,
  ceramicFollowups,
  ceramicCatalogues,
  ceramicProducts,
  adminUsers,
  superadminActions,
  type CeramicClient,
  type InsertCeramicClient,
  type CeramicLead,
  type InsertCeramicLead,
  type CeramicFollowup,
  type InsertCeramicFollowup,
  type CeramicCatalogue,
  type InsertCeramicCatalogue,
  type CeramicProduct,
  type InsertCeramicProduct,
  type AdminUser,
  type InsertAdminUser,
  type InsertSuperadminAction,
} from "@shared/schema";
import { encrypt, decrypt, isEncrypted, hashPhone } from "./utils/encryption";

// ── tenant scoping (ported from clinic-connect) ─────────────────────────
function scope(column: any): SQL | undefined {
  const cid = currentClientId();
  if (cid) return eq(column, cid);
  if (getTenantMode() === "multi") {
    throw new Error(
      "Tenant context missing — storage call made outside runWithClient. " +
        "Wrap the caller in runWithClient(clientId, () => { ... }).",
    );
  }
  // single mode: no predicate; drizzle's and() drops undefined args, so the
  // query spans all rows (acceptable — one tenant by definition in single mode).
  return undefined;
}

function withClientId<T extends Record<string, any>>(values: T): T & { clientId: string } {
  const cid = currentClientId();
  if (cid) return { ...values, clientId: cid };
  if (getTenantMode() === "multi") {
    throw new Error(
      "Tenant context missing on write — refuse to insert without client_id. " +
        "Wrap the caller in runWithClient(clientId, () => { ... }).",
    );
  }
  // single mode: clientId is intentionally omitted here; the NOT NULL client_id
  // column is the DB safety net. The cast restores the declared return type so
  // callers can rely on it, without weakening the rest of the insert object.
  return values as T & { clientId: string };
}

// ── PII encrypt/decrypt for leads ───────────────────────────────────────
function encryptLeadFields<T extends Partial<InsertCeramicLead>>(
  data: T,
): T & { buyerPhoneHash?: string } {
  const out: any = { ...data };
  if (data.buyerName != null) out.buyerName = encrypt(data.buyerName);
  if (data.buyerPhone != null) {
    out.buyerPhone = encrypt(data.buyerPhone);
    out.buyerPhoneHash = hashPhone(data.buyerPhone);
  }
  if (data.buyerEmail != null) out.buyerEmail = encrypt(data.buyerEmail);
  return out;
}

// Tolerate legacy/plaintext values; only attempt decrypt on our v2 ciphertext.
// (Tampered ciphertext — isEncrypted true but bad tag — still throws, which is correct.)
function safeDecrypt(value: string | null): string | null {
  if (!value) return value;
  return isEncrypted(value) ? decrypt(value) : value;
}

function decryptLead(row: CeramicLead): CeramicLead {
  return {
    ...row,
    buyerName: safeDecrypt(row.buyerName),
    buyerPhone: safeDecrypt(row.buyerPhone),
    buyerEmail: safeDecrypt(row.buyerEmail),
  };
}

// ── storage API ─────────────────────────────────────────────────────────
export const storage = {
  // clients
  async createClient(input: InsertCeramicClient): Promise<CeramicClient> {
    const [row] = await db.insert(ceramicClients).values(input).returning();
    return row;
  },

  async getClient(id: string): Promise<CeramicClient | undefined> {
    const [row] = await db
      .select()
      .from(ceramicClients)
      .where(eq(ceramicClients.id, id))
      .limit(1);
    return row;
  },

  // Look up a client by its public slug. Used by the WhatsApp webhook (no
  // auth context — the slug IS the routing key) and the embed widget.
  async getClientBySlug(slug: string): Promise<CeramicClient | undefined> {
    const [row] = await db
      .select()
      .from(ceramicClients)
      .where(eq(ceramicClients.slug, slug))
      .limit(1);
    return row;
  },

  // Update a client by id (single-tenant: the demo client is the only one).
  // Scoped by id like getClient — no tenant predicate, since the caller
  // already resolves the id via ensureDemoClient/getClient.
  async updateClient(id: string, patch: Partial<InsertCeramicClient>): Promise<CeramicClient> {
    const [row] = await db
      .update(ceramicClients)
      .set(patch)
      .where(eq(ceramicClients.id, id))
      .returning();
    if (!row) throw new Error(`Client ${id} not found`);
    return row;
  },

  // leads
  async createLead(input: InsertCeramicLead): Promise<CeramicLead> {
    const [row] = await db
      .insert(ceramicLeads)
      .values(withClientId(encryptLeadFields(input)) as typeof ceramicLeads.$inferInsert)
      .returning();
    return decryptLead(row);
  },

  async getLead(id: number): Promise<CeramicLead | undefined> {
    const [row] = await db
      .select()
      .from(ceramicLeads)
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)))
      .limit(1);
    return row ? decryptLead(row) : undefined;
  },

  async getLeadByPhone(phone: string): Promise<CeramicLead | undefined> {
    const [row] = await db
      .select()
      .from(ceramicLeads)
      .where(and(eq(ceramicLeads.buyerPhoneHash, hashPhone(phone)), scope(ceramicLeads.clientId)))
      .limit(1);
    return row ? decryptLead(row) : undefined;
  },

  async getLeads(): Promise<CeramicLead[]> {
    const rows = await db
      .select()
      .from(ceramicLeads)
      .where(scope(ceramicLeads.clientId))
      .orderBy(desc(ceramicLeads.createdAt));
    return rows.map(decryptLead);
  },

  async updateLead(id: number, patch: Partial<InsertCeramicLead>): Promise<CeramicLead> {
    const [row] = await db
      .update(ceramicLeads)
      .set(encryptLeadFields(patch))
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)))
      .returning();
    if (!row) throw new Error(`Lead ${id} not found in current tenant`);
    return decryptLead(row);
  },

  async deleteLead(id: number): Promise<void> {
    // Scope the followup delete by clientId too, so a guessed leadId can't
    // wipe another tenant's followups in multi mode.
    await db
      .delete(ceramicFollowups)
      .where(and(eq(ceramicFollowups.leadId, id), scope(ceramicFollowups.clientId)));
    await db
      .delete(ceramicLeads)
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)));
  },

  // followups
  async createFollowup(input: InsertCeramicFollowup): Promise<CeramicFollowup> {
    const [row] = await db
      .insert(ceramicFollowups)
      .values(withClientId(input) as typeof ceramicFollowups.$inferInsert)
      .returning();
    return row;
  },

  async getDueFollowups(now: Date): Promise<CeramicFollowup[]> {
    // Cross-tenant by design: a scheduler sweeps all clients' due messages.
    return db
      .select()
      .from(ceramicFollowups)
      .where(and(eq(ceramicFollowups.sent, false), lte(ceramicFollowups.sendAt, now)));
  },

  // catalogues — per-factory PDF / Drive URLs the bot serves to buyers
  async createCatalogue(input: InsertCeramicCatalogue): Promise<CeramicCatalogue> {
    const [row] = await db
      .insert(ceramicCatalogues)
      .values(withClientId(input) as typeof ceramicCatalogues.$inferInsert)
      .returning();
    return row;
  },

  async getCatalogues(): Promise<CeramicCatalogue[]> {
    return db
      .select()
      .from(ceramicCatalogues)
      .where(scope(ceramicCatalogues.clientId))
      .orderBy(asc(ceramicCatalogues.displayOrder), desc(ceramicCatalogues.createdAt));
  },

  async getCatalogue(id: number): Promise<CeramicCatalogue | undefined> {
    const [row] = await db
      .select()
      .from(ceramicCatalogues)
      .where(and(eq(ceramicCatalogues.id, id), scope(ceramicCatalogues.clientId)))
      .limit(1);
    return row;
  },

  async updateCatalogue(id: number, patch: Partial<InsertCeramicCatalogue>): Promise<CeramicCatalogue> {
    const [row] = await db
      .update(ceramicCatalogues)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(ceramicCatalogues.id, id), scope(ceramicCatalogues.clientId)))
      .returning();
    if (!row) throw new Error(`Catalogue ${id} not found in current tenant`);
    return row;
  },

  async deleteCatalogue(id: number): Promise<void> {
    await db
      .delete(ceramicCatalogues)
      .where(and(eq(ceramicCatalogues.id, id), scope(ceramicCatalogues.clientId)));
  },

  // products — per-factory category/size/finish/sub-item configuration that
  // overrides the hardcoded defaults in shared/flows.ts. Zero rows means
  // "use defaults" (clinic-style show-all fallback).
  async getProducts(): Promise<CeramicProduct[]> {
    return db
      .select()
      .from(ceramicProducts)
      .where(scope(ceramicProducts.clientId))
      .orderBy(asc(ceramicProducts.displayOrder), asc(ceramicProducts.id));
  },

  // ── admin users (panel logins) ───────────────────────────────────────
  // These are NOT tenant-scoped through scope(): admin_users is the auth
  // root. Username is globally unique. The superadmin row has clientId=null.
  // Cross-tenant methods here are only reached from the auth layer and the
  // superadmin router (behind requireSuperAdmin).
  async getAdminUserByUsername(username: string): Promise<AdminUser | undefined> {
    const [row] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);
    return row;
  },

  async getAdminUser(id: string): Promise<AdminUser | undefined> {
    const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
    return row;
  },

  async createAdminUser(input: InsertAdminUser): Promise<AdminUser> {
    const [row] = await db.insert(adminUsers).values(input).returning();
    return row;
  },

  // Count admins for a role (used by seed bootstrap to decide whether to
  // create the initial superadmin). Cross-tenant by design.
  async countAdminsByRole(role: string): Promise<number> {
    const rows = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.role, role));
    return rows.length;
  },

  async getAdminsForClient(clientId: string): Promise<AdminUser[]> {
    return db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.clientId, clientId))
      .orderBy(asc(adminUsers.createdAt));
  },

  async updateAdminUser(id: string, patch: Partial<InsertAdminUser>): Promise<AdminUser> {
    const [row] = await db.update(adminUsers).set(patch).where(eq(adminUsers.id, id)).returning();
    if (!row) throw new Error(`Admin user ${id} not found`);
    return row;
  },

  // ── superadmin audit log ─────────────────────────────────────────────
  async logSuperadminAction(input: InsertSuperadminAction): Promise<void> {
    await db.insert(superadminActions).values(input);
  },

  // ── superadmin: cross-tenant factory management ──────────────────────
  // These deliberately bypass scope() (no tenant context) and are only
  // reachable behind requireSuperAdmin in the superadmin router.

  // List every factory with usage counts for the superadmin dashboard.
  async listAllClients(): Promise<
    Array<CeramicClient & { leadCount: number; productCount: number; adminCount: number }>
  > {
    const clients = await db
      .select()
      .from(ceramicClients)
      .orderBy(asc(ceramicClients.createdAt));
    // Per-client counts. Small tenant counts → a few grouped queries are fine.
    const leadCounts = await db
      .select({ clientId: ceramicLeads.clientId, n: count() })
      .from(ceramicLeads)
      .groupBy(ceramicLeads.clientId);
    const productCounts = await db
      .select({ clientId: ceramicProducts.clientId, n: count() })
      .from(ceramicProducts)
      .groupBy(ceramicProducts.clientId);
    const adminCounts = await db
      .select({ clientId: adminUsers.clientId, n: count() })
      .from(adminUsers)
      .groupBy(adminUsers.clientId);
    const byId = <T extends { clientId: string | null; n: number }>(rows: T[]) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.clientId) m.set(r.clientId, Number(r.n));
      return m;
    };
    const leadMap = byId(leadCounts);
    const productMap = byId(productCounts);
    const adminMap = byId(adminCounts);
    return clients.map((c) => ({
      ...c,
      leadCount: leadMap.get(c.id) ?? 0,
      productCount: productMap.get(c.id) ?? 0,
      adminCount: adminMap.get(c.id) ?? 0,
    }));
  },

  // A factory plus its admin users (for the superadmin detail page).
  async getClientWithAdmins(
    id: string,
  ): Promise<{ client: CeramicClient; admins: AdminUser[] } | undefined> {
    const client = await this.getClient(id);
    if (!client) return undefined;
    const admins = await this.getAdminsForClient(id);
    return { client, admins };
  },

  // Reset an admin's password. Refuses superadmin accounts (anti-lockout),
  // matching clinic-ai's guard. Returns the updated row's identity.
  async resetAdminPassword(
    id: string,
    passwordHash: string,
  ): Promise<{ id: string; username: string } | undefined> {
    const [row] = await db
      .update(adminUsers)
      .set({ password: passwordHash })
      .where(and(eq(adminUsers.id, id), sql`${adminUsers.role} != 'superadmin'`))
      .returning({ id: adminUsers.id, username: adminUsers.username });
    return row;
  },

  // Replace the entire product set for the current client. We use a "wipe
  // and reinsert" pattern instead of per-row upserts because the admin UI
  // edits all categories at once — the form state IS the desired DB state.
  // Simpler than tracking per-row diffs; small data volume per tenant.
  //
  // Requires an explicit tenant scope (even in single mode, the demo client
  // id is known). The scope predicate guarantees we never wipe another
  // tenant's products in multi mode.
  async replaceProducts(clientId: string, items: InsertCeramicProduct[]): Promise<CeramicProduct[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(ceramicProducts)
        .where(eq(ceramicProducts.clientId, clientId));
      if (items.length === 0) return [];
      const rows = items.map((it) => ({ ...it, clientId }) as typeof ceramicProducts.$inferInsert);
      return tx.insert(ceramicProducts).values(rows).returning();
    });
  },
};

export type Storage = typeof storage;
