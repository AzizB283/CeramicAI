import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "../app";
import { pool } from "../db";
import { ensureDemoClient, seedAdminUsers } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";

const app = buildApp();
const agent = request.agent(app);

let clientId: string;
const createdContactIds: number[] = [];

beforeAll(async () => {
  await seedAdminUsers();
  clientId = await ensureDemoClient();
  await agent.post("/api/auth/login").send({ username: "admin", password: "admin123" });
});

afterAll(async () => {
  await runWithClient(clientId, async () => {
    // Remove every contact created by this test run (by the emails we used).
    const all = await storage.getContacts();
    for (const c of all) {
      if (c.email && /@routetest\.example$/.test(c.email)) await storage.deleteContact(c.id);
    }
    for (const id of createdContactIds) {
      try {
        await storage.deleteContact(id);
      } catch {
        /* already gone */
      }
    }
  });
  await pool.end();
});

describe("contacts auth gate", () => {
  it("rejects unauthenticated list (401)", async () => {
    const res = await request(app).get("/api/admin/contacts");
    expect(res.status).toBe(401);
  });
});

describe("contacts CRUD", () => {
  it("creates a contact manually", async () => {
    const res = await agent.post("/api/admin/contacts").send({
      name: "Manual Buyer",
      email: "manual@routetest.example",
      country: "Spain",
      buyerType: "retailer",
    });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("manual@routetest.example");
    expect(res.body.source).toBe("manual");
    createdContactIds.push(res.body.id);
  });

  it("refuses a contact with neither email nor phone", async () => {
    const res = await agent.post("/api/admin/contacts").send({ name: "Nobody" });
    expect(res.status).toBe(400);
  });

  it("lists contacts and filters by country", async () => {
    const res = await agent.get("/api/admin/contacts?country=Spain");
    expect(res.status).toBe(200);
    expect(res.body.some((c: any) => c.email === "manual@routetest.example")).toBe(true);
  });
});

describe("CSV import (preview + commit)", () => {
  const csv =
    "Name,Email,Phone,Country,Tags\n" +
    "Lina,lina@routetest.example,+34 600 111 222,Spain,gulf;vip\n" +
    "Omar,omar@routetest.example,,UAE,\n" +
    "Bad,not-an-email,,Egypt,\n" +
    "Lina Dup,lina@routetest.example,,Spain,"; // dup email → skipped on commit

  it("previews without persisting", async () => {
    const res = await agent.post("/api/admin/contacts/import/preview").send({ csv });
    expect(res.status).toBe(200);
    expect(res.body.rowsTotal).toBe(4);
    expect(res.body.validCount).toBe(3); // Bad row rejected
    expect(res.body.errorCount).toBe(1);
    expect(res.body.sample[0].email).toBe("lina@routetest.example");
  });

  it("commits, deduping within the file", async () => {
    const res = await agent.post("/api/admin/contacts/import/commit").send({ csv, filename: "buyers.csv" });
    expect(res.status).toBe(201);
    // 3 valid rows, but Lina appears twice → 2 imported, 1 skipped (dup).
    expect(res.body.imported).toBe(2);
    expect(res.body.rowsTotal).toBe(4);
  });

  it("dedupes against already-imported rows on a second commit", async () => {
    const res = await agent.post("/api/admin/contacts/import/commit").send({ csv });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(0); // all already present
  });

  it("records the import in history", async () => {
    const res = await agent.get("/api/admin/contacts/imports/history");
    expect(res.status).toBe(200);
    expect(res.body.some((r: any) => r.filename === "buyers.csv")).toBe(true);
  });
});

describe("suppression", () => {
  it("suppresses an email (204)", async () => {
    const res = await agent
      .post("/api/admin/contacts/suppress")
      .send({ email: "omar@routetest.example", reason: "unsubscribe" });
    expect(res.status).toBe(204);
  });

  it("marks the matching contact opted out", async () => {
    const list = await agent.get("/api/admin/contacts?country=UAE");
    const omar = list.body.find((c: any) => c.email === "omar@routetest.example");
    expect(omar?.optedOut).toBe(true);
  });

  it("unsuppresses an email and clears optedOut (204)", async () => {
    const res = await agent
      .post("/api/admin/contacts/unsuppress")
      .send({ email: "omar@routetest.example" });
    expect(res.status).toBe(204);
    const list = await agent.get("/api/admin/contacts?country=UAE");
    const omar = list.body.find((c: any) => c.email === "omar@routetest.example");
    expect(omar?.optedOut).toBe(false);
  });

  it("rejects unsuppress with neither email nor phone (400)", async () => {
    const res = await agent.post("/api/admin/contacts/unsuppress").send({});
    expect(res.status).toBe(400);
  });
});
