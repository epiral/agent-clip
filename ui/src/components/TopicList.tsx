import type { Topic } from "../lib/types";
import { Plus, Settings, MessageSquare, Trash2, Bot } from "lucide-react";
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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* New Chat button */}
      <div className="px-3 py-2 flex-shrink-0">
        <button
          className="w-full flex items-center justify-center gap-2 h-9 text-xs font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors"
          onClick={() => {
            onSelectTopic(null);
            onCloseMobileNav?.();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("New Chat")}
        </button>
      </div>

      {/* Topic list */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="flex flex-col p-1.5 gap-0.5">
          {topics.map((topic) => {
            const isActive = topic.id === currentTopicId;
            const ts = topic.last_message_at || topic.created_at;
            const hasAgent = !!topic.agent_name;

            return (
              <button
                key={topic.id}
                onClick={() => {
                  onSelectTopic(topic.id);
                  onCloseMobileNav?.();
                }}
                className={`group relative flex items-start gap-2.5 w-full text-left px-3 py-2.5 rounded-md transition-colors ${
                  isActive ? "bg-card shadow-sm ring-1 ring-border/50" : "hover:bg-accent/50"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  {hasAgent ? (
                    <Bot className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-primary/60'}`} />
                  ) : (
                    <MessageSquare className={`w-3.5 h-3.5 ${isActive ? 'text-foreground' : 'text-muted-foreground/60'}`} />
                  )}
                </div>

                <div className="flex flex-col min-w-0 flex-1 gap-1">
                  <span className={`text-[13px] leading-tight truncate ${isActive ? 'font-semibold text-foreground' : 'font-medium text-foreground/80'}`}>
                    {topic.name}
                  </span>
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    {topic.agent_name && (
                      <span className="text-[10px] font-semibold text-primary/80 truncate">
                        {topic.agent_name}
                      </span>
                    )}
                    {topic.agent_name && <span className="text-[10px] text-muted-foreground/30">•</span>}
                    <span className="text-[10px] text-muted-foreground/60 whitespace-nowrap">
                      {formatRelativeTime(ts)}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto whitespace-nowrap">
                      {topic.message_count}
                    </span>
                  </div>
                </div>

                {topic.has_active_run && (
                  <span className="mt-1.5 w-1.5 h-1.5 bg-primary rounded-full shrink-0 animate-pulse" />
                )}

                <span
                  role="button"
                  className="shrink-0 p-1 -mr-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive hover:bg-destructive/10 transition-colors"
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

      {/* Settings button */}
      <div className="p-3 border-t border-border">
        <button
          className="flex items-center justify-center gap-2 w-full h-9 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          onClick={onOpenConfig}
        >
          <Settings className="w-3.5 h-3.5" />
          {t("Settings")}
        </button>
      </div>
    </div>
  );
}
