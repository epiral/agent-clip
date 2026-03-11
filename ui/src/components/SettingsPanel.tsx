import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { getConfig, setConfig, deleteConfig, addClip, removeClip, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { ScrollArea } from "./ui/scroll-area";
import { Trash2, Plus, Circle, Search, ChevronRight } from "lucide-react";
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
  const [newClipUrl, setNewClipUrl] = useState("");
  const [newClipToken, setNewClipToken] = useState("");
  const [newClipCommands, setNewClipCommands] = useState("");

  // Browser auto-detect
  const [browserDetecting, setBrowserDetecting] = useState(false);

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
    if (!newClipName.trim() || !newClipUrl.trim()) return;
    try {
      await addClip({
        name: newClipName,
        url: newClipUrl,
        token: newClipToken,
        commands: newClipCommands.split(",").map(s => s.trim()).filter(Boolean),
      });
      setShowAddClip(false);
      setNewClipName("");
      setNewClipUrl("");
      setNewClipToken("");
      setNewClipCommands("");
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

  const handleBrowserDetect = async () => {
    setBrowserDetecting(true);
    try {
      for (const port of [19824, 19825]) {
        try {
          const resp = await fetch(`http://localhost:${port}/`, { method: "GET", signal: AbortSignal.timeout(2000) });
          if (resp.ok || resp.status === 404) {
            await setConfig("browser.endpoint", `http://localhost:${port}`);
            await loadConfig();
            return;
          }
        } catch { /* try next */ }
      }
      setError(t("Browser daemon not detected. Make sure bb-browser daemon is running."));
    } finally {
      setBrowserDetecting(false);
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

            <Section title={t("CAPABILITIES")}>
              <div className="space-y-4">
                <CapabilityCard
                  name={t("Sandbox")}
                  desc={t("sandbox_desc")}
                  commands="bash, read, write, edit"
                  configured={config.clips.some(c => c.commands?.includes("bash"))}
                  t={t}
                >
                  {config.clips.some(c => c.commands?.includes("bash")) ? (
                    <div className="space-y-2 pt-1">
                      {config.clips.filter(c => c.commands?.includes("bash")).map(clip => (
                        <div key={clip.name} className="flex items-center justify-between text-[11px] p-2 bg-paper border border-border">
                          <span className="font-mono text-muted truncate">{clip.name} — {clip.url}</span>
                          <button onClick={() => handleRemoveClip(clip.name)} className="text-muted hover:text-urgent ml-2 shrink-0 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3 text-[11px] text-muted leading-relaxed pt-1">
                      <p>{t("sandbox_step1")}</p>
                      <code className="block bg-paper border border-border px-3 py-2 font-mono text-[10px] select-all text-ink">pinix clip install sandbox.clip</code>
                      <p>{t("sandbox_step2")}</p>
                      <div className="space-y-2 pt-1">
                        <Input placeholder="http://host:9875" value={newClipUrl} onChange={e => setNewClipUrl(e.target.value)} className="h-8 text-[11px] font-mono" />
                        <Input placeholder="clip token" type="password" value={newClipToken} onChange={e => setNewClipToken(e.target.value)} className="h-8 text-[11px] font-mono" />
                        <Button size="sm" onClick={async () => {
                          if (!newClipUrl.trim() || !newClipToken.trim()) return;
                          try {
                            await addClip({ name: "sandbox", url: newClipUrl.trim(), token: newClipToken.trim(), commands: ["bash", "read", "write", "edit"] });
                            setNewClipUrl(""); setNewClipToken("");
                            await loadConfig();
                          } catch (err: any) { setError(err.message); }
                        }} disabled={!newClipUrl.trim() || !newClipToken.trim()} className="w-full h-8 text-[11px]">
                          {t("Connect")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CapabilityCard>

                <CapabilityCard
                  name={t("Browser")}
                  desc={t("browser_desc")}
                  commands="snapshot, click, fill, eval"
                  configured={!!config.browser?.endpoint}
                  t={t}
                >
                  {config.browser?.endpoint ? (
                    <div className="pt-1">
                      <div className="flex items-center justify-between p-2 bg-paper border border-border">
                        <span className="font-mono text-[11px] text-muted">{config.browser.endpoint}</span>
                        <button onClick={() => { handleSet("browser.endpoint", ""); }} className="text-muted hover:text-urgent transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-[11px] text-muted leading-relaxed pt-1">
                      <p>{t("browser_step1")}</p>
                      <code className="block bg-paper border border-border px-3 py-2 font-mono text-[10px] select-all text-ink">npm install -g bb-browser</code>
                      <p>{t("browser_step2")}</p>
                      <code className="block bg-paper border border-border px-3 py-2 font-mono text-[10px] select-all break-all text-ink">github.com/yan5xu/bb-browser/releases</code>
                      <p>{t("browser_step3")}</p>
                      <code className="block bg-paper border border-border px-3 py-2 font-mono text-[10px] select-all text-ink">bb-browser daemon</code>
                      <div className="flex gap-2 pt-2">
                        <SettingInput value="" onSave={(v) => handleSet("browser.endpoint", v)} placeholder="http://localhost:19824" mono small />
                        <Button variant="outline" size="sm" onClick={handleBrowserDetect} disabled={browserDetecting} className="h-8 text-[10px] shrink-0 px-3">
                          <Search className="h-3 w-3 mr-1.5" />
                          {browserDetecting ? t("Detecting...") : t("Auto-detect")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CapabilityCard>

                <div className="flex gap-6 signature-label text-muted pt-2 px-1">
                  <span className="flex items-center gap-2"><Circle className="h-1.5 w-1.5 fill-success text-success" />{t("Memory")}</span>
                  <span className="flex items-center gap-2"><Circle className="h-1.5 w-1.5 fill-success text-success" />{t("Events")}</span>
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

            <Section title={t("Clips")} action={
              <button onClick={() => setShowAddClip(!showAddClip)} className="text-ink hover:opacity-70 transition-opacity">
                <Plus className="h-4 w-4" />
              </button>
            }>
              <div className="space-y-4">
                {showAddClip && (
                  <div className="p-4 border border-border bg-surface space-y-4">
                    <Input placeholder="name" value={newClipName} onChange={e => setNewClipName(e.target.value)} className="h-9 font-mono text-xs" />
                    <Input placeholder="http://host:port" value={newClipUrl} onChange={e => setNewClipUrl(e.target.value)} className="h-9 font-mono text-xs" />
                    <Input placeholder="token" type="password" value={newClipToken} onChange={e => setNewClipToken(e.target.value)} className="h-9 font-mono text-xs" />
                    <Input placeholder="commands (comma-sep)" value={newClipCommands} onChange={e => setNewClipCommands(e.target.value)} className="h-9 font-mono text-xs" />
                    <Button size="sm" onClick={handleAddClip} disabled={!newClipName.trim() || !newClipUrl.trim()} className="w-full h-9">Add Clip</Button>
                  </div>
                )}
                
                {config.clips.filter(c => !c.commands?.includes("bash")).length === 0 && !showAddClip && (
                  <div className="py-12 text-center border border-dashed border-border">
                    <p className="signature-label text-muted/40">{t("No extra clips")}</p>
                  </div>
                )}
                
                <div className="space-y-3">
                  {config.clips.filter(c => !c.commands?.includes("bash")).map(clip => (
                    <div key={clip.name} className="p-4 border border-border bg-surface space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-bold text-ink uppercase tracking-wider">{clip.name}</span>
                        <button onClick={() => handleRemoveClip(clip.name)} className="text-muted hover:text-urgent transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="text-[10px] font-mono text-muted truncate">{clip.url}</div>
                      {clip.commands?.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {clip.commands.map(cmd => (
                            <span key={cmd} className="px-2 py-0.5 border border-border bg-paper text-ink text-[9px] font-mono uppercase tracking-tighter">
                              {cmd}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <section className="pt-8 border-t border-border">
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={async () => {
                  if (confirm(t("Are you sure? This will reset all settings."))) {
                    try {
                      await deleteConfig(""); // Clear all
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

function CapabilityCard({ name, desc, commands, configured, t, children }: {
  name: string; desc: string; commands: string; configured: boolean;
  t: (key: string) => string; children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border bg-surface overflow-hidden">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-paper transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className={cn("h-1.5 w-1.5 rounded-full", configured ? "bg-success" : "bg-urgent")} />
          <span className="text-xs font-bold text-ink uppercase tracking-wider">{name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("text-[9px] font-bold uppercase tracking-widest", configured ? "text-success" : "text-muted/50")}>
            {configured ? t("Active") : t("Pending")}
          </span>
          <ChevronRight className={cn("h-3 w-3 text-muted transition-transform", expanded && "rotate-90")} />
        </div>
      </div>
      
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          <p className="text-[11px] text-muted italic leading-relaxed">{desc}</p>
          <div className="flex flex-wrap gap-2">
            {commands.split(", ").map(cmd => (
              <span key={cmd} className="px-2 py-0.5 border border-border bg-paper text-muted text-[9px] font-mono">
                {cmd}
              </span>
            ))}
          </div>
          {children}
        </div>
      )}
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
