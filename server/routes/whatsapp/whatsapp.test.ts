import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import request from "supertest";
import { buildApp } from "../../app";
import { pool } from "../../db";
import { ensureDemoClient } from "../../seed";
import { storage } from "../../storage";

const app = buildApp();

// Make a test app secret + matching encrypted form, then configure the
// demo client with it so the webhook can verify signatures we mint here.
//
// The test must NOT touch the demo client's existing real values (if any
// — we may run after a manual config). Pattern: snapshot, mutate, restore.
const APP_SECRET = "test-app-secret-deadbeef";
const VERIFY_TOKEN = "test-verify-token-123";

let demoClientId: string;
let originalToken: string | null = null;
let originalAppSecret: string | null = null;
let originalVerify: string | null = null;

beforeEach(async () => {
  demoClientId = await ensureDemoClient();
  const c = await storage.getClient(demoClientId);
  if (c) {
    originalToken = c.waToken;
    originalAppSecret = c.waAppSecret;
    originalVerify = c.waVerifyToken;
  }
  // Encrypt app secret using our real encryption helper (same path the
  // admin PATCH endpoint goes through).
  const { encrypt } = await import("../../utils/encryption");
  await storage.updateClient(demoClientId, {
    waPhoneId: "test-phone-id",
    waToken: encrypt("test-access-token"),
    waVerifyToken: VERIFY_TOKEN,
    waAppSecret: encrypt(APP_SECRET),
  });
});

afterAll(async () => {
  // Restore whatever was there.
  if (demoClientId) {
    await storage.updateClient(demoClientId, {
      waToken: originalToken,
      waAppSecret: originalAppSecret,
      waVerifyToken: originalVerify,
    });
  }
  await pool.end();
});

function signBody(body: string): string {
  return "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex");
}

describe("GET /api/whatsapp/:slug (verify handshake)", () => {
  it("echoes the challenge when verify token matches", async () => {
    const res = await request(app)
      .get("/api/whatsapp/demo")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "challenge-string-xyz",
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe("challenge-string-xyz");
  });

  it("rejects with 403 when verify token is wrong", async () => {
    const res = await request(app)
      .get("/api/whatsapp/demo")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "x",
      });
    expect(res.status).toBe(403);
  });

  it("rejects with 404 for an unknown slug", async () => {
    const res = await request(app)
      .get("/api/whatsapp/nonexistent-slug")
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "x" });
    expect(res.status).toBe(404);
  });

  it("rejects with 400 when hub.mode is not 'subscribe'", async () => {
    const res = await request(app)
      .get("/api/whatsapp/demo")
      .query({ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "x" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/whatsapp/:slug (signature verification)", () => {
  // Stub fetch so the webhook's actual reply (which would call Meta's
  // Graph API) doesn't reach out anywhere. We're only checking that the
  // signature gate behaves correctly here — the inbound pipeline runs
  // AFTER the 200 ack so its outcome doesn't affect the assertion.
  const fetchSpy = vi
    .spyOn(global, "fetch")
    .mockResolvedValue(new Response("{}", { status: 200 }));

  afterAll(() => fetchSpy.mockRestore());

  it("returns 401 when the signature header is missing", async () => {
    const body = JSON.stringify({ entry: [] });
    const res = await request(app)
      .post("/api/whatsapp/demo")
      .set("content-type", "application/json")
      .send(body);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the signature is invalid", async () => {
    const body = JSON.stringify({ entry: [] });
    const res = await request(app)
      .post("/api/whatsapp/demo")
      .set("content-type", "application/json")
      .set("x-hub-signature-256", "sha256=" + "0".repeat(64))
      .send(body);
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown slug even with a signature", async () => {
    const body = JSON.stringify({ entry: [] });
    const res = await request(app)
      .post("/api/whatsapp/nonexistent-slug")
      .set("content-type", "application/json")
      .set("x-hub-signature-256", signBody(body))
      .send(body);
    expect(res.status).toBe(404);
  });

  it("returns 200 for a valid signature (even if payload has no messages)", async () => {
    const body = JSON.stringify({ entry: [{ changes: [{ value: {} }] }] });
    const res = await request(app)
      .post("/api/whatsapp/demo")
      .set("content-type", "application/json")
      .set("x-hub-signature-256", signBody(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
