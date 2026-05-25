import { useCallback, useRef, useState } from "react";
import type {
  ChatMessage,
  LeadDraft,
  Mode,
  QuickReply,
} from "@shared/types";
import type { FlowSnapshot, OwnerAlert } from "@shared/flowEngine";

export type { OwnerAlert };

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;

/** The /session response is a snapshot plus the new session id. */
type SessionResponse = FlowSnapshot & { sessionId: string };

/** The slice of a snapshot that App.tsx reads off `step`. */
interface Step {
  input: "choice" | "text";
  options: QuickReply[];
  placeholder?: string;
  catalog?: "factory" | "export";
}

const EMPTY_STEP: Step = { input: "choice", options: [] };

const stepFromSnapshot = (snap: FlowSnapshot): Step => ({
  input: snap.inputKind,
  options: snap.quickReplies,
  placeholder: snap.placeholder,
  catalog: snap.catalog,
});

/**
 * Drives the demo conversation: holds the message thread, the current step,
 * the accumulated lead, typing state, and the simulated owner alert.
 *
 * Phase 2: the conversation is owned by the server. This hook calls
 * `POST /api/chat/session` to begin and `POST /api/chat/message` to advance,
 * then animates the returned snapshot. It no longer walks the flow locally —
 * the server decides the next step, renders the bot copy, and persists the lead.
 *
 * This hook only owns the UI concerns: the message thread, the typing-dots
 * timers, and mapping server snapshots to bubbles.
 */
export function useChatFlow(initialMode: Mode) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [step, setStep] = useState<Step>(EMPTY_STEP);
  const [lead, setLead] = useState<LeadDraft>({});
  const [typing, setTyping] = useState(false);
  const [ownerAlert, setOwnerAlert] = useState<OwnerAlert | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sessionId = useRef<string | null>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const pushBot = (text: string) =>
    setMessages((m) => [...m, { id: nextId(), role: "bot", text }]);
  const pushUser = (text: string) =>
    setMessages((m) => [...m, { id: nextId(), role: "user", text }]);

  /**
   * Apply a server snapshot to the UI: emit its (already-rendered) bot bubbles
   * one-by-one with a typing indicator between, update step/lead, and schedule
   * the owner alert. The server renders {client}/{name}, so bubbles are shown
   * verbatim.
   */
  const playSnapshot = useCallback((snap: FlowSnapshot) => {
    clearTimers();
    setStep(stepFromSnapshot(snap));
    setLead(snap.lead);

    let delay = 0;
    snap.botMessages.forEach((line, i) => {
      setTyping(true);
      const t1 = setTimeout(() => {
        pushBot(line);
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
    async (m: Mode) => {
      clearTimers();
      setMode(m);
      setMessages([]);
      setOwnerAlert(null);
      setTyping(true);
      try {
        const res = await fetch("/api/chat/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: m }),
        });
        if (!res.ok) throw new Error(`session failed: ${res.status}`);
        const data = (await res.json()) as SessionResponse;
        sessionId.current = data.sessionId;
        playSnapshot(data);
      } catch {
        setTyping(false);
        pushBot("Sorry, something went wrong.");
      }
    },
    [playSnapshot],
  );

  /** User tapped a quick-reply chip. */
  const chooseOption = useCallback(
    async (opt: QuickReply) => {
      const sid = sessionId.current;
      if (!sid) return;
      // Optimistically echo the chip. On a "Start over" reset the server resets
      // the thread, and start() wipes messages — so the echo never lingers.
      pushUser(opt.label);
      try {
        const res = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sid, choiceLabel: opt.label }),
        });
        if (!res.ok) throw new Error(`message failed: ${res.status}`);
        const snap = (await res.json()) as FlowSnapshot;
        if (snap.startOver) {
          await start(mode);
          return;
        }
        playSnapshot(snap);
      } catch {
        setTyping(false);
        pushBot("Sorry, something went wrong.");
      }
    },
    [mode, playSnapshot, start],
  );

  /** User submitted free text. */
  const submitText = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      const sid = sessionId.current;
      if (!trimmed || !sid) return;
      pushUser(trimmed);
      try {
        const res = await fetch("/api/chat/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sid, text: trimmed }),
        });
        if (!res.ok) throw new Error(`message failed: ${res.status}`);
        const snap = (await res.json()) as FlowSnapshot;
        playSnapshot(snap);
      } catch {
        setTyping(false);
        pushBot("Sorry, something went wrong.");
      }
    },
    [playSnapshot],
  );

  return {
    mode,
    messages,
    step,
    lead,
    typing,
    ownerAlert,
    start,
    chooseOption,
    submitText,
  };
}
