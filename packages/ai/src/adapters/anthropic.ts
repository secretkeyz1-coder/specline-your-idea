import type { ProviderAdapter, TextResponse } from "../types.js";
import { DomainError } from "@sdd/shared";
import { guardedFetch, readCapped } from "../ssrf.js";
import { notifyDelta, providerError, readSseEvents, toNumber, truncatedError } from "./openai.js";
import { anthropicMessagesUrl, providerStaticHeaders } from "../endpoints.js";

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/** One event of the Messages streaming API (the fields read here). */
interface AnthropicStreamEvent {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

/**
 * Anthropic Messages API adapter (docs/07 §11 provider list). A caller that
 * wants the answer as it arrives (`onDelta`) gets the streaming API; every
 * other call keeps the single JSON response.
 */
export const anthropicAdapter: ProviderAdapter = {
  providerTypes: ["ANTHROPIC"],

  async generateText(conn, modelId, parameters, request): Promise<TextResponse> {
    const url = anthropicMessagesUrl(conn.baseUrl);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...providerStaticHeaders("ANTHROPIC"),
      ...conn.headers,
    };
    const body: Record<string, unknown> = {
      model: modelId,
      system: request.system || undefined,
      max_tokens: request.maxTokens ?? toNumber(parameters["max_tokens"]) ?? 4096,
      temperature: request.temperature ?? toNumber(parameters["temperature"]) ?? 0.4,
      messages: request.messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.images?.length ? [{ type: "text", text: m.content }, ...m.images.map(image => ({ type: "image", source: { type: "base64", media_type: "image/png", data: image.split(",")[1] } }))] : m.content })),
    };

    if (request.onDelta) body["stream"] = true;

    const response = await guardedFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: conn.timeoutMs,
      // Per-event framing makes a streamed exchange several times its answer.
      maxBytes: request.onDelta ? conn.maxResponseBytes * 4 : conn.maxResponseBytes,
      allowPrivateEgress: conn.allowPrivateEgress,
    });
    if (request.onDelta && response.ok && (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
      return readAnthropicStream(response, request.onDelta);
    }
    const text = await readCapped(response, conn.maxResponseBytes);
    if (!response.ok) throw providerError(response.status, text);
    let parsed: AnthropicResponse;
    try {
      parsed = JSON.parse(text) as AnthropicResponse;
    } catch {
      throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned non-JSON payload", 502);
    }
    if (parsed.error) throw new DomainError("PROVIDER_ERROR", parsed.error.message ?? "Provider error", 502);
    if (parsed.stop_reason === "max_tokens") throw truncatedError("stop_reason=max_tokens");
    const content = (parsed.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    if (!content) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned no text content", 502);
    return {
      text: content,
      usage: { inputUnits: parsed.usage?.input_tokens ?? null, outputUnits: parsed.usage?.output_tokens ?? null },
      raw: parsed as unknown as Record<string, unknown>,
    };
  },
};

async function readAnthropicStream(response: Response, onDelta: (textSoFar: string) => void): Promise<TextResponse> {
  let content = "";
  let stop = null as string | null;
  let stopped = false as boolean;
  const usage = { inputUnits: null as number | null, outputUnits: null as number | null };
  await readSseEvents(response, (data) => {
    let event: AnthropicStreamEvent;
    try {
      event = JSON.parse(data) as AnthropicStreamEvent;
    } catch {
      return;
    }
    if (event.type === "error") throw new DomainError("PROVIDER_ERROR", event.error?.message ?? "Provider error", 502);
    if (event.type === "message_start") usage.inputUnits = event.message?.usage?.input_tokens ?? usage.inputUnits;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
      content += event.delta.text;
      notifyDelta(onDelta, content);
    }
    if (event.type === "message_delta") {
      stop = event.delta?.stop_reason ?? stop;
      usage.outputUnits = event.usage?.output_tokens ?? usage.outputUnits;
    }
    if (event.type === "message_stop") {
      stopped = true;
      return "done";
    }
  });
  if (stop === "max_tokens") throw truncatedError("stop_reason=max_tokens");
  if (!stopped) throw truncatedError("stream ended without completion");
  if (!content) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned no text content", 502);
  return { text: content, usage, raw: { streamed: true, stop_reason: stop } };
}
