import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ArrowUp, Square, Paperclip, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { FileAttachment } from "../lib/types";

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
        200
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

  // Paste handler — intercept images from clipboard
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

  // Drag & drop
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
      className="w-full transition-all duration-300 ease-in-out focus-within:px-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`relative group flex flex-col bg-bg-surface border focus-within:border-brand-primary/60 rounded-xl transition-all duration-300 shadow-sm overflow-hidden ${
        isDragging ? "border-brand-primary/60 bg-brand-primary/5" : "border-border/60"
      }`}>
        {/* Attachment preview strip */}
        {attachments.length > 0 && (
          <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto scrollbar-none">
            {attachments.map((att, i) => (
              <div key={i} className="relative shrink-0 group/thumb">
                <img
                  src={att.preview}
                  alt={att.file.name}
                  className="h-16 w-16 object-cover rounded-lg border border-border/40"
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-bg-surface border border-border rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-destructive hover:text-white hover:border-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end">
          {/* Attach button */}
          <div className="flex items-center h-[52px] pl-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 w-8 text-text-mute/40 hover:text-text-mute rounded-lg transition-all"
              disabled={isStreaming}
            >
              <Paperclip className="h-4 w-4" />
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
            className="flex-1 min-h-[52px] max-h-[200px] resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-2 py-4 text-[14px] leading-relaxed placeholder:text-text-mute/40 font-normal scrollbar-none transition-all"
            rows={1}
          />

          <div className="flex items-center h-[52px] px-2">
            {isStreaming ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={onCancel}
                className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-lg transition-all"
              >
                <Square className="h-3 w-3 fill-current" />
                <span className="sr-only">Cancel</span>
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!hasContent}
                className={`h-8 w-8 rounded-lg transition-all duration-200 ${
                  hasContent
                    ? "bg-brand-primary text-white scale-100 opacity-100 shadow-sm hover:brightness-110 active:scale-95"
                    : "bg-muted text-text-mute/30 scale-95 opacity-50 shadow-none"
                }`}
              >
                <ArrowUp className="h-4 w-4 stroke-[2.5]" />
                <span className="sr-only">{t("Send")}</span>
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-center text-text-mute/30 font-medium tracking-tight opacity-0 group-focus-within:opacity-100 transition-opacity duration-300">
        {t("Press Enter to Transmit")} · {t("Shift+Enter for multi-line")}
      </div>
    </div>
  );
}
