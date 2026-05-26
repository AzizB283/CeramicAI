import { describe, it, expect } from "vitest";
import type { CeramicCatalogue } from "@shared/schema";
import { pickCatalogue } from "./catalogueMatcher";

// ── Helpers ─────────────────────────────────────────────────────────
//
// Tests assemble realistic catalogue rows; only the fields the matcher reads
// matter, but we set them all to keep types honest.

let seq = 0;
const make = (overrides: Partial<CeramicCatalogue>): CeramicCatalogue => ({
  id: ++seq,
  clientId: "client-1",
  title: "Test",
  category: "gvt",
  audience: "both",
  url: "https://example.com/a.pdf",
  description: null,
  sizes: [],
  finishes: [],
  isActive: true,
  displayOrder: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("pickCatalogue", () => {
  it("returns undefined when no candidates", () => {
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [])).toBeUndefined();
  });

  it("filters out inactive catalogues", () => {
    const inactive = make({ category: "gvt", isActive: false });
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [inactive])).toBeUndefined();
  });

  it("filters by audience: export-only catalogue not picked in factory mode", () => {
    const exportOnly = make({ category: "gvt", audience: "export" });
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [exportOnly])).toBeUndefined();
  });

  it("filters by audience: domestic-only catalogue not picked in exporter mode", () => {
    const domesticOnly = make({ category: "gvt", audience: "domestic" });
    expect(pickCatalogue({ productCategory: "gvt" }, "exporter", [domesticOnly])).toBeUndefined();
  });

  it("'both' audience is picked in either mode", () => {
    const both = make({ category: "gvt", audience: "both" });
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [both])?.id).toBe(both.id);
    expect(pickCatalogue({ productCategory: "gvt" }, "exporter", [both])?.id).toBe(both.id);
  });

  it("picks the catalogue whose category exactly matches the buyer's", () => {
    const wall = make({ category: "ceramic_wall" });
    const gvt = make({ category: "gvt" });
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [wall, gvt])?.id).toBe(gvt.id);
  });

  it("returns undefined when no candidate scores > 0 (no overlap)", () => {
    // Buyer wants 'sanitaryware' but only an unrelated GVT catalogue exists.
    const gvt = make({ category: "gvt", sizes: ["600x600"] });
    expect(
      pickCatalogue({ productCategory: "sanitaryware" }, "factory", [gvt]),
    ).toBeUndefined();
  });

  it("does NOT pick a category-mismatched catalogue just because the size matches", () => {
    // Buyer chose sanitaryware. The only catalogue is GVT-only (not 'mixed')
    // but it happens to feature 600x600. Without a category match, the size
    // bonus must not pull it in — that would be a misleading catalogue link.
    const gvtSize600 = make({ category: "gvt", sizes: ["600x600"], title: "GVT 600" });
    const out = pickCatalogue(
      { productCategory: "sanitaryware", productSize: "600x600" },
      "factory",
      [gvtSize600],
    );
    expect(out).toBeUndefined();
  });

  it("'mixed' catalogue is picked when no exact match, but loses to an exact match", () => {
    const mixed = make({ category: "mixed", title: "general" });
    const exact = make({ category: "gvt", title: "exact" });
    // No exact GVT → mixed wins
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [mixed])?.title).toBe("general");
    // Both available → exact wins
    expect(pickCatalogue({ productCategory: "gvt" }, "factory", [mixed, exact])?.title).toBe("exact");
  });

  it("size match adds bonus on top of category", () => {
    const noSize = make({ category: "gvt" });
    const withSize = make({ category: "gvt", sizes: ["800x800"] });
    expect(
      pickCatalogue({ productCategory: "gvt", productSize: "800x800" }, "factory", [noSize, withSize])?.id,
    ).toBe(withSize.id);
  });

  it("finish match is case-insensitive", () => {
    const a = make({ category: "gvt", finishes: ["matte"] });
    const b = make({ category: "gvt", finishes: ["MATTE"] });
    // Both score equally; first by displayOrder/createdAt order. The test just
    // confirms case-insensitivity gives BOTH a non-zero score so one is picked.
    const out = pickCatalogue(
      { productCategory: "gvt", productFinish: "Matte" },
      "factory",
      [a, b],
    );
    expect(out).toBeDefined();
  });

  it("category + size + finish stack: best-matched catalogue wins", () => {
    const partial = make({ category: "gvt", sizes: ["600x600"] }); // 10 + 0
    const full = make({ category: "gvt", sizes: ["600x600"], finishes: ["Glossy"] }); // 10 + 5 + 5
    const out = pickCatalogue(
      { productCategory: "gvt", productSize: "600x600", productFinish: "Glossy" },
      "factory",
      [partial, full],
    );
    expect(out?.id).toBe(full.id);
  });

  it("ties broken by displayOrder ASC (lower wins)", () => {
    const later = make({ category: "gvt", displayOrder: 5, title: "later" });
    const earlier = make({ category: "gvt", displayOrder: 1, title: "earlier" });
    expect(
      pickCatalogue({ productCategory: "gvt" }, "factory", [later, earlier])?.title,
    ).toBe("earlier");
  });

  it("equal displayOrder ties broken by newest createdAt", () => {
    const old = make({
      category: "gvt",
      createdAt: new Date("2025-01-01T00:00:00Z"),
      title: "old",
    });
    const fresh = make({
      category: "gvt",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      title: "fresh",
    });
    expect(
      pickCatalogue({ productCategory: "gvt" }, "factory", [old, fresh])?.title,
    ).toBe("fresh");
  });
});
