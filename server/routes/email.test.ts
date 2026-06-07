import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Mock gmailAuth so no real Google call happens during the route tests.
vi.mock("../services/gmailAuth", () => ({
  isOAuthConfigured: () => true,
  getAuthUrl: (state: string) => `https://accounts.google.com/o/oauth2/auth?state=${state}`,
  getRedirectUri: () => "http://localhost:5000/api/admin/email/callback",
  exchangeCodeForTokens: async () => ({
    access_token: "a",
    refresh_token: "r",
    expiry_date: Date.now() + 3_600_000,
  }),
  getGmailAddress: async () => "exporter@example.com",
  revokeAccess: async () => {},
}));

import { buildApp } from "../app";
import { pool } from "../db";
import { ensureDemoClient, seedAdminUsers } from "../seed";

const app = buildApp();
const agent = request.agent(app);

beforeAll(async () => {
  await seedAdminUsers();
  await ensureDemoClient();
  await agent.post("/api/auth/login").send({ username: "admin", password: "admin123" });
});

afterAll(async () => {
  await agent.delete("/api/admin/email/disconnect");
  await pool.end();
});

describe("email routes auth", () => {
  it("rejects unauthenticated status", async () => {
    const res = await request(app).get("/api/admin/email/status");
    expect(res.status).toBe(401);
  });
});

describe("email connect/callback/status", () => {
  it("connect returns a Google auth URL and stashes state", async () => {
    const res = await agent.get("/api/admin/email/connect");
    expect(res.status).toBe(200);
    expect(res.body.authUrl).toContain("accounts.google.com");
  });

  it("callback rejects a mismatched state", async () => {
    const res = await agent.get("/api/admin/email/callback").query({ code: "x", state: "bogus" });
    expect([400, 403]).toContain(res.status);
  });

  it("status reports a boolean connected flag", async () => {
    const res = await agent.get("/api/admin/email/status");
    expect(res.status).toBe(200);
    expect(typeof res.body.connected).toBe("boolean");
  });

  it("threads list is an array", async () => {
    const res = await agent.get("/api/admin/email/threads");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("rejects a non-numeric thread id", async () => {
    const res = await agent.get("/api/admin/email/threads/not-a-number");
    expect(res.status).toBe(400);
  });
});
