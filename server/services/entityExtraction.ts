import OpenAI from "openai";
import type { LeadDraft, StepId } from "@shared/types";
import { STEPS } from "@shared/flows";
import { cleanFieldValue, looksUnclean } from "@shared/extract";

/**
 * Free-text entity extraction for lead fields.
 *
 * Two-stage, cheapest-first:
 *  1. `cleanFieldValue` (pure regex, in @shared/extract) strips common
 *     lead-ins like "my name is" / "I'm from". Runs always, instant, no cost.
 *  2. If the regex result still looks like a sentence (`looksUnclean`) AND an
 *     OpenAI key is configured, ask the LLM to pull out just the value.
 *
 * The LLM is a FALLBACK, not the default path — most answers are handled by
 * the regex alone, so we don't pay a token/latency cost per message. Any LLM
 * failure falls back to the regex result, so extraction never breaks the flow.
 *
 * Mirrors the deterministic-with-LLM-narration philosophy of the rest of the
 * bot: the flow stays in control; the LLM only sharpens a value.
 */

let cached: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

/** Human-readable description of what each field should contain, for the LLM. */
const FIELD_DESCRIPTION: Partial<Record<keyof LeadDraft, string>> = {
  buyerName: "the person's name only (first name, or first and last)",
  buyerCity: "the city name only",
  buyerCompany: "the company / business name only",
  country: "the country name only",
  distributorCountry: "the country name only",
};

/**
 * Extract the clean value for `field` from a buyer's free-text answer.
 * Returns the regex-cleaned value immediately when that's already clean (or
 * when no LLM is available); otherwise refines it with one short LLM call.
 */
export async function extractFieldValue(
  field: keyof LeadDraft | undefined,
  rawText: string,
): Promise<string> {
  const regexCleaned = cleanFieldValue(field, rawText);
  if (!field || !looksUnclean(field, regexCleaned)) return regexCleaned;

  const description = FIELD_DESCRIPTION[field];
  const c = client();
  if (!description || !c) return regexCleaned;

  try {
    const completion = await c.chat.completions.create({
      model: process.env.CHAT_AI_MODEL ?? "gpt-4o-mini",
      temperature: 0,
      max_tokens: 24,
      messages: [
        {
          role: "system",
          content: [
            `Extract ${description} from the user's message.`,
            `Reply with ONLY the extracted value — no quotes, no labels, no extra words.`,
            `If the message contains no such value, reply with the message unchanged.`,
            `Preserve the original spelling and script (including Hindi/Gujarati).`,
          ].join("\n"),
        },
        { role: "user", content: rawText.trim() },
      ],
    });
    const out = completion.choices[0]?.message?.content?.trim();
    if (!out) return regexCleaned;
    // Guard: the LLM occasionally echoes a refusal or a longer phrase. If its
    // answer isn't shorter/cleaner than the regex result, keep the regex one.
    const cleanedOut = cleanFieldValue(field, out);
    return cleanedOut.length > 0 && cleanedOut.length <= regexCleaned.length
      ? cleanedOut
      : regexCleaned;
  } catch (err) {
    console.error("[entityExtraction] LLM call failed, using regex result:", err);
    return regexCleaned;
  }
}

/**
 * Given the step the buyer is currently answering and their typed text, return
 * the text to feed into `advanceFlow` — extracted/cleaned when the step is a
 * free-text capture for a name-like field, otherwise the text unchanged.
 *
 * Returns undefined when there's no text (e.g. a chip tap), so callers can
 * pass it straight through to advanceFlow's `text` argument.
 */
export async function cleanIncomingText(
  stepId: StepId,
  text: string | undefined,
): Promise<string | undefined> {
  if (text === undefined) return undefined;
  const step = STEPS[stepId];
  // Only refine free-text steps that write to a lead field. Choice steps and
  // off-flow text are left untouched (the engine handles those paths).
  if (step?.input !== "text" || !step.field) return text;
  return extractFieldValue(step.field, text);
}
