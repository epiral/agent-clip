import type { AgentManagerState, AgentManagerActions } from "./types";
import type { Agent } from "../../lib/types";
import { Plus, Bot, Edit2, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentFormView } from "../AgentForm/AgentFormView";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

export function AgentManagerView({
  agents,
  loading,
  error,
  saving,
  formOpen,
  editingAgent,
  deleteOpen,
  deletingAgent,
  openCreate,
  openEdit,
  closeForm,
  saveAgent,
  openDelete,
  closeDelete,
  confirmDelete,
  onSelectAgent,
  availableProviders,
  availableClips,
}: AgentManagerState & AgentManagerActions & { onSelectAgent?: (agent: Agent) => void; availableProviders?: string[]; availableClips?: string[] }) {
  return (
    <div className="flex flex-col h-full bg-sidebar/30 border-r border-sidebar-border/40 overflow-hidden backdrop-blur-sm">
      {/* Header */}
      <div className="px-5 py-6 border-b border-sidebar-border/30 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase opacity-80">智能体库</h2>
          <Button
            size="icon"
            variant="ghost"
            onClick={openCreate}
            className="h-7 w-7 rounded-md hover:bg-primary/10 hover:text-primary transition-all duration-300"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors" />
          <input
            placeholder="搜索智能体..."
            className="w-full h-8 bg-muted/40 border border-transparent focus:border-border/30 rounded-md pl-9 pr-3 text-[12px] focus:ring-2 focus:ring-primary/10 outline-none transition-all placeholder:text-muted-foreground/30"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-3 space-y-1">
          {loading && (
            <div className="space-y-2 px-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 w-full bg-muted/20 animate-pulse rounded-md" />
              ))}
            </div>
          )}

          {error && (
            <div className="p-4 mx-2 bg-destructive/[0.03] border border-destructive/10 rounded-md">
              <p className="text-[11px] text-destructive/80 text-center font-medium leading-relaxed">{error}</p>
            </div>
          )}

          {!loading && agents.length === 0 && (
            <div className="p-10 text-center space-y-4">
              <p className="text-[12px] text-muted-foreground/40 italic">尚无可用智能体</p>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={openCreate} 
                className="text-[11px] h-7 px-4 border border-border/40 hover:bg-primary/5 hover:text-primary transition-all"
              >
                新建智能体
              </Button>
            </div>
          )}

          {agents.map((agent) => (
            <div
              key={agent.id}
              onClick={() => onSelectAgent?.(agent)}
              className="group relative flex flex-col px-3 py-3 rounded-md hover:bg-card hover:shadow-sm hover:ring-1 hover:ring-border/50 cursor-pointer transition-all duration-200"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center shrink-0 border border-primary/10">
                    <Bot className="w-4 h-4 text-primary/70" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] font-semibold tracking-[-0.01em] text-foreground/90 truncate leading-snug">
                      {agent.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50 font-mono tracking-tight uppercase">
                      {agent.llm_model?.split('/').pop() || "DEFAULT"}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all duration-200">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md hover:bg-primary/10 hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(agent);
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDelete(agent);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {agent.system_prompt && (
                <p className="mt-2 text-[11px] text-muted-foreground/40 line-clamp-1 italic pl-11 pr-2">
                  {agent.system_prompt}
                </p>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Footer Info */}
      <div className="p-5 border-t border-sidebar-border/30 bg-sidebar/[0.02]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/40 font-bold uppercase tracking-[0.15em]">
            {agents.length} AGENTS
          </span>
          <span className="text-[10px] text-primary/60 hover:text-primary font-bold cursor-pointer transition-colors tracking-tight uppercase">
            Configure &rsaquo;
          </span>
        </div>
      </div>

      <AgentFormView
        open={formOpen}
        onOpenChange={(open) => !open && closeForm()}
        agent={editingAgent}
        onSave={saveAgent}
        saving={saving}
        availableProviders={availableProviders}
        availableClips={availableClips}
      />

      <Dialog open={deleteOpen} onOpenChange={(open) => !open && closeDelete()}>
        <DialogContent className="sm:max-w-[360px] p-8 gap-6 border-border/40 bg-background/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold tracking-tight">确认删除</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground/70 leading-relaxed pt-2">
              确定要移除智能体 <span className="font-bold text-foreground">"{deletingAgent?.name}"</span> 吗？
              此操作将清除所有配置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="ghost" onClick={closeDelete} className="text-[11px] font-bold uppercase tracking-widest h-9">
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              className="text-[11px] font-bold uppercase tracking-widest h-9 px-6"
            >
              移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
