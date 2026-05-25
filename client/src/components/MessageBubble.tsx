import type { ChatMessage } from "@shared/types";
import { cn } from "@/lib/utils";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isBot = message.role === "bot";
  return (
    <div className={cn("flex w-full", isBot ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm animate-fade-in-up",
          isBot
            ? "rounded-bl-sm bg-ink text-cream"
            : "rounded-br-sm bg-coral text-white",
        )}
      >
        {message.text}
      </div>
    </div>
  );
}
