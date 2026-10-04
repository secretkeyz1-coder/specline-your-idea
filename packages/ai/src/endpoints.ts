/**
 * One place that knows each native provider's default origin, API version path
 * and credential header. Generation and model listing both derive their URLs
 * from here, so a base URL typed with or without the version segment
 * (`https://api.anthropic.com` vs `…/v1`) works for both — previously one of the
 * two always broke (404 on list, or `/v1/v1/messages` on generate).
 */

const DEFAULT_BASE: Record<string, string> = {
  OPENAI: "https://api.openai.com/v1",
  ANTHROPIC: "https://api.anthropic.com",
  GEMINI: "https://generativelanguage.googleapis.com",
};

function trimSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

/** Provider origin without a trailing API-version segment (native providers). */
function nativeOrigin(providerType: "ANTHROPIC" | "GEMINI", baseUrl: string | null | undefined): string {
  const base = trimSlashes(baseUrl?.trim() || DEFAULT_BASE[providerType]!);
  return providerType === "ANTHROPIC" ? base.replace(/\/v1$/i, "") : base.replace(/\/v1(beta)?$/i, "");
}

export function anthropicMessagesUrl(baseUrl: string | null | undefined): string {
  return `${nativeOrigin("ANTHROPIC", baseUrl)}/v1/messages`;
}

export function geminiGenerateUrl(baseUrl: string | null | undefined, modelId: string): string {
  return `${nativeOrigin("GEMINI", baseUrl)}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
}

/** streamGenerateContent as server-sent events (a live preview of the answer). */
export function geminiStreamUrl(baseUrl: string | null | undefined, modelId: string): string {
  return `${nativeOrigin("GEMINI", baseUrl)}/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse`;
}

export function openAiBase(baseUrl: string | null | undefined): string {
  return trimSlashes(baseUrl?.trim() || DEFAULT_BASE["OPENAI"]!);
}

/**
 * The scheme+host+port requests of a connection go to: its base URL, or the
 * native provider's default when it has none. Null when there is no usable
 * URL (a custom endpoint without one, a CLI target).
 */
export function effectiveOrigin(providerType: string, baseUrl: string | null | undefined): string | null {
  const raw = baseUrl?.trim() || DEFAULT_BASE[providerType];
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Model-listing URL for a provider, or null when a base URL is required but missing. */
export function modelsUrl(providerType: string, baseUrl: string | null | undefined): string | null {
  if (providerType === "ANTHROPIC") return `${nativeOrigin("ANTHROPIC", baseUrl)}/v1/models`;
  if (providerType === "GEMINI") return `${nativeOrigin("GEMINI", baseUrl)}/v1beta/models`;
  if (providerType === "OPENAI") return `${openAiBase(baseUrl)}/models`;
  const base = baseUrl?.trim();
  return base ? `${trimSlashes(base)}/models` : null;
}

/**
 * Default credential header per provider when the connection does not name a
 * custom header: Anthropic expects `x-api-key`, Gemini `x-goog-api-key`, and
 * everything OpenAI-shaped a Bearer token.
 */
export function defaultAuthHeaders(providerType: string, secret: string): Record<string, string> {
  if (providerType === "ANTHROPIC") return { "x-api-key": secret };
  if (providerType === "GEMINI") return { "x-goog-api-key": secret };
  return { authorization: `Bearer ${secret}` };
}

/** Headers every request to the provider needs regardless of auth. */
export function providerStaticHeaders(providerType: string): Record<string, string> {
  return providerType === "ANTHROPIC" ? { "anthropic-version": "2023-06-01" } : {};
}
