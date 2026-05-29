import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import type { Express, Request, Response, NextFunction } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import type { AdminUser } from "@shared/schema";

const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-ceramic-secret-change-me";

// A throwaway bcrypt hash used for constant-time compares when a username
// doesn't exist — so login timing doesn't leak which usernames are valid.
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

/** The shape we store on the session for a logged-in panel user. */
export interface SessionUser {
  id: string;
  username: string;
  name: string | null;
  role: "superadmin" | "factory";
  clientId: string | null; // null for superadmin; the factory's id otherwise
}

// Augment the session shape. `user` is the logged-in identity; `actingClientId`
// is set ONLY when a superadmin is impersonating a factory (set via the guarded
// /api/superadmin/impersonate endpoint — never from a client-sent value).
declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    actingClientId?: string;
  }
}

/**
 * Validate a username/password pair against admin_users. Returns the user row
 * on success, or null. Always runs a bcrypt compare (even on unknown username
 * or inactive account) so response timing doesn't leak account existence.
 */
export async function verifyAdmin(
  username: string,
  password: string,
): Promise<AdminUser | null> {
  const user = await storage.getAdminUserByUsername(username);
  if (!user || !user.active) {
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }
  const ok = await bcrypt.compare(password, user.password);
  return ok ? user : null;
}

/** Project an AdminUser row to the session identity we persist. */
export function toSessionUser(user: AdminUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role === "superadmin" ? "superadmin" : "factory",
    clientId: user.clientId,
  };
}

/** Configure express-session (backed by Postgres) on the app. Call BEFORE routers. */
export function setupAuth(app: Express): void {
  app.set("trust proxy", 1);
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool, // reuse the app's pg pool
    createTableIfMissing: true, // auto-create the "session" table — no manual migration
  });
  const sessionTtlMs = 7 * 24 * 60 * 60 * 1000; // 1 week
  app.use(
    session({
      secret: SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: sessionTtlMs,
      },
    }),
  );
}

/** 401 unless a user is on the session. Does not touch /api/chat or /api/auth/login. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/** 401 if not logged in, 403 unless the user is a superadmin. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.session.user.role !== "superadmin") {
    res.status(403).json({ error: "Access denied. Superadmin privileges required." });
    return;
  }
  next();
}

/**
 * The client id the current admin request should operate on:
 *  - factory admin → their own session clientId (never from input).
 *  - superadmin → only while impersonating, the session.actingClientId set by
 *    the guarded impersonate endpoint. Throws (403) if not impersonating.
 *
 * Returns null + a reason the caller turns into an HTTP status; we keep this
 * pure (no res) so it's easy to unit-test and reuse.
 */
export function effectiveClientId(req: Request): string {
  const user = req.session?.user;
  if (!user) throw new AuthError(401, "Unauthorized");
  if (user.role === "factory") {
    if (!user.clientId) throw new AuthError(403, "Factory admin has no client binding");
    return user.clientId;
  }
  // superadmin
  const acting = req.session?.actingClientId;
  if (!acting) throw new AuthError(403, "Start a factory session first");
  return acting;
}

/** Small typed error so route handlers can map to a status code. */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}
