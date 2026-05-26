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
  name: text("name").notNull(), // "Shree Tiles Pvt Ltd"
  mode: text("mode").notNull(), // "factory" | "exporter"
  ownerName: text("owner_name"),
  ownerWhatsapp: text("owner_whatsapp"), // owner phone for alerts
  catalogUrl: text("catalog_url"),
  exportCatalogUrl: text("export_catalog_url"),
  waPhoneId: text("wa_phone_id"), // WhatsApp Cloud API phone ID
  waToken: text("wa_token"), // encrypted at application layer
  waVerifyToken: text("wa_verify_token"),
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
