import { describe, expect, test } from "bun:test";
import { DomainError } from "@sdd/shared";
import { checkEgress } from "../src/index.js";
import { parseJsonLoose, parseSseText } from "../src/adapters/openai.js";
import { anthropicMessagesUrl, defaultAuthHeaders, geminiGenerateUrl, modelsUrl } from "../src/endpoints.js";

/** Regression tests for the AI-layer audit fixes (parsing, streaming, egress, endpoints). */

const codeOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof DomainError ? error.code : `RAW:${(error as Error).name}`;
  }
};

describe("parseJsonLoose", () => {
  test("keeps a bare JSON object whose string values contain code fences", () => {
    const design = { data_model: "```sql\nCREATE TABLE t (id int);\n```", overview: "x" };
    expect(parseJsonLoose(JSON.stringify(design))).toEqual(design);
  });

  test("extracts a fenced json block and strips <think> sections", () => {
    expect(parseJsonLoose('<think>draft {"a":0}</think>\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test("always fails with a DomainError, never a raw SyntaxError", () => {
    expect(codeOf(() => parseJsonLoose("not json at all { nope"))).toBe("AI_OUTPUT_INVALID");
  });
});

describe("SSE parsing", () => {
  const chunk = (content: string, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}`;

  test("assembles deltas and handles a final event without trailing newline", () => {
    const text = [chunk("Hel"), "", chunk("lo", "stop")].join("\n");
    expect(parseSseText(text).text).toBe("Hello");
  });

  test("joins multi-line data fields of one event", () => {
    // One event, two data lines — joined with "\n" (valid JSON whitespace here).
    const text = 'data: {"choices":[{"delta":{"content":"ok"},\ndata: "finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    expect(parseSseText(text).text).toBe("ok");
  });

  test("CRLF line endings are accepted", () => {
    const text = `${chunk("a")}\r\n\r\n${chunk("b", "stop")}\r\n\r\ndata: [DONE]\r\n\r\n`;
    expect(parseSseText(text).text).toBe("ab");
  });

  test("finish_reason=length is reported as truncation, not success", () => {
    const text = `${chunk("{\"partial\": ", "length")}\n\n`;
    expect(codeOf(() => parseSseText(text))).toBe("AI_OUTPUT_TRUNCATED");
  });

  test("a stream that ends without [DONE] or finish_reason is truncated", () => {
    expect(codeOf(() => parseSseText(`${chunk("{\"a\":")}\n\n`))).toBe("AI_OUTPUT_TRUNCATED");
  });

  test("chain-of-thought is not accepted as the answer", () => {
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'maybe {"a":1} or {"a":2}' }, finish_reason: "stop" }] })}\n\n`;
    expect(codeOf(() => parseSseText(reasoning))).toBe("PROVIDER_BAD_RESPONSE");
  });

  test("reasoning that IS a complete JSON answer is accepted", () => {
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '{"a":1}' }, finish_reason: "stop" }] })}\n\n`;
    expect(parseSseText(reasoning).text).toBe('{"a":1}');
  });
});

describe("egress ranges added by the audit", () => {
  test("6to4 addresses embedding a private IPv4 are private", async () => {
    // 2002:0a00:0001:: embeds 10.0.0.1
    expect((await checkEgress("http://[2002:a00:1::1]/v1", false)).allowed).toBe(false);
  });

  test("Teredo, site-local and TEST-NET targets are refused in hosted posture", async () => {
    expect((await checkEgress("http://[2001:0:4136:e378::1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://[fec0::1]/", false)).allowed).toBe(false);
    expect((await checkEgress("http://192.0.2.10/", false)).allowed).toBe(false);
    expect((await checkEgress("http://203.0.113.5/", false)).allowed).toBe(false);
  });

  test("cloud metadata endpoints are refused even with private egress enabled", async () => {
    expect((await checkEgress("http://100.100.100.200/latest", true)).allowed).toBe(false);
    expect((await checkEgress("http://192.0.0.192/opc/v1", true)).allowed).toBe(false);
  });
});

describe("provider endpoints", () => {
  test("Anthropic works with or without the /v1 segment", () => {
    expect(anthropicMessagesUrl(null)).toBe("https://api.anthropic.com/v1/messages");
    expect(anthropicMessagesUrl("https://api.anthropic.com/v1/")).toBe("https://api.anthropic.com/v1/messages");
    expect(modelsUrl("ANTHROPIC", "https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1/models");
  });

  test("Gemini generation and listing share one base", () => {
    expect(geminiGenerateUrl("https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-pro")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    );
    expect(modelsUrl("GEMINI", null)).toBe("https://generativelanguage.googleapis.com/v1beta/models");
  });

  test("OpenAI-compatible requires a base URL for listing", () => {
    expect(modelsUrl("OPENAI_COMPATIBLE", null)).toBeNull();
    expect(modelsUrl("OPENAI", null)).toBe("https://api.openai.com/v1/models");
  });

  test("default credential header follows the provider", () => {
    expect(defaultAuthHeaders("ANTHROPIC", "k")).toEqual({ "x-api-key": "k" });
    expect(defaultAuthHeaders("GEMINI", "k")).toEqual({ "x-goog-api-key": "k" });
    expect(defaultAuthHeaders("OPENAI", "k")).toEqual({ authorization: "Bearer k" });
  });
});
