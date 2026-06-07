import { describe, it, expect } from "vitest";
import { renderTemplate, triageReplyHeuristic } from "./campaignContent";

describe("renderTemplate", () => {
  it("substitutes known tokens", () => {
    const out = renderTemplate("Hi {{name}} at {{company}} in {{country}}", {
      name: "Aisha Khan",
      company: "Gulf Tiles",
      country: "UAE",
    });
    expect(out).toBe("Hi Aisha Khan at Gulf Tiles in UAE");
  });

  it("{{firstName}} uses only the first word", () => {
    expect(renderTemplate("Hi {{firstName}}", { name: "Aisha Khan" })).toBe("Hi Aisha");
  });

  it("{{name}} falls back to company then 'there'", () => {
    expect(renderTemplate("Hi {{name}}", { company: "Gulf Tiles" })).toBe("Hi Gulf Tiles");
    expect(renderTemplate("Hi {{name}}", {})).toBe("Hi there");
  });

  it("substitutes {{catalogue}} (and {{catalog}} alias)", () => {
    const t = "See {{catalogue}} and {{catalog}}";
    expect(renderTemplate(t, { catalogue: "http://x/r/abc" })).toBe("See http://x/r/abc and http://x/r/abc");
  });

  it("leaves unknown tokens untouched (so typos are visible)", () => {
    expect(renderTemplate("Hi {{naem}}", { name: "Aisha" })).toBe("Hi {{naem}}");
  });

  it("is whitespace-tolerant inside braces", () => {
    expect(renderTemplate("Hi {{ name }}", { name: "Aisha" })).toBe("Hi Aisha");
  });
});

describe("triageReplyHeuristic", () => {
  it("detects sample requests", () => {
    expect(triageReplyHeuristic("Can you send me some samples?")).toBe("sample_request");
  });
  it("detects unsubscribe", () => {
    expect(triageReplyHeuristic("Please unsubscribe me from this list")).toBe("unsubscribe");
  });
  it("detects hot (quote/interested)", () => {
    expect(triageReplyHeuristic("Yes, please send a quote and call me")).toBe("hot");
  });
  it("detects not_now", () => {
    expect(triageReplyHeuristic("Maybe next quarter, not right now")).toBe("not_now");
  });
  it("detects wrong_person", () => {
    expect(triageReplyHeuristic("You have the wrong department")).toBe("wrong_person");
  });
  it("defaults to lukewarm", () => {
    expect(triageReplyHeuristic("ok thanks")).toBe("lukewarm");
  });
});
