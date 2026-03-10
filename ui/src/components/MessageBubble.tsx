import type { ChatMessage, MessageBlock } from "../lib/types";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { harden } from "rehype-harden";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { code } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import "katex/dist/katex.min.css";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { useI18n } from "../lib/i18n";

// Extend rehype-sanitize schema to allow pinix-data:// and pinix-web:// on img src
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
    <div className={`w-full py-3 px-4 md:px-6 transition-all duration-300 animate-in-up border-l-2 ${isUser ? 'border-text-main/10' : 'border-transparent'}`}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] tracking-tight ${isUser ? 'text-text-main font-bold' : 'text-text-mute font-semibold'}`}>
            {isUser ? t("YOU") : (agentName || "AGENT")}
          </span>
          {!isUser && isStreaming && (
            <span className="text-[10px] text-brand-primary font-medium animate-pulse">
              {t("Responding...")}
            </span>
          )}
        </div>

        <div className="w-full space-y-3 overflow-hidden min-w-0">
          {message.blocks.map((block, idx) => (
            <BlockRenderer
              key={idx}
              block={block}
              isStreaming={isStreaming}
              isLastBlock={idx === message.blocks.length - 1}
            />
          ))}

          {isStreaming && message.blocks.length === 0 && (
            <div className="flex h-4 items-center gap-1.5 ml-1">
              <span className="w-1 h-1 bg-brand-primary/60 rounded-full animate-pulse" />
            </div>
          )}

          {message.status === "error" && (
            <div className="text-destructive text-[13px] p-3 bg-destructive/5 border border-destructive/10 rounded-md">
              {message.blocks.find(b => b.type === "text")?.content || "An error occurred during generation."}
            </div>
          )}
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
    case "text":
      return block.content ? (
        <div className="max-w-none break-words selection:bg-brand-primary/20">
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
