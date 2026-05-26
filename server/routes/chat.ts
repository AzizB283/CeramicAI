import { Router } from "express";
import type { Mode, LeadDraft } from "@shared/types";
import type { InsertCeramicLead } from "@shared/schema";
import { startFlow, advanceFlow } from "@shared/flowEngine";
import { createSession, getSession, setSession, deleteSession } from "../services/chatSessions";
import { ensureDemoClient } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import { answerSideQuestion } from "../services/openaiAsk";

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

export const chatRouter = Router();

// POST /api/chat/session  { mode } → { sessionId, ...snapshot }
chatRouter.post("/session", (req, res) => {
  const mode: Mode = req.body?.mode === "exporter" ? "exporter" : "factory";
  const snap = startFlow(mode);
  const session = createSession({ mode, stepId: snap.stepId, lead: snap.lead });
  res.json({ sessionId: session.id, ...snap });
});

// POST /api/chat/message  { sessionId, choiceLabel?, text? } → snapshot
chatRouter.post("/message", async (req, res) => {
  const { sessionId, choiceLabel, text } = req.body ?? {};
  const session = sessionId ? getSession(sessionId) : undefined;
  if (!session) return res.status(404).json({ error: "session not found or expired" });

  if (text !== undefined && typeof text !== "string")
    return res.status(400).json({ error: "text must be a string" });

  const snap = advanceFlow({
    mode: session.mode,
    stepId: session.stepId,
    lead: session.lead,
    choiceLabel,
    text,
  });

  setSession(sessionId, { mode: session.mode, stepId: snap.stepId, lead: snap.lead });

  // Persist the captured lead once, on a terminal step that is NOT a "Start over" reset.
  if (snap.terminal && !snap.startOver) {
    const clientId = await ensureDemoClient();
    await runWithClient(clientId, () => storage.createLead(buildLeadInsert(sessionId, snap.lead)));
    // Delete the session post-persist so a terminal replay (retry/double-submit)
    // gets a clean 404 instead of re-inserting the same lead (sessionId is not unique).
    deleteSession(sessionId);
  }

  return res.json(snap);
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

  const clientId = await ensureDemoClient();
  const client = await storage.getClient(clientId);
  const factoryName = client?.name ?? "Shree Tiles Pvt Ltd";

  const answer = await answerSideQuestion(question.trim(), session.mode, factoryName);
  return res.json({ answer });
});
