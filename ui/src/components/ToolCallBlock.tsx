import { useState, useEffect } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronRight, Check } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface ToolCallBlockProps {
  name: string;
  argumentsText: string;
  result?: string;
  isStreaming: boolean;
}

export function ToolCallBlock({ name, argumentsText, result, isStreaming }: ToolCallBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useI18n();

  const isDone = result !== undefined || (!isStreaming && result === undefined);

  useEffect(() => {
    // Open when running
    if (!isDone) {
      setIsOpen(true);
    }
  }, [isDone]);

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="mb-2 transition-all"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 hover:opacity-80 transition-all group border-l-3 border-brand-primary pl-3">
        <div className="flex-1 flex items-center min-w-0 gap-2">
          {!isDone ? (
            <div className="h-1.5 w-1.5 bg-brand-primary rounded-full animate-pulse shrink-0" />
          ) : (
            <Check className="h-3 w-3 text-brand-primary shrink-0 stroke-[3px]" />
          )}
          <span className="font-mono text-[11px] font-bold text-text-main truncate opacity-80 group-hover:opacity-100 transition-opacity">
            {name}
          </span>
          <span className="text-text-mute/40 text-[10px] truncate max-w-[150px] hidden sm:block font-mono">
            {argumentsText && argumentsText.length > 15 
              ? `[...]` 
              : argumentsText.replace(/\s+/g, ' ')}
          </span>
        </div>
        <div className={`transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}>
          <ChevronRight className="h-3 w-3 text-text-mute/30" />
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent>
        <div className="border-l-3 border-brand-primary/10 ml-[1.5px] pl-6 py-2">
          <div className="space-y-4">
            <div className="space-y-1">
              <div className="text-[10px] tracking-tight text-text-mute/60 font-semibold">{t("INPUT_PARAMETERS")}</div>
              <pre className="font-mono text-[11px] leading-relaxed text-text-main/70 bg-muted/20 p-2 rounded-md border border-border/10 overflow-x-auto whitespace-pre-wrap">
                {argumentsText}
              </pre>
            </div>
            
            {result && (
              <div className="space-y-1">
                <div className="text-[10px] tracking-tight text-text-mute/60 font-semibold">{t("EXECUTION_RESULT")}</div>
                <pre className="font-mono text-[11px] leading-relaxed text-text-main/60 bg-muted/20 p-2 rounded-md border border-border/10 overflow-x-auto whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                  {result}
                </pre>
              </div>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
