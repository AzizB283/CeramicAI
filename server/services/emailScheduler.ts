/**
 * node-cron sweep: every 5 minutes, poll every Gmail-connected client's inbox.
 * The client list is cross-tenant; each client's work runs inside
 * runWithClient so storage stays tenant-scoped. One bad inbox can't stall the
 * sweep (per-client try/catch).
 */
import cron from "node-cron";
import { storage } from "../storage";
import { runWithClient } from "../middleware/tenant";
import { pollClient } from "./gmailPoller";
import { isOAuthConfigured } from "./gmailAuth";

let started = false;

export async function sweepAllInboxes(): Promise<void> {
  const clientIds = await storage.listEmailConnectedClients();
  for (const clientId of clientIds) {
    try {
      await runWithClient(clientId, async () => {
        const client = await storage.getClient(clientId);
        if (client) await pollClient(client);
      });
    } catch (err) {
      console.error(`[emailScheduler] client ${clientId} sweep failed:`, err);
    }
  }
}

export function startEmailScheduler(): void {
  if (started) return;
  if (!isOAuthConfigured()) {
    console.warn("[emailScheduler] Google OAuth not configured — email polling disabled.");
    return;
  }
  started = true;
  cron.schedule("*/5 * * * *", () => {
    void sweepAllInboxes().catch((err) => console.error("[emailScheduler] sweep error:", err));
  });
  console.log("[emailScheduler] started (every 5 min)");
}
