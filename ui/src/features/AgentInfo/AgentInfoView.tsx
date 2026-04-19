import { useState } from "react";
import type { AgentInfoProps } from "./types";
import { Info, Edit, Cpu, Shield, Zap, Pin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export function AgentInfoView({ agent, onEdit }: AgentInfoProps) {
  const [open, setOpen] = useState(false);

  const sectionLabelStyle = "flex items-center gap-2 text-primary/40 mb-3";
  const sectionLabelTextStyle = "text-[10px] font-bold uppercase tracking-[0.15em]";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-muted-foreground/50 hover:text-primary hover:bg-primary/5 transition-all duration-300"
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0 shadow-2xl border-border/40 bg-background/80 backdrop-blur-2xl overflow-hidden" align="end" sideOffset={12}>
        <div className="flex flex-col">
          {/* Header */}
          <div className="p-7 relative overflow-hidden">
            <div className="relative z-10 flex items-start justify-between gap-4">
              <div className="space-y-3 min-w-0">
                <h3 className="text-lg font-semibold tracking-[-0.02em] text-foreground truncate">{agent.name}</h3>
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-mono font-bold text-primary/60 bg-primary/5 px-2 py-0.5 rounded-sm uppercase tracking-wider">
                    {agent.llm_provider || "Default"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40 font-mono tracking-tighter">
                    {agent.llm_model || "GPT-4o"}
                  </span>
                </div>
              </div>
              {onEdit && (
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-lg border-border/40 hover:bg-primary/5 hover:text-primary transition-all shrink-0"
                  onClick={() => {
                    onEdit();
                    setOpen(false);
                  }}
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {/* Subtle Gradient Background */}
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary/[0.03] rounded-full blur-3xl -mr-20 -mt-20" />
          </div>

          <Separator className="bg-border/30" />

          {/* Content */}
          <ScrollArea className="max-h-[440px]">
            <div className="p-7 space-y-8">
              {/* System Prompt */}
              <div className="space-y-3">
                <div className={sectionLabelStyle}>
                  <Cpu className="w-3 h-3" />
                  <span className={sectionLabelTextStyle}>系统指令</span>
                </div>
                <div className="text-[13px] leading-relaxed text-muted-foreground/80 bg-muted/[0.03] p-4 rounded-xl border border-border/20 italic font-medium">
                  {agent.system_prompt || "未设置特定的系统指令，将使用默认行为。"}
                </div>
              </div>

              {/* Capabilities */}
              <div className="grid grid-cols-1 gap-8">
                <div className="space-y-4">
                  <div className={sectionLabelStyle}>
                    <Shield className="w-3 h-3" />
                    <span className={sectionLabelTextStyle}>作用域 (Scope)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {agent.scope && agent.scope.length > 0 ? (
                      agent.scope.map((s) => (
                        <span key={s} className="text-[11px] font-mono text-muted-foreground/60 border border-border/30 px-2 py-0.5 rounded-sm bg-muted/[0.02]">
                          {s}
                        </span>
                      ))
                    ) : (
                      <span className="text-[12px] text-muted-foreground/30 italic">无限制</span>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className={sectionLabelStyle}>
                    <Pin className="w-3 h-3" />
                    <span className={sectionLabelTextStyle}>固定工具 (Pinned)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {agent.pinned && agent.pinned.length > 0 ? (
                      agent.pinned.map((p) => (
                        <span key={p} className="text-[11px] font-mono font-semibold text-primary/50 bg-primary/[0.03] border border-primary/10 px-2 py-0.5 rounded-sm">
                          {p}
                        </span>
                      ))
                    ) : (
                      <span className="text-[12px] text-muted-foreground/30 italic">无固定工具</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="px-7 py-5 bg-muted/[0.02] border-t border-border/30 flex items-center justify-between">
             <div className="flex items-center gap-2 text-muted-foreground/30">
               <Zap className="w-3 h-3 animate-pulse" />
               <span className="text-[10px] font-bold uppercase tracking-[0.2em]">Operational</span>
             </div>
             <div className="text-[10px] text-muted-foreground/20 font-mono tracking-widest">
               {agent.id.slice(0, 8).toUpperCase()}
             </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
