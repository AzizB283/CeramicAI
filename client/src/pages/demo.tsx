import { useEffect, useRef } from "react";
import { Factory, Globe2, FileText } from "lucide-react";
import type { Mode } from "@shared/types";
import { CATALOG_URL } from "@shared/flows";
import { useChatFlow } from "@/lib/useChatFlow";
import { MessageBubble } from "@/components/MessageBubble";
import { TypingDots } from "@/components/TypingDots";
import { QuickReplies } from "@/components/QuickReplies";
import { Composer } from "@/components/Composer";
import { OwnerAlertPanel } from "@/components/OwnerAlertPanel";
import { cn } from "@/lib/utils";

export default function DemoChat() {
  const chat = useChatFlow("factory");
  const threadRef = useRef<HTMLDivElement>(null);

  // Start the conversation on first mount.
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      chat.start("factory");
    }
  }, [chat]);

  // Auto-scroll to the latest bubble.
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

  return (
    <div className="flex min-h-full flex-col items-center bg-cream px-4 py-6">
      {/* Brand header */}
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-bold text-ink">
          Ceramic<span className="text-coral">Bot</span>
        </h1>
        <p className="text-sm text-ink-soft">
          AI inquiry bot for ceramic factories &amp; exporters
        </p>
      </header>

      {/* Mode toggle */}
      <div className="mb-4 flex gap-1 rounded-full bg-cream-deep p-1">
        <ModeButton
          active={chat.mode === "factory"}
          onClick={() => switchMode("factory")}
          icon={<Factory className="h-4 w-4" />}
          label="Factory Bot"
        />
        <ModeButton
          active={chat.mode === "exporter"}
          onClick={() => switchMode("exporter")}
          icon={<Globe2 className="h-4 w-4" />}
          label="Export Bot"
        />
      </div>

      {/* Chat window */}
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-ink/10 bg-cream shadow-xl">
        {/* Window bar */}
        <div className="flex items-center gap-3 bg-ink px-4 py-3 text-cream">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-coral text-white">
            {chat.mode === "factory" ? (
              <Factory className="h-5 w-5" />
            ) : (
              <Globe2 className="h-5 w-5" />
            )}
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">CeramicBot</div>
            <div className="text-xs text-cream/60">online · replies instantly</div>
          </div>
        </div>

        {/* Thread */}
        <div
          ref={threadRef}
          className="scrollbar-thin flex h-[58vh] flex-col gap-3 overflow-y-auto px-4 py-4"
        >
          {chat.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {chat.typing && <TypingDots />}

          {/* Catalog link button, shown on catalog steps once bot finished. */}
          {step.catalog && !chat.typing && (
            <a
              href={CATALOG_URL[step.catalog]}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-2 rounded-xl border border-coral bg-white px-4 py-2.5 text-sm font-medium text-coral-dark shadow-sm transition hover:bg-coral/10"
            >
              <FileText className="h-4 w-4" />
              {step.catalog === "export" ? "Export Catalog (PDF)" : "Product Catalog (PDF)"}
            </a>
          )}

          {chat.ownerAlert && <OwnerAlertPanel alert={chat.ownerAlert} />}
        </div>

        {/* Input area */}
        <div className="border-t border-ink/10 bg-cream-deep/40 px-4 py-3">
          {chat.typing ? (
            <p className="py-2 text-center text-xs text-ink/40">CeramicBot is typing…</p>
          ) : step.input === "text" ? (
            <Composer
              placeholder={step.placeholder ?? "Type a message…"}
              onSend={chat.submitText}
            />
          ) : (
            <QuickReplies options={step.options ?? []} onPick={chat.chooseOption} />
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-5 text-center text-xs text-ink/50">
        Powered by{" "}
        <a
          href="https://aurexauto.com"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-coral-dark hover:underline"
        >
          Aurex Auto
        </a>{" "}
        · Morbi, Gujarat
      </footer>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
        active
          ? "bg-coral text-white shadow"
          : "text-ink-soft hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
