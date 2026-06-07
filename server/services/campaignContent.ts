/**
 * Campaign content: template rendering, optional LLM personalization, and
 * inbound reply-intent triage.
 *
 * Two layers, deterministic-first (matching the repo's LLM ethos):
 *   1. renderTemplate — pure {{token}} substitution. ALWAYS runs; this is the
 *      email that goes out. No network, no failure mode.
 *   2. personalizeBody — an OPTIONAL LLM rewrite for warmth, gated on the
 *      campaign's aiPersonalize flag. Falls back to the rendered template on
 *      any error, so a flaky LLM never blocks a send.
 *
 * triageReply classifies a buyer's reply so the report can headline the
 * north-star metric (sample requests) and the scheduler can auto-stop the
 * sequence. Deterministic keyword fallback when the LLM is unavailable.
 */
import OpenAI from "openai";

let cached: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

export interface ContactTokens {
  name?: string | null;
  company?: string | null;
  country?: string | null;
  city?: string | null;
  buyerType?: string | null;
  /** The (tracked) catalogue URL, substituted for {{catalogue}}. */
  catalogue?: string | null;
}

// First name only for {{name}} (a cold email saying "Hi Aisha" beats "Hi Aisha
// Khan, Procurement Head"). Falls back to company, then a neutral greeting word.
function firstName(tokens: ContactTokens): string {
  const n = (tokens.name ?? "").trim();
  if (n) return n.split(/\s+/)[0];
  if (tokens.company) return tokens.company.trim();
  return "there";
}

/**
 * Substitute {{tokens}} in a template. Recognised: {{name}} {{firstName}}
 * {{company}} {{country}} {{city}} {{buyerType}} {{catalogue}}. Unknown tokens
 * are left as-is (so a typo is visible in preview, not silently blanked).
 */
export function renderTemplate(template: string, tokens: ContactTokens): string {
  const map: Record<string, string> = {
    name: (tokens.name ?? "").trim() || firstName(tokens),
    firstname: firstName(tokens),
    company: (tokens.company ?? "").trim(),
    country: (tokens.country ?? "").trim(),
    city: (tokens.city ?? "").trim(),
    buyertype: (tokens.buyerType ?? "").trim(),
    catalogue: (tokens.catalogue ?? "").trim(),
    catalog: (tokens.catalogue ?? "").trim(),
  };
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (whole, key: string) => {
    const v = map[key.toLowerCase()];
    return v !== undefined ? v : whole;
  });
}

/**
 * Optionally rewrite the rendered body to feel personally written for this
 * buyer, WITHOUT inventing facts or quoting prices (spec §7). Returns the input
 * unchanged if the LLM is unavailable or errors. The catalogue URL/token must
 * survive verbatim — we pass it and instruct the model to keep it intact, then
 * guard by re-inserting if it went missing.
 */
export async function personalizeBody(
  renderedBody: string,
  tokens: ContactTokens,
  opts: { factoryName: string; mode: "factory" | "exporter" },
): Promise<string> {
  const c = client();
  if (!c) return renderedBody;
  try {
    const completion = await c.chat.completions.create({
      model: process.env.CHAT_AI_MODEL ?? "gpt-4o-mini",
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            `You rewrite a B2B outreach email from ${opts.factoryName}, a ceramic tile ` +
            `${opts.mode === "exporter" ? "exporter" : "manufacturer"} in Morbi, India, to a ` +
            `prospective buyer. Make it warm, concise, and specific to the buyer, but: ` +
            `do NOT invent facts, do NOT quote prices (say the sales team will share pricing), ` +
            `keep it under 130 words, keep any URL exactly as given, and keep a clear call to action. ` +
            `Return ONLY the email body text, no subject, no signature block beyond what's given.`,
        },
        {
          role: "user",
          content:
            `Buyer: ${tokens.name ?? "unknown"}${tokens.company ? `, ${tokens.company}` : ""}` +
            `${tokens.country ? `, ${tokens.country}` : ""}` +
            `${tokens.buyerType ? ` (${tokens.buyerType})` : ""}.\n\n` +
            `Current draft to improve:\n${renderedBody}`,
        },
      ],
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (!out) return renderedBody;
    // Guard: if a catalogue URL was present and the model dropped it, append it.
    const url = (tokens.catalogue ?? "").trim();
    if (url && !out.includes(url)) return `${out}\n\n${url}`;
    return out;
  } catch (err) {
    console.warn("[campaignContent] personalize failed, using template:", err);
    return renderedBody;
  }
}

// ── reply-intent triage ─────────────────────────────────────────────────
export type ReplyIntent =
  | "sample_request"
  | "hot"
  | "lukewarm"
  | "not_now"
  | "wrong_person"
  | "unsubscribe";

const VALID_INTENTS: ReplyIntent[] = [
  "sample_request",
  "hot",
  "lukewarm",
  "not_now",
  "wrong_person",
  "unsubscribe",
];

/** Deterministic keyword fallback when the LLM is unavailable. */
export function triageReplyHeuristic(text: string): ReplyIntent {
  const t = text.toLowerCase();
  if (/\b(unsubscribe|remove me|stop emailing|opt out|do not contact)\b/.test(t)) return "unsubscribe";
  if (/\b(sample|samples|swatch|send me a piece|trial order)\b/.test(t)) return "sample_request";
  if (/\b(wrong (person|department)|not the right|forwarded|no longer with)\b/.test(t)) return "wrong_person";
  if (/\b(quote|price|pricing|catalog|catalogue|interested|send (me )?(details|more)|call me|whatsapp)\b/.test(t))
    return "hot";
  if (/\b(later|next (month|quarter|year)|not (right )?now|maybe|future|busy)\b/.test(t)) return "not_now";
  return "lukewarm";
}

/**
 * Classify a buyer's reply into a ReplyIntent. Uses the LLM when available and
 * validates the label; falls back to the keyword heuristic otherwise. Never
 * throws.
 */
export async function triageReply(text: string): Promise<ReplyIntent> {
  const c = client();
  if (!c || !text.trim()) return triageReplyHeuristic(text);
  try {
    const completion = await c.chat.completions.create({
      model: process.env.CHAT_AI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
      max_tokens: 10,
      messages: [
        {
          role: "system",
          content:
            "Classify a reply to a B2B ceramic-tile outreach email into exactly one label: " +
            "sample_request (asks for samples/swatches), hot (wants a quote/catalogue/call — " +
            "clearly interested), lukewarm (vague interest), not_now (interested later), " +
            "wrong_person (wrong contact/department), unsubscribe (wants to stop). " +
            "Reply with ONLY the label.",
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
    });
    const raw = (completion.choices[0]?.message?.content ?? "").trim().toLowerCase();
    const match = VALID_INTENTS.find((i) => raw.includes(i));
    return match ?? triageReplyHeuristic(text);
  } catch (err) {
    console.warn("[campaignContent] triage failed, using heuristic:", err);
    return triageReplyHeuristic(text);
  }
}
