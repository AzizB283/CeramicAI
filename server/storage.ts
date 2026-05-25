import { eq, and, lte, desc, type SQL } from "drizzle-orm";
import { db } from "./db";
import { currentClientId, getTenantMode } from "./middleware/tenant";
import {
  ceramicClients,
  ceramicLeads,
  ceramicFollowups,
  type CeramicClient,
  type InsertCeramicClient,
  type CeramicLead,
  type InsertCeramicLead,
  type CeramicFollowup,
  type InsertCeramicFollowup,
} from "@shared/schema";
import { encrypt, decrypt, hashPhone } from "./utils/encryption";

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
  return undefined;
}

function withClientId<T extends Record<string, any>>(values: T): T & { clientId?: string } {
  const cid = currentClientId();
  if (cid) return { ...values, clientId: cid };
  if (getTenantMode() === "multi") {
    throw new Error(
      "Tenant context missing on write — refuse to insert without client_id. " +
        "Wrap the caller in runWithClient(clientId, () => { ... }).",
    );
  }
  return values; // single mode: NOT NULL client_id is the DB safety net
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

function decryptLead(row: CeramicLead): CeramicLead {
  return {
    ...row,
    buyerName: row.buyerName ? decrypt(row.buyerName) : row.buyerName,
    buyerPhone: row.buyerPhone ? decrypt(row.buyerPhone) : row.buyerPhone,
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

  // leads
  async createLead(input: InsertCeramicLead): Promise<CeramicLead> {
    const [row] = await db
      .insert(ceramicLeads)
      .values(withClientId(encryptLeadFields(input)) as any)
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
    return decryptLead(row);
  },

  async deleteLead(id: number): Promise<void> {
    await db
      .delete(ceramicFollowups)
      .where(eq(ceramicFollowups.leadId, id));
    await db
      .delete(ceramicLeads)
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)));
  },

  // followups
  async createFollowup(input: InsertCeramicFollowup): Promise<CeramicFollowup> {
    const [row] = await db
      .insert(ceramicFollowups)
      .values(withClientId(input) as any)
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
};

export type Storage = typeof storage;
