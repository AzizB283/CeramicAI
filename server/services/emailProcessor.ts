/**
 * Email AI pipeline. Two OpenAI calls per buyer email:
 *   1. classifyAndExtract — one JSON call returns is_buyer_inquiry + all fields.
 *   2. generateReply — one call drafts the reply (only run for real inquiries).
 *
 * Reliability over novelty (matches openaiChat.ts): no key / bad response →
 * safe fallback. Classify falls back to "not a buyer" (we'd rather miss than
 * spam the inbox with junk leads). Reply falls back to a deterministic draft.
 */
import OpenAI from "openai";
import type { CeramicClient } from "@shared/schema";

const MODEL = "gpt-4o-mini";

let cached: OpenAI | null = null;
function client(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!cached) cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cached;
}

export interface BuyerEmailData {
  is_buyer_inquiry: boolean;
  buyer_name?: string | null;
  buyer_company?: string | null;
  buyer_email?: string | null;
  buyer_country?: string | null;
  buyer_city?: string | null;
  product_category?: string | null;
  product_size?: string | null;
  product_finish?: string | null;
  quantity?: string | null;
  incoterms?: string | null;
  destination_port?: string | null;
  delivery_timeline?: string | null;
  sample_requested?: boolean;
  language: string;
  source_platform?: string | null;
  buyer_type?: string | null;
}

const EXTRACT_SYSTEM = `You classify and extract data from emails sent to a ceramic tile EXPORTER in Morbi, India.
Return ONLY a JSON object with these keys (use null when unknown):
{
  "is_buyer_inquiry": boolean,   // true only if it shows intent to buy/sample/quote ceramic tiles
  "buyer_name": string|null, "buyer_company": string|null, "buyer_email": string|null,
  "buyer_country": string|null, "buyer_city": string|null,
  "product_category": string|null,  // gvt | ceramic_wall | pgvt | double_charge | slab | sanitaryware
  "product_size": string|null,      // e.g. "600x600"
  "product_finish": string|null,    // e.g. "matte" | "glossy"
  "quantity": string|null, "incoterms": string|null, "destination_port": string|null,
  "delivery_timeline": string|null, "sample_requested": boolean,
  "language": string,               // ISO code: en | ar | es | fr | ru | hi
  "source_platform": string|null,   // alibaba | indiamart | tradeindia | direct | website
  "buyer_type": string|null         // distributor | retailer | builder | importer | architect | general
}
Set is_buyer_inquiry=false for spam, newsletters, invoices, bank, internal, or anything not about buying tiles.`;

export async function classifyAndExtract(emailText: string): Promise<BuyerEmailData> {
  const ai = client();
  if (!ai) return { is_buyer_inquiry: false, language: "en" };
  try {
    const res = await ai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      max_tokens: 500,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: emailText.slice(0, 8000) },
      ],
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
    return {
      ...parsed,
      is_buyer_inquiry: Boolean(parsed.is_buyer_inquiry),
      language: typeof parsed.language === "string" ? parsed.language : "en",
    };
  } catch (err) {
    console.warn("[emailProcessor] classifyAndExtract failed:", err);
    return { is_buyer_inquiry: false, language: "en" };
  }
}

function fallbackReply(
  data: BuyerEmailData,
  clientConfig: Pick<CeramicClient, "name" | "ownerName">,
  catalogUrl: string,
): string {
  const name = data.buyer_name || "Sir/Madam";
  return [
    `Dear ${name},`,
    "",
    "Thank you for your inquiry. Please find our catalogue here:",
    catalogUrl,
    "",
    "Our export manager will share a formal quotation shortly.",
    "",
    "Best regards,",
    clientConfig.ownerName || "Export Team",
    clientConfig.name,
  ].join("\n");
}

export async function generateReply(
  data: BuyerEmailData,
  clientConfig: Pick<CeramicClient, "name" | "ownerName">,
  catalogUrl: string,
): Promise<string> {
  const ai = client();
  if (!ai) return fallbackReply(data, clientConfig, catalogUrl);
  try {
    const res = await ai.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [
        {
          role: "system",
          content: `Write a professional email reply for ${clientConfig.name}, a ceramic tile exporter in Morbi, India.
Rules: reply in language "${data.language}"; warm, concise, under 150 words; always include the catalogue link ${catalogUrl};
say a formal quotation will follow within 4 hours; ask for any missing size/quantity/finish; do NOT quote prices;
if distributor inquiry, say the director will call within 24 hours; sign off "Best regards, ${clientConfig.ownerName || "Export Team"}, ${clientConfig.name}".
Address the buyer by their name if one is given below. NEVER write a placeholder like "[Buyer's Name]" — if no name is given, open with "Dear Sir/Madam".
Buyer: name=${data.buyer_name ?? "unknown"}, company=${data.buyer_company ?? "unknown"}, country=${data.buyer_country}, product=${data.product_category} ${data.product_size} ${data.product_finish}, qty=${data.quantity}, incoterms=${data.incoterms}, port=${data.destination_port}.`,
        },
        { role: "user", content: "Generate the reply email body only. No subject line." },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : fallbackReply(data, clientConfig, catalogUrl);
  } catch (err) {
    console.warn("[emailProcessor] generateReply failed:", err);
    return fallbackReply(data, clientConfig, catalogUrl);
  }
}
