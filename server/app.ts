import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { publicRouter } from "./routes/public";
import { setupAuth } from "./auth";

export function buildApp() {
  const app = express();
  app.use(express.json());
  // Session middleware must run before any router that reads req.session.
  setupAuth(app);
  // Public routes used by the embedded widget on third-party sites.
  // CORS open: widget.js makes XHR calls to /api/public/widget-config from
  // any origin embedding the script.
  app.use("/api/public", cors({ origin: true, credentials: false }), publicRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[chat] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });
  return app;
}
