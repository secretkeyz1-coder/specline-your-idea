import type { ProviderAdapter, TextResponse } from "../types.js";
import { DomainError } from "@sdd/shared";
import { guardedFetch, readCapped } from "../ssrf.js";
import { providerError, toNumber } from "./openai.js";

/**
 * Generic custom HTTP adapter (T027, FR-153/162).
 *
 * Declarative mapping only — this adapter never evaluates user code or
 * expressions. The template may reference a FIXED allowlist of variables:
 *   {{model}} {{system}} {{messages}} {{temperature}} {{max_tokens}}
 * A value that is exactly one variable receives the raw JSON value; otherwise
 * the variable is string-interpolated ({{messages}} interpolates as JSON).
 * Responses are extracted with a JSON pointer (RFC 6901 subset).
 */

const ALLOWED_VARIABLES = new Set(["model", "system", "messages", "temperature", "max_tokens"]);

export const customHttpAdapter: ProviderAdapter = {
  providerTypes: ["CUSTOM_HTTP"],

  async generateText(conn, modelId, parameters, request): Promise<TextResponse> {
    if (request.messages.some(m => m.images?.length)) throw new DomainError("VISION_UNSUPPORTED", "Custom HTTP mapping has no screenshot input. Use a vision-capable REVIEW profile or a human reviewer.", 409);
    const mapping = conn.customHttpMapping;
    if (!mapping) {
      throw new DomainError("PROVIDER_MISCONFIGURED", "Custom HTTP provider has no request mapping", 400);
    }
    const base = (conn.baseUrl ?? "").replace(/\/+$/, "");
    if (!base) throw new DomainError("PROVIDER_MISCONFIGURED", "Custom HTTP provider requires base_url", 400);
    const url = `${base}${mapping.path.startsWith("/") ? mapping.path : `/${mapping.path}`}`;

    const variables = buildVariables(modelId, parameters, request);
    const body = substituteTemplate(mapping.request_json_template, variables);

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...mapping.headers,
      ...conn.headers,
    };

    const response = await guardedFetch(url, {
      method: mapping.method,
      headers,
      body: mapping.method === "POST" ? JSON.stringify(body) : undefined,
      timeoutMs: conn.timeoutMs,
      maxBytes: conn.maxResponseBytes,
      allowPrivateEgress: conn.allowPrivateEgress,
    });
    const text = await readCapped(response, conn.maxResponseBytes);
    if (!response.ok) throw providerError(response.status, text);

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON endpoints: treat the whole body as the text response.
      return { text, usage: { inputUnits: null, outputUnits: null } };
    }
    const extracted = extractPointer(payload, mapping.text_response_pointer);
    if (typeof extracted !== "string") {
      throw new DomainError(
        "PROVIDER_BAD_RESPONSE",
        `Response pointer ${mapping.text_response_pointer} did not yield text`,
        502,
      );
    }
    return { text: extracted, usage: { inputUnits: null, outputUnits: null } };
  },
};

function buildVariables(
  modelId: string,
  parameters: Record<string, unknown>,
  request: { system: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number },
): Record<string, unknown> {
  return {
    model: modelId,
    system: request.system,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: request.temperature ?? toNumber(parameters["temperature"]) ?? 0.4,
    max_tokens: request.maxTokens ?? toNumber(parameters["max_tokens"]) ?? 4096,
  };
}

function substituteTemplate(
  template: Record<string, string>,
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (const [path, rawExpression] of Object.entries(template)) {
    const { key, remainder } = splitPath(path);
    if (!ALLOWED_VARIABLES.has(key)) {
      throw new DomainError(
        "PROVIDER_MISCONFIGURED",
        `Template variable "${key}" is not in the allowlist (${[...ALLOWED_VARIABLES].join(", ")})`,
        400,
      );
    }
    const whole = rawExpression.trim().match(/^\{\{\s*([a-z_]+)\s*\}\}$/);
    let value: unknown;
    if (whole && ALLOWED_VARIABLES.has(whole[1]!)) {
      value = variables[whole[1]!];
    } else {
      value = rawExpression.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) => {
        if (!ALLOWED_VARIABLES.has(name)) {
          throw new DomainError("PROVIDER_MISCONFIGURED", `Template variable "${name}" is not allowed`, 400);
        }
        const v = variables[name];
        return typeof v === "string" ? v : JSON.stringify(v);
      });
    }
    assignPath(out, remainder ? `${key}.${remainder}` : key, value);
  }
  return out;
}

/** Split "messages.0.content" → {key: "messages", remainder: "0.content"} */
function splitPath(path: string): { key: string; remainder: string } {
  const dot = path.indexOf(".");
  if (dot === -1) return { key: path, remainder: "" };
  return { key: path.slice(0, dot), remainder: path.slice(dot + 1) };
}

const RESERVED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function assignPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  if (segments.some((s) => RESERVED_SEGMENTS.has(s))) {
    // Defense in depth: the contract schema already rejects these paths.
    throw new DomainError("PROVIDER_MISCONFIGURED", `Template path "${path}" targets a reserved property`, 400);
  }
  let node: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (!Object.hasOwn(node, seg) || typeof node[seg] !== "object" || node[seg] === null) {
      Object.defineProperty(node, seg, { value: Object.create(null), enumerable: true, writable: true, configurable: true });
    }
    node = node[seg] as Record<string, unknown>;
  }
  Object.defineProperty(node, segments[segments.length - 1]!, { value, enumerable: true, writable: true, configurable: true });
}

/** RFC 6901 JSON pointer, e.g. "/result/answer" or "/choices/0/message/content". */
export function extractPointer(payload: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  const segments = pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = payload;
  for (const seg of segments) {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) {
      const idx = Number.parseInt(seg, 10);
      if (Number.isNaN(idx)) return undefined;
      node = node[idx];
    } else if (typeof node === "object") {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return node;
}
