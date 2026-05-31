import DemoChat from "@/pages/demo";

/**
 * Standalone /chat page intended for iframe embedding (and as a shareable
 * direct link). It renders the same chat engine as the public demo but in the
 * "embed" variant: no Factory/Export mode toggle (the factory runs its own
 * single mode, resolved from widget-config), the chat window fills the iframe
 * edge-to-edge, and the "Powered by Aurex Auto" credit sits inside the widget
 * just below the composer.
 */
export default function EmbedChat() {
  return <DemoChat variant="embed" />;
}
