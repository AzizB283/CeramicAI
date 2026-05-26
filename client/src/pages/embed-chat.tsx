import DemoChat from "@/pages/demo";

/**
 * Standalone /chat page intended for iframe embedding (and as a shareable
 * direct link). It renders the same chat experience as the public demo but
 * is detected/styled to fit a small floating widget shell.
 *
 * Currently this is a thin wrapper around <DemoChat />. If we later want
 * an iframe-specific compact layout (no header, edge-to-edge bubbles),
 * factor the chat window out of DemoChat into a shared component and
 * import it here directly.
 */
export default function EmbedChat() {
  return <DemoChat />;
}
