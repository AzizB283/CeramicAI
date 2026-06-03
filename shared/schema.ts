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
    status: text("status").default("pending_approval").notNull(), // pending_approval (only value this slice)
    receivedAt: timestamp("received_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
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
