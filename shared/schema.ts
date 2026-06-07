import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  serial,
  uuid,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── ceramic_clients — multi-tenant root (spec §5.1) ─────────────────────
export const ceramicClients = pgTable("ceramic_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  // URL-safe identifier for the per-client WhatsApp webhook
  // (POST /api/whatsapp/:slug) and the embed widget's data-client attribute.
  // Unique. The demo row's slug is "demo".
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(), // "Shree Tiles Pvt Ltd"
  mode: text("mode").notNull(), // "factory" | "exporter"
  ownerName: text("owner_name"),
  ownerWhatsapp: text("owner_whatsapp"), // owner phone for alerts
  // Comma-separated list of up to 3 email recipients for new-lead alerts.
  // Stored as plain text (business email, not buyer PII). The first is the
  // owner; the rest let a sales team / colleague get the same notification.
  ownerEmail: text("owner_email"),
  catalogUrl: text("catalog_url"),
  exportCatalogUrl: text("export_catalog_url"),
  // WhatsApp Business Cloud API credentials (per-client; encrypted at the
  // application layer for the secrets — token + app_secret).
  waPhoneId: text("wa_phone_id"), // WhatsApp Cloud API phone number id
  waToken: text("wa_token"), // permanent access token (encrypted v2:…)
  waVerifyToken: text("wa_verify_token"), // webhook verify token (plain — public-ish)
  waAppSecret: text("wa_app_secret"), // Meta App Secret (encrypted v2:…) — used to verify X-Hub-Signature-256
  widgetColor: text("widget_color").default("e85d04"),
  widgetName: text("widget_name"),
  widgetGreeting: text("widget_greeting"),
  timezone: text("timezone").default("Asia/Kolkata"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCeramicClientSchema = createInsertSchema(ceramicClients).omit({
  id: true,
  createdAt: true,
});
export type CeramicClient = typeof ceramicClients.$inferSelect;
export type InsertCeramicClient = z.infer<typeof insertCeramicClientSchema>;

// ── ceramic_leads — one row per buyer inquiry (spec §5.1) ───────────────
export const ceramicLeads = pgTable(
  "ceramic_leads",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    sessionId: text("session_id").notNull(),
    channel: text("channel"), // "whatsapp" | "web"
    buyerType: text("buyer_type"), // retailer | distributor | architect | builder | export | general
    buyerName: text("buyer_name"), // encrypted at application layer
    buyerPhone: text("buyer_phone"), // encrypted at application layer
    buyerPhoneHash: text("buyer_phone_hash"), // HMAC for indexed lookup
    buyerEmail: text("buyer_email"), // encrypted at application layer
    buyerCompany: text("buyer_company"),
    buyerCountry: text("buyer_country"),
    buyerCity: text("buyer_city"),
    productCategory: text("product_category"), // gvt | ceramic_wall | pgvt ...
    productSize: text("product_size"), // 600x600 | 1200x600 ...
    productFinish: text("product_finish"), // matte | glossy ...
    quantity: text("quantity"), // "500-2000 boxes" | "3 containers"
    incoterms: text("incoterms"), // FOB | CIF — exporter mode
    destinationPort: text("destination_port"),
    sampleRequested: boolean("sample_requested").default(false),
    isDistributorInquiry: boolean("is_distributor_inquiry").default(false),
    priority: text("priority").default("normal"), // normal | high | priority
    catalogSent: boolean("catalog_sent").default(false),
    ownerNotified: boolean("owner_notified").default(false),
    status: text("status").default("new"), // new | contacted | converted | lost
    notes: text("notes"),
    emailThreadId: integer("email_thread_id"), // FK set after email_threads exists (see relation note)
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_leads_client_id").on(t.clientId),
    index("idx_ceramic_leads_client_status").on(t.clientId, t.status),
    index("idx_ceramic_leads_client_phone_hash").on(t.clientId, t.buyerPhoneHash),
    index("idx_ceramic_leads_session").on(t.sessionId),
  ],
);

export const insertCeramicLeadSchema = createInsertSchema(ceramicLeads).omit({
  id: true,
  clientId: true,
  createdAt: true,
  buyerPhoneHash: true,
});
export type CeramicLead = typeof ceramicLeads.$inferSelect;
export type InsertCeramicLead = z.infer<typeof insertCeramicLeadSchema>;

// ── ceramic_followups — Day 2/5/10 schedule per lead (spec §5.1) ────────
export const ceramicFollowups = pgTable(
  "ceramic_followups",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => ceramicLeads.id),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    sendAt: timestamp("send_at").notNull(),
    dayNumber: integer("day_number"), // 2 | 5 | 10
    message: text("message"),
    sent: boolean("sent").default(false),
    sentAt: timestamp("sent_at"),
  },
  (t) => [
    index("idx_ceramic_followups_client_id").on(t.clientId),
    index("idx_ceramic_followups_lead_id").on(t.leadId),
    index("idx_ceramic_followups_due").on(t.sent, t.sendAt),
  ],
);

export const insertCeramicFollowupSchema = createInsertSchema(ceramicFollowups).omit({
  id: true,
  clientId: true,
});
export type CeramicFollowup = typeof ceramicFollowups.$inferSelect;
export type InsertCeramicFollowup = z.infer<typeof insertCeramicFollowupSchema>;

// ── ceramic_catalogues — per-factory PDF / Google Drive catalogues ──────
// Matches the real-world pattern observed on Simpolo / Kajaria / Varmora:
// factories don't list individual products, they publish category-tagged
// catalogue PDFs and refresh them as designs change. The bot picks the
// best-matching catalogue when a buyer specifies category + size + finish.
export const ceramicCatalogues = pgTable(
  "ceramic_catalogues",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    title: text("title").notNull(), // "GVT Catalogue 2026", "Marmorica Collection"
    category: text("category").notNull(), // ceramic_wall | gvt | pgvt | double_charge | slab | sanitaryware | mixed
    audience: text("audience").notNull().default("both"), // domestic | export | both
    url: text("url").notNull(), // Google Drive / Dropbox / hosted PDF link
    description: text("description"), // optional one-liner the bot can mention
    sizes: jsonb("sizes").$type<string[]>().default([]).notNull(), // e.g. ["600x600", "800x800"]
    finishes: jsonb("finishes").$type<string[]>().default([]).notNull(), // e.g. ["matte", "glossy"]
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_catalogues_client_id").on(t.clientId),
    index("idx_ceramic_catalogues_client_active").on(t.clientId, t.isActive),
    index("idx_ceramic_catalogues_match").on(t.clientId, t.category, t.audience),
  ],
);

export const insertCeramicCatalogueSchema = createInsertSchema(ceramicCatalogues).omit({
  id: true,
  clientId: true,
  createdAt: true,
  updatedAt: true,
});
export type CeramicCatalogue = typeof ceramicCatalogues.$inferSelect;
export type InsertCeramicCatalogue = z.infer<typeof insertCeramicCatalogueSchema>;

// ── ceramic_products — per-factory product configuration ────────────────
// Drives which categories/sizes/finishes the bot chips offer for a given
// factory. A factory with zero rows falls back to the hardcoded defaults in
// shared/flows.ts (so un-configured demos keep working). Sanitaryware rows
// additionally carry sub-items (toilet, wash basin, urinal…) since asking
// "what size" is wrong for those — we ask "which item" instead.
export const ceramicProducts = pgTable(
  "ceramic_products",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    category: text("category").notNull(), // ceramic_wall | gvt | pgvt | double_charge | slab | sanitaryware | other
    customLabel: text("custom_label"), // free-text label when category='other'
    sizes: jsonb("sizes").$type<string[]>().default([]).notNull(),
    finishes: jsonb("finishes").$type<string[]>().default([]).notNull(),
    // Sanitaryware sub-items (one-piece toilet, wash basin, urinal, etc.).
    // Empty for tile categories.
    subItems: jsonb("sub_items").$type<string[]>().default([]).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_products_client_id").on(t.clientId),
    index("idx_ceramic_products_client_active").on(t.clientId, t.isActive),
  ],
);

export const insertCeramicProductSchema = createInsertSchema(ceramicProducts).omit({
  id: true,
  clientId: true,
  createdAt: true,
  updatedAt: true,
});
export type CeramicProduct = typeof ceramicProducts.$inferSelect;
export type InsertCeramicProduct = z.infer<typeof insertCeramicProductSchema>;

// ── admin_users — panel logins (super-admin + per-factory admins) ───────
// Mirrors clinic-ai's admin_users (minus the doctor role). The "superadmin"
// role is Aurex Auto's cross-tenant operator: clientId is NULL. A "factory"
// admin is bound to exactly one ceramic_clients row via clientId. Usernames
// are globally unique. password is a bcrypt hash, never plaintext.
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").references(() => ceramicClients.id), // NULL for superadmin
    username: text("username").notNull().unique(),
    password: text("password").notNull(), // bcrypt hash
    name: text("name"),
    role: text("role").notNull().default("factory"), // "superadmin" | "factory"
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [index("idx_admin_users_client_id").on(t.clientId)],
);

export const insertAdminUserSchema = createInsertSchema(adminUsers).omit({
  id: true,
  createdAt: true,
});
export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;

// ── superadmin_actions — audit trail of super-admin impersonation ───────
// Decision A: super-admin can enter a factory's panel and see buyer-lead PII;
// every impersonation session and every PII-bearing read while impersonating
// is logged here for accountability. DB-only for v1 (no UI surface yet).
export const superadminActions = pgTable(
  "superadmin_actions",
  {
    id: serial("id").primaryKey(),
    superadminId: uuid("superadmin_id").notNull().references(() => adminUsers.id),
    clientId: uuid("client_id").references(() => ceramicClients.id), // target factory
    action: text("action").notNull(), // impersonate_start | impersonate_stop | view_leads | ...
    detail: text("detail"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [index("idx_superadmin_actions_client").on(t.clientId)],
);

export const insertSuperadminActionSchema = createInsertSchema(superadminActions).omit({
  id: true,
  createdAt: true,
});
export type SuperadminAction = typeof superadminActions.$inferSelect;
export type InsertSuperadminAction = z.infer<typeof insertSuperadminActionSchema>;

// ── email_connections — one connected Gmail account per client ──────────
// The exporter's own inbox. OAuth tokens are AES-GCM encrypted at the app
// layer (same v2: format as WhatsApp creds). One row per client (unique).
export const emailConnections = pgTable(
  "email_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().unique().references(() => ceramicClients.id),
    gmailAddress: text("gmail_address").notNull(), // plain — business identity, shown in UI
    accessToken: text("access_token").notNull(), // encrypted v2:…
    refreshToken: text("refresh_token").notNull(), // encrypted v2:…
    tokenExpiry: timestamp("token_expiry"),
    historyId: text("history_id"), // Gmail incremental-sync cursor
    lastCheckedAt: timestamp("last_checked_at"),
    active: boolean("active").default(true).notNull(),
    connectedAt: timestamp("connected_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [index("idx_email_connections_active").on(t.active)],
);

export const insertEmailConnectionSchema = createInsertSchema(emailConnections).omit({
  id: true,
  clientId: true,
  connectedAt: true,
});
export type EmailConnection = typeof emailConnections.$inferSelect;
export type InsertEmailConnection = z.infer<typeof insertEmailConnectionSchema>;

// ── email_threads — one row per ingested buyer email ────────────────────
// body/from stored plaintext (matches the repo's notes/buyer_company PII
// boundary). Dedupe via the unique gmail_message_id index.
export const emailThreads = pgTable(
  "email_threads",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    leadId: integer("lead_id").references(() => ceramicLeads.id),
    gmailThreadId: text("gmail_thread_id").notNull(),
    gmailMessageId: text("gmail_message_id").notNull().unique(),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    subject: text("subject"),
    bodyText: text("body_text"),
    sourcePlatform: text("source_platform"), // alibaba | indiamart | tradeindia | direct | website
    language: text("language"), // ISO code
    generatedReply: text("generated_reply"),
    sentReply: text("sent_reply"), // the final (possibly edited) body actually sent
    status: text("status").default("pending_approval").notNull(), // pending_approval | sent
    receivedAt: timestamp("received_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    sentAt: timestamp("sent_at"),
  },
  (t) => [
    index("idx_email_threads_client_id").on(t.clientId),
    index("idx_email_threads_client_status").on(t.clientId, t.status),
  ],
);

export const insertEmailThreadSchema = createInsertSchema(emailThreads).omit({
  id: true,
  clientId: true,
  receivedAt: true,
});
export type EmailThread = typeof emailThreads.$inferSelect;
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;

// ── OUTBOUND MODULE (Slice A: address book) ─────────────────────────────
// Plan: docs/superpowers/plans/2026-06-07-outbound-contacts-and-campaigns.md
//
// ── ceramic_contacts — the outbound address book ────────────────────────
// A first-class prospect list, SEPARATE from ceramic_leads. An imported
// prospect (CSV / trade show / platform export) is not the same as a buyer
// who chatted with the bot. Leads can be *promoted* into contacts (leadId set)
// so inbound + outbound share one book. Buyer PII (name/email/phone) is
// encrypted at rest exactly like ceramic_leads; emailHash/phoneHash are
// peppered HMACs for dedupe + suppression matching without plaintext.
export const ceramicContacts = pgTable(
  "ceramic_contacts",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    name: text("name"), // encrypted v2:…
    email: text("email"), // encrypted v2:…
    emailHash: text("email_hash"), // HMAC for dedupe + suppression match
    phone: text("phone"), // encrypted v2:…
    phoneHash: text("phone_hash"), // HMAC for dedupe
    company: text("company"), // business identity — plaintext (matches buyerCompany)
    country: text("country"),
    city: text("city"),
    buyerType: text("buyer_type"), // retailer | distributor | architect | builder | export | general
    source: text("source").default("manual").notNull(), // csv | lead | manual | tradeshow | indiamart | alibaba | tradeindia
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    // Set when this contact was promoted from a bot lead. Lets us avoid
    // double-importing someone who already chatted, and link back to history.
    leadId: integer("lead_id").references(() => ceramicLeads.id),
    optedOut: boolean("opted_out").default(false).notNull(),
    lastContactedAt: timestamp("last_contacted_at"), // drives the dormant-buyer detector
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_contacts_client_id").on(t.clientId),
    index("idx_ceramic_contacts_client_email_hash").on(t.clientId, t.emailHash),
    index("idx_ceramic_contacts_client_phone_hash").on(t.clientId, t.phoneHash),
    index("idx_ceramic_contacts_client_country").on(t.clientId, t.country),
    index("idx_ceramic_contacts_client_buyer_type").on(t.clientId, t.buyerType),
  ],
);

export const insertCeramicContactSchema = createInsertSchema(ceramicContacts)
  .omit({
    id: true,
    clientId: true,
    emailHash: true,
    phoneHash: true,
    createdAt: true,
    updatedAt: true,
  })
  // tags has a DB default ([]), so callers may omit it.
  .partial({ tags: true });
export type CeramicContact = typeof ceramicContacts.$inferSelect;
export type InsertCeramicContact = z.infer<typeof insertCeramicContactSchema>;

// ── ceramic_contact_imports — audit trail of each CSV upload ────────────
// One row per import so the UI can show history and offer "undo last import".
// errorReport holds the per-row rejections (row number + reason) so the user
// can fix and re-upload. Counts are denormalised for a cheap list view.
export const ceramicContactImports = pgTable(
  "ceramic_contact_imports",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    filename: text("filename"),
    preset: text("preset"), // generic | indiamart | alibaba | tradeindia
    rowsTotal: integer("rows_total").default(0).notNull(),
    rowsImported: integer("rows_imported").default(0).notNull(),
    rowsSkipped: integer("rows_skipped").default(0).notNull(),
    errorReport: jsonb("error_report").$type<Array<{ row: number; reason: string }>>().default([]).notNull(),
    importedBy: uuid("imported_by").references(() => adminUsers.id),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [index("idx_ceramic_contact_imports_client_id").on(t.clientId)],
);

export const insertCeramicContactImportSchema = createInsertSchema(ceramicContactImports).omit({
  id: true,
  clientId: true,
  createdAt: true,
});
export type CeramicContactImport = typeof ceramicContactImports.$inferSelect;
export type InsertCeramicContactImport = z.infer<typeof insertCeramicContactImportSchema>;

// ── ceramic_suppressions — do-not-contact list ──────────────────────────
// Protects the client's sending reputation: an unsubscribe, hard bounce, or
// manual block writes a row here, and the campaign drip engine skips any
// contact whose emailHash/phoneHash matches. Matched by hash (no plaintext).
export const ceramicSuppressions = pgTable(
  "ceramic_suppressions",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    emailHash: text("email_hash"),
    phoneHash: text("phone_hash"),
    reason: text("reason").notNull(), // unsubscribe | bounce | manual | complaint
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_suppressions_client_id").on(t.clientId),
    // One suppression per (client, email). A partial unique index would be
    // ideal (email_hash NOT NULL) but Drizzle's portable uniqueIndex covers the
    // common path; the storage layer also guards with onConflictDoNothing.
    index("idx_ceramic_suppressions_client_email_hash").on(t.clientId, t.emailHash),
    index("idx_ceramic_suppressions_client_phone_hash").on(t.clientId, t.phoneHash),
  ],
);

export const insertCeramicSuppressionSchema = createInsertSchema(ceramicSuppressions).omit({
  id: true,
  clientId: true,
  createdAt: true,
});
export type CeramicSuppression = typeof ceramicSuppressions.$inferSelect;
export type InsertCeramicSuppression = z.infer<typeof insertCeramicSuppressionSchema>;

// ── OUTBOUND MODULE (Slice B: segments + email campaigns) ───────────────
// Plan: docs/superpowers/plans/2026-06-07-outbound-contacts-and-campaigns.md
//
// ── ceramic_segments — a saved, live-resolved audience filter ───────────
// The `rule` is matched against ceramic_contacts at resolve time (not
// materialised) so it stays fresh as contacts are added. Opted-out and
// suppressed contacts are always excluded when resolved for a send.
export const ceramicSegments = pgTable(
  "ceramic_segments",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    name: text("name").notNull(),
    // { country?: string[]; buyerType?: string[]; source?: string[]; tags?: string[] }
    rule: jsonb("rule").$type<{
      country?: string[];
      buyerType?: string[];
      source?: string[];
      tags?: string[];
    }>().default({}).notNull(),
    // System-managed segments (e.g. the dormant-buyer "auto:winback") carry a
    // kind so the UI can label them and the detector can find/refresh its row.
    kind: text("kind").default("manual").notNull(), // manual | auto:winback
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [index("idx_ceramic_segments_client_id").on(t.clientId)],
);

export const insertCeramicSegmentSchema = createInsertSchema(ceramicSegments).omit({
  id: true,
  clientId: true,
  createdAt: true,
  updatedAt: true,
});
export type CeramicSegment = typeof ceramicSegments.$inferSelect;
export type InsertCeramicSegment = z.infer<typeof insertCeramicSegmentSchema>;

// ── ceramic_campaigns — one outbound campaign (a sequence of steps) ──────
// Subject/body/catalogue live on ceramic_campaign_steps; a one-shot blast is
// a campaign with a single step. `stats` is a denormalised counter cache for
// the report (so the list view is one row read, not an aggregate per render).
export const ceramicCampaigns = pgTable(
  "ceramic_campaigns",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    name: text("name").notNull(),
    channel: text("channel").notNull().default("email"), // email | whatsapp (slice C)
    segmentId: integer("segment_id").references(() => ceramicSegments.id),
    aiPersonalize: boolean("ai_personalize").default(false).notNull(),
    status: text("status").notNull().default("draft"), // draft | scheduled | sending | paused | done
    scheduledAt: timestamp("scheduled_at"),
    stats: jsonb("stats").$type<{
      total?: number;
      queued?: number;
      sent?: number;
      opened?: number;
      replied?: number;
      hot?: number;
      sampleRequests?: number;
      failed?: number;
      unsubscribed?: number;
    }>().default({}).notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_campaigns_client_id").on(t.clientId),
    index("idx_ceramic_campaigns_client_status").on(t.clientId, t.status),
  ],
);

export const insertCeramicCampaignSchema = createInsertSchema(ceramicCampaigns)
  .omit({
    id: true,
    clientId: true,
    createdAt: true,
    updatedAt: true,
  })
  // stats has a DB default ({}), so callers may omit it.
  .partial({ stats: true });
export type CeramicCampaign = typeof ceramicCampaigns.$inferSelect;
export type InsertCeramicCampaign = z.infer<typeof insertCeramicCampaignSchema>;

// ── ceramic_campaign_steps — ordered touches in a campaign ──────────────
// stepIndex 0 = first email; delayDays is the offset before THIS step fires
// (0 for the first). Slice B ships single-step; the table is multi-step ready
// so Slice B2 (sequences) needs no schema change. Plaintext business content.
export const ceramicCampaignSteps = pgTable(
  "ceramic_campaign_steps",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    campaignId: integer("campaign_id").notNull().references(() => ceramicCampaigns.id),
    stepIndex: integer("step_index").notNull().default(0),
    delayDays: integer("delay_days").notNull().default(0),
    subject: text("subject").notNull(),
    bodyTemplate: text("body_template").notNull(), // may contain {{name}} {{company}} {{catalogue}} tokens
    catalogueId: integer("catalogue_id").references(() => ceramicCatalogues.id),
    whatsappTemplateName: text("whatsapp_template_name"), // slice C
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_campaign_steps_campaign").on(t.campaignId, t.stepIndex),
    index("idx_ceramic_campaign_steps_client_id").on(t.clientId),
  ],
);

export const insertCeramicCampaignStepSchema = createInsertSchema(ceramicCampaignSteps).omit({
  id: true,
  clientId: true,
  createdAt: true,
});
export type CeramicCampaignStep = typeof ceramicCampaignSteps.$inferSelect;
export type InsertCeramicCampaignStep = z.infer<typeof insertCeramicCampaignStepSchema>;

// ── ceramic_campaign_recipients — one contact's run through a campaign ───
// `status` lifecycle: queued → sending → sent (single-step done) | active
// (sequence in progress) → replied | unsubscribed | bounced | failed. A reply
// sets status='replied' so the drip skips it forever (auto-stop). replyIntent
// is set by the LLM triage on the inbound reply.
export const ceramicCampaignRecipients = pgTable(
  "ceramic_campaign_recipients",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    campaignId: integer("campaign_id").notNull().references(() => ceramicCampaigns.id),
    contactId: integer("contact_id").notNull().references(() => ceramicContacts.id),
    currentStep: integer("current_step").notNull().default(0),
    status: text("status").notNull().default("queued"), // queued|sending|sent|active|replied|bounced|unsubscribed|failed
    replyIntent: text("reply_intent"), // sample_request|hot|lukewarm|not_now|wrong_person|unsubscribe
    nextSendAt: timestamp("next_send_at"), // when the next step is due (sequences)
    renderedSubject: text("rendered_subject"), // audit of the last send
    renderedBody: text("rendered_body"),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    error: text("error"),
    openedAt: timestamp("opened_at"), // first tracked-link hit
    lastSentAt: timestamp("last_sent_at"),
    repliedAt: timestamp("replied_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_campaign_recipients_campaign_status").on(t.campaignId, t.status),
    index("idx_ceramic_campaign_recipients_client_id").on(t.clientId),
    index("idx_ceramic_campaign_recipients_contact").on(t.contactId),
    index("idx_ceramic_campaign_recipients_due").on(t.status, t.nextSendAt),
  ],
);

export const insertCeramicCampaignRecipientSchema = createInsertSchema(ceramicCampaignRecipients).omit({
  id: true,
  clientId: true,
  createdAt: true,
});
export type CeramicCampaignRecipient = typeof ceramicCampaignRecipients.$inferSelect;
export type InsertCeramicCampaignRecipient = z.infer<typeof insertCeramicCampaignRecipientSchema>;

// ── ceramic_tracked_links — redirect+count for catalogue-open signals ────
// An outbound catalogue link is sent as /r/:token instead of the raw URL. A
// hit increments hitCount and 302s to targetUrl; ≥1 hit is the open signal.
export const ceramicTrackedLinks = pgTable(
  "ceramic_tracked_links",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    token: text("token").notNull().unique(), // URL-safe random; the public id in /r/:token
    targetUrl: text("target_url").notNull(),
    campaignId: integer("campaign_id").references(() => ceramicCampaigns.id),
    recipientId: integer("recipient_id").references(() => ceramicCampaignRecipients.id),
    catalogueId: integer("catalogue_id").references(() => ceramicCatalogues.id),
    hitCount: integer("hit_count").default(0).notNull(),
    firstHitAt: timestamp("first_hit_at"),
    lastHitAt: timestamp("last_hit_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_tracked_links_client_id").on(t.clientId),
    index("idx_ceramic_tracked_links_recipient").on(t.recipientId),
  ],
);

export const insertCeramicTrackedLinkSchema = createInsertSchema(ceramicTrackedLinks).omit({
  id: true,
  clientId: true,
  createdAt: true,
});
export type CeramicTrackedLink = typeof ceramicTrackedLinks.$inferSelect;
export type InsertCeramicTrackedLink = z.infer<typeof insertCeramicTrackedLinkSchema>;
