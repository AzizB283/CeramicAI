# server/ — Phase 2 (real WhatsApp + web bot)

Phase 2 backend — a fork of the **clinic-connect** stack adapted to ceramics.

**Built so far (data layer):**
- `db.ts` — drizzle client (`db`, `pool`)
- `middleware/tenant.ts` — tenant context (`currentClientId`, `runWithClient`, …)
- `utils/encryption.ts` — AES-256-GCM (v2 format) + peppered `hashPhone`
- `storage.ts` — tenant-scoped CRUD for clients/leads/followups
- `storage.test.ts` — Vitest integration tests (run `npm run test:server`)

Schema lives in `../shared/schema.ts`; migrations in `../migrations/`.
See the repo-root `CLAUDE.md` → "Phase 2 — built so far" and the plan at
`../docs/superpowers/plans/2026-05-25-phase2-db-and-storage.md`.

**Not built yet (later slices):** Express routes, chat engine/FSM, OpenAI
prompts/tools, WhatsApp webhook/sender, follow-up scheduler, admin dashboard.

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
