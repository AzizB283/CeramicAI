/**
 * Lightweight, deterministic entity extraction for free-text answers.
 *
 * Buyers rarely answer a "What's your name?" prompt with a bare token — they
 * type "My name is Rajesh", "I'm Aziz from Morbi Tiles", "this is Priya here".
 * Storing that whole sentence as the lead's name (or city / company) is wrong.
 *
 * This module strips common conversational lead-ins so the lead field holds
 * the actual value. It is PURE (no IO, no LLM) so the flow engine — shared by
 * the web client and the WhatsApp webhook — can apply it on every channel with
 * zero latency. When the regex can't confidently clean the input, the server
 * may additionally run an LLM pass (see server/services/entityExtraction.ts);
 * this stays the cheap, always-on first line.
 *
 * `field` keys mirror LeadDraft. Only the "personal noun" fields
 * (name / city / company / country) get lead-in stripping; everything else is
 * returned trimmed but otherwise untouched.
 */

import type { LeadDraft } from "./types";

/** Lead fields that hold a short proper noun a buyer might wrap in a sentence. */
const NOUN_FIELDS = new Set<keyof LeadDraft>([
  "buyerName",
  "buyerCity",
  "buyerCompany",
  "country",
  "distributorCountry",
]);

/**
 * Lead-in phrases buyers prepend before the actual value. Ordered roughly by
 * specificity; each is matched case-insensitively at the START of the string.
 * The trailing `[:\-]?\s*` swallows an optional separator ("name: Rajesh").
 */
const LEAD_IN_PATTERNS: RegExp[] = [
  /^(?:my\s+name\s+is)\b[:\-]?\s*/i,
  /^(?:name\s+is)\b[:\-]?\s*/i,
  /^(?:the\s+name\s+is)\b[:\-]?\s*/i,
  /^(?:my\s+name['’]?s)\b[:\-]?\s*/i,
  /^(?:i\s+am)\b[:\-]?\s*/i,
  /^(?:i['’]?m)\b[:\-]?\s*/i,
  /^(?:this\s+is)\b[:\-]?\s*/i,
  /^(?:it['’]?s)\b[:\-]?\s*/i,
  /^(?:name)\s*[:\-]\s*/i, // only with a separator, so "Nameet" isn't stripped
  /^(?:i\s+live\s+in)\b[:\-]?\s*/i,
  /^(?:i['’]?m\s+from)\b[:\-]?\s*/i,
  /^(?:i\s+am\s+from)\b[:\-]?\s*/i,
  /^(?:we\s+are)\b[:\-]?\s*/i,
  /^(?:we['’]?re)\b[:\-]?\s*/i,
  /^(?:company\s+is)\b[:\-]?\s*/i,
  /^(?:company\s+name\s+is)\b[:\-]?\s*/i,
  /^(?:our\s+company\s+is)\b[:\-]?\s*/i,
  /^(?:from)\b[:\-]?\s*/i,
];

/**
 * Trailing fragments that follow the value but aren't part of it
 * ("Aziz from Morbi Tiles" when we only want "Aziz" for the name field).
 * Conservative — only cuts at an explicit " from " / " here " / " speaking".
 */
const TRAILING_PATTERNS: RegExp[] = [
  /\s+from\s+.*$/i,
  /\s+here\b.*$/i,
  /\s+speaking\b.*$/i,
  /\s+this\s+side\b.*$/i,
];

/** Strip a leading "my name is"-style phrase, if present. */
function stripLeadIn(text: string): string {
  let out = text;
  // Apply at most one lead-in (the first that matches) so we don't over-strip.
  for (const re of LEAD_IN_PATTERNS) {
    if (re.test(out)) {
      out = out.replace(re, "");
      break;
    }
  }
  return out;
}

/** Strip a trailing " from X" / " here" fragment, if present. */
function stripTrailing(text: string): string {
  let out = text;
  for (const re of TRAILING_PATTERNS) {
    out = out.replace(re, "");
  }
  return out;
}

/** Drop a trailing sentence-final period / comma left after stripping. */
function trimPunctuation(text: string): string {
  return text.replace(/^[\s,.;:]+/, "").replace(/[\s,.;:]+$/, "");
}

/**
 * Clean a free-text answer for the given lead field. For "noun" fields this
 * strips conversational lead-ins/trailers; for all other fields it just trims.
 * Always returns a non-empty string when given non-empty input — if stripping
 * would empty the value, the original (trimmed) text is kept.
 */
export function cleanFieldValue(
  field: keyof LeadDraft | undefined,
  rawText: string,
): string {
  const trimmed = rawText.trim();
  if (!field || !NOUN_FIELDS.has(field)) return trimmed;

  const stripped = trimPunctuation(stripTrailing(stripLeadIn(trimmed)));
  // Never return empty (e.g. the buyer literally typed "my name is") — keep
  // the original so we don't drop a captured answer entirely.
  return stripped.length > 0 ? stripped : trimmed;
}

/**
 * Heuristic: does this cleaned value still look like a sentence rather than a
 * bare name/place? Used by the server to decide whether to escalate to an LLM
 * extraction pass. A clean name is typically 1–3 words; anything longer (or
 * still containing obvious filler) is worth a second look.
 */
export function looksUnclean(field: keyof LeadDraft | undefined, value: string): boolean {
  if (!field || !NOUN_FIELDS.has(field)) return false;
  const words = value.trim().split(/\s+/);
  if (words.length > 4) return true;
  // Residual filler words that a clean proper noun wouldn't contain.
  return /\b(?:is|am|are|the|please|want|need|looking|inquiry|number)\b/i.test(value);
}
