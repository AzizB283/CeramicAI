import { eq, and, or, lte, gt, desc, asc, sql, count, inArray, type SQL } from "drizzle-orm";
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
  emailConnections,
  emailThreads,
  ceramicContacts,
  ceramicContactImports,
  ceramicSuppressions,
  ceramicSegments,
  ceramicCampaigns,
  ceramicCampaignSteps,
  ceramicCampaignRecipients,
  ceramicTrackedLinks,
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
  type EmailConnection,
  type InsertEmailConnection,
  type EmailThread,
  type InsertEmailThread,
  type CeramicContact,
  type InsertCeramicContact,
  type CeramicContactImport,
  type InsertCeramicContactImport,
  type InsertCeramicSuppression,
  type CeramicSegment,
  type InsertCeramicSegment,
  type CeramicCampaign,
  type InsertCeramicCampaign,
  type CeramicCampaignStep,
  type InsertCeramicCampaignStep,
  type CeramicCampaignRecipient,
  type InsertCeramicCampaignRecipient,
  type CeramicTrackedLink,
  type InsertCeramicTrackedLink,
} from "@shared/schema";
import { encrypt, decrypt, isEncrypted, hashPhone, hashEmail } from "./utils/encryption";

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

// ── PII encrypt/decrypt for contacts (mirrors leads) ────────────────────
function encryptContactFields<T extends Partial<InsertCeramicContact>>(
  data: T,
): T & { emailHash?: string; phoneHash?: string } {
  const out: any = { ...data };
  if (data.name != null) out.name = encrypt(data.name);
  if (data.email != null) {
    out.email = encrypt(data.email);
    out.emailHash = hashEmail(data.email);
  }
  if (data.phone != null) {
    out.phone = encrypt(data.phone);
    out.phoneHash = hashPhone(data.phone);
  }
  return out;
}

function decryptContact(row: CeramicContact): CeramicContact {
  return {
    ...row,
    name: safeDecrypt(row.name),
    email: safeDecrypt(row.email),
    phone: safeDecrypt(row.phone),
  };
}

function decryptConnection(row: EmailConnection): EmailConnection {
  return {
    ...row,
    accessToken: safeDecrypt(row.accessToken) ?? row.accessToken,
    refreshToken: safeDecrypt(row.refreshToken) ?? row.refreshToken,
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

  // ── contacts (outbound address book) ─────────────────────────────────
  // PII (name/email/phone) encrypted at rest; emailHash/phoneHash are
  // peppered HMACs for dedupe + suppression matching.
  async createContact(input: InsertCeramicContact): Promise<CeramicContact> {
    const [row] = await db
      .insert(ceramicContacts)
      .values(withClientId(encryptContactFields(input)) as typeof ceramicContacts.$inferInsert)
      .returning();
    return decryptContact(row);
  },

  async getContact(id: number): Promise<CeramicContact | undefined> {
    const [row] = await db
      .select()
      .from(ceramicContacts)
      .where(and(eq(ceramicContacts.id, id), scope(ceramicContacts.clientId)))
      .limit(1);
    return row ? decryptContact(row) : undefined;
  },

  // Find an existing contact by email (then phone) hash within the tenant.
  // Used by the importer to dedupe without decrypting every row.
  async findContactByHash(opts: { email?: string; phone?: string }): Promise<CeramicContact | undefined> {
    if (opts.email) {
      const [row] = await db
        .select()
        .from(ceramicContacts)
        .where(and(eq(ceramicContacts.emailHash, hashEmail(opts.email)), scope(ceramicContacts.clientId)))
        .limit(1);
      if (row) return decryptContact(row);
    }
    if (opts.phone) {
      const [row] = await db
        .select()
        .from(ceramicContacts)
        .where(and(eq(ceramicContacts.phoneHash, hashPhone(opts.phone)), scope(ceramicContacts.clientId)))
        .limit(1);
      if (row) return decryptContact(row);
    }
    return undefined;
  },

  async getContacts(filter?: {
    country?: string;
    buyerType?: string;
    source?: string;
    search?: string;
  }): Promise<CeramicContact[]> {
    const preds: (SQL | undefined)[] = [scope(ceramicContacts.clientId)];
    if (filter?.country) preds.push(eq(ceramicContacts.country, filter.country));
    if (filter?.buyerType) preds.push(eq(ceramicContacts.buyerType, filter.buyerType));
    if (filter?.source) preds.push(eq(ceramicContacts.source, filter.source));
    // `search` matches plaintext columns only (company/country/city) — name/
    // email/phone are encrypted so they can't be LIKE-filtered in SQL. The UI
    // can refine on decrypted fields client-side.
    if (filter?.search) {
      const q = `%${filter.search.toLowerCase()}%`;
      preds.push(
        sql`(lower(${ceramicContacts.company}) like ${q} or lower(${ceramicContacts.country}) like ${q} or lower(${ceramicContacts.city}) like ${q})`,
      );
    }
    const rows = await db
      .select()
      .from(ceramicContacts)
      .where(and(...preds))
      .orderBy(desc(ceramicContacts.createdAt));
    return rows.map(decryptContact);
  },

  async updateContact(id: number, patch: Partial<InsertCeramicContact>): Promise<CeramicContact> {
    const [row] = await db
      .update(ceramicContacts)
      .set({ ...encryptContactFields(patch), updatedAt: new Date() })
      .where(and(eq(ceramicContacts.id, id), scope(ceramicContacts.clientId)))
      .returning();
    if (!row) throw new Error(`Contact ${id} not found in current tenant`);
    return decryptContact(row);
  },

  async deleteContact(id: number): Promise<void> {
    await db
      .delete(ceramicContacts)
      .where(and(eq(ceramicContacts.id, id), scope(ceramicContacts.clientId)));
  },

  // Promote a bot lead into the address book. Idempotent on the lead's email/
  // phone: if a contact already exists for them, returns it (with leadId set)
  // rather than duplicating. Caller passes a decrypted lead.
  async promoteLeadToContact(lead: CeramicLead): Promise<CeramicContact> {
    const existing = await this.findContactByHash({
      email: lead.buyerEmail ?? undefined,
      phone: lead.buyerPhone ?? undefined,
    });
    if (existing) {
      if (existing.leadId) return existing;
      return this.updateContact(existing.id, { leadId: lead.id });
    }
    return this.createContact({
      name: lead.buyerName ?? undefined,
      email: lead.buyerEmail ?? undefined,
      phone: lead.buyerPhone ?? undefined,
      company: lead.buyerCompany ?? undefined,
      country: lead.buyerCountry ?? undefined,
      city: lead.buyerCity ?? undefined,
      buyerType: lead.buyerType ?? undefined,
      source: "lead",
      leadId: lead.id,
    });
  },

  // ── contact imports (CSV audit trail) ────────────────────────────────
  async createContactImport(input: InsertCeramicContactImport): Promise<CeramicContactImport> {
    const [row] = await db
      .insert(ceramicContactImports)
      .values(withClientId(input) as typeof ceramicContactImports.$inferInsert)
      .returning();
    return row;
  },

  async getContactImports(): Promise<CeramicContactImport[]> {
    return db
      .select()
      .from(ceramicContactImports)
      .where(scope(ceramicContactImports.clientId))
      .orderBy(desc(ceramicContactImports.createdAt));
  },

  // ── suppressions (do-not-contact) ────────────────────────────────────
  async addSuppression(input: InsertCeramicSuppression): Promise<void> {
    await db
      .insert(ceramicSuppressions)
      .values(withClientId(input) as typeof ceramicSuppressions.$inferInsert)
      .onConflictDoNothing();
  },

  // Suppress by raw email/phone (hashes them first). Convenience for the
  // unsubscribe route + manual block in the UI.
  async suppressContact(opts: { email?: string; phone?: string; reason: string }): Promise<void> {
    await this.addSuppression({
      emailHash: opts.email ? hashEmail(opts.email) : null,
      phoneHash: opts.phone ? hashPhone(opts.phone) : null,
      reason: opts.reason,
    });
  },

  // Remove an email/phone from the do-not-contact list (un-suppress). Used
  // when an admin re-enables a contact they previously blocked. Deletes any
  // matching suppression rows for this tenant.
  async unsuppressContact(opts: { email?: string; phone?: string }): Promise<void> {
    const hashes: SQL[] = [];
    if (opts.email) hashes.push(eq(ceramicSuppressions.emailHash, hashEmail(opts.email)));
    if (opts.phone) hashes.push(eq(ceramicSuppressions.phoneHash, hashPhone(opts.phone)));
    if (hashes.length === 0) return;
    await db
      .delete(ceramicSuppressions)
      .where(and(scope(ceramicSuppressions.clientId), or(...hashes)));
  },

  // True if this email/phone is on the do-not-contact list for the tenant.
  // The campaign drip engine calls this before every send.
  async isSuppressed(opts: { email?: string; phone?: string }): Promise<boolean> {
    const hashes: SQL[] = [];
    if (opts.email) hashes.push(eq(ceramicSuppressions.emailHash, hashEmail(opts.email)));
    if (opts.phone) hashes.push(eq(ceramicSuppressions.phoneHash, hashPhone(opts.phone)));
    if (hashes.length === 0) return false;
    const [row] = await db
      .select({ id: ceramicSuppressions.id })
      .from(ceramicSuppressions)
      .where(and(scope(ceramicSuppressions.clientId), or(...hashes)))
      .limit(1);
    return Boolean(row);
  },

  // ── segments (saved audience filters) ────────────────────────────────
  async createSegment(input: InsertCeramicSegment): Promise<CeramicSegment> {
    const [row] = await db
      .insert(ceramicSegments)
      .values(withClientId(input) as typeof ceramicSegments.$inferInsert)
      .returning();
    return row;
  },

  async getSegments(): Promise<CeramicSegment[]> {
    return db
      .select()
      .from(ceramicSegments)
      .where(scope(ceramicSegments.clientId))
      .orderBy(desc(ceramicSegments.createdAt));
  },

  async getSegment(id: number): Promise<CeramicSegment | undefined> {
    const [row] = await db
      .select()
      .from(ceramicSegments)
      .where(and(eq(ceramicSegments.id, id), scope(ceramicSegments.clientId)))
      .limit(1);
    return row;
  },

  async updateSegment(id: number, patch: Partial<InsertCeramicSegment>): Promise<CeramicSegment> {
    const [row] = await db
      .update(ceramicSegments)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(ceramicSegments.id, id), scope(ceramicSegments.clientId)))
      .returning();
    if (!row) throw new Error(`Segment ${id} not found in current tenant`);
    return row;
  },

  async deleteSegment(id: number): Promise<void> {
    await db
      .delete(ceramicSegments)
      .where(and(eq(ceramicSegments.id, id), scope(ceramicSegments.clientId)));
  },

  // Translate a segment rule into a contact-id list. Always excludes opted-out
  // contacts; `forSend` additionally drops anyone on the suppression list. Used
  // by the segment preview (forSend=false → audience size) and by campaign
  // enrollment (forSend=true → who actually gets mailed). Returns decrypted
  // contacts so the caller can read email/name for sending + personalization.
  async resolveSegment(
    rule: { country?: string[]; buyerType?: string[]; source?: string[]; tags?: string[] },
    opts: { forSend?: boolean } = {},
  ): Promise<CeramicContact[]> {
    const preds: (SQL | undefined)[] = [scope(ceramicContacts.clientId)];
    if (rule.country?.length) preds.push(inArray(ceramicContacts.country, rule.country));
    if (rule.buyerType?.length) preds.push(inArray(ceramicContacts.buyerType, rule.buyerType));
    if (rule.source?.length) preds.push(inArray(ceramicContacts.source, rule.source));
    // tags: contact matches if it has ANY of the requested tags. The jsonb `?|`
    // operator takes a text[] on the right; build it as ARRAY[$1,$2,…]::text[]
    // with each tag as its own bound param (node-postgres mis-encodes a bound
    // JS array here as a malformed array literal, hence the explicit construction).
    if (rule.tags?.length) {
      const elems = sql.join(rule.tags.map((t) => sql`${t}`), sql`, `);
      preds.push(sql`${ceramicContacts.tags} ?| ARRAY[${elems}]::text[]`);
    }
    // Opted-out contacts never receive outbound.
    preds.push(eq(ceramicContacts.optedOut, false));
    const rows = await db
      .select()
      .from(ceramicContacts)
      .where(and(...preds))
      .orderBy(desc(ceramicContacts.createdAt));
    const decrypted = rows.map(decryptContact);
    if (!opts.forSend) return decrypted;
    // Drop suppressed contacts (by email/phone hash) for an actual send.
    const out: CeramicContact[] = [];
    for (const c of decrypted) {
      const suppressed = await this.isSuppressed({
        email: c.email ?? undefined,
        phone: c.phone ?? undefined,
      });
      if (!suppressed) out.push(c);
    }
    return out;
  },

  // ── campaigns ────────────────────────────────────────────────────────
  async createCampaign(input: InsertCeramicCampaign): Promise<CeramicCampaign> {
    const [row] = await db
      .insert(ceramicCampaigns)
      .values(withClientId(input) as typeof ceramicCampaigns.$inferInsert)
      .returning();
    return row;
  },

  async getCampaigns(): Promise<CeramicCampaign[]> {
    return db
      .select()
      .from(ceramicCampaigns)
      .where(scope(ceramicCampaigns.clientId))
      .orderBy(desc(ceramicCampaigns.createdAt));
  },

  async getCampaign(id: number): Promise<CeramicCampaign | undefined> {
    const [row] = await db
      .select()
      .from(ceramicCampaigns)
      .where(and(eq(ceramicCampaigns.id, id), scope(ceramicCampaigns.clientId)))
      .limit(1);
    return row;
  },

  async updateCampaign(id: number, patch: Partial<InsertCeramicCampaign>): Promise<CeramicCampaign> {
    const [row] = await db
      .update(ceramicCampaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(ceramicCampaigns.id, id), scope(ceramicCampaigns.clientId)))
      .returning();
    if (!row) throw new Error(`Campaign ${id} not found in current tenant`);
    return row;
  },

  async deleteCampaign(id: number): Promise<void> {
    // Children first (steps, recipients, tracked links), scoped by client.
    await db
      .delete(ceramicTrackedLinks)
      .where(and(eq(ceramicTrackedLinks.campaignId, id), scope(ceramicTrackedLinks.clientId)));
    await db
      .delete(ceramicCampaignRecipients)
      .where(and(eq(ceramicCampaignRecipients.campaignId, id), scope(ceramicCampaignRecipients.clientId)));
    await db
      .delete(ceramicCampaignSteps)
      .where(and(eq(ceramicCampaignSteps.campaignId, id), scope(ceramicCampaignSteps.clientId)));
    await db
      .delete(ceramicCampaigns)
      .where(and(eq(ceramicCampaigns.id, id), scope(ceramicCampaigns.clientId)));
  },

  // Cross-tenant by design: the campaign scheduler sweeps all clients that have
  // a campaign currently in the "sending" state.
  async listClientsWithActiveCampaigns(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ clientId: ceramicCampaigns.clientId })
      .from(ceramicCampaigns)
      .where(eq(ceramicCampaigns.status, "sending"));
    return rows.map((r) => r.clientId);
  },

  // ── campaign steps ───────────────────────────────────────────────────
  async createCampaignStep(input: InsertCeramicCampaignStep): Promise<CeramicCampaignStep> {
    const [row] = await db
      .insert(ceramicCampaignSteps)
      .values(withClientId(input) as typeof ceramicCampaignSteps.$inferInsert)
      .returning();
    return row;
  },

  async getCampaignSteps(campaignId: number): Promise<CeramicCampaignStep[]> {
    return db
      .select()
      .from(ceramicCampaignSteps)
      .where(and(eq(ceramicCampaignSteps.campaignId, campaignId), scope(ceramicCampaignSteps.clientId)))
      .orderBy(asc(ceramicCampaignSteps.stepIndex));
  },

  // ── campaign recipients ──────────────────────────────────────────────
  async createCampaignRecipients(
    rows: InsertCeramicCampaignRecipient[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const values = rows.map((r) => withClientId(r) as typeof ceramicCampaignRecipients.$inferInsert);
    const inserted = await db.insert(ceramicCampaignRecipients).values(values).returning({ id: ceramicCampaignRecipients.id });
    return inserted.length;
  },

  async getCampaignRecipients(campaignId: number): Promise<CeramicCampaignRecipient[]> {
    return db
      .select()
      .from(ceramicCampaignRecipients)
      .where(and(eq(ceramicCampaignRecipients.campaignId, campaignId), scope(ceramicCampaignRecipients.clientId)))
      .orderBy(asc(ceramicCampaignRecipients.id));
  },

  // Atomically claim up to `limit` queued recipients of a sending campaign for
  // this client: flip queued→sending in one UPDATE and return the claimed rows.
  // The status flip BEFORE the network send is what prevents a scheduler
  // overlap from double-sending. Postgres UPDATE … RETURNING is atomic.
  async claimQueuedRecipients(limit: number): Promise<CeramicCampaignRecipient[]> {
    const cid = currentClientId();
    // Sub-select the next queued recipients (scoped), then mark them sending.
    const ids = await db
      .select({ id: ceramicCampaignRecipients.id })
      .from(ceramicCampaignRecipients)
      .where(and(eq(ceramicCampaignRecipients.status, "queued"), scope(ceramicCampaignRecipients.clientId)))
      .orderBy(asc(ceramicCampaignRecipients.id))
      .limit(limit);
    if (ids.length === 0) return [];
    const idList = ids.map((r) => r.id);
    const claimed = await db
      .update(ceramicCampaignRecipients)
      .set({ status: "sending" })
      .where(
        and(
          inArray(ceramicCampaignRecipients.id, idList),
          eq(ceramicCampaignRecipients.status, "queued"),
          cid ? eq(ceramicCampaignRecipients.clientId, cid) : undefined,
        ),
      )
      .returning();
    return claimed;
  },

  async updateCampaignRecipient(
    id: number,
    patch: Partial<typeof ceramicCampaignRecipients.$inferInsert>,
  ): Promise<CeramicCampaignRecipient | undefined> {
    const [row] = await db
      .update(ceramicCampaignRecipients)
      .set(patch)
      .where(and(eq(ceramicCampaignRecipients.id, id), scope(ceramicCampaignRecipients.clientId)))
      .returning();
    return row;
  },

  // Find the most recent still-open recipient for an inbound reply, matched by
  // the buyer's contact (email hash) within the tenant. Used to attribute a
  // reply to a campaign so the report + auto-stop can act on it. Returns the
  // recipient joined with its campaignId.
  async findOpenRecipientByContactEmail(email: string): Promise<CeramicCampaignRecipient | undefined> {
    const contact = await this.findContactByHash({ email });
    if (!contact) return undefined;
    const [row] = await db
      .select()
      .from(ceramicCampaignRecipients)
      .where(
        and(
          eq(ceramicCampaignRecipients.contactId, contact.id),
          scope(ceramicCampaignRecipients.clientId),
          inArray(ceramicCampaignRecipients.status, ["sent", "active", "sending"]),
        ),
      )
      .orderBy(desc(ceramicCampaignRecipients.lastSentAt))
      .limit(1);
    return row;
  },

  // Count campaign emails actually sent today (since local midnight passed in
  // as `since`) for this client — the Gmail-cap guard for the drip engine.
  async getCampaignSendCountSince(since: Date): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(ceramicCampaignRecipients)
      .where(
        and(
          scope(ceramicCampaignRecipients.clientId),
          gt(ceramicCampaignRecipients.lastSentAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  },

  // ── tracked links (catalogue-open signals) ───────────────────────────
  async createTrackedLink(input: InsertCeramicTrackedLink): Promise<CeramicTrackedLink> {
    const [row] = await db
      .insert(ceramicTrackedLinks)
      .values(withClientId(input) as typeof ceramicTrackedLinks.$inferInsert)
      .returning();
    return row;
  },

  // Public (no tenant context): resolve a token → its row. The token is an
  // unguessable random string, so this is safe to call from the /r/:token
  // redirect which has no session.
  async getTrackedLinkByToken(token: string): Promise<CeramicTrackedLink | undefined> {
    const [row] = await db
      .select()
      .from(ceramicTrackedLinks)
      .where(eq(ceramicTrackedLinks.token, token))
      .limit(1);
    return row;
  },

  // Record a hit on a tracked link and, if it's the first hit, stamp the
  // recipient's openedAt. No tenant context (public redirect) — scoped by the
  // link's own clientId. Returns the (updated) link.
  async recordTrackedLinkHit(token: string): Promise<CeramicTrackedLink | undefined> {
    const now = new Date();
    const [link] = await db
      .update(ceramicTrackedLinks)
      .set({
        hitCount: sql`${ceramicTrackedLinks.hitCount} + 1`,
        lastHitAt: now,
        firstHitAt: sql`COALESCE(${ceramicTrackedLinks.firstHitAt}, ${now})`,
      })
      .where(eq(ceramicTrackedLinks.token, token))
      .returning();
    if (link?.recipientId) {
      // Stamp the recipient's first open (idempotent — only sets if null).
      await db
        .update(ceramicCampaignRecipients)
        .set({ openedAt: sql`COALESCE(${ceramicCampaignRecipients.openedAt}, ${now})` })
        .where(eq(ceramicCampaignRecipients.id, link.recipientId));
    }
    return link;
  },

  // ── email connections (Gmail OAuth) ──────────────────────────────────
  // Tokens encrypted at rest; decrypted on read. One row per client.
  async upsertEmailConnection(input: InsertEmailConnection): Promise<EmailConnection> {
    const cid = currentClientId();
    if (!cid) {
      if (getTenantMode() === "multi") throw new Error("upsertEmailConnection: missing tenant context");
      throw new Error("upsertEmailConnection: client id required");
    }
    const values = {
      ...input,
      clientId: cid,
      accessToken: encrypt(input.accessToken),
      refreshToken: encrypt(input.refreshToken),
    };
    const [row] = await db
      .insert(emailConnections)
      .values(values as typeof emailConnections.$inferInsert)
      .onConflictDoUpdate({
        target: emailConnections.clientId,
        set: {
          gmailAddress: values.gmailAddress,
          accessToken: values.accessToken,
          refreshToken: values.refreshToken,
          tokenExpiry: values.tokenExpiry,
          historyId: values.historyId,
          active: true,
        },
      })
      .returning();
    return decryptConnection(row);
  },

  async getEmailConnection(): Promise<EmailConnection | undefined> {
    const [row] = await db
      .select()
      .from(emailConnections)
      .where(scope(emailConnections.clientId))
      .limit(1);
    return row ? decryptConnection(row) : undefined;
  },

  async updateEmailConnectionSync(patch: { historyId?: string | null; lastCheckedAt?: Date; accessToken?: string; tokenExpiry?: Date | null }): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.historyId !== undefined) set.historyId = patch.historyId;
    if (patch.lastCheckedAt !== undefined) set.lastCheckedAt = patch.lastCheckedAt;
    if (patch.accessToken !== undefined) set.accessToken = encrypt(patch.accessToken);
    if (patch.tokenExpiry !== undefined) set.tokenExpiry = patch.tokenExpiry;
    if (Object.keys(set).length === 0) return;
    await db.update(emailConnections).set(set).where(scope(emailConnections.clientId));
  },

  async deleteEmailConnection(): Promise<void> {
    await db.delete(emailConnections).where(scope(emailConnections.clientId));
  },

  // Cross-tenant by design (the scheduler sweeps all connected clients).
  async listEmailConnectedClients(): Promise<string[]> {
    const rows = await db
      .select({ clientId: emailConnections.clientId })
      .from(emailConnections)
      .where(eq(emailConnections.active, true));
    return rows.map((r) => r.clientId);
  },

  // ── email threads ────────────────────────────────────────────────────
  async createEmailThread(input: InsertEmailThread): Promise<EmailThread> {
    const [row] = await db
      .insert(emailThreads)
      .values(withClientId(input) as typeof emailThreads.$inferInsert)
      .returning();
    return row;
  },

  async getEmailThreads(): Promise<EmailThread[]> {
    return db
      .select()
      .from(emailThreads)
      .where(scope(emailThreads.clientId))
      .orderBy(desc(emailThreads.receivedAt));
  },

  async getEmailThread(id: number): Promise<EmailThread | undefined> {
    const [row] = await db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.id, id), scope(emailThreads.clientId)))
      .limit(1);
    return row;
  },

  async linkThreadToLead(threadId: number, leadId: number): Promise<void> {
    await db
      .update(emailThreads)
      .set({ leadId })
      .where(and(eq(emailThreads.id, threadId), scope(emailThreads.clientId)));
  },

  async markThreadSent(threadId: number, sentReply: string): Promise<EmailThread> {
    const [row] = await db
      .update(emailThreads)
      .set({ status: "sent", sentReply, sentAt: new Date() })
      .where(and(eq(emailThreads.id, threadId), scope(emailThreads.clientId)))
      .returning();
    if (!row) throw new Error(`Email thread ${threadId} not found in current tenant`);
    return row;
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
