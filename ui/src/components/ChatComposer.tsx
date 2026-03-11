import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ArrowUp, Square, Paperclip, X, Image as ImageIcon, Terminal } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { FileAttachment } from "../lib/types";
import { motion, AnimatePresence } from "framer-motion";

interface ChatComposerProps {
  onSend: (message: string, topicId?: string, files?: File[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
  agentName?: string;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function ChatComposer({ onSend, onCancel, isStreaming, agentName }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        240
      )}px`;
    }
  }, [input]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      attachments.forEach(a => URL.revokeObjectURL(a.preview));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: FileAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      newAttachments.push({
        file,
        preview: URL.createObjectURL(file),
      });
    }
    if (newAttachments.length > 0) {
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    const files = attachments.map(a => a.file);
    onSend(input.trim() || "(image)", undefined, files.length > 0 ? files : undefined);
    setInput("");
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }, [addFiles]);

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const hasContent = input.trim() || attachments.length > 0;

  return (
    <div
      className="w-full max-w-4xl mx-auto px-4 pb-10"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`relative flex flex-col bg-card border-2 rounded-[2rem] transition-all duration-500 shadow-tactile overflow-hidden ${
        isDragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-border/40 focus-within:border-primary/40 focus-within:ring-[12px] focus-within:ring-primary/5"
      }`}>
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex gap-4 px-6 pt-6 overflow-x-auto no-scrollbar"
            >
              {attachments.map((att, i) => (
                <motion.div 
                  key={att.preview} 
                  layout
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative shrink-0 group/thumb"
                >
                  <div className="relative h-24 w-24 rounded-2xl overflow-hidden border-2 border-border/40 shadow-sm transition-transform group-hover/thumb:scale-[1.05]">
                    <img
                      src={att.preview}
                      alt={att.file.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/20 transition-colors" />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-background border border-border rounded-full flex items-center justify-center shadow-md opacity-0 group-hover/thumb:opacity-100 transition-all hover:bg-destructive hover:text-white hover:border-destructive hover:scale-110 active:scale-90"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end p-3 md:p-4 gap-2">
          <div className="flex items-center h-[52px]">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="h-10 w-10 text-muted-foreground/50 hover:text-primary hover:bg-primary/5 rounded-2xl transition-all active:scale-90"
              disabled={isStreaming}
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={t("Ask {name} anything...", { name: agentName || "Agent" })}
            className="flex-1 min-h-[52px] max-h-[240px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-3.5 text-[16px] leading-relaxed placeholder:text-muted-foreground/30 font-medium no-scrollbar"
            rows={1}
          />

          <div className="flex items-center h-[52px]">
            <AnimatePresence mode="wait">
              {isStreaming ? (
                <motion.div
                  key="cancel"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={onCancel}
                    className="h-10 w-10 text-destructive hover:bg-destructive/10 rounded-2xl transition-all active:scale-90"
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="send"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                >
                  <Button
                    size="icon"
                    onClick={handleSend}
                    disabled={!hasContent}
                    className={`h-10 w-10 rounded-2xl transition-all duration-300 active:scale-90 ${
                      hasContent
                        ? "bg-primary text-primary-foreground shadow-glow hover:brightness-110"
                        : "bg-muted/50 text-muted-foreground/20"
                    }`}
                  >
                    <ArrowUp className="h-5 w-5 stroke-[3]" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-center gap-6 text-[10px] text-muted-foreground/40 font-bold tracking-[0.15em] uppercase transition-opacity duration-500">
        <span className="flex items-center gap-2 group cursor-default">
          <Terminal className="w-3.5 h-3.5 opacity-50 group-hover:text-primary transition-colors" /> 
          Transmit (Enter)
        </span>
        <span className="flex items-center gap-2 group cursor-default">
          <ImageIcon className="w-3.5 h-3.5 opacity-50 group-hover:text-primary transition-colors" /> 
          Multi-line (Shift+Enter)
        </span>
      </div>
    </div>
  );
}
