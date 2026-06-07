import { describe, it, expect } from "vitest";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribeToken";

describe("unsubscribe tokens", () => {
  it("round-trips clientId + lowercased email", () => {
    const token = makeUnsubscribeToken("client-123", "Buyer@Example.com");
    const out = verifyUnsubscribeToken(token);
    expect(out).toEqual({ clientId: "client-123", email: "buyer@example.com" });
  });

  it("rejects a tampered token", () => {
    const token = makeUnsubscribeToken("client-123", "buyer@example.com");
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
  });
});
