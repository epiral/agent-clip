import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { setConfig, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { Sparkles } from "lucide-react";

const PROVIDER_PRESETS: Record<string, { label: string; base_url: string; protocol: string; models: string[] }> = {
  openrouter: {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    protocol: "openai",
    models: [
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-3.5-haiku",
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "google/gemini-2.0-flash",
      "deepseek/deepseek-chat",
    ],
  },
  openai: {
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    protocol: "openai",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
  },
  anthropic: {
    label: "Anthropic",
    base_url: "https://api.anthropic.com",
    protocol: "anthropic",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  },
  dashscope: {
    label: "DashScope (Qwen)",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai",
    models: ["qwen-max", "qwen-plus", "qwen-turbo"],
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
    <div className="flex items-center justify-center min-h-[100dvh] bg-paper p-6 relative overflow-hidden">
      <div className="w-full max-w-lg space-y-12 relative z-10">
        <div className="text-center space-y-6">
          <div className="inline-flex items-center justify-center w-20 h-20 border border-ink text-ink mb-2">
            <Sparkles className="w-10 h-10" />
          </div>
          <h1 className="text-5xl font-serif font-bold tracking-tight text-ink">{t("Setup Agent")}</h1>
          <p className="signature-label text-muted">{t("Configure your AI provider to get started")}</p>
        </div>

        {error && (
          <div className="text-urgent text-[12px] font-mono border border-urgent/20 bg-urgent/5 p-4 uppercase tracking-widest text-center">
            {error}
          </div>
        )}

        <div className="border border-border p-8 space-y-10 bg-surface">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Identity */}
            <div className="space-y-3">
              <label className="signature-label text-muted font-mono">{t("Agent Name")}</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="pi"
                className="h-10 border border-border px-3 bg-paper focus-visible:border-ink"
              />
            </div>

            {/* Provider */}
            <div className="space-y-3">
              <label className="signature-label text-muted font-mono">{t("AI Provider")}</label>
              <div className="relative">
                <select
                  value={providerKey}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className="flex h-10 w-full border border-border bg-paper px-3 py-2 text-sm transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
                >
                  {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-10 pt-8 border-t border-border">
            {/* Custom URL + Protocol */}
            {isCustom && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="space-y-3">
                  <label className="signature-label text-muted font-mono">Base URL</label>
                  <Input
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="h-10 border border-border px-3 font-mono text-xs bg-paper focus-visible:border-ink"
                  />
                </div>
                <div className="space-y-3">
                  <label className="signature-label text-muted font-mono">Protocol</label>
                  <div className="relative">
                    <select
                      value={customProtocol}
                      onChange={(e) => setCustomProtocol(e.target.value)}
                      className="flex h-10 w-full border border-border bg-paper px-3 py-2 text-sm transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
                    >
                      <option value="openai">OpenAI Compatible</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* API Key */}
              <div className="space-y-3">
                <label className="signature-label text-muted font-mono">API Key</label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="h-10 border border-border px-3 font-mono text-xs bg-paper focus-visible:border-ink"
                />
              </div>

              {/* Model */}
              <div className="space-y-3">
                <label className="signature-label text-muted font-mono">{t("Model")}</label>
                {!isCustom && preset.models.length > 0 ? (
                  <div className="relative">
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="flex h-10 w-full border border-border bg-paper px-3 py-2 text-sm font-mono transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
                    >
                      {preset.models.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square"/>
                      </svg>
                    </div>
                  </div>
                ) : (
                  <Input
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    placeholder="model-name"
                    className="h-10 border border-border px-3 font-mono text-xs bg-paper focus-visible:border-ink"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Submit */}
          <Button
            className="w-full h-14 text-[14px] font-bold uppercase tracking-[0.2em]"
            disabled={!canSubmit || saving}
            onClick={handleSubmit}
          >
            {saving ? t("Saving...") : t("Start Session")}
          </Button>
        </div>

        <p className="text-center signature-label text-muted opacity-40">
          Powered by Gemini Resonance Engine
        </p>
      </div>
    </div>
  );
}
