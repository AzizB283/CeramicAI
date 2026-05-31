import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { startKeepAlive, stopKeepAlive } from "./keepAlive";

describe("keepAlive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopKeepAlive();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.KEEP_ALIVE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
  });

  it("pings the explicit KEEP_ALIVE_URL /health after the interval", async () => {
    process.env.KEEP_ALIVE_URL = "https://example.test";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    startKeepAlive(5000);
    expect(fetchSpy).not.toHaveBeenCalled(); // first ping is after one interval

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledWith("https://example.test/health", {
      method: "GET",
    });
  });

  it("falls back to loopback on the given port when no URL is configured", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    startKeepAlive(5050);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:5050/health", {
      method: "GET",
    });
  });

  it("is idempotent — a second start does not stack timers", async () => {
    process.env.KEEP_ALIVE_URL = "https://example.test";
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    startKeepAlive(5000);
    startKeepAlive(5000); // no-op
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed ping without throwing", async () => {
    process.env.KEEP_ALIVE_URL = "https://example.test";
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    startKeepAlive(5000);
    // The timer callback must not reject (a thrown ping would crash the loop).
    // If advancing the timers rejected, this await would throw and fail the test.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(true).toBe(true);
  });
});
