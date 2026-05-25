import { Router } from "express";
import type { CeramicClient, CeramicLead } from "@shared/schema";
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
  }

  res.json({
    total: leads.length,
    byStatus,
    byPriority,
    distributorInquiries,
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
