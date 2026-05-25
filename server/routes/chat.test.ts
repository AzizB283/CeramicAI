import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app";
import { pool } from "../db";
import { ensureDemoClient } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";

const app = buildApp();
const createdSessionIds: string[] = [];

afterAll(async () => {
  const clientId = await ensureDemoClient();
  await runWithClient(clientId, async () => {
    const leads = await storage.getLeads();
    for (const l of leads) {
      if (createdSessionIds.includes(l.sessionId)) await storage.deleteLead(l.id);
    }
  });
  await pool.end();
});

describe("POST /api/chat/session", () => {
  it("starts a factory session and returns the welcome step", async () => {
    const res = await request(app).post("/api/chat/session").send({ mode: "factory" });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeTruthy();
    expect(res.body.botMessages.join(" ")).toContain("Shree Tiles");
    expect(res.body.quickReplies.some((r: any) => r.label.includes("Retailer"))).toBe(true);
    expect(res.body.terminal).toBe(false);
  });
});

describe("POST /api/chat/message — full factory flow persists a lead", () => {
  it("walks to the terminal step and writes a ceramic_leads row", async () => {
    const start = await request(app).post("/api/chat/session").send({ mode: "factory" });
    const sessionId = start.body.sessionId;
    createdSessionIds.push(sessionId);

    const choose = async (choiceLabel: string) =>
      request(app).post("/api/chat/message").send({ sessionId, choiceLabel });
    const type = async (text: string) =>
      request(app).post("/api/chat/message").send({ sessionId, text });

    await choose("Retailer / Tile Shop Owner");
    await choose("GVT / Vitrified Floor Tiles");
    await choose("600×600");
    await choose("Matte");
    await choose("500–2,000 boxes");
    await type("Rahul Shah");
    const done = await type("Surat");

    expect(done.status).toBe(200);
    expect(done.body.terminal).toBe(true);
    expect(done.body.ownerAlert).toBeTruthy();
    expect(done.body.ownerAlert.priority).toBe(false);

    const clientId = await ensureDemoClient();
    const lead = await runWithClient(clientId, () => storage.getLeads());
    const mine = lead.find((l) => l.sessionId === sessionId);
    expect(mine).toBeTruthy();
    expect(mine!.buyerName).toBe("Rahul Shah");
    expect(mine!.buyerCity).toBe("Surat");
    expect(mine!.buyerType).toBe("retailer");
    expect(mine!.productCategory).toBe("gvt");
    expect(mine!.channel).toBe("web");
  });
});

describe("POST /api/chat/message — distributor path is priority", () => {
  it("flags the lead priority on the distributor terminal", async () => {
    const start = await request(app).post("/api/chat/session").send({ mode: "exporter" });
    const sessionId = start.body.sessionId;
    createdSessionIds.push(sessionId);
    const choose = async (choiceLabel: string) =>
      request(app).post("/api/chat/message").send({ sessionId, choiceLabel });
    const type = async (text: string) =>
      request(app).post("/api/chat/message").send({ sessionId, text });

    await choose("I want to become a regular buyer / distributor");
    await type("Kenya");
    await choose("Yes, from India");
    await choose("200–1,000 containers");
    const done = await choose("Yes");

    expect(done.body.terminal).toBe(true);
    expect(done.body.ownerAlert.priority).toBe(true);

    const clientId = await ensureDemoClient();
    const leads = await runWithClient(clientId, () => storage.getLeads());
    const mine = leads.find((l) => l.sessionId === sessionId);
    expect(mine!.priority).toBe("priority");
    expect(mine!.isDistributorInquiry).toBe(true);
  });
});

describe("POST /api/chat/message — terminal replay does not double-insert", () => {
  it("404s on replay and persists exactly one lead for the session", async () => {
    const start = await request(app).post("/api/chat/session").send({ mode: "factory" });
    const sessionId = start.body.sessionId;
    createdSessionIds.push(sessionId);

    const choose = async (choiceLabel: string) =>
      request(app).post("/api/chat/message").send({ sessionId, choiceLabel });
    const type = async (text: string) =>
      request(app).post("/api/chat/message").send({ sessionId, text });

    await choose("Retailer / Tile Shop Owner");
    await choose("GVT / Vitrified Floor Tiles");
    await choose("600×600");
    await choose("Matte");
    await choose("500–2,000 boxes");
    await type("Priya Mehta");
    const done = await type("Rajkot");

    expect(done.status).toBe(200);
    expect(done.body.terminal).toBe(true);

    // Replay the same sessionId — the session was deleted after persistence.
    const replay = await request(app).post("/api/chat/message").send({ sessionId, text: "again" });
    expect(replay.status).toBe(404);

    const clientId = await ensureDemoClient();
    const leads = await runWithClient(clientId, () => storage.getLeads());
    const mine = leads.filter((l) => l.sessionId === sessionId);
    expect(mine).toHaveLength(1);
  });
});

describe("POST /api/chat/message — unknown session", () => {
  it("returns 404 for a missing session", async () => {
    const res = await request(app).post("/api/chat/message").send({ sessionId: "nope", text: "hi" });
    expect(res.status).toBe(404);
  });
});
