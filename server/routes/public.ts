import { Router } from "express";
import { ensureDemoClient } from "../seed";
import { storage } from "../storage";
import { runWithClient } from "../middleware/tenant";
import { verifyUnsubscribeToken } from "../services/unsubscribeToken";

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

// GET|POST /api/public/unsubscribe?t=<signed-token>
//
// One-click unsubscribe from campaign emails. The token (issued by
// services/unsubscribeToken) carries {clientId, email} and is HMAC-signed, so
// no session is needed and nobody can unsubscribe an arbitrary address. On a
// valid token we suppress the email and flag the matching contact opted-out.
// Gmail's one-click List-Unsubscribe-Post hits this with POST; humans GET it.
async function handleUnsubscribe(req: import("express").Request, res: import("express").Response) {
  const token = (req.query.t ?? req.body?.t) as string | undefined;
  const page = (title: string, msg: string) =>
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
     <body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#faf3e7;margin:0;padding:48px 16px;text-align:center;color:#1f2937;">
       <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
         <h1 style="font-size:18px;margin:0 0 8px;">${title}</h1>
         <p style="font-size:14px;color:#6b7280;margin:0;">${msg}</p>
       </div></body></html>`;

  const parsed = token ? verifyUnsubscribeToken(token) : null;
  if (!parsed) {
    return res.status(400).type("html").send(page("Invalid link", "This unsubscribe link is invalid or has expired."));
  }
  try {
    await runWithClient(parsed.clientId, async () => {
      await storage.suppressContact({ email: parsed.email, reason: "unsubscribe" });
      const contact = await storage.findContactByHash({ email: parsed.email });
      if (contact && !contact.optedOut) await storage.updateContact(contact.id, { optedOut: true });
    });
  } catch (err) {
    console.error("[unsubscribe] failed:", err);
    return res.status(500).type("html").send(page("Something went wrong", "Please try again later."));
  }
  return res
    .status(200)
    .type("html")
    .send(page("You're unsubscribed", "You won't receive any more emails from this sender."));
}

publicRouter.get("/unsubscribe", handleUnsubscribe);
publicRouter.post("/unsubscribe", handleUnsubscribe);
