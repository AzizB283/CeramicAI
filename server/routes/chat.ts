import { Router } from "express";
import type { Mode, LeadDraft } from "@shared/types";
import type { InsertCeramicLead } from "@shared/schema";
import {
  startFlow,
  advanceFlow,
  type FlowSnapshot,
} from "@shared/flowEngine";
import { resolveProductConfig } from "../services/productConfig";
import {
  createSession,
  getSession,
  setSession,
  deleteSession,
  appendHistory,
} from "../services/chatSessions";
import { ensureDemoClient } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import { answerSideQuestion } from "../services/openaiAsk";
import { cleanIncomingText } from "../services/entityExtraction";
import { pickCatalogue } from "../services/catalogueMatcher";
import {
  generateBotReply,
  type ChatHistoryTurn,
} from "../services/openaiChat";

function buildLeadInsert(sessionId: string, l: LeadDraft): InsertCeramicLead {
  return {
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
  };
}

/**
 * If the snapshot is on a catalog step, attach the best-matching catalogue
 * URL the admin uploaded. Falls back to the client's default factory/export
 * catalog URL when no good match exists. Returns the snapshot unchanged
 * when not on a catalog step.
 */
async function attachCatalogueUrl(
  snap: FlowSnapshot,
  mode: Mode,
  clientId: string,
): Promise<FlowSnapshot> {
  if (!snap.catalog) return snap;
  const [client, catalogues] = await Promise.all([
    storage.getClient(clientId),
    runWithClient(clientId, () => storage.getCatalogues()),
  ]);
  const match = pickCatalogue(snap.lead, mode, catalogues);
  const fallback = snap.catalog === "export" ? client?.exportCatalogUrl : client?.catalogUrl;
  const catalogUrl = match?.url ?? fallback ?? undefined;
  return catalogUrl ? { ...snap, catalogUrl } : snap;
}

/**
 * Replace the snapshot's deterministic `botMessages` with LLM-generated
 * narration for the current step. Falls back to the deterministic copy when
 * OpenAI is unavailable or errors — the demo never breaks because of the LLM.
 *
 * Called AFTER attachCatalogueUrl so the LLM can mention the catalogue link
 * naturally on catalog steps.
 */
async function narrateSnapshot(
  snap: FlowSnapshot,
  mode: Mode,
  history: ChatHistoryTurn[],
  factoryName: string,
): Promise<FlowSnapshot> {
  const bubbles = await generateBotReply({
    mode,
    stepId: snap.stepId,
    factoryName,
    lead: snap.lead,
    quickReplies: snap.quickReplies,
    history,
    fallback: snap.botMessages, // already placeholder-rendered by the engine
    catalogUrl: snap.catalogUrl,
  });
  return { ...snap, botMessages: bubbles };
}

/**
 * Resolve the tenant for an embed/web chat. The widget passes its factory's
 * slug via ?client=<slug> (or { client } in the body); we look it up and fall
 * back to the demo client when absent/unknown so the bare demo keeps working.
 * Returns the full client row so callers can also check `active`.
 */
async function resolveClientForChat(slug: unknown) {
  if (typeof slug === "string" && slug.trim()) {
    const bySlug = await storage.getClientBySlug(slug.trim());
    if (bySlug) return bySlug;
  }
  const demoId = await ensureDemoClient();
  return storage.getClient(demoId);
}

async function resolveFactoryName(clientId: string): Promise<string> {
  const client = await storage.getClient(clientId);
  return client?.name ?? "Shree Tiles Pvt Ltd";
}

// The single bot message shown when a factory is suspended (active=false).
// Neutral wording — the buyer shouldn't see "suspended".
const UNAVAILABLE_MESSAGE =
  "This service is currently unavailable. Please contact us directly.";

export const chatRouter = Router();

// POST /api/chat/session  { mode, client? } → { sessionId, ...snapshot }
chatRouter.post("/session", async (req, res) => {
  const mode: Mode = req.body?.mode === "exporter" ? "exporter" : "factory";
  // The embed/widget passes its factory slug via body.client (or ?client=).
  const slug = req.body?.client ?? req.query.client;
  const client = await resolveClientForChat(slug);
  if (!client) return res.status(404).json({ error: "unknown client" });

  // Suspension kill-switch: a deactivated factory's bot does not run.
  if (!client.active) {
    return res.json({ unavailable: true, botMessages: [UNAVAILABLE_MESSAGE] });
  }

  const clientId = client.id;
  const factoryName = client.name;
  const products = await resolveProductConfig(clientId);

  const initial = await attachCatalogueUrl(startFlow(mode, products), mode, clientId);
  // Fresh session has no history — the welcome turn is bot-only.
  const narrated = await narrateSnapshot(initial, mode, [], factoryName);

  const session = createSession({
    mode,
    stepId: narrated.stepId,
    lead: narrated.lead,
    clientId,
  });
  // Seed the session's history with the welcome bot turn(s).
  for (const text of narrated.botMessages) {
    appendHistory(session.id, { role: "bot", text });
  }

  res.json({ sessionId: session.id, ...narrated });
});

// POST /api/chat/message  { sessionId, choiceLabel?, text? } → snapshot
chatRouter.post("/message", async (req, res) => {
  const { sessionId, choiceLabel, text } = req.body ?? {};
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return res.status(404).json({ error: "session not found or expired" });

  if (text !== undefined && typeof text !== "string")
    return res.status(400).json({ error: "text must be a string" });

  // Record the buyer's turn in history BEFORE the LLM call so the LLM can
  // see the chip/text they just chose. choiceLabel is the chip text; text is
  // typed input. Either way, one is set or the request would be a no-op.
  const userTurnText = (text ?? choiceLabel ?? "").toString().trim();
  if (userTurnText) appendHistory(sessionId, { role: "user", text: userTurnText });

  const clientId = session.clientId;
  // Suspension can happen mid-conversation — stop the flow if the factory was
  // deactivated since the session started.
  const client = await storage.getClient(clientId);
  if (!client || !client.active) {
    deleteSession(sessionId);
    return res.json({ unavailable: true, botMessages: [UNAVAILABLE_MESSAGE] });
  }

  const products = await resolveProductConfig(clientId);
  // Extract the clean value from free-text answers ("my name is Rajesh" →
  // "Rajesh") before advancing — history above keeps the buyer's literal words.
  const cleanedText = await cleanIncomingText(session.stepId, text);
  const advanced = advanceFlow({
    mode: session.mode,
    stepId: session.stepId,
    lead: session.lead,
    choiceLabel,
    text: cleanedText,
    products,
  });

  // "Start over": treat as a fresh welcome — re-narrate from scratch with no
  // history. The session itself is being reset to the entry step by the
  // engine, so the FSM/lead state is already clean.
  const isReset = advanced.startOver;
  const snap = await attachCatalogueUrl(advanced, session.mode, clientId);
  const factoryName = client.name;

  const historyForLLM: ChatHistoryTurn[] = isReset
    ? []
    : getSession(sessionId)?.history ?? [];
  const narrated = await narrateSnapshot(snap, session.mode, historyForLLM, factoryName);

  setSession(sessionId, {
    mode: session.mode,
    stepId: narrated.stepId,
    lead: narrated.lead,
    clientId,
  });

  // Record the bot's reply in history. If the session is about to be deleted
  // (terminal, non-restart), we still append for symmetry — the
  // deleteSession below will drop the whole record together.
  for (const bubble of narrated.botMessages) {
    appendHistory(sessionId, { role: "bot", text: bubble });
  }

  // Persist the captured lead once, on a terminal step that is NOT a "Start over" reset.
  if (narrated.terminal && !narrated.startOver) {
    await runWithClient(clientId, () =>
      storage.createLead(buildLeadInsert(sessionId, narrated.lead)),
    );
    // Delete the session post-persist so a terminal replay (retry/double-submit)
    // gets a clean 404 instead of re-inserting the same lead (sessionId is not unique).
    deleteSession(sessionId);
  }

  return res.json(narrated);
});

// POST /api/chat/ask  { sessionId, question } → { answer }
//
// Off-flow side-question handler. The user typed something while a choice
// step (chips) was active — answer via OpenAI without advancing the flow.
chatRouter.post("/ask", async (req, res) => {
  const { sessionId, question } = req.body ?? {};
  if (typeof question !== "string" || !question.trim())
    return res.status(400).json({ error: "question must be a non-empty string" });
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return res.status(404).json({ error: "session not found or expired" });

  const factoryName = await resolveFactoryName(session.clientId);
  const answer = await answerSideQuestion(question.trim(), session.mode, factoryName);

  // Record both turns so future LLM calls see the side-question context.
  appendHistory(sessionId, { role: "user", text: question.trim() });
  appendHistory(sessionId, { role: "bot", text: answer });

  return res.json({ answer });
});
