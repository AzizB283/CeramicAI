import type { QuickReply } from "@shared/types";
import { cn } from "@/lib/utils";

export function QuickReplies({
  options,
  onPick,
}: {
  options: QuickReply[];
  onPick: (opt: QuickReply) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.label}
          onClick={() => onPick(opt)}
          className={cn(
            "rounded-full border px-4 py-2 text-sm font-medium transition active:scale-95",
            opt.priority
              ? "border-coral bg-coral/10 text-coral-dark hover:bg-coral/20"
              : "border-ink/15 bg-white text-ink hover:border-coral hover:text-coral-dark",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
