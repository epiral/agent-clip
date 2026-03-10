import type { Topic } from "../lib/types";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Plus, Settings } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface TopicListProps {
  topics: Topic[];
  currentTopicId: string | null;
  onSelectTopic: (id: string | null) => void;
  onOpenConfig: () => void;
  onCloseMobileNav?: () => void;
}

export function TopicList({
  topics,
  currentTopicId,
  onSelectTopic,
  onOpenConfig,
  onCloseMobileNav,
}: TopicListProps) {
  const { t } = useI18n();
  
  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="p-4 flex-shrink-0" style={{ WebkitAppRegion: "drag" } as any}>
        <Button
          variant="outline"
          className="w-full justify-start h-10 text-text-main border-border-subtle bg-bg-surface/50 backdrop-blur-sm hover:bg-bg-base transition-all rounded-md shadow-sm px-3"
          onClick={() => {
            onSelectTopic(null);
            onCloseMobileNav?.();
          }}
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <Plus className="mr-2 h-4 w-4" />
          <span className="text-[13px] font-medium">{t("New Chat")}</span>
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="space-y-1 pb-8 px-2">
          {topics.map((topic) => {
            const isActive = topic.id === currentTopicId;
            return (
              <button
                key={topic.id}
                onClick={() => {
                  onSelectTopic(topic.id);
                  onCloseMobileNav?.();
                }}
                className={`
                  relative w-full text-left px-3 py-2.5 transition-all duration-150 ease-out group rounded-md
                  ${
                    isActive
                      ? "bg-bg-surface text-text-main shadow-sm border border-border/20"
                      : "text-text-mute hover:bg-bg-surface/40 hover:text-text-main"
                  }
                `}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[13px] tracking-tight leading-snug truncate flex-1 ${isActive ? 'font-semibold' : 'font-normal opacity-90'}`}>
                    {topic.name}
                  </span>
                  {topic.has_active_run && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-primary shrink-0 animate-pulse" />
                  )}
                </div>
                <div className="text-[10px] text-text-mute flex justify-between font-normal tabular-nums opacity-40">
                  <span>{new Date((topic.last_message_at || topic.created_at) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })} {new Date((topic.last_message_at || topic.created_at) * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                  <span>{topic.message_count} {t("msgs")}</span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <div className="h-[56px] px-2 flex items-center border-t border-border-subtle flex-shrink-0 bg-bg-surface/50">
        <Button
          variant="ghost"
          className="w-full justify-start h-10 text-text-mute hover:text-text-main hover:bg-bg-base transition-all rounded-md px-3"
          onClick={onOpenConfig}
        >
          <Settings className="mr-2 w-[18px] h-[18px]" />
          <span className="text-[13px] font-medium">{t("Settings")}</span>
        </Button>
      </div>
    </div>
  );
}
