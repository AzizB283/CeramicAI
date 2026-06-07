import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "./db";
import { runWithClient } from "./middleware/tenant";
import { storage } from "./storage";
import type { CeramicClient } from "@shared/schema";

let client: CeramicClient;

beforeAll(async () => {
  client = await storage.createClient({
    slug: `test-contacts-${Date.now()}`,
    name: "Contacts Test Co",
    mode: "exporter",
  });
});

afterAll(async () => {
  await runWithClient(client.id, async () => {
    const contacts = await storage.getContacts();
    for (const c of contacts) await storage.deleteContact(c.id);
    const leads = await storage.getLeads();
    for (const l of leads) await storage.deleteLead(l.id);
  });
  await pool.query("DELETE FROM ceramic_contacts WHERE client_id = $1", [client.id]);
  await pool.query("DELETE FROM ceramic_contact_imports WHERE client_id = $1", [client.id]);
  await pool.query("DELETE FROM ceramic_suppressions WHERE client_id = $1", [client.id]);
  await pool.query("DELETE FROM ceramic_clients WHERE id = $1", [client.id]);
  await pool.end();
});

describe("contact storage (tenant-scoped, PII encrypted)", () => {
  it("creates a contact and decrypts PII on read", async () => {
    const c = await runWithClient(client.id, () =>
      storage.createContact({
        name: "Aisha Khan",
        email: "Aisha@Example.com",
        phone: "+971 50 123 4567",
        company: "Gulf Tiles LLC",
        country: "UAE",
        buyerType: "distributor",
        source: "csv",
        tags: ["gulf", "vip"],
      }),
    );
    expect(c.name).toBe("Aisha Khan");
    expect(c.email).toBe("Aisha@Example.com");
    expect(c.tags).toEqual(["gulf", "vip"]);

    // Raw row must be encrypted at rest (not plaintext).
    const raw = await pool.query("SELECT name, email, email_hash FROM ceramic_contacts WHERE id = $1", [
      c.id,
    ]);
    expect(raw.rows[0].name).toMatch(/^v2:/);
    expect(raw.rows[0].email).toMatch(/^v2:/);
    expect(raw.rows[0].email_hash).toBeTruthy();
    expect(raw.rows[0].email_hash).not.toContain("@");
  });

  it("finds a contact by email hash, case-insensitively", async () => {
    const found = await runWithClient(client.id, () =>
      storage.findContactByHash({ email: "aisha@example.com" }),
    );
    expect(found?.company).toBe("Gulf Tiles LLC");
  });

  it("filters contacts by country and buyerType", async () => {
    const byCountry = await runWithClient(client.id, () => storage.getContacts({ country: "UAE" }));
    expect(byCountry.length).toBeGreaterThanOrEqual(1);
    const byType = await runWithClient(client.id, () =>
      storage.getContacts({ buyerType: "architect" }),
    );
    expect(byType).toHaveLength(0);
  });
});

describe("suppression list", () => {
  it("suppresses an email and reports it suppressed", async () => {
    await runWithClient(client.id, () =>
      storage.suppressContact({ email: "blocked@example.com", reason: "unsubscribe" }),
    );
    const yes = await runWithClient(client.id, () =>
      storage.isSuppressed({ email: "BLOCKED@example.com" }),
    );
    const no = await runWithClient(client.id, () =>
      storage.isSuppressed({ email: "fine@example.com" }),
    );
    expect(yes).toBe(true);
    expect(no).toBe(false);
  });

  it("is idempotent (no throw on duplicate suppression)", async () => {
    await runWithClient(client.id, () =>
      storage.suppressContact({ email: "blocked@example.com", reason: "unsubscribe" }),
    );
    // No error = pass.
    expect(true).toBe(true);
  });
});

describe("promote lead → contact", () => {
  it("creates a contact from a lead and is idempotent on re-promote", async () => {
    const lead = await runWithClient(client.id, () =>
      storage.createLead({
        sessionId: "promo-sess",
        channel: "web",
        buyerType: "distributor",
        buyerName: "Carlos Mendez",
        buyerEmail: "carlos@importer.mx",
        buyerCountry: "Mexico",
      }),
    );
    const c1 = await runWithClient(client.id, () => storage.promoteLeadToContact(lead));
    expect(c1.source).toBe("lead");
    expect(c1.leadId).toBe(lead.id);
    expect(c1.email).toBe("carlos@importer.mx");

    // Re-promoting must not duplicate.
    const c2 = await runWithClient(client.id, () => storage.promoteLeadToContact(lead));
    expect(c2.id).toBe(c1.id);
  });
});

describe("contact import audit", () => {
  it("records an import row", async () => {
    await runWithClient(client.id, () =>
      storage.createContactImport({
        filename: "buyers.csv",
        preset: "indiamart",
        rowsTotal: 10,
        rowsImported: 8,
        rowsSkipped: 2,
        errorReport: [{ row: 3, reason: "no usable email or phone" }],
        importedBy: null,
      }),
    );
    const rows = await runWithClient(client.id, () => storage.getContactImports());
    expect(rows[0].filename).toBe("buyers.csv");
    expect(rows[0].rowsImported).toBe(8);
    expect(rows[0].errorReport[0].reason).toContain("no usable");
  });
});
