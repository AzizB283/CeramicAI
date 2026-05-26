import { db } from "../../db";
import { ceramicClients } from "@shared/schema";
import { eq } from "drizzle-orm";
import { currentClientId } from "../../middleware/tenant";
import { decrypt } from "../../utils/encryption";
import type { QuickReply } from "@shared/types";

/**
 * WhatsApp Business Cloud API v24 sender. Ported from clinic-ai; same shape,
 * adapted for our schema:
 *   - credentials live on ceramic_clients (waToken, waPhoneId)
 *   - currentClientId() (not currentClinicId)
 *
 * Per-tenant: every factory configures their own Meta WhatsApp credentials
 * via the admin Integrations page; nothing is shared at the platform level.
 * All sends require an active tenant context (set by the webhook handler
 * after it resolves the slug → clientId).
 */

const WHATSAPP_API_VERSION = "v24.0";

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

async function getConfig(): Promise<WhatsAppConfig> {
  const cid = currentClientId();
  if (!cid) {
    throw new Error(
      "WhatsApp send attempted without tenant context. Wrap the caller in runWithClient(clientId, …).",
    );
  }
  const [row] = await db
    .select({ waPhoneId: ceramicClients.waPhoneId, waToken: ceramicClients.waToken })
    .from(ceramicClients)
    .where(eq(ceramicClients.id, cid))
    .limit(1);
  if (!row?.waPhoneId || !row.waToken) {
    throw new Error(
      "WhatsApp is not configured for this client. Configure it via Admin → Integrations → WhatsApp.",
    );
  }
  try {
    return { accessToken: decrypt(row.waToken), phoneNumberId: row.waPhoneId };
  } catch (e) {
    console.error("[WhatsApp] Failed to decrypt access token:", e);
    throw new Error(
      "WhatsApp access token could not be decrypted. Re-save it via Admin → Integrations → WhatsApp.",
    );
  }
}

async function sendWhatsAppRequest(body: object): Promise<unknown> {
  const { accessToken, phoneNumberId } = await getConfig();
  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    console.error("[WhatsApp] API error:", response.status, errorText);
    throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
  }
  return response.json();
}

/** Mark an inbound message as read (the buyer sees the read tick). */
export async function markMessageAsRead(messageId: string): Promise<void> {
  try {
    const { accessToken, phoneNumberId } = await getConfig();
    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${phoneNumberId}/messages`;
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      }),
    });
  } catch (e) {
    // Read receipts are best-effort. Don't fail the turn if Meta rejects this.
    console.error("[WhatsApp] markMessageAsRead failed:", e);
  }
}

/** Send a plain text message. */
export async function sendTextMessage(to: string, text: string): Promise<unknown> {
  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
  });
}

interface ReplyButton {
  id: string;
  title: string;
}

/** Send an interactive message with up to 3 quick-reply buttons. */
export async function sendButtonMessage(
  to: string,
  bodyText: string,
  buttons: ReplyButton[],
  headerText?: string,
  footerText?: string,
): Promise<unknown> {
  // Meta caps button count at 3 and title length at 20 chars.
  const interactive: Record<string, unknown> = {
    type: "button",
    body: { text: bodyText },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type: "reply",
        reply: { id: b.id, title: b.title.slice(0, 20) },
      })),
    },
  };
  if (headerText) interactive.header = { type: "text", text: headerText };
  if (footerText) interactive.footer = { text: footerText };

  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  });
}

interface ListRow {
  id: string;
  title: string;
  description?: string;
}

/** Send an interactive list message (used when there are >3 quick replies). */
export async function sendListMessage(
  to: string,
  bodyText: string,
  buttonLabel: string,
  rows: ListRow[],
  headerText?: string,
  footerText?: string,
): Promise<unknown> {
  // Meta caps list rows at 10; row title 24 chars; description 72.
  const interactive: Record<string, unknown> = {
    type: "list",
    body: { text: bodyText },
    action: {
      button: buttonLabel.slice(0, 20),
      sections: [
        {
          title: "Options",
          rows: rows.slice(0, 10).map((r) => ({
            id: r.id,
            title: r.title.slice(0, 24),
            description: r.description?.slice(0, 72),
          })),
        },
      ],
    },
  };
  if (headerText) interactive.header = { type: "text", text: headerText };
  if (footerText) interactive.footer = { text: footerText };

  return sendWhatsAppRequest({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive,
  });
}

/**
 * Pick the right WhatsApp message type for the given quick replies:
 *   - 0 chips  → plain text
 *   - 1–3 chips → interactive button (Meta cap is 3)
 *   - 4+ chips  → interactive list (Meta cap is 10)
 *
 * The chip's stable id (used in webhook button responses) is built from the
 * chip label — predictable and reversible enough for our needs.
 */
export function sendQuickReplyMessage(
  to: string,
  bodyText: string,
  quickReplies: QuickReply[],
  footerText?: string,
): Promise<unknown> {
  if (quickReplies.length === 0) {
    return sendTextMessage(to, bodyText);
  }
  const items = quickReplies.map((q, i) => ({
    // The id round-trips through Meta and comes back on the button reply.
    // We use a deterministic format and parse it on inbound to recover the
    // original label — see parseChipId in the webhook handler.
    id: `chip_${i}`,
    title: q.label,
  }));
  if (items.length <= 3) {
    return sendButtonMessage(to, bodyText, items, undefined, footerText);
  }
  return sendListMessage(to, bodyText, "View Options", items, undefined, footerText);
}
