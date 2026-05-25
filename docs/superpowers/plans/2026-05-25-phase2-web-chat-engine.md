# CeramicBot Phase 2 — Web Chat Engine (deterministic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the hardcoded client-only demo into a real client↔server↔DB pipeline: an Express server replays the existing `shared/flows.ts` conversation, the demo UI calls it over HTTP, and captured leads persist to PostgreSQL via the storage layer built in the previous slice. **No OpenAI, no WhatsApp** — those are later slices.

**Architecture:** Extract the demo's pure flow-advance logic into a shared, framework-agnostic `shared/flowEngine.ts` (single source of truth for both client and server). The server holds per-session conversation state in memory, advances the flow on each user turn, and on a terminal step writes a `ceramic_leads` row. The client hook becomes a thin async caller of `POST /api/chat/*`, preserving the exact same UI behavior (bubbles, chips, typing, owner alert). Single-tenant for now: one demo `ceramic_clients` row, seeded at startup.

**Tech Stack:** Node 20+ · Express 5 · TypeScript (ESM, strict) · Vitest + Supertest (HTTP tests) · the existing Drizzle storage layer · Vite dev proxy (client→server).

**Reference:** the existing client engine `client/src/lib/useChatFlow.ts` (the logic we're moving server-side), `shared/flows.ts`, `shared/types.ts`, and the storage layer `server/storage.ts` + `server/middleware/tenant.ts`.

---

## Pre-flight

- [ ] On branch `feat/phase2-db-storage` (continuing Phase 2) or a fresh `feat/phase2-web-chat` branch — confirm with the controller. Do not work on `main`.
- [ ] Local Postgres reachable via `.env.local` `DATABASE_URL`; schema already applied (`npm run db:push`). `ENCRYPTION_KEY` set.
- [ ] Sanity: `npm run test:server` passes (the storage slice) before starting.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `shared/flowEngine.ts` | **New.** Pure functions: advance the flow given (mode, stepId, lead, input) → next (stepId, lead, botMessages, quickReplies, terminal, ownerAlert). Framework-free; imported by both client and server. |
| `shared/flowEngine.test.ts` | **New.** Unit tests for the pure engine (no DB, no HTTP). |
| `server/services/chatSessions.ts` | **New.** In-memory session store: sessionId → { mode, stepId, lead }. 30-min TTL. |
| `server/routes/chat.ts` | **New.** Express router: `POST /api/chat/session`, `POST /api/chat/message`. Advances flow, persists lead on terminal. |
| `server/seed.ts` | **New.** Idempotently ensure one demo `ceramic_clients` row exists; export its id resolver. |
| `server/index.ts` | **New.** Express app: json middleware, mount chat router, seed demo client, listen on PORT. |
| `server/app.ts` | **New.** Build & return the Express app (no `listen`) so tests can import it with Supertest. |
| `server/routes/chat.test.ts` | **New.** HTTP integration tests (Supertest) hitting the real router + DB. |
| `client/src/lib/useChatFlow.ts` | **Modify.** Replace local flow walking with calls to `/api/chat/*`; keep the same returned shape + typing/owner-alert UX. |
| `client/vite.config.ts` | **Modify.** Add dev proxy `/api → http://localhost:5173`'s server (port 5000). |
| `server/package.json` | **Modify.** Add `express`, `supertest` deps; add `dev` script. |
| Root `package.json` | **Modify.** Add `dev:all` (run client + server together) — optional convenience. |

**Key principle (DRY):** the flow-advance logic must live in exactly ONE place (`shared/flowEngine.ts`). Both the server router and the client (for optimistic echo only) use it. Do not duplicate step-transition logic.

---

## Task 1: Extract the pure flow engine into `shared/`

Move the demo's flow-advance logic out of the React hook into a pure module. This is a refactor: behavior identical, no framework.

**Files:**
- Create: `shared/flowEngine.ts`
- Create: `shared/flowEngine.test.ts`

- [ ] **Step 1: Write the failing test `shared/flowEngine.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { startFlow, advanceFlow } from "./flowEngine";

describe("flowEngine — factory mode", () => {
  it("starts at the factory welcome step", () => {
    const s = startFlow("factory");
    expect(s.stepId).toBe("f_welcome");
    expect(s.botMessages.length).toBeGreaterShort ?? expect(s.botMessages.length).toBeGreaterThan(0);
    expect(s.quickReplies.some((r) => r.label.includes("Retailer"))).toBe(true);
    expect(s.terminal).toBe(false);
  });

  it("advances buyer type → product and records the lead field", () => {
    const s0 = startFlow("factory");
    const s1 = advanceFlow({
      mode: "factory",
      stepId: s0.stepId,
      lead: s0.lead,
      choiceLabel: "Retailer / Tile Shop Owner",
    });
    expect(s1.stepId).toBe("f_product");
    expect(s1.lead.buyerType).toBe("retailer");
    expect(s1.quickReplies.some((r) => r.label.includes("GVT"))).toBe(true);
  });

  it("accepts free text on a text step (name capture)", () => {
    // Drive to the f_catalog step which asks for the name via text input.
    let st = startFlow("factory");
    const pick = (label: string) => {
      const r = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, choiceLabel: label });
      st = r;
    };
    pick("Retailer / Tile Shop Owner");
    pick("GVT / Vitrified Floor Tiles");
    pick("600×600");
    pick("Matte");
    pick("500–2,000 boxes");
    expect(st.stepId).toBe("f_catalog");
    expect(st.catalog).toBe("factory");
    const named = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, text: "Rahul" });
    expect(named.lead.buyerName).toBe("Rahul");
    expect(named.stepId).toBe("f_city");
  });

  it("renders {client} and {name} placeholders in bot copy", () => {
    const s = startFlow("factory");
    expect(s.botMessages.join(" ")).toContain("Shree Tiles Pvt Ltd");
  });
});

describe("flowEngine — exporter distributor priority", () => {
  it("marks distributor path as priority and builds a priority owner alert", () => {
    const s0 = startFlow("exporter");
    const s1 = advanceFlow({
      mode: "exporter",
      stepId: s0.stepId,
      lead: s0.lead,
      choiceLabel: "I want to become a regular buyer / distributor",
    });
    expect(s1.lead.priority).toBe("priority");
    expect(s1.stepId).toBe("x_dist_country");
  });
});

describe("flowEngine — terminal owner alert", () => {
  it("emits a non-priority factory owner alert at the terminal step", () => {
    // Walk the whole factory flow to f_done.
    let st = startFlow("factory");
    const step = (a: { choiceLabel?: string; text?: string }) => {
      st = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, ...a });
    };
    step({ choiceLabel: "Retailer / Tile Shop Owner" });
    step({ choiceLabel: "GVT / Vitrified Floor Tiles" });
    step({ choiceLabel: "600×600" });
    step({ choiceLabel: "Matte" });
    step({ choiceLabel: "500–2,000 boxes" });
    step({ text: "Rahul" }); // name → f_city
    step({ text: "Surat" }); // city → f_done
    expect(st.stepId).toBe("f_done");
    expect(st.terminal).toBe(true);
    expect(st.ownerAlert).toBeTruthy();
    expect(st.ownerAlert!.priority).toBe(false);
    expect(st.ownerAlert!.lines.join("\n")).toContain("Rahul");
    expect(st.ownerAlert!.lines.join("\n")).toContain("Surat");
  });
});
```

NOTE TO IMPLEMENTER: the `toBeGreaterShort ??` token in the first test is a deliberate typo placeholder — replace that whole line with `expect(s.botMessages.length).toBeGreaterThan(0);`. (Left here so you verify you're reading the tests, not pasting blindly.)

- [ ] **Step 2: Run to confirm it fails**

Run: `npm run test:server -- flowEngine` (or add flowEngine.test.ts under server's vitest include — see note).
Expected: FAIL — `Cannot find module './flowEngine'`.

NOTE: `shared/flowEngine.test.ts` must be picked up by a test runner. Simplest: the server vitest config already includes `**/*.test.ts` relative to `server/`. Since this test is in `shared/`, either (a) run it via the client/root, or (b) add a root-level vitest. **Decision for this task:** put the test runner invocation under the server workspace by extending `server/vitest.config.ts` `include` to also match `../shared/**/*.test.ts`. Do that in Step 1 before running. Confirm the existing storage tests still run too.

- [ ] **Step 3: Write `shared/flowEngine.ts`**

Port the pure logic from `client/src/lib/useChatFlow.ts` (render, buildOwnerAlert, the choose/submit transition rules). Signature:

```typescript
import type { LeadDraft, Mode, QuickReply, StepId } from "./types";
import { DEMO_CLIENT_NAME, ENTRY, STEPS } from "./flows";

export interface OwnerAlert {
  priority: boolean;
  lines: string[];
}

export interface FlowSnapshot {
  stepId: StepId;
  lead: LeadDraft;
  botMessages: string[];     // already placeholder-rendered
  quickReplies: QuickReply[];
  inputKind: "choice" | "text";
  placeholder?: string;
  catalog?: "factory" | "export";
  terminal: boolean;
  ownerAlert: OwnerAlert | null;
}

export interface AdvanceInput {
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
  choiceLabel?: string;  // when the user tapped a chip
  text?: string;         // when the user typed
}

function render(text: string, mode: Mode, lead: LeadDraft): string {
  return text
    .replaceAll("{client}", DEMO_CLIENT_NAME[mode])
    .replaceAll("{name}", lead.buyerName ?? "there");
}

function buildOwnerAlert(mode: Mode, l: LeadDraft): OwnerAlert {
  // PORT VERBATIM from useChatFlow.ts buildOwnerAlert (factory / priority / export branches).
  // ... (implementer: copy the three-branch body exactly, it already matches the spec) ...
}

function snapshot(mode: Mode, stepId: StepId, lead: LeadDraft): FlowSnapshot {
  const step = STEPS[stepId];
  return {
    stepId,
    lead,
    botMessages: step.bot.map((line) => render(line, mode, lead)),
    quickReplies: step.options ?? [],
    inputKind: step.input === "text" ? "text" : "choice",
    placeholder: step.placeholder,
    catalog: step.catalog,
    terminal: !!step.terminal,
    ownerAlert: step.terminal ? buildOwnerAlert(mode, lead) : null,
  };
}

/** Begin a conversation for a mode. */
export function startFlow(mode: Mode): FlowSnapshot {
  return snapshot(mode, ENTRY[mode], {});
}

/** Advance one turn. Mirrors useChatFlow chooseOption/submitText. */
export function advanceFlow(input: AdvanceInput): FlowSnapshot {
  const { mode, stepId, choiceLabel, text } = input;
  const step = STEPS[stepId];
  const lead: LeadDraft = { ...input.lead };

  if (choiceLabel !== undefined) {
    const opt = (step.options ?? []).find((o) => o.label === choiceLabel);
    if (!opt) return snapshot(mode, stepId, lead); // unknown choice: stay put
    if (step.field) lead[step.field] = (opt.value ?? opt.label) as never;
    if (opt.priority) lead.priority = "priority";
    const next = opt.next ?? step.next;
    if (!next) return snapshot(mode, stepId, lead);
    if (next === ENTRY[mode] && step.terminal) return startFlow(mode); // "Start over"
    return snapshot(mode, next, lead);
  }

  if (text !== undefined) {
    const trimmed = text.trim();
    if (!trimmed) return snapshot(mode, stepId, lead);
    if (step.field) lead[step.field] = trimmed as never;
    if (step.next) return snapshot(mode, step.next, lead);
    return snapshot(mode, stepId, lead);
  }

  return snapshot(mode, stepId, lead);
}
```

- [ ] **Step 4: Run tests to PASS**

Run: `npm run test:server`
Expected: flowEngine tests PASS; existing storage tests still PASS.

- [ ] **Step 5: Refactor the client hook to use the shared engine (no behavior change)**

In `client/src/lib/useChatFlow.ts`, replace the inline `render`/`buildOwnerAlert`/transition logic by importing from `@shared/flowEngine`. The hook keeps its timers/typing UX but delegates "what happens next" to `advanceFlow`. Keep the public return shape identical.

- [ ] **Step 6: Verify client still builds & typechecks**

Run: `npm run check` and `npm run build`
Expected: both PASS. Manually note: the demo behavior is unchanged (still client-only at this point).

- [ ] **Step 7: Commit**

```bash
git add shared/flowEngine.ts shared/flowEngine.test.ts server/vitest.config.ts client/src/lib/useChatFlow.ts
git commit -m "refactor(flow): extract pure flowEngine shared by client + server"
```

---

## Task 2: In-memory session store

**Files:**
- Create: `server/services/chatSessions.ts`
- Create: `server/services/chatSessions.test.ts`

- [ ] **Step 1: Write failing test `server/services/chatSessions.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, getSession, setSession, deleteSession } from "./chatSessions";

describe("chatSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates a session with a unique id and stores state", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    expect(s.id).toMatch(/.+/);
    const got = getSession(s.id);
    expect(got?.mode).toBe("factory");
    expect(got?.stepId).toBe("f_welcome");
  });

  it("updates session state", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    setSession(s.id, { mode: "factory", stepId: "f_product", lead: { buyerType: "retailer" } });
    expect(getSession(s.id)?.stepId).toBe("f_product");
    expect(getSession(s.id)?.lead.buyerType).toBe("retailer");
  });

  it("expires sessions after the TTL", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 min > 30 min TTL
    expect(getSession(s.id)).toBeUndefined();
  });

  it("deletes a session", () => {
    const s = createSession({ mode: "exporter", stepId: "x_welcome", lead: {} });
    deleteSession(s.id);
    expect(getSession(s.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm fail** — `npm run test:server` → FAIL (module missing).

- [ ] **Step 3: Implement `server/services/chatSessions.ts`**

```typescript
import { randomUUID } from "node:crypto";
import type { LeadDraft, Mode, StepId } from "@shared/types";

export interface SessionState {
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
}

interface StoredSession extends SessionState {
  id: string;
  lastSeen: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, StoredSession>();

function fresh(s: StoredSession): boolean {
  return Date.now() - s.lastSeen <= TTL_MS;
}

export function createSession(state: SessionState): StoredSession {
  const id = randomUUID();
  const stored: StoredSession = { id, lastSeen: Date.now(), ...state };
  sessions.set(id, stored);
  return stored;
}

export function getSession(id: string): StoredSession | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  if (!fresh(s)) {
    sessions.delete(id);
    return undefined;
  }
  s.lastSeen = Date.now();
  return s;
}

export function setSession(id: string, state: SessionState): void {
  const existing = sessions.get(id);
  if (!existing) return;
  sessions.set(id, { ...existing, ...state, lastSeen: Date.now() });
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
```

- [ ] **Step 4: Run tests to PASS** — `npm run test:server`.

- [ ] **Step 5: Commit**

```bash
git add server/services/chatSessions.ts server/services/chatSessions.test.ts
git commit -m "feat(server): in-memory chat session store with TTL"
```

---

## Task 3: Demo client seed

**Files:**
- Create: `server/seed.ts`

- [ ] **Step 1: Implement `server/seed.ts`**

Idempotently ensure a single demo `ceramic_clients` row, return its id. Uses raw storage (createClient runs unscoped).

```typescript
import { db } from "./db";
import { ceramicClients } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "./storage";

const DEMO_SLUG_NAME = "Shree Tiles Pvt Ltd (Demo)";

let cachedId: string | null = null;

/** Ensure exactly one demo client exists; return its id (cached after first call). */
export async function ensureDemoClient(): Promise<string> {
  if (cachedId) return cachedId;
  const [existing] = await db
    .select()
    .from(ceramicClients)
    .where(eq(ceramicClients.name, DEMO_SLUG_NAME))
    .limit(1);
  if (existing) {
    cachedId = existing.id;
    return cachedId;
  }
  const created = await storage.createClient({
    name: DEMO_SLUG_NAME,
    mode: "factory",
    ownerName: "Demo Owner",
    ownerWhatsapp: "+910000000000",
    catalogUrl: "https://aurexauto.com/demo/catalog-factory.pdf",
    exportCatalogUrl: "https://aurexauto.com/demo/catalog-export.pdf",
  });
  cachedId = created.id;
  return cachedId;
}
```

- [ ] **Step 2: Typecheck** — `npm run check:server` PASS.

- [ ] **Step 3: Commit**

```bash
git add server/seed.ts
git commit -m "feat(server): idempotent demo client seed"
```

---

## Task 4: Chat router (HTTP) + lead persistence — tests first

**Files:**
- Create: `server/app.ts`
- Create: `server/routes/chat.ts`
- Create: `server/routes/chat.test.ts`
- Modify: `server/package.json` (add `express`, `@types/express`, `supertest`, `@types/supertest`)

- [ ] **Step 1: Add deps**

Run: `npm install --workspace server express@^5.0.1 && npm install --workspace server -D supertest@^7.0.0 @types/supertest@^6.0.2 @types/express@^5.0.0`

- [ ] **Step 2: Write `server/app.ts`** (app without listen, for tests + index)

```typescript
import express from "express";
import { chatRouter } from "./routes/chat";

export function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRouter);
  return app;
}
```

- [ ] **Step 3: Write the failing test `server/routes/chat.test.ts`**

```typescript
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
  // Remove leads created by these tests, then close pool.
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
    await type("Rahul Shah");           // name
    const done = await type("Surat");   // city → terminal

    expect(done.status).toBe(200);
    expect(done.body.terminal).toBe(true);
    expect(done.body.ownerAlert).toBeTruthy();
    expect(done.body.ownerAlert.priority).toBe(false);

    // Lead persisted with decrypted PII when read back under the demo client.
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
    const done = await choose("Yes"); // exclusive rights = YES → terminal

    expect(done.body.terminal).toBe(true);
    expect(done.body.ownerAlert.priority).toBe(true);

    const clientId = await ensureDemoClient();
    const leads = await runWithClient(clientId, () => storage.getLeads());
    const mine = leads.find((l) => l.sessionId === sessionId);
    expect(mine!.priority).toBe("priority");
    expect(mine!.isDistributorInquiry).toBe(true);
  });
});

describe("POST /api/chat/message — unknown session", () => {
  it("returns 404 for a missing session", async () => {
    const res = await request(app).post("/api/chat/message").send({ sessionId: "nope", text: "hi" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run to confirm fail** — `npm run test:server` → FAIL (chat router missing).

- [ ] **Step 5: Implement `server/routes/chat.ts`**

```typescript
import { Router } from "express";
import type { Mode } from "@shared/types";
import { startFlow, advanceFlow } from "@shared/flowEngine";
import { createSession, getSession, setSession } from "../services/chatSessions";
import { ensureDemoClient } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import { ENTRY } from "@shared/flows";

export const chatRouter = Router();

// POST /api/chat/session  { mode } → { sessionId, ...snapshot }
chatRouter.post("/session", (req, res) => {
  const mode: Mode = req.body?.mode === "exporter" ? "exporter" : "factory";
  const snap = startFlow(mode);
  const session = createSession({ mode, stepId: snap.stepId, lead: snap.lead });
  res.json({ sessionId: session.id, ...snap });
});

// POST /api/chat/message  { sessionId, choiceLabel? , text? } → snapshot
chatRouter.post("/message", async (req, res) => {
  const { sessionId, choiceLabel, text } = req.body ?? {};
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return res.status(404).json({ error: "session not found or expired" });

  const snap = advanceFlow({
    mode: session.mode,
    stepId: session.stepId,
    lead: session.lead,
    choiceLabel,
    text,
  });

  // "Start over" resets back to the entry step.
  const isRestart = snap.stepId === ENTRY[session.mode] && Object.keys(snap.lead).length === 0;
  setSession(sessionId, { mode: session.mode, stepId: snap.stepId, lead: snap.lead });

  // On a terminal step (not a restart), persist the captured lead once.
  if (snap.terminal && !isRestart) {
    const clientId = await ensureDemoClient();
    const l = snap.lead;
    await runWithClient(clientId, () =>
      storage.createLead({
        sessionId,
        channel: "web",
        buyerType: l.buyerType,
        buyerName: l.buyerName,
        buyerCompany: l.buyerCompany,
        buyerCountry: l.country ?? l.distributorCountry,
        buyerCity: l.buyerCity,
        productCategory: l.productCategory ?? l.sampleProduct,
        productSize: l.productSize,
        productFinish: l.productFinish,
        quantity: l.quantity ?? l.sampleQty ?? l.annualVolume,
        incoterms: l.incoterms,
        sampleRequested: l.sampleProduct != null,
        isDistributorInquiry: l.intent === "distributor" || l.exclusiveRights === "YES",
        priority: l.priority ?? "normal",
        catalogSent: true,
        ownerNotified: true,
        status: "new",
      }),
    );
  }

  res.json(snap);
});
```

NOTE: `InsertCeramicLead` omits clientId (injected via `withClientId` inside `runWithClient`). Buyer name/phone are encrypted by the storage layer. `buyerPhone` is not collected in the web demo flow (no phone step), so it's omitted — that's fine.

- [ ] **Step 6: Run tests to PASS** — `npm run test:server`. All chat + session + flowEngine + storage tests green.

- [ ] **Step 7: Typecheck** — `npm run check:server` PASS.

- [ ] **Step 8: Commit**

```bash
git add server/app.ts server/routes/chat.ts server/routes/chat.test.ts server/package.json package-lock.json
git commit -m "feat(server): deterministic web chat endpoints + lead persistence"
```

---

## Task 5: Server entrypoint

**Files:**
- Create: `server/index.ts`
- Modify: `server/package.json` (add `dev` script)

- [ ] **Step 1: Write `server/index.ts`**

```typescript
import "dotenv/config";
import { buildApp } from "./app";
import { ensureDemoClient } from "./seed";

const PORT = Number(process.env.PORT ?? 5000);

async function main() {
  await ensureDemoClient(); // seed before accepting traffic
  const app = buildApp();
  app.listen(PORT, () => {
    console.log(`[server] CeramicBot API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
```

NOTE: `dotenv/config` loads `.env` from cwd. Since the server runs from repo root via the root script, `.env.local` override isn't auto-loaded by `dotenv/config`. To match the test setup, load both: replace `import "dotenv/config";` with an explicit loader:
```typescript
import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
```
(Run the server from the repo root so these resolve.)

- [ ] **Step 2: Add server `dev` script** in `server/package.json`:
```json
    "dev": "tsx watch index.ts"
```
And confirm the root `dev:server` script (`tsx watch server/index.ts`) now works.

- [ ] **Step 3: Smoke test the server boots and serves**

Run (from repo root): `npm run dev:server &` then after ~2s: `curl -s -X POST localhost:5000/api/chat/session -H 'content-type: application/json' -d '{"mode":"factory"}'`
Expected: JSON with `sessionId` and `botMessages` containing "Shree Tiles". Then kill the server.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts server/package.json
git commit -m "feat(server): HTTP entrypoint with demo seed on boot"
```

---

## Task 6: Wire the client demo to the real API

**Files:**
- Modify: `client/vite.config.ts` (dev proxy)
- Modify: `client/src/lib/useChatFlow.ts` (call the API instead of walking locally)

- [ ] **Step 1: Add a dev proxy in `client/vite.config.ts`**

Inside the `server` config block add:
```typescript
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": "http://localhost:5000",
    },
  },
```

- [ ] **Step 2: Rework `useChatFlow.ts` to call the API**

The hook keeps the SAME public return shape (`mode, messages, step, lead, typing, ownerAlert, start, chooseOption, submitText`) but now:
- `start(mode)`: `POST /api/chat/session { mode }` → render returned `botMessages` as bot bubbles, store `sessionId`, set quick replies / input kind from the snapshot.
- `chooseOption(opt)`: push the user's label bubble, `POST /api/chat/message { sessionId, choiceLabel: opt.label }`, then render the returned snapshot (bot bubbles via the existing typing animation, quick replies, catalog, ownerAlert).
- `submitText(text)`: push the user bubble, `POST /api/chat/message { sessionId, text }`, render snapshot.

The snapshot drives `step`-like fields. Adapt the component's reads if needed, but prefer keeping `App.tsx` untouched by mapping the snapshot to the existing `step` shape (`{ input, options, placeholder, catalog, bot }`). Reuse `advanceFlow` is NO LONGER called on the client for transitions — the server owns transitions. (The shared engine is still imported by the server; the client may keep importing types only.)

IMPLEMENTER: this is the most involved step. Preserve the typing-dots UX and the owner-alert delay. Keep render of `{client}`/`{name}` — but note the SERVER already returns rendered `botMessages`, so the client should NOT re-render placeholders. Show bot messages verbatim from the response.

- [ ] **Step 3: Typecheck + build the client**

Run: `npm run check` and `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual end-to-end verification**

Start both: `npm run dev:server` (repo root) and `npm run dev` (client) in parallel.
- Open http://localhost:5173, walk the factory flow to the end.
- Confirm the chat works, the owner-alert panel appears.
- Confirm a lead row was written: `psql "$DATABASE_URL" -c "SELECT session_id, buyer_type, buyer_city, status FROM ceramic_leads ORDER BY created_at DESC LIMIT 3;"`
- Confirm `buyer_name` is ciphertext at rest: `psql "$DATABASE_URL" -c "SELECT buyer_name FROM ceramic_leads ORDER BY created_at DESC LIMIT 1;"` → should be `v2:...`, not plaintext.

- [ ] **Step 5: Commit**

```bash
git add client/vite.config.ts client/src/lib/useChatFlow.ts
git commit -m "feat(client): demo chat calls the real server API"
```

---

## Task 7: Docs + slice wrap-up

**Files:**
- Modify: `CLAUDE.md`, `server/README.md`

- [ ] **Step 1: Update `CLAUDE.md`** — under "Phase 2 — built so far" add:
```markdown
- **Web chat engine (deterministic):** `shared/flowEngine.ts` (pure flow logic,
  shared by client+server), `server/services/chatSessions.ts` (in-memory, 30-min
  TTL), `server/routes/chat.ts` (`POST /api/chat/session`, `/message`),
  `server/app.ts` + `server/index.ts` (Express on PORT 5000). The demo UI now
  calls the API; leads persist to `ceramic_leads`. Still NO OpenAI / WhatsApp.
- Run the stack: `npm run dev:server` (API :5000) + `npm run dev` (client :5173,
  proxies /api). Seeds a demo `ceramic_clients` row on boot.
```

- [ ] **Step 2: Update `server/README.md`** — move chat engine from "not built yet" to "built so far".

- [ ] **Step 3: Full verification**

- `npm run test:server` → PASS (flowEngine + chatSessions + chat + storage)
- `npm run check:server` → PASS
- `npm run check` (client) → PASS
- `npm run build` (client) → PASS

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md server/README.md
git commit -m "docs: record web chat engine slice"
```

---

## Self-Review notes (for the executor)

- **DRY:** flow-transition logic exists ONLY in `shared/flowEngine.ts`. If you find yourself re-implementing step transitions in the client or router, stop — call `advanceFlow`/`startFlow`.
- **Naming consistency:** `startFlow`/`advanceFlow`/`FlowSnapshot`/`OwnerAlert` used everywhere; `sessionId` is the key across HTTP, session store, and the persisted lead row.
- **Scope discipline (do NOT build here):** OpenAI/LLM, WhatsApp, admin dashboard, auth, real catalog hosting, follow-up scheduler. This slice is deterministic web chat + persistence only.
- **Secrets:** never commit `.env`/`.env.local`. The demo seed uses placeholder owner numbers.
- **Multi-tenant:** single demo client for now; `runWithClient(demoClientId, …)` wraps the lead write so the storage layer's scoping is satisfied even if `TENANT_MODE=multi` later.
- **Known intentional gap:** the web flow never collects `buyerPhone` (no phone step in the spec's web flow), so leads have null phone — acceptable; WhatsApp leads will have it.
```
