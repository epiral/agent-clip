import type { Config, ProviderConfig } from "./config";
import { log } from "./log";
import type { ImageData } from "./media";

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: string;
  function: FunctionCall;
}

export interface Message {
  role: string;
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  reasoning?: string;
  images?: ImageData[];
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export interface LLMResponse {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
}

interface APIMessage {
  role: string;
  content: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
    detail?: string;
  };
}

interface StreamToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: StreamToolCallDelta[];
    };
  }>;
}

interface AnthropicEvent {
  type?: string;
  index?: number;
  content_block?: {
    type?: string;
    id?: string;
    name?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
  };
}

interface AnthropicBlockState {
  blockType: string;
  toolID: string;
  toolName: string;
  args: string;
}

interface AnthropicImageSource {
  type: "base64";
  media_type: string;
  data: string;
}

export function textMessage(role: string, content: string): Message {
  return { role, content };
}

export function toolResultMessage(toolCallId: string, content: string): Message {
  return { role: "tool", toolCallId, content };
}

export async function callLLM(
  cfg: Config,
  messages: Message[],
  tools: ToolDef[],
  onToken?: ((token: string) => void) | null,
  onThinking?: ((token: string) => void) | null,
  signal?: AbortSignal,
): Promise<LLMResponse> {
  const provider = cfg.providers[cfg.llm_provider];
  if (!provider) {
    throw new Error(`provider ${JSON.stringify(cfg.llm_provider)} not found in config`);
  }
  if (!provider.api_key) {
    throw new Error(`no api_key for llm provider ${JSON.stringify(cfg.llm_provider)}`);
  }

  log("llm.request", { model: cfg.llm_model, messages: messages.length, tools: tools.length });

  let response: LLMResponse;
  if ((provider.protocol || "openai") === "anthropic") {
    response = await callAnthropic(provider, cfg.llm_model, messages, tools, onToken ?? undefined, onThinking ?? undefined, signal, cfg.max_tokens);
  } else {
    response = await callOpenAI(provider, cfg.llm_model, messages, tools, onToken ?? undefined, onThinking ?? undefined, signal, cfg.max_tokens);
  }

  const tcSummary = response.toolCalls.map(tc => ({ name: tc.function.name, args_length: tc.function.arguments.length }));
  log("llm.response", { content_length: response.content.length, tool_calls: tcSummary });

  return response;
}

function messagesToAPI(messages: Message[]): APIMessage[] {
  return messages.map((message) => {
    const apiMessage: APIMessage = {
      role: message.role,
      tool_calls: message.toolCalls,
      tool_call_id: message.toolCallId,
      content: "",
    };

    if (message.images && message.images.length > 0) {
      const parts: ContentPart[] = [];
      if (message.content) {
        parts.push({ type: "text", text: message.content });
      }
      for (const image of message.images) {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${image.mimeType};base64,${image.base64}`,
            detail: "low",
          },
        });
      }
      apiMessage.content = parts;
      return apiMessage;
    }

    apiMessage.content = message.content ?? "";
    return apiMessage;
  });
}

async function callOpenAI(
  provider: ProviderConfig,
  model: string,
  messages: Message[],
  tools: ToolDef[],
  onToken?: (token: string) => void,
  onThinking?: (token: string) => void,
  signal?: AbortSignal,
  maxTokens?: number,
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model,
    messages: messagesToAPI(messages),
    tools,
    stream: true,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (provider.provider) body.provider = provider.provider;

  const response = await fetch(`${provider.base_url}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(`LLM error ${response.status}: ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error("LLM response body is empty");
  }

  const content: string[] = [];
  const reasoning: string[] = [];
  const toolCalls = new Map<number, ToolCall>();

  for await (const data of readSSE(response.body)) {
    if (data === "[DONE]") {
      break;
    }

    let chunk: OpenAIChunk;
    try {
      chunk = JSON.parse(data) as OpenAIChunk;
    } catch {
      continue;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }

    if (delta.reasoning_content) {
      reasoning.push(delta.reasoning_content);
      onThinking?.(delta.reasoning_content);
    }

    if (delta.content) {
      content.push(delta.content);
      onToken?.(delta.content);
    }

    for (const toolCall of delta.tool_calls ?? []) {
      const current = toolCalls.get(toolCall.index) ?? {
        id: toolCall.id ?? "",
        type: toolCall.type ?? "function",
        function: {
          name: toolCall.function?.name ?? "",
          arguments: "",
        },
      };

      if (toolCall.id) {
        current.id = toolCall.id;
      }
      if (toolCall.type) {
        current.type = toolCall.type;
      }
      if (toolCall.function?.name) {
        current.function.name = toolCall.function.name;
      }
      if (toolCall.function?.arguments) {
        current.function.arguments += toolCall.function.arguments;
      }
      toolCalls.set(toolCall.index, current);
    }
  }

  return {
    content: content.join(""),
    reasoning: reasoning.join(""),
    toolCalls: [...toolCalls.entries()].sort((left, right) => left[0] - right[0]).map((entry) => entry[1]),
  };
}

function convertMessagesForAnthropic(messages: Message[]): { system: string; messages: Array<{ role: string; content: unknown }> } {
  let system = "";
  const result: Array<{ role: string; content: unknown }> = [];

  let index = 0;
  while (index < messages.length) {
    const message = messages[index];

    if (message.role === "system") {
      system = message.content ?? "";
      index += 1;
      continue;
    }

    if (message.role === "user") {
      const block = buildAnthropicContentBlocks(message);
      const last = result.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(...block);
      } else {
        result.push({ role: "user", content: block });
      }
      index += 1;
      continue;
    }

    if (message.role === "assistant") {
      const blocks: unknown[] = [];
      if (message.reasoning) {
        blocks.push({ type: "thinking", thinking: message.reasoning });
      }
      if (message.content) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const toolCall of message.toolCalls ?? []) {
        let parsedInput: unknown = {};
        try {
          parsedInput = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          parsedInput = {};
        }
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parsedInput,
        });
      }
      result.push({ role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }] });
      index += 1;
      continue;
    }

    if (message.role === "tool") {
      const blocks: unknown[] = [];
      while (index < messages.length && messages[index].role === "tool") {
        const toolMessage = messages[index];
        blocks.push({
          type: "tool_result",
          tool_use_id: toolMessage.toolCallId,
          content: buildAnthropicContentBlocks(toolMessage),
        });
        index += 1;
      }
      const last = result.at(-1);
      if (last?.role === "user" && Array.isArray(last.content)) {
        (last.content as unknown[]).push(...blocks);
      } else {
        result.push({ role: "user", content: blocks });
      }
      continue;
    }

    index += 1;
  }

  return { system, messages: result };
}

function buildAnthropicContentBlocks(message: Message): unknown[] {
  const blocks: unknown[] = [];
  if (message.content) {
    blocks.push({ type: "text", text: message.content });
  }
  for (const image of message.images ?? []) {
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mimeType,
        data: image.base64,
      } satisfies AnthropicImageSource,
    });
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

async function callAnthropic(
  provider: ProviderConfig,
  model: string,
  messages: Message[],
  tools: ToolDef[],
  onToken?: (token: string) => void,
  onThinking?: (token: string) => void,
  signal?: AbortSignal,
  maxTokens?: number,
): Promise<LLMResponse> {
  const converted = convertMessagesForAnthropic(messages);
  const response = await fetch(`${provider.base_url}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": provider.api_key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: converted.system,
      max_tokens: maxTokens || 65536,
      stream: true,
      messages: converted.messages,
      tools: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`anthropic error ${response.status}: ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error("anthropic response body is empty");
  }

  const content: string[] = [];
  const reasoning: string[] = [];
  const blocks = new Map<number, AnthropicBlockState>();

  for await (const data of readSSE(response.body)) {
    let event: AnthropicEvent;
    try {
      event = JSON.parse(data) as AnthropicEvent;
    } catch {
      continue;
    }

    switch (event.type) {
      case "content_block_start":
        blocks.set(event.index ?? 0, {
          blockType: event.content_block?.type ?? "",
          toolID: event.content_block?.id ?? "",
          toolName: event.content_block?.name ?? "",
          args: "",
        });
        break;
      case "content_block_delta": {
        const block = blocks.get(event.index ?? 0);
        if (!block) {
          break;
        }
        switch (event.delta?.type) {
          case "thinking_delta":
            if (event.delta.thinking) {
              reasoning.push(event.delta.thinking);
              onThinking?.(event.delta.thinking);
            }
            break;
          case "text_delta":
            if (event.delta.text) {
              content.push(event.delta.text);
              onToken?.(event.delta.text);
            }
            break;
          case "input_json_delta":
            block.args += event.delta.partial_json ?? "";
            break;
          default:
            break;
        }
        break;
      }
      default:
        break;
    }
  }

  const toolCalls = [...blocks.entries()]
    .filter((entry) => entry[1].blockType === "tool_use")
    .sort((left, right) => left[0] - right[0])
    .map((entry) => ({
      id: entry[1].toolID,
      type: "function",
      function: {
        name: entry[1].toolName,
        arguments: entry[1].args,
      },
    } satisfies ToolCall));

  return {
    content: content.join(""),
    reasoning: reasoning.join(""),
    toolCalls,
  };
}

/**
 * Spec-compliant SSE parser following the WHATWG EventSource algorithm.
 * Handles \r\n, \n, \r line endings and multi-line data: field accumulation.
 */
async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const dataLines: string[] = [];

  function dispatch(): string | null {
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    dataLines.length = 0;
    return data || null;
  }

  function processLine(line: string): string | null {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") return dispatch();
    if (line.startsWith(":")) return null;

    const colonIdx = line.indexOf(":");
    let field: string;
    let value: string;
    if (colonIdx === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colonIdx);
      value = line.slice(colonIdx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }

    if (field === "data") dataLines.push(value);
    return null;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let lineStart = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch === "\n" || ch === "\r") {
          const line = buffer.slice(lineStart, i);
          if (ch === "\r" && buffer[i + 1] === "\n") i++;
          lineStart = i + 1;
          const event = processLine(line);
          if (event !== null) yield event;
        }
      }

      if (lineStart > 0) buffer = buffer.slice(lineStart);
    }

    // Flush remaining
    if (buffer.length > 0) {
      const event = processLine(buffer);
      if (event !== null) yield event;
    }
    const final = dispatch();
    if (final !== null) yield final;
  } finally {
    reader.releaseLock();
  }
}
