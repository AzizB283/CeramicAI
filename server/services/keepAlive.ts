/**
 * Keep-alive self-ping.
 *
 * Render's free tier spins a web service down after ~15 minutes with no
 * inbound traffic; the next request then pays a cold-start of 30–60s. For a
 * buyer-facing WhatsApp/chat bot that delay is unacceptable (Meta may retry,
 * the buyer sees nothing). To stay warm we hit our own `/health` endpoint on
 * a fixed interval that's comfortably under the idle threshold.
 *
 * This is best-effort and self-contained: a failed ping is logged and ignored
 * (the next tick retries). It only runs when we can resolve our own public URL
 * — locally that's the loopback address, on Render it's RENDER_EXTERNAL_URL.
 */

const TEN_MINUTES_MS = 10 * 60 * 1000;

/** Resolve the base URL to self-ping. Explicit override wins; Render injects
 *  RENDER_EXTERNAL_URL; otherwise fall back to loopback on the bound port. */
function resolveSelfUrl(port: number): string {
  const explicit = process.env.KEEP_ALIVE_URL ?? process.env.SELF_URL;
  if (explicit && explicit.trim()) return explicit.trim().replace(/\/$/, "");
  const render = process.env.RENDER_EXTERNAL_URL;
  if (render && render.trim()) return render.trim().replace(/\/$/, "");
  return `http://127.0.0.1:${port}`;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start pinging `<self>/health` every 10 minutes. Returns immediately; the
 * first ping fires after one interval (the server is obviously already warm at
 * boot). Idempotent — calling twice won't stack timers. `unref()` so the timer
 * never keeps the process alive on its own during shutdown.
 */
export function startKeepAlive(port: number): void {
  if (timer) return;
  const url = `${resolveSelfUrl(port)}/health`;

  const ping = async () => {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        console.warn(`[keepAlive] ping to ${url} returned ${res.status}`);
      }
    } catch (err) {
      console.warn(`[keepAlive] ping to ${url} failed:`, err);
    }
  };

  timer = setInterval(ping, TEN_MINUTES_MS);
  timer.unref?.();
  console.log(`[keepAlive] self-ping enabled → ${url} every 10 min`);
}

/** Stop the keep-alive timer (used in tests / graceful shutdown). */
export function stopKeepAlive(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
