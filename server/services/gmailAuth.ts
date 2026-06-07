/**
 * Gmail OAuth — ported from clinic-connect's google-calendar.ts.
 *
 * Same proven shape: a single google.auth.OAuth2 client, offline access +
 * forced consent to guarantee a refresh token, and reliance on googleapis to
 * auto-refresh the access token internally (do NOT refresh on every call).
 *
 * Scopes: we request readonly + modify + send up front so the exporter consents
 * once. Slice 1 only calls readonly/modify; send is used in Slice 2.
 */
import { google } from "googleapis";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

function getBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  return "http://localhost:5000";
}

export function getRedirectUri(): string {
  return `${getBaseUrl()}/api/admin/email/callback`;
}

export function isOAuthConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function createOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri());
}

export function getAuthUrl(state: string): string {
  return createOAuth2Client().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force consent so we always get a refresh token
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}> {
  const { tokens } = await createOAuth2Client().getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh token received. Revoke access in your Google account and reconnect.");
  }
  return {
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date || Date.now() + 3_600_000,
  };
}

/** Build a Gmail v1 client from a (decrypted) refresh token. googleapis auto-refreshes. */
export function gmailClientFromRefreshToken(refreshToken: string) {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

/** Encode a UTF-8 subject as an RFC 2047 word so non-ASCII survives transit. */
function encodeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

export interface SendReplyInput {
  refreshToken: string;
  to: string;
  subject: string;
  bodyText: string;
  /**
   * Gmail thread to attach the reply to. Passing threadId to messages.send is
   * what keeps the reply in the same conversation — Gmail handles the
   * In-Reply-To/References linkage internally, so we don't need the original
   * RFC Message-ID (which we don't store).
   */
  gmailThreadId: string;
}

/**
 * Send a plain-text reply on the connected Gmail, threaded onto the buyer's
 * original message. Returns the sent message id. Attachments are a later slice
 * — this builds a simple text/plain RFC 2822 message.
 */
export async function sendGmailReply(input: SendReplyInput): Promise<string> {
  const gmail = gmailClientFromRefreshToken(input.refreshToken);

  const headers = [
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  const raw = `${headers.join("\r\n")}\r\n\r\n${input.bodyText}`;
  const encoded = Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded, threadId: input.gmailThreadId },
  });
  return res.data.id ?? "";
}

export async function revokeAccess(refreshToken: string): Promise<void> {
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  await oauth2Client.revokeCredentials();
}

/** Fetch the connected mailbox's email address (used after token exchange). */
export async function getGmailAddress(refreshToken: string): Promise<string> {
  const gmail = gmailClientFromRefreshToken(refreshToken);
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress || "";
}
