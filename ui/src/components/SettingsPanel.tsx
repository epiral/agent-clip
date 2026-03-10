import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Input } from "./ui/input";
import { getConfig, setConfig } from "../lib/agent";
import { useI18n } from "../lib/i18n";
import { ScrollArea } from "./ui/scroll-area";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { t, locale, setLocale } = useI18n();
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [config, setConfigState] = useState<Record<string, string>>({});
  const [providers, setProviders] = useState<string[]>([]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const cfgText = await getConfig();
      const lines = cfgText.split("\n");
      const parsed: Record<string, string> = {};
      for (const line of lines) {
        if (line.includes(": ") && !line.startsWith(" ")) {
          const idx = line.indexOf(": ");
          parsed[line.substring(0, idx)] = line.substring(idx + 2).trim();
        }
      }
      setConfigState(parsed);
      if (parsed.providers) {
        setProviders(parsed.providers.split(",").map(s => s.trim()).filter(Boolean));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadConfig();
    }
  }, [open]);

  const handleChange = async (key: string, value: string) => {
    setConfigState((prev) => ({ ...prev, [key]: value }));
    try {
      await setConfig(key, value);
    } catch (err: any) {
      setError(err.message);
      await loadConfig(); // rollback
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col glass-sidebar border-l border-border/40 animate-in-up">
        <SheetHeader className="border-b border-border/40 px-6 py-4 bg-bg-surface/50">
          <SheetTitle className="text-[11px] font-bold text-text-mute opacity-80 uppercase tracking-tight">
            {t("AGENT_CONFIGURATION")}
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 px-8 py-6">
          {error && <div className="text-destructive text-[11px] font-bold uppercase tracking-wider mb-6 bg-destructive/10 p-3 rounded-lg border border-destructive/20">{error}</div>}

          <div className="space-y-10 pb-12">
            {/* Language */}
            <section className="space-y-4">
              <h3 className="text-[10px] font-bold text-brand-primary/80 uppercase tracking-tight">{t("SYSTEM_LOCALE")}</h3>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-text-mute opacity-60 leading-none">{t("Language")}</label>
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as any)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-bg-surface px-3 py-2 text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary/40 appearance-none"
                >
                  <option value="en">English (US)</option>
                  <option value="zh-CN">简体中文 (CN)</option>
                </select>
              </div>
            </section>

            {/* Basic Info */}
            <section className="space-y-4">
              <h3 className="text-[10px] font-bold text-brand-primary/80 uppercase tracking-tight">{t("IDENTITY_PARAMETERS")}</h3>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-text-mute opacity-60 leading-none">{t("Agent Name")}</label>
                <Input
                  className="rounded-lg border-border bg-bg-surface px-3 h-10 text-[13px] font-medium focus:ring-2 focus:ring-brand-primary/10 transition-all"
                  value={config.name || ""}
                  onChange={(e) => setConfigState({ ...config, name: e.target.value })}
                  onBlur={(e) => handleChange("name", e.target.value)}
                />
              </div>
            </section>

            {/* Model Config */}
            <section className="space-y-4">
              <h3 className="text-[10px] font-bold text-brand-primary/80 uppercase tracking-tight">{t("CORE_INTELLIGENCE")}</h3>

              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-text-mute opacity-60 leading-none">{t("LLM Provider")}</label>
                <select
                  value={config.provider || ""}
                  onChange={(e) => handleChange("provider", e.target.value)}
                  className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-bg-surface px-3 py-2 text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-brand-primary/10 focus:border-brand-primary/40 appearance-none"
                >
                  <option value="">Select Provider</option>
                  {providers.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="space-y-3">
                <label className="text-[11px] font-bold uppercase tracking-widest text-text-mute opacity-60 leading-none">{t("LLM Model")}</label>
                <Input
                  className="rounded-xl border-border-subtle bg-bg-surface px-4 h-11 text-[13px] font-medium focus:ring-4 focus:ring-brand-primary/10 transition-all shadow-sm"
                  value={config.model || ""}
                  onChange={(e) => setConfigState({ ...config, model: e.target.value })}
                  onBlur={(e) => handleChange("model", e.target.value)}
                />
              </div>
            </section>

            {/* Connections */}
            <section className="space-y-5">
              <h3 className="text-[10px] font-black text-brand-primary uppercase tracking-[0.2em] opacity-80">{t("NETWORK_INTERFACE")}</h3>
              
              <div className="space-y-3">
                <label className="text-[11px] font-bold uppercase tracking-widest text-text-mute opacity-60 leading-none">{t("Browser Endpoint")}</label>
                <Input
                  className="rounded-xl border-border-subtle bg-bg-surface px-4 h-11 text-[13px] font-medium focus:ring-4 focus:ring-brand-primary/10 transition-all shadow-sm"
                  value={config.browser || ""}
                  onChange={(e) => setConfigState({ ...config, browser: e.target.value })}
                  onBlur={(e) => handleChange("browser", e.target.value)}
                />
              </div>
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
