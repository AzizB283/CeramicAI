# Gmail Inbox Ingest — Slice 1 ("Read + Ingest + Draft")

**Date:** 2026-06-02
**Feature:** Connect an exporter's Gmail, poll their inbox for buyer inquiries,
turn each into a CRM lead plus an AI-drafted reply shown in the dashboard.
**Source spec:** the v1.0 "CeramicBot Gmail Integration Spec" (Aziz Bhavnagarwala).
This document narrows that two-week spec into the first shippable slice and
corrects its assumptions against the real codebase.

---

## 1. Context & corrections to the source spec

The source spec assumed a from-scratch build but also assumed a clinic-connect
OAuth to copy from. Reality, confirmed by reading the code:

- **The OAuth foundation to reuse exists** at
  `../../clinic-ai-automation/server/google-calendar.ts` (also vendored, gitignored,
  at `Clinic-ai/`): `googleapis@^148`, `google.auth.OAuth2`, a CSPRNG `state`
  stashed on the session and verified with a constant-time compare on callback,
  single-use state, refresh-token-only credential storage, and reliance on
  `googleapis` to auto-refresh access tokens internally (do **not** refresh on
  every call — clinic-connect's "H-B10" lesson).
- **`ceramic_leads.buyer_email` already exists** (added in commit `97f6183`) and
  holds the *buyer's* address, encrypted at rest. The spec's
  `ALTER TABLE ceramic_leads ADD COLUMN buyer_email` is therefore redundant and is
  **dropped**. The only new lead column is `email_thread_id`.
- **OpenAI is fully wired** (`server/services/openaiChat.ts`,
  `entityExtraction.ts`, `openaiAsk.ts`) with a graceful-fallback style we mirror.
- **Outbound email today is Resend** (`server/services/email.ts`, HTTP POST) and is
  used for internal new-lead owner alerts. It stays for alerts. Sending *replies as
  the exporter* will go through the Gmail API — but that is **Slice 2**, not here.
- **No scheduler runs yet.** `storage.getDueFollowups` exists with no driver. We
  add a `node-cron` scheduler in this slice (it will later also be able to drive
  followups).

## 2. Scope

**Slice 1 = Read + Ingest + Draft. No sending.**

**In scope**

- Gmail OAuth: connect / callback / disconnect. Request **all three scopes now**
  (`gmail.readonly`, `gmail.modify`, `gmail.send`) so the exporter consents once,
  but only readonly/modify are *called* this slice.
- `node-cron` poller (every 5 min) → Gmail History API incremental sync → per new
  INBOX message: classify+extract (1 AI call) → if buyer, draft reply (1 AI call)
  → persist an `email_threads` row + auto-create a `ceramic_leads` row.
- Dashboard "Email Inbox" tab: thread list + thread detail (original email,
  extracted fields, **read-only** draft). Gmail connect/disconnect + "Check now"
  in the existing Integrations page.

**Out of scope (Slice 2 — outbound)**

- Sending replies via Gmail (`gmail.send` call), `edited_reply` persistence, the
  "Ignore" action, Day-3/7 follow-ups, the `email_followups` table and its UI.

**Reused as-is**

- clinic-connect OAuth pattern; `server/utils/encryption.ts`
  (`encrypt`/`decrypt`/`isEncrypted`, `v2:` format); `storage`'s
  `scope()`/`withClientId()`/`runWithClient`; the OpenAI client + fallback style;
  `server/services/catalogueMatcher.ts` (to pick the reply's catalog link);
  `server/services/leadNotification.ts` (Resend owner alert on priority leads);
  the existing `ceramic_leads.buyer_email` / `channel` / `session_id` columns.

## 3. Data model

Three new tables in `shared/schema.ts`, following existing conventions (uuid
`client_id` FK, `index()` helpers, `createInsertSchema` + inferred types,
app-layer encryption for secrets only). **Decision: `email_threads` body/from are
stored plaintext**, matching the repo's current PII boundary (`notes`,
`buyer_company` are plaintext today); only OAuth tokens are encrypted.

### `email_connections` — one Gmail account per client (the exporter's inbox)

| column | type | notes |
| --- | --- | --- |
| `id` | uuid PK | `defaultRandom()` |
| `client_id` | uuid FK → `ceramic_clients.id` | **unique** — one connection per client |
| `gmail_address` | text | connected address; plaintext (business identity, shown in UI) |
| `access_token` | text | **encrypted `v2:`** |
| `refresh_token` | text | **encrypted `v2:`** — the durable credential |
| `token_expiry` | timestamp | |
| `history_id` | text | Gmail incremental-sync cursor |
| `last_checked_at` | timestamp | |
| `active` | boolean default true | disconnect toggle |
| `connected_at` | timestamp default now | |

UI follows the existing secrets-write-only pattern (`integrations.tsx`): tokens are
never read back; the UI shows "connected ✓".

### `email_threads` — one row per ingested buyer email

| column | type | notes |
| --- | --- | --- |
| `id` | serial PK | |
| `client_id` | uuid FK | |
| `lead_id` | integer FK → `ceramic_leads.id` | nullable |
| `gmail_thread_id` | text | |
| `gmail_message_id` | text | **unique** — dedupe; never process the same email twice |
| `from_email` | text | |
| `from_name` | text | plaintext |
| `subject` | text | |
| `body_text` | text | plaintext |
| `source_platform` | text | alibaba \| indiamart \| tradeindia \| direct \| website |
| `language` | text | ISO code |
| `generated_reply` | text | the AI draft (no `edited_reply` this slice) |
| `status` | text default `pending_approval` | only `pending_approval` set this slice |
| `received_at` | timestamp default now | |

Indexes: `(client_id)`, `(client_id, status)`, unique on `gmail_message_id`.

### `ceramic_leads` — one new column

- `email_thread_id` integer FK → `email_threads.id`, nullable.
- Reuse existing `buyer_email` (sender address), `channel` (now also `"email"`),
  `session_id` (set to `email_<gmail_message_id>`).

Migration: a new SQL file in `migrations/` (`db:generate` / `db:push`).

## 4. Server modules & data flow

New code under `server/`, mirroring existing layout.

- **`server/services/gmailAuth.ts`** — ported from `google-calendar.ts`.
  `isOAuthConfigured()`, `getAuthUrl(state)` (three scopes; `access_type:'offline'`,
  `prompt:'consent'`), `exchangeCodeForTokens(code)`, `revokeAccess(refreshToken)`,
  `getGmailClientForClient(clientId)` (set credentials with decrypted refresh token,
  return `google.gmail({version:'v1'})`; let `googleapis` auto-refresh). Redirect
  URI derived from a `getBaseUrl()` helper (works in local dev), path
  `/api/admin/email/callback`.
- **`server/services/gmailPoller.ts`** — `pollClient(clientId)`:
  `users.history.list({ startHistoryId, historyTypes:['messageAdded'], labelId:'INBOX' })`;
  for each new message id → `fetchEmailDetails()` (parse From/Subject/body, decode
  base64 parts) → `processEmail()`. **First-ever poll** (no `history_id`) seeds the
  cursor from the latest message id — does **not** backfill the whole mailbox.
  Dedupe via the unique `gmail_message_id` index (catch + skip). Persists new
  `history_id` + `last_checked_at` at the end.
- **`server/services/emailProcessor.ts`** — AI pipeline (existing OpenAI client +
  fallback style).
  - `classifyAndExtract(emailText)` → **1 JSON call** returning
    `{ is_buyer_inquiry, buyer_name, company, country, city, product_category,
    size, finish, quantity, incoterms, destination_port, sample_requested,
    language, source_platform, buyer_type }`. `is_buyer_inquiry === false` → skip
    (no thread, no lead).
  - `generateReply(extracted, client, catalogUrl)` → **1 call**, draft in the
    buyer's language, includes the catalog URL chosen via `catalogueMatcher.ts`,
    quotes no prices, signs off with `client.owner_name`/name. On failure, store a
    deterministic fallback draft so the thread still appears.
- **`server/services/emailIngest.ts`** (or folded into the poller) — persistence:
  insert `email_threads`; auto-create the lead via `storage.createLead`
  (`channel:"email"`, `buyer_email` = sender, `priority:"priority"` when
  `buyer_type === 'distributor'`); link `lead.email_thread_id` ↔ `thread.lead_id`.
  Priority leads trigger the existing Resend owner alert (`leadNotification.ts`).
- **`server/services/emailScheduler.ts`** — `node-cron` `*/5 * * * *`. Lists
  Gmail-connected clients (cross-tenant query, like `getDueFollowups`), then for
  each: `runWithClient(clientId, () => pollClient(clientId))`. Started from
  `server/index.ts`, guarded so tests don't auto-run it. Per-client try/catch so
  one bad inbox can't stall the sweep.
- **`server/routes/email.ts`** — mounted at `/api/admin/email`, behind `requireAuth`.
  - `GET /connect` → Google auth URL (stash CSPRNG state on session)
  - `GET /callback` → constant-time state verify → exchange code → encrypt + store
    tokens + `gmail_address` → redirect to dashboard
  - `GET /status` → `{ connected, gmailAddress, lastCheckedAt }`
  - `DELETE /disconnect` → revoke + delete connection
  - `GET /threads`, `GET /threads/:id` → read-only inbox list + detail
  - `POST /poll` → manual "check now" (demo + tests; wraps `pollClient`)

**Tenant scoping:** the scheduler's "list connected clients" is cross-tenant by
design (mirrors `getDueFollowups`); everything else runs inside
`runWithClient(clientId, …)` so all reads/writes stay scoped through `storage`.

**Data flow:** cron → list connected clients → `runWithClient` → `pollClient` →
`history.list` → fetch new msgs → `classifyAndExtract` (1 call) → if buyer:
`generateReply` (1 call) → insert thread + lead → dashboard reads via `/threads`.

## 5. Dashboard UI

- **New route** `client/src/pages/admin/email-inbox.tsx`, added to the admin nav
  next to Leads/Integrations. Uses existing shadcn/ui + `@tanstack/react-query` +
  `apiRequest`.
  - **Inbox list:** thread cards — country/flag · source · relative time · buyer
    name + company · one-line product/qty summary · priority badge (⚡ PRIORITY for
    distributor). Reads `GET /threads`.
  - **Thread detail** (side panel/modal): original email · extracted fields · the
    generated reply shown **read-only** with a "Sending enabled in next update"
    note. No Send/Edit/Ignore yet. Reads `GET /threads/:id`.
- **Gmail connect/disconnect** in the existing `integrations.tsx` (beside
  WhatsApp): "Connect Gmail" → `GET /connect` redirect; when `GET /status` is
  connected, show "Connected as `<address>` ✓ · last checked `<time>`" + Disconnect;
  a "Check now" button hits `POST /poll`.

## 6. Config / env

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (added to `.env.example`). Redirect URI
  derived from the base-URL helper → `/api/admin/email/callback` (works locally; not
  hardcoded to the Render URL as the source spec did).
- `OPENAI_API_KEY` already wired. `node-cron` added to `server/package.json`.
- **Google Cloud one-time setup** (documented in the plan): enable Gmail API on the
  existing project, add the three scopes to the OAuth consent screen, add the
  exporter as a test user while the app is unverified, create an OAuth client with
  the callback URL.

## 7. Error handling

Matches the repo's "never break the core path" ethos:

- OAuth unconfigured or `OPENAI_API_KEY` missing → feature degrades quietly;
  dashboard shows "not connected", poll no-ops with a logged warning.
- Poll errors are per-client try/caught; a bad inbox logs and is skipped.
- AI failure → store a deterministic fallback draft so the thread/lead still land.
- Duplicate email (unique `gmail_message_id`) → caught and skipped.
- Token refresh is handled by `googleapis`; a hard refresh failure marks the
  connection as needing re-auth, surfaced in `/status`.

## 8. Testing

Vitest, mirroring existing `*.test.ts`; `npm run test:server` (needs `DATABASE_URL`).

- `emailProcessor` — classify+extract JSON parsing, the ignore path, reply
  generation, with a mocked OpenAI (mirrors `openaiChat.test.ts`).
- `gmailPoller` — history parsing, dedupe, first-poll cursor seeding, with a mocked
  Gmail client (no real network).
- `storage` — new email-table CRUD under `runWithClient`; tenant scoping enforced.
- `routes/email` — supertest: connect stashes state; callback rejects state
  mismatch; `/status`, `/threads`, `/poll`; all behind auth.

**Verification bar:** `npm run check:server` + `npm run test:server` green, plus a
manual click-through (connect a test Gmail → send a test inquiry → `POST /poll` →
thread + lead appear in the dashboard).

## 9. Slice 2 preview (not built here)

Outbound: call `gmail.send` to reply as the exporter (lands in their Sent folder +
thread), persist `edited_reply`, the Ignore action, Day-3/7 follow-ups
(`email_followups` table + UI), and wiring the scheduler to also send due
follow-ups. The OAuth consent in Slice 1 already requests `gmail.send`, so no second
consent is needed.
