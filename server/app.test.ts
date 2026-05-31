import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { buildApp } from "./app";
import { pool } from "./db";

const app = buildApp();

afterAll(async () => {
  await pool.end();
});

describe("GET /health", () => {
  it("returns 200 with an ok status and uptime", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });

  it("requires no auth and no session", async () => {
    // No cookies / credentials sent — a bare probe must still succeed.
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });
});
