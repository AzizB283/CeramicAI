import { describe, it, expect } from "vitest";
import { parseRecipients } from "./email";

describe("parseRecipients", () => {
  it("returns [] for empty / null / undefined", () => {
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients(undefined)).toEqual([]);
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
  });

  it("parses a single address", () => {
    expect(parseRecipients("owner@factory.com")).toEqual(["owner@factory.com"]);
  });

  it("splits on commas, semicolons, and newlines, trimming whitespace", () => {
    expect(parseRecipients("a@x.com, b@x.com; c@x.com\nd@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]); // capped at 3 — see below
  });

  it("caps recipients at the default max of 3", () => {
    const list = parseRecipients("a@x.com,b@x.com,c@x.com,d@x.com,e@x.com");
    expect(list).toHaveLength(3);
    expect(list).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });

  it("respects an explicit max", () => {
    expect(parseRecipients("a@x.com,b@x.com,c@x.com", 2)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("drops invalid-looking entries but keeps valid ones", () => {
    expect(parseRecipients("notanemail, good@x.com, also bad, two@y.com")).toEqual([
      "good@x.com",
      "two@y.com",
    ]);
  });

  it("dedupes case-insensitively, preserving first-seen casing", () => {
    expect(parseRecipients("Owner@Factory.com, owner@factory.com, sales@x.com")).toEqual([
      "Owner@Factory.com",
      "sales@x.com",
    ]);
  });
});
