import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { toJsonSchema } from "@sdd/contracts";
import { DomainError } from "@sdd/shared";
import { assertCliTargetAllowed, originChanged, testFailureSummary, type ResolvedConnection } from "../src/index.js";
import { openAiRequestBody, providerError } from "../src/adapters/openai.js";
import { customHttpAdapter } from "../src/adapters/customHttp.js";

/** Pure rules behind the provider-connection hardening (no network, no database). */

const MACHINE = "0a4b0f5e-1111-4222-8333-944455556666";

describe("server-side CLI targets", () => {
  test("only Claude Code, and only on an operator's SYSTEM connection", () => {
    expect(() => assertCliTargetAllowed("cli://server/claude", "SYSTEM")).not.toThrow();
    expect(() => assertCliTargetAllowed("cli://server/claude", "WORKSPACE")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    // Codex reads files through its read-only sandbox: never on the server.
    expect(() => assertCliTargetAllowed("cli://server/codex", "SYSTEM")).toThrow(expect.objectContaining({ code: "LOCAL_CLI_NOT_ALLOWED" }));
    // A person's own machine keeps both tools (ownership is checked by the API).
    expect(() => assertCliTargetAllowed(`cli://machine/${MACHINE}/codex`, "WORKSPACE")).not.toThrow();
    expect(() => assertCliTargetAllowed("https://example.com", "SYSTEM")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });
});

describe("re-pointing a connection", () => {
  test("a new scheme, host or port is a new origin; a new path is not", () => {
    expect(originChanged("OPENAI_COMPATIBLE", "https://gw.example.com/v1", "https://gw.example.com/v2")).toBe(false);
    expect(originChanged("OPENAI_COMPATIBLE", "https://gw.example.com/v1", "https://evil.example.net/v1")).toBe(true);
    expect(originChanged("OPENAI_COMPATIBLE", "https://gw.example.com/v1", "http://gw.example.com/v1")).toBe(true);
    expect(originChanged("OPENAI_COMPATIBLE", "https://gw.example.com/v1", "https://gw.example.com:8443/v1")).toBe(true);
    expect(originChanged("OPENAI_COMPATIBLE", "https://gw.example.com:443/v1", "https://GW.example.com/v1/")).toBe(false);
  });

  test("a native provider without a base URL is its default origin", () => {
    expect(originChanged("OPENAI", null, "https://api.openai.com/v1")).toBe(false);
    expect(originChanged("OPENAI", null, "https://proxy.example.com/v1")).toBe(true);
    expect(originChanged("ANTHROPIC", "https://api.anthropic.com/v1", null)).toBe(false);
    expect(originChanged("CUSTOM_HTTP", null, "https://x.example.com")).toBe(true);
    expect(originChanged("LOCAL_CLI", "cli://server/claude", `cli://machine/${MACHINE}/claude`)).toBe(false);
  });
});

describe("connection test answers", () => {
  test("carry the status and error code, never the provider's text", () => {
    const leaked = providerError(500, "<html>root:x:0:0:root:/root:/bin/bash</html>");
    expect(leaked.message).toBe("Provider HTTP 500");
    expect(testFailureSummary(leaked)).toEqual({ code: "PROVIDER_ERROR", message: "Provider answered HTTP 500" });

    const json = providerError(401, JSON.stringify({ error: { message: "Incorrect API key sk-live-abc", code: "invalid_api_key" } }));
    const summary = testFailureSummary(json);
    expect(summary).toEqual({ code: "PROVIDER_ERROR", message: "Provider answered HTTP 401 (invalid_api_key)" });
    expect(JSON.stringify(summary)).not.toContain("sk-live");

    const odd = providerError(418, JSON.stringify({ error: { message: "x", code: "<script>" } }));
    expect(testFailureSummary(odd).message).toBe("Provider answered HTTP 418");

    const transport = new DomainError("PROVIDER_UNREACHABLE", "AI provider request failed: connect ECONNREFUSED 10.1.2.3:443", 502);
    expect(testFailureSummary(transport).message).not.toContain("10.1.2.3");
    expect(testFailureSummary(new Error("boom"))).toEqual({ code: "PROVIDER_ERROR", message: "The test request failed" });
    // The control plane's own messages stay useful.
    const egress = new DomainError("EGRESS_BLOCKED", "Blocked AI endpoint: Private network target refused: gw.internal", 400);
    expect(testFailureSummary(egress).message).toBe(egress.message);
  });
});

describe("OpenAI request body", () => {
  const conn = (providerType: "OPENAI" | "OPENAI_COMPATIBLE", structured = true) =>
    ({
      id: "c",
      providerType,
      baseUrl: null,
      headers: {},
      timeoutMs: 1000,
      capabilities: { structured_output: structured, tool_calling: false, vision: false, streaming: false },
      customHttpMapping: null,
      allowPrivateEgress: false,
      maxResponseBytes: 1000,
      cli: { serverEnabled: false },
    }) as ResolvedConnection;
  const request = { system: "Reply with JSON.", messages: [{ role: "user" as const, content: "hi" }] };

  test("temperature only when the caller or the profile sets one", () => {
    expect(openAiRequestBody(conn("OPENAI"), "o4", {}, request)).not.toHaveProperty("temperature");
    expect(openAiRequestBody(conn("OPENAI"), "gpt", { temperature: 0.2 }, request).temperature).toBe(0.2);
    expect(openAiRequestBody(conn("OPENAI"), "gpt", { temperature: 0.2 }, { ...request, temperature: 0 }).temperature).toBe(0);
  });

  test("JSON mode for structured runs on OpenAI; compatible gateways only when the profile opts in", () => {
    const structured = { ...request, jsonMode: true };
    expect(openAiRequestBody(conn("OPENAI"), "gpt", {}, structured).response_format).toEqual({ type: "json_object" });
    expect(openAiRequestBody(conn("OPENAI"), "gpt", {}, request)).not.toHaveProperty("response_format");
    expect(openAiRequestBody(conn("OPENAI", false), "gpt", {}, structured)).not.toHaveProperty("response_format");
    expect(openAiRequestBody(conn("OPENAI_COMPATIBLE"), "m", {}, structured)).not.toHaveProperty("response_format");
    expect(openAiRequestBody(conn("OPENAI_COMPATIBLE"), "m", { json_mode: true }, structured).response_format).toEqual({ type: "json_object" });
  });
});

describe("custom HTTP own-property JSON construction", () => {
  const request = { system: "system", messages: [{ role: "user" as const, content: "hello" }] };
  const connection = (template: Record<string, string>, baseUrl: string): ResolvedConnection => ({
    id: "custom", providerType: "CUSTOM_HTTP", baseUrl, headers: {}, timeoutMs: 1000,
    capabilities: { structured_output: false, tool_calling: false, vision: false, streaming: false },
    customHttpMapping: { method: "POST", path: "/", headers: {}, request_json_template: template, text_response_pointer: "/text" },
    allowPrivateEgress: true, maxResponseBytes: 4096, cli: { serverEnabled: false },
  });
  test("rejects every prototype segment before any network request", async () => {
    for (const path of ["model.__proto__.polluted", "model.prototype.polluted", "model.constructor.prototype.polluted", "model.x.__proto__"]) {
      await expect(customHttpAdapter.generateText(connection({ [path]: "{{model}}" }, "http://127.0.0.1:1"), "value", {}, request)).rejects.toMatchObject({ code: "PROVIDER_MISCONFIGURED" });
    }
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
  test("inherited-looking names are ordinary own JSON fields, including nested values", async () => {
    let received: unknown;
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
      received = await req.json();
      return Response.json({ text: "ok" });
    } });
    try {
      const template = { "model.toString.value": "{{model}}", "system.hasOwnProperty": "{{system}}", "messages.0.content": "hello" };
      const result = await customHttpAdapter.generateText(connection(template, `http://127.0.0.1:${server.port}`), "m", {}, request);
      expect(result.text).toBe("ok");
      expect(received).toEqual({ model: { toString: { value: "m" } }, system: { hasOwnProperty: "system" }, messages: { "0": { content: "hello" } } });
      expect(Object.hasOwn(Object.prototype, "value")).toBe(false);
    } finally { server.stop(true); }
  });
});

describe("structured-output JSON Schema", () => {
  test("fields with a default are optional for the model", () => {
    const schema = z.object({ title: z.string(), notes: z.array(z.string()).default([]) });
    expect((toJsonSchema(schema) as { required?: string[] }).required).toEqual(["title"]);
  });
});
