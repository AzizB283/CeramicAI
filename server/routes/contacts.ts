/**
 * Outbound address book — /api/admin/contacts/*
 *
 * The CSV import is two-phase so the UI can show a wizard:
 *   POST /import/preview → parse only (detect preset, build column map, return
 *                          drafts + per-row errors). No DB writes.
 *   POST /import/commit  → parse + dedupe (by email/phone hash) + persist +
 *                          write a ceramic_contact_imports audit row.
 * The client uploads CSV as text in the JSON body (no multipart dependency).
 *
 * All routes are tenant-scoped via the resolveClient(...) + runWithClient(...)
 * pattern shared with admin.ts.
 */
import { Router } from "express";
import { z } from "zod";
import { requireAuth, effectiveClientId, AuthError } from "../auth";
import type { Request, Response } from "express";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import { parseContactsCsv } from "../services/csvImport";
import type { CsvColumnMap, CsvPreset, InputContactDraft } from "@shared/types";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

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

const BUYER_TYPES = ["retailer", "distributor", "architect", "builder", "export", "general"] as const;
const CONTACT_SOURCES = ["manual", "lead", "csv", "tradeshow", "indiamart", "alibaba", "tradeindia"] as const;
const SUPPRESSION_REASONS = ["unsubscribe", "bounce", "manual", "complaint"] as const;
const CSV_PRESETS = ["generic", "indiamart", "alibaba", "tradeindia"] as const;

// ── list ──────────────────────────────────────────────────────────────
// GET /api/admin/contacts?country=&buyerType=&source=&search=
contactsRouter.get("/", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const filter = {
    country: typeof req.query.country === "string" ? req.query.country : undefined,
    buyerType: typeof req.query.buyerType === "string" ? req.query.buyerType : undefined,
    source: typeof req.query.source === "string" ? req.query.source : undefined,
    search: typeof req.query.search === "string" ? req.query.search : undefined,
  };
  const contacts = await runWithClient(clientId, () => storage.getContacts(filter));
  res.json(contacts);
});

// ── create / update / delete ────────────────────────────────────────────
const contactBodySchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    company: z.string().trim().max(200).optional(),
    country: z.string().trim().max(120).optional(),
    city: z.string().trim().max(120).optional(),
    buyerType: z.enum(BUYER_TYPES).optional(),
    source: z.enum(CONTACT_SOURCES).optional(),
    tags: z.array(z.string().trim().max(60)).max(30).optional(),
    notes: z.string().trim().max(4000).optional(),
  })
  .strict();

// POST /api/admin/contacts → manual add. Refuses a contact with no email/phone.
contactsRouter.post("/", async (req, res) => {
  const parsed = contactBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid contact", details: parsed.error.flatten() });
  }
  if (!parsed.data.email && !parsed.data.phone) {
    return res.status(400).json({ error: "a contact needs at least an email or phone" });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const contact = await runWithClient(clientId, () =>
    storage.createContact({ source: "manual", ...parsed.data }),
  );
  res.status(201).json(contact);
});

// PATCH /api/admin/contacts/:id
contactsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid contact id" });
  const parsed = contactBodySchema.partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid patch", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    const updated = await runWithClient(clientId, () => storage.updateContact(id, parsed.data));
    res.json(updated);
  } catch {
    res.status(404).json({ error: "contact not found" });
  }
});

// DELETE /api/admin/contacts/:id
contactsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid contact id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const existing = await runWithClient(clientId, () => storage.getContact(id));
  if (!existing) return res.status(404).json({ error: "contact not found" });
  await runWithClient(clientId, () => storage.deleteContact(id));
  res.status(204).end();
});

// ── promote a lead into the address book ────────────────────────────────
// POST /api/admin/contacts/promote/:leadId
contactsRouter.post("/promote/:leadId", async (req, res) => {
  const leadId = Number(req.params.leadId);
  if (!Number.isInteger(leadId)) return res.status(400).json({ error: "invalid lead id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const result = await runWithClient(clientId, async () => {
    const lead = await storage.getLead(leadId);
    if (!lead) return null;
    return storage.promoteLeadToContact(lead);
  });
  if (!result) return res.status(404).json({ error: "lead not found" });
  res.status(201).json(result);
});

// ── suppression (do-not-contact) ────────────────────────────────────────
const suppressSchema = z
  .object({
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    reason: z.enum(SUPPRESSION_REASONS).default("manual"),
  })
  .strict()
  .refine((d) => d.email || d.phone, { message: "email or phone required" });

// POST /api/admin/contacts/suppress → add to the do-not-contact list, and flag
// the matching contact (if any) as opted out so the UI reflects it.
contactsRouter.post("/suppress", async (req, res) => {
  const parsed = suppressSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid suppression", details: parsed.error.flatten() });
  }
  const { email, phone, reason } = parsed.data;
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, async () => {
    await storage.suppressContact({ email, phone, reason });
    const existing = await storage.findContactByHash({ email, phone });
    if (existing && !existing.optedOut) await storage.updateContact(existing.id, { optedOut: true });
  });
  res.status(204).end();
});

const unsuppressSchema = z
  .object({
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
  })
  .strict()
  .refine((d) => d.email || d.phone, { message: "email or phone required" });

// POST /api/admin/contacts/unsuppress → remove from the do-not-contact list and
// clear the matching contact's optedOut flag (full undo of /suppress).
contactsRouter.post("/unsuppress", async (req, res) => {
  const parsed = unsuppressSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid request", details: parsed.error.flatten() });
  }
  const { email, phone } = parsed.data;
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, async () => {
    await storage.unsuppressContact({ email, phone });
    const existing = await storage.findContactByHash({ email, phone });
    if (existing && existing.optedOut) await storage.updateContact(existing.id, { optedOut: false });
  });
  res.status(204).end();
});

// ── CSV import ──────────────────────────────────────────────────────────
const importBaseSchema = z.object({
  csv: z.string().min(1).max(10_000_000), // ~10MB of text
  filename: z.string().max(260).optional(),
  preset: z.enum(CSV_PRESETS).optional(),
  // Column map adjustments from the wizard: header → field name (or null).
  columnMap: z.record(z.string(), z.string().nullable()).optional(),
  source: z.enum(CONTACT_SOURCES).optional(),
});

function coerceColumnMap(raw: Record<string, string | null> | undefined): CsvColumnMap | undefined {
  return raw as CsvColumnMap | undefined;
}

// POST /api/admin/contacts/import/preview → parse only, no writes.
contactsRouter.post("/import/preview", async (req, res) => {
  const parsed = importBaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid import", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const result = parseContactsCsv(parsed.data.csv, {
    preset: parsed.data.preset as CsvPreset | undefined,
    columnMap: coerceColumnMap(parsed.data.columnMap),
    source: parsed.data.source,
  });
  res.json({
    preset: result.preset,
    columnMap: result.columnMap,
    rowsTotal: result.rowsTotal,
    validCount: result.drafts.length,
    errorCount: result.errors.length,
    errors: result.errors.slice(0, 100), // cap payload
    sample: result.drafts.slice(0, 20), // preview rows (decrypted drafts, pre-persist)
  });
});

// POST /api/admin/contacts/import/commit → parse + dedupe + persist + audit.
contactsRouter.post("/import/commit", async (req, res) => {
  const parsed = importBaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid import", details: parsed.error.flatten() });
  }
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const importedBy = req.session?.user?.id ?? null;

  const result = parseContactsCsv(parsed.data.csv, {
    preset: parsed.data.preset as CsvPreset | undefined,
    columnMap: coerceColumnMap(parsed.data.columnMap),
    source: parsed.data.source,
  });

  const summary = await runWithClient(clientId, async () => {
    let imported = 0;
    let skipped = 0;
    const errors = [...result.errors];
    // Dedupe within the file too (first occurrence wins).
    const seenEmail = new Set<string>();
    const seenPhone = new Set<string>();

    for (let i = 0; i < result.drafts.length; i++) {
      const d: InputContactDraft = result.drafts[i];
      const emailKey = d.email?.toLowerCase();
      const phoneKey = d.phone?.replace(/\D/g, "");
      if ((emailKey && seenEmail.has(emailKey)) || (phoneKey && seenPhone.has(phoneKey))) {
        skipped++;
        continue;
      }
      // Dedupe against existing DB rows by hash.
      const existing = await storage.findContactByHash({ email: d.email, phone: d.phone });
      if (existing) {
        skipped++;
        if (emailKey) seenEmail.add(emailKey);
        if (phoneKey) seenPhone.add(phoneKey);
        continue;
      }
      await storage.createContact({
        name: d.name,
        email: d.email,
        phone: d.phone,
        company: d.company,
        country: d.country,
        city: d.city,
        buyerType: d.buyerType,
        tags: d.tags ?? [],
        notes: d.notes,
        source: d.source,
      });
      imported++;
      if (emailKey) seenEmail.add(emailKey);
      if (phoneKey) seenPhone.add(phoneKey);
    }

    await storage.createContactImport({
      filename: parsed.data.filename,
      preset: result.preset,
      rowsTotal: result.rowsTotal,
      rowsImported: imported,
      rowsSkipped: result.rowsTotal - imported,
      errorReport: errors,
      importedBy,
    });

    return { preset: result.preset, rowsTotal: result.rowsTotal, imported, skipped, errors };
  });

  res.status(201).json(summary);
});

// GET /api/admin/contacts/imports/history → past CSV uploads (audit trail).
contactsRouter.get("/imports/history", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const rows = await runWithClient(clientId, () => storage.getContactImports());
  res.json(rows);
});

// GET /api/admin/contacts/:id — registered LAST so the static paths above
// (/imports/history) aren't swallowed by the :id param.
contactsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid contact id" });
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const contact = await runWithClient(clientId, () => storage.getContact(id));
  if (!contact) return res.status(404).json({ error: "contact not found" });
  res.json(contact);
});
