/**
 * Gmail inbox sync for one connected client.
 *
 * We poll with messages.list (query "in:inbox newer_than:Nd") rather than the
 * History API. The History API seeded from getProfile().historyId proved
 * unreliable — newly-arrived messages were skipped because the profile
 * historyId doesn't line up with the message-event history. messages.list is
 * the robust choice for a low-volume bot polling every few minutes: we re-scan
 * a small recent window each poll and rely on the unique gmail_message_id
 * constraint (handled in emailIngest) to skip anything already ingested.
 */
import { storage } from "../storage";
import { gmailClientFromRefreshToken } from "./gmailAuth";
import { ingestParsedEmail } from "./emailIngest";
import type { CeramicClient } from "@shared/schema";

export interface ParsedEmail {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  sourcePlatform: string | null;
}

function header(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string | null {
  const h = headers?.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// Prefer a real text/plain part anywhere in the MIME tree. Only if none exists
// do we fall back to stripping a text/html part — otherwise a multipart email
// whose first part is HTML would shadow its plain-text sibling.
function findPlainTextBody(payload: any): string | null {
  const plain = findByMime(payload, "text/plain");
  if (plain) return plain;
  const html = findByMime(payload, "text/html");
  if (html) {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return null;
}

// Depth-first search for the first part of `mime` that carries body data.
function findByMime(payload: any, mime: string): string | null {
  if (!payload) return null;
  if (payload.mimeType === mime && payload.body?.data) return decodeB64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const found = findByMime(part, mime);
    if (found) return found;
  }
  return null;
}

export function detectSourcePlatform(fromEmail: string | null, subject: string | null): string {
  const from = (fromEmail ?? "").toLowerCase();
  const subj = (subject ?? "").toLowerCase();
  if (from.includes("alibaba.com") || subj.includes("buyer inquiry") || subj.includes("trade alert")) return "alibaba";
  if (from.includes("indiamart.com")) return "indiamart";
  if (from.includes("tradeindia.com")) return "tradeindia";
  return "direct";
}

export function parseGmailMessage(msg: any): ParsedEmail {
  const headers = msg.payload?.headers;
  const fromRaw = header(headers, "From");
  let fromName: string | null = null;
  let fromEmail: string | null = null;
  if (fromRaw) {
    const m = fromRaw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (m) {
      fromName = m[1].trim() || null;
      fromEmail = m[2].trim();
    } else {
      fromEmail = fromRaw.trim();
    }
  }
  const subject = header(headers, "Subject");
  const bodyText = findPlainTextBody(msg.payload);
  return {
    gmailMessageId: msg.id,
    gmailThreadId: msg.threadId,
    fromEmail,
    fromName,
    subject,
    bodyText,
    sourcePlatform: detectSourcePlatform(fromEmail, subject),
  };
}

// How far back each poll scans. The scheduler runs every 5 min, so a 1-day
// window comfortably covers downtime/restarts while keeping the scan small.
// Dedup by gmail_message_id means re-scanning the same window is harmless.
const POLL_WINDOW = "newer_than:1d in:inbox";

/** Poll one client's inbox. MUST be called inside runWithClient(clientId, …). */
export async function pollClient(clientConfig: CeramicClient): Promise<void> {
  const conn = await storage.getEmailConnection();
  if (!conn || !conn.active) return;

  const gmail = gmailClientFromRefreshToken(conn.refreshToken);

  const list = await gmail.users.messages.list({
    userId: "me",
    q: POLL_WINDOW,
    maxResults: 50,
  });

  // Oldest-first so threads/leads land in chronological order. messages.list
  // returns newest-first, so reverse.
  const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
  ids.reverse();

  let ingested = 0;
  for (const id of ids) {
    try {
      const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const parsed = parseGmailMessage(full.data);
      // ingestParsedEmail is idempotent: a duplicate gmail_message_id is caught
      // and skipped, so re-scanning the window every poll is safe.
      await ingestParsedEmail(parsed, clientConfig);
      ingested++;
    } catch (err) {
      console.error(`[gmailPoller] message ${id} failed:`, err);
    }
  }

  console.log(
    `[gmailPoller] ${conn.gmailAddress}: scanned ${ids.length} message(s) in window`,
  );

  await storage.updateEmailConnectionSync({ lastCheckedAt: new Date() });
}
