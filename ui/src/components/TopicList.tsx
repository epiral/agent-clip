import type { Topic } from "../lib/types";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Plus, Settings, BookOpen } from "lucide-react";
import { useI18n } from "../lib/i18n";

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
          <Plus className="mr-2 h-4 w-4 shrink-0" />
          <span className="text-[13px] font-medium">{t("New Chat")}</span>
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="pb-8 px-2 space-y-1">
          {topics.map((topic) => {
            const isActive = topic.id === currentTopicId;
            const ts = (topic.last_message_at || topic.created_at) * 1000;
            return (
              <button
                key={topic.id}
                onClick={() => {
                  onSelectTopic(topic.id);
                  onCloseMobileNav?.();
                }}
                className={`
                  block w-full text-left px-3 py-2.5 rounded-md transition-all duration-150 ease-out
                  ${
                    isActive
                      ? "bg-bg-surface text-text-main shadow-sm border border-border/20"
                      : "text-text-mute hover:bg-bg-surface/40 hover:text-text-main"
                  }
                `}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[13px] tracking-tight leading-snug truncate ${isActive ? 'font-semibold' : 'font-normal opacity-90'}`}>
                    {topic.name}
                  </span>
                  {topic.has_active_run && (
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-primary shrink-0 animate-pulse" />
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5 min-w-0">
                  <span className="text-[10px] text-text-mute font-normal tabular-nums opacity-40 truncate">
                    {new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })}
                    {" "}
                    {new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </span>
                  <span className="text-[10px] text-text-mute font-normal tabular-nums opacity-40 shrink-0 ml-2">
                    {topic.message_count}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <div className="h-[56px] px-2 flex items-center gap-1 border-t border-border-subtle flex-shrink-0 bg-bg-surface/50">
        <Button
          variant="ghost"
          className="flex-1 justify-start h-10 text-text-mute hover:text-text-main hover:bg-bg-base transition-all rounded-md px-3"
          onClick={onOpenSkills}
        >
          <BookOpen className="mr-2 w-[18px] h-[18px] shrink-0" />
          <span className="text-[13px] font-medium">{t("Skills")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-text-mute hover:text-text-main hover:bg-bg-base transition-all rounded-md shrink-0"
          onClick={onOpenConfig}
        >
          <Settings className="w-[18px] h-[18px]" />
        </Button>
      </div>
    </div>
  );
}
