import { useCallback, useRef, useState } from "react";
import type {
  ChatMessage,
  FlowStep,
  LeadDraft,
  Mode,
  QuickReply,
} from "@shared/types";
import {
  DEMO_CLIENT_NAME,
  ENTRY,
  STEPS,
} from "@shared/flows";

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;

/** Fill {client} / {name} placeholders in bot copy. */
function render(text: string, mode: Mode, lead: LeadDraft): string {
  return text
    .replaceAll("{client}", DEMO_CLIENT_NAME[mode])
    .replaceAll("{name}", lead.buyerName ?? "there");
}

export interface OwnerAlert {
  priority: boolean;
  lines: string[];
}

/**
 * Drives the demo conversation: holds the message thread, the current step,
 * the accumulated lead, typing state, and the simulated owner alert.
 *
 * In Phase 2 this hook is replaced by calls to POST /api/chat/message, but the
 * message/lead shapes stay the same (they live in @shared).
 */
export function useChatFlow(initialMode: Mode) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stepId, setStepId] = useState(ENTRY[initialMode]);
  const [lead, setLead] = useState<LeadDraft>({});
  const [typing, setTyping] = useState(false);
  const [ownerAlert, setOwnerAlert] = useState<OwnerAlert | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  /** Emit a step's bot bubbles one-by-one with a typing indicator between. */
  const playStep = useCallback(
    (step: FlowStep, currentMode: Mode, currentLead: LeadDraft) => {
      clearTimers();
      let delay = 0;
      step.bot.forEach((line, i) => {
        setTyping(true);
        const t1 = setTimeout(() => {
          setMessages((m) => [
            ...m,
            { id: nextId(), role: "bot", text: render(line, currentMode, currentLead) },
          ]);
          if (i === step.bot.length - 1) setTyping(false);
        }, delay + 650);
        timers.current.push(t1);
        delay += 650 + Math.min(line.length * 12, 500);
      });
    },
    [],
  );

  /** Build the owner-alert panel for a terminal step (spec §3 owner alerts). */
  const buildOwnerAlert = useCallback(
    (currentMode: Mode, l: LeadDraft): OwnerAlert => {
      const priority =
        l.intent === "distributor" || l.exclusiveRights === "YES";
      if (currentMode === "factory") {
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
    },
    [],
  );

  const goTo = useCallback(
    (id: typeof stepId, currentMode: Mode, currentLead: LeadDraft) => {
      const step = STEPS[id];
      setStepId(id);
      playStep(step, currentMode, currentLead);
      if (step.terminal) {
        const alert = buildOwnerAlert(currentMode, currentLead);
        const t = setTimeout(() => setOwnerAlert(alert), 1400);
        timers.current.push(t);
      }
    },
    [playStep, buildOwnerAlert],
  );

  /** Begin (or restart) the conversation for a mode. */
  const start = useCallback(
    (m: Mode) => {
      clearTimers();
      setMode(m);
      setMessages([]);
      setLead({});
      setOwnerAlert(null);
      goTo(ENTRY[m], m, {});
    },
    [goTo],
  );

  /** User tapped a quick-reply chip. */
  const chooseOption = useCallback(
    (opt: QuickReply) => {
      const step = STEPS[stepId];
      const echo = opt.label;
      const updated: LeadDraft = { ...lead };
      if (step.field) updated[step.field] = (opt.value ?? opt.label) as never;
      if (opt.priority) updated.priority = "priority";
      setLead(updated);
      setMessages((m) => [...m, { id: nextId(), role: "user", text: echo }]);

      const next = opt.next ?? step.next;
      if (!next) return;
      if (next === ENTRY[mode] && step.terminal) {
        start(mode); // "Start over"
        return;
      }
      goTo(next, mode, updated);
    },
    [stepId, lead, mode, goTo, start],
  );

  /** User submitted free text. */
  const submitText = useCallback(
    (value: string) => {
      const step = STEPS[stepId];
      const trimmed = value.trim();
      if (!trimmed) return;
      const updated: LeadDraft = { ...lead };
      if (step.field) updated[step.field] = trimmed as never;
      setLead(updated);
      setMessages((m) => [...m, { id: nextId(), role: "user", text: trimmed }]);
      if (step.next) goTo(step.next, mode, updated);
    },
    [stepId, lead, mode, goTo],
  );

  return {
    mode,
    messages,
    step: STEPS[stepId],
    lead,
    typing,
    ownerAlert,
    start,
    chooseOption,
    submitText,
  };
}
