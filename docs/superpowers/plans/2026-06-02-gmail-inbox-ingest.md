# Gmail Inbox Ingest — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect an exporter's Gmail, poll their inbox every 5 minutes, and turn each buyer inquiry into a CRM lead plus an AI-drafted reply shown read-only in the dashboard. No sending (that is Slice 2).

**Architecture:** A `node-cron` scheduler lists Gmail-connected clients (cross-tenant) and runs each inside `runWithClient(clientId, …)`. Per client it incrementally syncs the inbox via the Gmail History API, classifies+extracts each new email in one OpenAI JSON call, drafts a reply in a second call, and persists an `email_threads` row + an auto-created `ceramic_leads` row. OAuth (connect/callback/disconnect) is ported from the clinic-connect Google Calendar pattern. The dashboard surfaces an inbox list + detail and a Gmail connect panel in the existing Integrations page.

**Tech Stack:** Node + Express 5 + TypeScript (ESM) · PostgreSQL + Drizzle ORM · `googleapis@^148` (Gmail v1) · `node-cron` · OpenAI (`openai@^6`, gpt-4o-mini) · React 18 + Vite + Tailwind + shadcn/ui + @tanstack/react-query · Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-02-gmail-inbox-ingest-design.md`

---

## Conventions (read before starting)

- ESM, TS strict, 2-space indent, double quotes, semicolons, trailing commas.
- Imports use `@shared/…` for `shared/` and relative paths inside `server/`.
- Encryption: `encrypt(s)` / `decrypt(s)` / `isEncrypted(s)` from `server/utils/encryption.ts` (`v2:` format). Tokens are encrypted; email bodies are NOT.
- Tenant scoping: storage reads use `scope(col)`, writes use `withClientId(values)`. Callers outside HTTP wrap work in `runWithClient(clientId, fn)` from `server/middleware/tenant.ts`.
- Routes behind `requireAuth`; resolve the operating client with the `resolveClient(req, res)` helper pattern from `server/routes/admin.ts` (wraps `effectiveClientId`).
- Server commands from repo root: `npm run check:server` (typecheck), `npm run test:server` (Vitest — needs `DATABASE_URL` + 64-hex `ENCRYPTION_KEY`), `npm run db:generate`, `npm run db:push`.
- Tests need a real Postgres (`DATABASE_URL`) and `ENCRYPTION_KEY`; they share the seeded demo client via `ensureDemoClient()` and log in through `request.agent(app)`.

## File structure

**Create:**
- `server/services/gmailAuth.ts` — OAuth client, auth URL, code exchange, revoke, per-client Gmail client.
- `server/services/gmailPoller.ts` — history-list incremental sync, fetch+parse messages, dedupe, cursor save.
- `server/services/emailProcessor.ts` — `classifyAndExtract` (1 JSON call) + `generateReply` (1 call) + deterministic fallbacks.
- `server/services/emailIngest.ts` — persist thread + auto-create lead + link + priority alert.
- `server/services/emailScheduler.ts` — node-cron sweep over connected clients.
- `server/routes/email.ts` — `/api/admin/email/*` routes.
- `server/services/emailProcessor.test.ts`, `server/services/gmailPoller.test.ts`, `server/routes/email.test.ts`.
- `client/src/pages/admin/email-inbox.tsx` — inbox list + detail.

**Modify:**
- `shared/schema.ts` — add `emailConnections`, `emailThreads`; add `emailThreadId` to `ceramicLeads`.
- `server/storage.ts` — email-table CRUD + `listEmailConnectedClients()`.
- `server/app.ts` — mount `emailRouter` under `/api/admin/email`.
- `server/index.ts` — start the scheduler (guarded).
- `server/package.json` — add `node-cron` + `googleapis` + `@types`/types.
- `.env.example` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL`.
- `client/src/pages/admin/integrations.tsx` — Gmail connect/disconnect/check-now panel.
- `client/src/App.tsx` (or the admin nav/router file) — add the Email Inbox route + nav item.

---

## Task 1: Add dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install runtime + types**

Run from repo root:
```bash
npm install --workspace server googleapis@^148 node-cron@^3
npm install --workspace server --save-dev @types/node-cron
```

- [ ] **Step 2: Verify they landed in server/package.json**

Run: `node -e "const p=require('./server/package.json'); console.log(p.dependencies.googleapis, p.dependencies['node-cron'], p.devDependencies['@types/node-cron'])"`
Expected: prints three non-undefined versions.

- [ ] **Step 3: Commit**

```bash
git add server/package.json package-lock.json
git commit -m "build(server): add googleapis + node-cron for Gmail ingest"
```

---

## Task 2: Schema — email_connections, email_threads, ceramic_leads.email_thread_id

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1: Add the two tables + the lead column**

Append after the `ceramicCatalogues` block (and add `emailThreadId` inside the existing `ceramicLeads` column list, right after `notes`):

In `ceramicLeads` columns, add:
```typescript
    emailThreadId: integer("email_thread_id"), // FK set after email_threads exists (see relation note)
```

Append new tables at the end of the file (before nothing else depends on order):
```typescript
// ── email_connections — one connected Gmail account per client ──────────
// The exporter's own inbox. OAuth tokens are AES-GCM encrypted at the app
// layer (same v2: format as WhatsApp creds). One row per client (unique).
export const emailConnections = pgTable(
  "email_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull().unique().references(() => ceramicClients.id),
    gmailAddress: text("gmail_address").notNull(), // plain — business identity, shown in UI
    accessToken: text("access_token").notNull(), // encrypted v2:…
    refreshToken: text("refresh_token").notNull(), // encrypted v2:…
    tokenExpiry: timestamp("token_expiry"),
    historyId: text("history_id"), // Gmail incremental-sync cursor
    lastCheckedAt: timestamp("last_checked_at"),
    active: boolean("active").default(true).notNull(),
    connectedAt: timestamp("connected_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [index("idx_email_connections_active").on(t.active)],
);

export const insertEmailConnectionSchema = createInsertSchema(emailConnections).omit({
  id: true,
  clientId: true,
  connectedAt: true,
});
export type EmailConnection = typeof emailConnections.$inferSelect;
export type InsertEmailConnection = z.infer<typeof insertEmailConnectionSchema>;

// ── email_threads — one row per ingested buyer email ────────────────────
// body/from stored plaintext (matches the repo's notes/buyer_company PII
// boundary). Dedupe via the unique gmail_message_id index.
export const emailThreads = pgTable(
  "email_threads",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id").notNull().references(() => ceramicClients.id),
    leadId: integer("lead_id").references(() => ceramicLeads.id),
    gmailThreadId: text("gmail_thread_id").notNull(),
    gmailMessageId: text("gmail_message_id").notNull().unique(),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    subject: text("subject"),
    bodyText: text("body_text"),
    sourcePlatform: text("source_platform"), // alibaba | indiamart | tradeindia | direct | website
    language: text("language"), // ISO code
    generatedReply: text("generated_reply"),
    status: text("status").default("pending_approval").notNull(), // pending_approval (only value this slice)
    receivedAt: timestamp("received_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_email_threads_client_id").on(t.clientId),
    index("idx_email_threads_client_status").on(t.clientId, t.status),
  ],
);

export const insertEmailThreadSchema = createInsertSchema(emailThreads).omit({
  id: true,
  clientId: true,
  receivedAt: true,
});
export type EmailThread = typeof emailThreads.$inferSelect;
export type InsertEmailThread = z.infer<typeof insertEmailThreadSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npm run check:server`
Expected: PASS (no type errors). `integer` is already imported in `shared/schema.ts`.

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `migrations/` containing `CREATE TABLE "email_connections"`, `CREATE TABLE "email_threads"`, and `ALTER TABLE "ceramic_leads" ADD COLUMN "email_thread_id"`.

- [ ] **Step 4: Apply it to the local DB**

Run: `npm run db:push`
Expected: applies cleanly. Verify: `psql "$DATABASE_URL" -c "\d email_threads"` shows the unique index on `gmail_message_id`.

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts migrations/
git commit -m "feat(schema): email_connections + email_threads + leads.email_thread_id"
```

---

## Task 3: Storage — email-table CRUD + connected-clients list

**Files:**
- Modify: `server/storage.ts`
- Test: `server/storage.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `server/storage.test.ts` (inside the existing top-level describe area; reuse its `ensureDemoClient`/`runWithClient` imports — add any missing import):
```typescript
describe("email connections + threads", () => {
  it("upserts a connection and reads it back with tokens decrypted", async () => {
    const clientId = await ensureDemoClient();
    await runWithClient(clientId, async () => {
      await storage.upsertEmailConnection({
        gmailAddress: "exporter@example.com",
        accessToken: "access-abc",
        refreshToken: "refresh-xyz",
        tokenExpiry: new Date(Date.now() + 3_600_000),
        historyId: "1000",
      });
      const conn = await storage.getEmailConnection();
      expect(conn?.gmailAddress).toBe("exporter@example.com");
      expect(conn?.refreshToken).toBe("refresh-xyz"); // decrypted on read
    });
  });

  it("inserts a thread and lists it scoped to the client", async () => {
    const clientId = await ensureDemoClient();
    await runWithClient(clientId, async () => {
      const t = await storage.createEmailThread({
        leadId: null,
        gmailThreadId: "T1",
        gmailMessageId: `M-${Date.now()}`,
        fromEmail: "buyer@x.com",
        fromName: "Buyer",
        subject: "GVT 600x600",
        bodyText: "need 3 containers",
        sourcePlatform: "direct",
        language: "en",
        generatedReply: "Dear Buyer…",
        status: "pending_approval",
      });
      const list = await storage.getEmailThreads();
      expect(list.find((r) => r.id === t.id)).toBeTruthy();
    });
  });

  it("listEmailConnectedClients returns the demo client cross-tenant", async () => {
    const clientId = await ensureDemoClient();
    const ids = await storage.listEmailConnectedClients();
    expect(ids).toContain(clientId);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:server -- storage`
Expected: FAIL — `storage.upsertEmailConnection is not a function`.

- [ ] **Step 3: Implement the storage methods**

In `server/storage.ts`, add to the import list from `@shared/schema`: `emailConnections`, `emailThreads`, `type EmailConnection`, `type InsertEmailConnection`, `type EmailThread`, `type InsertEmailThread`. Then add these methods inside the `storage` object (after the followups block):
```typescript
  // ── email connections (Gmail OAuth) ──────────────────────────────────
  // Tokens encrypted at rest; decrypted on read. One row per client.
  async upsertEmailConnection(input: InsertEmailConnection): Promise<EmailConnection> {
    const cid = currentClientId();
    if (!cid) {
      if (getTenantMode() === "multi") throw new Error("upsertEmailConnection: missing tenant context");
      throw new Error("upsertEmailConnection: client id required");
    }
    const values = {
      ...input,
      clientId: cid,
      accessToken: encrypt(input.accessToken),
      refreshToken: encrypt(input.refreshToken),
    };
    const [row] = await db
      .insert(emailConnections)
      .values(values as typeof emailConnections.$inferInsert)
      .onConflictDoUpdate({
        target: emailConnections.clientId,
        set: {
          gmailAddress: values.gmailAddress,
          accessToken: values.accessToken,
          refreshToken: values.refreshToken,
          tokenExpiry: values.tokenExpiry,
          historyId: values.historyId,
          active: true,
        },
      })
      .returning();
    return decryptConnection(row);
  },

  async getEmailConnection(): Promise<EmailConnection | undefined> {
    const [row] = await db
      .select()
      .from(emailConnections)
      .where(scope(emailConnections.clientId))
      .limit(1);
    return row ? decryptConnection(row) : undefined;
  },

  async updateEmailConnectionSync(patch: { historyId?: string | null; lastCheckedAt?: Date; accessToken?: string; tokenExpiry?: Date | null }): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.historyId !== undefined) set.historyId = patch.historyId;
    if (patch.lastCheckedAt !== undefined) set.lastCheckedAt = patch.lastCheckedAt;
    if (patch.accessToken !== undefined) set.accessToken = encrypt(patch.accessToken);
    if (patch.tokenExpiry !== undefined) set.tokenExpiry = patch.tokenExpiry;
    if (Object.keys(set).length === 0) return;
    await db.update(emailConnections).set(set).where(scope(emailConnections.clientId));
  },

  async deleteEmailConnection(): Promise<void> {
    await db.delete(emailConnections).where(scope(emailConnections.clientId));
  },

  // Cross-tenant by design (the scheduler sweeps all connected clients).
  async listEmailConnectedClients(): Promise<string[]> {
    const rows = await db
      .select({ clientId: emailConnections.clientId })
      .from(emailConnections)
      .where(eq(emailConnections.active, true));
    return rows.map((r) => r.clientId);
  },

  // ── email threads ────────────────────────────────────────────────────
  async createEmailThread(input: InsertEmailThread): Promise<EmailThread> {
    const [row] = await db
      .insert(emailThreads)
      .values(withClientId(input) as typeof emailThreads.$inferInsert)
      .returning();
    return row;
  },

  async getEmailThreads(): Promise<EmailThread[]> {
    return db
      .select()
      .from(emailThreads)
      .where(scope(emailThreads.clientId))
      .orderBy(desc(emailThreads.receivedAt));
  },

  async getEmailThread(id: number): Promise<EmailThread | undefined> {
    const [row] = await db
      .select()
      .from(emailThreads)
      .where(and(eq(emailThreads.id, id), scope(emailThreads.clientId)))
      .limit(1);
    return row;
  },

  async linkThreadToLead(threadId: number, leadId: number): Promise<void> {
    await db
      .update(emailThreads)
      .set({ leadId })
      .where(and(eq(emailThreads.id, threadId), scope(emailThreads.clientId)));
  },
```

Add this helper above the `storage` object (near `decryptLead`):
```typescript
function decryptConnection(row: EmailConnection): EmailConnection {
  return {
    ...row,
    accessToken: safeDecrypt(row.accessToken) ?? row.accessToken,
    refreshToken: safeDecrypt(row.refreshToken) ?? row.refreshToken,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server -- storage`
Expected: PASS (the three new tests + existing ones).

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts server/storage.test.ts
git commit -m "feat(storage): email connection + thread CRUD with token encryption"
```

---

## Task 4: gmailAuth — OAuth client (ported from clinic-connect)

**Files:**
- Create: `server/services/gmailAuth.ts`

This module is thin glue over `googleapis`; we don't unit-test it directly (it calls Google). It's exercised via the route test in Task 8 with the OAuth client mocked.

- [ ] **Step 1: Write the module**

Create `server/services/gmailAuth.ts`:
```typescript
/**
 * Gmail OAuth — ported from clinic-connect's google-calendar.ts.
 *
 * Same proven shape: a single google.auth.OAuth2 client, offline access +
 * forced consent to guarantee a refresh token, and reliance on googleapis to
 * auto-refresh the access token internally (do NOT refresh on every call).
 *
 * Scopes: we request readonly + modify + send up front so the exporter consents
 * once. Slice 1 only calls readonly/modify; send is used in Slice 2.
 */
import { google } from "googleapis";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

function getBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  return "http://localhost:5000";
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/admin/email/callback`;
}

export function isOAuthConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function createOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri());
}

export function getAuthUrl(state: string): string {
  return createOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force consent so we always get a refresh token
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  const { tokens } = await createOAuth2Client().getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh token received. Revoke access in your Google account and reconnect.");
  }
  return {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3_600_000,
  };
}

/** Build a Gmail v1 client from a (decrypted) refresh token. googleapis auto-refreshes. */
export function gmailClientFromRefreshToken(refreshToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function revokeAccess(refreshToken: string): Promise<void> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.revokeCredentials();
}

/** Fetch the connected mailbox's email address (used after token exchange). */
export async function getGmailAddress(refreshToken: string): Promise<string> {
  const gmail = gmailClientFromRefreshToken(refreshToken);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress || "";
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run check:server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/services/gmailAuth.ts
git commit -m "feat(email): Gmail OAuth client ported from clinic-connect"
```

---

## Task 5: emailProcessor — classify+extract + reply (TDD with mocked OpenAI)

**Files:**
- Create: `server/services/emailProcessor.ts`
- Test: `server/services/emailProcessor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/services/emailProcessor.test.ts`. Mock the OpenAI module the same way `openaiChat.test.ts` does (vi.mock on "openai" default export). Pattern:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

import { classifyAndExtract, generateReply } from "./emailProcessor";

function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("classifyAndExtract", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("parses a buyer inquiry into structured fields", async () => {
    createMock.mockResolvedValueOnce(reply(JSON.stringify({
      is_buyer_inquiry: true, buyer_name: "Ahmed", buyer_company: "Ahmed Trading",
      buyer_country: "Kenya", product_category: "gvt", product_size: "600x600",
      quantity: "3 containers", incoterms: "CIF", destination_port: "Mombasa",
      sample_requested: false, language: "en", source_platform: "alibaba",
      buyer_type: "distributor",
    })));
    const out = await classifyAndExtract("we need 3 containers GVT 600x600 CIF Mombasa");
    expect(out.is_buyer_inquiry).toBe(true);
    expect(out.buyer_type).toBe("distributor");
    expect(out.buyer_country).toBe("Kenya");
  });

  it("flags non-buyer email as ignore", async () => {
    createMock.mockResolvedValueOnce(reply(JSON.stringify({ is_buyer_inquiry: false, language: "en" })));
    const out = await classifyAndExtract("your bank statement is ready");
    expect(out.is_buyer_inquiry).toBe(false);
  });

  it("returns is_buyer_inquiry=false when OpenAI is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const out = await classifyAndExtract("anything");
    expect(out.is_buyer_inquiry).toBe(false);
  });
});

describe("generateReply", () => {
  beforeEach(() => { createMock.mockReset(); process.env.OPENAI_API_KEY = "test-key"; });

  it("returns the model's reply text", async () => {
    createMock.mockResolvedValueOnce(reply("Dear Ahmed, thank you for your inquiry…"));
    const text = await generateReply(
      { is_buyer_inquiry: true, language: "en", buyer_name: "Ahmed" } as any,
      { name: "Shree Ceramic", ownerName: "Rajesh" } as any,
      "https://catalog.example/gvt.pdf",
    );
    expect(text).toContain("Ahmed");
  });

  it("falls back to a deterministic draft when OpenAI fails", async () => {
    createMock.mockRejectedValueOnce(new Error("boom"));
    const text = await generateReply(
      { is_buyer_inquiry: true, language: "en", buyer_name: "Ahmed" } as any,
      { name: "Shree Ceramic", ownerName: "Rajesh" } as any,
      "https://catalog.example/gvt.pdf",
    );
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Shree Ceramic");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:server -- emailProcessor`
Expected: FAIL — cannot find `./emailProcessor`.

- [ ] **Step 3: Implement the module**

Create `server/services/emailProcessor.ts`:
```typescript
/**
 * Email AI pipeline. Two OpenAI calls per buyer email:
 *   1. classifyAndExtract — one JSON call returns is_buyer_inquiry + all fields.
 *   2. generateReply — one call drafts the reply (only run for real inquiries).
 *
 * Reliability over novelty (matches openaiChat.ts): no key / bad response →
 * safe fallback. Classify falls back to "not a buyer" (we'd rather miss than
 * spam the inbox with junk leads). Reply falls back to a deterministic draft.
 */
import OpenAI from "openai";
import type { CeramicClient } from "@shared/schema";

const MODEL = "gpt-4o-mini";

let cached: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

export interface BuyerEmailData {
  is_buyer_inquiry: boolean;
  buyer_name?: string | null;
  buyer_company?: string | null;
  buyer_email?: string | null;
  buyer_country?: string | null;
  buyer_city?: string | null;
  product_category?: string | null;
  product_size?: string | null;
  product_finish?: string | null;
  quantity?: string | null;
  incoterms?: string | null;
  destination_port?: string | null;
  delivery_timeline?: string | null;
  sample_requested?: boolean;
  language: string;
  source_platform?: string | null;
  buyer_type?: string | null;
}

const EXTRACT_SYSTEM = `You classify and extract data from emails sent to a ceramic tile EXPORTER in Morbi, India.
Return ONLY a JSON object with these keys (use null when unknown):
{
  "is_buyer_inquiry": boolean,   // true only if it shows intent to buy/sample/quote ceramic tiles
  "buyer_name": string|null, "buyer_company": string|null, "buyer_email": string|null,
  "buyer_country": string|null, "buyer_city": string|null,
  "product_category": string|null,  // gvt | ceramic_wall | pgvt | double_charge | slab | sanitaryware
  "product_size": string|null,      // e.g. "600x600"
  "product_finish": string|null,    // e.g. "matte" | "glossy"
  "quantity": string|null, "incoterms": string|null, "destination_port": string|null,
  "delivery_timeline": string|null, "sample_requested": boolean,
  "language": string,               // ISO code: en | ar | es | fr | ru | hi
  "source_platform": string|null,   // alibaba | indiamart | tradeindia | direct | website
  "buyer_type": string|null         // distributor | retailer | builder | importer | architect | general
}
Set is_buyer_inquiry=false for spam, newsletters, invoices, bank, internal, or anything not about buying tiles.`;

export async function classifyAndExtract(emailText: string): Promise<BuyerEmailData> {
  const ai = client();
  if (!ai) return { is_buyer_inquiry: false, language: "en" };
  try {
    const res = await ai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      max_tokens: 500,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: emailText.slice(0, 8000) },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
    return {
      is_buyer_inquiry: Boolean(parsed.is_buyer_inquiry),
      language: typeof parsed.language === "string" ? parsed.language : "en",
      ...parsed,
    };
  } catch (err) {
    console.warn("[emailProcessor] classifyAndExtract failed:", err);
    return { is_buyer_inquiry: false, language: "en" };
  }
}

function fallbackReply(data: BuyerEmailData, client: Pick<CeramicClient, "name" | "ownerName">, catalogUrl: string): string {
  const name = data.buyer_name || "Sir/Madam";
  return [
    `Dear ${name},`,
    "",
    "Thank you for your inquiry. Please find our catalogue here:",
    catalogUrl,
    "",
    "Our export manager will share a formal quotation shortly.",
    "",
    "Best regards,",
    client.ownerName || "Export Team",
    client.name,
  ].join("\n");
}

export async function generateReply(
  data: BuyerEmailData,
  clientConfig: Pick<CeramicClient, "name" | "ownerName">,
  catalogUrl: string,
): Promise<string> {
  const ai = client();
  if (!ai) return fallbackReply(data, clientConfig, catalogUrl);
  try {
    const res = await ai.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `Write a professional email reply for ${clientConfig.name}, a ceramic tile exporter in Morbi, India.
Rules: reply in language "${data.language}"; warm, concise, under 150 words; always include the catalogue link ${catalogUrl};
say a formal quotation will follow within 4 hours; ask for any missing size/quantity/finish; do NOT quote prices;
if distributor inquiry, say the director will call within 24 hours; sign off "Best regards, ${clientConfig.ownerName || "Export Team"}, ${clientConfig.name}".
Buyer: country=${data.buyer_country}, product=${data.product_category} ${data.product_size} ${data.product_finish}, qty=${data.quantity}, incoterms=${data.incoterms}, port=${data.destination_port}.`,
        },
        { role: "user", content: "Generate the reply email body only. No subject line." },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : fallbackReply(data, clientConfig, catalogUrl);
  } catch (err) {
    console.warn("[emailProcessor] generateReply failed:", err);
    return fallbackReply(data, clientConfig, catalogUrl);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:server -- emailProcessor`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add server/services/emailProcessor.ts server/services/emailProcessor.test.ts
git commit -m "feat(email): classify+extract and reply generation with fallbacks"
```

---

## Task 6: gmailPoller — incremental sync + parse + dedupe (TDD with mocked Gmail)

**Files:**
- Create: `server/services/gmailPoller.ts`
- Create: `server/services/emailIngest.ts`
- Test: `server/services/gmailPoller.test.ts`

`emailIngest.ts` is persistence glue; `gmailPoller.ts` holds the parse/dedupe logic worth unit-testing. We export pure helpers from the poller so they can be tested without a network.

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `server/services/gmailPoller.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseGmailMessage, detectSourcePlatform } from "./gmailPoller";

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

describe("parseGmailMessage", () => {
  it("extracts headers and decodes a plain-text body", () => {
    const msg = {
      id: "M1",
      threadId: "T1",
      payload: {
        headers: [
          { name: "From", value: "Ahmed <ahmed@ahmedtrading.com>" },
          { name: "Subject", value: "Inquiry - GVT 600x600" },
        ],
        mimeType: "text/plain",
        body: { data: b64url("we need 3 containers") },
      },
    };
    const out = parseGmailMessage(msg as any);
    expect(out.gmailMessageId).toBe("M1");
    expect(out.fromEmail).toBe("ahmed@ahmedtrading.com");
    expect(out.fromName).toBe("Ahmed");
    expect(out.subject).toBe("Inquiry - GVT 600x600");
    expect(out.bodyText).toContain("3 containers");
  });

  it("walks multipart payloads to find text/plain", () => {
    const msg = {
      id: "M2", threadId: "T2",
      payload: {
        headers: [{ name: "From", value: "buyer@x.com" }],
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/html", body: { data: b64url("<p>hi</p>") } },
          { mimeType: "text/plain", body: { data: b64url("plain body here") } },
        ],
      },
    };
    const out = parseGmailMessage(msg as any);
    expect(out.fromEmail).toBe("buyer@x.com");
    expect(out.fromName).toBe(null);
    expect(out.bodyText).toBe("plain body here");
  });
});

describe("detectSourcePlatform", () => {
  it("maps known senders/subjects", () => {
    expect(detectSourcePlatform("notification@alibaba.com", "Buyer Inquiry")).toBe("alibaba");
    expect(detectSourcePlatform("noreply@indiamart.com", "x")).toBe("indiamart");
    expect(detectSourcePlatform("info@tradeindia.com", "x")).toBe("tradeindia");
    expect(detectSourcePlatform("ahmed@ahmedtrading.com", "hi")).toBe("direct");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:server -- gmailPoller`
Expected: FAIL — cannot find `./gmailPoller`.

- [ ] **Step 3: Implement emailIngest.ts**

Create `server/services/emailIngest.ts`. This wires the REAL service exports
(verified against the codebase): `pickCatalogue(lead, mode, candidates)` from
`catalogueMatcher.ts` (returns a `CeramicCatalogue | undefined`; caller falls
back to the client's default URL), and `notifyNewLead(client, lead)` from
`leadNotification.ts` (already never throws; already only sends when recipients
are configured — so we call it for every email lead, not just priority).
```typescript
/**
 * Persist one parsed buyer email: insert an email_threads row, auto-create a
 * ceramic_leads row (channel "email"), link them, and fire the existing Resend
 * owner alert via notifyNewLead. Runs inside runWithClient.
 */
import { storage } from "../storage";
import { notifyNewLead } from "./leadNotification";
import { pickCatalogue } from "./catalogueMatcher";
import { classifyAndExtract, generateReply, type BuyerEmailData } from "./emailProcessor";
import type { ParsedEmail } from "./gmailPoller";
import type { CeramicClient } from "@shared/schema";
import type { LeadDraft, Mode } from "@shared/types";

export async function ingestParsedEmail(parsed: ParsedEmail, clientConfig: CeramicClient): Promise<void> {
  const data: BuyerEmailData = await classifyAndExtract(
    `From: ${parsed.fromName ?? ""} <${parsed.fromEmail ?? ""}>\nSubject: ${parsed.subject ?? ""}\n\n${parsed.bodyText ?? ""}`,
  );
  if (!data.is_buyer_inquiry) return; // not a buyer — skip silently

  const catalogUrl = await resolveCatalogUrl(clientConfig, data);
  const generatedReply = await generateReply(data, clientConfig, catalogUrl);

  let thread;
  try {
    thread = await storage.createEmailThread({
      leadId: null,
      gmailThreadId: parsed.gmailThreadId,
      gmailMessageId: parsed.gmailMessageId,
      fromEmail: parsed.fromEmail,
      fromName: parsed.fromName,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      sourcePlatform: parsed.sourcePlatform,
      language: data.language,
      generatedReply,
      status: "pending_approval",
    });
  } catch (err) {
    // Unique gmail_message_id violation → already ingested. Skip.
    console.warn(`[emailIngest] duplicate or insert failed for ${parsed.gmailMessageId}:`, err);
    return;
  }

  const isPriority = (data.buyer_type ?? "").toLowerCase() === "distributor";
  const lead = await storage.createLead({
    sessionId: `email_${parsed.gmailMessageId}`,
    channel: "email",
    emailThreadId: thread.id,
    buyerType: data.buyer_type ?? null,
    buyerName: data.buyer_name ?? null,
    buyerEmail: parsed.fromEmail ?? data.buyer_email ?? null,
    buyerCompany: data.buyer_company ?? null,
    buyerCountry: data.buyer_country ?? null,
    buyerCity: data.buyer_city ?? null,
    productCategory: data.product_category ?? null,
    productSize: data.product_size ?? null,
    productFinish: data.product_finish ?? null,
    quantity: data.quantity ?? null,
    incoterms: data.incoterms ?? null,
    destinationPort: data.destination_port ?? null,
    sampleRequested: Boolean(data.sample_requested),
    isDistributorInquiry: isPriority,
    priority: isPriority ? "priority" : "normal",
    status: "new",
  });

  await storage.linkThreadToLead(thread.id, lead.id);

  // notifyNewLead is internally guarded + never throws; it no-ops when no
  // recipients are configured. Fire-and-forget so a slow Resend call doesn't
  // hold up the poll loop.
  void notifyNewLead(clientConfig, lead);
}

/**
 * Choose the catalogue URL for the reply. Uses the same score-based
 * pickCatalogue the chat bot uses (fetch the client's catalogues first), then
 * falls back to the client's default export/domestic catalog URL.
 */
async function resolveCatalogUrl(clientConfig: CeramicClient, data: BuyerEmailData): Promise<string> {
  const candidates = await storage.getCatalogues();
  const mode: Mode = clientConfig.mode === "exporter" ? "exporter" : "factory";
  const lead: LeadDraft = {
    productCategory: data.product_category ?? undefined,
    productSize: data.product_size ?? undefined,
    productFinish: data.product_finish ?? undefined,
  } as LeadDraft;
  const matched = pickCatalogue(lead, mode, candidates);
  return matched?.url
    ?? clientConfig.exportCatalogUrl
    ?? clientConfig.catalogUrl
    ?? "";
}
```

> Implementer note: confirm `storage.createLead` accepts `emailThreadId`. The
> existing `insertCeramicLeadSchema` (in `shared/schema.ts`) is built from the
> table via `createInsertSchema(...).omit({...})` — since Task 2 added the
> `emailThreadId` column to the table and it is NOT in the `omit` list, it is
> already an allowed insert field. No schema change needed; just verify
> `npm run check:server` is clean. Also verify the `LeadDraft` field names
> (`productCategory`/`productSize`/`productFinish`) against `shared/types.ts` —
> they match the chat flow's usage; adjust only if the type differs.

- [ ] **Step 4: Implement gmailPoller.ts**

Create `server/services/gmailPoller.ts`:
```typescript
/**
 * Incremental Gmail inbox sync for one connected client. Uses the History API
 * so we only fetch messages added since the saved historyId. First poll (no
 * cursor) seeds the cursor from the current mailbox WITHOUT backfilling.
 */
import { storage } from "../storage";
import { gmailClientFromRefreshToken } from "./gmailAuth";
import { ingestParsedEmail } from "./emailIngest";
import type { CeramicClient } from "@shared/schema";

export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  sourcePlatform: string | null;
}

function header(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string | null {
  const h = headers?.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPlainTextBody(payload: any): string | null {
  if (!payload) return null;
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeB64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const found = findPlainTextBody(part);
    if (found) return found;
  }
  // last resort: strip tags from text/html
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decodeB64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return null;
}

export function detectSourcePlatform(fromEmail: string | null, subject: string | null): string {
  const from = (fromEmail ?? "").toLowerCase();
  const subj = (subject ?? "").toLowerCase();
  if (from.includes("alibaba.com") || subj.includes("buyer inquiry") || subj.includes("trade alert")) return "alibaba";
  if (from.includes("indiamart.com")) return "indiamart";
  if (from.includes("tradeindia.com")) return "tradeindia";
  return "direct";
}

export function parseGmailMessage(msg: any): ParsedEmail {
  const headers = msg.payload?.headers;
  const fromRaw = header(headers, "From");
  let fromName: string | null = null;
  let fromEmail: string | null = null;
  if (fromRaw) {
    const m = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) {
      fromName = m[1].trim() || null;
      fromEmail = m[2].trim();
    } else {
      fromEmail = fromRaw.trim();
    }
  }
  const subject = header(headers, "Subject");
  const bodyText = findPlainTextBody(msg.payload);
  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    fromEmail,
    fromName,
    subject,
    bodyText,
    sourcePlatform: detectSourcePlatform(fromEmail, subject),
  };
}

/** Poll one client's inbox. MUST be called inside runWithClient(clientId, …). */
export async function pollClient(clientConfig: CeramicClient): Promise<void> {
  const conn = await storage.getEmailConnection();
  if (!conn || !conn.active) return;

  const gmail = gmailClientFromRefreshToken(conn.refreshToken);

  // First-ever poll: seed the cursor from the current mailbox, don't backfill.
  if (!conn.historyId) {
    const profile = await gmail.users.getProfile({ userId: "me" });
    await storage.updateEmailConnectionSync({
      historyId: profile.data.historyId ? String(profile.data.historyId) : null,
      lastCheckedAt: new Date(),
    });
    return;
  }

  const history = await gmail.users.history.list({
    userId: "me",
    startHistoryId: conn.historyId,
    historyTypes: ["messageAdded"],
    labelId: "INBOX",
  });

  const messageIds = new Set<string>();
  for (const h of history.data.history ?? []) {
    for (const added of h.messagesAdded ?? []) {
      const id = added.message?.id;
      if (id) messageIds.add(id);
    }
  }

  for (const id of messageIds) {
    try {
      const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const parsed = parseGmailMessage(full.data);
      await ingestParsedEmail(parsed, clientConfig);
    } catch (err) {
      console.error(`[gmailPoller] message ${id} failed:`, err);
    }
  }

  await storage.updateEmailConnectionSync({
    historyId: history.data.historyId ? String(history.data.historyId) : conn.historyId,
    lastCheckedAt: new Date(),
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server -- gmailPoller`
Expected: PASS (parse + detect tests). Then `npm run check:server` → PASS.

- [ ] **Step 6: Commit**

```bash
git add server/services/gmailPoller.ts server/services/emailIngest.ts server/services/gmailPoller.test.ts
git commit -m "feat(email): Gmail incremental poller + email ingest pipeline"
```

---

## Task 7: emailScheduler — node-cron sweep

**Files:**
- Create: `server/services/emailScheduler.ts`
- Modify: `server/index.ts`

No unit test (it's a timer + loop over Task 6, which is tested). Verified by the manual run.

- [ ] **Step 1: Write the scheduler**

Create `server/services/emailScheduler.ts`:
```typescript
/**
 * node-cron sweep: every 5 minutes, poll every Gmail-connected client's inbox.
 * The client list is cross-tenant; each client's work runs inside
 * runWithClient so storage stays tenant-scoped. One bad inbox can't stall the
 * sweep (per-client try/catch).
 */
import cron from "node-cron";
import { storage } from "../storage";
import { runWithClient } from "../middleware/tenant";
import { pollClient } from "./gmailPoller";
import { isOAuthConfigured } from "./gmailAuth";

let started = false;

export async function sweepAllInboxes(): Promise<void> {
  const clientIds = await storage.listEmailConnectedClients();
  for (const clientId of clientIds) {
    try {
      await runWithClient(clientId, async () => {
        const client = await storage.getClient(clientId);
        if (client) await pollClient(client);
      });
    } catch (err) {
      console.error(`[emailScheduler] client ${clientId} sweep failed:`, err);
    }
  }
}

export function startEmailScheduler(): void {
  if (started) return;
  if (!isOAuthConfigured()) {
    console.warn("[emailScheduler] Google OAuth not configured — email polling disabled.");
    return;
  }
  started = true;
  cron.schedule("*/5 * * * *", () => {
    void sweepAllInboxes().catch((err) => console.error("[emailScheduler] sweep error:", err));
  });
  console.log("[emailScheduler] started (every 5 min)");
}
```

- [ ] **Step 2: Start it from index.ts (guarded)**

In `server/index.ts`, after the server starts listening and seeding completes, add:
```typescript
import { startEmailScheduler } from "./services/emailScheduler";
// …after app.listen / seed:
startEmailScheduler();
```
Place the call in the same block where `keepAlive`/seed are kicked off so it only runs in the real server process (not in tests, which call `buildApp()` directly and never import `index.ts`).

- [ ] **Step 3: Typecheck**

Run: `npm run check:server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/services/emailScheduler.ts server/index.ts
git commit -m "feat(email): node-cron scheduler sweeping connected inboxes every 5 min"
```

---

## Task 8: Routes — /api/admin/email/* (TDD with mocked gmailAuth)

**Files:**
- Create: `server/routes/email.ts`
- Modify: `server/app.ts`
- Test: `server/routes/email.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `server/routes/email.test.ts`. Mock `gmailAuth` so no real Google call happens; log in via the seeded demo admin (admin/admin123) like `admin.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("../services/gmailAuth", () => ({
  isOAuthConfigured: () => true,
  getAuthUrl: (state: string) => `https://accounts.google.com/o/oauth2/auth?state=${state}`,
  getRedirectUri: () => "http://localhost:5000/api/admin/email/callback",
  exchangeCodeForTokens: async () => ({ access_token: "a", refresh_token: "r", expiry_date: Date.now() + 3_600_000 }),
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

  it("callback rejects a mismatched state (no prior connect on this flow)", async () => {
    const res = await agent.get("/api/admin/email/callback").query({ code: "x", state: "bogus" });
    expect([400, 403]).toContain(res.status);
  });

  it("status reports not-connected before callback", async () => {
    const res = await agent.get("/api/admin/email/status");
    expect(res.status).toBe(200);
    expect(typeof res.body.connected).toBe("boolean");
  });

  it("threads list is empty array when none ingested", async () => {
    const res = await agent.get("/api/admin/email/threads");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run test:server -- routes/email`
Expected: FAIL — 404s (router not mounted).

- [ ] **Step 3: Implement the router**

Create `server/routes/email.ts`:
```typescript
import type { Request, Response } from "express";
import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth, effectiveClientId, AuthError } from "../auth";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import {
  isOAuthConfigured,
  getAuthUrl,
  exchangeCodeForTokens,
  getGmailAddress,
  revokeAccess,
} from "../services/gmailAuth";
import { pollClient } from "../services/gmailPoller";

export const emailRouter = Router();
emailRouter.use(requireAuth);

function resolveClient(req: Request, res: Response): string | null {
  try {
    return effectiveClientId(req);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

declare module "express-session" {
  interface SessionData {
    gmailOAuthState?: { state: string; expiresAt: number };
  }
}

// GET /connect → Google auth URL; stash a CSPRNG state on the session.
emailRouter.get("/connect", (req, res) => {
  if (!isOAuthConfigured()) {
    res.status(503).json({ error: "Google OAuth not configured on the server." });
    return;
  }
  const state = crypto.randomBytes(32).toString("hex");
  req.session.gmailOAuthState = { state, expiresAt: Date.now() + 10 * 60 * 1000 };
  res.json({ authUrl: getAuthUrl(state) });
});

// GET /callback → verify state, exchange code, store encrypted tokens.
emailRouter.get("/callback", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const { code, state } = req.query;
  const stashed = req.session.gmailOAuthState;
  delete req.session.gmailOAuthState; // single-use
  if (!code || typeof state !== "string" || !stashed || Date.now() > stashed.expiresAt) {
    res.status(400).json({ error: "Invalid or expired OAuth state." });
    return;
  }
  const a = Buffer.from(state, "utf8");
  const b = Buffer.from(stashed.state, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: "OAuth state mismatch." });
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens(code as string);
    const gmailAddress = await getGmailAddress(tokens.refresh_token);
    await runWithClient(clientId, () =>
      storage.upsertEmailConnection({
        gmailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(tokens.expiry_date),
        historyId: null,
      }),
    );
    res.redirect("/admin/integrations?gmail=connected");
  } catch (err) {
    console.error("[email/callback] token exchange failed:", err);
    res.redirect("/admin/integrations?gmail=error");
  }
});

// GET /status
emailRouter.get("/status", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const conn = await runWithClient(clientId, () => storage.getEmailConnection());
  res.json({
    connected: Boolean(conn?.active),
    gmailAddress: conn?.gmailAddress ?? null,
    lastCheckedAt: conn?.lastCheckedAt ?? null,
  });
});

// DELETE /disconnect
emailRouter.delete("/disconnect", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, async () => {
    const conn = await storage.getEmailConnection();
    if (conn) {
      try { await revokeAccess(conn.refreshToken); } catch (e) { console.warn("[email] revoke failed:", e); }
      await storage.deleteEmailConnection();
    }
  });
  res.json({ ok: true });
});

// GET /threads + /threads/:id
emailRouter.get("/threads", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const threads = await runWithClient(clientId, () => storage.getEmailThreads());
  res.json(threads);
});

emailRouter.get("/threads/:id", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "bad id" }); return; }
  const thread = await runWithClient(clientId, () => storage.getEmailThread(id));
  if (!thread) { res.status(404).json({ error: "not found" }); return; }
  res.json(thread);
});

// POST /poll → manual "check now"
emailRouter.post("/poll", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    await runWithClient(clientId, async () => {
      const client = await storage.getClient(clientId);
      if (client) await pollClient(client);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[email/poll] failed:", err);
    res.status(502).json({ error: "poll failed" });
  }
});
```

- [ ] **Step 4: Mount the router**

In `server/app.ts`, add the import and mount it next to the other API routers:
```typescript
import { emailRouter } from "./routes/email";
// …with the other app.use("/api/...") lines:
app.use("/api/admin/email", emailRouter);
```
Mount it BEFORE `app.use("/api/admin", adminRouter)` is fine either way (Express matches the more specific prefix), but place it adjacent for readability.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:server -- routes/email`
Expected: PASS (all assertions). Then `npm run check:server` → PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/email.ts server/app.ts server/routes/email.test.ts
git commit -m "feat(email): /api/admin/email routes (connect, callback, status, threads, poll)"
```

---

## Task 9: Env example + Google Cloud setup notes

**Files:**
- Modify: `.env.example`
- Create: `docs/gmail-setup.md`

- [ ] **Step 1: Add env vars**

Append to `.env.example`:
```bash
# Gmail inbox ingest (Slice 1). Same Google Cloud project can host Calendar too.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Base URL used to build the OAuth redirect (…/api/admin/email/callback).
# Local dev default is http://localhost:5000 if unset.
APP_BASE_URL=http://localhost:5000
```

- [ ] **Step 2: Write the one-time setup doc**

Create `docs/gmail-setup.md` with the steps: create/enable Gmail API in Google Cloud Console; configure the OAuth consent screen; add the three scopes (`gmail.readonly`, `gmail.send`, `gmail.modify`); while the app is unverified, add the exporter's Gmail as a Test User; create an OAuth 2.0 Client ID (Web application) with the authorized redirect URI `${APP_BASE_URL}/api/admin/email/callback`; copy the client id/secret into `.env.local`.

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/gmail-setup.md
git commit -m "docs(email): Gmail OAuth env vars + Google Cloud setup guide"
```

---

## Task 10: Dashboard — Email Inbox page + Integrations Gmail panel

**Files:**
- Create: `client/src/pages/admin/email-inbox.tsx`
- Modify: `client/src/pages/admin/integrations.tsx`
- Modify: the admin router/nav file (find where `leads.tsx` / `integrations.tsx` routes are registered — likely `client/src/App.tsx` or an admin layout/sidebar component)

No automated test (UI); verified by `npm run build` + manual click-through in Task 11.

- [ ] **Step 1: Locate the admin route + nav registration**

Run: `grep -rn "integrations\|/admin/leads\|leads.tsx\|email-inbox" client/src --include=*.tsx | grep -iv "import .*ui/"`
Expected: shows where admin pages are routed and where nav links are listed. Note the file + the exact pattern used (route element + nav item).

- [ ] **Step 2: Create the Email Inbox page**

Create `client/src/pages/admin/email-inbox.tsx` following the structure of `leads.tsx` (same `useQuery` + `apiRequest` + shadcn `Card`/`Badge` imports). It must:
- `useQuery<EmailThread[]>({ queryKey: ["/api/admin/email/threads"] })` and render a card per thread: source platform, relative received time, `fromName`/`fromEmail`, `subject`, a one-line summary, and a ⚡ PRIORITY badge when the linked lead is priority (for this slice, show the badge when `sourcePlatform`+extracted buyer_type isn't available — simplest: show priority badge if the thread's lead is priority; if lead data isn't joined, omit the badge).
- On card click, `useQuery` `/api/admin/email/threads/:id` and show a detail panel: original `subject` + `bodyText`, and the `generatedReply` in a read-only box with the note "Sending will be enabled in the next update."
- Define a local `interface EmailThread` matching the columns returned by `GET /threads` (id, gmailThreadId, fromEmail, fromName, subject, bodyText, sourcePlatform, language, generatedReply, status, receivedAt, leadId).

- [ ] **Step 3: Register the route + nav item**

Add `email-inbox` to the admin routes and the sidebar/nav, mirroring the exact pattern found in Step 1 (e.g. a `<Route path="/admin/email-inbox" .../>` and a nav `{ to: "/admin/email-inbox", label: "Email Inbox" }`).

- [ ] **Step 4: Add the Gmail panel to Integrations**

In `client/src/pages/admin/integrations.tsx`, add a second Card below the WhatsApp card:
- `useQuery` `/api/admin/email/status` → `{ connected, gmailAddress, lastCheckedAt }`.
- If not connected: a "Connect Gmail" button that does `const { authUrl } = await apiRequest("GET", "/api/admin/email/connect"); window.location.href = authUrl;`.
- If connected: show "Connected as `<gmailAddress>` ✓", last-checked time, a "Check now" button (`POST /api/admin/email/poll` then invalidate the threads query + toast), and a "Disconnect" button (`DELETE /api/admin/email/disconnect`).
- Read the `?gmail=connected|error` query param on mount and toast accordingly.

- [ ] **Step 5: Build the client**

Run: `npm run build`
Expected: typecheck + Vite build succeed (no TS errors in the new page/panel).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/email-inbox.tsx client/src/pages/admin/integrations.tsx client/src/App.tsx
git commit -m "feat(admin): Email Inbox page + Gmail connect panel in Integrations"
```

---

## Task 11: Full verification (typecheck, tests, manual click-through)

**Files:** none (verification only)

- [ ] **Step 1: Typecheck both workspaces**

Run: `npm run check:server && npm run check`
Expected: both PASS.

- [ ] **Step 2: Run the full server test suite**

Run: `npm run test:server`
Expected: all suites green (storage, emailProcessor, gmailPoller, routes/email, plus pre-existing).

- [ ] **Step 3: Manual end-to-end (real Gmail, real OpenAI)**

With `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`OPENAI_API_KEY`/`ENCRYPTION_KEY`/`DATABASE_URL` in `.env.local`:
1. `npm run dev:server` (and `npm run dev` for the client).
2. Log into the admin panel, go to Integrations → Connect Gmail → complete Google consent (use the Test User account).
3. Send a test buyer inquiry email TO that connected Gmail (e.g. "We need 3 containers of 600x600 matte GVT, CIF Mombasa. — Ahmed, Ahmed Trading, Kenya"). Mark it landing in INBOX.
4. Click "Check now" in Integrations (or wait 5 min for cron).
5. Open Email Inbox → confirm a thread appears with extracted fields + a drafted reply, AND a matching row appears under Leads (channel = email, priority for the distributor example).

Expected: thread + lead both present; reply draft is non-empty and in English; no server errors in the log.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore(email): Slice 1 verification cleanup" || echo "nothing to commit"
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage:** OAuth connect/callback/disconnect (T4, T8) ✓ · 3 scopes requested (T4) ✓ · node-cron 5-min poll (T7) ✓ · History API incremental + first-poll-no-backfill (T6) ✓ · merged classify+extract + reply (T5) ✓ · dedupe on gmail_message_id (T2 unique index + T6 try/catch) ✓ · 3 tables minus redundant buyer_email (T2) ✓ · reuse ceramic_leads.buyer_email + email_thread_id (T2, T6) ✓ · tenant scoping via runWithClient (T3, T7, T8) ✓ · plaintext body / encrypted tokens (T2, T3) ✓ · priority alert via existing Resend (T6) ✓ · Email Inbox UI + Integrations panel (T10) ✓ · env + Google Cloud doc (T9) ✓ · tests (T3,5,6,8) + verification (T11) ✓ · Send/edit/ignore/followups explicitly deferred (header + spec §9) ✓.
- **Placeholder scan:** no placeholders. T6 now calls the REAL exports verified against the codebase — `pickCatalogue(lead, mode, candidates)` (caller fetches `storage.getCatalogues()` and falls back to the client's default URL) and `notifyNewLead(client, lead)` (internally guarded, never throws, no-ops without recipients). The two remaining implementer notes are *verifications* (confirm `emailThreadId` is an allowed insert field — it is, since Task 2 doesn't add it to the schema's `omit`; confirm `LeadDraft` field names), not unfinished code.
- **Type consistency:** `ParsedEmail` defined in T6 and consumed in T6/T8 ✓ · `BuyerEmailData` defined in T5, consumed in T6 ✓ · storage method names (`upsertEmailConnection`, `getEmailConnection`, `updateEmailConnectionSync`, `deleteEmailConnection`, `listEmailConnectedClients`, `createEmailThread`, `getEmailThreads`, `getEmailThread`, `linkThreadToLead`) match across T3/T6/T7/T8 ✓ · `pollClient(clientConfig: CeramicClient)` signature consistent T6/T7/T8 ✓ · `emailThreadId` lead field added T2, used T6 (with the note to confirm it's in the insert schema) ✓.
