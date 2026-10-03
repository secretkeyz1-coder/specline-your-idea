import { expect, test } from "bun:test";
import { openAiAdapter } from "../src/adapters/openai.js";
import { anthropicAdapter } from "../src/adapters/anthropic.js";
import { geminiAdapter } from "../src/adapters/gemini.js";
import { cliAdapter } from "../src/adapters/cli.js";
import type { ResolvedConnection } from "../src/types.js";

test("review screenshots reach every vision adapter and are refused by a text-only CLI", async () => {
  const received: Array<Record<string, any>> = [];
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push(await request.json() as Record<string, unknown>);
    return Response.json({ choices: [{ message: { content: "review" } }], content: [{ type: "text", text: "review" }], candidates: [{ content: { parts: [{ text: "review" }] }, finishReason: "STOP" }] });
  } });
  const connection: ResolvedConnection = { id: "test", providerType: "OPENAI", baseUrl: `http://127.0.0.1:${server.port}`, headers: {}, timeoutMs: 10000, capabilities: { structured_output: true, vision: true, streaming: false, tool_calling: false }, customHttpMapping: null, allowPrivateEgress: true, maxResponseBytes: 100000, cli: { serverEnabled: false } };
  const request = { system: "Review the screenshot", messages: [{ role: "user" as const, content: "Stock screen", images: [image] }] };
  try {
    await openAiAdapter.generateText(connection, "fake", { stream: false }, request);
    await anthropicAdapter.generateText({ ...connection, providerType: "ANTHROPIC" }, "fake", {}, request);
    await geminiAdapter.generateText({ ...connection, providerType: "GEMINI" }, "fake", {}, request);
    expect(received[0]!.messages[1].content[1].image_url.url).toBe(image);
    expect(received[1]!.messages[0].content[1].source).toEqual({ type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" });
    expect(received[2]!.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/png", data: "iVBORw0KGgo=" });
    await expect(cliAdapter.generateText({ ...connection, providerType: "LOCAL_CLI" }, "fake", {}, request)).rejects.toThrow("text-only CLI");
  } finally { server.stop(true); }
});
