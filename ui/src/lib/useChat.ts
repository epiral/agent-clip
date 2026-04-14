/**
 * useChat — React hook encapsulating the full chat lifecycle.
 *
 * Block-based model: assistant messages contain an ordered sequence of
 * MessageBlock (thinking / tool_call / text), supporting interleaved output.
 *
 * Per-topic message cache: switching topics preserves streaming state.
 */

import { useState, useCallback, useRef } from "react";
import * as agent from "./agent";
import type { Topic, ChatMessage, MessageBlock, HistoryMessage, TokenUsage } from "./types";

// Collect tool results that follow an assistant message.
function collectToolResults(history: HistoryMessage[], assistantIdx: number): string[] {
  const results: string[] = [];
  for (let i = assistantIdx + 1; i < history.length; i++) {
    if (history[i].role === "tool") {
      results.push(history[i].content ?? "");
    } else {
      break;
    }
  }
  return results;
}

let msgCounter = 0;
function nextId() {
  return `msg-${++msgCounter}`;
}

// Convert raw history messages to ChatMessage blocks
function historyToChatMessages(history: HistoryMessage[]): ChatMessage[] {
  const chatMsgs: ChatMessage[] = [];
  let currentAssistant: ChatMessage | null = null;

  const flushAssistant = () => {
    if (currentAssistant && currentAssistant.blocks.length > 0) {
      chatMsgs.push(currentAssistant);
    }
    currentAssistant = null;
  };

  for (const msg of history) {
    if (msg.role === "user") {
      flushAssistant();
      const userBlocks: MessageBlock[] = [];
      // Add image attachments before text
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.is_image) {
            userBlocks.push({ type: "image", url: att.url, name: att.name });
          }
        }
      }
      userBlocks.push({ type: "text", content: msg.content ?? "" });
      chatMsgs.push({
        id: nextId(),
        role: "user",
        blocks: userBlocks,
        status: "done",
      });
    } else if (msg.role === "assistant") {
      if (!currentAssistant) {
        currentAssistant = { id: nextId(), role: "assistant", blocks: [], status: "done" };
      }
      if (msg.reasoning) {
        currentAssistant.blocks.push({ type: "thinking", content: msg.reasoning });
      }
      if (msg.tool_calls?.length) {
        const msgIdx = history.indexOf(msg);
        const results = collectToolResults(history, msgIdx);
        for (let j = 0; j < msg.tool_calls.length; j++) {
          const tc = msg.tool_calls[j];
          currentAssistant.blocks.push({
            type: "tool_call",
            name: tc.name,
            arguments: tc.arguments,
            result: results[j],
            status: "done",
          });
        }
      }
      if (msg.content) {
        currentAssistant.blocks.push({ type: "text", content: msg.content });
      }
      if (msg.usage) {
        currentAssistant.blocks.push({ type: "usage", usage: msg.usage });
      }
    }
  }
  flushAssistant();
  return chatMsgs;
}

// Track streaming state per topic
interface StreamState {
  topicId: string;
  userMsg: ChatMessage;
  assistantId: string;
  blocks: MessageBlock[];
  cancel: () => void;
}

export function useChat() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [currentTopicId, setCurrentTopicId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Per-topic message cache (preserves streaming state across switches)
  const messageCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());
  // Active stream state (survives topic switches)
  const streamRef = useRef<StreamState | null>(null);
  // Pagination cursor: oldest message ID in current loaded set
  const oldestIdRef = useRef<number | null>(null);
  // Raw history for prepending older pages
  const historyRef = useRef<HistoryMessage[]>([]);

  const loadTopics = useCallback(async () => {
    try {
      const list = await agent.listTopics();
      setTopics(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // ─── Select topic + load history ───
  const selectTopic = useCallback(async (topicId: string | null) => {
    // Save current messages to cache before switching
    if (currentTopicId) {
      messageCacheRef.current.set(currentTopicId, messages);
    }

    setCurrentTopicId(topicId);
    setError(null);
    setActiveRunId(null);
    setHasMore(false);

    if (!topicId) {
      setMessages([]);
      setIsStreaming(false);
      historyRef.current = [];
      oldestIdRef.current = null;
      return;
    }

    // Check if we have an active stream for this topic
    const stream = streamRef.current;
    if (stream && stream.topicId === topicId) {
      // Restore from cache (has the live streaming messages)
      const cached = messageCacheRef.current.get(topicId);
      if (cached) {
        setMessages(cached);
        setIsStreaming(true);
        return;
      }
    }

    // Load from backend
    try {
      const data = await agent.getTopicData(topicId);
      historyRef.current = data.messages;
      oldestIdRef.current = data.oldest_id;
      setHasMore(data.has_more);
      const chatMsgs = historyToChatMessages(data.messages);

      // If there's an active run, show indicator
      if (data.active_run) {
        setActiveRunId(data.active_run.id);

        // For async runs with output, append as a streaming assistant message
        if (data.active_run.async && data.active_run.output) {
          chatMsgs.push({
            id: nextId(),
            role: "assistant",
            blocks: [{ type: "text", content: data.active_run.output }],
            status: "streaming",
          });
        } else if (!data.active_run.async) {
          // Sync run — stream is active in current session
          // The stream callbacks will update messages via assistantId
          // Just show what we have from DB
          chatMsgs.push({
            id: nextId(),
            role: "assistant",
            blocks: [],
            status: "streaming",
          });
        }
      }

      setMessages(chatMsgs);
      messageCacheRef.current.set(topicId, chatMsgs);
    } catch (e) {
      setMessages([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTopicId, messages]);

  // ─── Load more (older messages) ───
  const loadMore = useCallback(async () => {
    if (!currentTopicId || !oldestIdRef.current || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const data = await agent.getTopicData(currentTopicId, oldestIdRef.current);
      if (data.messages.length === 0) {
        setHasMore(false);
        return;
      }
      historyRef.current = [...data.messages, ...historyRef.current];
      oldestIdRef.current = data.oldest_id;
      setHasMore(data.has_more);
      const chatMsgs = historyToChatMessages(historyRef.current);
      setMessages(chatMsgs);
      messageCacheRef.current.set(currentTopicId, chatMsgs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoadingMore(false);
    }
  }, [currentTopicId, isLoadingMore, hasMore]);

  // ─── Send message ───
  const send = useCallback((message: string, topicId?: string, files?: File[]) => {
    const targetTopicId = topicId ?? currentTopicId ?? undefined;

    // Build user message blocks (text + image previews)
    const userBlocks: MessageBlock[] = [];
    if (files?.length) {
      for (const f of files) {
        userBlocks.push({ type: "image", url: URL.createObjectURL(f), name: f.name });
      }
    }
    userBlocks.push({ type: "text", content: message });

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      blocks: userBlocks,
      status: "done",
    };

    const assistantMsg: ChatMessage = {
      id: nextId(),
      role: "assistant",
      blocks: [],
      status: "streaming",
    };

    const assistantId = assistantMsg.id;
    const blocks: MessageBlock[] = [];

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    setError(null);

    const getLastBlock = (type: string) => {
      const last = blocks[blocks.length - 1];
      return last?.type === type ? last : null;
    };

    const updateAssistant = (patch: Partial<ChatMessage>) => {
      setMessages((prev) => {
        const updated = prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m));
        // Also update cache
        if (targetTopicId) {
          messageCacheRef.current.set(targetTopicId, updated);
        }
        return updated;
      });
    };

    // Upload files first (if any), then send with attachment paths
    const doSend = (attachments?: string[], overrideTopicId?: string) => {
      return agent.send(message, { topicId: overrideTopicId ?? targetTopicId, attachments }, {
      onInfo: (info) => {
        const match = info.match(/\[topic\]\s+(\S+)/);
        if (match) {
          const newTopicId = match[1];
          if (!targetTopicId) {
            setCurrentTopicId(newTopicId);
          }
          // Update stream ref with actual topic ID
          if (streamRef.current) {
            streamRef.current.topicId = newTopicId;
          }
        }
      },
      onThinking: (token) => {
        // Skip empty/whitespace-only thinking tokens (e.g. trailing "\n")
        if (!token.trim() && !getLastBlock("thinking")) return;

        const last = getLastBlock("thinking") as { type: "thinking"; content: string } | null;
        if (last) {
          last.content += token;
        } else {
          // Strip the "[thinking] " prefix from the first token
          const clean = token.replace(/^\[thinking\]\s*/, "");
          if (!clean) return;
          blocks.push({ type: "thinking", content: clean });
        }
        updateAssistant({ blocks: [...blocks] });
      },
      onToolCall: (name, args) => {
        blocks.push({ type: "tool_call", name, arguments: args, status: "running" });
        updateAssistant({ blocks: [...blocks] });
      },
      onToolResult: (content) => {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          if (b.type === "tool_call" && b.status === "running") {
            b.result = content;
            b.status = "done";
            break;
          }
        }
        updateAssistant({ blocks: [...blocks] });
      },
      onText: (token) => {
        const last = getLastBlock("text") as { type: "text"; content: string } | null;
        if (last) {
          last.content += token;
        } else {
          blocks.push({ type: "text", content: token });
        }
        updateAssistant({ blocks: [...blocks] });
      },
      onUsage: (usage: TokenUsage) => {
        blocks.push({ type: "usage", usage });
        updateAssistant({ blocks: [...blocks] });
      },
      onDone: () => {
        updateAssistant({ status: "done" });
        setIsStreaming(false);
        setActiveRunId(null);
        streamRef.current = null;
        // Clear cache so next load fetches fresh from DB
        if (targetTopicId) {
          messageCacheRef.current.delete(targetTopicId);
        }
        loadTopics();
      },
      onError: (err) => {
        const textContent = blocks.find(b => b.type === "text") as { content: string } | undefined;
        if (!textContent) {
          blocks.push({ type: "text", content: err.message });
        }
        updateAssistant({ blocks: [...blocks], status: "error" });
        setIsStreaming(false);
        setActiveRunId(null);
        setError(err.message);
        streamRef.current = null;
      },
      });
    };

    // Upload files then send, or send directly
    let cancel: () => void;
    if (files?.length) {
      // If no topic yet, create one first
      const uploadAndSend = async () => {
        try {
          let topicForUpload = targetTopicId;
          if (!topicForUpload) {
            const topic = await agent.createTopic(message.slice(0, 30) || "image");
            topicForUpload = topic.id;
            setCurrentTopicId(topicForUpload);
            if (streamRef.current) streamRef.current.topicId = topicForUpload;
            loadTopics();
          }
          const results = await Promise.all(files.map(f => agent.upload(f, topicForUpload!)));
          cancel = doSend(results.map(r => r.path), topicForUpload);
          if (streamRef.current) streamRef.current.cancel = cancel;
        } catch (err: any) {
          updateAssistant({ blocks: [{ type: "text", content: `Upload failed: ${err.message}` }], status: "error" });
          setIsStreaming(false);
        }
      };
      uploadAndSend();
      cancel = () => {}; // placeholder until upload completes
    } else {
      cancel = doSend();
    }

    // Track the stream
    streamRef.current = {
      topicId: targetTopicId ?? "",
      userMsg,
      assistantId,
      blocks,
      cancel,
    };
  }, [currentTopicId, loadTopics]);

  // ─── Delete topic ───
  const removeTopic = useCallback(async (topicId: string) => {
    try {
      await agent.deleteTopic(topicId);
      messageCacheRef.current.delete(topicId);
      if (currentTopicId === topicId) {
        setCurrentTopicId(null);
        setMessages([]);
      }
      await loadTopics();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [currentTopicId, loadTopics]);

  // ─── Cancel streaming ───
  const cancel = useCallback(() => {
    streamRef.current?.cancel();
    streamRef.current = null;
    setIsStreaming(false);
    setActiveRunId(null);
    setMessages((prev) =>
      prev.map((m) =>
        m.status === "streaming" ? { ...m, status: "done" as const } : m,
      ),
    );
  }, []);

  return {
    topics,
    currentTopicId,
    messages,
    isStreaming,
    error,
    activeRunId,
    hasMore,
    isLoadingMore,
    loadTopics,
    selectTopic,
    send,
    cancel,
    removeTopic,
    loadMore,
  };
}
