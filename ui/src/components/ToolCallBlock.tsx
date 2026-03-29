import { useI18n } from "../lib/i18n";
import { Check, Loader2, Wrench } from "lucide-react";

interface ToolCallBlockProps {
  name: string;
  argumentsText: string;
  result?: string;
  isStreaming: boolean;
}

export function ToolCallBlock({ name, argumentsText, result, isStreaming }: ToolCallBlockProps) {
  const { t } = useI18n();
  const isDone = result !== undefined || (!isStreaming && result === undefined);

  return (
    <details className="mb-2 group rounded-md border border-border bg-surface overflow-hidden" open={!isDone}>
      <summary className="list-none cursor-pointer flex items-center gap-3 px-3.5 py-2.5 hover:bg-surface-hover transition-colors">
        <div className="flex shrink-0 items-center justify-center w-5 h-5 rounded-sm border border-border">
          {!isDone ? (
            <Loader2 className="h-3 w-3 animate-spin text-active" />
          ) : (
            <Check className="h-3 w-3 text-success" strokeWidth={3} />
          )}
        </div>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Wrench className="w-3 h-3 text-muted shrink-0" />
          <span className="font-mono text-[11px] font-semibold text-ink truncate">
            {name}
          </span>
        </div>
        <span className="text-[9px] text-muted/50 transition-transform group-open:rotate-90">▶</span>
      </summary>

      <div className="px-3.5 py-3 border-t border-border bg-paper space-y-3">
        <div className="space-y-1.5">
          <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{t("INPUT_PARAMETERS")}</span>
          <pre className="font-mono text-[11px] p-3 rounded-sm border border-border bg-surface overflow-x-auto whitespace-pre-wrap leading-relaxed">
            {argumentsText}
          </pre>
        </div>

        {result && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{t("EXECUTION_RESULT")}</span>
            <pre className="font-mono text-[11px] p-3 rounded-sm border border-border bg-surface overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
              {result}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}
