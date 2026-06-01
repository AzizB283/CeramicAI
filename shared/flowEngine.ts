/**
 * Pure, framework-free flow engine for the CeramicBot demo conversation.
 *
 * This module owns the *logic* of walking the FlowStep graph: which step is
 * next, what lead field a choice/text writes, placeholder rendering, and the
 * terminal owner-alert payload. It has NO React / Express / IO dependencies so
 * both the client hook and the Phase 2 server can import it and stay in sync.
 *
 * The functions are stateless: callers pass in the current { mode, stepId, lead }
 * and receive a fresh FlowSnapshot. Nothing is mutated.
 */

import type { LeadDraft, Mode, QuickReply, StepId } from "./types";
import { DEMO_CLIENT_NAME, ENTRY, STEPS } from "./flows";
import { cleanFieldValue } from "./extract";

/**
 * Per-factory product configuration. The server loads this from
 * ceramic_products and passes it into start/advance — when present, the
 * engine swaps the hardcoded option lists on `f_product` / `x_product` /
 * `f_size` / `f_finish` / `f_sani_item` / `x_sani_item` steps for the
 * factory's actual offerings, and reroutes "sanitaryware" through the
 * sub-item step (skipping size/finish, which are tile-only).
 *
 * Empty/missing config = use the hardcoded defaults in flows.ts. This
 * keeps the demo working for un-configured tenants.
 */
export interface ProductCategoryConfig {
  /**
   * Stable identifier used as the chip's `value` and as the key for
   * sizes/finishes lookup. For the 6 standard categories this is the canonical
   * slug ("gvt", "pgvt", …); for factory-defined custom categories it's a
   * synthetic per-row id ("custom:42") so multiple custom rows don't collide.
   */
  value: string;
  /** Chip label shown to the buyer. */
  label: string;
}

export interface ProductConfig {
  /** Categories the factory sells, with their stable values and display labels. */
  categories: ProductCategoryConfig[];
  /** Sizes the factory offers per category value. Empty array = fall back to defaults. */
  sizesByCategory: Record<string, string[]>;
  /** Finishes the factory offers per category value. Empty array = fall back to defaults. */
  finishesByCategory: Record<string, string[]>;
  /** Sanitaryware sub-items the factory sells. Empty array = fall back to defaults. */
  sanitaryItems: string[];
}

export interface OwnerAlert {
  priority: boolean;
  lines: string[];
}

export interface FlowSnapshot {
  stepId: StepId;
  lead: LeadDraft;
  botMessages: string[]; // already placeholder-rendered
  quickReplies: QuickReply[];
  inputKind: "choice" | "text";
  placeholder?: string;
  catalog?: "factory" | "export";
  /**
   * The actual catalogue link to share with the buyer when `catalog` is set.
   * The server picks this from `ceramic_catalogues` based on the lead's
   * mode/category/size/finish, falling back to the client's default catalog
   * URL. If absent, the client should fall back to a hardcoded placeholder.
   */
  catalogUrl?: string;
  terminal: boolean;
  ownerAlert: OwnerAlert | null;
  /** Set when advanceFlow took the "Start over" path; tells the caller to reset. */
  startOver: boolean;
}

export interface AdvanceInput {
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
  choiceLabel?: string;
  text?: string;
  products?: ProductConfig;
}

/** Fill {client} / {name} placeholders in bot copy. */
function render(text: string, mode: Mode, lead: LeadDraft): string {
  return text
    .replaceAll("{client}", DEMO_CLIENT_NAME[mode])
    .replaceAll("{name}", lead.buyerName ?? "there");
}

/** Build the owner-alert panel for a terminal step (spec §3 owner alerts). */
function buildOwnerAlert(mode: Mode, l: LeadDraft): OwnerAlert {
  const priority = l.intent === "distributor" || l.exclusiveRights === "YES";
  if (mode === "factory") {
    return {
      priority: false,
      lines: [
        `🔔 New Lead — ${DEMO_CLIENT_NAME.factory}`,
        `Name: ${l.buyerName ?? "—"}`,
        `Type: ${l.buyerType ?? "—"} | City: ${l.buyerCity ?? "—"}`,
        `Product: ${l.productCategory ?? "—"} ${l.productSize ?? ""} ${l.productFinish ?? ""}`.trim(),
        `Volume: ${l.quantity ?? "—"}`,
        `WhatsApp: +91XXXXXXXXXX`,
      ],
    };
  }
  if (priority) {
    return {
      priority: true,
      lines: [
        `🚨 PRIORITY LEAD — ${DEMO_CLIENT_NAME.exporter}`,
        `Name: ${l.buyerName ?? "—"}`,
        `Company: ${l.buyerCompany ?? "—"}`,
        `Country: ${l.distributorCountry ?? l.country ?? "—"}`,
        `Annual volume: ${l.annualVolume ?? "—"}`,
        `Exclusive rights: ${l.exclusiveRights ?? "—"}`,
        `WhatsApp: +000XXXXXXXXXX`,
        `→ Call within 24 hours`,
      ],
    };
  }
  return {
    priority: false,
    lines: [
      `🔔 New Export Lead — ${DEMO_CLIENT_NAME.exporter}`,
      `Name: ${l.buyerName ?? "—"}`,
      `Company: ${l.buyerCompany ?? "—"}`,
      `Product: ${l.productCategory ?? l.sampleProduct ?? "—"} ${l.productSize ?? ""}`.trim(),
      `Quantity: ${l.quantity ?? l.sampleQty ?? "—"}`,
      `Country: ${l.country ?? "—"} | Terms: ${l.incoterms ?? "—"}`,
      `WhatsApp: +000XXXXXXXXXX`,
    ],
  };
}

/**
 * Resolve the quick-reply chips for a given step, applying per-factory
 * product config when set. The static `step.options` are the fallback used
 * when products aren't configured.
 *
 * Returns the static options unchanged for steps that aren't product-driven
 * (welcome, quantity, country, incoterms, etc.).
 */
function resolveOptions(
  stepId: StepId,
  staticOptions: QuickReply[] | undefined,
  lead: LeadDraft,
  products?: ProductConfig,
): QuickReply[] {
  const fallback = staticOptions ? [...staticOptions] : [];
  if (!products) return fallback;

  // Product category steps: emit chips from the factory's configured list.
  // The static `step.options` are not used here — the factory's choices fully
  // define which categories the buyer sees (standard + custom).
  if (stepId === "f_product" || stepId === "x_product") {
    if (products.categories.length === 0) return fallback;
    return products.categories.map((c) => ({ label: c.label, value: c.value }));
  }

  // Size step: chips depend on the category the user just picked.
  if (stepId === "f_size") {
    const cat = lead.productCategory;
    const sizes = cat ? products.sizesByCategory[cat] : undefined;
    if (!sizes || sizes.length === 0) return fallback;
    return sizes.map((s) => ({ label: s }));
  }

  // Finish step: same — per-category.
  if (stepId === "f_finish") {
    const cat = lead.productCategory;
    const finishes = cat ? products.finishesByCategory[cat] : undefined;
    if (!finishes || finishes.length === 0) return fallback;
    return finishes.map((f) => ({ label: f }));
  }

  // Sanitaryware sub-items (both modes).
  if (stepId === "f_sani_item" || stepId === "x_sani_item") {
    if (products.sanitaryItems.length === 0) return fallback;
    return products.sanitaryItems.map((s) => ({ label: s }));
  }

  return fallback;
}

/**
 * Steps that are safe to auto-skip when their `field` is already populated.
 * Used to avoid asking the WhatsApp buyer for their phone when the sender
 * header already gave us one. Whitelist (not "any filled field") because
 * most steps SHOULD re-ask if the value happens to match — only contact-info
 * steps are truly idempotent.
 */
const SKIPPABLE_IF_FIELD_SET = new Set<StepId>(["f_phone", "x_phone", "x_dist_phone"]);

function resolveStep(
  stepId: StepId,
  lead: LeadDraft,
  products?: ProductConfig,
  guard = 6,
): { stepId: StepId; lead: LeadDraft } {
  // Walk forward through any auto-skippable steps whose field is already set.
  // `guard` caps the walk so a misconfigured graph can't infinite-loop here.
  let current = stepId;
  let walked = lead;
  for (let i = 0; i < guard; i++) {
    const step = STEPS[current];
    const field = step.field;
    if (
      SKIPPABLE_IF_FIELD_SET.has(current) &&
      field &&
      typeof walked[field] === "string" &&
      (walked[field] as string).trim() !== "" &&
      step.next
    ) {
      current = step.next;
      continue;
    }
    break;
  }
  return { stepId: current, lead: walked };
  void products; // products only matter for option rendering, not skip walk
}

function snapshot(
  mode: Mode,
  stepId: StepId,
  lead: LeadDraft,
  products?: ProductConfig,
): FlowSnapshot {
  // Auto-skip steps that ask for info we already have (e.g. WhatsApp has the
  // sender's phone, so f_phone is skipped).
  const resolved = resolveStep(stepId, lead, products);
  const step = STEPS[resolved.stepId];
  return {
    stepId: resolved.stepId,
    lead: resolved.lead,
    botMessages: step.bot.map((line) => render(line, mode, resolved.lead)),
    quickReplies: resolveOptions(resolved.stepId, step.options, resolved.lead, products),
    inputKind: step.input === "text" ? "text" : "choice",
    placeholder: step.placeholder,
    catalog: step.catalog,
    terminal: !!step.terminal,
    ownerAlert: step.terminal ? buildOwnerAlert(mode, resolved.lead) : null,
    startOver: false,
  };
}

/**
 * Decide where to go after the user picks a category. Sanitaryware reroutes
 * through the sub-item step (which asks "which item?" instead of size/finish).
 * Other categories follow the static `next`.
 */
function rerouteAfterCategory(mode: Mode, lead: LeadDraft, staticNext: StepId | undefined): StepId | undefined {
  if (lead.productCategory === "sanitaryware") {
    return mode === "factory" ? "f_sani_item" : "x_sani_item";
  }
  return staticNext;
}

/** Begin (or restart) the conversation for a mode. */
export function startFlow(mode: Mode, products?: ProductConfig): FlowSnapshot {
  return snapshot(mode, ENTRY[mode], {}, products);
}

/**
 * Advance the conversation by one user action (a chip choice or free text).
 * Returns the resulting snapshot. Invalid input (unknown chip, empty text)
 * returns the current step unchanged.
 */
export function advanceFlow(input: AdvanceInput): FlowSnapshot {
  const { mode, stepId, text, products } = input;
  const step = STEPS[stepId];
  const lead: LeadDraft = { ...input.lead };

  // On a CHOICE step, a buyer who types (instead of tapping a chip) may have
  // typed a chip's exact label — e.g. "Retailer" on WhatsApp. Treat that as if
  // they tapped it. If the typed text matches no chip, fall through: we must
  // NOT write arbitrary text ("Hi") into the choice field. The text branch
  // below then leaves the field untouched and re-prompts.
  let choiceLabel = input.choiceLabel;
  if (choiceLabel === undefined && text !== undefined && step.input === "choice") {
    const typed = text.trim();
    const resolved = resolveOptions(stepId, step.options, lead, products);
    const match =
      resolved.find((o) => o.label.toLowerCase() === typed.toLowerCase()) ??
      (step.options ?? []).find((o) => o.label.toLowerCase() === typed.toLowerCase());
    if (match) choiceLabel = match.label;
  }

  if (choiceLabel !== undefined) {
    // Look up against the *resolved* options (which may be the per-factory
    // ones) so a chip the buyer actually sees can be matched.
    const resolvedOptions = resolveOptions(stepId, step.options, lead, products);
    let opt = resolvedOptions.find((o) => o.label === choiceLabel);
    // Fall back to the static option list too — handy when the LLM proposes
    // a chip label the user picks but the resolved list didn't contain.
    if (!opt) opt = (step.options ?? []).find((o) => o.label === choiceLabel);
    if (!opt) return snapshot(mode, stepId, lead, products);
    // skipField = an opt-out for chips like "Skip" on an optional text step
    // (e.g. f_email's Skip shouldn't store "Skip" as the buyer's email).
    if (step.field && !opt.skipField) lead[step.field] = (opt.value ?? opt.label) as never;
    if (opt.priority) lead.priority = "priority";
    let next = opt.next ?? step.next;
    // After picking a product category, reroute through the sanitaryware
    // sub-item step when applicable. Other category picks follow `next`.
    if (stepId === "f_product" || stepId === "x_product") {
      next = rerouteAfterCategory(mode, lead, next);
    }
    if (!next) return snapshot(mode, stepId, lead, products);
    if (next === ENTRY[mode] && step.terminal)
      return { ...startFlow(mode, products), startOver: true };
    return snapshot(mode, next, lead, products);
  }

  if (text !== undefined) {
    const trimmed = text.trim();
    if (!trimmed) return snapshot(mode, stepId, lead, products);
    // On a choice step, unmatched free text is an off-flow message (a greeting
    // like "Hi", or a side-question). Don't store it as the field value and
    // don't advance — stay on the step so the buyer is re-prompted with chips.
    if (step.input === "choice") return snapshot(mode, stepId, lead, products);
    if (step.field) {
      // Strip conversational lead-ins ("my name is Rajesh" → "Rajesh") so the
      // lead field holds the value, not the sentence. Pure + always-on; the
      // server may further refine name-like fields via LLM before this runs.
      lead[step.field] = cleanFieldValue(step.field, trimmed) as never;
    }
    if (step.next) return snapshot(mode, step.next, lead, products);
    return snapshot(mode, stepId, lead, products);
  }

  return snapshot(mode, stepId, lead, products);
}
