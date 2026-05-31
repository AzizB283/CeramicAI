import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { superadminRouter } from "./routes/superadmin";
import { publicRouter } from "./routes/public";
import { whatsappRouter } from "./routes/whatsapp";
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

  // API
  app.use("/api/chat", chatRouter);
  app.use("/api/auth", authRouter);
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
