import { describe, it, expect } from "vitest";
import { cleanFieldValue, looksUnclean } from "./extract";

describe("cleanFieldValue — name lead-ins", () => {
  const cases: Array<[string, string]> = [
    ["My name is Rajesh", "Rajesh"],
    ["my name is rajesh", "rajesh"],
    ["I am Aziz", "Aziz"],
    ["I'm Priya", "Priya"],
    ["this is Mehul", "Mehul"],
    ["Name: Kiran", "Kiran"],
    ["name - Kiran", "Kiran"],
    ["it's Sanjay", "Sanjay"],
    ["Aziz from Morbi Tiles", "Aziz"],
    ["Rahul here", "Rahul"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(cleanFieldValue("buyerName", input)).toBe(expected);
    });
  }

  it("leaves a bare name untouched", () => {
    expect(cleanFieldValue("buyerName", "Rajesh")).toBe("Rajesh");
    expect(cleanFieldValue("buyerName", "Rajesh Patel")).toBe("Rajesh Patel");
  });

  it("does not over-strip names that merely start with similar letters", () => {
    // "Nameet" must not lose its "Name" prefix (the bare 'name' pattern needs a separator).
    expect(cleanFieldValue("buyerName", "Nameet")).toBe("Nameet");
    // "Iman" must not be cut to "an" by the "I am"/"I'm" patterns.
    expect(cleanFieldValue("buyerName", "Iman")).toBe("Iman");
  });

  it("keeps the original when stripping would empty the value", () => {
    expect(cleanFieldValue("buyerName", "my name is")).toBe("my name is");
  });
});

describe("cleanFieldValue — city / company / country", () => {
  it("strips 'I live in' for city", () => {
    expect(cleanFieldValue("buyerCity", "I live in Morbi")).toBe("Morbi");
  });
  it("strips 'our company is' for company", () => {
    expect(cleanFieldValue("buyerCompany", "Our company is Shree Tiles")).toBe("Shree Tiles");
  });
  it("strips 'from' for country", () => {
    expect(cleanFieldValue("country", "from Kenya")).toBe("Kenya");
  });
});

describe("cleanFieldValue — non-noun fields are only trimmed", () => {
  it("does not strip lead-ins from quantity-style fields", () => {
    expect(cleanFieldValue("quantity", "  500 boxes  ")).toBe("500 boxes");
    expect(cleanFieldValue("sampleQty", "I am ordering 5 pieces")).toBe(
      "I am ordering 5 pieces",
    );
  });
  it("returns trimmed text when field is undefined", () => {
    expect(cleanFieldValue(undefined, "  hello  ")).toBe("hello");
  });
});

describe("looksUnclean", () => {
  it("flags a sentence-y value", () => {
    expect(looksUnclean("buyerName", "I am looking for tiles please")).toBe(true);
  });
  it("does not flag a clean name", () => {
    expect(looksUnclean("buyerName", "Rajesh Patel")).toBe(false);
  });
  it("never flags non-noun fields", () => {
    expect(looksUnclean("quantity", "I am ordering a lot of boxes here")).toBe(false);
  });
});
