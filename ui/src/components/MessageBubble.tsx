import type { ChatMessage, MessageBlock } from "../lib/types";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { harden } from "rehype-harden";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import "katex/dist/katex.min.css";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { useI18n } from "../lib/i18n";

const sanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), "pinix-data", "pinix-web"],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [...((defaultSchema.attributes?.code as string[]) || []), "metastring"],
  },
};

const math = createMathPlugin({ singleDollarTextMath: true });

const customRehypePlugins: any[] = [
  defaultRehypePlugins.raw,
  [rehypeSanitize, sanitizeSchema],
  [harden, {
    allowedImagePrefixes: ["*"],
    allowedLinkPrefixes: ["*"],
    allowedProtocols: ["*"],
    defaultOrigin: undefined,
    allowDataImages: true,
  }],
];

interface MessageBubbleProps {
  message: ChatMessage;
  agentName?: string;
}

export function MessageBubble({ message, agentName }: MessageBubbleProps) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming";

  return (
    <div className={`w-full ${isUser ? 'bg-accent/40' : 'bg-background'}`}>
      <div className="max-w-3xl mx-auto py-4 px-4 md:px-8">
        <div className="flex gap-3">
          {/* Avatar */}
          <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5 ${
            isUser
              ? 'bg-foreground text-background'
              : 'bg-primary/15 text-primary'
          }`}>
            {isUser ? 'U' : 'A'}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${isUser ? 'text-foreground/70' : 'text-primary'}`}>
                {isUser ? t("YOU") : (agentName || "AGENT")}
              </span>
              {isStreaming && (
                <span className="flex items-center gap-1.5 text-[11px] text-primary font-medium">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  {t("Responding")}
                </span>
              )}
            </div>

            <div className="w-full space-y-2 overflow-hidden min-w-0">
              {message.blocks.map((block, idx) => (
                <BlockRenderer
                  key={idx}
                  block={block}
                  isStreaming={isStreaming}
                  isLastBlock={idx === message.blocks.length - 1}
                />
              ))}

              {isStreaming && message.blocks.length === 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  <span className="text-xs text-muted-foreground">{t("Initializing resonance...")}</span>
                </div>
              )}

              {message.status === "error" && (
                <div className="text-destructive text-xs font-mono p-3 rounded-md border border-destructive/20 bg-destructive/5 flex gap-3 items-start">
                  <div className="font-bold shrink-0">!</div>
                  <div className="leading-relaxed">
                    {message.blocks.find(b => b.type === "text")?.content || "An error occurred during generation."}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockRenderer({ block, isStreaming, isLastBlock }: {
  block: MessageBlock;
  isStreaming: boolean;
  isLastBlock: boolean;
}) {
  switch (block.type) {
    case "thinking":
      return (
        <ThinkingBlock
          content={block.content}
          isStreaming={isStreaming && isLastBlock}
        />
      );
    case "tool_call":
      return (
        <ToolCallBlock
          name={block.name}
          argumentsText={block.arguments}
          result={block.result}
          isStreaming={block.status === "running"}
        />
      );
    case "image":
      return (
        <div className="rounded-md border border-border overflow-hidden inline-block">
          <img
            src={block.url}
            alt={block.name}
            className="max-h-80 max-w-full object-contain"
          />
        </div>
      );
    case "text":
      return block.content ? (
        <div className="max-w-none break-words prose">
          <Streamdown
            plugins={{ code, cjk, math, mermaid }}
            rehypePlugins={customRehypePlugins}
            isAnimating={isStreaming && isLastBlock}
          >
            {block.content}
          </Streamdown>
        </div>
      ) : null;
  }
}
