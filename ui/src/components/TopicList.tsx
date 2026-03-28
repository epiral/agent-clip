import type { Topic } from "../lib/types";
import { Plus, Settings, MessageSquare, MoreHorizontal, FileText } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface TopicListProps {
  topics: Topic[];
  currentTopicId: string | null;
  onSelectTopic: (id: string | null) => void;
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
  onOpenConfig,
  onCloseMobileNav,
}: TopicListProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full w-full bg-paper overflow-hidden border-r border-border">
      <div className="p-4 border-b border-border flex-shrink-0" style={{ WebkitAppRegion: "drag" } as any}>
        <button
          className="ink-button w-full flex items-center justify-center gap-2 h-10"
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
        <div className="flex flex-col">
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
                  group relative flex items-stretch w-full text-left border-b border-border transition-colors
                  ${isActive ? "bg-surface" : "hover:bg-surface-hover"}
                `}
              >
                {/* Active Indicator (Swimlane) */}
                <div className={`w-1 shrink-0 transition-colors ${isActive ? "bg-ink" : "bg-transparent"}`} />
                
                <div className="flex-1 min-w-0 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <MessageSquare className={`w-3 h-3 shrink-0 ${isActive ? 'text-ink' : 'text-muted'}`} />
                        <span className={`text-sm leading-tight truncate ${isActive ? 'font-semibold text-ink' : 'font-medium text-foreground/80'}`}>
                          {topic.name}
                        </span>
                        {topic.has_active_run && (
                          <span className="w-1.5 h-1.5 bg-active shrink-0" />
                        )}
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-muted uppercase tracking-wider">
                          {formatRelativeTime(ts)}
                        </span>
                        <div className="flex items-center gap-1 opacity-40">
                          <FileText className="w-2.5 h-2.5" />
                          <span className="text-[10px] font-mono font-bold">
                            {topic.message_count}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <button 
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-border transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Add context menu or actions
                      }}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5 text-muted" />
                    </button>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 border-t border-border bg-paper">
        <button
          className="outline-button flex items-center justify-center gap-2 w-full h-10"
          onClick={onOpenConfig}
        >
          <Settings className="w-4 h-4" />
          <span>{t("Settings")}</span>
        </button>
      </div>
    </div>
  );
}
