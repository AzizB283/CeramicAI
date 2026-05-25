import { useState } from "react";
import { SendHorizonal } from "lucide-react";

export function Composer({
  placeholder,
  onSend,
}: {
  placeholder: string;
  onSend: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  const send = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder={placeholder}
        className="flex-1 rounded-full border border-ink/15 bg-white px-4 py-2.5 text-[15px] outline-none placeholder:text-ink/40 focus:border-coral"
      />
      <button
        onClick={send}
        aria-label="Send"
        className="grid h-11 w-11 place-items-center rounded-full bg-coral text-white transition active:scale-95 hover:bg-coral-dark"
      >
        <SendHorizonal className="h-5 w-5" />
      </button>
    </div>
  );
}
