/**
 * Outbound campaigns + segments — /api/admin/campaigns/*
 *
 * Segments are saved audience filters (live-resolved against contacts).
 * Campaigns are a name + segment + a single step (subject/body/catalogue) for
 * Slice B. "Send" enrolls the segment's sendable contacts as queued recipients
 * and flips the campaign to "sending"; the drip scheduler does the actual work.
 *
 * Tenant-scoped via the resolveClient(...) + runWithClient(...) pattern.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { requireAuth, effectiveClientId, AuthError } from "../auth";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import { previewSegment } from "../services/segments";
import { computeStats } from "../services/campaignScheduler";
import type { SegmentRule } from "@shared/types";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

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

const segmentRuleSchema = z
  .object({
    country: z.array(z.string().trim().max(120)).max(100).optional(),
    buyerType: z.array(z.string().trim().max(60)).max(20).optional(),
    source: z.array(z.string().trim().max(40)).max(20).optional(),
    tags: z.array(z.string().trim().max(60)).max(50).optional(),
  })
  .strict();

// ── segments ──────────────────────────────────────────────────────────
campaignsRouter.get("/segments", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const segments = await runWithClient(clientId, () => storage.getSegments());
  res.json(segments);
});

// POST /segments/preview → audience size + sample for a rule (no save).
campaignsRouter.post("/segments/preview", async (req, res) => {
  const parsed = segmentRuleSchema.safeParse(req.body?.rule ?? req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid rule", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const preview = await runWithClient(clientId, () => previewSegment(parsed.data as SegmentRule));
  res.json(preview);
});

const segmentBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    rule: segmentRuleSchema,
  })
  .strict();

campaignsRouter.post("/segments", async (req, res) => {
  const parsed = segmentBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid segment", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const segment = await runWithClient(clientId, () =>
    storage.createSegment({ name: parsed.data.name, rule: parsed.data.rule, kind: "manual" }),
  );
  res.status(201).json(segment);
});

campaignsRouter.patch("/segments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid segment id" });
  const parsed = segmentBodySchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid patch", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    const updated = await runWithClient(clientId, () => storage.updateSegment(id, parsed.data));
    res.json(updated);
  } catch {
    res.status(404).json({ error: "segment not found" });
  }
});

campaignsRouter.delete("/segments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid segment id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, () => storage.deleteSegment(id));
  res.status(204).end();
});

// ── campaigns ─────────────────────────────────────────────────────────
campaignsRouter.get("/", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const campaigns = await runWithClient(clientId, () => storage.getCampaigns());
  res.json(campaigns);
});

// GET /:id → campaign + its steps + a freshly-computed report (recipient stats)
campaignsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid campaign id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const result = await runWithClient(clientId, async () => {
    const campaign = await storage.getCampaign(id);
    if (!campaign) return null;
    const steps = await storage.getCampaignSteps(id);
    const recipients = await storage.getCampaignRecipients(id);
    return { campaign, steps, stats: computeStats(recipients), recipientCount: recipients.length };
  });
  if (!result) return res.status(404).json({ error: "campaign not found" });
  res.json(result);
});

// A campaign is created with its single step in one call (Slice B). Multi-step
// add is a later slice; the schema already supports it.
const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    segmentId: z.number().int().positive(),
    aiPersonalize: z.boolean().optional(),
    subject: z.string().trim().min(1).max(300),
    bodyTemplate: z.string().trim().min(1).max(20000),
    catalogueId: z.number().int().positive().nullable().optional(),
  })
  .strict();

campaignsRouter.post("/", async (req, res) => {
  const parsed = createCampaignSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid campaign", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const data = parsed.data;
  const result = await runWithClient(clientId, async () => {
    const segment = await storage.getSegment(data.segmentId);
    if (!segment) return { error: "segment not found" as const };
    if (data.catalogueId) {
      const cat = await storage.getCatalogue(data.catalogueId);
      if (!cat) return { error: "catalogue not found" as const };
    }
    const campaign = await storage.createCampaign({
      name: data.name,
      channel: "email",
      segmentId: data.segmentId,
      aiPersonalize: data.aiPersonalize ?? false,
      status: "draft",
    });
    await storage.createCampaignStep({
      campaignId: campaign.id,
      stepIndex: 0,
      delayDays: 0,
      subject: data.subject,
      bodyTemplate: data.bodyTemplate,
      catalogueId: data.catalogueId ?? null,
    });
    return { campaign };
  });
  if ("error" in result) return res.status(400).json({ error: result.error });
  res.status(201).json(result.campaign);
});

// POST /:id/send → enroll the segment's sendable contacts and start sending.
campaignsRouter.post("/:id/send", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid campaign id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const result = await runWithClient(clientId, async () => {
    const campaign = await storage.getCampaign(id);
    if (!campaign) return { error: "campaign not found" as const, code: 404 };
    if (campaign.status === "sending") return { error: "campaign already sending" as const, code: 409 };
    if (campaign.status === "done") return { error: "campaign already completed" as const, code: 409 };
    if (!campaign.segmentId) return { error: "campaign has no segment" as const, code: 400 };
    const connection = await storage.getEmailConnection();
    if (!connection?.active) return { error: "no Gmail connected — connect one in Integrations" as const, code: 400 };

    const segment = await storage.getSegment(campaign.segmentId);
    if (!segment) return { error: "segment not found" as const, code: 400 };

    // Resolve the sendable audience (opted-out + suppressed already excluded).
    const contacts = await storage.resolveSegment(segment.rule, { forSend: true });
    if (contacts.length === 0) return { error: "no sendable contacts in this segment" as const, code: 400 };

    // Avoid double-enrolling a contact already on this campaign (e.g. re-send).
    const existing = await storage.getCampaignRecipients(id);
    const already = new Set(existing.map((r) => r.contactId));
    const fresh = contacts.filter((c) => !already.has(c.id));

    const rows = fresh.map((c) => ({
      campaignId: id,
      contactId: c.id,
      currentStep: 0,
      status: "queued" as const,
    }));
    const enrolled = await storage.createCampaignRecipients(rows);
    await storage.updateCampaign(id, { status: "sending", startedAt: new Date() });
    return { enrolled, audience: contacts.length };
  });
  if ("error" in result) return res.status(result.code ?? 400).json({ error: result.error });
  res.json({ ok: true, ...result });
});

// POST /:id/pause and /:id/resume — flip sending↔paused.
campaignsRouter.post("/:id/pause", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid campaign id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    const c = await runWithClient(clientId, () => storage.updateCampaign(id, { status: "paused" }));
    res.json(c);
  } catch {
    res.status(404).json({ error: "campaign not found" });
  }
});

campaignsRouter.post("/:id/resume", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid campaign id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    const c = await runWithClient(clientId, () => storage.updateCampaign(id, { status: "sending" }));
    res.json(c);
  } catch {
    res.status(404).json({ error: "campaign not found" });
  }
});

campaignsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid campaign id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, () => storage.deleteCampaign(id));
  res.status(204).end();
});
