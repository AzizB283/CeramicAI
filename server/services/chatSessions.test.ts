import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSession,
  getSession,
  setSession,
  deleteSession,
  appendHistory,
} from "./chatSessions";

describe("chatSessions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("creates a session with a unique id and stores state", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    expect(s.id).toMatch(/.+/);
    const got = getSession(s.id);
    expect(got?.mode).toBe("factory");
    expect(got?.stepId).toBe("f_welcome");
  });

  it("updates session state", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    setSession(s.id, { mode: "factory", stepId: "f_product", lead: { buyerType: "retailer" } });
    expect(getSession(s.id)?.stepId).toBe("f_product");
    expect(getSession(s.id)?.lead.buyerType).toBe("retailer");
  });

  it("expires sessions after the TTL", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 min > 30 min TTL
    expect(getSession(s.id)).toBeUndefined();
  });

  it("deletes a session", () => {
    const s = createSession({ mode: "exporter", stepId: "x_welcome", lead: {} });
    deleteSession(s.id);
    expect(getSession(s.id)).toBeUndefined();
  });

  it("appendHistory accumulates turns and caps the buffer", () => {
    const s = createSession({ mode: "factory", stepId: "f_welcome", lead: {} });
    appendHistory(s.id, { role: "bot", text: "Welcome!" });
    appendHistory(s.id, { role: "user", text: "I'm a retailer" });
    const got = getSession(s.id);
    expect(got?.history).toEqual([
      { role: "bot", text: "Welcome!" },
      { role: "user", text: "I'm a retailer" },
    ]);

    // Push past the cap (MAX_HISTORY = 24) — should keep only the newest 24.
    for (let i = 0; i < 30; i++) {
      appendHistory(s.id, { role: "bot", text: `msg ${i}` });
    }
    const after = getSession(s.id);
    expect(after?.history.length).toBe(24);
    expect(after?.history[0]?.text).toBe("msg 6"); // 0..5 dropped
    expect(after?.history.at(-1)?.text).toBe("msg 29");
  });

  it("appendHistory on a missing session is a no-op (no throw)", () => {
    expect(() => appendHistory("nope", { role: "user", text: "hi" })).not.toThrow();
  });
});
