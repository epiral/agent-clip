import type { Topic } from "../lib/types";
import { Plus, Settings, MessageSquare, Trash2 } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface TopicListProps {
  topics: Topic[];
  currentTopicId: string | null;
  onSelectTopic: (id: string | null) => void;
  onDeleteTopic: (id: string) => void;
  onOpenConfig: () => void;
  onCloseMobileNav?: () => void;
}

function formatRelativeTime(timestamp: number) {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "JUST NOW";
  if (diff < 3600) return `${Math.floor(diff / 60)}M AGO`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}H AGO`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}D AGO`;
  const d = new Date(timestamp * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

export function TopicList({
  topics,
  currentTopicId,
  onSelectTopic,
  onDeleteTopic,
  onOpenConfig,
  onCloseMobileNav,
}: TopicListProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden border-r border-border">
      <div className="p-3 border-b border-border flex-shrink-0" style={{ WebkitAppRegion: "drag" } as any}>
        <button
          className="bg-primary text-primary-foreground text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-md hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-40 w-full flex items-center justify-center gap-2 h-9"
          onClick={() => {
            onSelectTopic(null);
            onCloseMobileNav?.();
          }}
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <Plus className="h-4 w-4" />
          <span>{t("New Chat")}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="flex flex-col p-1.5 gap-0.5">
          {topics.map((topic) => {
            const isActive = topic.id === currentTopicId;
            const ts = topic.last_message_at || topic.created_at;
            return (
              <button
                key={topic.id}
                onClick={() => {
                  onSelectTopic(topic.id);
                  onCloseMobileNav?.();
                }}
                className={`
                  group relative flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-md transition-colors
                  ${isActive ? "bg-card" : "hover:bg-accent"}
                `}
              >
                <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`} />

                <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                  <span className={`text-[13px] leading-tight truncate ${isActive ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                    {topic.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(ts)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {topic.message_count} msgs
                    </span>
                  </div>
                </div>

                {topic.has_active_run && (
                  <span className="w-1.5 h-1.5 bg-primary rounded-full shrink-0 animate-pulse" />
                )}

                <span
                  role="button"
                  className="shrink-0 p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive hover:bg-destructive/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteTopic(topic.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 border-t border-border bg-background">
        <button
          className="border border-primary text-primary text-xs font-semibold uppercase tracking-wider px-4 py-2 rounded-md hover:bg-primary hover:text-primary-foreground transition-all disabled:opacity-40 flex items-center justify-center gap-2 w-full h-9"
          onClick={onOpenConfig}
        >
          <Settings className="w-3.5 h-3.5" />
          <span>{t("Settings")}</span>
        </button>
      </div>
    </div>
  );
}
