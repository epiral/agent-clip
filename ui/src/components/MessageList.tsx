import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import type { ChatMessage } from "../lib/types";
import { MessageBubble } from "./MessageBubble";

import { Code, Sparkles, Binary, PenSquare } from "lucide-react";
import { useI18n } from "../lib/i18n";

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSendPrompt?: (msg: string) => void;
  agentName?: string;
  onScrollButtonChange?: (show: boolean) => void;
}

export interface MessageListHandle {
  scrollToBottom: () => void;
  showScrollButton: boolean;
}

export const MessageList = forwardRef<MessageListHandle, MessageListProps>(function MessageList({ messages, isStreaming, onSendPrompt, agentName, onScrollButtonChange }, ref) {
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
    
    // If user scrolled up more than 50px from bottom
    if (distanceToBottom > 50) {
      setUserHasScrolledUp(true);
      setShowScrollButton(true);
      onScrollButtonChange?.(true);
    } else {
      setUserHasScrolledUp(false);
      setShowScrollButton(false);
      onScrollButtonChange?.(false);
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
          });
        }
      }, 50); // slight delay to allow render
      return () => clearTimeout(timeout);
    }
  }, [messages, isStreaming, userHasScrolledUp]);

  // Initial scroll on load
  useEffect(() => {
    if (messages.length > 0 && !userHasScrolledUp) {
      scrollToBottom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col h-full bg-transparent">
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 h-full w-full animate-in-up">
          <div className="mb-16 text-center">
            <h2 className="text-[28px] font-light tracking-[-0.03em] text-text-main mb-3 leading-tight">
              {t("How can I help you today?")}
            </h2>
            <p className="text-text-mute text-[14px] font-medium tracking-tight opacity-50 uppercase tracking-[0.1em]">{t("Select an instrumental task")}</p>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[640px] px-6">
            <button 
              onClick={() => onSendPrompt?.(t("Summarize text"))}
              className="flex items-center gap-3 h-[60px] px-4 bg-bg-surface rounded-lg border border-border/40 hover:bg-bg-base hover:border-text-main/20 transition-all text-left group shadow-sm"
            >
              <div className="w-8 h-8 rounded-md bg-muted/40 flex items-center justify-center group-hover:bg-muted transition-colors border border-border/10">
                <PenSquare className="w-4 h-4 text-text-mute group-hover:text-text-main transition-all" />
              </div>
              <span className="font-semibold text-[13px] tracking-tight text-text-main/90">{t("Summarize text")}</span>
            </button>
            <button 
              onClick={() => onSendPrompt?.(t("Write code"))}
              className="flex items-center gap-3 h-[60px] px-4 bg-bg-surface rounded-lg border border-border/40 hover:bg-bg-base hover:border-text-main/20 transition-all text-left group shadow-sm"
            >
              <div className="w-8 h-8 rounded-md bg-muted/40 flex items-center justify-center group-hover:bg-muted transition-colors border border-border/10">
                <Code className="w-4 h-4 text-text-mute group-hover:text-text-main transition-all" />
              </div>
              <span className="font-semibold text-[13px] tracking-tight text-text-main/90">{t("Write code")}</span>
            </button>
            <button 
              onClick={() => onSendPrompt?.(t("Analyze data"))}
              className="flex items-center gap-3 h-[60px] px-4 bg-bg-surface rounded-lg border border-border/40 hover:bg-bg-base hover:border-text-main/20 transition-all text-left group shadow-sm"
            >
              <div className="w-8 h-8 rounded-md bg-muted/40 flex items-center justify-center group-hover:bg-muted transition-colors border border-border/10">
                <Binary className="w-4 h-4 text-text-mute group-hover:text-text-main transition-all" />
              </div>
              <span className="font-semibold text-[13px] tracking-tight text-text-main/90">{t("Analyze data")}</span>
            </button>
            <button 
              onClick={() => onSendPrompt?.(t("Run sandbox"))}
              className="flex items-center gap-3 h-[60px] px-4 bg-bg-surface rounded-lg border border-border/40 hover:bg-bg-base hover:border-text-main/20 transition-all text-left group shadow-sm"
            >
              <div className="w-8 h-8 rounded-md bg-muted/40 flex items-center justify-center group-hover:bg-muted transition-colors border border-border/10">
                <Sparkles className="w-4 h-4 text-text-mute group-hover:text-text-main transition-all" />
              </div>
              <span className="font-semibold text-[13px] tracking-tight text-text-main/90">{t("Run sandbox")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div 
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto w-full h-full scrollbar-thin scrollbar-thumb-brand-primary/10 scrollbar-track-transparent"
        >
          <div className="pb-32 pt-6 min-h-full space-y-2">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} agentName={agentName} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
});
