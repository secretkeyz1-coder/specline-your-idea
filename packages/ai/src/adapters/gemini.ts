import type { ProviderAdapter, TextResponse } from "../types.js";
import { DomainError } from "@sdd/shared";
import { guardedFetch, readCapped } from "../ssrf.js";
import { notifyDelta, providerError, readSseEvents, toNumber, truncatedError } from "./openai.js";
import { geminiGenerateUrl, geminiStreamUrl } from "../endpoints.js";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

/**
 * Google Gemini generateContent adapter (docs/07 §11 provider list). A caller
 * that wants the answer as it arrives (`onDelta`) gets streamGenerateContent
 * over SSE; every other call keeps the single JSON response.
 */
export const geminiAdapter: ProviderAdapter = {
  providerTypes: ["GEMINI"],

  async generateText(conn, modelId, parameters, request): Promise<TextResponse> {
    const url = request.onDelta ? geminiStreamUrl(conn.baseUrl, modelId) : geminiGenerateUrl(conn.baseUrl, modelId);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...conn.headers,
    };
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }, ...(m.images ?? []).map(image => ({ inlineData: { mimeType: "image/png", data: image.split(",")[1] } }))],
    }));
    const body: Record<string, unknown> = {
      ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
      contents: contents.length ? contents : [{ role: "user", parts: [{ text: "(empty)" }] }],
      generationConfig: {
        temperature: request.temperature ?? toNumber(parameters["temperature"]) ?? 0.4,
        maxOutputTokens: request.maxTokens ?? toNumber(parameters["max_tokens"]) ?? 8192,
      },
    };

    const response = await guardedFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeoutMs: conn.timeoutMs,
      // Each streamed chunk repeats its envelope: several times the answer on the wire.
      maxBytes: request.onDelta ? conn.maxResponseBytes * 4 : conn.maxResponseBytes,
      allowPrivateEgress: conn.allowPrivateEgress,
    });
    if (request.onDelta && response.ok && (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
      return readGeminiStream(response, request.onDelta);
    }
    const text = await readCapped(response, conn.maxResponseBytes);
    if (!response.ok) throw providerError(response.status, text);
    let parsed: GeminiResponse;
    try {
      parsed = JSON.parse(text) as GeminiResponse;
    } catch {
      throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned non-JSON payload", 502);
    }
    if (parsed.error) throw new DomainError("PROVIDER_ERROR", parsed.error.message ?? "Provider error", 502);
    const candidate = parsed.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") throw truncatedError("finishReason=MAX_TOKENS");
    // Thinking models return thought parts alongside the answer — exclude them.
    const content = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (!content) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned no candidates", 502);
    return {
      text: content,
      usage: {
        inputUnits: parsed.usageMetadata?.promptTokenCount ?? null,
        outputUnits: parsed.usageMetadata?.candidatesTokenCount ?? null,
      },
      raw: parsed as unknown as Record<string, unknown>,
    };
  },
};

async function readGeminiStream(response: Response, onDelta: (textSoFar: string) => void): Promise<TextResponse> {
  let content = "";
  let finish = null as string | null;
  const usage = { inputUnits: null as number | null, outputUnits: null as number | null };
  await readSseEvents(response, (data) => {
    let chunk: GeminiResponse;
    try {
      chunk = JSON.parse(data) as GeminiResponse;
    } catch {
      return;
    }
    if (chunk.error) throw new DomainError("PROVIDER_ERROR", chunk.error.message ?? "Provider error", 502);
    const candidate = chunk.candidates?.[0];
    const piece = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    if (piece) {
      content += piece;
      notifyDelta(onDelta, content);
    }
    finish = candidate?.finishReason ?? finish;
    usage.inputUnits = chunk.usageMetadata?.promptTokenCount ?? usage.inputUnits;
    usage.outputUnits = chunk.usageMetadata?.candidatesTokenCount ?? usage.outputUnits;
  });
  if (finish === "MAX_TOKENS") throw truncatedError("finishReason=MAX_TOKENS");
  if (finish === null) throw truncatedError("stream ended without completion");
  if (!content) throw new DomainError("PROVIDER_BAD_RESPONSE", "Provider returned no candidates", 502);
  return { text: content, usage, raw: { streamed: true, finish_reason: finish } };
}
