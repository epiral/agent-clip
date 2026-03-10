import { useState, useEffect, useRef } from "react";
import { useChat } from "../lib/useChat";
import { TopicList } from "./TopicList";
import { MessageList, type MessageListHandle } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { SettingsPanel } from "./SettingsPanel";
import { SetupPage } from "./SetupPage";
import { Sheet, SheetContent } from "./ui/sheet";
import { Menu, Plus, ArrowDown } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "../lib/i18n";
import { getConfig, isConfigReady, type AgentConfig } from "../lib/agent";

export function ChatLayout() {
  const chat = useChat();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [agentName, setAgentName] = useState("Clip");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messageListRef = useRef<MessageListHandle>(null);
  const { t } = useI18n();

  // Config state: null = loading, false = not ready, true = ready
  const [configState, setConfigState] = useState<null | false | true>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);

  const loadConfig = async () => {
    try {
      const cfg = await getConfig();
      setAgentConfig(cfg);
      setAgentName(cfg.name || "Clip");
      setConfigState(isConfigReady(cfg));
    } catch {
      setConfigState(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (configState === true) {
      chat.loadTopics();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configState]);

  // Show loading while checking config
  if (configState === null) {
    return (
      <div className="flex items-center justify-center h-[100dvh] bg-bg-base">
        <div className="text-text-mute text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  // Show setup page if not configured
  if (configState === false && agentConfig) {
    return (
      <SetupPage
        config={agentConfig}
        onComplete={() => loadConfig()}
      />
    );
  }

  const activeTopic = chat.topics.find((t) => t.id === chat.currentTopicId);

  const sidebarContent = (
    <TopicList
      topics={chat.topics}
      currentTopicId={chat.currentTopicId}
      onSelectTopic={chat.selectTopic}
      onOpenConfig={() => setConfigOpen(true)}
      onCloseMobileNav={() => setMobileMenuOpen(false)}
    />
  );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-bg-base text-text-main selection:bg-brand-primary/20 animate-in-up">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-[280px] flex-shrink-0 glass-sidebar z-30">
        {sidebarContent}
      </div>

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-[280px] border-r-0 glass-sidebar">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header
          className="flex-shrink-0 h-14 border-b border-border-subtle flex items-center px-4 md:px-6 justify-between bg-bg-surface/40 backdrop-blur-md z-20 pt-[env(safe-area-inset-top)]"
          style={{ WebkitAppRegion: "drag" } as any}
        >
          <div className="flex items-center gap-4 w-full" style={{ WebkitAppRegion: "no-drag" } as any}>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0 -ml-2 text-text-mute hover:text-text-main hover:bg-bg-base/50 rounded-md transition-all"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>

            <div className="flex flex-col min-w-0 flex-1 md:text-left text-center">
              <h1 className="font-semibold text-[11px] tracking-[0.2em] truncate text-text-mute uppercase">
                {activeTopic ? activeTopic.name : t("New Chat")}
              </h1>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0 -mr-2 text-text-mute hover:text-text-main hover:bg-bg-base/50 rounded-md transition-all"
              onClick={() => chat.selectTopic(null)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Global Error Toast */}
        {chat.error && (
          <div className="bg-destructive/5 text-destructive px-6 py-2 text-[12px] font-medium text-center border-b border-destructive/10 z-30 shrink-0">
            {chat.error}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-hidden relative">
          <div className="h-full w-full max-w-[850px] mx-auto">
            <MessageList ref={messageListRef} messages={chat.messages} isStreaming={chat.isStreaming} onSendPrompt={chat.send} agentName={agentName} onScrollButtonChange={setShowScrollBtn} />
          </div>
        </div>

        {/* Input Composer (Floating) */}
        <div className="absolute bottom-0 left-0 right-0 p-4 md:p-6 pointer-events-none z-20">
          <div className="max-w-[800px] mx-auto pointer-events-auto relative">
            {showScrollBtn && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2">
                <Button
                  variant="secondary"
                  size="icon"
                  className="rounded-full shadow-md w-8 h-8 opacity-80 hover:opacity-100 border border-border"
                  onClick={() => messageListRef.current?.scrollToBottom()}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </div>
            )}
            <ChatComposer
              onSend={(msg, topicId, files) => chat.send(msg, topicId ?? chat.currentTopicId ?? undefined, files)}
              onCancel={chat.cancel}
              isStreaming={chat.isStreaming}
              agentName={agentName}
            />
          </div>
        </div>
      </div>

      <SettingsPanel open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
