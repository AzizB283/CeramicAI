import type { Request, Response } from "express";
import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth, effectiveClientId, AuthError } from "../auth";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";
import {
  isOAuthConfigured,
  getAuthUrl,
  exchangeCodeForTokens,
  getGmailAddress,
  revokeAccess,
} from "../services/gmailAuth";
import { pollClient } from "../services/gmailPoller";

export const emailRouter = Router();
emailRouter.use(requireAuth);

function resolveClient(req: Request, res: Response): string | null {
  try {
    return effectiveClientId(req);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(err.status).json({ error: err.message });
      return null;
    }
    throw err;
  }
}

declare module "express-session" {
  interface SessionData {
    gmailOAuthState?: { state: string; expiresAt: number };
  }
}

// GET /connect → Google auth URL; stash a CSPRNG state on the session.
emailRouter.get("/connect", (req, res) => {
  if (!isOAuthConfigured()) {
    res.status(503).json({ error: "Google OAuth not configured on the server." });
    return;
  }
  const state = crypto.randomBytes(32).toString("hex");
  req.session.gmailOAuthState = { state, expiresAt: Date.now() + 10 * 60 * 1000 };
  res.json({ authUrl: getAuthUrl(state) });
});

// GET /callback → verify state, exchange code, store encrypted tokens.
emailRouter.get("/callback", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const { code, state } = req.query;
  const stashed = req.session.gmailOAuthState;
  delete req.session.gmailOAuthState; // single-use
  if (!code || typeof state !== "string" || !stashed || Date.now() > stashed.expiresAt) {
    res.status(400).json({ error: "Invalid or expired OAuth state." });
    return;
  }
  const a = Buffer.from(state, "utf8");
  const b = Buffer.from(stashed.state, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: "OAuth state mismatch." });
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens(code as string);
    const gmailAddress = await getGmailAddress(tokens.refresh_token);
    await runWithClient(clientId, () =>
      storage.upsertEmailConnection({
        gmailAddress,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(tokens.expiry_date),
        historyId: null,
      }),
    );
    res.redirect("/admin/integrations?gmail=connected");
  } catch (err) {
    console.error("[email/callback] token exchange failed:", err);
    res.redirect("/admin/integrations?gmail=error");
  }
});

// GET /status
emailRouter.get("/status", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const conn = await runWithClient(clientId, () => storage.getEmailConnection());
  res.json({
    connected: Boolean(conn?.active),
    gmailAddress: conn?.gmailAddress ?? null,
    lastCheckedAt: conn?.lastCheckedAt ?? null,
  });
});

// DELETE /disconnect
emailRouter.delete("/disconnect", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  await runWithClient(clientId, async () => {
    const conn = await storage.getEmailConnection();
    if (conn) {
      try {
        await revokeAccess(conn.refreshToken);
      } catch (e) {
        console.warn("[email] revoke failed:", e);
      }
      await storage.deleteEmailConnection();
    }
  });
  res.json({ ok: true });
});

// GET /threads + /threads/:id
emailRouter.get("/threads", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const threads = await runWithClient(clientId, () => storage.getEmailThreads());
  res.json(threads);
});

emailRouter.get("/threads/:id", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "bad id" });
    return;
  }
  const thread = await runWithClient(clientId, () => storage.getEmailThread(id));
  if (!thread) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(thread);
});

// POST /poll → manual "check now"
emailRouter.post("/poll", async (req, res) => {
  const clientId = resolveClient(req, res);
  if (!clientId) return;
  try {
    await runWithClient(clientId, async () => {
      const client = await storage.getClient(clientId);
      if (client) await pollClient(client);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[email/poll] failed:", err);
    res.status(502).json({ error: "poll failed" });
  }
});
