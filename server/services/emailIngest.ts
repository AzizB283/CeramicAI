/**
 * Persist one parsed buyer email: insert an email_threads row, auto-create a
 * ceramic_leads row (channel "email"), link them, and fire the existing Resend
 * owner alert via notifyNewLead. Runs inside runWithClient.
 */
import { storage } from "../storage";
import { notifyNewLead } from "./leadNotification";
import { pickCatalogue } from "./catalogueMatcher";
import { classifyAndExtract, generateReply, type BuyerEmailData } from "./emailProcessor";
import type { ParsedEmail } from "./gmailPoller";
import type { CeramicClient } from "@shared/schema";
import type { LeadDraft, Mode } from "@shared/types";

export async function ingestParsedEmail(parsed: ParsedEmail, clientConfig: CeramicClient): Promise<void> {
  const data: BuyerEmailData = await classifyAndExtract(
    `From: ${parsed.fromName ?? ""} <${parsed.fromEmail ?? ""}>\nSubject: ${parsed.subject ?? ""}\n\n${parsed.bodyText ?? ""}`,
  );
  if (!data.is_buyer_inquiry) return; // not a buyer — skip silently

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

  const isPriority = (data.buyer_type ?? "").toLowerCase() === "distributor";
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
    sampleRequested: Boolean(data.sample_requested),
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
