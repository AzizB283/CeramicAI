import { Router } from "express";
import type { Mode, LeadDraft } from "@shared/types";
import type { CeramicProduct, InsertCeramicLead } from "@shared/schema";
import {
  startFlow,
  advanceFlow,
  type FlowSnapshot,
  type ProductConfig,
} from "@shared/flowEngine";
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
async function attachCatalogueUrl(snap: FlowSnapshot, mode: Mode): Promise<FlowSnapshot> {
  if (!snap.catalog) return snap;
  const clientId = await ensureDemoClient();
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

async function resolveFactoryName(): Promise<string> {
  const clientId = await ensureDemoClient();
  const client = await storage.getClient(clientId);
  return client?.name ?? "Shree Tiles Pvt Ltd";
}

/**
 * Build the ProductConfig the engine consumes from the rows the admin
 * configured. Returns undefined when the factory has zero rows — the engine
 * then falls back to the hardcoded defaults in flows.ts.
 *
 * Standard categories use their slug as the key. Custom categories
 * (category="other") get a synthetic per-row key ("custom:<id>") so the
 * factory can configure multiple distinct custom categories without them
 * collapsing into one.
 */
const STANDARD_CATEGORY_LABELS: Record<string, string> = {
  ceramic_wall: "Ceramic Wall Tiles",
  gvt: "GVT / Vitrified Floor",
  pgvt: "PGVT",
  double_charge: "Double Charge",
  slab: "Slab (Large Format)",
  sanitaryware: "Sanitaryware",
};

function buildProductConfig(rows: CeramicProduct[]): ProductConfig | undefined {
  const active = rows.filter((r) => r.isActive);
  if (active.length === 0) return undefined;
  const config: ProductConfig = {
    categories: [],
    sizesByCategory: {},
    finishesByCategory: {},
    sanitaryItems: [],
  };
  for (const row of active) {
    const isCustom = row.category === "other";
    const value = isCustom ? `custom:${row.id}` : row.category;
    const label = isCustom
      ? row.customLabel?.trim() || "Other"
      : STANDARD_CATEGORY_LABELS[row.category] ?? row.category;
    config.categories.push({ value, label });
    config.sizesByCategory[value] = row.sizes ?? [];
    config.finishesByCategory[value] = row.finishes ?? [];
    if (row.category === "sanitaryware") {
      config.sanitaryItems = row.subItems ?? [];
    }
  }
  return config;
}

async function resolveProductConfig(): Promise<ProductConfig | undefined> {
  const clientId = await ensureDemoClient();
  const rows = await runWithClient(clientId, () => storage.getProducts());
  return buildProductConfig(rows);
}

export const chatRouter = Router();

// POST /api/chat/session  { mode } → { sessionId, ...snapshot }
chatRouter.post("/session", async (req, res) => {
  const mode: Mode = req.body?.mode === "exporter" ? "exporter" : "factory";
  const factoryName = await resolveFactoryName();
  const products = await resolveProductConfig();

  const initial = await attachCatalogueUrl(startFlow(mode, products), mode);
  // Fresh session has no history — the welcome turn is bot-only.
  const narrated = await narrateSnapshot(initial, mode, [], factoryName);

  const session = createSession({
    mode,
    stepId: narrated.stepId,
    lead: narrated.lead,
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

  const products = await resolveProductConfig();
  const advanced = advanceFlow({
    mode: session.mode,
    stepId: session.stepId,
    lead: session.lead,
    choiceLabel,
    text,
    products,
  });

  // "Start over": treat as a fresh welcome — re-narrate from scratch with no
  // history. The session itself is being reset to the entry step by the
  // engine, so the FSM/lead state is already clean.
  const isReset = advanced.startOver;
  const snap = await attachCatalogueUrl(advanced, session.mode);
  const factoryName = await resolveFactoryName();

  const historyForLLM: ChatHistoryTurn[] = isReset
    ? []
    : getSession(sessionId)?.history ?? [];
  const narrated = await narrateSnapshot(snap, session.mode, historyForLLM, factoryName);

  setSession(sessionId, {
    mode: session.mode,
    stepId: narrated.stepId,
    lead: narrated.lead,
  });

  // Record the bot's reply in history. If the session is about to be deleted
  // (terminal, non-restart), we still append for symmetry — the
  // deleteSession below will drop the whole record together.
  for (const bubble of narrated.botMessages) {
    appendHistory(sessionId, { role: "bot", text: bubble });
  }

  // Persist the captured lead once, on a terminal step that is NOT a "Start over" reset.
  if (narrated.terminal && !narrated.startOver) {
    const clientId = await ensureDemoClient();
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

  const factoryName = await resolveFactoryName();
  const answer = await answerSideQuestion(question.trim(), session.mode, factoryName);

  // Record both turns so future LLM calls see the side-question context.
  appendHistory(sessionId, { role: "user", text: question.trim() });
  appendHistory(sessionId, { role: "bot", text: answer });

  return res.json({ answer });
});
