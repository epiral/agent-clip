import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { getConfig, setConfig, deleteConfig, addClip, removeClip, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { ScrollArea } from "./ui/scroll-area";
import { Trash2, Plus } from "lucide-react";
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

  // Add provider form
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderUrl, setNewProviderUrl] = useState("");
  const [newProviderProtocol, setNewProviderProtocol] = useState("openai");

  // Add clip form
  const [showAddClip, setShowAddClip] = useState(false);
  const [newClipName, setNewClipName] = useState("");

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

  const handleAddClip = async () => {
    if (!newClipName.trim()) return;
    try {
      await addClip(newClipName.trim());
      setShowAddClip(false);
      setNewClipName("");
      await loadConfig();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRemoveClip = async (name: string) => {
    try {
      await removeClip(name);
      await loadConfig();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!config) return null;

  const providerNames = Object.keys(config.providers);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col bg-paper border-l border-border">
        <SheetHeader className="px-6 py-8 border-b border-border bg-surface">
          <SheetTitle className="text-3xl font-serif">{t("Settings")}</SheetTitle>
          <SheetDescription className="signature-label text-muted mt-2">
            {t("Configure your agent's core parameters")}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-12 pb-24">
            {error && (
              <div className="p-4 border border-urgent/20 bg-urgent/5 text-urgent text-[11px] font-mono uppercase tracking-widest text-center">
                {error}
              </div>
            )}

            <Section title={t("Language")}>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as any)}
                className="flex h-10 w-full border border-border bg-surface px-3 py-2 text-sm transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </Section>

            <Section title={t("Identity")}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="signature-label text-muted font-mono">{t("Agent Name")}</label>
                  <SettingInput
                    value={config.name}
                    onSave={(v) => handleSet("name", v)}
                  />
                </div>
              </div>
            </Section>

            <Section title={t("Language Model")}>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="signature-label text-muted font-mono">{t("LLM Provider")}</label>
                  <select
                    value={config.llm_provider}
                    onChange={(e) => handleSet("llm_provider", e.target.value)}
                    className="flex h-10 w-full border border-border bg-surface px-3 py-2 text-sm transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
                  >
                    <option value="">--</option>
                    {providerNames.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="signature-label text-muted font-mono">{t("LLM Model")}</label>
                  <SettingInput
                    value={config.llm_model}
                    onSave={(v) => handleSet("llm_model", v)}
                    mono
                  />
                </div>
              </div>
            </Section>

            <Section title={t("Providers")} action={
              <button onClick={() => setShowAddProvider(!showAddProvider)} className="text-ink hover:opacity-70 transition-opacity">
                <Plus className="h-4 w-4" />
              </button>
            }>
              <div className="space-y-4">
                {showAddProvider && (
                  <div className="p-4 border border-border bg-surface space-y-4">
                    <Input placeholder="name (e.g. deepseek)" value={newProviderName} onChange={e => setNewProviderName(e.target.value)} className="h-9 font-mono text-xs" />
                    <Input placeholder="https://api.example.com/v1" value={newProviderUrl} onChange={e => setNewProviderUrl(e.target.value)} className="h-9 font-mono text-xs" />
                    <select
                      value={newProviderProtocol}
                      onChange={e => setNewProviderProtocol(e.target.value)}
                      className="flex h-9 w-full border border-border bg-paper px-3 text-xs transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                    <Button size="sm" onClick={handleAddProvider} disabled={!newProviderName.trim() || !newProviderUrl.trim()} className="w-full h-9">Add Provider</Button>
                  </div>
                )}

                <div className="space-y-3">
                  {providerNames.map(name => (
                    <div key={name} className="p-4 border border-border bg-surface space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-bold text-ink uppercase tracking-wider">{name}</span>
                        <button onClick={() => handleDeleteProvider(name)} className="text-muted hover:text-urgent transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <FieldRow label="URL">
                          <SettingInput value={config.providers[name].base_url} onSave={v => handleSet(`providers.${name}.base_url`, v)} mono small />
                        </FieldRow>
                        <FieldRow label="Key">
                          <SettingInput value={config.providers[name].api_key} onSave={v => handleSet(`providers.${name}.api_key`, v)} mono small password />
                        </FieldRow>
                        <FieldRow label="Protocol">
                          <select
                            value={config.providers[name].protocol || "openai"}
                            onChange={e => handleSet(`providers.${name}.protocol`, e.target.value)}
                            className="flex h-8 w-full border border-border bg-paper px-3 text-[11px] transition-colors focus:outline-none focus:border-ink appearance-none cursor-pointer"
                          >
                            <option value="openai">OpenAI</option>
                            <option value="anthropic">Anthropic</option>
                          </select>
                        </FieldRow>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section title={t("Clips")} action={
              <button onClick={() => setShowAddClip(!showAddClip)} className="text-ink hover:opacity-70 transition-opacity">
                <Plus className="h-4 w-4" />
              </button>
            }>
              <div className="space-y-4">
                {showAddClip && (
                  <div className="p-4 border border-border bg-surface space-y-4">
                    <Input
                      placeholder={t("Clip name (e.g. twitter)")}
                      value={newClipName}
                      onChange={e => setNewClipName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleAddClip(); }}
                      className="h-9 font-mono text-xs"
                    />
                    <Button size="sm" onClick={handleAddClip} disabled={!newClipName.trim()} className="w-full h-9">{t("Add Clip")}</Button>
                  </div>
                )}

                {config.clips.length === 0 && !showAddClip && (
                  <div className="py-12 text-center border border-dashed border-border">
                    <p className="signature-label text-muted/40">{t("No clips configured")}</p>
                  </div>
                )}

                <div className="space-y-2">
                  {config.clips.map(name => (
                    <div key={name} className="flex items-center justify-between p-3 border border-border bg-surface">
                      <span className="text-[12px] font-mono font-bold text-ink">{name}</span>
                      <button onClick={() => handleRemoveClip(name)} className="text-muted hover:text-urgent transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section title={t("System Prompt")}>
              <textarea
                defaultValue={config.system_prompt}
                onBlur={(e) => handleSet("system_prompt", e.target.value)}
                className="w-full min-h-[200px] border border-border bg-surface p-4 text-sm font-serif italic leading-relaxed focus:outline-none focus:border-ink resize-none"
                placeholder={t("Instructions for the agent...")}
              />
            </Section>

            <section className="pt-8 border-t border-border">
              <Button
                variant="destructive"
                className="w-full"
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

        <div className="p-6 border-t border-border bg-surface mt-auto">
          <Button
            className="w-full h-12"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {saving ? t("Saving...") : t("Done")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-serif font-bold uppercase tracking-[0.2em] text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="signature-label text-muted font-mono w-16 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SettingInput({
  value,
  onSave,
  placeholder,
  mono,
  small,
  password,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  small?: boolean;
  password?: boolean;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <Input
      type={password ? "password" : "text"}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onSave(local); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
      placeholder={placeholder}
      className={cn(
        "bg-surface focus-visible:border-ink",
        mono && "font-mono",
        small && "h-8 text-[11px] px-3 bg-paper"
      )}
    />
  );
}
