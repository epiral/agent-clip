import type { TokenUsage } from "../lib/types";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface UsageBlockProps {
  usage: TokenUsage;
}

export function UsageBlock({ usage }: UsageBlockProps) {
  return (
    <details className="group">
      <summary className="list-none cursor-pointer flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
        <span className="text-[9px] transition-transform group-open:rotate-90">▶</span>
        <span className="font-mono">
          {formatTokens(usage.prompt_tokens)} &rarr; {formatTokens(usage.completion_tokens)}
        </span>
      </summary>

      <div className="mt-1 ml-1.5 pl-4 border-l-2 border-border/40 text-[11px] text-muted-foreground/70 font-mono space-y-0.5 pb-1">
        <div>prompt: {usage.prompt_tokens.toLocaleString()}</div>
        <div>completion: {usage.completion_tokens.toLocaleString()}</div>
        {usage.reasoning_tokens ? (
          <div>reasoning: {usage.reasoning_tokens.toLocaleString()}</div>
        ) : null}
        {usage.cached_tokens ? (
          <div>cached: {usage.cached_tokens.toLocaleString()}</div>
        ) : null}
        <div className="text-muted-foreground/50">total: {usage.total_tokens.toLocaleString()}</div>
      </div>
    </details>
  );
}
