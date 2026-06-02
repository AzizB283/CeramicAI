import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import type {
  CeramicClient,
  CeramicLead,
  InsertCeramicCatalogue,
  InsertCeramicProduct,
} from "@shared/schema";
import { insertCeramicCatalogueSchema } from "@shared/schema";
import { requireAuth, effectiveClientId, AuthError } from "../auth";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import { encrypt, decrypt, isEncrypted } from "../utils/encryption";

export const adminRouter = Router();

// Everything under /api/admin requires a logged-in admin.
adminRouter.use(requireAuth);

/**
 * Resolve the client id this admin request operates on:
 *  - factory admin → their own session clientId,
 *  - superadmin → the factory they're impersonating (or 403 if none).
 * On failure, writes the error response and returns null — callers must
 * `if (!clientId) return;`. This replaces the old ensureDemoClient() that
 * hard-pinned every route to the single demo factory.
 */
function resolveClient(req: Request, res: Response): string | null {
  try {
    return effectiveClientId(req);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

const LEAD_STATUSES = ["new", "contacted", "converted", "lost"] as const;

// Strip secrets before returning a client row to the admin UI.
function publicClient(client: CeramicClient): Omit<CeramicClient, "waToken"> {
  const { waToken: _waToken, ...rest } = client;
  return rest;
}

// Fields the admin UI is allowed to edit on the demo client. Notably excludes
// waToken (secret) and id/createdAt (immutable).
const EDITABLE_CLIENT_FIELDS = [
  "name",
  "mode",
  "ownerName",
  "ownerWhatsapp",
  "ownerEmail",
  "catalogUrl",
  "exportCatalogUrl",
  "waPhoneId",
  "waVerifyToken",
  "widgetColor",
  "widgetName",
  "widgetGreeting",
  "timezone",
  "active",
] as const;

/**
 * Audit a PII-bearing read when a superadmin is impersonating a factory.
 * Factory admins reading their own leads are NOT logged (it's their data).
 * Fire-and-forget — a logging failure must not break the read.
 */
function auditLeadsView(req: Request, clientId: string, detail: string): void {
  const user = req.session?.user;
  if (user?.role !== "superadmin") return;
  void storage
    .logSuperadminAction({
      superadminId: user.id,
      clientId,
      action: "view_leads",
      detail,
    })
    .catch((err) => console.error("[audit] view_leads log failed:", err));
}

// GET /api/admin/leads → all leads for the resolved client
adminRouter.get("/leads", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const leads = await runWithClient(clientId, () => storage.getLeads());
  auditLeadsView(req, clientId, "list");
  res.json(leads);
});

// GET /api/admin/leads/:id → single lead
adminRouter.get("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid lead id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const lead = await runWithClient(clientId, () => storage.getLead(id));
  if (!lead) return res.status(404).json({ error: "lead not found" });
  auditLeadsView(req, clientId, `lead:${id}`);
  res.json(lead);
});

// Whitelist of lead fields an admin may edit manually. Intentionally excludes
// product / size / finish / quantity / incoterms — those are evidence of what
// the buyer told the bot; rewriting them would falsify the record.
// `priority` is editable so admins can promote/demote leads after triage.
const LEAD_PRIORITIES = ["normal", "high", "priority"] as const;
const leadPatchSchema = z
  .object({
    status: z.enum(LEAD_STATUSES).optional(),
    priority: z.enum(LEAD_PRIORITIES).optional(),
    buyerName: z.string().trim().max(200).nullable().optional(),
    buyerPhone: z.string().trim().max(40).nullable().optional(),
    buyerEmail: z.string().trim().email().max(200).nullable().or(z.literal("")).optional(),
    buyerCompany: z.string().trim().max(200).nullable().optional(),
    buyerCity: z.string().trim().max(120).nullable().optional(),
    buyerCountry: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

// PATCH /api/admin/leads/:id → admin edits contact / status / notes. Pre-existing
// callers (the leads table's status Select) still work — status is one of the
// allowed fields. Unknown fields are rejected by .strict() so a misbehaving
// client can't quietly write product fields.
adminRouter.patch("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid lead id" });
  const parsed = leadPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid patch", details: parsed.error.flatten() });
  }
  // Normalize "" → null for nullable text fields (admin "cleared" the input).
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    patch[k] = typeof v === "string" && v.trim() === "" ? null : v;
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "no editable fields provided" });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    const updated = await runWithClient(clientId, () => storage.updateLead(id, patch));
    res.json(updated);
  } catch {
    res.status(404).json({ error: "lead not found" });
  }
});

// DELETE /api/admin/leads/:id → hard delete (cascades to scheduled followups
// via storage.deleteLead). Caller must confirm in the UI.
adminRouter.delete("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid lead id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  // Confirm the lead exists in this tenant before delete, so we can return 404
  // properly (storage.deleteLead silently no-ops on a missing/foreign id).
  const existing = await runWithClient(clientId, () => storage.getLead(id));
  if (!existing) return res.status(404).json({ error: "lead not found" });
  await runWithClient(clientId, () => storage.deleteLead(id));
  res.status(204).end();
});

// GET /api/admin/stats → aggregate counts computed from the lead list
adminRouter.get("/stats", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const leads = await runWithClient(clientId, () => storage.getLeads());

  const byStatus = { new: 0, contacted: 0, converted: 0, lost: 0 };
  const byPriority = { normal: 0, high: 0, priority: 0 };
  let distributorInquiries = 0;
  let recent = 0;
  // Priority leads still awaiting action — status new or contacted (i.e. not
  // converted/lost). This is the count the owner needs to see on the dashboard.
  let priorityWaiting = 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const lead of leads as CeramicLead[]) {
    if (lead.status && lead.status in byStatus) {
      byStatus[lead.status as keyof typeof byStatus]++;
    }
    if (lead.priority && lead.priority in byPriority) {
      byPriority[lead.priority as keyof typeof byPriority]++;
    }
    if (lead.isDistributorInquiry) distributorInquiries++;
    if (lead.createdAt && new Date(lead.createdAt).getTime() >= sevenDaysAgo) recent++;
    if (
      lead.priority === "priority" &&
      (lead.status === "new" || lead.status === "contacted")
    ) {
      priorityWaiting++;
    }
  }

  res.json({
    total: leads.length,
    byStatus,
    byPriority,
    distributorInquiries,
    priorityWaiting,
    recent,
  });
});

// GET /api/admin/settings → the resolved client row (minus waToken)
adminRouter.get("/settings", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const client = await storage.getClient(clientId);
  if (!client) return res.status(404).json({ error: "client not found" });
  res.json(publicClient(client));
});

// PATCH /api/admin/settings { ...fields } → update the resolved client (minus waToken)
adminRouter.patch("/settings", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_CLIENT_FIELDS) {
    if (field in body && body[field] !== undefined) patch[field] = body[field];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "no editable fields provided" });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const updated = await storage.updateClient(clientId, patch);
  res.json(publicClient(updated));
});

// ── Catalogues ────────────────────────────────────────────────────────
//
// Per-factory PDF / Google Drive catalogues. Tenant-scoped via runWithClient.
// All mutations go through Zod validation (insertCeramicCatalogueSchema +
// .partial() for PATCH) so the client can't sneak unknown fields through.

const CATALOGUE_CATEGORIES = [
  "ceramic_wall",
  "gvt",
  "pgvt",
  "double_charge",
  "slab",
  "sanitaryware",
  "mixed",
] as const;
const CATALOGUE_AUDIENCES = ["domestic", "export", "both"] as const;

const catalogueInputSchema = insertCeramicCatalogueSchema.extend({
  category: insertCeramicCatalogueSchema.shape.category.refine(
    (v): v is (typeof CATALOGUE_CATEGORIES)[number] =>
      (CATALOGUE_CATEGORIES as readonly string[]).includes(v),
    { message: `category must be one of ${CATALOGUE_CATEGORIES.join(", ")}` },
  ),
  audience: insertCeramicCatalogueSchema.shape.audience.refine(
    (v): v is (typeof CATALOGUE_AUDIENCES)[number] =>
      v == null || (CATALOGUE_AUDIENCES as readonly string[]).includes(v),
    { message: `audience must be one of ${CATALOGUE_AUDIENCES.join(", ")}` },
  ),
  url: insertCeramicCatalogueSchema.shape.url.refine(
    (v) => /^https?:\/\//i.test(v),
    { message: "url must start with http:// or https://" },
  ),
});

// GET /api/admin/catalogues → list (newest active first, then by display order)
adminRouter.get("/catalogues", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const list = await runWithClient(clientId, () => storage.getCatalogues());
  res.json(list);
});

// POST /api/admin/catalogues → create
adminRouter.post("/catalogues", async (req, res) => {
  const parsed = catalogueInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid catalogue", issues: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const created = await runWithClient(clientId, () =>
    storage.createCatalogue(parsed.data as InsertCeramicCatalogue),
  );
  res.status(201).json(created);
});

// PATCH /api/admin/catalogues/:id → update fields
adminRouter.patch("/catalogues/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid catalogue id" });
  const parsed = catalogueInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid patch", issues: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    const updated = await runWithClient(clientId, () =>
      storage.updateCatalogue(id, parsed.data as Partial<InsertCeramicCatalogue>),
    );
    res.json(updated);
  } catch {
    res.status(404).json({ error: "catalogue not found" });
  }
});

// DELETE /api/admin/catalogues/:id
adminRouter.delete("/catalogues/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid catalogue id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, () => storage.deleteCatalogue(id));
  res.status(204).end();
});

// ── WhatsApp config ───────────────────────────────────────────────────
//
// The factory pastes their Meta WhatsApp Business credentials into the
// Integrations page. We store the access token and app secret encrypted
// (v2:…) and mask them on read so the UI can show "*** configured" without
// surfacing the raw secret.

interface WhatsAppConfigResponse {
  slug: string;
  waPhoneId: string | null;
  waVerifyToken: string | null;
  waTokenConfigured: boolean;
  waAppSecretConfigured: boolean;
  webhookUrl: string; // computed for the UI to show
}

function publicWhatsAppConfig(client: CeramicClient, originHint: string): WhatsAppConfigResponse {
  return {
    slug: client.slug,
    waPhoneId: client.waPhoneId,
    waVerifyToken: client.waVerifyToken,
    waTokenConfigured: !!client.waToken,
    waAppSecretConfigured: !!client.waAppSecret,
    webhookUrl: `${originHint.replace(/\/$/, "")}/api/whatsapp/${client.slug}`,
  };
}

// GET /api/admin/whatsapp → current config (secrets masked)
adminRouter.get("/whatsapp", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const client = await storage.getClient(clientId);
  if (!client) return res.status(404).json({ error: "client not found" });
  const origin = `${req.protocol}://${req.get("host") ?? "localhost"}`;
  res.json(publicWhatsAppConfig(client, origin));
});

// PATCH /api/admin/whatsapp → update fields. Body shape:
//   { waPhoneId?, waVerifyToken?, waToken?, waAppSecret? }
// Secrets (waToken, waAppSecret) get encrypted on the way in. To CLEAR a
// secret, send the literal string "" (empty string). To leave it
// unchanged, omit the field.
adminRouter.patch("/whatsapp", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const patch: Record<string, string | null> = {};

  // Plain fields — public-ish, stored as-is.
  for (const field of ["waPhoneId", "waVerifyToken"] as const) {
    if (field in body) {
      const v = body[field];
      patch[field] = typeof v === "string" && v.trim() ? v.trim() : null;
    }
  }

  // Secrets — encrypted before storage. Don't re-encrypt already-encrypted
  // values (callers shouldn't be sending those, but be defensive).
  for (const field of ["waToken", "waAppSecret"] as const) {
    if (field in body) {
      const v = body[field];
      if (typeof v !== "string" || !v.trim()) {
        patch[field] = null;
      } else if (isEncrypted(v)) {
        patch[field] = v;
      } else {
        patch[field] = encrypt(v.trim());
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "no editable WhatsApp fields provided" });
  }

  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const updated = await storage.updateClient(clientId, patch);
  const origin = `${req.protocol}://${req.get("host") ?? "localhost"}`;
  res.json(publicWhatsAppConfig(updated, origin));
});

// POST /api/admin/whatsapp/test → quick sanity check: are credentials present,
// and can we decrypt them? Doesn't actually call Meta — that's the dashboard's
// "Send a test message" affordance (TODO once webhooks are confirmed live).
adminRouter.post("/whatsapp/test", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const client = await storage.getClient(clientId);
  if (!client) return res.status(404).json({ error: "client not found" });
  const problems: string[] = [];
  if (!client.waPhoneId) problems.push("Missing waPhoneId");
  if (!client.waToken) problems.push("Missing access token");
  if (!client.waVerifyToken) problems.push("Missing verify token");
  if (!client.waAppSecret) problems.push("Missing app secret");
  if (client.waToken) {
    try {
      decrypt(client.waToken);
    } catch {
      problems.push("Access token could not be decrypted (re-save it)");
    }
  }
  if (client.waAppSecret) {
    try {
      decrypt(client.waAppSecret);
    } catch {
      problems.push("App secret could not be decrypted (re-save it)");
    }
  }
  res.json({ ok: problems.length === 0, problems });
});

// ── Products (per-factory product configuration) ─────────────────────
//
// The admin Products page edits all rows at once, so the PUT endpoint takes
// the full desired set and we replace the table contents in one transaction.
// Empty array = factory has no configured products → bot uses the hardcoded
// defaults in shared/flows.ts.

const PRODUCT_CATEGORIES = [
  "ceramic_wall",
  "gvt",
  "pgvt",
  "double_charge",
  "slab",
  "sanitaryware",
  "other",
] as const;

const productItemSchema = z.object({
  category: z.enum(PRODUCT_CATEGORIES),
  customLabel: z.string().trim().min(1).max(60).nullable().optional(),
  sizes: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  finishes: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  subItems: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(999).default(0),
});

const productsPutSchema = z.object({
  items: z.array(productItemSchema).max(20),
});

// GET /api/admin/products → list current factory's product rows
adminRouter.get("/products", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const rows = await runWithClient(clientId, () => storage.getProducts());
  res.json(rows);
});

// PUT /api/admin/products { items: [...] } → replace the full set
adminRouter.put("/products", async (req, res) => {
  const parsed = productsPutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
  }

  // Reject duplicate categories — each category can have only one row per
  // factory, and the wipe-and-reinsert pattern wouldn't catch the conflict
  // gracefully without a unique constraint we deliberately don't have (so
  // we can add multiple "other"s later if needed).
  const seen = new Set<string>();
  for (const it of parsed.data.items) {
    if (it.category !== "other" && seen.has(it.category)) {
      return res.status(400).json({ error: `duplicate category: ${it.category}` });
    }
    seen.add(it.category);
  }

  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const toInsert: InsertCeramicProduct[] = parsed.data.items.map((it) => ({
    category: it.category,
    customLabel: it.customLabel ?? null,
    sizes: it.sizes,
    finishes: it.finishes,
    subItems: it.subItems,
    isActive: it.isActive,
    displayOrder: it.displayOrder,
  }));
  const rows = await storage.replaceProducts(clientId, toInsert);
  res.json(rows);
});
