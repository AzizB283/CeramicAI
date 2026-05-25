import { randomUUID } from "node:crypto";
import type { LeadDraft, Mode, StepId } from "@shared/types";

export interface SessionState {
  mode: Mode;
  stepId: StepId;
  lead: LeadDraft;
}

interface StoredSession extends SessionState {
  id: string;
  lastSeen: number;
}

const TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, StoredSession>();

function fresh(s: StoredSession): boolean {
  return Date.now() - s.lastSeen <= TTL_MS;
}

export function createSession(state: SessionState): StoredSession {
  const id = randomUUID();
  const stored: StoredSession = { id, lastSeen: Date.now(), ...state };
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

export function deleteSession(id: string): void {
  sessions.delete(id);
}
