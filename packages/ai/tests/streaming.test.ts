import { afterAll, describe, expect, test } from "bun:test";
import { DomainError } from "@sdd/shared";
import { CLI_DISABLED, type ResolvedConnection } from "../src/types.js";
import { adapterFor } from "../src/registry.js";

/**
 * Live previews (`onDelta`): each native streaming API hands the answer so far
 * to the caller as it arrives, and still returns the whole answer. Without
 * `onDelta`, Anthropic and Gemini keep their single JSON response.
 */

const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const seen: Array<{ path: string; stream: unknown }> = [];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const body = (await req.json()) as { stream?: boolean };
    seen.push({ path: url.pathname + url.search, stream: body.stream });
    if (url.pathname === "/v1/messages" || url.pathname === "/cut/v1/messages") {
      if (!body.stream) return Response.json({ content: [{ type: "text", text: "whole" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 1 } });
      return sse([
        { type: "message_start", message: { usage: { input_tokens: 5 } } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "<main>" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "<h1>Hi</h1>" } },
        { type: "message_delta", delta: { stop_reason: url.pathname.startsWith("/cut") ? "max_tokens" : "end_turn" }, usage: { output_tokens: 7 } },
        { type: "message_stop" },
      ]);
    }
    if (url.pathname === "/v1beta/models/m:streamGenerateContent") {
      return sse([
        { candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "<main>" }] } }] },
        { candidates: [{ content: { parts: [{ text: "<h1>Hi</h1>" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 } },
      ]);
    }
    if (url.pathname === "/v1beta/models/m:generateContent") {
      return Response.json({ candidates: [{ content: { parts: [{ text: "whole" }] }, finishReason: "STOP" }] });
    }
    return new Response("not found", { status: 404 });
  },
});
afterAll(() => server.stop(true));

// The "[DONE]" sentinel is a bare string on the wire, not JSON.
const openAiServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch() {
    const chunk = (content: string, finish: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;
    return new Response(`${chunk("<main>")}${chunk("<h1>Hi</h1>", "stop")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  },
});
afterAll(() => openAiServer.stop(true));

function conn(providerType: ResolvedConnection["providerType"], baseUrl: string): ResolvedConnection {
  return {
    id: "c",
    providerType,
    baseUrl,
    headers: {},
    timeoutMs: 5000,
    capabilities: { structured_output: false, tool_calling: false, vision: false, streaming: true },
    customHttpMapping: null,
    allowPrivateEgress: true,
    maxResponseBytes: 1_000_000,
    cli: CLI_DISABLED,
  };
}

const request = (onDelta?: (t: string) => void) => ({ system: "s", messages: [{ role: "user" as const, content: "draw" }], onDelta });
const base = () => `http://127.0.0.1:${server.port}`;

describe("onDelta live previews", () => {
  test("OpenAI-compatible: the answer so far after each delta", async () => {
    const deltas: string[] = [];
    const res = await adapterFor("OPENAI_COMPATIBLE").generateText(conn("OPENAI_COMPATIBLE", `http://127.0.0.1:${openAiServer.port}/v1`), "m", {}, request((t) => deltas.push(t)));
    expect(res.text).toBe("<main><h1>Hi</h1>");
    expect(deltas).toEqual(["<main>", "<main><h1>Hi</h1>"]);
  });

  test("Anthropic streams only when a preview is wanted", async () => {
    const deltas: string[] = [];
    const res = await adapterFor("ANTHROPIC").generateText(conn("ANTHROPIC", base()), "m", {}, request((t) => deltas.push(t)));
    expect(res.text).toBe("<main><h1>Hi</h1>");
    expect(deltas).toEqual(["<main>", "<main><h1>Hi</h1>"]);
    expect(res.usage).toEqual({ inputUnits: 5, outputUnits: 7 });
    const plain = await adapterFor("ANTHROPIC").generateText(conn("ANTHROPIC", base()), "m", {}, request());
    expect(plain.text).toBe("whole");
    expect(seen.filter((s) => s.path === "/v1/messages").map((s) => s.stream)).toEqual([true, undefined]);
  });

  test("Anthropic: a streamed answer cut at max_tokens is truncation", async () => {
    const error = await adapterFor("ANTHROPIC").generateText(conn("ANTHROPIC", `${base()}/cut`), "m", {}, request(() => {})).catch((e) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("AI_OUTPUT_TRUNCATED");
  });

  test("Gemini streams with streamGenerateContent and skips thought parts", async () => {
    const deltas: string[] = [];
    const res = await adapterFor("GEMINI").generateText(conn("GEMINI", base()), "m", {}, request((t) => deltas.push(t)));
    expect(res.text).toBe("<main><h1>Hi</h1>");
    expect(deltas).toEqual(["<main>", "<main><h1>Hi</h1>"]);
    expect(res.usage).toEqual({ inputUnits: 4, outputUnits: 6 });
    const plain = await adapterFor("GEMINI").generateText(conn("GEMINI", base()), "m", {}, request());
    expect(plain.text).toBe("whole");
    expect(seen.some((s) => s.path === "/v1beta/models/m:streamGenerateContent?alt=sse")).toBe(true);
  });

  test("a listener that throws never fails the call", async () => {
    const res = await adapterFor("GEMINI").generateText(conn("GEMINI", base()), "m", {}, request(() => {
      throw new Error("preview broke");
    }));
    expect(res.text).toBe("<main><h1>Hi</h1>");
  });
});
