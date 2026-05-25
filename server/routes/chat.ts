import { Router } from "express";
import type { Mode } from "@shared/types";
import { startFlow, advanceFlow } from "@shared/flowEngine";
import { createSession, getSession, setSession } from "../services/chatSessions";
import { ensureDemoClient } from "../seed";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";

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
    const l = snap.lead;
    await runWithClient(clientId, () =>
      storage.createLead({
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
      }),
    );
  }

  return res.json(snap);
});
