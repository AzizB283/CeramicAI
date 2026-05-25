import express from "express";
import { chatRouter } from "./routes/chat";

export function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/chat", chatRouter);
  return app;
}
