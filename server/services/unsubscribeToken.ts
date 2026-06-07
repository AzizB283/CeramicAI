/**
 * Signed unsubscribe tokens.
 *
 * The unsubscribe link in a campaign email must work with no session (the buyer
 * clicks it from their inbox), yet must not let anyone unsubscribe arbitrary
 * addresses. So we encode {clientId, email} and sign it with UNSUBSCRIBE_SECRET
 * (HMAC-SHA256). The public route verifies the signature before suppressing.
 *
 * Format: base64url(payloadJson) + "." + base64url(hmac). Compact, URL-safe,
 * stateless (no DB row needed to issue one).
 */
import crypto from "node:crypto";

interface UnsubPayload {
  c: string; // clientId
  e: string; // email (lowercased)
}

function secret(): string {
  // Fall back to ENCRYPTION_KEY so unsubscribe works even if the dedicated
  // secret isn't set — both are server-only. A dedicated secret is preferred.
  return process.env.UNSUBSCRIBE_SECRET || process.env.ENCRYPTION_KEY || "ceramic-unsub-dev";
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

export function makeUnsubscribeToken(clientId: string, email: string): string {
  const payload: UnsubPayload = { c: clientId, e: email.trim().toLowerCase() };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyUnsubscribeToken(token: string): { clientId: string; email: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare; lengths must match first or timingSafeEqual throws.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubPayload;
    if (!payload.c || !payload.e) return null;
    return { clientId: payload.c, email: payload.e };
  } catch {
    return null;
  }
}

export function unsubscribeUrl(clientId: string, email: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:5000";
  return `${base}/api/public/unsubscribe?t=${encodeURIComponent(makeUnsubscribeToken(clientId, email))}`;
}
