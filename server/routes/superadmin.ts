import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { CeramicClient } from "@shared/schema";
import { requireAuth, requireSuperAdmin } from "../auth";
import { storage } from "../storage";

// All /api/superadmin/* routes require a logged-in superadmin. The prefix
// guard means no route here can ship unguarded (mirrors clinic-ai).
export const superadminRouter = Router();
superadminRouter.use(requireAuth, requireSuperAdmin);

const BCRYPT_ROUNDS = 12;

// Slug rules: lowercase letters, digits, hyphens. It's the WhatsApp webhook
// URL + embed data-client, and it's IMMUTABLE after create (decision), so we
// validate it strictly up front.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const createClientSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().min(2).max(60).regex(SLUG_RE, {
    message: "slug must be lowercase letters, digits, and hyphens",
  }),
  mode: z.enum(["factory", "exporter"]),
  ownerName: z.string().trim().max(120).optional(),
  ownerWhatsapp: z.string().trim().max(40).optional(),
  adminUsername: z.string().trim().min(3).max(50),
  adminPassword: z.string().min(8).max(200),
  adminName: z.string().trim().max(120).optional(),
});

// slug is intentionally NOT updatable (immutable after create).
const updateClientSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  ownerName: z.string().trim().max(120).nullable().optional(),
  ownerWhatsapp: z.string().trim().max(40).nullable().optional(),
  active: z.boolean().optional(),
});

const addAdminSchema = z.object({
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(200),
  name: z.string().trim().max(120).optional(),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200),
});

// Strip the secret token before returning a client to the panel.
function publicClient(c: CeramicClient): Omit<CeramicClient, "waToken"> {
  const { waToken: _waToken, ...rest } = c;
  return rest;
}

// GET /api/superadmin/clients → all factories with usage counts
superadminRouter.get("/clients", async (_req, res) => {
  const clients = await storage.listAllClients();
  // listAllClients adds count fields; strip waToken, keep the counts.
  res.json(
    clients.map(({ waToken: _waToken, ...rest }) => rest),
  );
});

// GET /api/superadmin/clients/:id → factory + its admin users
superadminRouter.get("/clients/:id", async (req, res) => {
  const result = await storage.getClientWithAdmins(req.params.id);
  if (!result) return res.status(404).json({ error: "client not found" });
  res.json({
    client: publicClient(result.client),
    admins: result.admins.map((a) => ({
      id: a.id,
      username: a.username,
      name: a.name,
      role: a.role,
      active: a.active,
      createdAt: a.createdAt,
    })),
  });
});

// POST /api/superadmin/clients → create a factory + its first admin in one op.
// Returns the admin's plaintext password ONCE for out-of-band handoff.
superadminRouter.post("/clients", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation failed", details: parsed.error.flatten() });
  }
  const d = parsed.data;

  // Slug is immutable + the routing key — reject collisions rather than
  // silently suffixing (the operator picks the slug deliberately).
  if (await storage.getClientBySlug(d.slug)) {
    return res.status(409).json({ error: `slug "${d.slug}" is already in use` });
  }
  if (await storage.getAdminUserByUsername(d.adminUsername)) {
    return res.status(409).json({ error: "admin username already in use" });
  }

  const client = await storage.createClient({
    slug: d.slug,
    name: d.name,
    mode: d.mode,
    ownerName: d.ownerName ?? null,
    ownerWhatsapp: d.ownerWhatsapp ?? null,
  });

  const admin = await storage.createAdminUser({
    clientId: client.id,
    username: d.adminUsername,
    password: await bcrypt.hash(d.adminPassword, BCRYPT_ROUNDS),
    name: d.adminName ?? "Factory Admin",
    role: "factory",
    active: true,
  });

  res.status(201).json({
    client: publicClient(client),
    // Plaintext password echoed back ONCE — never stored or returned again.
    admin: { id: admin.id, username: admin.username, password: d.adminPassword },
  });
});

// PATCH /api/superadmin/clients/:id → update name/owner/active (NOT slug)
superadminRouter.patch("/clients/:id", async (req, res) => {
  const parsed = updateClientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation failed", details: parsed.error.flatten() });
  }
  // Defensive: reject an attempt to change the immutable slug.
  if ("slug" in (req.body ?? {})) {
    return res.status(400).json({ error: "slug is immutable and cannot be changed" });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: "no editable fields provided" });
  }
  const existing = await storage.getClient(req.params.id);
  if (!existing) return res.status(404).json({ error: "client not found" });
  const updated = await storage.updateClient(req.params.id, parsed.data);
  res.json(publicClient(updated));
});

// POST /api/superadmin/clients/:id/admins → add another admin to a factory
superadminRouter.post("/clients/:id/admins", async (req, res) => {
  const parsed = addAdminSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation failed", details: parsed.error.flatten() });
  }
  const client = await storage.getClient(req.params.id);
  if (!client) return res.status(404).json({ error: "client not found" });
  if (await storage.getAdminUserByUsername(parsed.data.username)) {
    return res.status(409).json({ error: "username already in use" });
  }
  const admin = await storage.createAdminUser({
    clientId: client.id,
    username: parsed.data.username,
    password: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS),
    name: parsed.data.name ?? "Factory Admin",
    role: "factory",
    active: true,
  });
  res.status(201).json({ id: admin.id, username: admin.username, name: admin.name, role: admin.role });
});

// POST /api/superadmin/admins/:id/reset-password → set a new password.
// Refuses superadmin accounts (anti-lockout). Returns plaintext ONCE.
superadminRouter.post("/admins/:id/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation failed", details: parsed.error.flatten() });
  }
  const hash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  const result = await storage.resetAdminPassword(req.params.id, hash);
  if (!result) {
    return res.status(404).json({ error: "admin not found (or is a superadmin)" });
  }
  res.json({ id: result.id, username: result.username, password: parsed.data.newPassword });
});

// ── Impersonation ─────────────────────────────────────────────────────
// A superadmin "enters" a factory's panel: we set session.actingClientId
// (server-side, never client-forgeable) so the /api/admin/* routes scope to
// that factory. Logged to superadmin_actions.

// POST /api/superadmin/impersonate/stop → exit the factory session.
// MUST be declared before /impersonate/:clientId or "stop" is parsed as an id.
superadminRouter.post("/impersonate/stop", async (req, res) => {
  const prior = req.session.actingClientId;
  delete req.session.actingClientId;
  if (prior) {
    await storage.logSuperadminAction({
      superadminId: req.session.user!.id,
      clientId: prior,
      action: "impersonate_stop",
      detail: null,
    });
  }
  req.session.save((err) => {
    if (err) {
      console.error("[superadmin] session save failed:", err);
      return res.status(500).json({ error: "could not stop session" });
    }
    res.json({ ok: true });
  });
});

// POST /api/superadmin/impersonate/:clientId → start a factory session
superadminRouter.post("/impersonate/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  const client = await storage.getClient(clientId);
  if (!client) return res.status(404).json({ error: "client not found" });

  req.session.actingClientId = clientId;
  await storage.logSuperadminAction({
    superadminId: req.session.user!.id,
    clientId,
    action: "impersonate_start",
    detail: client.name,
  });
  req.session.save((err) => {
    if (err) {
      console.error("[superadmin] session save failed:", err);
      return res.status(500).json({ error: "could not start session" });
    }
    res.json({ ok: true, clientId, clientName: client.name });
  });
});
