import { Router } from "express";
import { verifyAdmin, toSessionUser } from "../auth";

export const authRouter = Router();

// POST /api/auth/login { username, password } → { username, role } | 401
authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "username and password are required" });
  }
  const user = await verifyAdmin(username, password);
  if (!user) return res.status(401).json({ error: "Invalid username or password" });

  const sessionUser = toSessionUser(user);
  req.session.user = sessionUser;
  // A fresh login is never mid-impersonation.
  delete req.session.actingClientId;
  // Persist the session before responding so Set-Cookie + store stay in sync.
  req.session.save((err) => {
    if (err) {
      console.error("[auth] session save failed:", err);
      return res.status(500).json({ error: "Login failed" });
    }
    res.json({ username: sessionUser.username, role: sessionUser.role });
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

// GET /api/auth/me → full identity | 401. Includes actingClientId so the
// client can render the impersonation banner + route by role.
authRouter.get("/me", (req, res) => {
  const user = req.session?.user;
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    clientId: user.clientId,
    actingClientId: req.session.actingClientId ?? null,
  });
});
