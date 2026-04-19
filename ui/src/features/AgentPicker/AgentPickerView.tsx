import type { AgentPickerState, AgentPickerActions } from "./types";
import { Plus, Bot, MessageSquarePlus, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export function AgentPickerView({
  agents,
  selectedAgentId,
  loading,
  select,
  deselect,
  onCreate,
}: AgentPickerState & AgentPickerActions & { onCreate: () => void }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-6">
          <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-[13px] text-muted-foreground/60 tracking-wider font-medium">正在加载智能体...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto px-8 py-20 md:py-32">
          {/* Header */}
          <div className="flex flex-col items-center text-center mb-20 space-y-6">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/5 text-primary">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-semibold tracking-[-0.02em] text-foreground">
                今天想聊点什么？
              </h1>
              <p className="text-muted-foreground/70 max-w-sm text-sm leading-relaxed">
                选择一个专门的智能体，或者直接开始对话。
              </p>
            </div>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Create New Agent */}
            <Card
              onClick={onCreate}
              className="group relative flex flex-col items-center justify-center p-8 border border-dashed border-border/60 bg-transparent hover:border-primary/40 hover:bg-primary/[0.02] cursor-pointer transition-all duration-300 min-h-[200px]"
            >
              <div className="w-10 h-10 rounded-full border border-border/60 flex items-center justify-center mb-5 transition-all group-hover:border-primary/40 group-hover:scale-105">
                <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">创建智能体</h3>
              <p className="text-xs text-muted-foreground/50 text-center mt-2 leading-relaxed max-w-[160px]">
                定义专属指令和工具范围
              </p>
            </Card>

            {/* Direct Chat */}
            <Card
              onClick={() => select(null)}
              className={`
                group relative flex flex-col p-8 bg-card/50 border cursor-pointer transition-all duration-300 min-h-[200px]
                ${selectedAgentId === null 
                  ? "border-primary/50 ring-1 ring-primary/20 shadow-lg shadow-primary/5" 
                  : "border-border/60 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"}
              `}
            >
              <div className="w-10 h-10 rounded-lg bg-accent/50 flex items-center justify-center mb-6">
                <MessageSquarePlus className="w-5 h-5 text-accent-foreground" />
              </div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">直接对话</h3>
              <p className="text-xs text-muted-foreground/50 mt-2 leading-relaxed">
                使用默认模型快速开始对话
              </p>
            </Card>

            {/* Agent List */}
            {agents.map((agent) => (
              <Card
                key={agent.id}
                onClick={() => select(agent.id)}
                className={`
                  group relative flex flex-col p-8 bg-card/50 border cursor-pointer transition-all duration-300 min-h-[200px]
                  ${selectedAgentId === agent.id 
                    ? "border-primary/50 ring-1 ring-primary/20 shadow-lg shadow-primary/5" 
                    : "border-border/60 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"}
                `}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/5 flex items-center justify-center mb-6 transition-transform group-hover:scale-105">
                  <Bot className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground truncate w-full">{agent.name}</h3>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {agent.llm_model && (
                    <span className="text-[10px] font-mono font-medium text-primary/70 bg-primary/5 px-2 py-0.5 rounded-sm">
                      {agent.llm_model.split('/').pop()}
                    </span>
                  )}
                  {agent.scope?.slice(0, 2).map(s => (
                    <span key={s} className="text-[10px] font-mono text-muted-foreground/60 border border-border/40 px-2 py-0.5 rounded-sm">
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground/40 mt-5 line-clamp-2 leading-relaxed italic">
                  {agent.system_prompt || "无特定指令..."}
                </p>
              </Card>
            ))}
          </div>

          {/* Empty State Illustration if no agents */}
          {agents.length === 0 && !loading && (
            <div className="mt-16 p-12 border border-border/30 rounded-[2rem] bg-muted/[0.03] text-center max-w-2xl mx-auto">
              <p className="text-xs text-muted-foreground/40 font-medium uppercase tracking-[0.2em] mb-4">
                Architecture of Thought
              </p>
              <p className="text-[13px] text-muted-foreground/60 italic leading-relaxed">
                “工欲善其事，必先利其器。” <br />
                创建一个专门的智能体来处理特定任务。
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
