import type { ProviderAdapter, ResolvedConnection, TextRequest, TextResponse } from "../types.js";import { DomainError } from "@sdd/shared";
import { guardedFetch, readCapped } from "../ssrf.js";
import { openAiBase } from "../endpoints.js";

interface OpenAIChatChoice {
  message?: { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string | null;
}

interface OpenAIChatResponse {
  choices?: OpenAIChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

/**
 * OpenAI Chat Completions adapter; also serves OpenAI-compatible custom base
 * URLs (FR-152). Structured generation asks for JSON mode
 * (`response_format: { type: "json_object" }`) — see `wantsJsonMode`; the
 * schema itself travels in the system prompt, and callers always re-validate
 * against the application schema afterwards (AI output is untrusted).
 */
export const openAiAdapter: ProviderAdapter = {
  providerTypes: ["OPENAI", "OPENAI_COMPATIBLE"],

  async generateText(conn, modelId, parameters, request: TextRequest): Promise<TextResponse> {
    const url = `${openAiBase(conn.baseUrl)}/chat/completions`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...conn.headers,
    };
    const body = openAiRequestBody(conn, modelId, parameters, request);

    // Streaming by default: reasoning models routinely exceed reverse-proxy
    // origin timeouts (e.g. Cloudflare 524) on long generations; chunked deltas
    // keep the connection alive. `stream: false` in profile parameters opts out.
    const useStream = parameters["stream"] !== false;
    if (useStream) {
      body["stream"] = true;
      body["stream_options"] = { include_usage: true };
    }

    // SSE wire volume (per-token framing + reasoning deltas) is far larger than
    // the answer itself, so a streamed exchange gets a 4x raw-byte budget.
    const wireCap = useStream ? conn.maxResponseBytes * 4 : conn.maxResponseBytes;
    const response = await guardedFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: conn.timeoutMs,
      maxBytes: wireCap,
      allowPrivateEgress: conn.allowPrivateEgress,
    });
    if (!response.ok) throw providerError(response.status, await readCapped(response, conn.maxResponseBytes));

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (useStream && response.body && contentType.includes("text/event-stream")) {
      // Consume incrementally: raw SSE volume from runaway reasoning models
      // can exceed the body cap even though the answer itself is small.
      return consumeSseBody(response, request.onDelta);
    }

    // Some gateways ignore `stream:true` and answer with plain JSON (or send
    // SSE without the right content-type). Decide from the body we actually
    // got — the stream can only be read once.
    const text = await readCapped(response, wireCap);
    if (useStream && /^\s*(data:|event:|:)/.test(text)) return parseSseText(text);
    return parseNonStream(text);
  },
};

/**
 * JSON mode is sent only where it is known to be understood: the OpenAI API
 * itself when the connection declares structured output, or an
 * OpenAI-compatible gateway whose profile opts in with `json_mode: true`
 * (some compatible servers reject the field, so they keep today's request).
 */
function wantsJsonMode(conn: ResolvedConnection, parameters: Record<string, unknown>, request: TextRequest): boolean {
  if (!request.jsonMode) return false;
  if (conn.providerType === "OPENAI") return conn.capabilities.structured_output === true;
  return parameters["json_mode"] === true;
}

/** The Chat Completions request body (exported for tests; no I/O). */
export function openAiRequestBody(conn: ResolvedConnection, modelId: string, parameters: Record<string, unknown>, request: TextRequest): Record<string, unknown> {
  const maxTokens = request.maxTokens ?? toNumber(parameters["max_tokens"]);
  // Only what the caller or the profile set: reasoning models reject a
  // temperature, and every model has its own sensible default.
  const temperature = request.temperature ?? toNumber(parameters["temperature"]);
  const topP = toNumber(parameters["top_p"]);
  return {
    model: modelId,
    messages: [
      ...(request.system ? [{ role: "system", content: request.system }] : []),
      ...request.messages.map((m) => ({ role: m.role, content: m.images?.length ? [{ type: "text", text: m.content }, ...m.images.map(url => ({ type: "image_url", image_url: { url } }))] : m.content })),
    ],
    ...(temperature !== null ? { temperature } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(topP !== null ? { top_p: topP } : {}),
    ...(wantsJsonMode(conn, parameters, request) ? { response_format: { type: "json_object" } } : {}),
  };
}

export function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * An HTTP error from a provider. A JSON error's own message is kept (it says
 * what to fix: an unknown model, a bad key); a non-JSON body is never echoed —
 * pointed at an internal page, that would read it back to the caller.
 */
export function providerError(status: number, body: string): DomainError {
  let message = `Provider HTTP ${status}`;
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } };
    if (parsed.error?.message) message = String(parsed.error.message).slice(0, 300);
    code = typeof parsed.error?.code === "string" ? parsed.error.code.slice(0, 80) : undefined;
  } catch {
    /* status only */
  }
  return new DomainError("PROVIDER_ERROR", message, 502, { status, code });
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Extract the JSON answer from model text. Order matters:
 *  1. the whole (think-stripped) text — a bare JSON object whose string values
 *     contain ``` fences (e.g. SQL in a design) must NOT be cut at the fence;
 *  2. fenced ```json blocks;
 *  3. the outermost {…} / […] slice.
 * Always throws a DomainError (never a raw SyntaxError → 500).
 */
export function parseJsonLoose(text: string): unknown {
  // Reasoning models often emit <think>…</think> before the answer.
  const withoutThinking = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const trimmed = (withoutThinking || text).trim();

  const whole = tryJson(trimmed);
  if (whole.ok) return whole.value;

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const fenced = tryJson((match[1] ?? "").trim());
    if (fenced.ok && fenced.value !== null && typeof fenced.value === "object") return fenced.value;
  }

  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (start >= 0 && end > start) {
    const sliced = tryJson(trimmed.slice(start, end + 1));
    if (sliced.ok) return sliced.value;
  }
  throw new DomainError("AI_OUTPUT_INVALID", "Model output is not parseable JSON", 502);
}

/**
 * Reasoning text is only an acceptable answer when it IS the answer: a
 * complete JSON document (optionally think-wrapped or fenced). A draft object
 * buried in chain-of-thought must never be persisted as the real output.
 */
function answerFromReasoning(reasoning: string): string | null {
  const stripped = reasoning.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (tryJson(stripped).ok) return stripped;
  const fenced = stripped.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenced && tryJson((fenced[1] ?? "").trim()).ok) return (fenced[1] ?? "").trim();
  return null;
}

export function truncatedError(detail: string): DomainError {
  return new DomainError(
    "AI_OUTPUT_TRUNCATED",
    `The model hit its output limit before finishing (${detail}). Raise max_tokens on the AI profile or use a model with a larger output budget.`,
    502,
  );
}

function parseNonStream(text: string): { text: string; usage: { inputUnits: number | null; outputUnits: number | null }; raw: Record<string, unknown> } {
  let parsed: OpenAIChatResponse;
  try {
    parsed = JSON.parse(text) as OpenAIChatResponse;
  } catch {
    throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned non-JSON payload", 502);
  }
  if (parsed.error) {
    throw new DomainError("PROVIDER_ERROR", parsed.error.message ?? "Provider error", 502, { code: parsed.error.code });
  }
  const choice = parsed.choices?.[0];
  if (choice?.finish_reason === "length") throw truncatedError("finish_reason=length");
  // Reasoning models (e.g. glm-*, deepseek-r1) may put the final answer in
  // reasoning_content and leave content empty — accept it only when it is a
  // complete answer, never a half-thought.
  const message = choice?.message;
  const content = firstNonEmpty(message?.content, message?.reasoning_content ? answerFromReasoning(message.reasoning_content) : null);
  if (content === null) {
    throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned no answer content (only reasoning, or nothing)", 502);
  }
  return {
    text: content,
    usage: {
      inputUnits: parsed.usage?.prompt_tokens ?? null,
      outputUnits: parsed.usage?.completion_tokens ?? null,
    },
    raw: parsed as unknown as Record<string, unknown>,
  };
}

/** Incremental SSE consumer with per-field caps (runaway-reasoning safe). */
const CONTENT_CAP = 400_000;
const REASONING_CAP = 120_000;

interface StreamAccumulator {
  content: string;
  reasoning: string;
  inputUnits: number | null;
  outputUnits: number | null;
  sawChunk: boolean;
  finishReason: string | null;
  sawDone: boolean;
  contentCapped: boolean;
  onDelta?: (textSoFar: string) => void;
}

type StreamResult = { text: string; usage: { inputUnits: number | null; outputUnits: number | null }; raw: Record<string, unknown> };

function newAccumulator(onDelta?: (textSoFar: string) => void): StreamAccumulator {
  return { content: "", reasoning: "", inputUnits: null, outputUnits: null, sawChunk: false, finishReason: null, sawDone: false, contentCapped: false, onDelta };
}

/**
 * Line-oriented SSE event parser (WHATWG rules that matter here): CRLF/LF line
 * endings, several `data:` lines per event joined with "\n", events dispatched
 * on a blank line, and a final event without a trailing blank line.
 */
export class SseEventParser {
  private data: string[] = [];
  constructor(private readonly onEvent: (data: string) => "done" | void) {}

  /** Returns "done" once the [DONE] sentinel has been dispatched. */
  line(raw: string): "done" | void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") return this.flush();
    if (line.startsWith(":")) return; // comment / keep-alive
    if (line.startsWith("data:")) {
      this.data.push(line.slice(5).replace(/^ /, ""));
    }
    // event:/id:/retry: fields carry nothing we use.
  }

  flush(): "done" | void {
    if (this.data.length === 0) return;
    const payload = this.data.join("\n");
    this.data = [];
    return this.onEvent(payload);
  }
}

function finishStream(acc: StreamAccumulator): StreamResult {
  if (acc.finishReason === "length") throw truncatedError("finish_reason=length");
  if (acc.contentCapped) throw truncatedError("content exceeded the stream cap");
  // No [DONE] and no finish_reason: the connection dropped mid-answer.
  if (!acc.sawDone && acc.finishReason === null) throw truncatedError("stream ended without completion");
  const text = firstNonEmpty(acc.content, acc.reasoning ? answerFromReasoning(acc.reasoning) : null);
  if (text === null) {
    throw new DomainError("PROVIDER_BAD_RESPONSE", "Stream contained no answer content (only reasoning, or nothing)", 502);
  }
  return { text, usage: { inputUnits: acc.inputUnits, outputUnits: acc.outputUnits }, raw: { streamed: true, finish_reason: acc.finishReason } };
}

async function consumeSseBody(response: Response, onDelta?: (textSoFar: string) => void): Promise<StreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned an empty stream", 502);
  const acc = newAccumulator(onDelta);
  const parser = new SseEventParser((payload) => consumeSsePayload(payload, acc));
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      // The byte cap and the timeout are enforced by guardedFetch's stream.
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (parser.line(line) === "done") {
          finished = true;
          break;
        }
      }
    }
    if (!finished) {
      // Flush the decoder and the last line/event even without a trailing newline.
      buffer += decoder.decode();
      if (buffer) parser.line(buffer);
      parser.flush();
    }
  } finally {
    if (finished) await reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
  if (!acc.sawChunk) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider stream contained no completion chunks", 502);
  return finishStream(acc);
}

/** Same parser over an already-buffered body (SSE without the SSE content-type). */
export function parseSseText(text: string): StreamResult {
  const acc = newAccumulator();
  const parser = new SseEventParser((payload) => consumeSsePayload(payload, acc));
  for (const line of text.split("\n")) {
    if (parser.line(line) === "done") break;
  }
  parser.flush();
  if (!acc.sawChunk) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider stream contained no completion chunks", 502);
  return finishStream(acc);
}

function consumeSsePayload(payload: string, acc: StreamAccumulator): "done" | void {
  const trimmed = payload.trim();
  if (!trimmed) return;
  if (trimmed === "[DONE]") {
    acc.sawDone = true;
    return "done";
  }
  let chunk: {
    choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
    error?: { message?: string };
  };
  try {
    chunk = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (chunk.error) throw new DomainError("PROVIDER_ERROR", chunk.error.message ?? "Provider error", 502);
  acc.sawChunk = true;
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  if (delta?.content) {
    if (acc.content.length + delta.content.length > CONTENT_CAP) acc.contentCapped = true;
    else {
      acc.content += delta.content;
      notifyDelta(acc.onDelta, acc.content);
    }
  }
  if (delta?.reasoning_content && acc.reasoning.length < REASONING_CAP * 2) {
    // Keep the tail: when the answer lands in reasoning_content it is at the end.
    acc.reasoning = (acc.reasoning + delta.reasoning_content).slice(-REASONING_CAP);
  }
  if (choice?.finish_reason) acc.finishReason = choice.finish_reason;
  if (chunk.usage) {
    acc.inputUnits = chunk.usage.prompt_tokens ?? acc.inputUnits;
    acc.outputUnits = chunk.usage.completion_tokens ?? acc.outputUnits;
  }
}

/** Hand the answer so far to a preview listener; a listener's failure never fails the call. */
export function notifyDelta(onDelta: ((textSoFar: string) => void) | undefined, textSoFar: string): void {
  if (!onDelta) return;
  try {
    onDelta(textSoFar);
  } catch {
    /* preview only */
  }
}

/**
 * Read an SSE body to its end, handing each event's data to `onEvent`
 * (native streams of Anthropic and Gemini; "done" stops early). The byte cap
 * and the timeouts are guardedFetch's.
 */
export async function readSseEvents(response: Response, onEvent: (data: string) => "done" | void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned an empty stream", 502);
  const parser = new SseEventParser(onEvent);
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (parser.line(line) === "done") {
          finished = true;
          break;
        }
      }
    }
    if (!finished) {
      buffer += decoder.decode();
      if (buffer) parser.line(buffer);
      parser.flush();
    }
  } finally {
    if (finished) await reader.cancel().catch(() => undefined);
    else reader.releaseLock();
  }
}
