import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Execution-agent adapters (T176–T180, docs/10 §14).
 * Adapters detect a local coding agent and build a structured invocation.
 * There is NO arbitrary-shell-command field: the daemon resolves the executable
 * and a fixed argument shape (docs/13 §8). Task semantics stay out of adapters.
 */

export interface DetectionResult {
  installed: boolean;
  version?: string;
  path?: string;
}

export interface CommandSpec {
  cmd: string[];
  cwd: string;
  /** Files to clean up after the process exits. */
  cleanup?: string[];
}

export interface TaskInvocation {
  repoRoot: string;
  /** Full standalone work-order prompt. */
  prompt: string;
  taskKey: string;
}

export interface ExecutionAgentAdapter {
  readonly name: string;
  detect(): Promise<DetectionResult>;
  buildInvocation(input: TaskInvocation): Promise<CommandSpec>;
}

/** Persist the prompt to a file so prompts never hit argv length limits or logs. */
function promptFile(prompt: string): string {
  const dir = join(tmpdir(), "sdd-agent");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`);
  writeFileSync(path, prompt, "utf8");
  return path;
}

export const genericShellAdapter: ExecutionAgentAdapter = {
  name: "generic_shell",
  async detect() {
    return { installed: true };
  },
  async buildInvocation({ repoRoot, prompt, taskKey }) {
    // Configurable via env: SDD_AGENT_EXECUTABLE + SDD_AGENT_ARGS (space split,
    // {prompt_file} and {task_key} placeholders only — never raw user text).
    const executable = process.env.SDD_AGENT_EXECUTABLE;
    if (!executable) {
      throw new Error("generic_shell adapter requires SDD_AGENT_EXECUTABLE (and optionally SDD_AGENT_ARGS with {prompt_file})");
    }
    const argsTemplate = (process.env.SDD_AGENT_ARGS ?? "{prompt_file}").split(" ").filter(Boolean);
    const file = promptFile(prompt);
    const cmd = [executable, ...argsTemplate.map((a) => a.replace("{prompt_file}", file).replace("{task_key}", taskKey))];
    return { cmd, cwd: repoRoot, cleanup: [file] };
  },
};

export const claudeAdapter: ExecutionAgentAdapter = {
  name: "claude",
  async detect() {
    const path = Bun.which("claude") ?? undefined;
    return { installed: Boolean(path), path };
  },
  async buildInvocation({ repoRoot, prompt, taskKey }) {
    const file = promptFile(prompt);
    // Non-interactive print mode; explicit permission prompt for safety.
    const cmd = ["claude", "--dangerously-skip-permissions", "-p", `Read the work order file at ${file} and execute it fully. Task: ${taskKey}`];
    return { cmd, cwd: repoRoot, cleanup: [file] };
  },
};

export const codexAdapter: ExecutionAgentAdapter = {
  name: "codex",
  async detect() {
    const path = Bun.which("codex") ?? undefined;
    return { installed: Boolean(path), path };
  },
  async buildInvocation({ repoRoot, prompt, taskKey }) {
    const file = promptFile(prompt);
    const cmd = ["codex", "exec", `Read the work order file at ${file} and execute it fully. Task: ${taskKey}`];
    return { cmd, cwd: repoRoot, cleanup: [file] };
  },
};

export const kiroAdapter: ExecutionAgentAdapter = {
  name: "kiro",
  async detect() {
    const path = Bun.which("kiro-cli") ?? Bun.which("kiro") ?? undefined;
    return { installed: Boolean(path), path };
  },
  async buildInvocation({ repoRoot, prompt, taskKey }) {
    const file = promptFile(prompt);
    const executable = Bun.which("kiro-cli") ? "kiro-cli" : "kiro";
    const cmd = [executable, "chat", `Read the work order file at ${file} and execute it fully. Task: ${taskKey}`];
    return { cmd, cwd: repoRoot, cleanup: [file] };
  },
};

export const geminiAdapter: ExecutionAgentAdapter = {
  name: "gemini",
  async detect() {
    const path = Bun.which("gemini") ?? undefined;
    return { installed: Boolean(path), path };
  },
  async buildInvocation({ repoRoot, prompt, taskKey }) {
    const file = promptFile(prompt);
    const cmd = ["gemini", "-p", `Read the work order file at ${file} and execute it fully. Task: ${taskKey}`];
    return { cmd, cwd: repoRoot, cleanup: [file] };
  },
};

export const ADAPTERS: Record<string, ExecutionAgentAdapter> = {
  generic_shell: genericShellAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
  kiro: kiroAdapter,
  gemini: geminiAdapter,
};

/** Detect every installed adapter for the hello/capabilities handshake (T171). */
export async function detectCapabilities(): Promise<{ agents: string[]; os: string }> {
  const agents: string[] = [];
  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    try {
      if ((await adapter.detect()).installed) agents.push(name);
    } catch {
      /* skip */
    }
  }
  return { agents, os: process.platform };
}

export function cleanupFiles(spec: CommandSpec): void {
  for (const file of spec.cleanup ?? []) {
    try {
      rmSync(file);
    } catch {
      /* best effort */
    }
  }
}

export const tempDir = tmpdir;
export const joinPath = join;
export const writeFile = writeFileSync;
