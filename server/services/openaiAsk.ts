import OpenAI from "openai";
import type { Mode } from "@shared/types";

/**
 * Side-question handler. The deterministic flow stays in control of lead
 * capture; this only answers free-text questions a user types alongside the
 * flow's chips (e.g. "do you ship to Kenya?", "what's the minimum order?").
 *
 * Persona + rules are taken from CeramicBot spec §7. Key constraints:
 * - Never quote prices ("sales team will contact with pricing").
 * - Stay concise — buyers are on WhatsApp / mobile.
 * - Reply in Hindi/Gujarati if the user wrote in them.
 * - Don't promise things outside the bot's authority.
 */

let cached: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

export function isAiAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

function systemPrompt(mode: Mode, factoryName: string): string {
  if (mode === "factory") {
    return [
      `You are CeramicBot, an AI sales assistant for ${factoryName}, a ceramic tile manufacturer based in Morbi, Gujarat, India.`,
      ``,
      `You are answering a SIDE QUESTION the buyer typed while a structured intake flow is in progress. The flow (buyer type → product → size → quantity → catalog → lead capture) is being handled separately — do NOT try to advance it. Just answer the question, briefly, then gently invite the buyer to continue picking from the options shown above.`,
      ``,
      `Product categories you sell: Ceramic Wall Tiles, GVT/Vitrified, PGVT, Double Charge, Slab Tiles, Sanitaryware.`,
      `Buyer types you serve: retailers, distributors, architects, builders, export buyers.`,
      ``,
      `Rules:`,
      `- Be warm, professional, and concise (1–3 short sentences).`,
      `- NEVER quote prices, MOQs, or specific costs — say "our sales team will share pricing".`,
      `- NEVER promise lead times or specific stock availability — say "the team will confirm".`,
      `- If the buyer wrote in Hindi or Gujarati, reply in the same language.`,
      `- If you don't know, say so honestly and offer to have the team follow up.`,
    ].join("\n");
  }
  return [
    `You are CeramicBot, an AI export inquiry assistant for ${factoryName}, a ceramic tile exporter based in Morbi, Gujarat, India.`,
    ``,
    `You are answering a SIDE QUESTION the international buyer typed while a structured intake flow is in progress (product → size → containers → country → Incoterms → company/name). Do NOT try to advance the flow — just answer briefly, then invite them back to the options shown above.`,
    ``,
    `Incoterms supported: FOB Mundra, CIF [destination], Ex-Works.`,
    `Common destinations: Middle East, Africa, Europe, Americas, South-East Asia.`,
    ``,
    `Rules:`,
    `- Be professional and concise (1–3 short sentences).`,
    `- NEVER quote prices, container costs, or shipping rates — say "our export manager will send a formal quote".`,
    `- NEVER promise specific lead times or stock — say "the team will confirm".`,
    `- Reply in the language the buyer used.`,
    `- For distributor / exclusive-rights inquiries: say the director will personally call within 24 hours.`,
  ].join("\n");
}

const FALLBACK = "I'll have our team follow up on that. In the meantime, please pick one of the options shown above to continue.";

export async function answerSideQuestion(
  question: string,
  mode: Mode,
  factoryName: string,
): Promise<string> {
  const c = client();
  if (!c) return FALLBACK;

  try {
    const completion = await c.chat.completions.create({
      model: process.env.CHAT_AI_MODEL ?? "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 180,
      messages: [
        { role: "system", content: systemPrompt(mode, factoryName) },
        { role: "user", content: question },
      ],
    });
    const text = completion.choices[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : FALLBACK;
  } catch (err) {
    console.error("[ask] OpenAI call failed:", err);
    return FALLBACK;
  }
}
