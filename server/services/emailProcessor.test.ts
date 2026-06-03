import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the openai SDK before importing the module under test (same pattern as
// openaiChat.test.ts). createMock drives chat.completions.create per test.
const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { classifyAndExtract, generateReply } from "./emailProcessor";

function reply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe("classifyAndExtract", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("parses a buyer inquiry into structured fields", async () => {
    createMock.mockResolvedValueOnce(
      reply(
        JSON.stringify({
          is_buyer_inquiry: true,
          buyer_name: "Ahmed",
          buyer_company: "Ahmed Trading",
          buyer_country: "Kenya",
          product_category: "gvt",
          product_size: "600x600",
          quantity: "3 containers",
          incoterms: "CIF",
          destination_port: "Mombasa",
          sample_requested: false,
          language: "en",
          source_platform: "alibaba",
          buyer_type: "distributor",
        }),
      ),
    );
    const out = await classifyAndExtract("we need 3 containers GVT 600x600 CIF Mombasa");
    expect(out.is_buyer_inquiry).toBe(true);
    expect(out.buyer_type).toBe("distributor");
    expect(out.buyer_country).toBe("Kenya");
  });

  it("flags non-buyer email as ignore", async () => {
    createMock.mockResolvedValueOnce(reply(JSON.stringify({ is_buyer_inquiry: false, language: "en" })));
    const out = await classifyAndExtract("your bank statement is ready");
    expect(out.is_buyer_inquiry).toBe(false);
  });

  it("returns is_buyer_inquiry=false when OpenAI is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const out = await classifyAndExtract("anything");
    expect(out.is_buyer_inquiry).toBe(false);
  });

  it("returns is_buyer_inquiry=false when the model errors", async () => {
    createMock.mockRejectedValueOnce(new Error("boom"));
    const out = await classifyAndExtract("anything");
    expect(out.is_buyer_inquiry).toBe(false);
    expect(out.language).toBe("en");
  });
});

describe("generateReply", () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("returns the model's reply text", async () => {
    createMock.mockResolvedValueOnce(reply("Dear Ahmed, thank you for your inquiry…"));
    const text = await generateReply(
      { is_buyer_inquiry: true, language: "en", buyer_name: "Ahmed" },
      { name: "Shree Ceramic", ownerName: "Rajesh" },
      "https://catalog.example/gvt.pdf",
    );
    expect(text).toContain("Ahmed");
  });

  it("falls back to a deterministic draft when OpenAI fails", async () => {
    createMock.mockRejectedValueOnce(new Error("boom"));
    const text = await generateReply(
      { is_buyer_inquiry: true, language: "en", buyer_name: "Ahmed" },
      { name: "Shree Ceramic", ownerName: "Rajesh" },
      "https://catalog.example/gvt.pdf",
    );
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("Shree Ceramic");
    expect(text).toContain("https://catalog.example/gvt.pdf");
  });

  it("falls back to a deterministic draft when OpenAI is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const text = await generateReply(
      { is_buyer_inquiry: true, language: "en" },
      { name: "Shree Ceramic", ownerName: null },
      "https://catalog.example/gvt.pdf",
    );
    expect(text).toContain("Sir/Madam");
    expect(text).toContain("Export Team");
  });
});
