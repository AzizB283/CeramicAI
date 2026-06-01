# CeramicBot

**AI WhatsApp & web chat assistant for ceramic factories and exporters in Morbi, Gujarat — a product by [Aurex Auto](https://aurexauto.com).**

CeramicBot qualifies buyers on WhatsApp and on a factory's website, shares the
right product catalog automatically, captures every lead (encrypted at rest),
and surfaces priority distributor inquiries to the factory owner immediately.
Multi-tenant: one deployment serves many factories.

> **Status:** live, multi-tenant, deployed on Render. The original Phase-1 demo
> grew into a full SaaS — see "What's actually built" below.

---

## What it does

For a buyer messaging a factory:

- The bot identifies whether they're a retailer, distributor, architect, builder,
  or international export buyer — and branches the conversation accordingly.
- It asks the right product questions (category → size + finish, or sanitaryware
  → sub-item) **scoped to what the factory actually sells** (not a generic list).
- It shares the matching catalog PDF (factory or export) the moment the buyer's
  product need is captured.
- It captures the lead — name, phone, email, company, city/country, product
  interest, quantity, Incoterms — and persists it (PII encrypted).
- It flags **distributor / exclusive-rights inquiries as priority** and
  notifies the factory owner immediately.

For Aurex (the operator) and for each factory admin, there are two scoped
admin panels — see "Roles and panels" below.

---

## What's actually built

### Backend (`server/`)

- **Express + TypeScript**, bundled to `dist/server.cjs` by esbuild for prod.
- **PostgreSQL + Drizzle ORM**, migrations auto-applied on boot.
- **Multi-tenant** by `client_id` (factory id). Every tenant-scoped storage
  call runs inside `runWithClient(clientId, …)`; tenant context is enforced
  via `AsyncLocalStorage` and storage-layer guards.
- **DB-backed auth** — `admin_users` table with roles (`superadmin` /
  `factory`), bcrypt(12), express-session backed by Postgres.
- **PII encryption** at rest — AES-256-GCM (v2 ciphertext format) for buyer
  name / phone / email; HMAC-SHA256 phone hash for indexed lookup.
- **WhatsApp Business Cloud API** (Meta Graph v24) — per-tenant credentials
  (encrypted), HMAC signature verification on the raw request body, multi-
  tenant webhook at `/api/whatsapp/:slug`.
- **OpenAI** — LLM-narrated, FSM-anchored chat replies. The deterministic flow
  in `shared/flowEngine.ts` owns state transitions; the LLM only writes the
  words. Falls back to deterministic copy if the API is unavailable.
- **Audit log** of super-admin impersonation + buyer-PII reads
  (`superadmin_actions` table).

### Frontend (`client/`)

- **React 18 + Vite + Tailwind + shadcn/ui**, brand palette: cream / coral / ink.
- **Public marketing site** — `/` (landing), `/features`, `/about`. The live
  bot is **not** linked from public pages (anonymous traffic would burn the
  OpenAI key); the embeddable widget on factory sites uses `/chat?client=<slug>`.
- **Factory admin panel** (`/admin/*`) — dashboard, leads (with edit / delete
  / status / priority / contact info / WhatsApp + mailto links), products
  (per-category sizes / finishes / sanitaryware sub-items), catalogues,
  chat-widget preview + embed snippet, integrations (WhatsApp setup), settings.
- **Super-admin panel** (`/superadmin/*`) — list / create factories with usage
  counts, manage admins, reset passwords (returned once for handoff), suspend /
  reactivate, and **impersonate** a factory's admin panel with a persistent
  banner across `/admin` while impersonating.

### Shared (`shared/`)

- **Conversation flows** + step IDs (`flows.ts`), the deterministic flow engine
  (`flowEngine.ts`), Drizzle schema + Zod insert schemas (`schema.ts`), and
  the `LeadDraft` / `Mode` / `StepId` contracts (`types.ts`).
- The same engine drives both web chat and WhatsApp.

---

## Roles and panels

| Role | URL | Capabilities |
| --- | --- | --- |
| **Super-admin** (Aurex) | `/superadmin` | List/create factories, add admins, reset passwords, suspend, impersonate any factory's panel (audited) |
| **Factory admin** (client) | `/admin` | See/manage their own factory only: leads, products, catalogues, widget, WhatsApp integration, branding |
| **Buyer** (public) | factory's website widget OR WhatsApp | Talks to the bot, leaves a lead |

Login is at `/login`; the server redirects by role after a successful sign-in.
Factory admins cannot reach `/superadmin`; super-admins are routed away from
`/admin` unless they're actively impersonating a factory.

---

## Tech stack

| Layer | Stack |
| --- | --- |
| Server | Node 20+, Express 5, TypeScript (ESM in dev, bundled CJS in prod) |
| DB | PostgreSQL, Drizzle ORM, auto-migrations on boot |
| AI | OpenAI (`CHAT_AI_MODEL`, defaults to `gpt-4o-mini`) |
| Messaging | WhatsApp Business Cloud API (Meta Graph v24) |
| Auth | express-session + connect-pg-simple, bcryptjs, role-aware |
| Client | React 18, Vite, Tailwind, shadcn/ui, wouter, TanStack Query |
| Deploy | Render Blueprint (`render.yaml`) |

---

## Repository layout

```
CeramicBot/
├── client/             React 18 + Vite + Tailwind front end
│   └── src/
│       ├── components/   shared layouts (admin / super-admin / public)
│       ├── pages/        landing, features, about, login, admin/*, superadmin/*
│       ├── hooks/        use-auth (role-aware), use-toast, …
│       └── lib/          queryClient, useChatFlow (drives the live demo)
├── server/             Express + Drizzle backend
│   ├── routes/           chat, auth, admin, superadmin, public, whatsapp/
│   ├── services/         openaiChat, openaiAsk, catalogueMatcher,
│   │                     chatSessions, contactValidation, productConfig,
│   │                     entityExtraction, keepAlive
│   ├── middleware/       tenant context, embed framing
│   ├── utils/            encryption (v2 AES-GCM), phone hashing
│   ├── auth.ts           DB-backed verifyAdmin + role guards + impersonation
│   ├── seed.ts           idempotent bootstrap (super-admin + demo factory)
│   ├── storage.ts        tenant-scoped CRUD + super-admin cross-tenant ops
│   ├── db.ts             pool + runMigrations()
│   └── app.ts            router mounting + JSON 500 handler
├── shared/             contracts shared by client + server
│   ├── schema.ts         Drizzle tables + Zod inserts
│   ├── types.ts          LeadDraft, Mode, StepId, FlowStep, QuickReply
│   ├── flows.ts          factory + exporter conversation graphs
│   └── flowEngine.ts     pure, framework-free flow walker
├── migrations/         0000…0006 (auto-applied on boot)
├── docs/               deploy-render.md, whatsapp-setup.md, plans
├── render.yaml         Render Blueprint
└── CLAUDE.md           full engineering guide for contributors / agents
```

---

## Quick start (local)

```bash
# Prereqs: Node 20+, a Postgres URL, an OpenSSL-generated ENCRYPTION_KEY
cp .env.example .env.local
# fill DATABASE_URL, ENCRYPTION_KEY (64 hex chars), SESSION_SECRET,
# OPENAI_API_KEY (optional — bot degrades to deterministic copy if absent),
# SUPERADMIN_PASSWORD (env is the source of truth on every boot)

npm install
npm run dev          # api on :5000, web on :5173 (Vite proxies /api)
```

Then open <http://localhost:5173>. Log in at `/login` with either:
- **`superadmin`** / your `SUPERADMIN_PASSWORD` → super-admin panel
- **`admin`** / `admin123` (the seeded demo factory admin) → factory panel

The first boot seeds a demo factory (slug `demo`) and a factory-admin user.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run client + server together (Vite on 5173, API on 5000) |
| `npm run dev:client` / `dev:server` | Run them individually |
| `npm run build` | Bundle client + server for production → `dist/` |
| `npm run start` | Run the production bundle (`dist/server.cjs`) |
| `npm run check` | Client TypeScript typecheck |
| `npm run check:server` | Server TypeScript typecheck |
| `npm run test:server` | Vitest — needs `DATABASE_URL` (storage + HTTP integration tests) |
| `npm run db:generate` | Generate a new Drizzle migration from `shared/schema.ts` |
| `npm run db:push` | Push schema straight to the DB (dev only) |

---

## Environment

The critical env vars (see [.env.example](.env.example) for the full list):

| Var | Required | What |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `ENCRYPTION_KEY` | yes | 64 hex chars (`openssl rand -hex 32`) — losing it makes encrypted PII unrecoverable |
| `SESSION_SECRET` | yes | Signs session cookies (`openssl rand -base64 64`) |
| `OPENAI_API_KEY` | no | If unset, bot falls back to deterministic copy |
| `CHAT_AI_MODEL` | no | Defaults to `gpt-4o-mini` |
| `SUPERADMIN_USERNAME` | no | Defaults to `superadmin` |
| `SUPERADMIN_PASSWORD` | recommended | If set, the boot seed **re-syncs** the super-admin password from this value on every restart (env = source of truth). If unset on first boot, a random password is printed once to the log |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | no | Demo factory-admin (defaults `admin` / `admin123`) |
| `TENANT_MODE` | no | `single` (dev default) or `multi` (enforces `runWithClient` on every storage call) |
| `PORT` | no | Defaults to 5000 |

---

## Deploy

Render Blueprint is wired in [`render.yaml`](render.yaml). A push to the
production branch:

1. Builds the client + server (`npm run build`).
2. Applies pending Drizzle migrations on boot (idempotent — safe to run every start).
3. Seeds the super-admin from `SUPERADMIN_PASSWORD` env (creates on first boot,
   re-syncs the password on every subsequent boot if it differs).
4. Serves the bundled client + API from a single Node process.

Full Render guide: [`docs/deploy-render.md`](docs/deploy-render.md).
WhatsApp wiring guide for a factory: [`docs/whatsapp-setup.md`](docs/whatsapp-setup.md).

---

## Embedding the bot on a factory's website

After a factory is created, super-admin opens its panel and grabs the embed
code from **Chat Widget**. The script + iframe both pass the factory's slug:

```html
<!-- Floating button -->
<script src="https://your-host/widget.js" data-client="shree-tiles" defer></script>

<!-- Or an iframe -->
<iframe src="https://your-host/chat?client=shree-tiles"
        style="width:400px;height:600px;border:none;border-radius:16px"></iframe>
```

The widget reads per-factory branding (name, color, greeting) from
`/api/public/widget-config?client=<slug>` and the chat session pins itself to
that tenant.

A suspended factory's bot returns a neutral "service unavailable" message on
both channels (web + WhatsApp).

---

## Contributing / agents

- Architecture, conventions, and historical phase plan: **[`CLAUDE.md`](CLAUDE.md)**.
- Product spec (copy, pricing, pitch): **`CeramicBot_Build_Spec_AurexAuto.docx`**.
- Implementation plans: **[`docs/superpowers/plans/`](docs/superpowers/plans/)**.

Tests live next to the code they cover (`*.test.ts`). Run with
`npm run test:server` (needs `DATABASE_URL`).
