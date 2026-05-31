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
// Returns the bot's branding so the floating widget can colour itself before
// the iframe even loads. Resolves the factory by ?client=<slug> (the embed
// sets this), falling back to the demo client when absent/unknown. `active`
// lets the embed optionally hide itself for a suspended factory.
publicRouter.get("/widget-config", async (req, res) => {
  try {
    const slug = req.query.client;
    let client = undefined;
    if (typeof slug === "string" && slug.trim()) {
      client = await storage.getClientBySlug(slug.trim());
    }
    if (!client) {
      const clientId = await ensureDemoClient();
      client = await storage.getClient(clientId);
    }
    res.json({
      botName: client?.widgetName || "CeramicBot",
      color: client?.widgetColor ? `#${client.widgetColor}` : "#e85d04",
      greeting: client?.widgetGreeting || null,
      active: client?.active ?? true,
      // The embedded widget runs the factory's own single mode (no toggle), so
      // it needs to know which one. Defaults to "factory" for safety.
      mode: client?.mode === "exporter" ? "exporter" : "factory",
    });
  } catch (err) {
    console.error("widget-config error:", err);
    res.json({
      botName: "CeramicBot",
      color: "#e85d04",
      greeting: null,
      active: true,
      mode: "factory",
    });
  }
});
