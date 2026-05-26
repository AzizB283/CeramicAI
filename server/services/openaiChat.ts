import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { LeadDraft, Mode, QuickReply, StepId } from "@shared/types";
import { STEP_INTENTS, MULTI_BUBBLE_STEPS } from "./stepIntents";

/**
 * LLM-narrated bot replies for the deterministic flow.
 *
 * The FSM still owns transitions, lead-field capture, and lead persistence.
 * This module just generates the bot's *words* for the current step, given:
 *   - the step's purpose (STEP_INTENTS)
 *   - what the bot has already said / what the buyer has typed (history)
 *   - what the buyer is about to choose from (quickReplies, so the LLM
 *     doesn't invent options that don't exist)
 *   - the lead accumulated so far (so the bot can call the buyer by name,
 *     reference their earlier answers, etc.)
 *
 * Reliability over novelty: if OpenAI is misconfigured, errors, or returns
 * a malformed response, we fall back to the deterministic copy from
 * shared/flows.ts. The demo never breaks because of a flaky LLM call.
 */

export interface ChatHistoryTurn {
  role: "user" | "bot";
  text: string;
}

export interface GenerateBotReplyContext {
  mode: Mode;
  stepId: StepId;
  factoryName: string;
  lead: LeadDraft;
  quickReplies: QuickReply[];
  history: ChatHistoryTurn[];
  /**
   * The deterministic copy from `shared/flows.ts` for this step (already
   * placeholder-rendered). Used as the safe fallback when OpenAI is
   * unavailable or returns garbage.
   */
  fallback: string[];
  /** Catalog handoff context — surfaced to the LLM at f_catalog / x_catalog. */
  catalogUrl?: string;
}

const HISTORY_TURNS = 10; // enough for short context, cheap on tokens

let cached: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

export function isAiAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// ── System prompts ──────────────────────────────────────────────────
//
// One per mode. Spec §7. Same constraints as openaiAsk.ts but explicitly
// framed as "you're driving a structured intake; the chips ARE the menu —
// don't invent options."

function systemPrompt(mode: Mode, factoryName: string): string {
  const shared = [
    `You are CeramicBot, an AI assistant for ${factoryName}, a ceramic tile manufacturer based in Morbi, Gujarat, India.`,
    ``,
    `You are running a structured buyer-intake conversation. The user interface shows quick-reply CHIPS the buyer can tap, plus a free-text input. The chips for THIS turn are listed in the user message below — your job is to write the bot's words that go with those chips. Do NOT invent option labels that aren't in the chip list. Do NOT ask multiple questions in one turn — ONE focused ask per turn.`,
    ``,
    `RULES (non-negotiable):`,
    `- Be warm, professional, and CONCISE. 1 sentence ideal, 2 max. No long paragraphs.`,
    `- NEVER quote prices, lead times, MOQs, or specific stock — say "our sales team will share pricing" or "our team will confirm".`,
    `- NEVER promise dates or specific availability you don't know.`,
    `- If the buyer wrote in Hindi or Gujarati in earlier turns, reply in the same language.`,
    `- If the buyer typed something off-topic, briefly acknowledge it (don't ignore them) then steer back to the current step.`,
    `- DO NOT include the chip labels in your reply — they're already shown as buttons. Just write the bot's question/statement.`,
    `- DO NOT use emojis except occasionally where the spec uses them (🏭 for factory greeting, 🇮🇳 for exporter greeting, 🔔 / 🚨 for owner alerts — but those are not yours to write).`,
  ];
  if (mode === "factory") {
    return [
      ...shared,
      ``,
      `MODE: Factory (domestic buyer). Buyer types are retailers / distributors / architects / builders / export buyers. Products: Ceramic Wall, GVT/Vitrified, PGVT, Double Charge, Slab, Sanitaryware.`,
    ].join("\n");
  }
  return [
    ...shared,
    ``,
    `MODE: Exporter (international buyer). Common destinations: Middle East, Africa, Europe, Americas, South-East Asia. Incoterms: FOB Mundra, CIF [destination port], Ex-Works. For distributor / exclusive-rights inquiries, the director personally calls within 24 hours.`,
  ].join("\n");
}

// ── Per-turn user message construction ──────────────────────────────

function leadSummary(lead: LeadDraft): string {
  const parts: string[] = [];
  if (lead.buyerType) parts.push(`buyerType: ${lead.buyerType}`);
  if (lead.intent) parts.push(`intent: ${lead.intent}`);
  if (lead.productCategory) parts.push(`productCategory: ${lead.productCategory}`);
  if (lead.productSize) parts.push(`productSize: ${lead.productSize}`);
  if (lead.productFinish) parts.push(`productFinish: ${lead.productFinish}`);
  if (lead.quantity) parts.push(`quantity: ${lead.quantity}`);
  if (lead.country) parts.push(`country: ${lead.country}`);
  if (lead.incoterms) parts.push(`incoterms: ${lead.incoterms}`);
  if (lead.buyerName) parts.push(`buyerName: ${lead.buyerName}`);
  if (lead.buyerCity) parts.push(`buyerCity: ${lead.buyerCity}`);
  if (lead.buyerCompany) parts.push(`buyerCompany: ${lead.buyerCompany}`);
  if (lead.distributorCountry) parts.push(`distributorCountry: ${lead.distributorCountry}`);
  if (lead.priority === "priority") parts.push(`PRIORITY LEAD`);
  return parts.length ? parts.join(", ") : "(empty)";
}

function buildUserMessage(ctx: GenerateBotReplyContext): string {
  const intent = STEP_INTENTS[ctx.stepId] ?? "Ask the buyer for the next piece of information.";
  const multi = MULTI_BUBBLE_STEPS.has(ctx.stepId);
  const chips = ctx.quickReplies.length
    ? ctx.quickReplies.map((r) => `"${r.label}"`).join(", ")
    : "(none — free text expected)";

  const parts: string[] = [
    `Step: ${ctx.stepId}`,
    `Intent: ${intent.replaceAll("{client}", ctx.factoryName)}`,
    `Chips shown this turn: ${chips}`,
    `Lead so far: ${leadSummary(ctx.lead)}`,
  ];
  if (ctx.catalogUrl) {
    parts.push(`Catalogue link being shown right now: ${ctx.catalogUrl}`);
  }
  parts.push(
    multi
      ? `OUTPUT: 2 short bot bubbles, separated by a single newline. Each bubble is one short sentence.`
      : `OUTPUT: exactly one short sentence as the bot's reply.`,
  );
  return parts.join("\n");
}

function historyToMessages(history: ChatHistoryTurn[]): ChatCompletionMessageParam[] {
  return history.slice(-HISTORY_TURNS).map((t) => ({
    role: t.role === "bot" ? ("assistant" as const) : ("user" as const),
    content: t.text,
  }));
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Generate the bot's reply for the current step.
 *
 * Returns an array of bot message bubbles (1 for most steps, 2+ for
 * MULTI_BUBBLE_STEPS). Always returns SOMETHING — falls back to the
 * deterministic copy from `shared/flows.ts` if OpenAI fails.
 */
export async function generateBotReply(ctx: GenerateBotReplyContext): Promise<string[]> {
  const c = client();
  if (!c) return ctx.fallback;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(ctx.mode, ctx.factoryName) },
    ...historyToMessages(ctx.history),
    { role: "user", content: buildUserMessage(ctx) },
  ];

  try {
    const completion = await c.chat.completions.create({
      model: process.env.CHAT_AI_MODEL ?? "gpt-4o-mini",
      temperature: 0.5,
      max_tokens: 200,
      messages,
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return ctx.fallback;

    // Split on double newline if the LLM produced multiple bubbles; trim
    // each. Empty lines are dropped.
    const bubbles = text
      .split(/\n{1,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    return bubbles.length ? bubbles : ctx.fallback;
  } catch (err) {
    console.error("[openaiChat] LLM call failed, using deterministic fallback:", err);
    return ctx.fallback;
  }
}
