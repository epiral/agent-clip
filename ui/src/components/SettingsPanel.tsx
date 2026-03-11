import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { getConfig, setConfig, deleteConfig, addClip, removeClip, type AgentConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { ScrollArea } from "./ui/scroll-area";
import { Trash2, Plus, Circle, Search } from "lucide-react";
import { motion } from "framer-motion";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [config, setConfigState] = useState<AgentConfig | null>(null);

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

  // Browser auto-detect
  const [browserDetecting, setBrowserDetecting] = useState(false);
  const [newClipCommands, setNewClipCommands] = useState("");

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
    try {
      await setConfig(key, value);
      await loadConfig();
    } catch (err: any) {
      setError(err.message);
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
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col bg-sidebar border-l border-border/40 font-sans">
        <SheetHeader className="border-b border-border/40 px-8 py-6 bg-background/50 backdrop-blur-xl">
          <SheetTitle className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.3em]">
            {t("Agent Configuration")}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 px-8 py-8">
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-destructive text-[11px] font-bold bg-destructive/5 p-4 rounded-xl border border-destructive/10 mb-8 uppercase tracking-wider text-center"
            >
              {error}
            </motion.div>
          )}

          <div className="space-y-10 pb-12">
            <Section title={t("Language")}>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as any)}
                className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-4 py-2 text-[14px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </Section>

            <Section title={t("Agent Name")}>
              <SettingInput
                value={config.name}
                onSave={(v) => handleSet("name", v)}
              />
            </Section>

            <Section title={t("LLM Provider")}>
              <select
                value={config.llm_provider}
                onChange={(e) => handleSet("llm_provider", e.target.value)}
                className="flex h-11 w-full rounded-xl border border-border/40 bg-card px-4 py-2 text-[14px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
              >
                <option value="">--</option>
                {providerNames.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Section>

            <Section title={t("LLM Model")}>
              <SettingInput
                value={config.llm_model}
                onSave={(v) => handleSet("llm_model", v)}
                mono
              />
            </Section>

            <Section title="Providers" action={
              <button onClick={() => setShowAddProvider(!showAddProvider)} className="text-primary hover:text-primary/80 transition-all active:scale-90 p-1">
                <Plus className="h-4 w-4" />
              </button>
            }>
              {showAddProvider && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-3 p-4 rounded-2xl bg-card border border-primary/20 mb-4 shadow-soft"
                >
                  <Input placeholder="name (e.g. deepseek)" value={newProviderName} onChange={e => setNewProviderName(e.target.value)} className="h-10 text-[13px] font-mono rounded-xl bg-background/50" />
                  <Input placeholder="https://api.example.com/v1" value={newProviderUrl} onChange={e => setNewProviderUrl(e.target.value)} className="h-10 text-[13px] font-mono rounded-xl bg-background/50" />
                  <select 
                    value={newProviderProtocol} 
                    onChange={e => setNewProviderProtocol(e.target.value)} 
                    className="flex h-10 w-full rounded-xl border border-border/40 bg-background/50 px-4 py-2 text-[13px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                  <Button size="sm" onClick={handleAddProvider} disabled={!newProviderName.trim() || !newProviderUrl.trim()} className="w-full h-10 text-[13px] font-bold rounded-xl shadow-glow">Add Provider</Button>
                </motion.div>
              )}

              <div className="space-y-3">
                {providerNames.map(name => (
                  <div key={name} className="p-4 rounded-2xl bg-card/50 border border-border/40 space-y-4 shadow-sm hover:shadow-soft transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-foreground tracking-tight">{name}</span>
                      <button onClick={() => handleDeleteProvider(name)} className="text-muted-foreground/40 hover:text-destructive transition-all active:scale-90">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="space-y-2.5">
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
                          className="flex h-8 w-full rounded-lg border border-border/40 bg-background/50 px-3 py-0 text-[11px] font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </select>
                      </FieldRow>
                    </div>
                  </div>
                ))}
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
                        <div key={clip.name} className="flex items-center justify-between text-[11px] p-2 bg-background/40 rounded-lg border border-border/20">
                          <span className="font-mono text-muted-foreground/80 truncate">{clip.name} — {clip.url}</span>
                          <button onClick={() => handleRemoveClip(clip.name)} className="text-muted-foreground/40 hover:text-destructive ml-2 shrink-0 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-3 text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
                      <p>{t("sandbox_step1")}</p>
                      <code className="block bg-muted/50 border border-border/20 rounded-lg px-3 py-2 font-mono text-[10px] select-all text-primary/80">pinix clip install sandbox.clip</code>
                      <p>{t("sandbox_step2")}</p>
                      <div className="space-y-2 pt-1">
                        <Input placeholder="http://host:9875" value={newClipUrl} onChange={e => setNewClipUrl(e.target.value)} className="h-9 text-[11px] font-mono rounded-lg bg-background/50" />
                        <Input placeholder="clip token" type="password" value={newClipToken} onChange={e => setNewClipToken(e.target.value)} className="h-9 text-[11px] font-mono rounded-lg bg-background/50" />
                        <Button size="sm" onClick={async () => {
                          if (!newClipUrl.trim() || !newClipToken.trim()) return;
                          try {
                            await addClip({ name: "sandbox", url: newClipUrl.trim(), token: newClipToken.trim(), commands: ["bash", "read", "write", "edit"] });
                            setNewClipUrl(""); setNewClipToken("");
                            await loadConfig();
                          } catch (err: any) { setError(err.message); }
                        }} disabled={!newClipUrl.trim() || !newClipToken.trim()} className="w-full h-8 text-[11px] font-bold rounded-lg shadow-glow">{t("Connect")}</Button>
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
                      <div className="flex items-center justify-between p-2 bg-background/40 rounded-lg border border-border/20">
                        <span className="font-mono text-[11px] text-muted-foreground/80">{config.browser.endpoint}</span>
                        <button onClick={() => { handleSet("browser.endpoint", ""); }} className="text-muted-foreground/40 hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 text-[11px] text-muted-foreground/70 leading-relaxed pt-1">
                      <p>{t("browser_step1")}</p>
                      <code className="block bg-muted/50 border border-border/20 rounded-lg px-3 py-2 font-mono text-[10px] select-all text-primary/80">npm install -g bb-browser</code>
                      <p>{t("browser_step2")}</p>
                      <code className="block bg-muted/50 border border-border/20 rounded-lg px-3 py-2 font-mono text-[10px] select-all break-all text-primary/60">github.com/yan5xu/bb-browser/releases</code>
                      <p>{t("browser_step3")}</p>
                      <code className="block bg-muted/50 border border-border/20 rounded-lg px-3 py-2 font-mono text-[10px] select-all text-primary/80">bb-browser daemon</code>
                      <div className="flex gap-2 pt-2">
                        <SettingInput value="" onSave={(v) => handleSet("browser.endpoint", v)} placeholder="http://localhost:19824" mono small />
                        <Button size="sm" variant="outline" onClick={handleBrowserDetect} disabled={browserDetecting} className="h-8 text-[10px] shrink-0 px-3 rounded-lg border-primary/20 hover:bg-primary/5 hover:text-primary active:scale-95 transition-all">
                          <Search className="h-3 w-3 mr-1.5" />
                          {browserDetecting ? t("Detecting...") : t("Auto-detect")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CapabilityCard>

                <div className="flex gap-6 text-[10px] text-muted-foreground font-bold tracking-[0.1em] uppercase pt-2 px-1">
                  <span className="flex items-center gap-2"><Circle className="h-1.5 w-1.5 fill-green-500 text-green-500 shadow-glow" />{t("Memory")}</span>
                  <span className="flex items-center gap-2"><Circle className="h-1.5 w-1.5 fill-green-500 text-green-500 shadow-glow" />{t("Events")}</span>
                </div>
              </div>
            </Section>

            <Section title={t("Clips")} action={
              <button onClick={() => setShowAddClip(!showAddClip)} className="text-primary hover:text-primary/80 transition-all active:scale-90 p-1">
                <Plus className="h-4 w-4" />
              </button>
            }>
              <div className="space-y-3">
                {showAddClip && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-3 p-4 rounded-2xl bg-card border border-primary/20 mb-4 shadow-soft"
                  >
                    <Input placeholder="name" value={newClipName} onChange={e => setNewClipName(e.target.value)} className="h-10 text-[13px] font-mono rounded-xl bg-background/50" />
                    <Input placeholder="http://host:port" value={newClipUrl} onChange={e => setNewClipUrl(e.target.value)} className="h-10 text-[13px] font-mono rounded-xl bg-background/50" />
                    <Input placeholder="token" type="password" value={newClipToken} onChange={e => setNewClipToken(e.target.value)} className="h-10 text-[13px] font-mono rounded-xl bg-background/50" />
                    <Input placeholder="commands (comma-sep)" value={newClipCommands} onChange={e => setNewClipCommands(e.target.value)} className="h-10 text-[13px] font-mono rounded-xl bg-background/50" />
                    <Button size="sm" onClick={handleAddClip} disabled={!newClipName.trim() || !newClipUrl.trim()} className="w-full h-10 text-[13px] font-bold rounded-xl shadow-glow">Add Clip</Button>
                  </motion.div>
                )}
                {config.clips.filter(c => !c.commands?.includes("bash")).length === 0 && !showAddClip && (
                  <div className="py-8 text-center border-2 border-dashed border-border/20 rounded-2xl">
                    <p className="text-[12px] text-muted-foreground/40 font-bold uppercase tracking-widest">{t("No extra clips")}</p>
                  </div>
                )}
                {config.clips.filter(c => !c.commands?.includes("bash")).map(clip => (
                  <div key={clip.name} className="p-4 rounded-2xl bg-card/50 border border-border/40 shadow-sm hover:shadow-soft transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-foreground tracking-tight">{clip.name}</span>
                      <button onClick={() => handleRemoveClip(clip.name)} className="text-muted-foreground/40 hover:text-destructive transition-all active:scale-90">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground/60 mt-1.5 font-mono truncate">{clip.url}</div>
                    {clip.commands?.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {clip.commands.map(cmd => (
                          <span key={cmd} className="px-2 py-0.5 rounded-md bg-primary/5 text-primary text-[10px] font-bold border border-primary/10">
                            {cmd}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <label className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.2em]">{title}</label>
        {action}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest w-16 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function CapabilityCard({ name, desc, commands, configured, t, children }: {
  name: string; desc: string; commands: string; configured: boolean;
  t: (key: string) => string; children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-2xl bg-card/50 border border-border/40 shadow-sm hover:shadow-soft transition-all">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <div className={`h-2.5 w-2.5 rounded-full shadow-glow ${configured ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-[14px] font-bold text-foreground tracking-tight">{name}</span>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${configured ? "text-green-600" : "text-muted-foreground/50"}`}>
          {configured ? t("Configured") : t("Not configured")}
        </span>
      </div>
      <p className="text-[12px] text-muted-foreground/80 mb-3 leading-relaxed">{desc}</p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {commands.split(", ").map(cmd => (
          <span key={cmd} className="px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground text-[10px] font-mono border border-border/20">
            {cmd}
          </span>
        ))}
      </div>
      {children}
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
      className={`rounded-xl border-border/40 bg-card transition-all font-semibold selection:bg-primary/20 focus-visible:ring-primary/20 ${mono ? "font-mono" : ""} ${small ? "h-8 text-[11px] px-3 bg-background/50" : "h-11 text-[14px] px-4"}`}
    />
  );
}
