import { describe, expect, test } from "bun:test";
import { adapterFor } from "../src/registry.js";
import { CLI_DISABLED, type CliPolicy, type ResolvedConnection } from "../src/types.js";

const MACHINE = "0a4b0f5e-1111-4222-8333-944455556666";

function conn(baseUrl: string, cli: CliPolicy): ResolvedConnection {
  return {
    id: "c1",
    providerType: "LOCAL_CLI",
    baseUrl,
    headers: {},
    timeoutMs: 60_000,
    capabilities: { structured_output: true, tool_calling: false, vision: false, streaming: false },
    customHttpMapping: null,
    allowPrivateEgress: false,
    maxResponseBytes: 1_000_000,
    cli,
  };
}

const request = { system: "Reply with JSON.", messages: [{ role: "user" as const, content: "Plan it." }] };

describe("LOCAL_CLI adapter", () => {
  test("refuses to run on the server unless the operator turned it on", async () => {
    const error = await adapterFor("LOCAL_CLI")
      .generateText(conn("cli://server/claude", CLI_DISABLED), "sonnet", {}, request)
      .catch((e) => e);
    expect(error.code).toBe("LOCAL_CLI_DISABLED");
  });

  test("sends machine runs to the machine with the prompt, system and model — nothing else", async () => {
    const jobs: unknown[] = [];
    const policy: CliPolicy = {
      serverEnabled: false,
      runOnMachine: async (machineId, job) => {
        jobs.push({ machineId, ...job });
        return { text: '{"ok":true}', inputTokens: 5, outputTokens: 3, costUsd: null, durationMs: 42 };
      },
    };
    const res = await adapterFor("LOCAL_CLI").generateText(conn(`cli://machine/${MACHINE}/codex`, policy), "default", {}, request);
    expect(res.text).toBe('{"ok":true}');
    expect(res.usage).toEqual({ inputUnits: 5, outputUnits: 3 });
    expect(jobs).toEqual([
      { machineId: MACHINE, tool: "codex", system: "Reply with JSON.", prompt: "Plan it.", model: "", timeoutMs: 60_000, maxOutputBytes: 1_000_000 },
    ]);
  });

  test("Codex never runs on the server, even when server CLIs are on", async () => {
    const error = await adapterFor("LOCAL_CLI")
      .generateText(conn("cli://server/codex", { serverEnabled: true }), "default", {}, request)
      .catch((e) => e);
    expect(error.code).toBe("LOCAL_CLI_NOT_ALLOWED");
  });

  test("a model name that is not a plain id never reaches a CLI", async () => {
    const jobs: unknown[] = [];
    const policy: CliPolicy = {
      serverEnabled: true,
      runOnMachine: async (_machineId, job) => {
        jobs.push(job);
        return { text: "{}", inputTokens: null, outputTokens: null, costUsd: null, durationMs: 1 };
      },
    };
    for (const model of ["--dangerously-skip-permissions", "sonnet --tools Bash", "a;rm -rf /", "x".repeat(101)]) {
      const error = await adapterFor("LOCAL_CLI").generateText(conn(`cli://machine/${MACHINE}/claude`, policy), model, {}, request).catch((e) => e);
      expect(error.code).toBe("CLI_INVALID_MODEL");
    }
    expect(jobs).toEqual([]);
    await adapterFor("LOCAL_CLI").generateText(conn(`cli://machine/${MACHINE}/claude`, policy), "claude-sonnet-4.5:latest", {}, request);
    expect(jobs).toHaveLength(1);
  });

  test("a connection without a valid target is a configuration error", async () => {
    const error = await adapterFor("LOCAL_CLI")
      .generateText(conn("https://example.com", CLI_DISABLED), "x", {}, request)
      .catch((e) => e);
    expect(error.code).toBe("PROVIDER_MISCONFIGURED");
  });
});
