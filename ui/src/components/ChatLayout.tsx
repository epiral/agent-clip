import { useState, useEffect, useRef, useCallback } from "react";
import { useChat } from "../lib/useChat";
import { TopicList } from "./TopicList";
import { MessageList, type MessageListHandle } from "./MessageList";
import { ChatComposer } from "./ChatComposer";
import { SettingsPanel } from "./SettingsPanel";
import { SetupPage } from "./SetupPage";
import { Sheet, SheetContent } from "./ui/sheet";
import { Menu, Plus, Sidebar as SidebarIcon, Bot, MessageSquare } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { getConfig, isConfigReady, listAgents, listClips, type AgentConfig } from "../lib/agent";
import type { Agent } from "../lib/types";
import { AgentManager } from "../features/AgentManager";
import { AgentPickerView } from "../features/AgentPicker/AgentPickerView";
import { useAgentPicker } from "../features/AgentPicker/useAgentPicker";
import { AgentInfoView } from "../features/AgentInfo/AgentInfoView";
import { AgentFormView } from "../features/AgentForm/AgentFormView";

type SidebarTab = "chats" | "agents";

export function ChatLayout() {
  const chat = useChat();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [agentName, setAgentName] = useState("Clip");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [clipNames, setClipNames] = useState<string[]>([]);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("chats");
  const [formOpen, setFormOpen] = useState(false);
  const [formAgent, setFormAgent] = useState<Agent | null>(null);
  const messageListRef = useRef<MessageListHandle>(null);
  const { t } = useI18n();

  const [configState, setConfigState] = useState<null | false | true>(null);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);

  const picker = useAgentPicker(agents);

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

  const loadAgents = useCallback(async () => {
    try {
      const list = await listAgents();
      setAgents(list);
    } catch {}
  }, []);

  const loadClips = useCallback(async () => {
    try {
      const clips = await listClips();
      setClipNames(clips.map(c => c.name));
    } catch {}
  }, []);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (configState === true) {
      chat.loadTopics();
      loadAgents();
      loadClips();
    }
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

  if (configState === null) {
    return (
      <div className="flex flex-col items-center justify-center bg-background" style={{ height: "var(--app-height, 100dvh)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-lg border-2 border-primary flex items-center justify-center animate-pulse">
            <div className="w-2 h-2 bg-primary rounded-full" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground animate-pulse">Loading...</span>
        </div>
      </div>
    );
  }

  if (configState === false && agentConfig) {
    return <SetupPage config={agentConfig} onComplete={() => loadConfig()} />;
  }

  const activeTopic = chat.topics.find((t) => t.id === chat.currentTopicId);
  const activeAgent = activeTopic?.agent_id ? agents.find(a => a.id === activeTopic.agent_id) : null;
  const selectedPickerAgent = picker.selectedAgentId ? agents.find(a => a.id === picker.selectedAgentId) : null;
  const displayAgentName = activeAgent?.name ?? (activeTopic ? agentName : selectedPickerAgent?.name ?? agentName);

  const handleAgentSelect = (agent: Agent) => {
    picker.select(agent.id);
    setSidebarTab("chats");
    chat.selectTopic(null);
    setMobileMenuOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden border-r border-border">
      {/* Tab switcher */}
      <div className="p-3 border-b border-border flex-shrink-0 space-y-2" style={{ WebkitAppRegion: "drag" } as any}>
        <div className="flex rounded-lg bg-muted/50 p-0.5" style={{ WebkitAppRegion: "no-drag" } as any}>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md transition-all ${
              sidebarTab === "chats" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setSidebarTab("chats")}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {t("Chats")}
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md transition-all ${
              sidebarTab === "agents" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setSidebarTab("agents")}
          >
            <Bot className="w-3.5 h-3.5" />
            Agents
          </button>
        </div>
      </div>

      {/* Tab content */}
      {sidebarTab === "chats" ? (
        <TopicList
          topics={chat.topics}
          currentTopicId={chat.currentTopicId}
          onSelectTopic={(id) => { chat.selectTopic(id); setMobileMenuOpen(false); }}
          onDeleteTopic={chat.removeTopic}
          onOpenConfig={() => setConfigOpen(true)}
          onCloseMobileNav={() => setMobileMenuOpen(false)}
        />
      ) : (
        <AgentManager
          agents={agents}
          onAgentsChange={loadAgents}
          onSelectAgent={handleAgentSelect}
          availableProviders={agentConfig ? Object.keys(agentConfig.providers) : []}
          availableClips={clipNames}
        />
      )}
    </div>
  );

  const isNewChat = !chat.currentTopicId;

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
            <button className="md:hidden shrink-0 p-1.5 rounded-md text-foreground hover:bg-accent transition-colors" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-4.5 w-4.5" />
            </button>
            <button className="hidden md:flex shrink-0 p-1.5 rounded-md text-foreground hover:bg-accent transition-colors" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <SidebarIcon className="h-4.5 w-4.5" />
            </button>

            <div className="flex flex-col min-w-0 flex-1 md:text-left text-center">
              <h1 className="text-sm font-medium truncate text-foreground">
                {activeTopic ? activeTopic.name : t("New Chat")}
              </h1>
              {activeAgent && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1 md:justify-start justify-center">
                  <Bot className="w-3 h-3" />
                  {activeAgent.name} · {activeAgent.llm_model || "default"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {activeAgent && (
                <AgentInfoView agent={activeAgent} onEdit={() => { setFormAgent(activeAgent); setFormOpen(true); }} />
              )}
              <button className="shrink-0 p-1.5 rounded-md text-foreground hover:bg-accent transition-colors" onClick={() => { chat.selectTopic(null); picker.deselect(); }}>
                <Plus className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        </header>

        {/* Global Error Toast */}
        {chat.error && (
          <div className="px-4 py-2 z-30 shrink-0 bg-destructive/8 border-b border-destructive/20 text-destructive text-xs font-medium text-center">
            {chat.error}
          </div>
        )}

        {/* Main content: AgentPicker or Messages */}
        {isNewChat ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto">
              <AgentPickerView
                {...picker}
                onCreate={() => { setFormAgent(null); setFormOpen(true); }}
              />
            </div>
            <div className="relative z-20 border-t border-border bg-card">
              <ChatComposer
                onSend={(msg, _topicId, files) => chat.send(msg, undefined, files, picker.selectedAgentId ?? undefined)}
                onCancel={chat.cancel}
                isStreaming={chat.isStreaming}
                agentName={displayAgentName}
                selectedAgent={selectedPickerAgent ? { name: selectedPickerAgent.name } : null}
                onDeselectAgent={picker.deselect}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-hidden relative">
              <MessageList
                ref={messageListRef}
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                onSendPrompt={chat.send}
                agentName={displayAgentName}
                hasMore={chat.hasMore}
                isLoadingMore={chat.isLoadingMore}
                onLoadMore={chat.loadMore}
                scrollToBottomTrigger={chat.scrollToBottomTrigger}
              />
            </div>
            <div className="relative z-20 border-t border-border bg-card">
              <ChatComposer
                onSend={(msg, _topicId, files) => chat.send(msg, chat.currentTopicId ?? undefined, files)}
                onCancel={chat.cancel}
                isStreaming={chat.isStreaming}
                agentName={displayAgentName}
                selectedAgent={activeAgent ? { name: activeAgent.name } : null}
              />
            </div>
          </>
        )}
      </div>

      <SettingsPanel open={configOpen} onOpenChange={setConfigOpen} />
      <AgentFormView
        open={formOpen}
        onOpenChange={(open) => { if (!open) { setFormOpen(false); setFormAgent(null); } }}
        agent={formAgent}
        onSave={async (data) => {
          const { createAgent, updateAgent } = await import("../lib/agent");
          if (formAgent) {
            await updateAgent(formAgent.id, data);
          } else {
            await createAgent(data);
          }
          setFormOpen(false);
          setFormAgent(null);
          loadAgents();
        }}
        saving={false}
        availableProviders={agentConfig ? Object.keys(agentConfig.providers) : []}
        availableClips={clipNames}
      />
    </div>
  );
}
