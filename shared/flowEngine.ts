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
  terminal: boolean;
  ownerAlert: OwnerAlert | null;
}

export interface AdvanceInput {
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
  choiceLabel?: string;
  text?: string;
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

function snapshot(mode: Mode, stepId: StepId, lead: LeadDraft): FlowSnapshot {
  const step = STEPS[stepId];
  return {
    stepId,
    lead,
    botMessages: step.bot.map((line) => render(line, mode, lead)),
    quickReplies: step.options ?? [],
    inputKind: step.input === "text" ? "text" : "choice",
    placeholder: step.placeholder,
    catalog: step.catalog,
    terminal: !!step.terminal,
    ownerAlert: step.terminal ? buildOwnerAlert(mode, lead) : null,
  };
}

/** Begin (or restart) the conversation for a mode. */
export function startFlow(mode: Mode): FlowSnapshot {
  return snapshot(mode, ENTRY[mode], {});
}

/**
 * Advance the conversation by one user action (a chip choice or free text).
 * Returns the resulting snapshot. Invalid input (unknown chip, empty text)
 * returns the current step unchanged.
 */
export function advanceFlow(input: AdvanceInput): FlowSnapshot {
  const { mode, stepId, choiceLabel, text } = input;
  const step = STEPS[stepId];
  const lead: LeadDraft = { ...input.lead };

  if (choiceLabel !== undefined) {
    const opt = (step.options ?? []).find((o) => o.label === choiceLabel);
    if (!opt) return snapshot(mode, stepId, lead);
    if (step.field) lead[step.field] = (opt.value ?? opt.label) as never;
    if (opt.priority) lead.priority = "priority";
    const next = opt.next ?? step.next;
    if (!next) return snapshot(mode, stepId, lead);
    if (next === ENTRY[mode] && step.terminal) return startFlow(mode);
    return snapshot(mode, next, lead);
  }

  if (text !== undefined) {
    const trimmed = text.trim();
    if (!trimmed) return snapshot(mode, stepId, lead);
    if (step.field) lead[step.field] = trimmed as never;
    if (step.next) return snapshot(mode, step.next, lead);
    return snapshot(mode, stepId, lead);
  }

  return snapshot(mode, stepId, lead);
}
