import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import type { Mode, LeadDraft, StepId } from "@shared/types";
import type { InsertCeramicLead } from "@shared/schema";
import { advanceFlow, type FlowSnapshot } from "@shared/flowEngine";
import { ENTRY } from "@shared/flows";
import { storage } from "../../storage";
import { runWithClient } from "../../middleware/tenant";
import { decrypt } from "../../utils/encryption";
import {
  sendTextMessage,
  markMessageAsRead,
  sendQuickReplyMessage,
} from "./service";
import {
  generateBotReply,
  type ChatHistoryTurn,
} from "../../services/openaiChat";
import { pickCatalogue } from "../../services/catalogueMatcher";

/**
 * WhatsApp Business Cloud API webhook (Meta Graph API v24).
 *
 * Multi-tenant: each factory configures their own Meta credentials and points
 * Meta at https://<host>/api/whatsapp/<slug>. The slug resolves to a
 * ceramic_clients row whose `wa_verify_token` + `wa_app_secret` (decrypted)
 * gate the GET (verify) and POST (receive) flows respectively.
 *
 * Sessions on WhatsApp are keyed by the buyer's phone number (not random
 * UUIDs like the web demo) so a buyer can pause and resume across days. We
 * keep them in the same in-memory map; production-scale would move this to
 * the DB but for the single-tenant Render demo this is fine.
 */

// ── In-memory WhatsApp session store (separate from web chat sessions) ──
//
// Key: `${clientId}:${buyerPhone}` so two different factories can both have
// a buyer with the same number without collision (multi-tenant correctness).

interface WhatsAppSession {
  clientId: string;
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
  history: ChatHistoryTurn[];
  lastSeen: number;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h on WhatsApp — buyers come back the next day
const MAX_HISTORY = 24;
const waSessions = new Map<string, WhatsAppSession>();

function sessionKey(clientId: string, phone: string): string {
  return `${clientId}:${phone}`;
}

function getOrCreateSession(clientId: string, phone: string, mode: Mode): WhatsAppSession {
  const key = sessionKey(clientId, phone);
  const existing = waSessions.get(key);
  if (existing && Date.now() - existing.lastSeen < TTL_MS) {
    existing.lastSeen = Date.now();
    return existing;
  }
  // Stale or missing — start fresh.
  const fresh: WhatsAppSession = {
    clientId,
    mode,
    stepId: ENTRY[mode],
    lead: {},
    history: [],
    lastSeen: Date.now(),
  };
  waSessions.set(key, fresh);
  return fresh;
}

function appendHistory(session: WhatsAppSession, turn: ChatHistoryTurn): void {
  session.history.push(turn);
  if (session.history.length > MAX_HISTORY) {
    session.history.splice(0, session.history.length - MAX_HISTORY);
  }
  session.lastSeen = Date.now();
}

function deleteSession(clientId: string, phone: string): void {
  waSessions.delete(sessionKey(clientId, phone));
}

// ── Signature verification (Meta sends X-Hub-Signature-256) ─────────────

function verifyMetaSignature(rawBody: Buffer, appSecret: string, header: string | undefined): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = header.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

// ── Lead persistence (mirrors the web chat router) ──────────────────────

function buildLeadInsert(sessionId: string, l: LeadDraft): InsertCeramicLead {
  return {
    sessionId,
    channel: "whatsapp",
    buyerType: l.buyerType,
    buyerName: l.buyerName,
    buyerPhone: l.buyerPhone, // captured automatically on WhatsApp (from sender)
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
  };
}

// ── Catalog URL resolution (mirrors web) ────────────────────────────────

async function pickCatalogUrlForSnapshot(
  snap: FlowSnapshot,
  mode: Mode,
  clientId: string,
): Promise<string | undefined> {
  if (!snap.catalog) return undefined;
  const [client, catalogues] = await Promise.all([
    storage.getClient(clientId),
    runWithClient(clientId, () => storage.getCatalogues()),
  ]);
  const match = pickCatalogue(snap.lead, mode, catalogues);
  return (
    match?.url ??
    (snap.catalog === "export" ? client?.exportCatalogUrl : client?.catalogUrl) ??
    undefined
  );
}

// ── Inbound message → reply pipeline ────────────────────────────────────

/**
 * Process one inbound WhatsApp message:
 *  - resolve / create session
 *  - advance the flow with the buyer's input
 *  - generate LLM-narrated bot replies
 *  - send text + chip messages back
 *  - persist the lead on terminal step
 */
async function processInboundMessage(
  clientId: string,
  factoryName: string,
  mode: Mode,
  from: string,
  messageId: string,
  input: { choiceLabel?: string; text?: string },
): Promise<void> {
  const session = getOrCreateSession(clientId, from, mode);

  // Best-effort: mark the buyer's message as read so they see the read tick.
  await runWithClient(clientId, () => markMessageAsRead(messageId));

  // Record the buyer's turn in history before the LLM call.
  const userText = (input.text ?? input.choiceLabel ?? "").trim();
  if (userText) appendHistory(session, { role: "user", text: userText });

  // Capture the buyer's phone on first contact (used at terminal lead-save).
  if (!session.lead.buyerPhone) {
    session.lead = { ...session.lead, buyerPhone: from };
  }

  // Advance the deterministic flow.
  const advanced = advanceFlow({
    mode: session.mode,
    stepId: session.stepId,
    lead: session.lead,
    choiceLabel: input.choiceLabel,
    text: input.text,
  });

  // "Start over": reset session state (history cleared by treating it fresh).
  if (advanced.startOver) {
    session.mode = mode;
    session.stepId = ENTRY[mode];
    session.lead = { buyerPhone: from };
    session.history = [];
  } else {
    session.stepId = advanced.stepId;
    session.lead = advanced.lead;
  }

  const catalogUrl = await pickCatalogUrlForSnapshot(advanced, session.mode, clientId);
  const snap: FlowSnapshot = catalogUrl ? { ...advanced, catalogUrl } : advanced;

  // LLM-narrated bot reply (or deterministic fallback when no API key).
  const bubbles = await generateBotReply({
    mode: session.mode,
    stepId: snap.stepId,
    factoryName,
    lead: snap.lead,
    quickReplies: snap.quickReplies,
    history: session.history,
    fallback: snap.botMessages,
    catalogUrl,
  });

  // Send bot bubbles via WhatsApp (within tenant context for getConfig).
  await runWithClient(clientId, async () => {
    // All bubbles except the last go out as plain text. The LAST bubble
    // carries the chips (if any) — Meta's interactive messages require body
    // text inline, so the chips ride along with the final narration.
    for (let i = 0; i < bubbles.length - 1; i++) {
      await sendTextMessage(from, bubbles[i]);
    }
    const finalBody = bubbles[bubbles.length - 1] ?? "";
    // Surface the catalog URL alongside the final bubble on catalog steps.
    const bodyWithCatalog = catalogUrl
      ? `${finalBody}\n\n📎 Catalogue: ${catalogUrl}`
      : finalBody;
    await sendQuickReplyMessage(from, bodyWithCatalog, snap.quickReplies);
  });

  // Record bot turns in history.
  for (const b of bubbles) appendHistory(session, { role: "bot", text: b });

  // Persist the lead once, on a terminal step that's NOT a "Start over" reset.
  if (snap.terminal && !snap.startOver) {
    await runWithClient(clientId, () =>
      storage.createLead(
        buildLeadInsert(`wa:${from}:${Date.now()}`, snap.lead),
      ),
    );
    // Drop the session post-persist so the next message starts a fresh flow.
    deleteSession(clientId, from);
  }
}

// ── Router ──────────────────────────────────────────────────────────────

export const whatsappRouter = Router();

/**
 * GET /api/whatsapp/:slug
 *
 * Meta verification handshake. Meta sends:
 *   ?hub.mode=subscribe&hub.verify_token=<their value>&hub.challenge=<random>
 * We echo `hub.challenge` back as plain text iff `hub.verify_token` matches
 * what the factory configured for this slug.
 */
whatsappRouter.get("/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? "");
  // Express's req.query values are typed `string | string[] | ParsedQs |
  // ParsedQs[] | undefined`. Coerce to a string before comparing.
  const mode = typeof req.query["hub.mode"] === "string" ? req.query["hub.mode"] : undefined;
  const token =
    typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : undefined;
  const challenge =
    typeof req.query["hub.challenge"] === "string" ? req.query["hub.challenge"] : undefined;
  if (mode !== "subscribe" || !challenge) {
    return res.status(400).send("invalid verify request");
  }
  const client = await storage.getClientBySlug(slug);
  if (!client?.waVerifyToken) return res.status(404).send("unknown client");
  if (token !== client.waVerifyToken) return res.status(403).send("verify token mismatch");
  // Meta expects the bare challenge string back.
  return res.status(200).type("text/plain").send(challenge);
});

/**
 * POST /api/whatsapp/:slug
 *
 * Inbound message webhook. Signature is verified against the client's
 * app_secret; only then do we parse the payload and run the chat pipeline.
 * Always returns 200 quickly — Meta retries on 4xx/5xx, so we acknowledge
 * receipt before doing the heavy work synchronously (still within the
 * request because Render free tier doesn't reliably support background work).
 */
whatsappRouter.post("/:slug", async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? "");
  const client = await storage.getClientBySlug(slug);
  if (!client) return res.status(404).json({ error: "unknown client" });

  // Signature verification. The express.json() middleware ran before us, so
  // we need the raw bytes — they were stashed by a verify-callback (see
  // app.ts wiring) on req.rawBody.
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const sigHeader = req.header("x-hub-signature-256");
  if (!client.waAppSecret) {
    console.error(`[WhatsApp] no app secret configured for client ${slug}`);
    return res.status(503).json({ error: "WhatsApp not fully configured" });
  }
  let appSecret: string;
  try {
    appSecret = decrypt(client.waAppSecret);
  } catch {
    console.error(`[WhatsApp] failed to decrypt app secret for ${slug}`);
    return res.status(503).json({ error: "WhatsApp credentials corrupt" });
  }
  if (!raw || !verifyMetaSignature(raw, appSecret, sigHeader)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  // Suspension kill-switch: a deactivated factory's bot doesn't run. ACK with
  // 200 (signature already verified, so this is a genuine Meta delivery) so
  // Meta stops retrying, then skip processing — no bot reply is sent.
  if (!client.active) {
    console.log(`[WhatsApp] client ${slug} is inactive — acking without processing`);
    return res.status(200).json({ received: true, inactive: true });
  }

  // ACK fast. We continue processing after the response is sent.
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    // WhatsApp webhook payload structure: entry[].changes[].value.messages[]
    const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

    for (const msg of messages) {
      const from: string | undefined = msg?.from;
      const messageId: string | undefined = msg?.id;
      if (!from || !messageId) continue;

      // Parse the buyer's input — either a button reply (chip) or a text.
      let choiceLabel: string | undefined;
      let text: string | undefined;
      if (msg.type === "interactive") {
        const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        choiceLabel = reply?.title; // we send chips with title === chip.label
      } else if (msg.type === "text") {
        text = msg.text?.body;
      } else {
        // Unsupported type (image, audio, etc.) — politely tell the buyer.
        await runWithClient(client.id, () =>
          sendTextMessage(
            from,
            "I can only handle text and quick-reply messages right now. Please tap an option or type your question.",
          ),
        );
        continue;
      }
      if (!choiceLabel && !text) continue;

      await processInboundMessage(client.id, client.name, client.mode as Mode, from, messageId, {
        choiceLabel,
        text,
      });
    }
  } catch (err) {
    // We already 200'd; just log so we don't crash the process.
    console.error("[WhatsApp] inbound processing error:", err);
  }
});
