/**
 * Campaign drip scheduler.
 *
 * Every minute, for each client with a campaign in the "sending" state:
 *   - check today's send count against the per-client Gmail cap
 *   - claim a small batch of queued recipients (atomic queued→sending flip)
 *   - send each via campaignSender
 *   - when a campaign has no queued recipients left, mark it "done"
 *
 * The batch is intentionally small (a handful per tick) so sends are spaced out
 * — a steady drip rather than a burst, which is far better for deliverability
 * than blasting 400 emails in one second. Cross-tenant sweep; each client runs
 * inside runWithClient so storage stays scoped. Mirrors emailScheduler.ts.
 */
import cron from "node-cron";
import { storage } from "../storage";
import { runWithClient } from "../middleware/tenant";
import { sendCampaignToRecipient } from "./campaignSender";
import { isOAuthConfigured } from "./gmailAuth";

let started = false;

// Per-tick batch size. Small = a gentle drip. With a 1-min cron this is up to
// BATCH * 1440 sends/day before the daily cap stops it.
const BATCH_PER_TICK = 5;

function dailyCap(): number {
  const n = Number(process.env.CAMPAIGN_DAILY_GMAIL_CAP);
  return Number.isFinite(n) && n > 0 ? n : 400; // headroom under Gmail's ~500/day
}

// Local midnight in the client's timezone is overkill for v1; "since 24h ago"
// is a safe, simple rolling window that still protects the Gmail account.
function windowStart(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

export async function sweepCampaigns(): Promise<void> {
  const clientIds = await storage.listClientsWithActiveCampaigns();
  for (const clientId of clientIds) {
    try {
      await runWithClient(clientId, () => sweepClientCampaigns(clientId));
    } catch (err) {
      console.error(`[campaignScheduler] client ${clientId} sweep failed:`, err);
    }
  }
}

async function sweepClientCampaigns(clientId: string): Promise<void> {
  const client = await storage.getClient(clientId);
  if (!client) return;
  const connection = await storage.getEmailConnection();
  if (!connection?.active) {
    // No connected Gmail → can't send. Leave campaigns "sending"; they'll go
    // out once the exporter (re)connects. (A future slice could surface this.)
    return;
  }

  // Respect the daily Gmail cap (rolling 24h window).
  const sentRecently = await storage.getCampaignSendCountSince(windowStart());
  const remaining = dailyCap() - sentRecently;
  if (remaining <= 0) return;

  const batch = await storage.claimQueuedRecipients(Math.min(BATCH_PER_TICK, remaining));
  if (batch.length === 0) {
    // No queued recipients left for this client → mark any drained sending
    // campaigns done so they stop being swept.
    await markDrainedCampaignsDone();
    return;
  }

  // Group claimed recipients by campaign so we load each campaign once.
  const campaignCache = new Map<number, Awaited<ReturnType<typeof storage.getCampaign>>>();
  for (const recipient of batch) {
    let campaign = campaignCache.get(recipient.campaignId);
    if (campaign === undefined) {
      campaign = await storage.getCampaign(recipient.campaignId);
      campaignCache.set(recipient.campaignId, campaign);
    }
    if (!campaign) {
      await storage.updateCampaignRecipient(recipient.id, { status: "failed", error: "campaign missing" });
      continue;
    }
    await sendCampaignToRecipient(recipient, campaign, client, connection);
  }

  await markDrainedCampaignsDone();
}

// A "sending" campaign with no queued/sending recipients left is finished.
async function markDrainedCampaignsDone(): Promise<void> {
  const campaigns = await storage.getCampaigns();
  for (const c of campaigns) {
    if (c.status !== "sending") continue;
    const recipients = await storage.getCampaignRecipients(c.id);
    const pending = recipients.some((r) => r.status === "queued" || r.status === "sending");
    if (!pending) {
      const stats = computeStats(recipients);
      await storage.updateCampaign(c.id, { status: "done", completedAt: new Date(), stats });
    }
  }
}

// Recompute the denormalised stats cache from the recipient rows.
export function computeStats(
  recipients: Array<{ status: string; replyIntent: string | null; openedAt: Date | null }>,
): Record<string, number> {
  const s: Record<string, number> = {
    total: recipients.length,
    queued: 0,
    sent: 0,
    opened: 0,
    replied: 0,
    hot: 0,
    sampleRequests: 0,
    failed: 0,
    unsubscribed: 0,
  };
  for (const r of recipients) {
    if (r.status === "queued" || r.status === "sending") s.queued++;
    if (r.status === "sent" || r.status === "active" || r.status === "replied") s.sent++;
    if (r.status === "replied") s.replied++;
    if (r.status === "failed") s.failed++;
    if (r.status === "unsubscribed") s.unsubscribed++;
    if (r.openedAt) s.opened++;
    if (r.replyIntent === "hot") s.hot++;
    if (r.replyIntent === "sample_request") s.sampleRequests++;
  }
  return s;
}

export function startCampaignScheduler(): void {
  if (started) return;
  if (!isOAuthConfigured()) {
    console.warn("[campaignScheduler] Google OAuth not configured — campaign sending disabled.");
    return;
  }
  started = true;
  cron.schedule("* * * * *", () => {
    void sweepCampaigns().catch((err) => console.error("[campaignScheduler] sweep error:", err));
  });
  console.log("[campaignScheduler] started (every 1 min)");
}
