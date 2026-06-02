/**
 * Transactional email via the Resend HTTP API.
 *
 * Deliberately dependency-free: Resend is a plain `fetch` POST with a Bearer
 * key, so we don't pull in an SMTP library. Best-effort and self-contained,
 * matching the LLM / keep-alive code — a misconfigured or failing send is
 * logged and swallowed so it can never break lead persistence or the chat.
 *
 * Configuration (env):
 *   RESEND_API_KEY  — required to send. Unset → sends are skipped (logged once).
 *   RESEND_FROM     — the From address, e.g. "CeramicBot <leads@aurexauto.com>".
 *                     Defaults to a Resend sandbox sender if unset.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "CeramicBot <onboarding@resend.dev>";

export interface SendEmailInput {
  to: string[]; // already-validated recipient list (1–3 addresses)
  subject: string;
  html: string;
  text?: string; // plain-text fallback part
  replyTo?: string; // e.g. the buyer's address, so "Reply" reaches them
  // Override just the From display name (address stays RESEND_FROM's). Lets each
  // factory's alert show its own business name while we send from one domain.
  fromName?: string;
}

/** True when Resend is configured enough to attempt a send. */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

let warnedUnconfigured = false;

/**
 * Send one email to one or more recipients. Returns true on a 2xx from Resend,
 * false otherwise (including when unconfigured). Never throws.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    // Warn once per process so logs aren't spammed on every lead in dev.
    if (!warnedUnconfigured) {
      console.warn("[email] RESEND_API_KEY not set — lead emails are disabled.");
      warnedUnconfigured = true;
    }
    return false;
  }
  if (input.to.length === 0) return false;

  const baseFrom = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
  const from = input.fromName ? applyFromName(baseFrom, input.fromName) : baseFrom;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[email] Resend returned ${res.status}: ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[email] send failed:", err);
    return false;
  }
}

/**
 * Parse the per-client `owner_email` config (comma/semicolon/newline separated)
 * into a clean list of at most `max` valid-looking addresses. Invalid entries
 * are dropped rather than failing the whole send.
 */
export function parseRecipients(raw: string | null | undefined, max = 3): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const addr = part.trim();
    if (!addr || !isEmailLike(addr)) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
    if (out.length >= max) break;
  }
  return out;
}

// Pragmatic, not RFC-complete: one @, a dot in the domain, no whitespace.
function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Replace the display name on a "Name <addr@host>" (or bare "addr@host") From
 * string while keeping the verified sending address intact. Quotes are stripped
 * from the supplied name to keep the header well-formed.
 */
function applyFromName(baseFrom: string, name: string): string {
  const match = baseFrom.match(/<([^>]+)>/);
  const addr = (match ? match[1] : baseFrom).trim();
  const cleanName = name.replace(/["<>]/g, "").trim();
  return cleanName ? `${cleanName} <${addr}>` : addr;
}
