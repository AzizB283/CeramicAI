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
