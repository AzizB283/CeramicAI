/**
 * Incremental Gmail inbox sync for one connected client. Uses the History API
 * so we only fetch messages added since the saved historyId. First poll (no
 * cursor) seeds the cursor from the current mailbox WITHOUT backfilling.
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

/** Poll one client's inbox. MUST be called inside runWithClient(clientId, …). */
export async function pollClient(clientConfig: CeramicClient): Promise<void> {
  const conn = await storage.getEmailConnection();
  if (!conn || !conn.active) return;

  const gmail = gmailClientFromRefreshToken(conn.refreshToken);

  // First-ever poll: seed the cursor from the current mailbox, don't backfill.
  if (!conn.historyId) {
    const profile = await gmail.users.getProfile({ userId: "me" });
    await storage.updateEmailConnectionSync({
      historyId: profile.data.historyId ? String(profile.data.historyId) : null,
      lastCheckedAt: new Date(),
    });
    return;
  }

  const history = await gmail.users.history.list({
    userId: "me",
    startHistoryId: conn.historyId,
    historyTypes: ["messageAdded"],
    labelId: "INBOX",
  });

  const messageIds = new Set<string>();
  for (const h of history.data.history ?? []) {
    for (const added of h.messagesAdded ?? []) {
      const id = added.message?.id;
      if (id) messageIds.add(id);
    }
  }

  for (const id of messageIds) {
    try {
      const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const parsed = parseGmailMessage(full.data);
      await ingestParsedEmail(parsed, clientConfig);
    } catch (err) {
      console.error(`[gmailPoller] message ${id} failed:`, err);
    }
  }

  await storage.updateEmailConnectionSync({
    historyId: history.data.historyId ? String(history.data.historyId) : conn.historyId,
    lastCheckedAt: new Date(),
  });
}
