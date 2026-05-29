import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app";
import { pool } from "../db";
import { ensureDemoClient, seedAdminUsers } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";

const app = buildApp();

// A persistent agent keeps the session cookie across requests.
const agent = request.agent(app);

const SESSION_ID = "admin-test-lead";
let leadId: number;

beforeAll(async () => {
  // Auth is now DB-backed: ensure the demo factory admin (admin/admin123)
  // exists so the login assertions below pass on a fresh test DB.
  await seedAdminUsers();
  // Seed one lead so the list/stats are non-empty.
  const clientId = await ensureDemoClient();
  const lead = await runWithClient(clientId, () =>
    storage.createLead({
      sessionId: SESSION_ID,
      channel: "web",
      buyerType: "distributor",
      buyerName: "Admin Test Buyer",
      buyerCity: "Surat",
      productCategory: "gvt",
      isDistributorInquiry: true,
      priority: "priority",
      status: "new",
    }),
  );
  leadId = lead.id;
});

afterAll(async () => {
  const clientId = await ensureDemoClient();
  await runWithClient(clientId, () => storage.deleteLead(leadId));
  await pool.end();
});

describe("admin auth gate", () => {
  it("rejects GET /api/admin/leads without a session (401)", async () => {
    const res = await request(app).get("/api/admin/leads");
    expect(res.status).toBe(401);
  });

  it("rejects login with wrong credentials (401)", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("accepts login with correct credentials and sets a cookie", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("admin");
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("GET /api/auth/me returns the user when logged in", async () => {
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("admin");
  });
});

describe("admin leads (authenticated)", () => {
  it("GET /api/admin/leads returns a non-empty array", async () => {
    const res = await agent.get("/api/admin/leads");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((l: any) => l.id === leadId)).toBe(true);
  });

  it("GET /api/admin/leads/:id returns the lead", async () => {
    const res = await agent.get(`/api/admin/leads/${leadId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(leadId);
    expect(res.body.buyerName).toBe("Admin Test Buyer"); // decrypted
  });

  it("PATCH /api/admin/leads/:id updates the status", async () => {
    const res = await agent
      .patch(`/api/admin/leads/${leadId}`)
      .send({ status: "contacted" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("contacted");
  });

  it("PATCH /api/admin/leads/:id rejects an invalid status (400)", async () => {
    const res = await agent
      .patch(`/api/admin/leads/${leadId}`)
      .send({ status: "bogus" });
    expect(res.status).toBe(400);
  });
});

describe("admin stats (authenticated)", () => {
  it("GET /api/admin/stats returns the expected shape", async () => {
    const res = await agent.get("/api/admin/stats");
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.byStatus).toMatchObject({
      new: expect.any(Number),
      contacted: expect.any(Number),
      converted: expect.any(Number),
      lost: expect.any(Number),
    });
    expect(res.body.byPriority).toMatchObject({
      normal: expect.any(Number),
      high: expect.any(Number),
      priority: expect.any(Number),
    });
    expect(typeof res.body.distributorInquiries).toBe("number");
    expect(typeof res.body.recent).toBe("number");
    // Our seeded lead is a distributor inquiry created just now.
    expect(res.body.distributorInquiries).toBeGreaterThanOrEqual(1);
    expect(res.body.recent).toBeGreaterThanOrEqual(1);
  });
});

describe("admin settings (authenticated)", () => {
  it("GET /api/admin/settings returns the client without waToken", async () => {
    const res = await agent.get("/api/admin/settings");
    expect(res.status).toBe(200);
    expect(res.body.name).toBeTruthy();
    expect(res.body.mode).toBeTruthy();
    expect(res.body).not.toHaveProperty("waToken");
  });

  it("PATCH /api/admin/settings updates an editable field", async () => {
    const greeting = `Hello from test ${Date.now()}`;
    const res = await agent
      .patch("/api/admin/settings")
      .send({ widgetGreeting: greeting, waToken: "should-be-ignored" });
    expect(res.status).toBe(200);
    expect(res.body.widgetGreeting).toBe(greeting);
    expect(res.body).not.toHaveProperty("waToken");
  });
});

describe("admin logout", () => {
  it("POST /api/auth/logout clears the session", async () => {
    const out = await agent.post("/api/auth/logout");
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    // After logout the agent's cookie no longer authorizes admin routes.
    const res = await agent.get("/api/admin/leads");
    expect(res.status).toBe(401);
  });
});
