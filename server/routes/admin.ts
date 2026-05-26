import { Router } from "express";
import type { CeramicClient, CeramicLead, InsertCeramicCatalogue } from "@shared/schema";
import { insertCeramicCatalogueSchema } from "@shared/schema";
import { requireAuth } from "../auth";
import { ensureDemoClient } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";

export const adminRouter = Router();

// Everything under /api/admin requires a logged-in admin.
adminRouter.use(requireAuth);

const LEAD_STATUSES = ["new", "contacted", "converted", "lost"] as const;
type LeadStatus = (typeof LEAD_STATUSES)[number];

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

// GET /api/admin/leads → all leads for the demo client
adminRouter.get("/leads", async (_req, res) => {
  const clientId = await ensureDemoClient();
  const leads = await runWithClient(clientId, () => storage.getLeads());
  res.json(leads);
});

// GET /api/admin/leads/:id → single lead
adminRouter.get("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid lead id" });
  const clientId = await ensureDemoClient();
  const lead = await runWithClient(clientId, () => storage.getLead(id));
  if (!lead) return res.status(404).json({ error: "lead not found" });
  res.json(lead);
});

// PATCH /api/admin/leads/:id { status } → update lead status
adminRouter.patch("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid lead id" });
  const { status } = req.body ?? {};
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${LEAD_STATUSES.join(", ")}` });
  }
  const clientId = await ensureDemoClient();
  try {
    const updated = await runWithClient(clientId, () =>
      storage.updateLead(id, { status: status as LeadStatus }),
    );
    res.json(updated);
  } catch {
    res.status(404).json({ error: "lead not found" });
  }
});

// GET /api/admin/stats → aggregate counts computed from the lead list
adminRouter.get("/stats", async (_req, res) => {
  const clientId = await ensureDemoClient();
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

// GET /api/admin/settings → the demo client row (minus waToken)
adminRouter.get("/settings", async (_req, res) => {
  const clientId = await ensureDemoClient();
  const client = await storage.getClient(clientId);
  if (!client) return res.status(404).json({ error: "client not found" });
  res.json(publicClient(client));
});

// PATCH /api/admin/settings { ...fields } → update the demo client (minus waToken)
adminRouter.patch("/settings", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_CLIENT_FIELDS) {
    if (field in body && body[field] !== undefined) patch[field] = body[field];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: "no editable fields provided" });
  }
  const clientId = await ensureDemoClient();
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
adminRouter.get("/catalogues", async (_req, res) => {
  const clientId = await ensureDemoClient();
  const list = await runWithClient(clientId, () => storage.getCatalogues());
  res.json(list);
});

// POST /api/admin/catalogues → create
adminRouter.post("/catalogues", async (req, res) => {
  const parsed = catalogueInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid catalogue", issues: parsed.error.flatten() });
  }
  const clientId = await ensureDemoClient();
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
  const clientId = await ensureDemoClient();
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
  const clientId = await ensureDemoClient();
  await runWithClient(clientId, () => storage.deleteCatalogue(id));
  res.status(204).end();
});
