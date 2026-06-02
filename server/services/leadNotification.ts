/**
 * New-lead email alerts.
 *
 * When a buyer inquiry is captured (terminal step on web or WhatsApp) we email
 * the factory's configured recipients — owner plus up to two colleagues / sales
 * team members — with the lead details. This is the email counterpart to the
 * (still-simulated) WhatsApp owner alert; email avoids WhatsApp's per-message
 * cost while still notifying the team in real time.
 *
 * Recipients come from `ceramic_clients.owner_email` (comma-separated, max 3).
 * The send is fire-and-forget and never throws — a notification failure must
 * not roll back the lead that was already persisted.
 */

import type { CeramicClient, CeramicLead } from "@shared/schema";
import { sendEmail, parseRecipients, emailConfigured } from "./email";

// Priority leads (distributor / exclusive-rights) get a flagged subject so they
// stand out in the inbox — the highest-value path per spec §3.1/§3.2.
function isPriority(lead: CeramicLead): boolean {
  return lead.priority === "priority" || lead.priority === "high" || lead.isDistributorInquiry === true;
}

function dash(value: string | null | undefined): string {
  const v = (value ?? "").toString().trim();
  return v === "" ? "—" : v;
}

// Minimal HTML escape for buyer-supplied values dropped into the email body.
function esc(value: string | null | undefined): string {
  return dash(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface Row {
  label: string;
  value: string | null | undefined;
}

/** The ordered field list shown in the alert, tailored to the lead's channel/mode. */
function leadRows(lead: CeramicLead): Row[] {
  const product = [lead.productCategory, lead.productSize, lead.productFinish]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(" ");
  return [
    { label: "Buyer", value: lead.buyerName },
    { label: "Type", value: lead.buyerType },
    { label: "Company", value: lead.buyerCompany },
    { label: "Phone", value: lead.buyerPhone },
    { label: "Email", value: lead.buyerEmail },
    { label: "City", value: lead.buyerCity },
    { label: "Country", value: lead.buyerCountry },
    { label: "Product", value: product || null },
    { label: "Quantity", value: lead.quantity },
    { label: "Incoterms", value: lead.incoterms },
    { label: "Sample requested", value: lead.sampleRequested ? "Yes" : null },
    { label: "Channel", value: lead.channel },
  ];
}

function buildSubject(client: CeramicClient, lead: CeramicLead): string {
  const who = dash(lead.buyerName);
  const factory = client.name;
  return isPriority(lead)
    ? `🚨 PRIORITY LEAD — ${who} (${factory})`
    : `🔔 New lead — ${who} (${factory})`;
}

function buildText(client: CeramicClient, lead: CeramicLead): string {
  const head = isPriority(lead)
    ? `PRIORITY LEAD — ${client.name}`
    : `New lead — ${client.name}`;
  const body = leadRows(lead)
    .filter((r) => dash(r.value) !== "—")
    .map((r) => `${r.label}: ${dash(r.value)}`)
    .join("\n");
  const cta = isPriority(lead) ? "\n\n→ Call within 24 hours." : "";
  return `${head}\n\n${body}${cta}\n\n— CeramicBot (Aurex Auto)`;
}

function buildHtml(client: CeramicClient, lead: CeramicLead): string {
  const priority = isPriority(lead);
  const accent = priority ? "#dc2626" : "#e85d04";
  const heading = priority
    ? `🚨 PRIORITY LEAD`
    : `🔔 New lead`;
  const rows = leadRows(lead)
    .filter((r) => dash(r.value) !== "—")
    .map(
      (r) => `
        <tr>
          <td style="padding:6px 12px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(r.label)}</td>
          <td style="padding:6px 12px;color:#111827;font-size:14px;font-weight:500;">${esc(r.value)}</td>
        </tr>`,
    )
    .join("");
  const cta = priority
    ? `<p style="margin:16px 0 0;color:#dc2626;font-weight:600;font-size:14px;">→ Call this buyer within 24 hours.</p>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;background:#faf3e7;padding:24px;font-family:'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border-left:5px solid ${accent};">
      <tr>
        <td style="padding:20px 24px 8px;">
          <div style="font-size:18px;font-weight:700;color:#111827;">${heading}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">${esc(client.name)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 12px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
          ${cta}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 24px 20px;border-top:1px solid #f0e9da;color:#9ca3af;font-size:12px;">
          Sent by CeramicBot — Aurex Auto
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Notify the factory's configured email recipients about a freshly-captured
 * lead. No-ops (and logs once) when email is unconfigured or no valid
 * recipients are set. Never throws.
 *
 * `lead` must be the DECRYPTED row (as returned by storage.createLead) so the
 * email shows the buyer's real name/phone/email, not ciphertext.
 */
export async function notifyNewLead(
  client: CeramicClient | undefined,
  lead: CeramicLead,
): Promise<void> {
  try {
    if (!client) return;
    if (!emailConfigured()) return; // service already logs the reason once
    const recipients = parseRecipients(client.ownerEmail, 3);
    if (recipients.length === 0) return;

    // Buyer email (when captured) becomes Reply-To so the team can reply
    // straight to the buyer. Must look like an email — buyers can mistype.
    const replyTo =
      lead.buyerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.buyerEmail)
        ? lead.buyerEmail
        : undefined;

    await sendEmail({
      to: recipients,
      subject: buildSubject(client, lead),
      html: buildHtml(client, lead),
      text: buildText(client, lead),
      replyTo,
      fromName: client.name, // each factory's alert shows its own business name
    });
  } catch (err) {
    // Belt-and-suspenders: sendEmail already swallows, but never let a
    // formatting bug break the chat response.
    console.warn("[leadNotification] failed:", err);
  }
}
