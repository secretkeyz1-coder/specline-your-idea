import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCliInvocation,
  CliRunError,
  CODEX_LOCKDOWN_OVERRIDES,
  detectCli,
  formatCliTarget,
  isServerCliTool,
  isValidCliModel,
  parseCliTarget,
  runCli,
} from "../src/index.js";

/**
 * A fake `claude` stands in for the real CLI: no subscription is used. It
 * echoes what it received (args, stdin, whether a server secret leaked into
 * its environment) inside Claude Code's JSON result shape.
 */
const dir = mkdtempSync(join(tmpdir(), "sdd-fake-cli-"));
const script = join(dir, "fake-claude.ts");
writeFileSync(
  script,
  `
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Fake Claude)"); process.exit(0); }
if (args[0] === "auth") process.exit(process.env.FAKE_SIGNED_OUT ? 1 : 0);
const stdin = await new Response(Bun.stdin.stream()).text();
if (stdin.includes("SLEEP")) await Bun.sleep(10_000);
if (stdin.includes("CRASH")) { console.error("boom: please log in again"); process.exit(3); }
const sysIdx = args.indexOf("--system-prompt-file");
const system = sysIdx >= 0 ? await Bun.file(args[sysIdx + 1]).text() : "";
console.log(JSON.stringify({
  type: "result", subtype: "success", is_error: false,
  result: JSON.stringify({ stdin, system, tools: args[args.indexOf("--tools") + 1], model: args.includes("--model") ? args[args.indexOf("--model") + 1] : null, leaked: Boolean(process.env.DATABASE_URL), cwd: process.cwd() }),
  usage: { input_tokens: 11, output_tokens: 7 }, total_cost_usd: 0.001,
}));
`,
);
let bin: string;
const saved = { bin: process.env.SDD_CLAUDE_BIN, db: process.env.DATABASE_URL };

beforeAll(() => {
  if (process.platform === "win32") {
    bin = join(dir, "fake-claude.cmd");
    writeFileSync(bin, `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    bin = join(dir, "fake-claude.sh");
    writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(bin, 0o755);
  }
  process.env.SDD_CLAUDE_BIN = bin;
  process.env.DATABASE_URL = "postgres://secret@db/prod";
});

afterAll(() => {
  if (saved.bin === undefined) delete process.env.SDD_CLAUDE_BIN;
  else process.env.SDD_CLAUDE_BIN = saved.bin;
  if (saved.db === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved.db;
  rmSync(dir, { recursive: true, force: true });
});

describe("bounded CLI watchdog", () => {
  async function withProcess(check: (state: {
    tick: (elapsed: number) => void;
    finish: () => void;
    failRead: () => void;
    succeed: () => void;
    overflow: () => void;
    run: (timeoutMs: number, maxOutputBytes?: number) => Promise<unknown>;
    killed: () => number;
    scheduled: () => number[];
    cleared: () => number;
    spawned: () => number;
  }) => Promise<void>) {
    let now = 100;
    let callback: (() => void) | undefined;
    const delays: number[] = [];
    let clears = 0;
    let kills = 0;
    let spawns = 0;
    let resolveExit!: (code: number) => void;
    let stdout!: ReadableStreamDefaultController<Uint8Array>;
    let stderr!: ReadableStreamDefaultController<Uint8Array>;
    const exited = new Promise<number>(resolve => { resolveExit = resolve; });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { stdout.close(); } catch { /* stream already failed */ }
      try { stderr.close(); } catch { /* stream already closed */ }
      resolveExit(0);
    };
    const proc = {
      pid: 99999999,
      stdout: new ReadableStream<Uint8Array>({ start(controller) { stdout = controller; } }),
      stderr: new ReadableStream<Uint8Array>({ start(controller) { stderr = controller; } }),
      exited,
      kill() { kills++; finish(); },
    };
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const interval = spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, delay: number) => {
      callback = fn;
      delays.push(delay);
      return 123;
    }) as never);
    const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => { clears++; });
    const spawn = spyOn(Bun, "spawn").mockImplementation(((cmd: string[]) => {
      if (cmd[0] === "taskkill") return { exited: Promise.resolve(0) };
      spawns++;
      return proc;
    }) as never);
    try {
      await check({
        tick(elapsed) { now = 100 + elapsed; callback?.(); },
        finish,
        failRead() { stdout.error(new Error("read failed")); finish(); },
        succeed() { stdout.enqueue(new TextEncoder().encode(JSON.stringify({ result: "ok" }))); finish(); },
        overflow() { stdout.enqueue(new Uint8Array(5)); },
        run: (timeoutMs, maxOutputBytes = 4) => runCli("claude", { system: "", prompt: "hello", timeoutMs, maxOutputBytes }).catch(error => error),
        killed: () => kills,
        scheduled: () => delays,
        cleared: () => clears,
        spawned: () => spawns,
      });
    } finally {
      finish();
      spawn.mockRestore();
      clear.mockRestore();
      interval.mockRestore();
      clock.mockRestore();
    }
  }

  test.each([-1, 0, 999, 1000, 1500, 1_800_000, Number.MAX_SAFE_INTEGER])("timeout %s uses one fixed timer and expires at its clamped deadline", async timeoutMs => {
    await withProcess(async state => {
      const result = state.run(timeoutMs);
      expect(state.scheduled()).toEqual([100]);
      const deadline = Math.max(1000, Math.min(1_800_000, timeoutMs));
      state.tick(deadline - 1);
      expect(state.killed()).toBe(0);
      state.tick(deadline);
      const error = await result as CliRunError;
      expect(error.code).toBe("TIMEOUT");
      expect(state.killed()).toBe(1);
      expect(state.cleared()).toBe(1);
      state.tick(deadline + 100);
      expect(state.killed()).toBe(1);
      expect(state.scheduled()).toEqual([100]);
    });
  });

  test.each([NaN, Infinity, -Infinity, 1000.5])("invalid timeout %s starts neither process nor watchdog", async timeoutMs => {
    await withProcess(async state => {
      expect((await state.run(timeoutMs) as CliRunError).code).toBe("SPAWN_FAILED");
      expect(state.spawned()).toBe(0);
      expect(state.scheduled()).toEqual([]);
    });
  });

  test("successful completion clears the watchdog", async () => {
    await withProcess(async state => {
      const result = state.run(20_000, 100);
      state.succeed();
      expect((await result as { text: string }).text).toBe("ok");
      expect(state.cleared()).toBe(1);
      expect(state.killed()).toBe(0);
    });
  });

  test.each(["exit", "read error", "output cap"])("clears the watchdog on %s", async mode => {
    await withProcess(async state => {
      const result = state.run(20_000);
      if (mode === "read error") state.failRead();
      else if (mode === "output cap") state.overflow();
      else state.finish();
      const error = await result as Error & { code?: string };
      expect(mode === "read error" ? error.message : error.code).toBe(mode === "read error" ? "read failed" : mode === "output cap" ? "OUTPUT_TOO_LARGE" : "FAILED");
      expect(state.cleared()).toBe(1);
      expect(state.killed()).toBe(mode === "output cap" ? 1 : 0);
    });
  });
});

describe("local CLI runner", () => {
  test("direct package callers cannot bypass finite integer timeout validation", async () => {
    for (const timeoutMs of [NaN, Infinity, -Infinity, 1000.5]) {
      const error = await runCli("claude", { system: "", prompt: "hello", timeoutMs }).catch(e => e);
      expect(error).toBeInstanceOf(CliRunError);
      expect(error.message).toContain("finite integer");
    }
  });

  test("out-of-range integer timeouts clamp to the bounded package range", async () => {
    const result = await runCli("claude", { system: "", prompt: "hello", timeoutMs: Number.MAX_SAFE_INTEGER });
    expect(JSON.parse(result.text).stdin).toBe("hello");
    const start = Date.now();
    const error = await runCli("claude", { system: "", prompt: "SLEEP", timeoutMs: -1 }).catch(e => e);
    expect(error.code).toBe("TIMEOUT");
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
    expect(Date.now() - start).toBeLessThan(8000);
  });
  test("runs with no tools, the prompt on stdin and the system prompt from a file", async () => {
    const res = await runCli("claude", { system: "Return JSON.", prompt: "hello there", model: "haiku", timeoutMs: 20_000 });
    const seen = JSON.parse(res.text);
    expect(seen.stdin).toBe("hello there");
    expect(seen.system).toBe("Return JSON.");
    expect(seen.tools).toBe("");
    expect(seen.model).toBe("haiku");
    expect(res.inputTokens).toBe(11);
    expect(res.costUsd).toBe(0.001);
  });

  test("never hands the server's secrets to the CLI, and runs in a throwaway folder", async () => {
    const seen = JSON.parse((await runCli("claude", { system: "", prompt: "x", timeoutMs: 20_000 })).text);
    expect(seen.leaked).toBe(false);
    expect(String(seen.cwd)).toContain("sdd-cli-");
  });

  test("a failing CLI is reported with its message, a sign-in problem as NOT_SIGNED_IN", async () => {
    const error = await runCli("claude", { system: "", prompt: "CRASH", timeoutMs: 20_000 }).catch((e) => e);
    expect(error).toBeInstanceOf(CliRunError);
    expect(error.code).toBe("NOT_SIGNED_IN");
    expect(error.message).toContain("code 3");
  });

  test("a CLI that runs past the limit is killed", async () => {
    const started = Date.now();
    const error = await runCli("claude", { system: "", prompt: "SLEEP", timeoutMs: 1_500 }).catch((e) => e);
    expect(error.code).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test("detects the version and the sign-in state", async () => {
    const found = await detectCli("claude");
    expect(found.installed).toBe(true);
    expect(found.version).toBe("9.9.9 (Fake Claude)");
    expect(found.auth).toBe("ok");
  });
});

describe("locked-down invocations", () => {
  test("Codex runs without the user's config.toml (MCP servers), plugins, apps or a shell", () => {
    const cwd = mkdtempSync(join(tmpdir(), "sdd-codex-args-"));
    try {
      const { args, stdin } = buildCliInvocation("codex", { system: "Reply with JSON.", prompt: "Plan it.", model: "gpt-5", timeoutMs: 1000 }, cwd);
      expect(args[0]).toBe("exec");
      expect(args).toContain("--ignore-user-config");
      expect(CODEX_LOCKDOWN_OVERRIDES).toEqual(["features.plugins=false", "features.apps=false", "features.shell_tool=false"]);
      for (const override of CODEX_LOCKDOWN_OVERRIDES) expect(args[args.indexOf(override) - 1]).toBe("-c");
      expect(args.slice(args.indexOf("--sandbox"), args.indexOf("--sandbox") + 2)).toEqual(["--sandbox", "read-only"]);
      expect(args.slice(args.indexOf("-m"), args.indexOf("-m") + 2)).toEqual(["-m", "gpt-5"]);
      expect(args.at(-1)).toBe("-");
      expect(stdin).toContain("Plan it.");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("only Claude Code may run on the server", () => {
    expect(isServerCliTool("claude")).toBe(true);
    expect(isServerCliTool("codex")).toBe(false);
  });

  test("model names are plain ids; anything else is refused before a process starts", async () => {
    for (const ok of ["sonnet", "default", "claude-sonnet-4.5", "gpt-5.1-codex", "openai/gpt-oss:20b"]) expect(isValidCliModel(ok)).toBe(true);
    for (const bad of ["", "--tools=Bash", "-m", "sonnet --tools Bash", "a;b", "a\nb", "x".repeat(101)]) expect(isValidCliModel(bad)).toBe(false);
    const error = await runCli("claude", { system: "", prompt: "x", model: "--dangerously-skip-permissions", timeoutMs: 20_000 }).catch((e) => e);
    expect(error).toBeInstanceOf(CliRunError);
    expect(error.code).toBe("INVALID_MODEL");
  });
});

describe("CLI targets", () => {
  test("round-trip and reject anything else", () => {
    const id = "0a4b0f5e-1111-4222-8333-944455556666";
    expect(parseCliTarget("cli://server/claude")).toEqual({ where: "server", tool: "claude" });
    expect(parseCliTarget(`cli://machine/${id}/codex`)).toEqual({ where: "machine", machineId: id, tool: "codex" });
    expect(formatCliTarget({ where: "machine", machineId: id, tool: "codex" })).toBe(`cli://machine/${id}/codex`);
    expect(parseCliTarget("cli://server/rm")).toBeNull();
    expect(parseCliTarget("https://example.com")).toBeNull();
    expect(parseCliTarget("cli://machine/not-a-uuid/claude")).toBeNull();
  });
});
