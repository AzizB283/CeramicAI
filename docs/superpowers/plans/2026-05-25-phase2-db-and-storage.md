# CeramicBot Phase 2 — Database Schema + Storage Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Phase 2 backend foundation — a multi-tenant PostgreSQL data layer (`ceramic_clients`, `ceramic_leads`, `ceramic_followups`) with a tenant-scoped Drizzle storage layer — forked from clinic-connect's patterns and adapted to the ceramics domain.

**Architecture:** Copy clinic-connect's proven primitives (Drizzle client, tenant `AsyncLocalStorage` context, encryption helpers) into `server/`, then define the three ceramic tables in `shared/schema.ts` and a `storage.ts` access layer that scopes every query by `clientId`. This slice produces a tested, runnable data layer with no HTTP/AI/WhatsApp yet — those are later slices. The Phase 1 demo in `client/` is untouched.

**Tech Stack:** Node 20+ · TypeScript (ESM, strict) · PostgreSQL · Drizzle ORM + drizzle-kit · drizzle-zod + Zod · Vitest (tests) · AES-256-GCM (PII encryption) · `pg`.

**Reference source (read-only, do not modify):** `/home/tops/Documents/Projects/DEMO/clinic-ai-automation` (clinic-connect). Key files quoted throughout: `shared/schema.ts`, `server/storage.ts`, `server/db.ts`, `server/middleware/clinic.ts`, `drizzle.config.ts`, `server/utils/encryption.ts`.

**Spec source:** `CeramicBot_Build_Spec_AurexAuto.docx` §4 (architecture), §5 (database schema). The three CREATE TABLE blocks in §5 are the authority for columns.

---

## Pre-flight

- [ ] **Confirm infra:** `DATABASE_URL` for a reachable PostgreSQL instance is available (user confirmed Postgres is ready). A throwaway/local DB is fine for this slice.
- [ ] **Confirm we are on a Phase 2 branch.** This slice adds a backend; the default branch should stay demo-only until merged. Run: `git checkout -b feat/phase2-db-storage` (skip if already on a feature branch).

---

## File Structure

This slice creates/modifies:

| Path | Responsibility |
| --- | --- |
| `server/package.json` | Workspace member: backend deps (drizzle, pg, zod) + test script |
| `server/tsconfig.json` | TS config for the server workspace (`@shared` alias) |
| `drizzle.config.ts` (root) | drizzle-kit config → reads `shared/schema.ts`, emits `migrations/` |
| `.env.example` | Documents required env vars (DB, encryption, OpenAI, WhatsApp) |
| `shared/schema.ts` | Drizzle table defs: `ceramic_clients`, `ceramic_leads`, `ceramic_followups` + Zod insert schemas + types |
| `server/db.ts` | `pg.Pool` + drizzle client (`db`, `pool`) |
| `server/middleware/tenant.ts` | `tenantContext` (AsyncLocalStorage), `currentClientId()`, `getTenantMode()` |
| `server/utils/encryption.ts` | `encrypt` / `decrypt` / `hashPhone` AES-GCM helpers (copied from clinic-connect) |
| `server/storage.ts` | Tenant-scoped CRUD for clients/leads/followups; `scope()`/`withClientId()` |
| `server/storage.test.ts` | Vitest integration tests for the storage layer |
| `server/vitest.config.ts` | Vitest config |
| Root `package.json` | Add `server` workspace scripts: `db:push`, `db:generate`, `test:server` |

> **Naming note:** clinic-connect uses `clinicId` / `currentClinicId()`. We rename to **`clientId` / `currentClientId()`** throughout (ceramic *clients*), and the tenant column is `client_id` referencing `ceramic_clients.id`. Keep this consistent — a method using `clinicId` in one task and `clientId` in another is a bug.

---

## Task 1: Server workspace scaffolding

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Modify: `package.json` (root) — add server scripts

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@ceramicbot/server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "drizzle-orm": "^0.39.3",
    "drizzle-zod": "^0.7.1",
    "pg": "^8.16.3",
    "zod": "^3.25.76",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.19.27",
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.31.8",
    "tsx": "^4.20.5",
    "typescript": "5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["../shared/*"]
    }
  },
  "include": ["**/*.ts", "../shared/**/*.ts"]
}
```

- [ ] **Step 3: Add server scripts to root `package.json`**

In the root `package.json` `scripts` block, add these entries (keep existing client scripts):

```json
    "dev:server": "tsx watch server/index.ts",
    "check:server": "npm run check --workspace server",
    "test:server": "npm run test --workspace server",
    "db:generate": "npm run db:generate --workspace server",
    "db:push": "npm run db:push --workspace server"
```

Note: `dev:server` references `server/index.ts` which does not exist yet (a later slice). That's fine — it's not run in this slice.

- [ ] **Step 4: Install deps**

Run: `npm install`
Expected: workspaces resolve; `server/node_modules` or hoisted deps present; exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/tsconfig.json package.json package-lock.json
git commit -m "chore(server): scaffold Phase 2 server workspace"
```

---

## Task 2: Drizzle config + env template

**Files:**
- Create: `drizzle.config.ts` (repo root)
- Create: `.env.example` (repo root)

- [ ] **Step 1: Create `drizzle.config.ts`** (adapted verbatim from clinic-connect `drizzle.config.ts`)

```typescript
import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set — ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

- [ ] **Step 2: Create `.env.example`**

```bash
# ── Database (required) ───────────────────────────────────────────────
DATABASE_URL=postgres://user:password@localhost:5432/ceramicbot

# ── PII encryption (required) ─────────────────────────────────────────
# 32-byte hex key. Generate with: openssl rand -hex 32
ENCRYPTION_KEY=

# ── Tenant mode ───────────────────────────────────────────────────────
# "single" (one client, no auth context needed) | "multi" (SaaS)
TENANT_MODE=single

# ── OpenAI (later slice) ──────────────────────────────────────────────
AI_INTEGRATIONS_OPENAI_API_KEY=
CHAT_AI_MODEL=gpt-4o-mini

# ── WhatsApp Business Cloud API (later slice) ─────────────────────────
# Per-client creds are stored encrypted in ceramic_clients; these are
# only platform-level fallbacks/verification if needed.
# WHATSAPP_VERIFY_TOKEN=

# ── Runtime ───────────────────────────────────────────────────────────
PORT=5000
RUN_MIGRATIONS=false
```

- [ ] **Step 3: Verify `.gitignore` already excludes `.env`**

Run: `grep -E '^\.env' .gitignore`
Expected: shows `.env` and `.env.*` with `!.env.example` (already present from Phase 1). If `.env.example` is not exempted, add `!.env.example`.

- [ ] **Step 4: Commit**

```bash
git add drizzle.config.ts .env.example
git commit -m "chore(server): add drizzle config and env template"
```

---

## Task 3: Database schema — three ceramic tables

**Files:**
- Create: `shared/schema.ts`

Columns are taken from spec §5 (the three CREATE TABLE blocks). Patterns (imports, table syntax, indexes, Zod schemas, type exports) are taken verbatim from clinic-connect `shared/schema.ts`.

- [ ] **Step 1: Write `shared/schema.ts`**

```typescript
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  serial,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── ceramic_clients — multi-tenant root (spec §5.1) ─────────────────────
export const ceramicClients = pgTable("ceramic_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // "Shree Tiles Pvt Ltd"
  mode: text("mode").notNull(), // "factory" | "exporter"
  ownerName: text("owner_name"),
  ownerWhatsapp: text("owner_whatsapp"), // owner phone for alerts
  catalogUrl: text("catalog_url"),
  exportCatalogUrl: text("export_catalog_url"),
  waPhoneId: text("wa_phone_id"), // WhatsApp Cloud API phone ID
  waToken: text("wa_token"), // encrypted at application layer
  waVerifyToken: text("wa_verify_token"),
  widgetColor: text("widget_color").default("e85d04"),
  widgetName: text("widget_name"),
  widgetGreeting: text("widget_greeting"),
  timezone: text("timezone").default("Asia/Kolkata"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertCeramicClientSchema = createInsertSchema(ceramicClients).omit({
  id: true,
  createdAt: true,
});
export type CeramicClient = typeof ceramicClients.$inferSelect;
export type InsertCeramicClient = z.infer<typeof insertCeramicClientSchema>;

// ── ceramic_leads — one row per buyer inquiry (spec §5.1) ───────────────
export const ceramicLeads = pgTable(
  "ceramic_leads",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    sessionId: text("session_id").notNull(),
    channel: text("channel"), // "whatsapp" | "web"
    buyerType: text("buyer_type"), // retailer | distributor | architect | builder | export | general
    buyerName: text("buyer_name"), // encrypted at application layer
    buyerPhone: text("buyer_phone"), // encrypted at application layer
    buyerPhoneHash: text("buyer_phone_hash"), // HMAC for indexed lookup
    buyerCompany: text("buyer_company"),
    buyerCountry: text("buyer_country"),
    buyerCity: text("buyer_city"),
    productCategory: text("product_category"), // gvt | ceramic_wall | pgvt ...
    productSize: text("product_size"), // 600x600 | 1200x600 ...
    productFinish: text("product_finish"), // matte | glossy ...
    quantity: text("quantity"), // "500-2000 boxes" | "3 containers"
    incoterms: text("incoterms"), // FOB | CIF — exporter mode
    destinationPort: text("destination_port"),
    sampleRequested: boolean("sample_requested").default(false),
    isDistributorInquiry: boolean("is_distributor_inquiry").default(false),
    priority: text("priority").default("normal"), // normal | high | priority
    catalogSent: boolean("catalog_sent").default(false),
    ownerNotified: boolean("owner_notified").default(false),
    status: text("status").default("new"), // new | contacted | converted | lost
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_ceramic_leads_client_id").on(t.clientId),
    index("idx_ceramic_leads_client_status").on(t.clientId, t.status),
    index("idx_ceramic_leads_client_phone_hash").on(t.clientId, t.buyerPhoneHash),
    index("idx_ceramic_leads_session").on(t.sessionId),
  ],
);

export const insertCeramicLeadSchema = createInsertSchema(ceramicLeads).omit({
  id: true,
  clientId: true,
  createdAt: true,
  buyerPhoneHash: true,
});
export type CeramicLead = typeof ceramicLeads.$inferSelect;
export type InsertCeramicLead = z.infer<typeof insertCeramicLeadSchema>;

// ── ceramic_followups — Day 2/5/10 schedule per lead (spec §5.1) ────────
export const ceramicFollowups = pgTable(
  "ceramic_followups",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull().references(() => ceramicLeads.id),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    sendAt: timestamp("send_at").notNull(),
    dayNumber: integer("day_number"), // 2 | 5 | 10
    message: text("message"),
    sent: boolean("sent").default(false),
    sentAt: timestamp("sent_at"),
  },
  (t) => [
    index("idx_ceramic_followups_client_id").on(t.clientId),
    index("idx_ceramic_followups_lead_id").on(t.leadId),
    index("idx_ceramic_followups_due").on(t.sent, t.sendAt),
  ],
);

export const insertCeramicFollowupSchema = createInsertSchema(ceramicFollowups).omit({
  id: true,
  clientId: true,
});
export type CeramicFollowup = typeof ceramicFollowups.$inferSelect;
export type InsertCeramicFollowup = z.infer<typeof insertCeramicFollowupSchema>;
```

- [ ] **Step 2: Typecheck the schema**

Run: `npm run check:server`
Expected: PASS (exit 0). If drizzle-zod version mismatches cause type errors, confirm `drizzle-zod@^0.7.1` is installed.

- [ ] **Step 3: Generate the SQL migration**

Run: `npm run db:generate`
Expected: a new file under `migrations/` containing `CREATE TABLE "ceramic_clients"`, `"ceramic_leads"`, `"ceramic_followups"` and the indexes. Open it and eyeball that all three tables and FKs are present.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(db): add ceramic_clients/leads/followups schema + migration"
```

---

## Task 4: Drizzle client (`server/db.ts`)

**Files:**
- Create: `server/db.ts`

Adapted from clinic-connect `server/db.ts`, minus the auto-migrate-on-import (we run migrations explicitly via `db:push`/`db:generate` in this slice; auto-migrate can be re-added in the HTTP slice).

- [ ] **Step 1: Write `server/db.ts`**

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

- [ ] **Step 2: Typecheck**

Run: `npm run check:server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/db.ts
git commit -m "feat(server): add drizzle client"
```

---

## Task 5: Tenant context (`server/middleware/tenant.ts`)

**Files:**
- Create: `server/middleware/tenant.ts`

Mirrors clinic-connect `server/middleware/clinic.ts`, renamed clinic→client. No Express middleware in this slice — just the `AsyncLocalStorage` context + accessors the storage layer needs. `TENANT_MODE` defaults to `single` so storage works without an HTTP request in tests.

- [ ] **Step 1: Write `server/middleware/tenant.ts`**

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  clientId: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** "single" = one client, context optional. "multi" = SaaS, context required. */
export type TenantMode = "single" | "multi";

export function getTenantMode(): TenantMode {
  return process.env.TENANT_MODE === "multi" ? "multi" : "single";
}

/** The active client id, or undefined in single mode without a context. */
export function currentClientId(): string | undefined {
  return tenantContext.getStore()?.clientId;
}

/** Run `fn` with a bound client id (used by HTTP middleware in a later slice, and by tests). */
export function runWithClient<T>(clientId: string, fn: () => T): T {
  return tenantContext.run({ clientId }, fn);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run check:server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/middleware/tenant.ts
git commit -m "feat(server): add tenant context (AsyncLocalStorage)"
```

---

## Task 6: Encryption helpers (`server/utils/encryption.ts`)

**Files:**
- Create: `server/utils/encryption.ts`

We encrypt buyer PII (name, phone) at the application layer like clinic-connect does for patients. This task ports the AES-256-GCM helpers. The reference implementation is clinic-connect `server/utils/encryption.ts` — read it and port the same algorithm. The code below is a faithful, self-contained equivalent; if the reference differs materially, prefer the reference so ciphertext format stays consistent across the two products.

- [ ] **Step 1: Write `server/utils/encryption.ts`**

```typescript
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 32-byte hex string (64 chars). Generate with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Returns "iv:authTag:ciphertext", all hex. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

/** Reverses encrypt(); returns input unchanged if it isn't our format (defensive). */
export function decrypt(value: string): string {
  if (!isEncrypted(value)) return value;
  const [ivHex, tagHex, dataHex] = value.split(":");
  const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i.test(value);
}

/** Deterministic HMAC for indexed phone lookup (same input → same hash). */
export function hashPhone(phone: string): string {
  return crypto.createHmac("sha256", key()).update(normalizePhone(phone)).digest("hex");
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run check:server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/utils/encryption.ts
git commit -m "feat(server): add AES-GCM encryption helpers for buyer PII"
```

---

## Task 7: Vitest config + DB test guard

**Files:**
- Create: `server/vitest.config.ts`
- Create: `server/test/setup.ts`

Storage tests are integration tests that hit a real Postgres (`DATABASE_URL`). The setup file loads env and skips the suite cleanly if no DB is configured, so the suite never fails for the wrong reason.

- [ ] **Step 1: Write `server/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const shared = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@shared": shared },
  },
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.ts"],
    fileParallelism: false, // share one DB; avoid cross-test races
  },
});
```

- [ ] **Step 2: Write `server/test/setup.ts`**

```typescript
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

// A 32-byte hex test key so encryption helpers work in tests if not set.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
}
```

- [ ] **Step 3: Add `dotenv` to server devDeps if missing**

Run: `npm ls dotenv --workspace server`
If absent, run: `npm install --workspace server dotenv@^17.3.1`

- [ ] **Step 4: Commit**

```bash
git add server/vitest.config.ts server/test/setup.ts server/package.json package-lock.json
git commit -m "test(server): add vitest config + env setup"
```

---

## Task 8: Storage layer — write the failing tests first

**Files:**
- Create: `server/storage.test.ts`

We TDD the storage layer. These tests define the exact public API of `storage.ts` (Task 9). They require a reachable `DATABASE_URL` with the migration applied.

- [ ] **Step 1: Ensure the schema is applied to the test DB**

Run: `npm run db:push`
Expected: drizzle-kit reports the three tables created/in-sync against `DATABASE_URL`.

- [ ] **Step 2: Write `server/storage.test.ts`**

```typescript
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
```

- [ ] **Step 3: Run the tests to confirm they FAIL (no storage module yet)**

Run: `npm run test:server`
Expected: FAIL — `Cannot find module './storage'` (or `storage` undefined). This confirms the tests run and the implementation is genuinely missing.

- [ ] **Step 4: Commit the failing tests**

```bash
git add server/storage.test.ts
git commit -m "test(server): storage layer specs (failing)"
```

---

## Task 9: Storage layer implementation (`server/storage.ts`)

**Files:**
- Create: `server/storage.ts`

Implements exactly the API the Task 8 tests call. Patterns (`scope()`, `withClientId()`, `const [row] = await db...`, `.returning()`, encrypt-on-write/decrypt-on-read) are ported from clinic-connect `server/storage.ts`, renamed clinic→client.

- [ ] **Step 1: Write `server/storage.ts`**

```typescript
import { eq, and, lte, desc, type SQL } from "drizzle-orm";
import { db } from "./db";
import { currentClientId, getTenantMode } from "./middleware/tenant";
import {
  ceramicClients,
  ceramicLeads,
  ceramicFollowups,
  type CeramicClient,
  type InsertCeramicClient,
  type CeramicLead,
  type InsertCeramicLead,
  type CeramicFollowup,
  type InsertCeramicFollowup,
} from "@shared/schema";
import { encrypt, decrypt, hashPhone } from "./utils/encryption";

// ── tenant scoping (ported from clinic-connect) ─────────────────────────
function scope(column: any): SQL | undefined {
  const cid = currentClientId();
  if (cid) return eq(column, cid);
  if (getTenantMode() === "multi") {
    throw new Error(
      "Tenant context missing — storage call made outside runWithClient. " +
        "Wrap the caller in runWithClient(clientId, () => { ... }).",
    );
  }
  return undefined;
}

function withClientId<T extends Record<string, any>>(values: T): T & { clientId?: string } {
  const cid = currentClientId();
  if (cid) return { ...values, clientId: cid };
  if (getTenantMode() === "multi") {
    throw new Error(
      "Tenant context missing on write — refuse to insert without client_id. " +
        "Wrap the caller in runWithClient(clientId, () => { ... }).",
    );
  }
  return values; // single mode: NOT NULL client_id is the DB safety net
}

// ── PII encrypt/decrypt for leads ───────────────────────────────────────
function encryptLeadFields<T extends Partial<InsertCeramicLead>>(
  data: T,
): T & { buyerPhoneHash?: string } {
  const out: any = { ...data };
  if (data.buyerName != null) out.buyerName = encrypt(data.buyerName);
  if (data.buyerPhone != null) {
    out.buyerPhone = encrypt(data.buyerPhone);
    out.buyerPhoneHash = hashPhone(data.buyerPhone);
  }
  return out;
}

function decryptLead(row: CeramicLead): CeramicLead {
  return {
    ...row,
    buyerName: row.buyerName ? decrypt(row.buyerName) : row.buyerName,
    buyerPhone: row.buyerPhone ? decrypt(row.buyerPhone) : row.buyerPhone,
  };
}

// ── storage API ─────────────────────────────────────────────────────────
export const storage = {
  // clients
  async createClient(input: InsertCeramicClient): Promise<CeramicClient> {
    const [row] = await db.insert(ceramicClients).values(input).returning();
    return row;
  },

  async getClient(id: string): Promise<CeramicClient | undefined> {
    const [row] = await db
      .select()
      .from(ceramicClients)
      .where(eq(ceramicClients.id, id))
      .limit(1);
    return row;
  },

  // leads
  async createLead(input: InsertCeramicLead): Promise<CeramicLead> {
    const [row] = await db
      .insert(ceramicLeads)
      .values(withClientId(encryptLeadFields(input)) as any)
      .returning();
    return decryptLead(row);
  },

  async getLead(id: number): Promise<CeramicLead | undefined> {
    const [row] = await db
      .select()
      .from(ceramicLeads)
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)))
      .limit(1);
    return row ? decryptLead(row) : undefined;
  },

  async getLeadByPhone(phone: string): Promise<CeramicLead | undefined> {
    const [row] = await db
      .select()
      .from(ceramicLeads)
      .where(and(eq(ceramicLeads.buyerPhoneHash, hashPhone(phone)), scope(ceramicLeads.clientId)))
      .limit(1);
    return row ? decryptLead(row) : undefined;
  },

  async getLeads(): Promise<CeramicLead[]> {
    const rows = await db
      .select()
      .from(ceramicLeads)
      .where(scope(ceramicLeads.clientId))
      .orderBy(desc(ceramicLeads.createdAt));
    return rows.map(decryptLead);
  },

  async updateLead(id: number, patch: Partial<InsertCeramicLead>): Promise<CeramicLead> {
    const [row] = await db
      .update(ceramicLeads)
      .set(encryptLeadFields(patch))
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)))
      .returning();
    return decryptLead(row);
  },

  async deleteLead(id: number): Promise<void> {
    await db
      .delete(ceramicFollowups)
      .where(eq(ceramicFollowups.leadId, id));
    await db
      .delete(ceramicLeads)
      .where(and(eq(ceramicLeads.id, id), scope(ceramicLeads.clientId)));
  },

  // followups
  async createFollowup(input: InsertCeramicFollowup): Promise<CeramicFollowup> {
    const [row] = await db
      .insert(ceramicFollowups)
      .values(withClientId(input) as any)
      .returning();
    return row;
  },

  async getDueFollowups(now: Date): Promise<CeramicFollowup[]> {
    // Cross-tenant by design: a scheduler sweeps all clients' due messages.
    return db
      .select()
      .from(ceramicFollowups)
      .where(and(eq(ceramicFollowups.sent, false), lte(ceramicFollowups.sendAt, now)));
  },
};

export type Storage = typeof storage;
```

- [ ] **Step 2: Run the tests to confirm they PASS**

Run: `npm run test:server`
Expected: PASS — all specs in `storage.test.ts` green.

- [ ] **Step 3: Typecheck**

Run: `npm run check:server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/storage.ts
git commit -m "feat(server): tenant-scoped storage layer for clients/leads/followups"
```

---

## Task 10: CLAUDE.md update + slice wrap-up

**Files:**
- Modify: `CLAUDE.md`
- Modify: `server/README.md`

- [ ] **Step 1: Update `CLAUDE.md`**

In the "Two phases" table, note Phase 2 has begun (DB + storage landed). Under a new "Phase 2 — built so far" subsection, add:

```markdown
### Phase 2 — built so far
- DB layer: `shared/schema.ts` defines `ceramic_clients` / `ceramic_leads` / `ceramic_followups` (spec §5). Migrations in `migrations/`.
- `server/db.ts` (drizzle client), `server/middleware/tenant.ts` (tenant context; clinic→**client** rename), `server/utils/encryption.ts` (AES-GCM PII).
- `server/storage.ts` — tenant-scoped CRUD. Every scoped query uses `scope()`; every write uses `withClientId()`. Buyer name/phone encrypted at rest; phone HMAC-indexed.
- Tests: `server/storage.test.ts` (Vitest, needs `DATABASE_URL`). Run `npm run test:server`.

Server commands (from root): `npm run db:generate`, `npm run db:push`, `npm run test:server`, `npm run check:server`.
Set `DATABASE_URL` and `ENCRYPTION_KEY` (see `.env.example`).
```

- [ ] **Step 2: Update `server/README.md`** — change "Empty by design" to note the DB/storage slice is done and link the plan. Keep the Phase 2 mapping table.

- [ ] **Step 3: Full verification**

Run, in order:
- `npm run check:server` → PASS
- `npm run test:server` → PASS
- `npm run check` (client, ensure Phase 1 still typechecks) → PASS
- `npm run build` (client, ensure demo still builds) → PASS

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md server/README.md
git commit -m "docs: record Phase 2 DB + storage slice"
```

---

## Self-Review notes (for the executor)

- **Spec §5 coverage:** all three tables and every column from the spec's CREATE TABLE blocks are in Task 3. Added (beyond spec, justified): `buyer_phone_hash` for encrypted-phone lookup (mirrors clinic-connect's `phone_hash` pattern) and a few composite indexes for the dashboard/scheduler queries.
- **Naming consistency:** `clientId` / `currentClientId()` / `client_id` / `withClientId()` / `runWithClient()` used uniformly — no `clinic*` leftovers should remain in new files.
- **No secrets committed:** `.env` is gitignored; only `.env.example` is committed.
- **Scope discipline:** `getDueFollowups` is intentionally cross-tenant (a scheduler concern) and documented as such; every other lead query is `scope()`-guarded.
- **Out of scope (later slices, do NOT build here):** Express routes, chat engine/FSM, OpenAI prompts/tools, WhatsApp webhook/sender, follow-up scheduler runtime, admin dashboard. This slice is data layer only.
```
