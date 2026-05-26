import { useState } from "react";
import { SendHorizonal } from "lucide-react";

export function Composer({
  placeholder,
  onSend,
  disabled = false,
}: {
  placeholder: string;
  onSend: (value: string) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    if (disabled) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 rounded-full border border-ink/15 bg-white px-4 py-2.5 text-[15px] outline-none placeholder:text-ink/40 focus:border-coral disabled:bg-cream-deep/40 disabled:cursor-not-allowed"
      />
      <button
        onClick={send}
        aria-label="Send"
        disabled={disabled || !value.trim()}
        className="grid h-11 w-11 place-items-center rounded-full bg-coral text-white transition active:scale-95 hover:bg-coral-dark disabled:bg-coral/40 disabled:cursor-not-allowed"
      >
        <SendHorizonal className="h-5 w-5" />
      </button>
    </div>
  );
}
