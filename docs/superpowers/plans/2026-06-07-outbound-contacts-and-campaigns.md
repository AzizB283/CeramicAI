# Outbound — Contacts, Segments & Campaigns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each exporter an outbound engine — import a prospect list from CSV, organise contacts into segments (by country / buyer type / source / custom tags), and run personalized **email** campaigns (via the client's already-connected Gmail) and compliant **WhatsApp** campaigns (Meta-approved templates + 24-hour re-engagement) that attach the right catalogue. Replies flow back into the **existing** inbox + bot-draft engine, closing the outbound→reply loop. Includes unsubscribe / suppression, drip rate-limiting, and per-campaign delivery reporting.

**Why:** Exporters told us inbound is a trickle; growth is outbound + retention. The hard plumbing (Gmail OAuth with `gmail.send` scope, Resend, WhatsApp Cloud API, `node-cron` scheduler, OpenAI personalization, catalogues, leads) already exists. This plan adds the address book and campaign layer on top — it does not rebuild any channel.

**Spec:** `CeramicBot_Build_Spec_AurexAuto.docx` §8 (outbound is an extension; no dedicated spec section yet — this plan is the design of record).

---

## Decisions locked (from product brainstorm 2026-06-07)

1. **Email sending path = the client's own connected Gmail** (`email_connections`), NOT Resend.
   - Pros: best deliverability, and replies land in the exporter's real inbox → flow into the existing `gmailPoller` → `email_threads` → bot-draft loop for free.
   - Constraint: Gmail caps ~500 sends/day/account. The campaign engine **must drip-send** and track a daily quota per connection. Resend stays for *owner alerts* only.
2. **WhatsApp outbound = compliant only.** Business-initiated sends use **Meta-approved template messages**; free-form is allowed **only** inside a live 24-hour customer service window. No raw blasting (it gets the client's number banned). Templates are synced from Meta's approved list.
3. **Contacts are a first-class table, separate from `ceramic_leads`.** An imported prospect ≠ a buyer who chatted. Leads can be *promoted* into contacts (e.g. when they go quiet) so inbound + outbound share one address book.
4. **Scope this slice to: Contacts + CSV import + Segments + Email campaigns + reply-loop wiring + unsubscribe.** WhatsApp template campaigns and win-back sequences are designed in the schema here but built as a **follow-up slice** so email ships first.

### Brainstorm decisions locked (2026-06-07, round 2)

These shape the **schema we write now** even where the behavior ships in a later slice — so Slice A's tables don't need rework:

5. **Campaigns are multi-touch sequences, not one-shot blasts.** A campaign owns ordered *steps* (Day 0 / +3 / +7 …), each with its own subject/body/catalogue, and the whole sequence **auto-stops the moment a contact replies**. Reuses the `ceramic_followups` scheduling concept pointed at outbound. → `ceramic_campaign_steps` table + recipients track which step they're on.
6. **Reply-intent triage is the headline output.** Every campaign reply is LLM-classified into `sample_request | hot | lukewarm | not_now | wrong_person | unsubscribe`. The report leads with **hot/sample counts, not raw replies.** → `replyIntent` on `ceramic_campaign_recipients`; reuses `openaiChat` + existing ingest.
7. **Catalogues go out as tracked links** (hosted redirect), not just raw attachments — an open is a buying signal that bumps the contact up the call list and dodges Gmail attachment-size limits. → `ceramic_tracked_links` + `GET /r/:token` redirect route.
8. **Dormant-buyer detector** nominates the audience automatically: a scheduled job flags buyers/contacts not contacted in N days into a "win-back" segment. → mostly a query + cron job; `lastContactedAt` already on contacts/leads.
9. **CSV importer ships with platform presets** for **IndiaMART, Alibaba, and TradeIndia** export formats (auto-detect + offer the mapping) on top of generic auto-mapping. → preset map lives in `csvImport.ts`; no schema impact.
10. **North-star metric = sample request.** A reply classified `sample_request` **auto-creates a high-priority `ceramic_leads` row and fires the existing owner alert.** The funnel and the report both bend toward this event, not toward "opens" or raw "replies".

---

## Conventions (read before starting)

- ESM, TS strict, 2-space indent, double quotes, semicolons, trailing commas.
- Imports use `@shared/…` for `shared/`; relative paths inside `server/`.
- Encryption: `encrypt` / `decrypt` / `isEncrypted` from `server/utils/encryption.ts` (`v2:` format). OAuth tokens are encrypted; contact name/phone are **buyer PII** → encrypt at the app layer like `ceramic_leads.buyerName/buyerPhone`, with a peppered `hashPhone` for indexed lookup/dedupe. Contact email follows the same PII boundary as `buyerEmail` (encrypted), but keep a lowercased `email_hash` for dedupe + suppression matching.
- Tenant scoping: storage reads use `scope(col)`, writes use `withClientId(values)`. Non-HTTP callers wrap work in `runWithClient(clientId, fn)`.
- Routes behind `requireAuth`; resolve the operating client with the `resolveClient(req, res)` helper from `server/routes/admin.ts`.
- Server commands from repo root: `npm run check:server`, `npm run test:server` (needs `DATABASE_URL` + 64-hex `ENCRYPTION_KEY`), `npm run db:generate`, `npm run db:push`.
- Reuse, don't rebuild: `gmailAuth.gmailClientFromRefreshToken()`, the `node-cron` scheduler shape in `emailScheduler.ts`, `catalogueMatcher.ts`, `openaiChat.ts` for personalization, WhatsApp `service.ts` for the template send.

---

## Architecture

```
CSV upload ─► preset/auto column-map ─► parse+validate ─► ceramic_contacts (dedupe by email_hash/phone_hash)
  (IndiaMART/Alibaba/TradeIndia presets)                          │
                                            ceramic_segments (country/buyerType/source/tags)
                                                                  │            ▲
                                  ceramic_campaigns ──owns──► ceramic_campaign_steps (Day 0/+3/+7)
                                                                  │            │ dormant-buyer
   campaignScheduler (node-cron, drip + quota + send-time) ──────┤            │ detector job
        │  renders step (LLM personalize) + tracked catalogue link            │ nominates audience
        ▼                                                                     │
   Gmail send ─► ceramic_campaign_recipients (queued►sent, currentStep)       │
        │                                                                     │
   buyer opens tracked link ─► ceramic_tracked_links hit ─► engagement signal │
        │                                                                     │
   buyer replies ─► existing gmailPoller ingest ─► attribute to recipient ────┘
        │            └─► LLM reply-intent triage ─► replyIntent set
        ▼                     │
   sequence AUTO-STOPS        └─ if sample_request ─► auto-create PRIORITY lead + owner alert (north star)
```

- **Drip engine:** a new `campaignScheduler` cron (every 1–2 min) pulls a bounded batch of `queued` recipients whose campaign is `sending`, respects the per-connection daily Gmail quota, sends, marks `sent`. Mirrors `emailScheduler.ts` exactly (cross-tenant list → `runWithClient` per client → per-recipient try/catch so one bad address can't stall the batch).
- **Reply attribution:** stamp an `X-Ceramic-Campaign: <recipientId>` header (and/or a `+campaign` plus-address) on outbound so the existing `gmailPoller` ingest can map an inbound reply back to a `ceramic_campaign_recipients` row → flip it to `replied` and surface it on the campaign report. (Ingest wiring is a small additive change, not a rewrite.)
- **Unsubscribe:** every email gets a `List-Unsubscribe` header + a footer link to `GET /api/public/unsubscribe?t=<signed-token>`. A hit writes `ceramic_suppressions` (email_hash, clientId, reason) and the drip engine skips any suppressed contact.

---

## File structure

**Create:**
- `server/services/csvImport.ts` — parse + normalise + validate CSV rows → contact drafts; generic column auto-mapping **+ platform presets (IndiaMART / Alibaba / TradeIndia)** that auto-detect the export's header signature and pre-fill the mapping; per-row error report. Dedupe within the file and against existing contacts.
- `server/services/trackedLinks.ts` — mint a signed token for a (catalogue, recipient) pair; resolve + count hits behind `GET /r/:token`.
- `server/services/dormantDetector.ts` — scheduled query that refreshes the `auto:winback` segment (Slice B3).
- `server/services/segments.ts` — turn a segment's rule JSON into a Drizzle `where` over `ceramic_contacts`; `previewSegment()` (count + sample) and `resolveSegment()` (full id list for a campaign).
- `server/services/campaignSender.ts` — render a template for one contact (LLM personalization + token substitution), pick the catalogue (`catalogueMatcher`), build + send the Gmail message **with PDF attachment**, or the WhatsApp template; returns a per-recipient result.
- `server/services/campaignScheduler.ts` — node-cron drip sweep with per-connection daily quota.
- `server/services/gmailSend.ts` — **extends** `gmailAuth`: a non-threaded `sendGmailMessage()` that supports a `multipart/mixed` body with one PDF attachment + custom headers (`List-Unsubscribe`, `X-Ceramic-Campaign`). (Keep `sendGmailReply` as-is for the inbox.)
- `server/routes/contacts.ts` — `/api/admin/contacts/*` (list, get, CSV import, create/update, promote-lead, suppress).
- `server/routes/campaigns.ts` — `/api/admin/campaigns/*` (segments CRUD + preview, campaign CRUD, send/pause, report).
- `server/routes/public-unsubscribe.ts` (or extend `server/routes/public.ts`) — `GET /api/public/unsubscribe`.
- Tests: `csvImport.test.ts`, `segments.test.ts`, `campaignSender.test.ts`, `campaignScheduler.test.ts`, `routes/contacts.test.ts`, `routes/campaigns.test.ts`.
- `client/src/pages/admin/contacts.tsx` — contact list, filters, CSV import wizard (upload → column-map → preview → confirm).
- `client/src/pages/admin/campaigns.tsx` — segment builder + campaign composer (channel, segment, catalogue, template editor with `{{name}}` tokens + AI-personalize toggle, schedule) + per-campaign report.

**Modify:**
- `shared/schema.ts` — add the six tables below + insert schemas/types.
- `shared/types.ts` — `SegmentRule`, `CampaignChannel`, `RecipientStatus`, CSV column-map types shared client↔server.
- `server/storage.ts` — CRUD for the new tables; `listEmailConnectedClients()` is reused; add `getDailySendCount(connectionId)` and suppression lookup.
- `server/services/emailIngest.ts` — on ingest, check for the campaign header / plus-address and attribute the reply to a recipient.
- `server/app.ts` — mount `contactsRouter`, `campaignsRouter`, unsubscribe route.
- `server/index.ts` — start `campaignScheduler` (guarded like `emailScheduler`).
- `client/src/App.tsx` (+ admin nav) — add Contacts + Campaigns routes/nav items.
- `.env.example` — `CAMPAIGN_DAILY_GMAIL_CAP` (default 400, headroom under Gmail's 500), `UNSUBSCRIBE_SECRET`.

---

## New tables (`shared/schema.ts`)

1. **`ceramic_contacts`** — address book. `clientId`, `name`(enc), `email`(enc)+`emailHash`, `phone`(enc)+`phoneHash`, `company`, `country`, `city`, `buyerType`, `source` (csv | lead | manual | tradeshow…), `tags` (jsonb string[]), `leadId` (nullable FK — set when promoted from a lead), `optedOut` (bool), `lastContactedAt`, timestamps. Indexes: `(clientId)`, `(clientId, emailHash)`, `(clientId, phoneHash)`, `(clientId, country)`, `(clientId, buyerType)`.
2. **`ceramic_contact_imports`** — one row per CSV upload (filename, rowsTotal, rowsImported, rowsSkipped, errorReport jsonb, importedBy, createdAt) for an audit trail + "undo last import".
3. **`ceramic_segments`** — saved filter. `clientId`, `name`, `rule` (jsonb: `{country?, buyerType?, source?, tags?, optedOut:false}`), `createdAt`. Resolved live (not materialised) so it stays fresh as contacts are added.
4. **`ceramic_campaigns`** — `clientId`, `name`, `channel` (email | whatsapp), `segmentId`, `aiPersonalize` (bool), `status` (draft | scheduled | sending | paused | done), `scheduledAt`, `stats` jsonb (queued/sent/opened/replied/hot/**sampleRequests**/failed/unsub — denormalised for the report; sample requests headlined), timestamps. **Subject/body/catalogue live on the steps, not here** (a campaign is a sequence).
5. **`ceramic_campaign_steps`** — ordered touches in a sequence. `campaignId`, `clientId`, `stepIndex` (0,1,2…), `delayDays` (0, 3, 7 — offset from the previous step / enrollment), `subject`, `bodyTemplate` (`{{token}}`s; may have buyer-type variants later), `catalogueId` (nullable FK), `whatsappTemplateName` (nullable, slice C). A one-shot blast is just a campaign with a single step. Index `(campaignId, stepIndex)`.
6. **`ceramic_campaign_recipients`** — one per contact per campaign (not per step). `campaignId`, `clientId`, `contactId`, `currentStep` (which step they're on), `status` (queued | sending | active | sent_all | **replied** | bounced | unsubscribed | failed), `replyIntent` (null | sample_request | hot | lukewarm | not_now | wrong_person | unsubscribe), `nextSendAt` (when the next step is due), `renderedSubject` / `renderedBody` (audit of the **last** send), `gmailMessageId` / `waMessageId`, `error`, `lastSentAt`, `repliedAt`. A reply sets `status='replied'` → the scheduler skips it forever (**auto-stop**). Indexes: `(campaignId, status)`, `(clientId)`, `(contactId)`, `(status, nextSendAt)` for the due-step sweep.
7. **`ceramic_tracked_links`** — `clientId`, `recipientId` (nullable), `campaignId` (nullable), `catalogueId` (nullable), `token` (unique, signed), `targetUrl`, `hitCount`, `firstHitAt`, `lastHitAt`, `createdAt`. A hit on `GET /r/:token` increments and 302s to `targetUrl`; ≥1 hit is the catalogue-open engagement signal that bumps the contact up the call list.
8. **`ceramic_suppressions`** — `clientId`, `emailHash` (and/or `phoneHash`), `reason` (unsubscribe | bounce | manual | complaint), `createdAt`. Unique on `(clientId, emailHash)`. The drip engine left-joins this to skip suppressed contacts.

> The dormant-buyer detector needs **no new table** — it's a scheduled query over `ceramic_contacts`/`ceramic_leads` `lastContactedAt`/`createdAt` that writes (or refreshes) a system-owned `ceramic_segments` row tagged `auto:winback`.

> Note: store `bodyTemplate`/`renderedBody`/`subject` as plaintext (business content, same boundary as `email_threads.bodyText`). Only contact PII (name/email/phone) is encrypted.

---

## Build order (slices)

**Slice A — Address book (ship first, fully usable alone):**
1. Schema: `ceramic_contacts`, `ceramic_contact_imports`, `ceramic_suppressions` (+ migration via `db:generate`).
2. `storage.ts` CRUD + dedupe-by-hash + suppression lookup.
3. `csvImport.ts` + `routes/contacts.ts` (upload → map → preview → commit; promote-lead; manual add; suppress).
4. `client/src/pages/admin/contacts.tsx` — list, filters, CSV wizard. **Deliverable:** exporter can import & browse their prospect list grouped by country/buyer-type/tag.

**Slice B — Segments + single-step email campaigns + tracked links + reply triage:**
5. Schema: `ceramic_segments`, `ceramic_campaigns`, `ceramic_campaign_steps`, `ceramic_campaign_recipients`, `ceramic_tracked_links`.
6. `segments.ts` (preview/resolve) + `gmailSend.ts` (send) + `trackedLinks.ts` (mint token, `GET /r/:token` redirect+count) + `campaignSender.ts` (personalize + tracked catalogue link + send) + `campaignScheduler.ts` (drip + quota + send-time-by-country).
7. `routes/campaigns.ts` + unsubscribe route + `emailIngest.ts` reply attribution **+ reply-intent triage** (LLM classify → `replyIntent`; on `sample_request` auto-create priority lead + owner alert).
8. `client/src/pages/admin/campaigns.tsx` — segment builder, composer (single step for now), report **headlining sample-requests + hot replies + opens**. **Deliverable:** exporter selects "Gulf distributors", attaches the new GVT catalogue (tracked), AI-personalizes, sends a drip campaign, watches opens/replies/**sample-requests** update, and a sample-request becomes a priority lead with an owner alert.

**Slice B2 — Multi-touch sequences:** turn the single step into ordered `ceramic_campaign_steps` (Day 0/+3/+7); scheduler advances `currentStep`/`nextSendAt`; **auto-stop on reply**; composer gains add-step UI.

**Slice B3 — Dormant-buyer detector:** scheduled query → refresh the `auto:winback` segment; surface "23 buyers not contacted in 90d → start win-back" in the UI.

**Slice C — WhatsApp templates (follow-up plan):**
9. Sync Meta-approved templates → `whatsapp_templates`; gate sends to approved templates / 24h window; WhatsApp path in `campaignSender` (channel fallback: WhatsApp if phone present, else email).

---

## Risks & guardrails (do not skip)

- **Domain/number reputation is the client's, not ours.** Unsubscribe + suppression + drip rate-limiting are not optional — they're the feature that makes outbound safe. Build them in Slice B, not "later".
- **Gmail daily cap.** Hard-stop the drip at `CAMPAIGN_DAILY_GMAIL_CAP`; a campaign larger than the cap spans multiple days automatically (recipients stay `queued`). Surface "X/400 sent today" in the UI.
- **WhatsApp:** never send free-form business-initiated. Only approved templates or inside 24h. The sender must refuse otherwise.
- **PII:** imported contacts are buyer PII. Encrypt name/email/phone at rest exactly like leads; never log decrypted values.
- **Idempotency:** the drip engine claims a recipient (status `queued`→`sending`) before the network call so a scheduler overlap can't double-send; on success → `sent`, on failure → `failed` with the error.

---

## Verification bar

- `npm run check:server` clean.
- `npm run test:server` green, including: CSV parse/dedupe/error-report, segment rule → where, personalization token substitution, drip quota stop, suppression skip, reply attribution, and the route happy-paths (auth + tenant-scoped).
- Manual: import a 20-row CSV (try an IndiaMART export → preset auto-detected) → build a segment → send an email campaign to a test address with a **tracked** catalogue link → open the link (recipient shows an engagement signal) → reply "please send samples" → recipient flips to `replied` with `replyIntent=sample_request`, a **priority lead is auto-created**, the **owner alert fires**, and the bot drafts a response in the existing inbox.
