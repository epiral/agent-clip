import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { setConfig, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

const PROVIDER_PRESETS: Record<string, { label: string; base_url: string; protocol: string; models: string[] }> = {
  openrouter: {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    protocol: "openai",
    models: [
      "anthropic/claude-opus-4-6",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-haiku-4-5-20251001",
      "openai/gpt-5.4",
      "openai/gpt-5.4-pro",
      "google/gemini-3-flash-preview",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-v3-0324",
      "minimax/minimax-m2.5",
    ],
  },
  openai: {
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    protocol: "openai",
    models: ["gpt-5.4", "gpt-5.4-pro", "gpt-5-mini", "o3", "o4-mini"],
  },
  anthropic: {
    label: "Anthropic",
    base_url: "https://api.anthropic.com",
    protocol: "anthropic",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  },
  dashscope: {
    label: "DashScope (Qwen)",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    models: ["qwen3-max", "qwen3-plus", "qwen3-flash", "qwen3-coder"],
  },
  minimax: {
    label: "MiniMax",
    base_url: "https://api.minimaxi.com/anthropic",
    protocol: "anthropic",
    models: ["MiniMax-M2.5", "MiniMax-M2.5-highspeed"],
  },
  deepseek: {
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    protocol: "openai",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  custom: {
    label: "Custom",
    base_url: "",
    protocol: "openai",
    models: [],
  },
};

interface SetupPageProps {
  config: AgentConfig;
  onComplete: () => void;
}

export function SetupPage({ config, onComplete }: SetupPageProps) {
  const { t } = useI18n();
  const [name, setName] = useState(config.name || "pi");
  const [providerKey, setProviderKey] = useState(config.llm_provider || "openrouter");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(config.llm_model || "");
  const [customUrl, setCustomUrl] = useState("");
  const [customProtocol, setCustomProtocol] = useState("openai");
  const [customModel, setCustomModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = PROVIDER_PRESETS[providerKey] || PROVIDER_PRESETS.custom;
  const isCustom = providerKey === "custom";
  const finalModel = isCustom ? customModel : model;

  const canSubmit = apiKey.trim() && finalModel.trim() && (!isCustom || customUrl.trim());

  const handleProviderChange = (key: string) => {
    setProviderKey(key);
    setModel("");
    setCustomModel("");
    setError(null);
    const p = PROVIDER_PRESETS[key];
    if (p?.models.length) setModel(p.models[0]);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    try {
      const pName = isCustom ? "custom" : providerKey;
      const baseUrl = isCustom ? customUrl : preset.base_url;
      const protocol = isCustom ? customProtocol : preset.protocol;

      await setConfig(`providers.${pName}.base_url`, baseUrl);
      await setConfig(`providers.${pName}.api_key`, apiKey);
      await setConfig(`providers.${pName}.protocol`, protocol);
      await setConfig("llm_provider", pName);
      await setConfig("llm_model", finalModel);
      if (name.trim() && name !== config.name) {
        await setConfig("name", name.trim());
      }
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[100dvh] bg-background p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] -right-[5%] w-[30%] h-[30%] bg-primary/3 rounded-full blur-[100px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
        className="w-full max-w-lg space-y-10 relative z-10"
      >
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-[2rem] bg-primary/10 text-primary mb-2 ring-1 ring-primary/20 shadow-glow">
            <Sparkles className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">{t("Setup Agent")}</h1>
          <p className="text-muted-foreground/60 font-medium">{t("Configure your AI provider to get started")}</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="text-destructive text-sm bg-destructive/5 p-4 rounded-2xl border border-destructive/10 font-bold uppercase tracking-wider text-center"
          >
            {error}
          </motion.div>
        )}

        <div className="bento-surface p-8 space-y-8 bg-card/50 backdrop-blur-xl border-border/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Identity */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">{t("Agent Name")}</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="pi"
                className="h-12 rounded-xl bg-background/50 border-border/40 text-[15px] font-semibold focus-visible:ring-primary/20"
              />
            </div>

            {/* Provider */}
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">{t("AI Provider")}</label>
              <select
                value={providerKey}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="flex h-12 w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2 text-[15px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
              >
                {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-8 pt-4 border-t border-border/20">
            {/* Custom URL + Protocol */}
            {isCustom && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="grid grid-cols-1 md:grid-cols-2 gap-8"
              >
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Base URL</label>
                  <Input
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="h-12 rounded-xl bg-background/50 border-border/40 text-[13px] font-mono focus-visible:ring-primary/20"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Protocol</label>
                  <select
                    value={customProtocol}
                    onChange={(e) => setCustomProtocol(e.target.value)}
                    className="flex h-12 w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2 text-[15px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
                  >
                    <option value="openai">OpenAI Compatible</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
              </motion.div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* API Key */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">API Key</label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="h-12 rounded-xl bg-background/50 border-border/40 text-[13px] font-mono focus-visible:ring-primary/20"
                />
              </div>

              {/* Model */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">{t("Model")}</label>
                {!isCustom && preset.models.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="flex h-12 w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2 text-[13px] font-mono transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
                  >
                    {preset.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="model-name"
                    className="h-12 rounded-xl bg-background/50 border-border/40 text-[13px] font-mono focus-visible:ring-primary/20"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Submit */}
          <Button
            className="w-full h-14 rounded-2xl text-[15px] font-bold shadow-glow hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50"
            disabled={!canSubmit || saving}
            onClick={handleSubmit}
          >
            {saving ? t("Saving...") : t("Start Session")}
          </Button>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/30 font-bold uppercase tracking-[0.3em]">
          Powered by Gemini Resonance Engine
        </p>
      </motion.div>
    </div>
  );
}
