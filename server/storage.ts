import { eq, and, lte, desc, asc, type SQL } from "drizzle-orm";
import { db } from "./db";
import { currentClientId, getTenantMode } from "./middleware/tenant";
import {
  ceramicClients,
  ceramicLeads,
  ceramicFollowups,
  ceramicCatalogues,
  type CeramicClient,
  type InsertCeramicClient,
  type CeramicLead,
  type InsertCeramicLead,
  type CeramicFollowup,
  type InsertCeramicFollowup,
  type CeramicCatalogue,
  type InsertCeramicCatalogue,
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
};

export type Storage = typeof storage;
