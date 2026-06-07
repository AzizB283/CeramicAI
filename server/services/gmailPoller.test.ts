import { describe, it, expect } from "vitest";
import { parseGmailMessage, detectSourcePlatform } from "./gmailPoller";

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

describe("parseGmailMessage", () => {
  it("extracts headers and decodes a plain-text body", () => {
    const msg = {
      id: "M1",
      threadId: "T1",
      payload: {
        headers: [
          { name: "From", value: "Ahmed <ahmed@ahmedtrading.com>" },
          { name: "Subject", value: "Inquiry - GVT 600x600" },
        ],
        mimeType: "text/plain",
        body: { data: b64url("we need 3 containers") },
      },
    };
    const out = parseGmailMessage(msg as any);
    expect(out.gmailMessageId).toBe("M1");
    expect(out.fromEmail).toBe("ahmed@ahmedtrading.com");
    expect(out.fromName).toBe("Ahmed");
    expect(out.subject).toBe("Inquiry - GVT 600x600");
    expect(out.bodyText).toContain("3 containers");
  });

  it("walks multipart payloads to find text/plain", () => {
    const msg = {
      id: "M2",
      threadId: "T2",
      payload: {
        headers: [{ name: "From", value: "buyer@x.com" }],
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/html", body: { data: b64url("<p>hi</p>") } },
          { mimeType: "text/plain", body: { data: b64url("plain body here") } },
        ],
      },
    };
    const out = parseGmailMessage(msg as any);
    expect(out.fromEmail).toBe("buyer@x.com");
    expect(out.fromName).toBe(null);
    expect(out.bodyText).toBe("plain body here");
  });
});

describe("detectSourcePlatform", () => {
  it("maps known senders/subjects", () => {
    expect(detectSourcePlatform("notification@alibaba.com", "Buyer Inquiry")).toBe("alibaba");
    expect(detectSourcePlatform("noreply@indiamart.com", "x")).toBe("indiamart");
    expect(detectSourcePlatform("info@tradeindia.com", "x")).toBe("tradeindia");
    expect(detectSourcePlatform("ahmed@ahmedtrading.com", "hi")).toBe("direct");
  });
});
