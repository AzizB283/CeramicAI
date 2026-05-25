# server/ — Phase 2 (real WhatsApp + web bot)

Phase 2 backend — a fork of the **clinic-connect** stack adapted to ceramics.

**Built so far — data layer:**
- `db.ts` — drizzle client (`db`, `pool`)
- `middleware/tenant.ts` — tenant context (`currentClientId`, `runWithClient`, …)
- `utils/encryption.ts` — AES-256-GCM (v2 format) + peppered `hashPhone`
- `storage.ts` — tenant-scoped CRUD for clients/leads/followups
- `storage.test.ts` — Vitest integration tests

**Built so far — deterministic web chat engine (no OpenAI yet):**
- `app.ts` — Express app factory (+ JSON 500 handler)
- `index.ts` — entrypoint (listens on PORT 5000, seeds the demo client)
- `seed.ts` — idempotent demo `ceramic_clients` row
- `services/chatSessions.ts` — in-memory session store (30-min TTL)
- `routes/chat.ts` — `POST /api/chat/session` + `POST /api/chat/message`;
  persists a lead on terminal, deletes the session to prevent double-insert
- `routes/chat.test.ts` — HTTP integration tests (Supertest + real DB)
- Pure flow logic is shared at `../shared/flowEngine.ts` (used by client + server)

Run: `npm run dev:server` (API :5000) alongside `npm run dev` (client :5173).
Schema lives in `../shared/schema.ts`; migrations in `../migrations/`.
See the repo-root `CLAUDE.md` → "Phase 2 — built so far" and the plans at
`../docs/superpowers/plans/`.

**Not built yet (later slices):** OpenAI/LLM-driven conversation + tools
(`save_ceramic_lead`, `notify_owner`, `send_catalog`), WhatsApp webhook/sender,
follow-up scheduler, admin dashboard.

## What goes here (Phase 2)

Fork `clinic-ai-automation/server/` and adapt:

| clinic-connect file              | CeramicBot change                                            |
| -------------------------------- | ----------------------------------------------------------- |
| `routes/chat/engine.ts`          | Same structure; appointment FSM → inquiry FSM               |
| `routes/chat/dialogueState.ts`   | New states: BUYER_TYPE, PRODUCT, SIZE, QUANTITY, LEAD_CAPTURE, DISTRIBUTOR |
| `routes/chat/prompts.ts`         | Ceramic factory / exporter system prompts (spec §7)         |
| `routes/chat/quickReplies.ts`    | Buyer types, products, sizes, finishes (reuse `shared/flows.ts`) |
| `routes/chat/toolHandlers.ts`    | `save_ceramic_lead`, `notify_owner`, `send_catalog`         |
| `routes/whatsapp/`               | Reuse as-is (same WhatsApp Cloud API)                        |
| `storage.ts`                     | New tables: `ceramic_clients`, `ceramic_leads`, `ceramic_followups` |
| `services/reminders.ts`          | Follow-up sequences (Day 2 / 5 / 10)                        |

The conversation graph in `shared/flows.ts` is the contract: the Phase 1 demo
and the Phase 2 backend walk the same step ids.

See the repo-root `CLAUDE.md` → "Phase 2 roadmap" for the full plan and the
database schema (spec §5).
