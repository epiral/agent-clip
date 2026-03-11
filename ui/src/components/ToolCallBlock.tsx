import { useState, useEffect } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronRight, Check, Wrench, Loader2 } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { motion } from "framer-motion";

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
    if (!isDone) {
      setIsOpen(true);
    }
  }, [isDone]);

  return (
    <div className="mb-6 last:mb-0">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="overflow-hidden"
      >
        <CollapsibleTrigger className="flex w-full items-center gap-4 py-3 px-4 rounded-2xl bg-primary/5 hover:bg-primary/10 border border-primary/10 transition-all group active:scale-[0.98]">
          <div className="flex-1 flex items-center min-w-0 gap-4">
            <div className={`relative flex items-center justify-center h-8 w-8 rounded-xl shrink-0 transition-all duration-500 ${isDone ? 'bg-primary/20 text-primary border border-primary/20' : 'bg-primary text-primary-foreground shadow-glow'}`}>
              {!isDone ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4 stroke-[3px]" />
              )}
              {!isDone && (
                <motion.div 
                  animate={{ scale: [1, 1.4, 1], opacity: [0, 0.4, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 bg-primary rounded-xl blur-md"
                />
              )}
            </div>
            <div className="flex flex-col items-start min-w-0">
              <span className="font-mono text-[11px] font-bold text-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-primary" />
                {name}
              </span>
              <span className="text-muted-foreground/50 text-[10px] truncate max-w-[240px] font-mono mt-1 group-hover:text-muted-foreground/70 transition-colors">
                {argumentsText && argumentsText.length > 40 
                  ? `${argumentsText.slice(0, 40)}...` 
                  : argumentsText.replace(/\s+/g, ' ')}
              </span>
            </div>
          </div>
          <div className={`transition-transform duration-500 ${isOpen ? "rotate-90" : ""}`}>
            <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground/60" />
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-3 ml-4 pl-6 py-5 border-l-[3px] border-primary/20 bg-muted/10 rounded-r-2xl overflow-hidden shadow-inner"
          >
            <div className="space-y-6">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold opacity-50">
                   <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                   {t("INPUT_PARAMETERS")}
                </div>
                <pre className="font-mono text-[11px] leading-relaxed text-foreground/80 bg-card/50 p-4 rounded-xl border border-border/40 overflow-x-auto whitespace-pre-wrap shadow-soft selection:bg-primary/20">
                  {argumentsText}
                </pre>
              </div>
              
              {result && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] text-primary uppercase font-bold opacity-60">
                     <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                     {t("EXECUTION_RESULT")}
                  </div>
                  <pre className="font-mono text-[11px] leading-relaxed text-foreground/70 bg-card/50 p-4 rounded-xl border border-primary/10 overflow-x-auto whitespace-pre-wrap max-h-[500px] overflow-y-auto shadow-soft selection:bg-primary/20 scroll-smooth">
                    {result}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </div>

  );
}
