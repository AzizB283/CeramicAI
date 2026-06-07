/**
 * Persist one parsed buyer email: insert an email_threads row, auto-create a
 * ceramic_leads row (channel "email"), link them, and fire the existing Resend
 * owner alert via notifyNewLead. Runs inside runWithClient.
 */
import { storage } from "../storage";
import { notifyNewLead } from "./leadNotification";
import { pickCatalogue } from "./catalogueMatcher";
import { classifyAndExtract, generateReply, type BuyerEmailData } from "./emailProcessor";
import { triageReply } from "./campaignContent";
import type { ParsedEmail } from "./gmailPoller";
import type { CeramicClient } from "@shared/schema";
import type { LeadDraft, Mode } from "@shared/types";

/**
 * If this inbound email is a reply to an outbound campaign (sender matches an
 * open campaign recipient), attribute + triage it: classify the intent, record
 * it on the recipient, and stop the sequence (status → replied/unsubscribed).
 * Returns the classified intent so the caller can escalate a sample request to
 * a priority lead. No-ops (returns null) when the sender isn't a campaign
 * recipient. Never throws — campaign attribution must not break inbound ingest.
 */
async function attributeCampaignReply(parsed: ParsedEmail): Promise<string | null> {
  try {
    if (!parsed.fromEmail) return null;
    const recipient = await storage.findOpenRecipientByContactEmail(parsed.fromEmail);
    if (!recipient) return null;

    const intent = await triageReply(`${parsed.subject ?? ""}\n\n${parsed.bodyText ?? ""}`);
    const status = intent === "unsubscribe" ? "unsubscribed" : "replied";
    await storage.updateCampaignRecipient(recipient.id, {
      status,
      replyIntent: intent,
      repliedAt: new Date(),
    });
    // An unsubscribe via reply also belongs on the suppression list.
    if (intent === "unsubscribe") {
      await storage.suppressContact({ email: parsed.fromEmail, reason: "unsubscribe" });
      const contact = await storage.getContact(recipient.contactId);
      if (contact && !contact.optedOut) await storage.updateContact(contact.id, { optedOut: true });
    }
    return intent;
  } catch (err) {
    console.warn("[emailIngest] campaign reply attribution failed:", err);
    return null;
  }
}

export async function ingestParsedEmail(parsed: ParsedEmail, clientConfig: CeramicClient): Promise<void> {
  // Campaign-reply attribution runs first so the sequence auto-stops even if the
  // message isn't classified as a fresh buyer inquiry below.
  const campaignIntent = await attributeCampaignReply(parsed);
  const data: BuyerEmailData = await classifyAndExtract(
    `From: ${parsed.fromName ?? ""} <${parsed.fromEmail ?? ""}>\nSubject: ${parsed.subject ?? ""}\n\n${parsed.bodyText ?? ""}`,
  );
  // Skip non-buyer emails — UNLESS this is a campaign reply asking for samples
  // or clearly interested. A short "yes, send samples" may not look like a
  // classic inquiry, but it's our highest-value outcome and must become a lead.
  const campaignEscalation = campaignIntent === "sample_request" || campaignIntent === "hot";
  if (!data.is_buyer_inquiry && !campaignEscalation) return;

  const catalogUrl = await resolveCatalogUrl(clientConfig, data);
  const generatedReply = await generateReply(data, clientConfig, catalogUrl);

  let thread;
  try {
    thread = await storage.createEmailThread({
      leadId: null,
      gmailThreadId: parsed.gmailThreadId,
      gmailMessageId: parsed.gmailMessageId,
      fromEmail: parsed.fromEmail,
      fromName: parsed.fromName,
      subject: parsed.subject,
      bodyText: parsed.bodyText,
      sourcePlatform: parsed.sourcePlatform,
      language: data.language,
      generatedReply,
      status: "pending_approval",
    });
  } catch (err) {
    // Unique gmail_message_id violation → already ingested. Skip.
    console.warn(`[emailIngest] duplicate or insert failed for ${parsed.gmailMessageId}:`, err);
    return;
  }

  // A campaign reply asking for samples (or clearly hot) is the north-star
  // outcome — force it to a priority lead so the owner alert fires loud, even
  // if the buyer-type wouldn't otherwise mark it priority.
  const campaignPriority = campaignIntent === "sample_request" || campaignIntent === "hot";
  const isPriority = campaignPriority || (data.buyer_type ?? "").toLowerCase() === "distributor";
  const lead = await storage.createLead({
    sessionId: `email_${parsed.gmailMessageId}`,
    channel: "email",
    emailThreadId: thread.id,
    buyerType: data.buyer_type ?? null,
    buyerName: data.buyer_name ?? null,
    buyerEmail: parsed.fromEmail ?? data.buyer_email ?? null,
    buyerCompany: data.buyer_company ?? null,
    buyerCountry: data.buyer_country ?? null,
    buyerCity: data.buyer_city ?? null,
    productCategory: data.product_category ?? null,
    productSize: data.product_size ?? null,
    productFinish: data.product_finish ?? null,
    quantity: data.quantity ?? null,
    incoterms: data.incoterms ?? null,
    destinationPort: data.destination_port ?? null,
    sampleRequested: Boolean(data.sample_requested) || campaignIntent === "sample_request",
    isDistributorInquiry: isPriority,
    priority: isPriority ? "priority" : "normal",
    status: "new",
  });

  await storage.linkThreadToLead(thread.id, lead.id);

  // notifyNewLead is internally guarded + never throws; it no-ops when no
  // recipients are configured. Fire-and-forget so a slow Resend call doesn't
  // hold up the poll loop.
  void notifyNewLead(clientConfig, lead);
}

/**
 * Choose the catalogue URL for the reply. Uses the same score-based
 * pickCatalogue the chat bot uses (fetch the client's catalogues first), then
 * falls back to the client's default export/domestic catalog URL.
 */
async function resolveCatalogUrl(clientConfig: CeramicClient, data: BuyerEmailData): Promise<string> {
  const candidates = await storage.getCatalogues();
  const mode: Mode = clientConfig.mode === "exporter" ? "exporter" : "factory";
  const lead: LeadDraft = {
    productCategory: data.product_category ?? undefined,
    productSize: data.product_size ?? undefined,
    productFinish: data.product_finish ?? undefined,
  };
  const matched = pickCatalogue(lead, mode, candidates);
  return matched?.url ?? clientConfig.exportCatalogUrl ?? clientConfig.catalogUrl ?? "";
}
