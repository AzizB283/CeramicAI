import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "./db";
import { runWithClient } from "./middleware/tenant";
import { storage } from "./storage";
import type { CeramicClient } from "@shared/schema";

let client: CeramicClient;

beforeAll(async () => {
  // Create a tenant to scope the rest of the tests under.
  client = await storage.createClient({
    name: "Test Tiles Pvt Ltd",
    mode: "factory",
    ownerName: "Owner",
    ownerWhatsapp: "+910000000000",
  });
});

afterAll(async () => {
  // Clean up rows we created, then close the pool.
  await runWithClient(client.id, async () => {
    const leads = await storage.getLeads();
    for (const l of leads) await storage.deleteLead(l.id);
  });
  await pool.query("DELETE FROM ceramic_clients WHERE id = $1", [client.id]);
  await pool.end();
});

describe("client storage", () => {
  it("creates and reads a client by id", async () => {
    const found = await storage.getClient(client.id);
    expect(found?.name).toBe("Test Tiles Pvt Ltd");
    expect(found?.mode).toBe("factory");
    expect(found?.widgetColor).toBe("e85d04"); // schema default
    expect(found?.active).toBe(true);
  });
});

describe("lead storage (tenant-scoped)", () => {
  it("creates a lead with clientId injected from context", async () => {
    const lead = await runWithClient(client.id, () =>
      storage.createLead({
        sessionId: "sess-1",
        channel: "web",
        buyerType: "retailer",
        buyerName: "Rahul Shah",
        buyerPhone: "+91 98765 43210",
        buyerCity: "Surat",
        productCategory: "gvt",
        productSize: "600x600",
        quantity: "500-2000 boxes",
      }),
    );
    expect(lead.id).toBeGreaterThan(0);
    expect(lead.clientId).toBe(client.id);
    // PII round-trips decrypted on read.
    expect(lead.buyerName).toBe("Rahul Shah");
    expect(lead.buyerPhone).toBe("+91 98765 43210");
  });

  it("stores buyer name/phone encrypted at rest", async () => {
    await runWithClient(client.id, () =>
      storage.createLead({ sessionId: "sess-enc", buyerName: "Secret", buyerPhone: "+919111111111" }),
    );
    const { rows } = await pool.query(
      "SELECT buyer_name, buyer_phone, buyer_phone_hash FROM ceramic_leads WHERE session_id = $1",
      ["sess-enc"],
    );
    expect(rows[0].buyer_name).not.toBe("Secret"); // ciphertext, not plaintext
    expect(rows[0].buyer_phone).not.toContain("9111111111");
    expect(rows[0].buyer_phone_hash).toMatch(/^[0-9a-f]{64}$/); // HMAC stored
  });

  it("finds a lead by phone via hash, scoped to the client", async () => {
    const found = await runWithClient(client.id, () =>
      storage.getLeadByPhone("+91 98765 43210"),
    );
    expect(found?.buyerName).toBe("Rahul Shah");
  });

  it("lists leads for the current client only", async () => {
    const leads = await runWithClient(client.id, () => storage.getLeads());
    expect(leads.length).toBeGreaterThanOrEqual(2);
    expect(leads.every((l) => l.clientId === client.id)).toBe(true);
  });

  it("flags a distributor inquiry as priority", async () => {
    const lead = await runWithClient(client.id, () =>
      storage.createLead({
        sessionId: "sess-dist",
        buyerType: "distributor",
        isDistributorInquiry: true,
        priority: "priority",
      }),
    );
    expect(lead.priority).toBe("priority");
    expect(lead.isDistributorInquiry).toBe(true);
  });

  it("updates lead status", async () => {
    const [lead] = await runWithClient(client.id, () => storage.getLeads());
    const updated = await runWithClient(client.id, () =>
      storage.updateLead(lead.id, { status: "contacted", ownerNotified: true }),
    );
    expect(updated.status).toBe("contacted");
    expect(updated.ownerNotified).toBe(true);
  });
});

describe("followup storage", () => {
  it("schedules and lists due followups", async () => {
    const [lead] = await runWithClient(client.id, () => storage.getLeads());
    await runWithClient(client.id, () =>
      storage.createFollowup({
        leadId: lead.id,
        sendAt: new Date(Date.now() - 1000), // already due
        dayNumber: 2,
        message: "Day 2 check-in",
      }),
    );
    const due = await storage.getDueFollowups(new Date());
    expect(due.some((f) => f.leadId === lead.id)).toBe(true);
  });
});
