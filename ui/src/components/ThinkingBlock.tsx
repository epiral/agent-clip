import { useState, useEffect } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronRight } from "lucide-react";
import { Streamdown } from "streamdown";
import { useI18n } from "../lib/i18n";

interface ThinkingBlockProps {
  content?: string;
  isStreaming: boolean;
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useI18n();

  // Auto-open while streaming
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  if (!content && !isStreaming) return null;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="mb-2 transition-all"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-[11px] text-text-mute hover:text-text-main transition-all group border-l-3 border-brand-primary/30 pl-3">
        <div className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>
          <ChevronRight className="h-3 w-3 text-text-mute/30" />
        </div>
        <span className="flex-1 text-left font-medium tracking-tight opacity-70 group-hover:opacity-100 transition-opacity">
          {isStreaming ? t("RESONATING") : t("PROCESS_TRACED")}
        </span>
        
        {isStreaming && (
          <div className="flex items-center">
            <div className="h-1.5 w-1.5 bg-brand-primary rounded-full animate-pulse" />
          </div>
        )}
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="pl-6 py-2 font-mono text-[12px] leading-relaxed text-text-main/70 border-l-3 border-brand-primary/10 ml-[1.5px]">
          {content ? (
            <Streamdown>{content}</Streamdown>
          ) : (
            <span className="italic opacity-30 font-sans tracking-tight">{t("Initializing resonance...")}</span>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
