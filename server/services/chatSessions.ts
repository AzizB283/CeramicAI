import { randomUUID } from "node:crypto";
import type { LeadDraft, Mode, StepId } from "@shared/types";
import type { ChatHistoryTurn } from "./openaiChat";

export interface SessionState {
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
}

interface StoredSession extends SessionState {
  id: string;
  lastSeen: number;
  /**
   * Last N turns of the conversation in order. The LLM uses this as context
   * so it can acknowledge the buyer's last message, switch languages, etc.
   * Not the source of truth for the lead (the FSM is) — purely UI/narration.
   */
  history: ChatHistoryTurn[];
}

const TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 24; // keeps memory bounded; LLM only reads the last ~10
const sessions = new Map<string, StoredSession>();

function fresh(s: StoredSession): boolean {
  return Date.now() - s.lastSeen <= TTL_MS;
}

export function createSession(state: SessionState): StoredSession {
  const id = randomUUID();
  const stored: StoredSession = {
    id,
    lastSeen: Date.now(),
    history: [],
    ...state,
  };
  sessions.set(id, stored);
  return stored;
}

export function getSession(id: string): StoredSession | undefined {
  const s = sessions.get(id);
  if (!s) return undefined;
  if (!fresh(s)) {
    sessions.delete(id);
    return undefined;
  }
  s.lastSeen = Date.now();
  return s;
}

export function setSession(id: string, state: SessionState): void {
  const existing = sessions.get(id);
  if (!existing) return;
  sessions.set(id, { ...existing, ...state, lastSeen: Date.now() });
}

/** Append a turn to the session's history, capped at MAX_HISTORY. */
export function appendHistory(id: string, turn: ChatHistoryTurn): void {
  const s = sessions.get(id);
  if (!s) return;
  s.history.push(turn);
  if (s.history.length > MAX_HISTORY) {
    s.history.splice(0, s.history.length - MAX_HISTORY);
  }
  s.lastSeen = Date.now();
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}
