import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import type { ChatMessage } from "../lib/types";
import { MessageBubble } from "./MessageBubble";
import { motion, AnimatePresence } from "framer-motion";
import { Code, Sparkles, Terminal, FileText, Zap, ChevronDown } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";

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

  // Initial scroll on load
  useEffect(() => {
    if (messages.length > 0 && !userHasScrolledUp) {
      scrollToBottom();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  return (
    <div className="flex-1 relative overflow-hidden flex flex-col h-full bg-transparent">
      <AnimatePresence mode="wait">
        {messages.length === 0 ? (
          <motion.div 
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex-1 flex flex-col items-center justify-center p-8 h-full w-full"
          >
            <div className="max-w-3xl w-full space-y-16">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                className="text-center space-y-6"
              >
                <div className="relative inline-flex mb-2">
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 6, ease: "linear" }}
                    className="absolute inset-0 bg-primary/20 blur-2xl rounded-full"
                  />
                  <div className="relative w-20 h-20 rounded-3xl bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/20 shadow-glow overflow-hidden">
                    <Sparkles className="w-10 h-10" />
                    <motion.div 
                      animate={{ x: [-100, 100] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                      className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent skew-x-12"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                    {t("How can I help you today?")}
                  </h2>
                  <p className="text-muted-foreground text-lg max-w-lg mx-auto leading-relaxed opacity-70">
                    {t("I'm your AI assistant, ready to help with code, analysis, writing, and more.")}
                  </p>
                </div>
              </motion.div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { icon: FileText, label: t("Summarize text"), color: "primary", desc: "Get the gist of any document" },
                  { icon: Code, label: t("Write code"), color: "primary", desc: "Build components or solve bugs" },
                  { icon: Terminal, label: t("Run sandbox"), color: "primary", desc: "Execute scripts in a safe env" },
                  { icon: Zap, label: t("Analyze data"), color: "primary", desc: "Find patterns and insights" },
                ].map((item, i) => (
                  <motion.button 
                    key={item.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
                    onClick={() => onSendPrompt?.(item.label)}
                    className="group relative flex items-start gap-4 p-5 bento-surface hover:border-primary/40 hover:scale-[1.02] active:scale-[0.98] transition-all text-left"
                  >
                    <div className="relative w-12 h-12 rounded-xl bg-muted/30 flex items-center justify-center group-hover:bg-primary/10 group-hover:text-primary transition-colors border border-border/10 shrink-0">
                      <item.icon className="w-6 h-6" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-[15px] text-foreground">{item.label}</span>
                      <span className="text-[12px] text-muted-foreground/60 font-medium">{item.desc}</span>
                    </div>
                    <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <motion.div animate={{ x: [0, 4, 0] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        <Zap className="w-3.5 h-3.5 text-primary" />
                      </motion.div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex-1 overflow-hidden relative h-full"
          >
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="h-full overflow-y-auto w-full scroll-smooth no-scrollbar px-4"
            >
              <div className="pb-48 pt-8 max-w-4xl mx-auto w-full space-y-8">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} agentName={agentName} />
                ))}
              </div>
            </div>

            <AnimatePresence>
              {showScrollButton && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20"
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={scrollToBottom}
                    className="rounded-full shadow-tactile border border-border/40 bg-card/80 backdrop-blur-md px-5 py-6 flex gap-3 font-bold text-[13px] text-foreground hover:bg-card transition-all group active:scale-95"
                  >
                    <ChevronDown className="w-4 h-4 transition-transform group-hover:translate-y-1" />
                    {t("New messages")}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
