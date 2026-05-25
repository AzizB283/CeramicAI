import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSession, getSession, setSession, deleteSession } from "./chatSessions";

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
});
