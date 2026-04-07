import { useState, useEffect, useRef } from "react";
import { useChat } from "../lib/useChat";
import { TopicList } from "./TopicList";
import { MessageList, type MessageListHandle } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { SettingsPanel } from "./SettingsPanel";
import { SetupPage } from "./SetupPage";
import { Sheet, SheetContent } from "./ui/sheet";
import { Menu, Plus, Sidebar as SidebarIcon } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { getConfig, isConfigReady, type AgentConfig } from "../lib/agent";

export function ChatLayout() {
  const chat = useChat();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [agentName, setAgentName] = useState("Clip");
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

  // Visual Viewport API for iOS Keyboard handling
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      document.documentElement.style.setProperty("--app-height", vv.height + "px");
      window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Show loading while checking config
  if (configState === null) {
    return (
      <div 
        className="flex flex-col items-center justify-center bg-background"
        style={{ height: "var(--app-height, 100dvh)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-lg border-2 border-primary flex items-center justify-center animate-pulse">
            <div className="w-2 h-2 bg-primary rounded-full" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground animate-pulse">
            Loading...
          </span>
        </div>
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
      onDeleteTopic={chat.removeTopic}
      onOpenConfig={() => setConfigOpen(true)}
      onCloseMobileNav={() => setMobileMenuOpen(false)}
    />
  );

  return (
    <div 
      className="flex w-full overflow-hidden bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-sans"
      style={{ height: "var(--app-height, 100dvh)" }}
    >
      
      {/* Desktop Sidebar */}
      {sidebarOpen && (
        <div className="hidden md:flex flex-shrink-0 w-[300px] z-30">
          {sidebarContent}
        </div>
      )}

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-[300px] border-r-0 bg-background">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Header */}
        <header
          className="flex-shrink-0 h-12 border-b border-border flex items-center px-4 md:px-5 justify-between bg-card/80 backdrop-blur-sm z-20 pt-[env(safe-area-inset-top)]"
          style={{ WebkitAppRegion: "drag" } as any}
        >
          <div className="flex items-center gap-3 w-full" style={{ WebkitAppRegion: "no-drag" } as any}>
            <button
              className="md:hidden shrink-0 p-1.5 rounded-md text-foreground hover:bg-accent transition-colors"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-4.5 w-4.5" />
            </button>

            <button
              className="hidden md:flex shrink-0 p-1.5 rounded-md text-foreground hover:bg-accent transition-colors"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <SidebarIcon className="h-4.5 w-4.5" />
            </button>

            <div className="flex flex-col min-w-0 flex-1 md:text-left text-center">
              <h1 className="text-sm font-medium truncate text-foreground">
                {activeTopic ? activeTopic.name : t("New Chat")}
              </h1>
            </div>

            <button
              className="shrink-0 p-1.5 rounded-md text-foreground hover:bg-accent transition-colors"
              onClick={() => chat.selectTopic(null)}
            >
              <Plus className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        {/* Global Error Toast */}
        {chat.error && (
          <div className="px-4 py-2 z-30 shrink-0 bg-destructive/8 border-b border-destructive/20 text-destructive text-xs font-medium text-center">
            {chat.error}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-hidden relative">
          <MessageList 
            ref={messageListRef} 
            messages={chat.messages} 
            isStreaming={chat.isStreaming} 
            onSendPrompt={chat.send} 
            agentName={agentName} 
          />
        </div>

        {/* Input Composer */}
        <div className="relative z-20 border-t border-border bg-card">
          <ChatComposer
            onSend={(msg, topicId, files) => chat.send(msg, topicId ?? chat.currentTopicId ?? undefined, files)}
            onCancel={chat.cancel}
            isStreaming={chat.isStreaming}
            agentName={agentName}
          />
        </div>
      </div>

      <SettingsPanel open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
