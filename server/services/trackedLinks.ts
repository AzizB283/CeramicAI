/**
 * Tracked links — catalogue-open signals for outbound campaigns.
 *
 * Instead of sending a raw catalogue URL, a campaign mints a tracked link:
 * `${APP_BASE_URL}/r/<token>`. When the buyer opens it, the public redirect
 * route (GET /r/:token) records the hit and 302s to the real URL. A hit is the
 * "they looked at the catalogue" buying signal that bumps the contact up the
 * call list (and stamps the recipient's openedAt).
 *
 * The token is unguessable random (not a signed JWT) — simpler, and the row it
 * points at carries no secret. Resolution is a single indexed lookup.
 */
import crypto from "node:crypto";
import { storage } from "../storage";

function baseUrl(): string {
  return process.env.APP_BASE_URL?.replace(/\/$/, "") || "http://localhost:5000";
}

/** URL-safe random token (22 chars ≈ 128 bits). */
export function mintToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export interface MintTrackedLinkInput {
  targetUrl: string;
  campaignId?: number;
  recipientId?: number;
  catalogueId?: number;
}

/**
 * Create a tracked link row and return the public redirect URL to embed in the
 * email. Must run inside a tenant context (storage.createTrackedLink scopes by
 * client). Falls back to the raw targetUrl if creation fails — a tracking
 * failure must never block the send.
 */
export async function createTrackedUrl(input: MintTrackedLinkInput): Promise<string> {
  try {
    const token = mintToken();
    await storage.createTrackedLink({
      token,
      targetUrl: input.targetUrl,
      campaignId: input.campaignId ?? null,
      recipientId: input.recipientId ?? null,
      catalogueId: input.catalogueId ?? null,
    });
    return `${baseUrl()}/r/${token}`;
  } catch (err) {
    console.warn("[trackedLinks] mint failed, using raw url:", err);
    return input.targetUrl;
  }
}
