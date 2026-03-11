import { useState, useEffect, useRef } from "react";
import { useChat } from "../lib/useChat";
import { TopicList } from "./TopicList";
import { MessageList, type MessageListHandle } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { SettingsPanel } from "./SettingsPanel";
import { SkillPanel } from "./SkillPanel";
import { SetupPage } from "./SetupPage";
import { Sheet, SheetContent } from "./ui/sheet";
import { Menu, Plus, Sidebar as SidebarIcon } from "lucide-react";
import { Button } from "./ui/button";
import { useI18n } from "../lib/i18n";
import { getConfig, isConfigReady, type AgentConfig } from "../lib/agent";
import { motion, AnimatePresence } from "framer-motion";

export function ChatLayout() {
  const chat = useChat();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
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

  // Show loading while checking config
  if (configState === null) {
    return (
      <div className="flex flex-col items-center justify-center h-[100dvh] bg-background">
        <div className="relative">
          <motion.div 
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
            className="w-24 h-24 bg-primary/20 rounded-full blur-2xl absolute -top-4 -left-4"
          />
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative flex flex-col items-center gap-4"
          >
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-glow">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-primary font-bold tracking-[0.3em] text-[10px] uppercase">
                Initializing Resonance
              </span>
              <div className="h-[2px] w-12 bg-primary/10 rounded-full overflow-hidden">
                <motion.div 
                  animate={{ x: [-48, 48] }}
                  transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                  className="w-full h-full bg-primary"
                />
              </div>
            </div>
          </motion.div>
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
      onOpenConfig={() => setConfigOpen(true)}
      onOpenSkills={() => setSkillsOpen(true)}
      onCloseMobileNav={() => setMobileMenuOpen(false)}
    />
  );

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground selection:bg-primary/20 relative font-sans">
      {/* Background Decor */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            x: [0, 20, 0],
            y: [0, -20, 0]
          }}
          transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
          className="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[120px]" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            x: [0, -30, 0],
            y: [0, 30, 0]
          }}
          transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
          className="absolute top-[20%] -right-[5%] w-[40%] h-[40%] bg-primary/3 rounded-full blur-[100px]" 
        />
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-linear-to-t from-background to-transparent opacity-60" />
      </div>

      {/* Desktop Sidebar */}
      <AnimatePresence initial={false} mode="wait">
        {sidebarOpen && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="hidden md:flex flex-shrink-0 z-30 overflow-hidden border-r border-border/40 bg-sidebar"
          >
            <div className="w-[300px] h-full">
              {sidebarContent}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Sidebar (Sheet) */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-[300px] border-r-0 bg-sidebar">
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Header */}
        <header
          className="flex-shrink-0 h-16 border-b border-border/40 flex items-center px-4 md:px-6 justify-between bg-background/60 backdrop-blur-xl z-20 pt-[env(safe-area-inset-top)]"
          style={{ WebkitAppRegion: "drag" } as any}
        >
          <div className="flex items-center gap-4 w-full" style={{ WebkitAppRegion: "no-drag" } as any}>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden shrink-0 -ml-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="hidden md:flex shrink-0 -ml-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-all active:scale-95"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <SidebarIcon className={`h-5 w-5 transition-transform duration-500 ${!sidebarOpen ? 'rotate-180' : ''}`} />
            </Button>

            <div className="flex flex-col min-w-0 flex-1 md:text-left text-center">
              <h1 className="font-bold text-[10px] tracking-[0.4em] truncate text-muted-foreground/60 uppercase">
                {activeTopic ? activeTopic.name : t("New Chat")}
              </h1>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 -mr-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-xl transition-all active:scale-95"
              onClick={() => chat.selectTopic(null)}
            >
              <Plus className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {/* Global Error Toast */}
        <AnimatePresence>
          {chat.error && (
            <motion.div 
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              className="px-6 py-3 z-30 shrink-0"
            >
              <div className="bg-destructive/10 text-destructive text-[12px] font-bold text-center border border-destructive/20 py-2 rounded-xl uppercase tracking-wider backdrop-blur-md shadow-sm">
                {chat.error}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

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

        {/* Input Composer (Floating) */}
        <div className="relative z-20">
          <ChatComposer
            onSend={(msg, topicId, files) => chat.send(msg, topicId ?? chat.currentTopicId ?? undefined, files)}
            onCancel={chat.cancel}
            isStreaming={chat.isStreaming}
            agentName={agentName}
          />
        </div>
      </div>

      <SettingsPanel open={configOpen} onOpenChange={setConfigOpen} />
      <SkillPanel open={skillsOpen} onOpenChange={setSkillsOpen} />
    </div>
  );
}
