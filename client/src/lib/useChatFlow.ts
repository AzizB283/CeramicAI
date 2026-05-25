import { useCallback, useRef, useState } from "react";
import type {
  ChatMessage,
  LeadDraft,
  Mode,
  QuickReply,
} from "@shared/types";
import { ENTRY, STEPS } from "@shared/flows";
import {
  advanceFlow,
  startFlow,
  type FlowSnapshot,
  type OwnerAlert,
} from "@shared/flowEngine";

export type { OwnerAlert };

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;

/**
 * Drives the demo conversation: holds the message thread, the current step,
 * the accumulated lead, typing state, and the simulated owner alert.
 *
 * The pure flow logic (which step is next, what lead field to set, placeholder
 * rendering, owner-alert payload) lives in `@shared/flowEngine` so the Phase 2
 * server shares it. This hook only owns the UI concerns: the message thread,
 * the typing-dots timers, and mapping snapshots to bubbles.
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

  /**
   * Apply a snapshot to the UI: emit its bot bubbles one-by-one with a typing
   * indicator between, update step/lead, and schedule the owner alert.
   */
  const playSnapshot = useCallback((snap: FlowSnapshot) => {
    clearTimers();
    setStepId(snap.stepId);
    setLead(snap.lead);

    let delay = 0;
    snap.botMessages.forEach((line, i) => {
      setTyping(true);
      const t1 = setTimeout(() => {
        setMessages((m) => [...m, { id: nextId(), role: "bot", text: line }]);
        if (i === snap.botMessages.length - 1) setTyping(false);
      }, delay + 650);
      timers.current.push(t1);
      delay += 650 + Math.min(line.length * 12, 500);
    });

    if (snap.terminal && snap.ownerAlert) {
      const alert = snap.ownerAlert;
      const t = setTimeout(() => setOwnerAlert(alert), 1400);
      timers.current.push(t);
    }
  }, []);

  /** Begin (or restart) the conversation for a mode. */
  const start = useCallback(
    (m: Mode) => {
      clearTimers();
      setMode(m);
      setMessages([]);
      setOwnerAlert(null);
      playSnapshot(startFlow(m));
    },
    [playSnapshot],
  );

  /** User tapped a quick-reply chip. */
  const chooseOption = useCallback(
    (opt: QuickReply) => {
      const snap = advanceFlow({ mode, stepId, lead, choiceLabel: opt.label });
      // "Start over": advanceFlow signals a reset via snap.startOver. Reset the
      // thread (start() wipes messages/lead/ownerAlert) without echoing the chip.
      if (snap.startOver) {
        start(mode);
        return;
      }
      setMessages((m) => [...m, { id: nextId(), role: "user", text: opt.label }]);
      playSnapshot(snap);
    },
    [stepId, lead, mode, playSnapshot, start],
  );

  /** User submitted free text. */
  const submitText = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setMessages((m) => [...m, { id: nextId(), role: "user", text: trimmed }]);
      playSnapshot(advanceFlow({ mode, stepId, lead, text: trimmed }));
    },
    [stepId, lead, mode, playSnapshot],
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
