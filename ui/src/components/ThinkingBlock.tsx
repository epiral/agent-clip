import { Streamdown } from "streamdown";
import { useI18n } from "../lib/i18n";

interface ThinkingBlockProps {
  content?: string;
  isStreaming: boolean;
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const { t } = useI18n();

  if (!content && !isStreaming) return null;

  return (
    <details className="mb-2 group" open={isStreaming}>
      <summary className="list-none cursor-pointer flex items-center gap-2 py-1.5 text-xs text-muted hover:text-ink transition-colors">
        <span className="text-[9px] transition-transform group-open:rotate-90 text-muted/60">▶</span>
        <span className="font-medium tracking-wide">{isStreaming ? t("RESONATING") : t("PROCESS_TRACED")}</span>
        {isStreaming && <span className="w-1.5 h-1.5 bg-active rounded-full animate-pulse" />}
      </summary>

      <div className="mt-2 ml-1.5 pl-4 border-l-2 border-border/60 text-muted leading-relaxed text-[13px]">
        {content ? (
          <Streamdown>{content}</Streamdown>
        ) : (
          <span className="opacity-40 text-xs">
            {t("Initializing resonance...")}
          </span>
        )}
      </div>
    </details>
  );
}
