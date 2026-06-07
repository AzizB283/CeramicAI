import { describe, it, expect } from "vitest";
import {
  parseCsv,
  detectPreset,
  buildColumnMap,
  parseContactsCsv,
} from "./csvImport";

describe("parseCsv (RFC-4180-ish)", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with embedded commas and quotes", () => {
    const out = parseCsv('name,note\n"Shah, Rahul","He said ""hi"""');
    expect(out[1]).toEqual(["Shah, Rahul", 'He said "hi"']);
  });

  it("handles embedded newlines inside quotes", () => {
    const out = parseCsv('a,b\n"line1\nline2",x');
    expect(out[1]).toEqual(["line1\nline2", "x"]);
  });

  it("strips a UTF-8 BOM and CRLF line endings", () => {
    const out = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(out).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops fully-empty trailing rows", () => {
    const out = parseCsv("a,b\n1,2\n\n");
    expect(out).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectPreset", () => {
  it("detects IndiaMART from its export headers", () => {
    expect(detectPreset(["Sender Name", "Sender Email", "Sender Mobile", "Buyer City"])).toBe(
      "indiamart",
    );
  });

  it("detects Alibaba", () => {
    expect(detectPreset(["Contact Name", "Email", "Tel/Phone", "Country/Region"])).toBe("alibaba");
  });

  it("falls back to generic when nothing matches enough columns", () => {
    expect(detectPreset(["Full Name", "Work Email"])).toBe("generic");
  });
});

describe("buildColumnMap", () => {
  it("maps known preset headers to canonical fields", () => {
    const map = buildColumnMap(["Sender Name", "Sender Email"], "indiamart");
    expect(map["Sender Name"]).toBe("name");
    expect(map["Sender Email"]).toBe("email");
  });

  it("generic auto-maps by keyword", () => {
    const map = buildColumnMap(["Full Name", "E-Mail Address", "Mobile No", "Company"], "generic");
    expect(map["E-Mail Address"]).toBe("email");
    expect(map["Mobile No"]).toBe("phone");
    expect(map["Company"]).toBe("company");
    expect(map["Full Name"]).toBe("name");
  });
});

describe("parseContactsCsv", () => {
  it("parses valid rows into drafts and stamps the preset source", () => {
    const csv = "Name,Email,Phone,Country\nAisha,aisha@example.com,+971 50 123 4567,UAE";
    const r = parseContactsCsv(csv);
    expect(r.rowsTotal).toBe(1);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      name: "Aisha",
      email: "aisha@example.com",
      phone: "+971501234567",
      country: "UAE",
      source: "csv",
    });
    expect(r.errors).toHaveLength(0);
  });

  it("rejects a row with no email or phone", () => {
    const csv = "Name,Email,Phone\nGhost,,";
    const r = parseContactsCsv(csv);
    expect(r.drafts).toHaveLength(0);
    expect(r.errors[0]).toMatchObject({ row: 1, reason: "no usable email or phone" });
  });

  it("rejects an invalid email", () => {
    const csv = "Name,Email\nBad,not-an-email";
    const r = parseContactsCsv(csv);
    expect(r.drafts).toHaveLength(0);
    expect(r.errors[0].reason).toContain("invalid email");
  });

  it("keeps a row with phone only, dropping an invalid phone gracefully", () => {
    const csv = "Name,Email,Phone\nOk,ok@example.com,12"; // phone too short → dropped, email keeps it
    const r = parseContactsCsv(csv);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].phone).toBeUndefined();
    expect(r.drafts[0].email).toBe("ok@example.com");
  });

  it("splits tags on separators", () => {
    const csv = "Email,Tags\nx@example.com,gulf; vip|2024";
    const r = parseContactsCsv(csv);
    expect(r.drafts[0].tags).toEqual(["gulf", "vip", "2024"]);
  });

  it("applies a forced preset's source when none is given", () => {
    const csv = "Sender Name,Sender Email\nRaj,raj@example.com";
    const r = parseContactsCsv(csv, { preset: "indiamart" });
    expect(r.preset).toBe("indiamart");
    expect(r.drafts[0].source).toBe("indiamart");
    expect(r.drafts[0].name).toBe("Raj");
  });

  it("lowercases buyerType", () => {
    const csv = "Email,Category\nx@example.com,Distributor";
    // generic guesses "category" → buyerType
    const r = parseContactsCsv(csv);
    expect(r.drafts[0].buyerType).toBe("distributor");
  });

  it("returns empty for blank input", () => {
    expect(parseContactsCsv("").drafts).toHaveLength(0);
  });
});
