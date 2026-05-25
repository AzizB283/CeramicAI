import express, { type Request, type Response, type NextFunction } from "express";
import { chatRouter } from "./routes/chat";

export function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[chat] unhandled error:", err);
    res.status(500).json({ error: "internal server error" });
  });
  return app;
}
