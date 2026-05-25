# CeramicBot — CLAUDE.md

AI WhatsApp & web chat bot for **ceramic factories & exporters** in Morbi, Gujarat.
A product by **Aurex Auto** (aurexauto.com). Built on the same engine as the
sibling project **clinic-connect** (`../clinic-ai-automation`, aka DentalAI),
re-purposed from appointment booking to B2B buyer qualification + lead capture.

Full product spec: `CeramicBot_Build_Spec_AurexAuto.docx` (repo root). Read it for
conversation copy, pricing, and pitch — this file is the engineering guide.

---

## Two phases — know which one you're in

This project ships in two phases. **Phase 1 is built; Phase 2 is in progress (the data layer has landed).**

| Phase | What it is | Stack | Where |
| --- | --- | --- | --- |
| **Phase 1 — Web demo (DONE)** | Frontend-only chat simulation to win the first 2–3 clients. No backend, no WhatsApp, no DB. Hardcoded flow graph. | React 18 + Vite + Tailwind | `client/` + `shared/` |
| **Phase 2 — Real bot (IN PROGRESS)** | Real WhatsApp + web bot, multi-tenant. Forking clinic-connect. **Built so far: DB + storage layer, and a deterministic web chat engine (demo → real server → DB).** | Node + Express + Postgres + Drizzle + OpenAI + WhatsApp Cloud API | `server/` + `shared/` |

> **Default assumption:** the Phase 1 demo UI (`client/`) is preserved, but it
> now calls the real server (`/api/chat/*`) when the server is running. Phase 2
> work lives in `server/` + `shared/`. **OpenAI/LLM and WhatsApp are still NOT
> built** — the chat is deterministic (replays `shared/flows.ts`). Don't add the
> LLM or WhatsApp speculatively; they are later slices.

### Phase 2 — built so far

**Data layer**
- **Schema:** `shared/schema.ts` defines `ceramic_clients` / `ceramic_leads` /
  `ceramic_followups` (spec §5). SQL migration in `migrations/`.
- **`server/db.ts`** — drizzle client (`db`, `pool`).
- **`server/middleware/tenant.ts`** — tenant context (clinic→**client** rename):
  `currentClientId()`, `getTenantMode()`, `runWithClient(id, fn)`, `tenantContext`.
- **`server/utils/encryption.ts`** — AES-256-GCM (`v2:` versioned format, ported
  from clinic-connect) for buyer PII + peppered `hashPhone` for indexed lookup.
- **`server/storage.ts`** — tenant-scoped CRUD for clients/leads/followups. Every
  scoped query uses `scope()`; every write uses `withClientId()`. Buyer name/phone
  encrypted at rest; `getDueFollowups` is intentionally cross-tenant (scheduler).

**Web chat engine (deterministic — no OpenAI yet)**
- **`shared/flowEngine.ts`** — pure flow logic (`startFlow`/`advanceFlow` →
  `FlowSnapshot`), shared by client + server. **Single source of truth for
  transitions** — edit flow behavior here, never re-implement it in the client or
  router. `FlowSnapshot.startOver` signals a "Start over" reset.
- **`server/services/chatSessions.ts`** — in-memory session store, 30-min TTL.
- **`server/routes/chat.ts`** — `POST /api/chat/session` + `POST /api/chat/message`.
  Advances the flow; on a terminal step persists a `ceramic_leads` row (then deletes
  the session so a replay can't double-insert).
- **`server/app.ts`** (Express app + JSON 500 handler) + **`server/index.ts`**
  (listens on PORT 5000, seeds a demo `ceramic_clients` row via `server/seed.ts`).
- **Client:** `client/src/lib/useChatFlow.ts` now calls `/api/chat/*` (Vite dev
  proxy forwards `/api` → :5000). The demo UI (`App.tsx`/components) is unchanged.

**Run the full stack (two terminals, from repo root):**
`npm run dev:server` (API on :5000, seeds the demo client) and `npm run dev`
(client on :5173, proxies `/api`). Walk the demo → a lead lands in `ceramic_leads`.

**Server commands (from repo root):** `npm run check:server` (typecheck),
`npm run test:server` (Vitest; needs `DATABASE_URL` — runs storage + flowEngine +
session + chat-HTTP tests), `npm run db:generate` / `npm run db:push`. Set
`DATABASE_URL` and a 64-hex-char `ENCRYPTION_KEY` in `.env.local` (gitignored) —
see `.env.example`.

**Tenancy model:** `TENANT_MODE=single` (default) leaves reads unscoped (one
client). `TENANT_MODE=multi` enforces `scope()`/`withClientId()` — every storage
call must run inside `runWithClient(clientId, fn)` or it throws.

**Plans:** `docs/superpowers/plans/2026-05-25-phase2-db-and-storage.md`,
`docs/superpowers/plans/2026-05-25-phase2-web-chat-engine.md`.

---

## Repository layout

```
CeramicBot/
├── client/                 # Phase 1 web demo (Vite + React + Tailwind)
│   ├── index.html
│   ├── vite.config.ts      # aliases: @ → src, @shared → ../shared
│   ├── tailwind.config.ts  # Aurex Auto palette (cream / coral / ink)
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                  # layout, mode toggle, chat window, footer
│       ├── index.css                # Tailwind + Poppins
│       ├── lib/
│       │   ├── useChatFlow.ts       # the demo "engine" — drives the conversation
│       │   └── utils.ts             # cn()
│       └── components/
│           ├── MessageBubble.tsx
│           ├── QuickReplies.tsx     # reply chips
│           ├── Composer.tsx         # free-text input
│           ├── TypingDots.tsx
│           └── OwnerAlertPanel.tsx  # simulated owner WhatsApp alert
├── shared/                 # contracts used by BOTH phases
│   ├── types.ts            # Mode, FlowStep, LeadDraft, StepId, ChatMessage
│   └── flows.ts            # factory + exporter conversation graphs (from spec §3)
├── server/                 # Phase 2 backend — empty stub + README for now
├── package.json            # npm workspaces root (client, server)
├── tsconfig.json           # solution config → references client
└── CeramicBot_Build_Spec_AurexAuto.docx
```

The monorepo (`client/` `server/` `shared/`) mirrors clinic-connect so Phase 2
slots in next to Phase 1 with no restructuring.

---

## Commands

Run from the repo root (npm workspaces):

| Command | What it does |
| --- | --- |
| `npm install` | Install all workspace deps |
| `npm run dev` | Start the demo (Vite dev server on **http://localhost:5173**) |
| `npm run build` | Typecheck + production build → `client/dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run check` | TypeScript typecheck only (no emit) |

Verified working: `npm install`, `npm run check`, `npm run build`, `npm run dev`
all pass on Node 20+ (developed on Node 24).

**Always run `npm run check` before claiming a change works.** There are no tests
yet; the typecheck + a manual click-through is the verification bar.

---

## How the Phase 1 demo works (the "engine")

There is **no AI and no backend** in Phase 1. The conversation is a deterministic
walk through a hardcoded graph.

1. **`shared/flows.ts`** defines two `FlowStep[]` graphs — `factory` and
   `exporter` — transcribed verbatim from spec §3. Each step has bot copy, an
   input kind (`choice` | `text`), quick-reply options, the lead field it fills,
   and the next step id.
2. **`shared/types.ts`** defines the shapes. `StepId`s deliberately match the FSM
   state names in the spec (`BUYER_TYPE`, `PRODUCT`, `SIZE`, `QUANTITY`,
   `LEAD_CAPTURE`, `DISTRIBUTOR`, …) so this graph is also the Phase 2 contract.
3. **`client/src/lib/useChatFlow.ts`** is the runtime: holds the message thread,
   current step, accumulated `LeadDraft`, typing indicator, and the simulated
   owner alert. Advancing a step = look up `next` in `STEPS` and play its bubbles.
4. **`OwnerAlertPanel`** renders the "🔔 New Lead / 🚨 PRIORITY LEAD" WhatsApp
   alert when a terminal step is reached (spec §3.1 step 6 / §3.2 step 6).

### To change conversation copy or flow
Edit `shared/flows.ts` — **not** the components. Adding a step = add a `FlowStep`,
give it a `StepId` (add to the union in `types.ts`), and point some `next`/option
at it. The UI renders any well-formed step automatically.

### Two modes
The header toggle switches `factory` ↔ `exporter`, which restarts the thread at
that mode's entry step. Factory = domestic buyer qualification. Exporter = intl.
buyer with sample-request and **priority distributor** branches.

---

## Conventions (match these)

Mirrors clinic-connect so the two codebases feel the same.

- **TypeScript strict**, ESM (`"type": "module"`), 2-space indent, double quotes,
  semicolons, trailing commas.
- **Naming:** components `PascalCase`, files for components `PascalCase.tsx`,
  hooks/util files `camelCase.ts`, functions/vars `camelCase`, types `PascalCase`.
- **Imports:** `@/…` → `client/src`, `@shared/…` → `shared/`. Use the aliases,
  not long relative paths.
- **Styling:** Tailwind utility classes. Brand tokens live in `tailwind.config.ts`
  — use `cream`, `coral`, `ink` (and `coral-dark`, `cream-deep`, `ink-soft`).
  Don't hardcode hex values in components. Font is **Poppins** (spec).
- **Brand colors:** cream `#faf3e7` bg, coral `#e85d04` accent (the spec's default
  `widget_color`), dark `#2b2b2b` ink. Bot bubbles dark, user bubbles coral.
- **Keep the demo dependency-light.** No backend, no router, no state library
  needed for Phase 1. `framer-motion` is available but CSS animations are fine.

---

## Phase 2 roadmap — forking clinic-connect

When the user says "start Phase 2" / "build the real bot": fork
`../clinic-ai-automation` into `server/` and adapt. **Reuse the engine; swap the
domain.** Do not rebuild from scratch.

### Stack (identical to clinic-connect)
Node + Express 5 + TypeScript · PostgreSQL + Drizzle ORM · OpenAI GPT-4o-mini ·
WhatsApp Business Cloud API (Meta Graph API) · React 18 + Vite + Tailwind +
shadcn/ui · session auth (express-session + connect-pg-simple) · deploy on Render.

### Component mapping (spec §4.1)

| clinic-connect (`../clinic-ai-automation/server/`) | CeramicBot change |
| --- | --- |
| `routes/chat/engine.ts` | Same structure; appointment FSM → **inquiry** FSM |
| `routes/chat/dialogueState.ts` | New states: BUYER_TYPE, PRODUCT, SIZE, QUANTITY, LEAD_CAPTURE, DISTRIBUTOR |
| `routes/chat/prompts.ts` | Ceramic factory / exporter system prompts (spec §7) |
| `routes/chat/quickReplies.ts` + `stateChips.ts` | Buyer types, products, sizes, finishes — reuse `shared/flows.ts` data |
| `routes/chat/toolHandlers.ts` + `tools.ts` | New tools: `save_ceramic_lead`, `notify_owner`, `send_catalog` |
| `routes/whatsapp/` (index + service) | **Reuse as-is** — same WhatsApp Cloud API |
| `storage.ts` | New tables (below); same tenant-scoping pattern via `currentClinicId()` |
| `services/reminders.ts` | Follow-up sequences Day 2 / 5 / 10 (spec §3.3) |
| Admin dashboard | Simplify: drop doctors/calendar/voice; add lead list + catalog URL editor |
| `clinics` multi-tenant root | `ceramic_clients` — same pattern, different domain |

### New database tables (spec §5) — `shared/schema.ts` in Phase 2
- **`ceramic_clients`** — tenant root (one per factory/exporter). `mode`
  (factory|exporter), `owner_whatsapp`, `catalog_url`, `export_catalog_url`,
  per-client WhatsApp creds (encrypted), widget branding.
- **`ceramic_leads`** — one per buyer inquiry. buyer type/name/phone/company/
  country/city, product category/size/finish, quantity, incoterms,
  `is_distributor_inquiry`, `priority` (normal|high|priority), status.
- **`ceramic_followups`** — scheduled Day 2/5/10 messages per lead.

### Phase 2 build order (spec §6.3)
1. Fork clinic-connect → `server/` (and replace its `client/` dashboard or merge).
2. Swap schema: clinic tables → `ceramic_clients` / `ceramic_leads` / `ceramic_followups`.
3. Replace FSM states in `dialogueState.ts` with ceramic inquiry states.
4. Replace `prompts.ts` with ceramic factory/exporter prompts (spec §7).
5. Replace tool handlers: `save_ceramic_lead`, `notify_owner`, `send_catalog`.
6. Simplify admin dashboard (no doctors/calendar/voice); add lead view + catalog editor.
7. Register client WhatsApp Business API, configure webhook, test end-to-end.
8. Deploy to Render with per-client env vars.

> The `shared/` flow graph and `LeadDraft` shape are the bridge between phases —
> the Phase 1 demo and the Phase 2 backend walk the **same step ids**. Keep them
> in sync rather than forking the conversation definition.

---

## Domain glossary (so copy stays correct)

- **Modes:** *Factory* = domestic buyer qualification; *Exporter* = international.
- **Buyer types:** retailer, distributor, architect, builder, export, general.
- **Products:** Ceramic Wall, GVT/Vitrified, PGVT, Double Charge, Slab, Sanitaryware.
- **Sizes:** 300×600, 600×600, 800×800, 1200×600, 1200×1200.
- **Incoterms:** FOB Mundra, CIF (destination port), Ex-Works.
- **Priority lead:** a distributor / exclusive-rights inquiry → immediate owner
  alert (not batched). This is the highest-value path — never bury it.
- **Catalog:** per-client PDF link. In the demo these are placeholders in `flows.ts`.
- **Owner alert:** the WhatsApp message the factory owner / export manager gets
  when a lead is captured. The demo simulates it visually (`OwnerAlertPanel`).

## Working agreements
- Pitch is *outcome*, not "AI chatbot" (spec §8.2). Keep UI copy plain and
  trustworthy; many users read Hindi/Gujarati. Don't over-engineer the demo.
- Don't quote prices in bot copy — "sales team will contact with pricing" (spec §7).
- Before deploying the demo publicly (Vercel/Netlify), confirm with the user;
  it's outward-facing and tied to the Aurex Auto brand.
