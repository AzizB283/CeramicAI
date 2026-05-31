import { describe, it, expect } from "vitest";
import { startFlow, advanceFlow } from "./flowEngine";

describe("flowEngine — factory mode", () => {
  it("starts at the factory welcome step", () => {
    const s = startFlow("factory");
    expect(s.stepId).toBe("f_welcome");
    expect(s.botMessages.length).toBeGreaterThan(0);
    expect(s.quickReplies.some((r) => r.label.includes("Retailer"))).toBe(true);
    expect(s.terminal).toBe(false);
  });

  it("advances buyer type → product and records the lead field", () => {
    const s0 = startFlow("factory");
    const s1 = advanceFlow({
      mode: "factory",
      stepId: s0.stepId,
      lead: s0.lead,
      choiceLabel: "Retailer / Tile Shop Owner",
    });
    expect(s1.stepId).toBe("f_product");
    expect(s1.lead.buyerType).toBe("retailer");
    expect(s1.quickReplies.some((r) => r.label.includes("GVT"))).toBe(true);
  });

  it("accepts free text on a text step (name capture)", () => {
    let st = startFlow("factory");
    const pick = (label: string) => {
      st = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, choiceLabel: label });
    };
    pick("Retailer / Tile Shop Owner");
    pick("GVT / Vitrified Floor Tiles");
    pick("600×600");
    pick("Matte");
    pick("500–2,000 boxes");
    expect(st.stepId).toBe("f_catalog");
    expect(st.catalog).toBe("factory");
    const named = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, text: "Rahul" });
    expect(named.lead.buyerName).toBe("Rahul");
    expect(named.stepId).toBe("f_city");
  });

  it("renders {client} and {name} placeholders in bot copy", () => {
    const s = startFlow("factory");
    expect(s.botMessages.join(" ")).toContain("Shree Tiles Pvt Ltd");
  });
});

describe("flowEngine — exporter distributor priority", () => {
  it("marks distributor path as priority", () => {
    const s0 = startFlow("exporter");
    const s1 = advanceFlow({
      mode: "exporter",
      stepId: s0.stepId,
      lead: s0.lead,
      choiceLabel: "I want to become a regular buyer / distributor",
    });
    expect(s1.lead.priority).toBe("priority");
    expect(s1.stepId).toBe("x_dist_country");
  });
});

describe("flowEngine — terminal owner alert", () => {
  it("emits a non-priority factory owner alert at the terminal step", () => {
    let st = startFlow("factory");
    const step = (a: { choiceLabel?: string; text?: string }) => {
      st = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, ...a });
    };
    step({ choiceLabel: "Retailer / Tile Shop Owner" });
    step({ choiceLabel: "GVT / Vitrified Floor Tiles" });
    step({ choiceLabel: "600×600" });
    step({ choiceLabel: "Matte" });
    step({ choiceLabel: "500–2,000 boxes" });
    step({ text: "Rahul" }); // name → f_city
    step({ text: "Surat" }); // city → f_done
    expect(st.stepId).toBe("f_done");
    expect(st.terminal).toBe(true);
    expect(st.ownerAlert).toBeTruthy();
    expect(st.ownerAlert!.priority).toBe(false);
    expect(st.ownerAlert!.lines.join("\n")).toContain("Rahul");
    expect(st.ownerAlert!.lines.join("\n")).toContain("Surat");
  });
});

describe("flowEngine — no-op / invalid input", () => {
  it("ignores an unknown choice (no-op, lead unchanged)", () => {
    const s = advanceFlow({
      mode: "factory",
      stepId: "f_welcome",
      lead: {},
      choiceLabel: "NotARealOption",
    });
    expect(s.stepId).toBe("f_welcome");
    expect(s.lead.buyerType).toBeUndefined();
  });

  it("ignores empty/whitespace text on a text step (no-op)", () => {
    let st = startFlow("factory");
    const pick = (label: string) => {
      st = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, choiceLabel: label });
    };
    pick("Retailer / Tile Shop Owner");
    pick("GVT / Vitrified Floor Tiles");
    pick("600×600");
    pick("Matte");
    pick("500–2,000 boxes");
    expect(st.stepId).toBe("f_catalog");
    const s = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, text: "   " });
    expect(s.stepId).toBe("f_catalog");
    expect(s.lead.buyerName).toBeUndefined();
  });
});

describe("flowEngine — free-text cleanup on name capture", () => {
  it("strips a lead-in phrase from the name on the catalog step", () => {
    let st = startFlow("factory");
    const pick = (label: string) => {
      st = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, choiceLabel: label });
    };
    pick("Retailer / Tile Shop Owner");
    pick("GVT / Vitrified Floor Tiles");
    pick("600×600");
    pick("Matte");
    pick("500–2,000 boxes");
    expect(st.stepId).toBe("f_catalog");
    const named = advanceFlow({
      mode: "factory",
      stepId: st.stepId,
      lead: st.lead,
      text: "My name is Rajesh",
    });
    expect(named.lead.buyerName).toBe("Rajesh");
    expect(named.stepId).toBe("f_city");
  });
});

describe("flowEngine — free text on a choice step", () => {
  it("does not store an unmatched greeting as the choice field", () => {
    const s = advanceFlow({
      mode: "factory",
      stepId: "f_welcome",
      lead: {},
      text: "Hi",
    });
    // Stays on the welcome step; buyerType is NOT polluted with "Hi".
    expect(s.stepId).toBe("f_welcome");
    expect(s.lead.buyerType).toBeUndefined();
  });

  it("treats a typed chip label as if the chip were tapped", () => {
    const s = advanceFlow({
      mode: "factory",
      stepId: "f_welcome",
      lead: {},
      text: "Retailer / Tile Shop Owner",
    });
    expect(s.stepId).toBe("f_product");
    expect(s.lead.buyerType).toBe("retailer");
  });
});

describe("flowEngine — Start over", () => {
  it("sets the startOver flag and resets to the welcome step with empty lead", () => {
    const s = advanceFlow({
      mode: "factory",
      stepId: "f_done",
      lead: { buyerName: "Rahul", buyerCity: "Surat", buyerType: "retailer" },
      choiceLabel: "Start over",
    });
    expect(s.startOver).toBe(true);
    expect(s.stepId).toBe("f_welcome");
    expect(s.lead).toEqual({});
  });
});

describe("flowEngine — exporter distributor terminal alert", () => {
  it("emits a PRIORITY owner alert at the distributor terminal step", () => {
    let st = startFlow("exporter");
    const step = (a: { choiceLabel?: string; text?: string }) => {
      st = advanceFlow({ mode: "exporter", stepId: st.stepId, lead: st.lead, ...a });
    };
    step({ choiceLabel: "I want to become a regular buyer / distributor" });
    step({ text: "Kenya" }); // x_dist_country → x_dist_imports
    step({ choiceLabel: "Yes, from India" });
    step({ choiceLabel: "200–1,000 containers" });
    step({ choiceLabel: "Yes" });
    expect(st.stepId).toBe("x_dist_done");
    expect(st.terminal).toBe(true);
    expect(st.ownerAlert).toBeTruthy();
    expect(st.ownerAlert!.priority).toBe(true);
    expect(st.ownerAlert!.lines.join("\n")).toContain("PRIORITY LEAD");
  });
});

describe("flowEngine — placeholder substitution", () => {
  it("renders the captured {name} in the factory terminal copy", () => {
    let st = startFlow("factory");
    const step = (a: { choiceLabel?: string; text?: string }) => {
      st = advanceFlow({ mode: "factory", stepId: st.stepId, lead: st.lead, ...a });
    };
    step({ choiceLabel: "Retailer / Tile Shop Owner" });
    step({ choiceLabel: "GVT / Vitrified Floor Tiles" });
    step({ choiceLabel: "600×600" });
    step({ choiceLabel: "Matte" });
    step({ choiceLabel: "500–2,000 boxes" });
    step({ text: "Rahul" }); // name → f_city
    step({ text: "Surat" }); // city → f_done
    expect(st.stepId).toBe("f_done");
    expect(st.botMessages.join(" ")).toContain("Thank you, Rahul");
  });
});
