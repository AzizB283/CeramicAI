import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import { buildApp } from "../app";
import { pool, db } from "../db";
import { seedAdminUsers } from "../seed";
import { storage } from "../storage";
import { ceramicClients, adminUsers, superadminActions } from "@shared/schema";
import { eq } from "drizzle-orm";

const app = buildApp();
const sa = request.agent(app); // superadmin agent

const SUPER_USERNAME = "super-sa-test";
const SUPER_PASSWORD = "super-sa-pw-123";

// Unique-ish slug/username so reruns don't collide (no Date.now in tests is
// fine here — vitest runs this file once per process).
const NEW_SLUG = "sa-test-factory";
const NEW_ADMIN = "sa-test-factory-admin";

let createdClientId: string | null = null;

beforeAll(async () => {
  await seedAdminUsers();
  if (!(await storage.getAdminUserByUsername(SUPER_USERNAME))) {
    await storage.createAdminUser({
      clientId: null,
      username: SUPER_USERNAME,
      password: await bcrypt.hash(SUPER_PASSWORD, 10),
      name: "SA Test",
      role: "superadmin",
      active: true,
    });
  }
  // Clean any leftover from a prior run (audit rows first — they FK the client).
  const leftover = await storage.getClientBySlug(NEW_SLUG);
  if (leftover) {
    await db.delete(superadminActions).where(eq(superadminActions.clientId, leftover.id));
    await db.delete(adminUsers).where(eq(adminUsers.clientId, leftover.id));
    await db.delete(ceramicClients).where(eq(ceramicClients.id, leftover.id));
  }
  await db.delete(adminUsers).where(eq(adminUsers.username, NEW_ADMIN));
});

afterAll(async () => {
  if (createdClientId) {
    // Audit rows FK-reference the client — delete them first.
    await db.delete(superadminActions).where(eq(superadminActions.clientId, createdClientId));
    await db.delete(adminUsers).where(eq(adminUsers.clientId, createdClientId));
    await db.delete(ceramicClients).where(eq(ceramicClients.id, createdClientId));
  }
  await pool.end();
});

describe("superadmin gate", () => {
  it("blocks /api/superadmin without auth (401)", async () => {
    const res = await request(app).get("/api/superadmin/clients");
    expect(res.status).toBe(401);
  });

  it("blocks a factory admin from /api/superadmin (403)", async () => {
    const fa = request.agent(app);
    await fa.post("/api/auth/login").send({ username: "admin", password: "admin123" });
    const res = await fa.get("/api/superadmin/clients");
    expect(res.status).toBe(403);
  });

  it("logs in as superadmin", async () => {
    const res = await sa
      .post("/api/auth/login")
      .send({ username: SUPER_USERNAME, password: SUPER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("superadmin");
  });
});

describe("superadmin factory lifecycle", () => {
  it("lists clients (includes the demo factory)", async () => {
    const res = await sa.get("/api/superadmin/clients");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((c: { slug: string }) => c.slug === "demo")).toBe(true);
    // counts present, secrets absent
    expect(res.body[0]).toHaveProperty("leadCount");
    expect(res.body[0]).not.toHaveProperty("waToken");
  });

  it("creates a factory + first admin, returning the password once", async () => {
    const res = await sa.post("/api/superadmin/clients").send({
      name: "SA Test Factory",
      slug: NEW_SLUG,
      mode: "factory",
      ownerName: "Owner",
      adminUsername: NEW_ADMIN,
      adminPassword: "factory-pw-123",
      adminName: "Factory Admin",
    });
    expect(res.status).toBe(201);
    expect(res.body.client.slug).toBe(NEW_SLUG);
    expect(res.body.admin.username).toBe(NEW_ADMIN);
    expect(res.body.admin.password).toBe("factory-pw-123");
    createdClientId = res.body.client.id;
  });

  it("rejects a duplicate slug (409)", async () => {
    const res = await sa.post("/api/superadmin/clients").send({
      name: "Dupe",
      slug: NEW_SLUG,
      mode: "factory",
      adminUsername: "another-admin-xyz",
      adminPassword: "factory-pw-123",
    });
    expect(res.status).toBe(409);
  });

  it("rejects changing the immutable slug (400)", async () => {
    const res = await sa
      .patch(`/api/superadmin/clients/${createdClientId}`)
      .send({ slug: "new-slug" });
    expect(res.status).toBe(400);
  });

  it("the new factory admin can log in and is scoped to its own factory", async () => {
    const fa = request.agent(app);
    const login = await fa
      .post("/api/auth/login")
      .send({ username: NEW_ADMIN, password: "factory-pw-123" });
    expect(login.status).toBe(200);
    expect(login.body.role).toBe("factory");
    // Its leads list is empty (fresh factory) but the route works (200, not 403).
    const leads = await fa.get("/api/admin/leads");
    expect(leads.status).toBe(200);
    expect(leads.body).toEqual([]);
  });
});

describe("superadmin impersonation", () => {
  it("superadmin is 403 on /api/admin before impersonating", async () => {
    const res = await sa.get("/api/admin/settings");
    expect(res.status).toBe(403);
  });

  it("starts impersonation and can then read the factory's settings", async () => {
    const start = await sa.post(`/api/superadmin/impersonate/${createdClientId}`);
    expect(start.status).toBe(200);
    expect(start.body.clientId).toBe(createdClientId);

    const settings = await sa.get("/api/admin/settings");
    expect(settings.status).toBe(200);
    expect(settings.body.slug).toBe(NEW_SLUG);
  });

  it("stops impersonation and is 403 again", async () => {
    const stop = await sa.post("/api/superadmin/impersonate/stop");
    expect(stop.status).toBe(200);
    const settings = await sa.get("/api/admin/settings");
    expect(settings.status).toBe(403);
  });
});
