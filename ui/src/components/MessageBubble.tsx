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
import { motion, AnimatePresence } from "framer-motion";
import { User, Sparkles } from "lucide-react";

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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
      className={`w-full group transition-all ${
        isUser ? "bg-transparent" : "relative"
      }`}
    >
      {!isUser && (
        <div className="absolute inset-0 bg-card/40 backdrop-blur-[2px] border border-border/40 rounded-[2rem] -mx-4 md:-mx-6 z-0" />
      )}
      
      <div className="relative z-10 py-8 px-4 md:px-6 flex gap-4 md:gap-8">
        <div className="flex-shrink-0 pt-1">
          {isUser ? (
            <div className="h-10 w-10 rounded-2xl bg-muted/50 flex items-center justify-center text-muted-foreground ring-1 ring-border/50 shadow-sm">
              <User className="h-5 w-5" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary ring-1 ring-primary/20 shadow-glow relative overflow-hidden">
              <Sparkles className="h-5 w-5" />
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 8, ease: "linear" }}
                className="absolute inset-0 bg-linear-to-tr from-transparent via-primary/5 to-transparent"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2.5">
              <span className={`text-[11px] font-bold tracking-[0.2em] uppercase ${isUser ? 'text-muted-foreground' : 'text-primary'}`}>
                {isUser ? t("YOU") : (agentName || "AGENT")}
              </span>
              {!isUser && isStreaming && (
                <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-primary/5 border border-primary/10">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-[10px] text-primary/80 font-bold tracking-wider uppercase animate-pulse">
                    {t("Responding")}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="w-full space-y-6 overflow-hidden min-w-0">
            <AnimatePresence mode="popLayout">
              {message.blocks.map((block, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1, duration: 0.4 }}
                >
                  <BlockRenderer
                    block={block}
                    isStreaming={isStreaming}
                    isLastBlock={idx === message.blocks.length - 1}
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            {isStreaming && message.blocks.length === 0 && (
              <div className="flex h-8 items-center gap-2 ml-1">
                <motion.span 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0 }}
                  className="w-2 h-2 bg-primary/40 rounded-full" 
                />
                <motion.span 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                  className="w-2 h-2 bg-primary/40 rounded-full" 
                />
                <motion.span 
                  animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                  transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                  className="w-2 h-2 bg-primary/40 rounded-full" 
                />
              </div>
            )}

            {message.status === "error" && (
              <motion.div 
                initial={{ scale: 0.98, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-destructive text-[13px] p-5 bg-destructive/5 border border-destructive/10 rounded-2xl flex gap-4 items-start backdrop-blur-sm"
              >
                <div className="h-6 w-6 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="font-bold text-[12px]">!</span>
                </div>
                <div className="font-medium leading-relaxed">
                  {message.blocks.find(b => b.type === "text")?.content || "An error occurred during generation."}
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </motion.div>

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
        <div className="inline-block group/img relative">
          <img
            src={block.url}
            alt={block.name}
            className="max-h-80 max-w-full rounded-2xl border border-border/40 object-contain shadow-sm transition-transform hover:scale-[1.01]"
          />
        </div>
      );
    case "text":
      return block.content ? (
        <div className="max-w-none break-words selection:bg-brand-primary/20 prose">
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
