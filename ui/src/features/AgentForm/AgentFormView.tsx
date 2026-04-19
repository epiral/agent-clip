import { useState, useEffect } from "react";
import type { AgentFormProps } from "./types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MODEL_PRESETS = {
  openrouter: [
    "anthropic/claude-3.7-sonnet",
    "anthropic/claude-3.5-haiku",
    "openai/gpt-4o",
    "google/gemini-2.0-flash-001",
  ],
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-3-7-sonnet-20250219", "claude-3-5-haiku-20241022"],
};

const ALL_MODELS = Array.from(new Set(Object.values(MODEL_PRESETS).flat()));

export function AgentFormView({
  open,
  onOpenChange,
  agent,
  onSave,
  saving,
  availableProviders = [],
  availableClips = [],
}: AgentFormProps) {
  const [scope, setScope] = useState<string[]>(agent?.scope || []);
  const [pinned, setPinned] = useState<string[]>(agent?.pinned || []);
  const [provider, setProvider] = useState<string>(agent?.llm_provider || "");

  // Sync state when agent changes or dialog opens
  useEffect(() => {
    if (open) {
      setScope(agent?.scope || []);
      setPinned(agent?.pinned || []);
      setProvider(agent?.llm_provider || "");
    }
  }, [open, agent]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    onSave({
      name: formData.get("name") as string,
      llm_provider: provider || undefined,
      llm_model: (formData.get("llm_model") as string) || undefined,
      max_tokens: formData.get("max_tokens") ? parseInt(formData.get("max_tokens") as string) : undefined,
      system_prompt: (formData.get("system_prompt") as string) || undefined,
      scope: scope,
      pinned: pinned,
    });
  };

  const toggleScope = (clip: string) => {
    setScope(prev => {
      const next = prev.includes(clip) ? prev.filter(s => s !== clip) : [...prev, clip];
      // If removed from scope, also remove from pinned
      if (prev.includes(clip) && !next.includes(clip)) {
        setPinned(p => p.filter(s => s !== clip));
      }
      return next;
    });
  };

  const togglePinned = (clip: string) => {
    setPinned(prev => prev.includes(clip) ? prev.filter(s => s !== clip) : [...prev, clip]);
  };

  const labelStyle = "text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 mb-1.5 block";
  const inputStyle = "bg-muted/[0.03] border-border/40 focus:border-primary/30 focus:ring-1 focus:ring-primary/10 transition-all placeholder:text-muted-foreground/20 text-[13px] h-9 w-full";
  const hintStyle = "text-[11px] text-muted-foreground/40 mt-1.5 leading-relaxed";

  const effectivePinnedOptions = scope.length > 0 ? scope : availableClips;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] gap-0 p-0 border-border/40 bg-background/95 backdrop-blur-2xl shadow-2xl overflow-hidden">
        <form onSubmit={handleSubmit}>
          <div className="p-8 space-y-8 max-h-[85vh] overflow-y-auto no-scrollbar">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-xl font-semibold tracking-[-0.02em]">
                {agent ? "编辑智能体" : "创建新智能体"}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground/60 leading-relaxed">
                配置智能体的核心身份、模型参数和工具访问权限。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-7">
              {/* Name */}
              <div className="grid gap-1">
                <Label htmlFor="name" className={labelStyle}>智能体名称</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={agent?.name}
                  required
                  placeholder="例如: 编程专家"
                  className={inputStyle}
                />
                <p className={hintStyle}>为你的智能体起一个好记的名字。</p>
              </div>

              {/* Provider & Model */}
              <div className="grid grid-cols-2 gap-6">
                <div className="grid gap-1">
                  <Label htmlFor="llm_provider" className={labelStyle}>Provider</Label>
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger className={cn(inputStyle, "w-full justify-start gap-2")}>
                      <SelectValue placeholder="使用全局默认" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">
                        <div className="flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 opacity-50" />
                          <span>使用全局默认</span>
                        </div>
                      </SelectItem>
                      {availableProviders.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className={hintStyle}>指定使用的 AI 供应商。</p>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="llm_model" className={labelStyle}>Model</Label>
                  <Input
                    id="llm_model"
                    name="llm_model"
                    list="model-suggestions"
                    defaultValue={agent?.llm_model || ""}
                    placeholder="gpt-4o / claude-3-5"
                    className={cn(inputStyle, "font-mono")}
                  />
                  <datalist id="model-suggestions">
                    {(MODEL_PRESETS[provider as keyof typeof MODEL_PRESETS] || ALL_MODELS).map(m => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <p className={hintStyle}>选择具体的 LLM 模型 ID。</p>
                </div>
              </div>

              {/* System Prompt */}
              <div className="grid gap-1">
                <Label htmlFor="system_prompt" className={labelStyle}>System Prompt</Label>
                <Textarea
                  id="system_prompt"
                  name="system_prompt"
                  defaultValue={agent?.system_prompt || ""}
                  placeholder="定义智能体的角色、语气和规则..."
                  className="min-h-[140px] bg-muted/[0.03] border-border/40 focus:border-primary/30 focus:ring-1 focus:ring-primary/10 transition-all resize-none leading-relaxed text-[13px] p-4"
                />
                <p className={hintStyle}>核心指令，决定了智能体的行为模式。</p>
              </div>

              {/* Scope */}
              <div className="grid gap-1">
                <Label className={labelStyle}>Scope (工具权限)</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-border/40 bg-muted/5 min-h-[44px]">
                  {availableClips.length > 0 ? (
                    availableClips.map(clip => (
                      <Badge
                        key={clip}
                        variant={scope.includes(clip) ? "default" : "secondary"}
                        className={cn(
                          "cursor-pointer transition-all px-2.5 py-1 text-[11px] font-medium border",
                          scope.includes(clip) 
                            ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" 
                            : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
                        )}
                        onClick={() => toggleScope(clip)}
                      >
                        {scope.includes(clip) && <Check className="w-3 h-3 mr-1" />}
                        {clip}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground/30 italic">无可用工具</span>
                  )}
                </div>
                <p className={hintStyle}>
                  {scope.length === 0 ? "未限制 Scope，智能体可以使用全部可用工具。" : `已限制在 ${scope.length} 个工具范围内。`}
                </p>
              </div>

              {/* Pinned */}
              <div className="grid gap-1">
                <Label className={labelStyle}>Pinned (优先工具)</Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-border/40 bg-muted/5 min-h-[44px]">
                  {effectivePinnedOptions.length > 0 ? (
                    effectivePinnedOptions.map(clip => (
                      <Badge
                        key={clip}
                        variant={pinned.includes(clip) ? "default" : "secondary"}
                        className={cn(
                          "cursor-pointer transition-all px-2.5 py-1 text-[11px] font-medium border",
                          pinned.includes(clip) 
                            ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" 
                            : "bg-transparent text-muted-foreground/60 border-transparent hover:bg-muted/50"
                        )}
                        onClick={() => togglePinned(clip)}
                      >
                        {pinned.includes(clip) && <Check className="w-3 h-3 mr-1" />}
                        {clip}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground/30 italic">
                      {scope.length > 0 ? "请先在 Scope 中选择工具" : "无可用工具"}
                    </span>
                  )}
                </div>
                <p className={hintStyle}>固定在快捷栏的工具，提高常用功能的触发优先级。</p>
              </div>

              {/* Max Tokens */}
              <div className="grid gap-1">
                <Label htmlFor="max_tokens" className={labelStyle}>Max Tokens</Label>
                <Input
                  id="max_tokens"
                  name="max_tokens"
                  type="number"
                  defaultValue={agent?.max_tokens || ""}
                  placeholder="4096"
                  className={cn(inputStyle, "w-32")}
                />
                <p className={hintStyle}>单次响应的最大 Token 数。留空则使用默认值。</p>
              </div>
            </div>
          </div>

          <DialogFooter className="px-8 py-5 border-t border-border/30 bg-muted/[0.02] gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-[11px] font-bold uppercase tracking-widest h-9"
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-widest h-9 px-8 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all"
            >
              {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              {agent ? "保存更改" : "创建智能体"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
