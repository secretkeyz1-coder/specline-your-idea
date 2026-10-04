import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A locally installed coding-agent CLI used as a plain text model.
 *
 * The planning prompts need text (JSON) back, not an agent that edits files,
 * so every run is locked down — unlike an agent working on a repository:
 * - a fresh, empty temporary working directory, deleted afterwards;
 * - no tools (Claude Code `--tools ""` and no MCP servers; Codex without its
 *   shell tool, plugins, apps or the user's config.toml — see below — inside a
 *   read-only sandbox), no session saved;
 * - the prompt goes through stdin and the system prompt through a file,
 *   never the command line;
 * - an allowlisted environment, so the server's own secrets never reach it;
 * - a hard timeout that kills the whole process tree, and an output cap.
 *
 * The CLI signs in with its own login (subscription or key) on the machine
 * it runs on; no credential is ever passed to it from the control plane.
 * Command lines checked against the Claude Code and Codex CLI references
 * (September 2026).
 */

export type CliToolId = "claude" | "codex";

export interface CliRunInput {
  system: string;
  prompt: string;
  /** Model name the CLI understands; empty uses the CLI's own default. */
  model?: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface CliRunResult {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
}

export type CliErrorCode =
  | "NOT_INSTALLED"
  | "NOT_SIGNED_IN"
  | "TIMEOUT"
  | "FAILED"
  | "EMPTY_OUTPUT"
  | "OUTPUT_TOO_LARGE"
  /** The model name is not a plain model id (it would reach the CLI's argv). */
  | "INVALID_MODEL"
  /** The binary exists but could not be started (permissions, bad file). */
  | "SPAWN_FAILED"
  /** The installed CLI does not know a flag the lockdown depends on. */
  | "UNSUPPORTED_VERSION";

export class CliRunError extends Error {
  constructor(
    public code: CliErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CliDetection {
  id: CliToolId;
  name: string;
  installed: boolean;
  version: string | null;
  /** "ok" signed in · "missing" not signed in · "unknown" could not tell. */
  auth: "ok" | "missing" | "unknown";
  /** Model names to suggest in the picker (the CLI accepts others too). */
  suggestedModels: string[];
}

interface Invocation {
  args: string[];
  stdin: string;
  /** Files the CLI writes its answer to, read after it exits. */
  outputFile?: string;
}

interface CliTool {
  id: CliToolId;
  name: string;
  bins: string[];
  versionArgs: string[];
  authArgs: string[];
  suggestedModels: string[];
  build(input: CliRunInput, cwd: string): Invocation;
  parse(stdout: string, invocation: Invocation): Omit<CliRunResult, "durationMs">;
}

const TOOLS: Record<CliToolId, CliTool> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    bins: ["claude"],
    versionArgs: ["--version"],
    authArgs: ["auth", "status"],
    suggestedModels: ["sonnet", "opus", "haiku"],
    build(input, cwd) {
      // From a file: a schema-bearing system prompt can pass Windows' ~32 KB
      // command-line limit.
      const systemFile = join(cwd, "system.txt");
      writeFileSync(systemFile, input.system, "utf8");
      const args = [
        "-p",
        "--output-format",
        "json",
        "--no-session-persistence",
        // No built-in tools and no MCP servers: text in, text out.
        "--tools",
        "",
        "--strict-mcp-config",
        "--system-prompt-file",
        systemFile,
      ];
      if (input.model) args.push("--model", input.model);
      return { args, stdin: input.prompt };
    },
    parse(stdout) {
      let payload: { result?: unknown; is_error?: boolean; subtype?: string; usage?: { input_tokens?: number; output_tokens?: number }; total_cost_usd?: number };
      try {
        payload = JSON.parse(stdout.trim());
      } catch {
        throw new CliRunError("FAILED", "Claude Code did not return its JSON result");
      }
      if (payload.is_error) throw new CliRunError("FAILED", `Claude Code reported an error (${payload.subtype ?? "unknown"}): ${String(payload.result ?? "").slice(0, 300)}`);
      return {
        text: typeof payload.result === "string" ? payload.result : "",
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        costUsd: typeof payload.total_cost_usd === "number" ? payload.total_cost_usd : null,
      };
    },
  },
  codex: {
    id: "codex",
    name: "Codex CLI",
    bins: ["codex"],
    versionArgs: ["--version"],
    authArgs: ["login", "status"],
    suggestedModels: [],
    build(input, cwd) {
      const outputFile = join(cwd, "answer.txt");
      // Codex has no `--tools ""` / `--strict-mcp-config`. Its equivalents:
      // - `--ignore-user-config` skips $CODEX_HOME/config.toml, where the
      //   user's MCP servers (and profiles, hooks) live. Sign-in still comes
      //   from CODEX_HOME/auth.json, so the login keeps working. (`-c
      //   mcp_servers={}` would not do: -c layers are deep-merged, so an
      //   empty table leaves every configured server in place.)
      // - features off: `plugins` (plugin-provided MCP servers), `apps`
      //   (account connectors) and `shell_tool` — without a shell the model
      //   cannot read files either; `--sandbox read-only` only stops writes.
      // A Codex too old for `--ignore-user-config` fails closed
      // (UNSUPPORTED_VERSION) rather than running with the user's servers.
      const args = [
        "exec",
        "--skip-git-repo-check",
        "--ignore-user-config",
        ...CODEX_LOCKDOWN_OVERRIDES.flatMap((o) => ["-c", o]),
        // Belt and braces should a tool slip through: nothing may be changed.
        "--sandbox",
        "read-only",
        "--ephemeral",
        "-C",
        cwd,
        "--output-last-message",
        outputFile,
      ];
      if (input.model) args.push("-m", input.model);
      args.push("-"); // prompt from stdin
      // Codex has no system-prompt flag: the instructions lead the prompt.
      return { args, stdin: `<instructions>\n${input.system}\n</instructions>\n\n${input.prompt}`, outputFile };
    },
    parse(stdout, invocation) {
      let text = "";
      try {
        text = invocation.outputFile ? readFileSync(invocation.outputFile, "utf8") : "";
      } catch {
        text = stdout; // default mode prints only the final message on stdout
      }
      return { text: text || stdout, inputTokens: null, outputTokens: null, costUsd: null };
    },
  },
};

/** `-c` overrides that leave Codex a text model (see the codex build above). */
export const CODEX_LOCKDOWN_OVERRIDES = ["features.plugins=false", "features.apps=false", "features.shell_tool=false"] as const;

/**
 * Tools the API server may run itself (`cli://server/<tool>`). Only Claude
 * Code: it runs with `--tools ""`, so the model has no way to touch the host.
 * Codex is refused on the server — its read-only sandbox limits writes, not
 * reads, so a prompt could make it read any file the API process can (the
 * .env, keys). On a person's own machine (sdd-agent) Codex stays available:
 * there it can only read what its owner can.
 */
export const SERVER_CLI_TOOLS: readonly CliToolId[] = ["claude"];

export function isServerCliTool(tool: CliToolId): boolean {
  return SERVER_CLI_TOOLS.includes(tool);
}

/**
 * A model name handed to a CLI goes into its argv (`--model`, `-m`), so it
 * must be a plain model id — never something a CLI could read as a flag or
 * a shell could split. "default" (the CLI's own choice) passes too.
 */
export const CLI_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;

export function isValidCliModel(model: string): boolean {
  return CLI_MODEL_PATTERN.test(model) && !model.startsWith("-");
}

/** The command line a run would use — for tests; no process is started. */
export function buildCliInvocation(id: CliToolId, input: CliRunInput, cwd: string): { args: string[]; stdin: string } {
  const { args, stdin } = TOOLS[id].build(input, cwd);
  return { args, stdin };
}

export const CLI_TOOLS: Array<{ id: CliToolId; name: string }> = Object.values(TOOLS).map((t) => ({ id: t.id, name: t.name }));

export function isCliToolId(value: string): value is CliToolId {
  return value in TOOLS;
}

/** Only what the CLIs need to find their login and binaries — never the server's secrets. */
const ENV_ALLOW = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_ALL|TERM|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_CACHE_HOME|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|ANTHROPIC_[A-Z_]+|CLAUDE_[A-Z_]+|OPENAI_[A-Z_]+|CODEX_[A-Z_]+)$/;

function cliEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ENV_ALLOW.test(key)) out[key] = value;
  }
  return out;
}

function resolveBin(tool: CliTool): string | null {
  for (const name of tool.bins) {
    const override = process.env[`SDD_${name.toUpperCase()}_BIN`];
    if (override) return override;
    const found = Bun.which(name);
    if (found) return found;
  }
  return null;
}

/**
 * Spread into `Bun.spawn` options for any process `killTree` may stop. On
 * POSIX the child gets its own process group (setsid), so killing that group
 * reaches the shells, dev servers and test runners it started — a plain kill
 * stops only the direct child. Windows needs nothing: taskkill /t walks the tree.
 */
export const OWN_PROCESS_GROUP = { detached: process.platform !== "win32" } as const;

const groupLeaders = new Set<number>();

/** Remember a child spawned with OWN_PROCESS_GROUP so it is stopped when this process exits. */
export function trackTree<P extends ReturnType<typeof Bun.spawn>>(proc: P): P {
  if (!OWN_PROCESS_GROUP.detached) return proc;
  if (groupLeaders.size === 0) process.once("exit", killTrackedTrees);
  groupLeaders.add(proc.pid);
  // Once the leader is reaped a later process could reuse its pid; stop tracking it.
  void proc.exited.finally(() => groupLeaders.delete(proc.pid));
  return proc;
}

/** Its own session means Ctrl+C in the terminal no longer reaches the tree: stop it on the way out. */
function killTrackedTrees(): void {
  for (const pid of groupLeaders) killGroup(pid);
  groupLeaders.clear();
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* no such group: not started with OWN_PROCESS_GROUP, or already gone */
  }
}

/** Kill a spawned CLI and everything it started (also used by sdd-agent for task runs). */
export async function killTree(proc: ReturnType<typeof Bun.spawn>) {
  if (process.platform === "win32") {
    // Children of a .cmd shim outlive a plain kill on Windows.
    await Bun.spawn(["taskkill", "/pid", String(proc.pid), "/t", "/f"], { stdout: "ignore", stderr: "ignore", windowsHide: true }).exited.catch(() => undefined);
  } else {
    killGroup(proc.pid);
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

async function exec(
  bin: string,
  args: string[],
  opts: { cwd: string; stdin?: string; timeoutMs: number; maxOutputBytes?: number },
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  if (!Number.isFinite(opts.timeoutMs) || !Number.isInteger(opts.timeoutMs)) {
    throw new CliRunError("SPAWN_FAILED", "CLI timeout must be a finite integer in milliseconds");
  }
  const timeoutMs = Math.max(1_000, Math.min(1_800_000, opts.timeoutMs));
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = trackTree(
      Bun.spawn([bin, ...args], {
        cwd: opts.cwd,
        env: cliEnv(),
        stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
        // No console window flashing up on a Windows server or desktop.
        windowsHide: true,
        ...OWN_PROCESS_GROUP,
      }),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    throw new CliRunError(code === "ENOENT" ? "NOT_INSTALLED" : "SPAWN_FAILED", `The CLI could not be started${code ? ` (${code})` : ""}`);
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void killTree(proc);
  }, timeoutMs);
  const cap = opts.maxOutputBytes ?? 4_000_000;
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        void killTree(proc);
        await reader.cancel().catch(() => undefined);
        throw new CliRunError("OUTPUT_TOO_LARGE", `The CLI wrote more than ${cap} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    const [stdout, stderr] = await Promise.all([read(proc.stdout as ReadableStream<Uint8Array>), read(proc.stderr as ReadableStream<Uint8Array>)]);
    const code = await proc.exited;
    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/** Is the CLI installed here, which version, and is it signed in? */
export async function detectCli(id: CliToolId): Promise<CliDetection> {
  const tool = TOOLS[id];
  const base: CliDetection = { id, name: tool.name, installed: false, version: null, auth: "unknown", suggestedModels: tool.suggestedModels };
  const bin = resolveBin(tool);
  if (!bin) return base;
  const cwd = mkdtempSync(join(tmpdir(), "sdd-cli-"));
  try {
    const version = await exec(bin, tool.versionArgs, { cwd, timeoutMs: 8_000 }).catch(() => null);
    if (!version || version.code !== 0) return base;
    const auth = await exec(bin, tool.authArgs, { cwd, timeoutMs: 10_000 }).catch(() => null);
    return {
      ...base,
      installed: true,
      version: version.stdout.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? null,
      auth: !auth || auth.timedOut ? "unknown" : auth.code === 0 ? "ok" : "missing",
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

export async function detectAllClis(): Promise<CliDetection[]> {
  return Promise.all((Object.keys(TOOLS) as CliToolId[]).map((id) => detectCli(id)));
}

/** Run one prompt through the CLI and return its final text. */
export async function runCli(id: CliToolId, input: CliRunInput): Promise<CliRunResult> {
  const tool = TOOLS[id];
  const bin = resolveBin(tool);
  if (!bin) throw new CliRunError("NOT_INSTALLED", `${tool.name} is not installed on this machine (or not on PATH)`);
  if (input.model && !isValidCliModel(input.model)) {
    throw new CliRunError("INVALID_MODEL", "The model name may only use letters, digits and . _ : / - (up to 100 characters)");
  }
  const cwd = mkdtempSync(join(tmpdir(), "sdd-cli-"));
  const started = Date.now();
  try {
    const invocation = tool.build(input, cwd);
    const res = await exec(bin, invocation.args, { cwd, stdin: invocation.stdin, timeoutMs: input.timeoutMs, maxOutputBytes: input.maxOutputBytes });
    if (res.timedOut) throw new CliRunError("TIMEOUT", `${tool.name} did not finish within ${Math.round(input.timeoutMs / 1000)}s`);
    if (res.code !== 0) {
      const detail = (res.stderr || res.stdout).trim().split(/\r?\n/).slice(-3).join(" ").slice(0, 400);
      if (/unexpected argument|unrecognized (option|argument)|unknown (option|flag)/i.test(detail) && /ignore-user-config|--tools|strict-mcp-config/.test(detail)) {
        throw new CliRunError("UNSUPPORTED_VERSION", `${tool.name} is too old for the locked-down run this needs — update it. (${detail.slice(0, 200)})`);
      }
      const notSignedIn = /log ?in|not (signed|logged) in|authenticat|unauthori[sz]ed|api key/i.test(detail);
      throw new CliRunError(notSignedIn ? "NOT_SIGNED_IN" : "FAILED", `${tool.name} exited with code ${res.code}${detail ? `: ${detail}` : ""}`);
    }
    const parsed = tool.parse(res.stdout, invocation);
    if (!parsed.text.trim()) throw new CliRunError("EMPTY_OUTPUT", `${tool.name} returned an empty answer`);
    return { ...parsed, durationMs: Date.now() - started };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * Where a "LOCAL_CLI" provider connection runs, encoded in its base URL:
 *   cli://server/claude              — on the API server itself
 *   cli://machine/<machine-uuid>/codex — on a connected machine (sdd-agent)
 */
export type CliTarget = { where: "server"; tool: CliToolId } | { where: "machine"; machineId: string; tool: CliToolId };

export function parseCliTarget(url: string | null | undefined): CliTarget | null {
  if (!url) return null;
  const server = /^cli:\/\/server\/([a-z]+)$/.exec(url);
  if (server && isCliToolId(server[1]!)) return { where: "server", tool: server[1] };
  const machine = /^cli:\/\/machine\/([0-9a-f-]{36})\/([a-z]+)$/i.exec(url);
  if (machine && isCliToolId(machine[2]!)) return { where: "machine", machineId: machine[1]!.toLowerCase(), tool: machine[2] as CliToolId };
  return null;
}

export function formatCliTarget(target: CliTarget): string {
  return target.where === "server" ? `cli://server/${target.tool}` : `cli://machine/${target.machineId}/${target.tool}`;
}
