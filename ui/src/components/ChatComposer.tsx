import { useState, useRef, useEffect } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ArrowUp, Square } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface ChatComposerProps {
  onSend: (message: string) => void;
  onCancel: () => void;
  isStreaming: boolean;
  agentName?: string;
}

export function ChatComposer({ onSend, onCancel, isStreaming, agentName }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useI18n();

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="w-full transition-all duration-300 ease-in-out focus-within:px-0">
      <div className="relative group flex items-end bg-bg-surface border border-border/60 focus-within:border-brand-primary/60 rounded-xl transition-all duration-300 shadow-sm overflow-hidden">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("Ask {name} anything...", { name: agentName || "Agent" })}
          className="flex-1 min-h-[52px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-4 py-4 text-[14px] leading-relaxed placeholder:text-text-mute/40 font-normal scrollbar-none transition-all"
          rows={1}
        />
        <div className="flex items-center h-[52px] px-2">
          {isStreaming ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={onCancel}
              className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-lg transition-all"
            >
              <Square className="h-3 w-3 fill-current" />
              <span className="sr-only">Cancel</span>
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim()}
              className={`h-8 w-8 rounded-lg transition-all duration-200 ${
                input.trim() 
                  ? "bg-brand-primary text-white scale-100 opacity-100 shadow-sm hover:brightness-110 active:scale-95" 
                  : "bg-muted text-text-mute/30 scale-95 opacity-50 shadow-none"
              }`}
            >
              <ArrowUp className="h-4 w-4 stroke-[2.5]" />
              <span className="sr-only">{t("Send")}</span>
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 text-[10px] text-center text-text-mute/30 font-medium tracking-tight opacity-0 group-focus-within:opacity-100 transition-opacity duration-300">
        {t("Press Enter to Transmit")} · {t("Shift+Enter for multi-line")}
      </div>
    </div>
  );
}
