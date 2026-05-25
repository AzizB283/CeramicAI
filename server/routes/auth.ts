import { Router } from "express";
import { verifyAdmin } from "../auth";

export const authRouter = Router();

// POST /api/auth/login { username, password } → { username } | 401
authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "username and password are required" });
  }
  const ok = await verifyAdmin(username, password);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  req.session.user = { username };
  // Persist the session before responding so Set-Cookie + store stay in sync.
  req.session.save((err) => {
    if (err) {
      console.error("[auth] session save failed:", err);
      return res.status(500).json({ error: "Login failed" });
    }
    res.json({ username });
  });
});

// POST /api/auth/logout → destroy session, { ok: true }
authRouter.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("[auth] logout failed:", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// GET /api/auth/me → { username } | 401
authRouter.get("/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Unauthorized" });
  res.json({ username: req.session.user.username });
});
