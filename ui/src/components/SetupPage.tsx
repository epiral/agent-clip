import { useState } from "react";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { setConfig, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";

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
    <div className="flex items-center justify-center min-h-[100dvh] bg-bg-base p-4">
      <div className="w-full max-w-md space-y-8 animate-in-up">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-text-main">{t("Setup Agent")}</h1>
          <p className="text-sm text-text-mute">{t("Configure your AI provider to get started")}</p>
        </div>

        {error && (
          <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-lg border border-destructive/20">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-mute uppercase tracking-wider">{t("Agent Name")}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pi"
              className="h-11 rounded-lg bg-bg-surface border-border text-sm"
            />
          </div>

          {/* Provider */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-mute uppercase tracking-wider">{t("AI Provider")}</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  onClick={() => handleProviderChange(key)}
                  className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                    providerKey === key
                      ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                      : "border-border bg-bg-surface text-text-mute hover:border-border-subtle hover:text-text-main"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Custom URL + Protocol */}
          {isCustom && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-mute uppercase tracking-wider">Base URL</label>
                <Input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="h-11 rounded-lg bg-bg-surface border-border text-sm font-mono"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-text-mute uppercase tracking-wider">Protocol</label>
                <select
                  value={customProtocol}
                  onChange={(e) => setCustomProtocol(e.target.value)}
                  className="flex h-11 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/20 appearance-none"
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
            </>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-mute uppercase tracking-wider">API Key</label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="h-11 rounded-lg bg-bg-surface border-border text-sm font-mono"
            />
          </div>

          {/* Model */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-mute uppercase tracking-wider">{t("Model")}</label>
            {!isCustom && preset.models.length > 0 ? (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex h-11 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/20 appearance-none"
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
                className="h-11 rounded-lg bg-bg-surface border-border text-sm font-mono"
              />
            )}
          </div>
        </div>

        {/* Submit */}
        <Button
          className="w-full h-12 rounded-lg text-sm font-semibold"
          disabled={!canSubmit || saving}
          onClick={handleSubmit}
        >
          {saving ? t("Saving...") : t("Start")}
        </Button>
      </div>
    </div>
  );
}
