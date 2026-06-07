/**
 * Send one campaign email to one (already-claimed) recipient.
 *
 * Called by the drip scheduler inside a tenant context. The recipient has
 * already been flipped queued→sending (the double-send guard), so this
 * function's job is: load the contact + the campaign's first step + its
 * catalogue, build a tracked catalogue link, render (and optionally
 * personalize) the body, send via the connected Gmail, and record the outcome
 * on the recipient row (sent | failed).
 *
 * Slice B is single-step: we always send step 0 and mark the recipient "sent".
 * Slice B2 will advance currentStep / set nextSendAt for sequences.
 */
import { storage } from "../storage";
import { sendCampaignEmail } from "./gmailSend";
import { createTrackedUrl } from "./trackedLinks";
import { renderTemplate, personalizeBody, type ContactTokens } from "./campaignContent";
import { unsubscribeUrl } from "./unsubscribeToken";
import type {
  CeramicCampaign,
  CeramicCampaignRecipient,
  CeramicClient,
  EmailConnection,
} from "@shared/schema";

// Minimal HTML escape for contact-supplied values dropped into the HTML part.
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Wrap a plain-text body into a simple branded HTML email. Links in the text
// (the catalogue URL) are turned into anchors; newlines into <br>.
function textToHtml(text: string, accent: string): string {
  const escaped = esc(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" style="color:${accent};">${url}</a>`,
  );
  const body = escaped.replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#faf3e7;padding:24px;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px;color:#1f2937;font-size:15px;line-height:1.6;">${body}</td></tr>
  </table></body></html>`;
}

export interface SendOutcome {
  ok: boolean;
  error?: string;
}

export async function sendCampaignToRecipient(
  recipient: CeramicCampaignRecipient,
  campaign: CeramicCampaign,
  client: CeramicClient,
  connection: EmailConnection,
): Promise<SendOutcome> {
  try {
    const steps = await storage.getCampaignSteps(campaign.id);
    const step = steps.find((s) => s.stepIndex === recipient.currentStep) ?? steps[0];
    if (!step) {
      await storage.updateCampaignRecipient(recipient.id, { status: "failed", error: "no campaign step" });
      return { ok: false, error: "no campaign step" };
    }

    const contact = await storage.getContact(recipient.contactId);
    if (!contact?.email) {
      await storage.updateCampaignRecipient(recipient.id, { status: "failed", error: "contact has no email" });
      return { ok: false, error: "contact has no email" };
    }

    // Build the tracked catalogue URL (if the step has a catalogue).
    let catalogueUrl: string | null = null;
    if (step.catalogueId) {
      const catalogue = await storage.getCatalogue(step.catalogueId);
      if (catalogue?.url) {
        catalogueUrl = await createTrackedUrl({
          targetUrl: catalogue.url,
          campaignId: campaign.id,
          recipientId: recipient.id,
          catalogueId: catalogue.id,
        });
      }
    }

    const tokens: ContactTokens = {
      name: contact.name,
      company: contact.company,
      country: contact.country,
      city: contact.city,
      buyerType: contact.buyerType,
      catalogue: catalogueUrl,
    };

    const subject = renderTemplate(step.subject, tokens);
    let bodyText = renderTemplate(step.bodyTemplate, tokens);
    if (campaign.aiPersonalize) {
      bodyText = await personalizeBody(bodyText, tokens, {
        factoryName: client.name,
        mode: client.mode === "exporter" ? "exporter" : "factory",
      });
    }

    const unsubUrl = unsubscribeUrl(client.id, contact.email);
    // Append an unsubscribe footer to the plain-text part (CAN-SPAM hygiene).
    const textWithFooter = `${bodyText}\n\n— ${client.name}\nTo stop receiving these emails, unsubscribe: ${unsubUrl}`;
    const accent = `#${(client.widgetColor || "e85d04").replace(/^#/, "")}`;
    const html = textToHtml(textWithFooter, accent);

    const result = await sendCampaignEmail({
      refreshToken: connection.refreshToken,
      fromAddress: connection.gmailAddress,
      fromName: client.name,
      to: contact.email,
      subject,
      html,
      text: textWithFooter,
      unsubscribeUrl: unsubUrl,
      campaignRecipientId: recipient.id,
    });

    await storage.updateCampaignRecipient(recipient.id, {
      status: "sent",
      renderedSubject: subject,
      renderedBody: bodyText,
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
      lastSentAt: new Date(),
      error: null,
    });
    // Stamp the contact's lastContactedAt (feeds the dormant-buyer detector).
    await storage.updateContact(contact.id, { lastContactedAt: new Date() }).catch(() => {});

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await storage.updateCampaignRecipient(recipient.id, { status: "failed", error: message.slice(0, 500) });
    console.warn(`[campaignSender] recipient ${recipient.id} failed:`, message);
    return { ok: false, error: message };
  }
}
