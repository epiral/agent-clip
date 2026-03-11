import { useState, useEffect } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ChevronRight, BrainCircuit } from "lucide-react";
import { Streamdown } from "streamdown";
import { useI18n } from "../lib/i18n";
import { motion, AnimatePresence } from "framer-motion";

interface ThinkingBlockProps {
  content?: string;
  isStreaming: boolean;
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    }
  }, [isStreaming]);

  if (!content && !isStreaming) return null;

  return (
    <div className="mb-6 last:mb-0">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="overflow-hidden"
      >
        <CollapsibleTrigger className="flex items-center gap-3 py-2 px-4 rounded-xl bg-muted/30 hover:bg-muted/50 text-[10px] text-muted-foreground hover:text-foreground transition-all group border border-border/20 active:scale-[0.98]">
          <div className={`transition-transform duration-500 ${isOpen ? "rotate-90" : ""}`}>
            <ChevronRight className="h-3.5 w-3.5 opacity-40" />
          </div>
          <div className="flex items-center gap-2.5 flex-1">
            <BrainCircuit className={`h-4 w-4 ${isStreaming ? 'text-primary animate-pulse' : 'text-muted-foreground/60'}`} />
            <span className="font-bold uppercase tracking-[0.2em] opacity-70 group-hover:opacity-100 transition-opacity">
              {isStreaming ? t("RESONATING") : t("PROCESS_TRACED")}
            </span>
          </div>
          
          <AnimatePresence>
            {isStreaming && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5"
              >
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }} className="h-1 w-1 bg-primary rounded-full" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="h-1 w-1 bg-primary rounded-full" />
                <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="h-1 w-1 bg-primary rounded-full" />
              </motion.div>
            )}
          </AnimatePresence>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-3 ml-2 pl-6 py-4 font-mono text-[12px] leading-relaxed text-foreground/70 border-l-[3px] border-primary/20 bg-muted/10 rounded-r-2xl shadow-inner overflow-hidden"
          >
            {content ? (
              <Streamdown>{content}</Streamdown>
            ) : (
              <span className="italic opacity-30 font-sans tracking-tight flex items-center gap-2">
                <motion.span animate={{ opacity: [0.2, 0.5, 0.2] }} transition={{ repeat: Infinity, duration: 2 }} className="w-1.5 h-1.5 rounded-full bg-primary" />
                {t("Initializing resonance...")}
              </span>
            )}
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
