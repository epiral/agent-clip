import { useEffect, useLayoutEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import type { ChatMessage } from "../lib/types";
import { MessageBubble } from "./MessageBubble";
import { Globe, Sparkles, Search, Package, ChevronDown } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendPrompt?: (msg: string) => void;
  agentName?: string;
  onScrollButtonChange?: (show: boolean) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export interface MessageListHandle {
  scrollToBottom: () => void;
  showScrollButton: boolean;
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList({ messages, isStreaming, onSendPrompt, agentName, onScrollButtonChange, hasMore, isLoadingMore, onLoadMore }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const { t } = useI18n();

  // Scroll to bottom logic
  const scrollToBottom = () => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      scrollRef.current.scrollTo({
        top: scrollHeight - clientHeight,
        behavior: "smooth",
      });
      setUserHasScrolledUp(false);
      setShowScrollButton(false);
    }
  };

  useImperativeHandle(ref, () => ({
    scrollToBottom,
    showScrollButton,
  }), [showScrollButton]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const distanceToBottom = scrollHeight - scrollTop - clientHeight;

    // If user scrolled up more than 100px from bottom
    if (distanceToBottom > 100) {
      setUserHasScrolledUp(true);
      setShowScrollButton(true);
      onScrollButtonChange?.(true);
    } else {
      setUserHasScrolledUp(false);
      setShowScrollButton(false);
      onScrollButtonChange?.(false);
    }

    // Load more when scrolled near top
    if (scrollTop < 100 && hasMore && !isLoadingMore && onLoadMore) {
      onLoadMore();
    }
  };

  // Auto-scroll when streaming if user hasn't scrolled up
  useEffect(() => {
    if (isStreaming && !userHasScrolledUp) {
      const timeout = setTimeout(() => {
        if (scrollRef.current) {
          const { scrollHeight, clientHeight } = scrollRef.current;
          scrollRef.current.scrollTo({
            top: scrollHeight - clientHeight,
            behavior: "instant"
          });
        }
      }, 30);
      return () => clearTimeout(timeout);
    }
  }, [messages, isStreaming, userHasScrolledUp]);

  // Preserve scroll position when prepending older messages
  const prevScrollHeightRef = useRef(0);

  // Capture scrollHeight before DOM update when loading more
  useEffect(() => {
    if (isLoadingMore && scrollRef.current) {
      prevScrollHeightRef.current = scrollRef.current.scrollHeight;
    }
  }, [isLoadingMore]);

  // After prepend render: restore scroll position
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prevHeight = prevScrollHeightRef.current;
    if (el && prevHeight > 0 && el.scrollHeight > prevHeight) {
      el.scrollTop = el.scrollHeight - prevHeight;
      prevScrollHeightRef.current = 0;
    }
  }, [messages]);

  // Initial scroll on load
  useEffect(() => {
    if (messages.length > 0 && !userHasScrolledUp) {
      scrollToBottom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full w-full bg-background overflow-y-auto no-scrollbar">
        <div className="max-w-2xl w-full space-y-12">
          <div className="space-y-5">
            <div className="w-12 h-12 rounded-lg border border-border flex items-center justify-center mb-6">
              <Sparkles className="w-5 h-5 text-muted-foreground" />
            </div>
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-tight">
              {t("How can I help you today?")}
            </h2>
            <p className="text-muted-foreground text-[15px] leading-relaxed max-w-md">
              {t("I'm your AI assistant, ready to help with code, analysis, writing, and more.")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: Globe, prompt: t("Browse a website"), desc: t("browse_desc") },
              { icon: Search, prompt: t("Search something"), desc: t("search_desc") },
              { icon: Package, prompt: t("List my clips"), desc: t("clips_desc") },
              { icon: Sparkles, prompt: t("What can you do?"), desc: t("abilities_desc") },
            ].map((item) => (
              <button
                key={item.prompt}
                onClick={() => onSendPrompt?.(item.prompt)}
                className="group flex items-start gap-3.5 p-4 rounded-lg border border-border bg-card hover:bg-accent hover:border-muted-foreground transition-all text-left"
              >
                <div className="w-9 h-9 rounded-md bg-background border border-border flex items-center justify-center group-hover:border-muted-foreground transition-colors shrink-0 mt-0.5">
                  <item.icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-sm font-medium text-foreground">{item.prompt}</span>
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    {item.desc}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col h-full">
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto w-full scroll-smooth no-scrollbar"
      >
        <div className="pb-32">
          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <span className="text-xs text-muted-foreground animate-pulse">Loading...</span>
            </div>
          )}
          {hasMore && !isLoadingMore && (
            <div className="flex justify-center py-3">
              <button
                onClick={onLoadMore}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("Load earlier messages")}
              </button>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} agentName={agentName} />
          ))}
        </div>
      </div>

      {showScrollButton && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-2 px-4 h-9 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg transition-all hover:bg-primary/90 active:scale-95"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            <span>{t("Scroll to bottom")}</span>
          </button>
        </div>
      )}
    </div>
  );
});
