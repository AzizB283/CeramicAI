import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { contactsRouter } from "./routes/contacts";
import { campaignsRouter } from "./routes/campaigns";
import { emailRouter } from "./routes/email";
import { superadminRouter } from "./routes/superadmin";
import { publicRouter } from "./routes/public";
import { whatsappRouter } from "./routes/whatsapp";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { allowEmbedding } from "./middleware/embed-framing";
import { serveStatic } from "./static";

export function buildApp() {
  const app = express();

  // Capture the raw body buffer alongside the parsed JSON. The WhatsApp
  // webhook (POST /api/whatsapp/:slug) needs the exact bytes to verify
  // Meta's X-Hub-Signature-256 HMAC; other routes ignore the field.
  app.use(
    express.json({
      // CSV contact imports POST the file contents as text in the JSON body
      // (no multipart dependency), so allow a larger body than the 100kb default.
      limit: "12mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // Health check. Cheap, unauthenticated, no DB hit — used by Render's
  // platform probe AND by our own keep-alive self-ping (see services/keepAlive)
  // to stop the free-tier instance from spinning down on idle. Mounted before
  // auth/session so a probe never touches session state.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  // Session middleware must run before any router that reads req.session.
  setupAuth(app);

  // Public routes used by the embedded widget on third-party sites.
  // CORS open: widget.js makes XHR calls to /api/public/widget-config from
  // any origin embedding the script.
  app.use("/api/public", cors({ origin: true, credentials: false }), publicRouter);

  // WhatsApp webhook. Multi-tenant: /api/whatsapp/:slug. No auth — Meta's
  // signature header on POST and the per-client verify token on GET are
  // the trust boundary.
  app.use("/api/whatsapp", whatsappRouter);

  // Tracked-link redirect for campaign catalogue links: /r/:token records the
  // hit (catalogue-open signal) and 302s to the real URL. Public, no auth — the
  // token is an unguessable random string. Mounted before the SPA fallback.
  app.get("/r/:token", async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token);
      const link = await storage.recordTrackedLinkHit(token);
      if (link?.targetUrl) return res.redirect(302, link.targetUrl);
    } catch (err) {
      console.error("[trackedLinks] redirect failed:", err);
    }
    return res.status(404).type("text/plain").send("Link not found");
  });

  // API
  app.use("/api/admin/campaigns", campaignsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/auth", authRouter);
  // Mounted before the generic /api/admin router for readability; Express
  // matches the more specific /api/admin/email prefix regardless of order.
  app.use("/api/admin/email", emailRouter);
  app.use("/api/admin/contacts", contactsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/superadmin", superadminRouter);

  // /chat (the standalone embeddable page) and /widget.js must be loadable
  // inside an iframe on any third-party site. Apply the framing middleware
  // before the SPA fallback hands these paths to index.html / widget.js.
  app.use(["/chat", "/widget.js"], allowEmbedding);

  // In production the bundled server also serves the built client (Vite
  // output at dist/public). In dev the client is served separately by Vite
  // on :5173 and this branch is skipped.
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });
  return app;
}
