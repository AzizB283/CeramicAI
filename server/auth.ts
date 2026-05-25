import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcryptjs";
import type { Express, Request, Response, NextFunction } from "express";
import { pool } from "./db";

// ── single admin user (single-tenant demo) ──────────────────────────────
// Credentials come from env, with safe demo defaults. The env password is
// hashed once at module load so the login path always goes through bcrypt.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 10);

const SESSION_SECRET = process.env.SESSION_SECRET ?? "dev-ceramic-secret-change-me";

// Augment the session shape with our single admin user.
declare module "express-session" {
  interface SessionData {
    user?: { username: string };
  }
}

/** Validate a username/password pair against the configured admin creds. */
export async function verifyAdmin(username: string, password: string): Promise<boolean> {
  if (username !== ADMIN_USERNAME) {
    // Still run a bcrypt compare so timing doesn't leak username validity.
    await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    return false;
  }
  return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
}

export const ADMIN_USERNAME_PUBLIC = ADMIN_USERNAME;

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
