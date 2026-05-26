import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { publicRouter } from "./routes/public";
import { setupAuth } from "./auth";
import { allowEmbedding } from "./middleware/embed-framing";
import { serveStatic } from "./static";

export function buildApp() {
  const app = express();
  app.use(express.json());
  // Session middleware must run before any router that reads req.session.
  setupAuth(app);

  // Public routes used by the embedded widget on third-party sites.
  // CORS open: widget.js makes XHR calls to /api/public/widget-config from
  // any origin embedding the script.
  app.use("/api/public", cors({ origin: true, credentials: false }), publicRouter);

  // API
  app.use("/api/chat", chatRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);

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
