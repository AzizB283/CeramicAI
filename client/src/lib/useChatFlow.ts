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
  /** Catalogue URL the server picked from the admin's `ceramic_catalogues`
   *  table (or the client's default catalogUrl); falls back to the hardcoded
   *  placeholder when undefined. */
  catalogUrl?: string;
}

const EMPTY_STEP: Step = { input: "choice", options: [] };

const stepFromSnapshot = (snap: FlowSnapshot): Step => ({
  input: snap.inputKind,
  options: snap.quickReplies,
  placeholder: snap.placeholder,
  catalog: snap.catalog,
  catalogUrl: snap.catalogUrl,
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

  const pushBot = (text: string, quickReplies?: QuickReply[]) =>
    setMessages((m) => [
      // Clear chips on any previous messages so only the latest set is live.
      ...m.map((msg) => (msg.quickReplies ? { ...msg, quickReplies: undefined } : msg)),
      { id: nextId(), role: "bot", text, quickReplies },
    ]);
  const pushUser = (text: string) =>
    setMessages((m) => [
      // Tapping/typing dismisses any pending chips immediately.
      ...m.map((msg) => (msg.quickReplies ? { ...msg, quickReplies: undefined } : msg)),
      { id: nextId(), role: "user", text },
    ]);

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

    // Fix 2: hoist setTyping(true) out of the loop so the indicator appears
    // immediately, before the first bubble's setTimeout fires. If there are no
    // messages (edge case) resolve to false right away so typing never sticks.
    if (snap.botMessages.length === 0) {
      setTyping(false);
      return;
    }

    setTyping(true);

    let delay = 0;
    const last = snap.botMessages.length - 1;
    snap.botMessages.forEach((line, i) => {
      const t1 = setTimeout(() => {
        // Attach the snapshot's quick replies to ONLY the final bubble of the
        // turn — they belong to "what the bot just asked". Earlier bubbles in
        // the same snapshot are plain narration.
        const chips =
          i === last && snap.inputKind === "choice" && snap.quickReplies.length > 0
            ? snap.quickReplies
            : undefined;
        pushBot(line, chips);
        if (i === last) setTyping(false);
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

  // Fix 3: shared helper that POSTs to /api/chat/message and returns the snapshot.
  const postMessage = useCallback(async (body: object): Promise<FlowSnapshot> => {
    const res = await fetch("/api/chat/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`message failed: ${res.status}`);
    return (await res.json()) as FlowSnapshot;
  }, []);

  /** Begin (or restart) the conversation for a mode. */
  const start = useCallback(
    async (m: Mode) => {
      clearTimers();
      setMode(m);
      setMessages([]);
      setOwnerAlert(null);
      // Fix 4: reset step/lead before the fetch so stale values don't linger.
      setStep(EMPTY_STEP);
      setLead({});
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
      // Fix 1: set typing=true synchronously before the async fetch so chips are
      // hidden immediately, preventing a racing second submit.
      setTyping(true);
      // Optimistically echo the chip. On a "Start over" reset the server resets
      // the thread, and start() wipes messages — so the echo never lingers.
      pushUser(opt.label);
      try {
        const snap = await postMessage({ sessionId: sid, choiceLabel: opt.label });
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
    [mode, playSnapshot, postMessage, start],
  );

  /**
   * User submitted free text. Behaviour depends on the current step:
   *
   * - text step (the bot is asking for typed input like a name or city) →
   *   normal flow advance via /api/chat/message.
   *
   * - choice step (chips are showing) → treat as a side-question off the flow:
   *   call /api/chat/ask, render the AI's answer as a bot bubble, and
   *   re-attach the SAME chips so the user can still answer the flow.
   */
  const submitText = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      const sid = sessionId.current;
      if (!trimmed || !sid) return;
      setTyping(true);
      pushUser(trimmed);

      // Capture the current chips before pushUser clears them — we'll re-attach
      // them to the AI's answer so the user can still pick a chip after.
      const currentChips = step.input === "choice" ? step.options : undefined;

      try {
        if (step.input === "text") {
          // On a text step, the typed value IS the answer; advance the flow.
          const snap = await postMessage({ sessionId: sid, text: trimmed });
          playSnapshot(snap);
          return;
        }

        // On a choice step, route off-flow via /ask. The flow stays parked.
        const res = await fetch("/api/chat/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sid, question: trimmed }),
        });
        if (!res.ok) throw new Error(`ask failed: ${res.status}`);
        const { answer } = (await res.json()) as { answer: string };
        setTyping(false);
        pushBot(answer, currentChips);
      } catch {
        setTyping(false);
        pushBot("Sorry, something went wrong.", currentChips);
      }
    },
    [playSnapshot, postMessage, step.input, step.options],
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
