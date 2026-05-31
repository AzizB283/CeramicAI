import { useEffect, useMemo, useRef, useState } from "react";
import { Factory, Globe2, FileText, MessageSquare, SendHorizonal } from "lucide-react";
import type { Mode, QuickReply } from "@shared/types";
import { CATALOG_URL } from "@shared/flows";
import { useChatFlow } from "@/lib/useChatFlow";
import { cn } from "@/lib/utils";

type WidgetConfig = {
  botName: string;
  color: string;
  greeting: string | null;
  mode: Mode;
};

const DEFAULT_CONFIG: WidgetConfig = {
  botName: "CeramicBot",
  color: "#e85d04",
  greeting: null,
  mode: "factory",
};

/**
 * "demo"  → public showcase at /demo: shows the Factory/Export mode toggle and
 *           the outer page chrome, so prospects can preview both flows.
 * "embed" → the /chat iframe widget: just the chat window. No mode toggle (a
 *           real factory runs one mode, taken from widget-config); the
 *           Aurex Auto credit sits inside the widget, below the composer; and
 *           the shell fills the iframe edge-to-edge.
 */
export type ChatVariant = "demo" | "embed";

function getContrastColor(hex: string): string {
  const h = hex.replace(/^#/, "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

export default function DemoChat({ variant = "demo" }: { variant?: ChatVariant }) {
  const isEmbed = variant === "embed";
  const chat = useChatFlow("factory");
  const threadRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [input, setInput] = useState("");

  // Resolve the client slug the embed carries as ?client=<slug> so we fetch the
  // right factory's branding + mode (and below, start in that mode).
  const clientSlug =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("client")
      : null;

  useEffect(() => {
    const qs = clientSlug ? `?client=${encodeURIComponent(clientSlug)}` : "";
    fetch(`/api/public/widget-config${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c) setConfig({ ...DEFAULT_CONFIG, ...c });
      })
      .catch(() => {})
      // Mark loaded either way so the embed can start (falling back to the
      // default mode if the fetch failed) rather than hanging on a blank widget.
      .finally(() => setConfigLoaded(true));
  }, [clientSlug]);

  // Start the conversation on first mount. The public demo always opens in
  // factory mode immediately; the embed waits for widget-config so it can open
  // in the factory's configured mode (no toggle to switch later).
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    if (!isEmbed) {
      started.current = true;
      chat.start("factory");
    } else if (configLoaded) {
      started.current = true;
      chat.start(config.mode);
    }
  }, [chat, isEmbed, configLoaded, config.mode]);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.messages, chat.typing, chat.ownerAlert]);

  const switchMode = (m: Mode) => {
    if (m !== chat.mode) chat.start(m);
  };

  const { step } = chat;
  const themeColor = config.color || "#e85d04";
  const textOnTheme = useMemo(() => getContrastColor(themeColor), [themeColor]);
  const botName = config.botName || "CeramicBot";

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || chat.typing) return;
    chat.submitText(trimmed);
    setInput("");
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center",
        // Embed: fill the iframe edge-to-edge, no page chrome. Demo: centered
        // card on the cream page with breathing room and the mode toggle.
        isEmbed ? "min-h-full bg-white" : "min-h-full bg-cream px-4 py-8",
      )}
    >
      {/* Mode toggle — demo only. The embedded widget runs the factory's own
          single mode (from widget-config), so there's nothing to switch. */}
      {!isEmbed && (
        <div className="mb-4 flex items-center gap-1 rounded-full border border-ink/10 bg-white p-1 text-xs">
          <ModeButton
            active={chat.mode === "factory"}
            onClick={() => switchMode("factory")}
            icon={<Factory className="h-3.5 w-3.5" />}
            label="Factory"
            color={themeColor}
            textOnTheme={textOnTheme}
          />
          <ModeButton
            active={chat.mode === "exporter"}
            onClick={() => switchMode("exporter")}
            icon={<Globe2 className="h-3.5 w-3.5" />}
            label="Export"
            color={themeColor}
            textOnTheme={textOnTheme}
          />
        </div>
      )}

      {/* Chat window. Demo: fixed-height card. Embed: fills the iframe height. */}
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden bg-white",
          isEmbed
            ? "h-full max-w-none rounded-none border-0 shadow-none"
            : "h-[32rem] max-w-sm rounded-2xl border border-ink/10 shadow-xl",
        )}
      >
        {/* Header — theme color */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ backgroundColor: themeColor }}
        >
          <div
            className="grid h-9 w-9 place-items-center rounded-full"
            style={{ backgroundColor: `${textOnTheme}22` }}
          >
            <MessageSquare className="h-4.5 w-4.5" style={{ color: textOnTheme }} />
          </div>
          <div className="leading-tight">
            <div
              className="text-sm font-medium"
              style={{ color: textOnTheme }}
              data-testid="text-bot-name"
            >
              {botName}
            </div>
            <div className="text-xs" style={{ color: `${textOnTheme}b3` }}>
              online · replies instantly
            </div>
          </div>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          className="scrollbar-thin flex flex-1 flex-col gap-3 overflow-y-auto bg-cream/30 px-4 py-4"
        >
          {chat.messages.map((m) => {
            const isBot = m.role === "bot";
            return (
              <div key={m.id} className="flex flex-col gap-2">
                <div className={cn("flex w-full", isBot ? "justify-start" : "justify-end")}>
                  <div
                    style={
                      isBot
                        ? undefined
                        : { backgroundColor: themeColor, color: textOnTheme }
                    }
                    className={cn(
                      "max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed shadow-sm animate-fade-in-up",
                      isBot ? "rounded-tl-none bg-white text-ink" : "rounded-tr-none",
                    )}
                  >
                    {m.text}
                  </div>
                </div>
                {m.quickReplies && m.quickReplies.length > 0 && !chat.typing && (
                  <QuickReplyChips
                    options={m.quickReplies}
                    onPick={chat.chooseOption}
                    color={themeColor}
                    textOnTheme={textOnTheme}
                  />
                )}
              </div>
            );
          })}

          {chat.typing && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-lg rounded-tl-none bg-white px-3 py-2.5 shadow-sm">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-ink/40 animate-typing-dot"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {step.catalog && !chat.typing && (
            <a
              href={step.catalogUrl ?? CATALOG_URL[step.catalog]}
              target="_blank"
              rel="noreferrer"
              style={{ borderColor: themeColor, color: themeColor }}
              className="flex w-fit items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium transition hover:bg-black/5"
            >
              <FileText className="h-4 w-4" />
              {step.catalog === "export" ? "Export Catalog (PDF)" : "Product Catalog (PDF)"}
            </a>
          )}

          {chat.ownerAlert && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="mb-1 font-semibold">
                {chat.ownerAlert.priority ? "🚨 PRIORITY LEAD" : "🔔 New Lead"}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {chat.ownerAlert.lines.join("\n")}
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-ink/10 bg-white p-3">
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={
                chat.typing
                  ? `${botName} is typing…`
                  : step.input === "text"
                    ? (step.placeholder ?? "Type your answer…")
                    : "Tap a chip or type a question…"
              }
              disabled={chat.typing}
              className="flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none placeholder:text-ink/40 focus:border-ink/40 disabled:cursor-not-allowed disabled:bg-cream-deep/40"
              style={{ ["--tw-ring-color" as never]: themeColor }}
            />
            <button
              onClick={handleSend}
              disabled={chat.typing || !input.trim()}
              aria-label="Send"
              style={{ backgroundColor: themeColor, color: textOnTheme }}
              className="grid h-9 w-9 place-items-center rounded-md transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SendHorizonal className="h-4 w-4" />
            </button>
          </div>

          {/* Embed: the Aurex Auto credit lives inside the widget, just below
              the input, so the iframe contains the whole experience. */}
          {isEmbed && (
            <PoweredBy color={themeColor} className="mt-2 text-center" />
          )}
        </div>
      </div>

      {/* Demo: the credit sits below the card on the cream page. */}
      {!isEmbed && (
        <PoweredBy color={themeColor} className="mt-4 text-center" />
      )}
    </div>
  );
}

function PoweredBy({ color, className }: { color: string; className?: string }) {
  return (
    <footer className={cn("text-xs text-ink/50", className)}>
      Powered by{" "}
      <a
        href="https://aurexauto.com"
        target="_blank"
        rel="noreferrer"
        style={{ color }}
        className="font-medium hover:underline"
      >
        Aurex Auto
      </a>
    </footer>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
  color,
  textOnTheme,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  color: string;
  textOnTheme: string;
}) {
  return (
    <button
      onClick={onClick}
      style={active ? { backgroundColor: color, color: textOnTheme } : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition",
        active ? "shadow-sm" : "text-ink/60 hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function QuickReplyChips({
  options,
  onPick,
  color,
  textOnTheme,
}: {
  options: QuickReply[];
  onPick: (opt: QuickReply) => void;
  color: string;
  textOnTheme: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5 pl-1">
      {options.map((opt) => {
        const isPriority = opt.priority === true;
        return (
          <button
            key={opt.label}
            onClick={() => onPick(opt)}
            style={
              isPriority
                ? { backgroundColor: color, color: textOnTheme, borderColor: color }
                : { borderColor: color, color: color }
            }
            onMouseEnter={(e) => {
              if (isPriority) return;
              e.currentTarget.style.backgroundColor = color;
              e.currentTarget.style.color = textOnTheme;
            }}
            onMouseLeave={(e) => {
              if (isPriority) return;
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = color;
            }}
            className="rounded-full border bg-transparent px-3 py-1 text-xs font-medium transition-colors"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
