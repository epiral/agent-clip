import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowUp, Square, Paperclip, X, Bot } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { FileAttachment } from "../lib/types";

interface ChatComposerProps {
  onSend: (message: string, topicId?: string, files?: File[]) => void;
  onCancel: () => void;
  isStreaming: boolean;
  agentName?: string;
  selectedAgent?: { name: string } | null;
  onDeselectAgent?: () => void;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function ChatComposer({ onSend, onCancel, isStreaming, agentName, selectedAgent, onDeselectAgent }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [input]);

  useEffect(() => {
    return () => { attachments.forEach(a => URL.revokeObjectURL(a.preview)); };
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newAttachments: FileAttachment[] = [];
    for (const file of Array.from(files)) {
      if (!IMAGE_TYPES.includes(file.type)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      newAttachments.push({ file, preview: URL.createObjectURL(file) });
    }
    if (newAttachments.length > 0) setAttachments(prev => [...prev, ...newAttachments]);
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
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
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

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback(() => { setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const hasContent = input.trim() || attachments.length > 0;
  const placeholderName = selectedAgent?.name ?? agentName ?? "Agent";

  return (
    <div
      className={`flex flex-col transition-colors ${isDragging ? 'bg-primary/5' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Agent indicator tag */}
      {selectedAgent && (
        <div className="flex items-center gap-1.5 px-4 pt-2.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/8 px-2 py-0.5 rounded-md">
            <Bot className="w-3 h-3" />
            {selectedAgent.name}
            {onDeselectAgent && (
              <button onClick={onDeselectAgent} className="ml-0.5 hover:text-primary/70 transition-colors">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex gap-3 px-4 pt-3 overflow-x-auto no-scrollbar">
          {attachments.map((att, i) => (
            <div key={att.preview} className="relative shrink-0 group/thumb">
              <div className="relative h-16 w-16 rounded-md border border-border overflow-hidden">
                <img src={att.preview} alt={att.file.name} className="h-full w-full object-cover" />
              </div>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-foreground text-background rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end p-3 md:px-4 md:py-3 gap-1.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          disabled={isStreaming}
        >
          <Paperclip className="h-4.5 w-4.5" />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t("Ask {name} anything...", { name: placeholderName })}
          className="flex-1 min-h-[40px] max-h-[240px] resize-none border-none bg-transparent focus:ring-0 focus:outline-none px-2 py-2 text-[16px] md:text-sm leading-relaxed placeholder:text-muted-foreground/50 no-scrollbar"
          rows={1}
        />

        <div className="flex items-center h-[40px]">
          {isStreaming ? (
            <button onClick={onCancel} className="p-2 rounded-md text-destructive hover:bg-destructive/10 transition-colors">
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!hasContent}
              className="bg-primary text-primary-foreground rounded-lg h-9 w-9 flex items-center justify-center hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-40"
            >
              <ArrowUp className="h-4.5 w-4.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
