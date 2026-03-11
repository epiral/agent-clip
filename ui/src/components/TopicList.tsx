import type { Topic } from "../lib/types";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Plus, Settings, BookOpen, MessageSquare, MoreHorizontal, FileText } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";

interface TopicListProps {
  topics: Topic[];
  currentTopicId: string | null;
  onSelectTopic: (id: string | null) => void;
  onOpenConfig: () => void;
  onOpenSkills: () => void;
  onCloseMobileNav?: () => void;
}

export function TopicList({
  topics,
  currentTopicId,
  onSelectTopic,
  onOpenConfig,
  onOpenSkills,
  onCloseMobileNav,
}: TopicListProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
      <div className="p-6 flex-shrink-0" style={{ WebkitAppRegion: "drag" } as any}>
        <Button
          variant="outline"
          className="w-full justify-start h-12 text-foreground border-border/40 bg-card shadow-sm hover:bg-background hover:border-primary/30 transition-all rounded-2xl px-5 group active:scale-95"
          onClick={() => {
            onSelectTopic(null);
            onCloseMobileNav?.();
          }}
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <div className="relative mr-3 h-5 w-5 shrink-0 flex items-center justify-center">
             <Plus className="h-5 w-5 text-primary transition-transform group-hover:rotate-90" />
             <motion.div 
               animate={{ scale: [1, 1.5, 1], opacity: [0, 0.5, 0] }}
               transition={{ repeat: Infinity, duration: 2 }}
               className="absolute inset-0 bg-primary/20 rounded-full blur-sm"
             />
          </div>
          <span className="text-[14px] font-bold tracking-tight">{t("New Chat")}</span>
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="pb-8 px-4 space-y-2">
          {topics.map((topic, i) => {
            const isActive = topic.id === currentTopicId;
            const ts = (topic.last_message_at || topic.created_at) * 1000;
            return (
              <motion.button
                key={topic.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03, duration: 0.4 }}
                onClick={() => {
                  onSelectTopic(topic.id);
                  onCloseMobileNav?.();
                }}
                className={`
                  group relative flex flex-col w-full text-left px-4 py-4 rounded-2xl transition-all duration-300 ease-out active:scale-[0.97]
                  ${
                    isActive
                      ? "bg-card text-foreground shadow-tactile ring-1 ring-border/50 translate-x-1"
                      : "text-muted-foreground hover:bg-card/40 hover:text-foreground"
                  }
                `}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className={`mt-0.5 shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground/30 group-hover:text-muted-foreground/60'}`}>
                    <MessageSquare className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[13px] tracking-tight leading-snug truncate transition-all ${isActive ? 'font-bold' : 'font-semibold opacity-80'}`}>
                        {topic.name}
                      </span>
                      {topic.has_active_run && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 animate-pulse shadow-glow" />
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1.5 min-w-0 opacity-40 group-hover:opacity-70 transition-opacity">
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] tabular-nums truncate">
                        {formatDistanceToNow(ts, { addSuffix: true })}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <FileText className="w-2.5 h-2.5 opacity-50" />
                        <span className="text-[10px] font-bold tabular-nums">
                          {topic.message_count}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <button className="absolute right-3 top-1/2 -translate-y-1/2 p-2 opacity-0 group-hover:opacity-100 hover:bg-muted/50 rounded-xl transition-all active:scale-90">
                  <MoreHorizontal className="w-4 h-4 text-muted-foreground/50" />
                </button>
              </motion.button>
            );
          })}
        </div>
      </ScrollArea>

      <div className="p-4 mt-auto border-t border-border/40 bg-sidebar/80 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="flex-1 justify-start h-12 text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all rounded-2xl px-4 group active:scale-95"
            onClick={onOpenSkills}
          >
            <div className="w-8 h-8 rounded-xl bg-muted/20 flex items-center justify-center mr-3 group-hover:bg-primary/10 group-hover:text-primary transition-all border border-transparent group-hover:border-primary/20">
              <BookOpen className="w-4 h-4 shrink-0" />
            </div>
            <span className="text-[13px] font-bold tracking-tight">{t("Skills")}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 text-muted-foreground hover:text-foreground hover:bg-card/60 transition-all rounded-2xl shrink-0 group active:scale-95"
            onClick={onOpenConfig}
          >
            <Settings className="w-5 h-5 group-hover:rotate-90 transition-transform duration-700" />
          </Button>
        </div>
      </div>
    </div>
  );
}
