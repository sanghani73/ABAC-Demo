/**
 * Provider-agnostic streaming chat client targeted at the Grove gateway.
 *
 * Grove exposes BOTH provider shapes behind a single API key:
 *   - OpenAI Responses API  at  {GROVE_BASE_URL}/openai/v1/responses
 *   - Anthropic Messages API at {GROVE_BASE_URL}/anthropic/v1/messages
 *
 * We pick a path by model id prefix (`gpt-*` → OpenAI, `claude-*` → Anthropic)
 * and normalise to a single async iterator of token deltas. The two providers
 * have slightly different multimodal content-block shapes; this module hides
 * that behind a single `ChatPart` union.
 *
 * Streaming is implemented by reading the response body as a stream of
 * server-sent events. We yield text deltas as they arrive and never
 * accumulate the full response server-side.
 */

const DEFAULT_BASE_URL =
  process.env.GROVE_BASE_URL ||
  "https://grove-gateway-prod.azure-api.net/grove-foundry-prod";

function groveApiKey(): string {
  const k = process.env.GROVE_API_KEY;
  if (!k) {
    throw new Error(
      "GROVE_API_KEY is not set. Add it to .env.local — see .env.example.",
    );
  }
  return k;
}

export type ChatRole = "system" | "user" | "assistant";

/**
 * One element of a message. The shapes are deliberately small so the chat
 * route can build them without knowing which provider will service the call.
 * Image bytes are kept as a base64 data URI so they survive the JSON round-
 * trip into both providers.
 */
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_base64"; mediaType: string; base64: string };

export interface ChatMessage {
  role: ChatRole;
  parts: ChatPart[];
}

export interface ChatRequest {
  model: string;
  /** System prompt — sent ahead of the conversation. */
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

/**
 * Yields text token deltas as they arrive from the model. The full response
 * is the concatenation of every yielded chunk.
 */
export async function* streamChat(req: ChatRequest): AsyncIterable<string> {
  const isClaude = req.model.toLowerCase().startsWith("claude");
  if (isClaude) {
    yield* streamAnthropic(req);
  } else {
    yield* streamOpenAI(req);
  }
}

/**
 * Discover which models the UI should expose. Reads `GROVE_CHAT_MODELS` —
 * comma-separated. Falls back to a sensible default that mirrors what the
 * Grove sample cURLs in the README show.
 */
export function listChatModels(): string[] {
  const raw = process.env.GROVE_CHAT_MODELS;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["claude-sonnet-4-6", "gpt-5.5"];
}

// ---------------------------------------------------------------------------
// Anthropic Messages — Grove path: /anthropic/v1/messages
// ---------------------------------------------------------------------------

async function* streamAnthropic(req: ChatRequest): AsyncIterable<string> {
  const url = `${DEFAULT_BASE_URL}/anthropic/v1/messages`;
  const body = {
    model: req.model,
    max_tokens: req.maxTokens ?? 1024,
    system: req.system,
    stream: true,
    messages: req.messages.map(toAnthropicMessage),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "api-key": groveApiKey(),
    },
    body: JSON.stringify(body),
    signal: req.abortSignal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Grove (anthropic) ${res.status}: ${text.slice(0, 800)}`);
  }
  for await (const event of readSse(res.body)) {
    if (event.event === "content_block_delta") {
      const delta = (event.data?.delta ?? null) as
        | { type?: string; text?: string }
        | null;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        yield delta.text;
      }
    } else if (event.event === "message_stop") {
      return;
    }
  }
}

function toAnthropicMessage(m: ChatMessage): {
  role: "user" | "assistant";
  content: Array<Record<string, unknown>>;
} {
  // Anthropic doesn't accept system inside messages — we send it as a
  // separate top-level field, so the caller's `role: "system"` is filtered
  // out upstream. Defensive coercion here for non-system roles only.
  const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
  return {
    role,
    content: m.parts.map((p) => {
      if (p.type === "text") return { type: "text", text: p.text };
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: p.mediaType,
          data: p.base64,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// OpenAI Responses API — Grove path: /openai/v1/responses
// ---------------------------------------------------------------------------

async function* streamOpenAI(req: ChatRequest): AsyncIterable<string> {
  const url = `${DEFAULT_BASE_URL}/openai/v1/responses`;
  const input = buildOpenAIInput(req);
  const body: Record<string, unknown> = {
    model: req.model,
    input,
    stream: true,
  };
  if (req.maxTokens) body.max_output_tokens = req.maxTokens;
  if (req.system) body.instructions = req.system;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": groveApiKey(),
    },
    body: JSON.stringify(body),
    signal: req.abortSignal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Grove (openai) ${res.status}: ${text.slice(0, 800)}`);
  }
  for await (const event of readSse(res.body)) {
    // Responses API streams a `response.output_text.delta` event per chunk.
    const t = event.event;
    if (t === "response.output_text.delta" && typeof event.data?.delta === "string") {
      yield event.data.delta as string;
    } else if (t === "response.completed" || t === "response.error") {
      return;
    }
  }
}

function buildOpenAIInput(req: ChatRequest): Array<Record<string, unknown>> {
  return req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: m.parts.map((p) => {
        if (p.type === "text") {
          return m.role === "assistant"
            ? { type: "output_text", text: p.text }
            : { type: "input_text", text: p.text };
        }
        return {
          type: "input_image",
          image_url: `data:${p.mediaType};base64,${p.base64}`,
        };
      }),
    }));
}

// ---------------------------------------------------------------------------
// SSE reader — minimal, just enough for both providers
// ---------------------------------------------------------------------------

interface SseEvent {
  event: string;
  data: Record<string, unknown> | null;
}

async function* readSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = parseSseChunk(chunk);
      if (event) yield event;
    }
  }
}

function parseSseChunk(chunk: string): SseEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of chunk.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join("\n");
  if (dataStr === "[DONE]") return { event: "response.completed", data: null };
  try {
    return { event: eventName, data: JSON.parse(dataStr) };
  } catch {
    return { event: eventName, data: null };
  }
}
