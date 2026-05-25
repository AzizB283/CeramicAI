import { BellRing, Check } from "lucide-react";
import type { OwnerAlert } from "@/lib/useChatFlow";
import { cn } from "@/lib/utils";

/**
 * Simulates the WhatsApp alert the factory owner / export manager receives
 * when a lead is captured (spec §3.1 Step 6 / §3.2 Step 6).
 */
export function OwnerAlertPanel({ alert }: { alert: OwnerAlert }) {
  return (
    <div className="animate-fade-in-up space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
        <BellRing className="h-3.5 w-3.5 text-coral" />
        Owner notified via WhatsApp
        <Check className="h-3.5 w-3.5 text-green-600" />
      </div>
      <div
        className={cn(
          "rounded-xl border-l-4 bg-white p-3 font-mono text-[13px] leading-relaxed text-ink shadow-sm",
          alert.priority ? "border-l-red-500" : "border-l-coral",
        )}
      >
        {alert.lines.map((line, i) => (
          <div key={i} className={i === 0 ? "mb-1 font-semibold" : ""}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
