import type { LeadDraft, StepId } from "@shared/types";

// Permissive on purpose. International phone numbers are wildly varied; we
// don't want to reject "+91 (98765) 43-210" or "+1.555.0123". We just want
// to catch obvious junk like "abc" or "123".
const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;
const PHONE_DIGITS_MIN = 7;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidPhone(value: string): boolean {
  const v = value.trim();
  if (!PHONE_RE.test(v)) return false;
  const digits = v.replace(/\D/g, "");
  return digits.length >= PHONE_DIGITS_MIN;
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/**
 * The chat routes call this AFTER the engine advances. If the buyer's last
 * input filled a contact field with garbage, we want to stay on the same
 * step and re-prompt — but only ONCE per step, so a determined buyer who
 * keeps typing "asdf" eventually gets to the terminal step (we'd rather
 * have a junk email on the lead than lose the lead entirely).
 *
 * Returns the action the caller should take:
 *   - "accept": value is valid OR we already re-asked once — let the flow proceed.
 *   - "reask": value is invalid, FIRST attempt — caller should un-write the
 *     field on `lead`, stay on `priorStepId`, and prepend `message` to the
 *     bot's reply.
 */
export type ValidationOutcome =
  | { action: "accept" }
  | { action: "reask"; field: "buyerPhone" | "buyerEmail"; message: string };

export function validateContactTurn(
  priorStepId: StepId,
  lead: LeadDraft,
  retries: Map<StepId, number>,
): ValidationOutcome {
  const field = fieldForStep(priorStepId);
  if (!field) return { action: "accept" };

  const raw = lead[field];
  if (typeof raw !== "string" || raw.trim() === "") return { action: "accept" };

  const valid = field === "buyerPhone" ? isValidPhone(raw) : isValidEmail(raw);
  if (valid) return { action: "accept" };

  // Already re-asked once on this step — accept whatever they gave rather
  // than trap them in a loop (lead capture > perfect data).
  if ((retries.get(priorStepId) ?? 0) >= 1) return { action: "accept" };

  // First fail → re-ask. Bump the counter and tell the caller to stay put.
  retries.set(priorStepId, (retries.get(priorStepId) ?? 0) + 1);
  return {
    action: "reask",
    field,
    message:
      field === "buyerPhone"
        ? "Hmm, that doesn't look like a valid phone number — could you share it again?"
        : "Hmm, that doesn't look like a valid email — could you try again?",
  };
}

/** Which contact-validated step this stepId is, if any. */
function fieldForStep(stepId: StepId): "buyerPhone" | "buyerEmail" | null {
  if (stepId === "f_phone" || stepId === "x_phone" || stepId === "x_dist_phone")
    return "buyerPhone";
  if (stepId === "f_email" || stepId === "x_email" || stepId === "x_dist_email")
    return "buyerEmail";
  return null;
}
