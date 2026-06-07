/**
 * Outbound campaign email via the client's connected Gmail.
 *
 * Distinct from gmailAuth.sendGmailReply (which threads onto a buyer's inbox
 * message): this sends a FRESH message to a prospect, as an HTML email with a
 * plain-text alternative, plus the headers that keep outbound safe + traceable:
 *   - List-Unsubscribe (one-click unsubscribe; protects sender reputation)
 *   - X-Ceramic-Campaign (our recipient id — a secondary reply-attribution hook)
 *
 * Catalogues ride along as tracked links in the body, NOT as MIME attachments,
 * so we keep a simple multipart/alternative message and dodge Gmail's
 * attachment-size limits. Returns the sent message id + thread id.
 */
import { gmailClientFromRefreshToken } from "./gmailAuth";

/** Encode a UTF-8 subject as an RFC 2047 word so non-ASCII survives transit. */
function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface SendCampaignEmailInput {
  refreshToken: string;
  /** The connected Gmail address (the verified sender). Required for a valid From. */
  fromAddress: string;
  fromName?: string; // optional display name shown before the address
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Full URL hit to unsubscribe — becomes the List-Unsubscribe header. */
  unsubscribeUrl?: string;
  /** Our recipient id, stamped as X-Ceramic-Campaign for reply attribution. */
  campaignRecipientId?: number;
}

export interface SendCampaignEmailResult {
  messageId: string;
  threadId: string;
}

/**
 * Send one campaign email from the connected Gmail. Throws on API failure so
 * the caller (campaignSender) can mark the recipient failed with the error —
 * unlike the best-effort owner-alert path, a campaign send's success/failure
 * is meaningful state we must record.
 */
export async function sendCampaignEmail(
  input: SendCampaignEmailInput,
): Promise<SendCampaignEmailResult> {
  const gmail = gmailClientFromRefreshToken(input.refreshToken);

  const boundary = `=_ceramic_${toBase64Url(String(input.campaignRecipientId ?? "x")).slice(0, 12)}_${input.subject.length}`;
  const cleanName = input.fromName?.replace(/["<>]/g, "").trim();
  const fromHeader = cleanName ? `${cleanName} <${input.fromAddress}>` : input.fromAddress;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    input.unsubscribeUrl ? `List-Unsubscribe: <${input.unsubscribeUrl}>` : null,
    input.unsubscribeUrl ? "List-Unsubscribe-Post: List-Unsubscribe=One-Click" : null,
    input.campaignRecipientId != null ? `X-Ceramic-Campaign: ${input.campaignRecipientId}` : null,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
    "",
    `--${boundary}--`,
  ];

  const raw = `${headers.join("\r\n")}\r\n\r\n${body.join("\r\n")}`;

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: toBase64Url(raw) },
  });
  return { messageId: res.data.id ?? "", threadId: res.data.threadId ?? "" };
}
