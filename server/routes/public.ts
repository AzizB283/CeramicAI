import { Router } from "express";
import { ensureDemoClient } from "../seed";
import { storage } from "../storage";

/**
 * Public (unauthenticated) endpoints used by the embeddable widget.js
 * and the standalone /chat page. CORS-friendly: any third-party site
 * embedding the widget should be able to load these.
 */
export const publicRouter = Router();

// GET /api/public/widget-config[?client=<slug>]
//
// Returns the bot's branding so the floating widget can colour itself
// before the iframe even loads. Single-tenant: always resolves to the
// demo client. Multi-tenant (later): look up by req.query.client.
publicRouter.get("/widget-config", async (_req, res) => {
  try {
    const clientId = await ensureDemoClient();
    const client = await storage.getClient(clientId);
    res.json({
      botName: client?.widgetName || "CeramicBot",
      color: client?.widgetColor ? `#${client.widgetColor}` : "#e85d04",
      greeting: client?.widgetGreeting || null,
    });
  } catch (err) {
    console.error("widget-config error:", err);
    res.json({ botName: "CeramicBot", color: "#e85d04", greeting: null });
  }
});
