import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { getConfig, setConfig, deleteConfig, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { ScrollArea } from "./ui/scroll-area";
import { Trash2, Plus, Globe, Package } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [config, setConfigState] = useState<AgentConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderUrl, setNewProviderUrl] = useState("");
  const [newProviderProtocol, setNewProviderProtocol] = useState("openai");

  const loadConfig = async () => {
    setError(null);
    try {
      const cfg = await getConfig();
      setConfigState(cfg);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (open) loadConfig();
  }, [open]);

  const handleSet = async (key: string, value: string) => {
    setSaving(true);
    try {
      await setConfig(key, value);
      await loadConfig();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = async (name: string) => {
    try {
      await deleteConfig(`providers.${name}`);
      if (config?.llm_provider === name) {
        await setConfig("llm_provider", "");
      }
      await loadConfig();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddProvider = async () => {
    if (!newProviderName.trim() || !newProviderUrl.trim()) return;
    try {
      await setConfig(`providers.${newProviderName}.base_url`, newProviderUrl);
      await setConfig(`providers.${newProviderName}.protocol`, newProviderProtocol);
      await setConfig(`providers.${newProviderName}.api_key`, "");
      setShowAddProvider(false);
      setNewProviderName("");
      setNewProviderUrl("");
      setNewProviderProtocol("openai");
      await loadConfig();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!config) return null;

  const providerNames = Object.keys(config.providers);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col bg-background border-l border-border">
        <SheetHeader className="px-4 py-5 border-b border-border">
          <SheetTitle className="text-lg font-medium text-foreground tracking-normal normal-case">
            {t("Settings")}
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground mt-0.5 normal-case tracking-normal font-normal">
            {t("Configure your agent's core parameters")}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6 pb-24">
            {error && (
              <div className="p-3 rounded-md border border-destructive/20 bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            {/* Language */}
            <Section title={t("Language")}>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as any)}
                className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 appearance-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </Section>

            {/* Global Defaults */}
            <Section title={t("Global Defaults")}>
              <p className="text-[11px] text-muted-foreground -mt-1 mb-3">
                Agent 未指定时使用这些默认值
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">{t("Agent Name")}</label>
                  <SettingInput value={config.name} onSave={(v) => handleSet("name", v)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">{t("LLM Provider")}</label>
                  <select
                    value={config.llm_provider}
                    onChange={(e) => handleSet("llm_provider", e.target.value)}
                    className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 appearance-none cursor-pointer"
                  >
                    <option value="">--</option>
                    {providerNames.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">{t("LLM Model")}</label>
                  <SettingInput value={config.llm_model} onSave={(v) => handleSet("llm_model", v)} mono />
                </div>
                <div className="space-y-2">
                  <label className="text-sm text-muted-foreground">{t("System Prompt")}</label>
                  <textarea
                    defaultValue={config.system_prompt}
                    onBlur={(e) => handleSet("system_prompt", e.target.value)}
                    className="w-full min-h-[160px] rounded-md border border-border bg-background p-3 text-sm font-mono leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 resize-y"
                    placeholder={t("Instructions for the agent...")}
                  />
                </div>
              </div>
            </Section>

            {/* Providers */}
            <Section title={t("Providers")} action={
              <button
                onClick={() => setShowAddProvider(!showAddProvider)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            }>
              <div className="space-y-3">
                {showAddProvider && (
                  <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">Name</label>
                      <Input placeholder="e.g. deepseek" value={newProviderName} onChange={e => setNewProviderName(e.target.value)} className="h-9 font-mono text-xs bg-background" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">Base URL</label>
                      <Input placeholder="https://api.example.com/v1" value={newProviderUrl} onChange={e => setNewProviderUrl(e.target.value)} className="h-9 font-mono text-xs bg-background" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm text-muted-foreground">Protocol</label>
                      <select value={newProviderProtocol} onChange={e => setNewProviderProtocol(e.target.value)} className="flex h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground appearance-none cursor-pointer">
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </div>
                    <Button size="sm" onClick={handleAddProvider} disabled={!newProviderName.trim() || !newProviderUrl.trim()} className="w-full h-9 mt-1">
                      Add Provider
                    </Button>
                  </div>
                )}
                {providerNames.map(name => (
                  <div key={name} className="rounded-lg border border-border bg-card overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
                      <span className="text-sm font-medium text-foreground">{name}</span>
                      <button onClick={() => handleDeleteProvider(name)} className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">URL</label>
                        <SettingInput value={config.providers[name].base_url} onSave={v => handleSet(`providers.${name}.base_url`, v)} mono small />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">API Key</label>
                        <SettingInput value={config.providers[name].api_key} onSave={v => handleSet(`providers.${name}.api_key`, v)} mono small password />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Protocol</label>
                        <select value={config.providers[name].protocol || "openai"} onChange={e => handleSet(`providers.${name}.protocol`, e.target.value)} className="flex h-8 w-full rounded-md border border-border bg-background px-3 text-xs text-foreground appearance-none cursor-pointer">
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* Hubs */}
            <Section title={t("Hubs")}>
              <div className="space-y-2">
                {!config.hubs || config.hubs.length === 0 ? (
                  <div className="py-8 text-center rounded-md border border-dashed border-border">
                    <p className="text-sm text-muted-foreground">{t("No hubs connected")}</p>
                  </div>
                ) : (
                  config.hubs.map((hub, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-md border border-border bg-card">
                      <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground">{hub.name}</span>
                        <span className="block text-xs font-mono text-muted-foreground truncate">{hub.url}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Section>

            {/* Packages */}
            <Section title={t("Installed Packages")}>
              <div className="space-y-2">
                {!config.installed || Object.keys(config.installed).length === 0 ? (
                  <div className="py-8 text-center rounded-md border border-dashed border-border">
                    <p className="text-sm text-muted-foreground">{t("No packages installed")}</p>
                  </div>
                ) : (
                  Object.entries(config.installed).map(([alias, info]) => (
                    <div key={alias} className="flex items-center gap-3 p-3 rounded-md border border-border bg-card">
                      <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium font-mono text-foreground">{alias}</span>
                        <span className="block text-xs text-muted-foreground truncate">{info.hub}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Section>

            {/* Danger Zone */}
            <section className="pt-6 border-t border-border">
              <Button
                variant="outline"
                className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                onClick={async () => {
                  if (confirm(t("Are you sure? This will reset all settings."))) {
                    try {
                      await deleteConfig("");
                      window.location.reload();
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }
                }}
              >
                {t("Reset All Configuration")}
              </Button>
            </section>
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-border bg-card mt-auto">
          <Button className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => onOpenChange(false)} disabled={saving}>
            {saving ? t("Saving...") : t("Done")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function SettingInput({ value, onSave, placeholder, mono, small, password }: {
  value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean; small?: boolean; password?: boolean;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <Input
      type={password ? "password" : "text"}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onSave(local); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      placeholder={placeholder}
      className={cn("bg-background", mono && "font-mono", small && "h-8 text-xs px-3")}
    />
  );
}
