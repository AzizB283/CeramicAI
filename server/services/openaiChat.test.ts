import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the openai SDK *before* importing the module under test. The mock
// installs a fake OpenAI class whose chat.completions.create is a vi.fn we
// can drive per-test.

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: createMock } };
  },
}));

import { generateBotReply, isAiAvailable } from "./openaiChat";

const baseCtx = {
  mode: "factory" as const,
  stepId: "f_product" as const,
  factoryName: "Shree Tiles Pvt Ltd",
  lead: { buyerType: "retailer" as const },
  quickReplies: [{ label: "GVT / Vitrified Floor Tiles" }, { label: "Slab Tiles" }],
  history: [
    { role: "bot" as const, text: "Welcome to Shree Tiles." },
    { role: "user" as const, text: "Retailer / Tile Shop Owner" },
  ],
  fallback: ["What product are you looking for?"],
};

describe("generateBotReply", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  describe("graceful degrade (no API key)", () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });
    afterEach(() => {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    });

    it("returns the fallback when OPENAI_API_KEY is not set", async () => {
      expect(isAiAvailable()).toBe(false);
      const out = await generateBotReply(baseCtx);
      expect(out).toEqual(baseCtx.fallback);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("with API key", () => {
    let saved: string | undefined;
    beforeEach(() => {
      saved = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-test-fake";
    });
    afterEach(() => {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
      else delete process.env.OPENAI_API_KEY;
    });

    it("returns the LLM reply as a single bubble on a single-line response", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "Great — which tile category fits your shop?" } }],
      });
      const out = await generateBotReply(baseCtx);
      expect(out).toEqual(["Great — which tile category fits your shop?"]);
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    it("splits multi-line responses into multiple bubbles", async () => {
      createMock.mockResolvedValueOnce({
        choices: [
          { message: { content: "Welcome to Shree Tiles 🏭\nWho are you? Tap below to continue." } },
        ],
      });
      const out = await generateBotReply({ ...baseCtx, stepId: "f_welcome" });
      expect(out).toEqual([
        "Welcome to Shree Tiles 🏭",
        "Who are you? Tap below to continue.",
      ]);
    });

    it("falls back when the API throws", async () => {
      createMock.mockRejectedValueOnce(new Error("rate limited"));
      const out = await generateBotReply(baseCtx);
      expect(out).toEqual(baseCtx.fallback);
    });

    it("falls back when the API returns empty content", async () => {
      createMock.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] });
      const out = await generateBotReply(baseCtx);
      expect(out).toEqual(baseCtx.fallback);
    });

    it("includes the step's quick replies in the user message so the LLM doesn't invent options", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "ok" } }],
      });
      await generateBotReply(baseCtx);
      const callArgs = createMock.mock.calls[0][0];
      const userMsg = callArgs.messages.at(-1)?.content as string;
      expect(userMsg).toContain('"GVT / Vitrified Floor Tiles"');
      expect(userMsg).toContain('"Slab Tiles"');
    });

    it("forwards the prior history as assistant/user turns", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "ok" } }],
      });
      await generateBotReply(baseCtx);
      const messages = createMock.mock.calls[0][0].messages;
      // [0] system, [1] assistant (history bot), [2] user (history user), [3] user (current turn)
      expect(messages[0].role).toBe("system");
      expect(messages[1]).toMatchObject({ role: "assistant", content: "Welcome to Shree Tiles." });
      expect(messages[2]).toMatchObject({ role: "user", content: "Retailer / Tile Shop Owner" });
      expect(messages[3].role).toBe("user");
    });

    it("uses the factory mode system prompt for factory mode", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "ok" } }],
      });
      await generateBotReply(baseCtx);
      const sys = createMock.mock.calls[0][0].messages[0].content as string;
      expect(sys).toContain("Factory (domestic buyer)");
    });

    it("uses the exporter mode system prompt for exporter mode", async () => {
      createMock.mockResolvedValueOnce({
        choices: [{ message: { content: "ok" } }],
      });
      await generateBotReply({ ...baseCtx, mode: "exporter", stepId: "x_welcome" });
      const sys = createMock.mock.calls[0][0].messages[0].content as string;
      expect(sys).toContain("Exporter (international buyer)");
    });
  });
});
