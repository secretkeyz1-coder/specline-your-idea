import { api, CliError } from "@sdd/cli/lib/api";
import { findRepoRoot, machineFingerprint, machineName, readConfig, readRepoLink } from "@sdd/cli/lib/config";
import { ADAPTERS, cleanupFiles, detectCapabilities, type CommandSpec } from "./adapters.js";
import { CliRunError, detectAllClis, isCliToolId, killTree, OWN_PROCESS_GROUP, runCli, trackTree } from "@sdd/agent-cli";
import { isRunOwnershipLost, nextIdlePollDelay } from "./polling.js";
import { parseVerificationCommand } from "./verification.js";
import { pullApprovedUi } from "@sdd/cli/lib/ui";
import { collectRunEvidence, runBaseline } from "@sdd/cli/lib/evidence";

/** The daemon's WebSocket connection to the control plane: hello, heartbeat, dispatch, AI jobs and task runs (see the class below). */

/** AI generations (planning documents) this machine runs at once. */
const MAX_AI_JOBS = 2;

/**
 * sdd-agent connection (T173/T174, docs/10 §12–13, §17):
 * outbound WSS only (C11), token sent in the first frame (never a URL/query),
 * exponential backoff reconnect, heartbeat, structured dispatch protocol.
 */

/** hello_error codes that no amount of reconnecting can fix. */
const FATAL_HELLO_CODES = new Set(["UNAUTHORIZED", "MACHINE_UNKNOWN", "FORBIDDEN", "MACHINE_MISMATCH"]);
/** Reconnect when the server has not acknowledged a heartbeat for this long. */
const HEARTBEAT_ACK_TIMEOUT_MS = 90_000;
/** Hard ceiling for one required verification command. */
const VERIFICATION_TIMEOUT_MS = Number(process.env.SDD_AGENT_VERIFY_TIMEOUT_MS ?? 15 * 60_000);
/** Hard ceiling for one coding-agent run (the adapter process). */
const RUN_TIMEOUT_MS = Number(process.env.SDD_AGENT_RUN_TIMEOUT_MS ?? 2 * 60 * 60_000);
/** Lease the daemon asks for on claim and renews on every heartbeat. */
const RUN_LEASE_SECONDS = 1800;
type ActiveRun = {
  taskId: string;
  taskKey: string;
  runId: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  /** The verification command currently running, if any. */
  verifyProc: ReturnType<typeof Bun.spawn> | null;
  spec: CommandSpec | null;
  cancelled: boolean;
  cancelReason: string | null;
};

export class DaemonConnection {
  private ws: WebSocket | null = null;
  private backoffMs = 1000;
  private stopped = false;
  /**
   * Set synchronously when a dispatch is accepted for consideration — before
   * the first await — and cleared only after the run (verification included)
   * is over. `activeRun` alone left a window where two dispatches both passed
   * the check while the first was still claiming.
   */
  private busy = false;
  private activeRun: ActiveRun | null = null;
  /** Running AI generation jobs (separate from task runs). */
  private aiJobs = 0;
  private machineId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastServerAck = 0;
  /** Project of the repository this daemon serves (its working copy). */
  private linkedProjectId: string | null = null;
  /** Idle dispatch-next polling (the server's nudge is best-effort). */
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollDelayMs: number | null = null;
  private polling = false;

  constructor(private readonly serverUrl: string) {}

  async run(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (error) {
        if (error instanceof CliError && (error.code === "NOT_AUTHENTICATED" || error.httpStatus === 401 || error.httpStatus === 403)) {
          console.error(`[sdd-agent] ${error.message} — stopping (re-run \`sddctl login\`).`);
          this.stopped = true;
          break;
        }
        console.error(`[sdd-agent] connection error: ${error instanceof Error ? error.message : error}`);
      }
      this.clearIdlePoll();
      if (this.stopped) break;
      console.log(`[sdd-agent] reconnecting in ${this.backoffMs}ms...`);
      await new Promise((r) => setTimeout(r, this.backoffMs));
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearIdlePoll();
    this.ws?.close();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private async ensureMachine(): Promise<string> {
    if (this.machineId) return this.machineId;
    const { machine } = await api<{ machine: { id: string } }>("POST", "/api/v1/agents/machines/register", {
      body: {
        name: machineName(),
        fingerprint: machineFingerprint(),
        platform: `${process.platform}-${process.arch}`,
        capabilities: await detectCapabilities(),
      },
    });
    this.machineId = machine.id;
    return machine.id;
  }

  private async connectOnce(): Promise<void> {
    const config = readConfig();
    if (!config.token) throw new CliError("NOT_AUTHENTICATED", "Run `sddctl login` first");
    const repoRoot = findRepoRoot();
    this.linkedProjectId = repoRoot ? (readRepoLink(repoRoot)?.project_id ?? null) : null;
    const machineId = await this.ensureMachine();
    const wsUrl = this.serverUrl.replace(/^http/, "ws") + "/api/v1/agent/connect";
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ws open timeout")), 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        // Token rides in the first authenticated frame — never in the URL.
        ws.send(
          JSON.stringify({
            type: "hello",
            token: config.token,
            machine_id: machineId,
            client_version: "0.1.0",
            capabilities: detectCapabilitiesSync(),
          }),
        );
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("ws error"));
      };
    });

    // Backoff is reset only on hello_ok (see handleMessage): a server that
    // accepts the TCP/WS connection but rejects the handshake must not turn
    // into a 1-second reconnect loop.
    console.log("[sdd-agent] connected — authenticating");
    this.lastServerAck = Date.now();

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      // Silently dead server/proxy: no ack for too long → drop and reconnect.
      if (Date.now() - this.lastServerAck > HEARTBEAT_ACK_TIMEOUT_MS) {
        console.warn("[sdd-agent] no heartbeat ack from server — reconnecting");
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: "heartbeat", machine_id: machineId }));
    }, 30_000);

    ws.onmessage = (event) => void this.handleMessage(machineId, String(event.data));

    await new Promise<void>((resolve) => {
      ws.onclose = () => {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.clearIdlePoll();
        console.log("[sdd-agent] connection closed");
        resolve();
      };
    });
  }

  private clearIdlePoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** Poll dispatch-next after `delayMs` (or the next backoff step) while idle. */
  private scheduleIdlePoll(machineId: string, delayMs?: number): void {
    this.clearIdlePoll();
    if (this.stopped || !this.linkedProjectId) return;
    const delay = delayMs ?? (this.pollDelayMs = nextIdlePollDelay(this.pollDelayMs));
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.requestDispatchNext(machineId);
    }, delay);
    this.pollTimer.unref?.();
  }

  /** One-prompt mode: ask the control plane for the next claimable task. */
  private async requestDispatchNext(machineId: string): Promise<void> {
    if (!this.linkedProjectId) {
      console.log("[sdd-agent] no linked repository in this directory — scheduler feed disabled");
      return;
    }
    // A run in progress re-polls when it finishes; overlapping polls would
    // only produce AGENT_BUSY rejections.
    if (this.busy || this.polling || this.stopped) return;
    this.polling = true;
    let dispatched = false;
    try {
      const res = await api<{ dispatched: boolean; reason?: string; task?: { key: string } }>(
        "POST",
        `/api/v1/agents/machines/${machineId}/dispatch-next`,
        { body: { project_id: this.linkedProjectId } },
      );
      dispatched = res.dispatched;
      if (res.dispatched) console.log(`[sdd-agent] scheduler dispatched ${res.task?.key}`);
      else if (res.reason && res.reason !== "EMPTY_QUEUE") console.log(`[sdd-agent] no dispatch: ${res.reason}`);
      if (!res.dispatched && res.reason === "EMPTY_QUEUE") {
        const reviewed = await api<{ status: string; message?: string }>("POST", `/api/v1/projects/${this.linkedProjectId}/orchestrate`);
        if (reviewed.status === "FIX_TASKS_READY") this.pollDelayMs = null;
        else if (reviewed.status === "HUMAN_ACTION_REQUIRED") console.log(`[sdd-agent] ${reviewed.message}`);
      }
    } catch {
      // Scheduler feed is best-effort; a failed poll must not kill the socket.
    } finally {
      this.polling = false;
    }
    if (dispatched) {
      this.pollDelayMs = null; // the run's end re-polls right away
      return;
    }
    // Idle: ask again later with backoff (the server also nudges on approvals).
    if (!this.busy) this.scheduleIdlePoll(machineId);
  }

  private async handleMessage(machineId: string, raw: string): Promise<void> {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = message["type"];
    this.lastServerAck = Date.now();
    if (type === "hello_ok") {
      this.backoffMs = 1000;
      console.log("[sdd-agent] handshake complete — waiting for dispatch commands");
      // Tell the control plane which CLIs can answer planning prompts here.
      void detectAllClis()
        .then((clis) => {
          this.send({ type: "ai_capabilities", machine_id: machineId, ai_cli: clis });
          const usable = clis.filter((c) => c.installed).map((c) => `${c.name}${c.auth === "missing" ? " (not signed in)" : ""}`);
          console.log(`[sdd-agent] AI CLIs: ${usable.join(", ") || "none found"}`);
        })
        .catch(() => undefined);
      // One-prompt mode: ask the control plane to feed the first AUTO_RUN task.
      this.pollDelayMs = null;
      void this.requestDispatchNext(machineId);
      return;
    }
    if (type === "hello_error") {
      const code = String(message["code"] ?? "UNKNOWN");
      console.error(`[sdd-agent] handshake rejected: ${code}${message["message"] ? ` — ${message["message"]}` : ""}`);
      if (FATAL_HELLO_CODES.has(code)) {
        console.error("[sdd-agent] this cannot be fixed by reconnecting — stopping.");
        this.stop();
      }
      return;
    }
    if (type === "revoked") {
      console.error("[sdd-agent] this machine was revoked by an administrator — stopping.");
      if (this.activeRun) this.cancelActiveRun("machine revoked");
      this.stop();
      return;
    }
    if (type === "superseded") {
      console.error("[sdd-agent] another sdd-agent connected as this machine — stopping this one.");
      this.stop();
      return;
    }
    if (type === "heartbeat_ok") return;

    // Server nudge: READY work may be claimable in our project.
    if (type === "work_available") {
      const projectId = typeof message["project_id"] === "string" ? message["project_id"] : null;
      if (projectId && projectId !== this.linkedProjectId) return;
      this.pollDelayMs = null;
      if (!this.busy) void this.requestDispatchNext(machineId);
      return;
    }

    if (type === "execute_task") {
      const commandId = String(message["command_id"]);
      const taskId = String(message["task_id"] ?? "");
      const taskKey = String(message["task_key"] ?? "");
      const projectId = String(message["project_id"] ?? "");
      const resumeRunId = typeof message["resume_run_id"] === "string" ? message["resume_run_id"] : null;
      // Claimed synchronously, before any await: a second dispatch arriving
      // while this one is still claiming must see the daemon as busy.
      if (this.busy) {
        this.send({ type: "command_ack", command_id: commandId, machine_id: machineId, accepted: false, reason: "AGENT_BUSY" });
        console.warn(`[sdd-agent] rejected dispatch for ${taskKey}: agent is busy with ${this.activeRun?.taskKey ?? "another dispatch"}`);
        return;
      }
      this.busy = true;
      this.clearIdlePoll();
      let accepted: { taskId: string; taskKey: string; repoRoot: string; runId: string };
      try {
        accepted = resumeRunId ? await this.verifyResume(taskId, projectId, resumeRunId) : await this.verifyAndClaim(taskId, projectId, machineId);
      } catch (error) {
        this.busy = false;
        this.send({ type: "command_ack", command_id: commandId, machine_id: machineId, accepted: false, reason: error instanceof Error ? error.message : "unknown" });
        console.error(`[sdd-agent] dispatch rejected for ${taskKey}: ${error instanceof Error ? error.message : error}`);
        this.scheduleIdlePoll(machineId);
        return;
      }
      this.send({ type: "command_ack", command_id: commandId, machine_id: machineId, accepted: true });
      // Rejection-safe dispatch: a transient API failure mid-run (e.g. the
      // final request-review/block call) must never crash the daemon while
      // the run stays claimed server-side — report best-effort and survive.
      void (async () => {
        try {
          await this.execute(accepted.taskId, accepted.taskKey, accepted.repoRoot, accepted.runId, machineId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[sdd-agent] run ${accepted.runId} of ${accepted.taskKey} crashed: ${message}`);
          if (!this.activeRun?.cancelled) {
            await api("POST", `/api/v1/runs/${accepted.runId}/block`, {
              body: { reason_code: "AGENT_CRASHED", message: `Agent run failed: ${message}` },
            }).catch(() => undefined);
          }
        } finally {
          this.activeRun = null;
          this.busy = false;
          // One-prompt mode: the run finished (success, verification failure,
          // cancel or crash — the scheduler skips what it cannot run) so ask
          // for the next claimable task. A short settle delay lets the
          // server's own state transitions land first.
          this.pollDelayMs = null;
          this.scheduleIdlePoll(machineId, 1500);
        }
      })();
      return;
    }

    if (type === "ai_generate") {
      void this.runAiJob(machineId, message);
      return;
    }

    if (type === "cancel_task") {
      const run = this.activeRun;
      if (!run) return;
      // Only the run the server names: a late cancel for an older attempt must
      // not kill the task this daemon has moved on to.
      const runId = typeof message["run_id"] === "string" ? message["run_id"] : null;
      const taskId = typeof message["task_id"] === "string" ? message["task_id"] : null;
      if ((runId && runId !== run.runId) || (!runId && taskId && taskId !== run.taskId)) return;
      this.cancelActiveRun(String(message["reason"] ?? "cancelled by the control plane"));
      return;
    }
  }

  /** Stop the current run and everything it spawned; the run loop reports nothing further. */
  private cancelActiveRun(reason: string): void {
    const run = this.activeRun;
    if (!run || run.cancelled) return;
    run.cancelled = true;
    run.cancelReason = reason;
    if (run.proc) void killTree(run.proc);
    if (run.verifyProc) void killTree(run.verifyProc);
    console.log(`[sdd-agent] stopping ${run.taskKey}: ${reason}`);
  }

  /**
   * One planning prompt through a local CLI. The control plane sends the
   * prompt and a tool name only; the invocation is fixed here (no tools, a
   * temporary folder) and the CLI uses this machine's own login.
   */
  private async runAiJob(machineId: string, message: Record<string, unknown>): Promise<void> {
    const jobId = String(message["job_id"] ?? "");
    const tool = String(message["tool"] ?? "");
    const reply = (body: Record<string, unknown>) => this.send({ type: "ai_result", job_id: jobId, machine_id: machineId, ...body });
    if (!jobId || !isCliToolId(tool)) {
      reply({ ok: false, error_code: "FAILED", error_message: `Unknown CLI "${tool}"` });
      return;
    }
    if (this.aiJobs >= MAX_AI_JOBS) {
      reply({ ok: false, error_code: "FAILED", error_message: `This machine is already running ${MAX_AI_JOBS} AI generations — try again in a moment` });
      return;
    }
    this.aiJobs++;
    const started = Date.now();
    console.log(`[sdd-agent] AI job ${jobId.slice(0, 8)} → ${tool}${message["model"] ? ` (${String(message["model"])})` : ""}`);
    try {
      const result = await runCli(tool, {
        system: String(message["system"] ?? ""),
        prompt: String(message["prompt"] ?? ""),
        model: String(message["model"] ?? ""),
        // Bounded here too, whatever the server asked for.
        timeoutMs: Math.min(Number(message["timeout_ms"]) || 900_000, 1_800_000),
        maxOutputBytes: Number(message["max_output_bytes"]) || undefined,
      });
      reply({
        ok: true,
        text: result.text,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        cost_usd: result.costUsd,
        duration_ms: result.durationMs,
      });
      console.log(`[sdd-agent] AI job ${jobId.slice(0, 8)} done in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (error) {
      const code = error instanceof CliRunError ? error.code : "FAILED";
      const text = error instanceof Error ? error.message : String(error);
      reply({ ok: false, error_code: code, error_message: text });
      console.error(`[sdd-agent] AI job ${jobId.slice(0, 8)} failed: ${text}`);
    } finally {
      this.aiJobs--;
    }
  }

  private send(message: Record<string, unknown>): void {
    this.ws?.send(JSON.stringify(message));
  }

  /** The dispatched task must be the exact task id the server sent AND belong
   * to the repository linked here. Resolving by key inside "whatever project
   * this directory is linked to" would run a different project's TASK-00N. */
  private linkedRepo(projectId: string, taskId: string): { repoRoot: string; projectId: string } {
    const repoRoot = findRepoRoot();
    if (!repoRoot) throw new Error("no linked repository in this working directory");
    const link = readRepoLink(repoRoot);
    if (!link?.project_id) throw new Error("repository is not linked");
    if (!taskId || !projectId) throw new Error("dispatch is missing task_id/project_id");
    if (projectId !== link.project_id) {
      throw new Error(`dispatch targets project ${projectId}, but this working copy is linked to ${link.project_id}`);
    }
    return { repoRoot, projectId: link.project_id };
  }

  /** Dispatch verification (T181, docs/13 §9), then claim + start as this machine. */
  private async verifyAndClaim(taskId: string, projectId: string, machineId: string): Promise<{ taskId: string; taskKey: string; repoRoot: string; runId: string }> {
    const linked = this.linkedRepo(projectId, taskId);
    const { task } = await api<{ task: { id: string; key: string; projectId: string; workflowStatus: string } }>("GET", `/api/v1/tasks/${taskId}`);
    if (task.projectId !== linked.projectId) throw new Error("task does not belong to the linked project");
    if (task.workflowStatus !== "READY") throw new Error(`task is ${task.workflowStatus}, not READY`);

    // machine_id marks this as a daemon run, so a cancel/requeue can stop it here.
    const claim = await api<{ run_id: string }>("POST", `/api/v1/tasks/${task.id}/claim`, {
      body: { executor: { type: "LOCAL_AGENT", id: machineFingerprint() }, lease_seconds: RUN_LEASE_SECONDS, machine_id: machineId },
    });
    await api("POST", `/api/v1/runs/${claim.run_id}/start`);
    return { taskId: task.id, taskKey: task.key.toUpperCase(), repoRoot: linked.repoRoot, runId: claim.run_id };
  }

  /** A human resumed a blocked run of ours: continue it under its fresh lease (no new claim). */
  private async verifyResume(taskId: string, projectId: string, runId: string): Promise<{ taskId: string; taskKey: string; repoRoot: string; runId: string }> {
    const linked = this.linkedRepo(projectId, taskId);
    const { task } = await api<{ task: { id: string; key: string; projectId: string; workflowStatus: string } }>("GET", `/api/v1/tasks/${taskId}`);
    if (task.projectId !== linked.projectId) throw new Error("task does not belong to the linked project");
    if (task.workflowStatus !== "IN_PROGRESS") throw new Error(`task is ${task.workflowStatus}, not IN_PROGRESS`);
    // Proves the lease is ours and alive before any work starts.
    await api("POST", `/api/v1/runs/${runId}/heartbeat`, { body: { lease_seconds: RUN_LEASE_SECONDS } });
    return { taskId: task.id, taskKey: task.key.toUpperCase(), repoRoot: linked.repoRoot, runId };
  }

  /** Spawn the local coding agent through the adapter and stream status (T181). */
  private async execute(taskId: string, taskKey: string, repoRoot: string, runId: string, machineId: string, retry = 0, baseCommit: string | null = runBaseline(repoRoot, runId), corrections = ""): Promise<void> {
    // The runId comes straight from the claim response — never from a stale
    // local run file (which could belong to a previous attempt).
    const run: ActiveRun = { taskId, taskKey, runId, proc: null, verifyProc: null, spec: null, cancelled: false, cancelReason: null };
    this.activeRun = run;

    const preferred = (process.env.SDD_AGENT_ADAPTER ?? "").trim();
    let adapterName = preferred && ADAPTERS[preferred] ? preferred : "";
    if (!adapterName) {
      const caps = await detectCapabilities();
      adapterName = caps.agents[0] ?? "generic_shell";
    }
    const adapter = ADAPTERS[adapterName] ?? ADAPTERS["generic_shell"]!;
    console.log(`[sdd-agent] executing ${taskKey} with adapter ${adapter.name}`);

    if (!retry) {
      const { task } = await api<{ task: { projectId: string } }>("GET", `/api/v1/tasks/${taskId}`);
      await pullApprovedUi(task.projectId, repoRoot);
    }
    const { prompt } = await api<{ prompt: string }>("POST", `/api/v1/tasks/${taskId}/prompt`, { body: { mode: "STANDALONE" } });
    const spec = await adapter.buildInvocation({ repoRoot, prompt: `${prompt}\n${corrections}`, taskKey });
    run.spec = spec;
    if (run.cancelled) {
      cleanupFiles(spec);
      console.log(`[sdd-agent] ${taskKey} stopped before it started: ${run.cancelReason}`);
      return;
    }

    const proc = trackTree(
      Bun.spawn(spec.cmd, {
        cwd: spec.cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        ...OWN_PROCESS_GROUP,
      }),
    );
    run.proc = proc;

    const startedAt = Date.now();
    let lastReport = 0;
    let outputTail = "";
    const reportLine = (line: string) => {
      const now = Date.now();
      if (now - lastReport < 4000) return;
      lastReport = now;
      void api("POST", `/api/v1/runs/${run.runId}/events`, {
        body: { type: "progress_reported", message: line.slice(0, 500) },
      }).catch(() => undefined);
      console.log(`  │ ${line.slice(0, 120)}`);
    };

    const pump = async (stream: ReadableStream<Uint8Array> | null, onChunk?: (text: string) => void) => {
      if (!stream) return;
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (onChunk) onChunk(chunk); else outputTail = (outputTail + chunk).slice(-8000);
        buffer = (buffer + chunk).slice(-16000);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) reportLine(line.trim());
      }
    };
    // Lease renewal. A lease/ownership error means the server has moved on
    // (cancelled, requeued, expired): stop the work instead of carrying on.
    const heartbeatInterval = setInterval(() => {
      void api("POST", `/api/v1/runs/${run.runId}/heartbeat`, {
        body: { lease_seconds: RUN_LEASE_SECONDS },
      }).catch((error: unknown) => {
        if (isRunOwnershipLost(error)) this.cancelActiveRun(`lease lost (${error instanceof CliError ? error.code : "error"})`);
      });
    }, 60_000);
    let timedOut = false;
    const runTimer = setTimeout(() => {
      timedOut = true;
      void killTree(proc);
    }, RUN_TIMEOUT_MS);

    try {
      await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array> | null), pump(proc.stderr as ReadableStream<Uint8Array> | null)]);
      const exitCode = await proc.exited;
      clearTimeout(runTimer);
      cleanupFiles(spec);

      const durationMs = Date.now() - startedAt;
      if (run.cancelled) {
        console.log(`[sdd-agent] ${taskKey} stopped: ${run.cancelReason}`);
        return;
      }
      if (timedOut) {
        await api("POST", `/api/v1/runs/${run.runId}/block`, {
          body: { reason_code: "AGENT_TIMEOUT", message: `Adapter ${adapter.name} ran longer than ${Math.round(RUN_TIMEOUT_MS / 60_000)} min and was stopped` },
        });
        console.log(`[sdd-agent] ${taskKey} blocked (timed out)`);
        return;
      }
      if (exitCode === 0) {
        let evidenceScreenKeys: string[] = [];
        // Run required verification commands if defined in the task contract (C2 Evidence Policy)
        try {
          const { task } = await api<{ task: { contract?: { ui_screen_keys?: string[]; verification?: { required?: Array<{ type: string; command: string }> } } } }>(
            "GET",
            `/api/v1/tasks/${taskId}`,
          );
          const required = task.contract?.verification?.required ?? [];
          evidenceScreenKeys = [...new Set([...(task.contract?.ui_screen_keys ?? []), ...required.flatMap(r => [...r.command.matchAll(/e2e\/render\/([\w.-]+)\.spec\./g)].map(m => m[1]!))])];
          let allPassed = true;
          const failures: string[] = [];
          for (const req of required) {
            if (run.cancelled) break;
            if (req.type === "command" && req.command) {
              // One idempotency key per logical report: a retry must not add a second row.
              const reportKey = globalThis.crypto.randomUUID();
              const parsed = parseVerificationCommand(req.command);
              if (!parsed.ok) {
                allPassed = false;
                console.warn(`[sdd-agent] refusing verification command "${req.command}": ${parsed.reason}`);
                await api("POST", `/api/v1/runs/${run.runId}/tests`, {
                  body: { command: req.command, status: "ERROR", exit_code: -1, duration_ms: 0, summary: `Not executed: ${parsed.reason}`, idempotency_key: reportKey },
                }).catch(() => undefined);
                continue;
              }
              console.log(`[sdd-agent] running required verification: ${req.command}`);
              const testStart = Date.now();
              // Drain both pipes and retain a bounded failure log for correction.
              let testLog = "";
              const capture = (chunk: string) => { testLog = (testLog + chunk).slice(-4000); };
              const testProc = trackTree(
                Bun.spawn(parsed.argv, { cwd: repoRoot, stdout: "pipe", stderr: "pipe", stdin: "ignore", ...OWN_PROCESS_GROUP }),
              );
              run.verifyProc = testProc;
              let verifyTimedOut = false;
              const killTimer = setTimeout(() => {
                verifyTimedOut = true;
                void killTree(testProc);
              }, VERIFICATION_TIMEOUT_MS);
              const [, , testExit] = await Promise.all([pump(testProc.stdout as ReadableStream<Uint8Array>, capture), pump(testProc.stderr as ReadableStream<Uint8Array>, capture), testProc.exited]);
              clearTimeout(killTimer);
              run.verifyProc = null;
              if (run.cancelled) break;
              const testDuration = Date.now() - testStart;
              const status = verifyTimedOut ? "ERROR" : testExit === 0 ? "PASSED" : "FAILED";
              await api("POST", `/api/v1/runs/${run.runId}/tests`, {
                body: {
                  command: req.command,
                  status,
                  exit_code: testExit,
                  duration_ms: testDuration,
                  idempotency_key: reportKey,
                  summary: `${verifyTimedOut ? "Timed out. " : ""}${testLog}`.slice(-4000),
                },
              });
              if (status !== "PASSED") {
                allPassed = false;
                failures.push(`${req.command}: ${status}\n${testLog}`);
                console.warn(`[sdd-agent] verification failed: ${req.command} ${verifyTimedOut ? "timed out" : `exited with ${testExit}`}`);
              }
            } else if (req.type === "manual") { allPassed = false; failures.push(`Human verification required: ${req.command}`); }
          }
          if (run.cancelled) {
            console.log(`[sdd-agent] ${taskKey} stopped during verification: ${run.cancelReason}`);
            return;
          }
          if (!allPassed) {
            if (retry < 2 && !required.some(r => r.type === "manual")) {
              clearInterval(heartbeatInterval);
              return await this.execute(taskId, taskKey, repoRoot, runId, machineId, retry + 1, baseCommit, `## Verification corrections (attempt ${retry + 2}/3)\nFix these failures without weakening the tests:\n${failures.join("\n").slice(-12000)}`);
            }
            await api("POST", `/api/v1/runs/${run.runId}/block`, {
              body: { reason_code: "VERIFICATION_FAILED", message: failures.join("\n").slice(-2000) || "Verification command refused; inspect reported results." },
            });
            console.log(`[sdd-agent] ${taskKey} blocked due to verification failure`);
            return;
          }
        } catch (err) {
          await api("POST", `/api/v1/runs/${run.runId}/block`, { body: { reason_code: "VERIFICATION_ERROR", message: String(err).slice(0, 2000) } });
          return;
        }

        clearInterval(heartbeatInterval);
        await api("POST", `/api/v1/runs/${run.runId}/request-review`, {
          body: {
            summary: outputTail.trim() || `Executed by ${adapter.name}; inspect the implementation diff and test logs.`,
            ...collectRunEvidence(repoRoot, baseCommit, evidenceScreenKeys),
            exit_code: 0,
            machine_id: machineId,
          },
        });
        console.log(`[sdd-agent] ${taskKey} submitted for review`);
      } else {
        await api("POST", `/api/v1/runs/${run.runId}/block`, {
          body: { reason_code: "AGENT_EXIT_NONZERO", message: `Adapter ${adapter.name} exited with code ${exitCode}` },
        });
        console.log(`[sdd-agent] ${taskKey} blocked (exit ${exitCode})`);
      }
    } finally {
      clearInterval(heartbeatInterval);
      clearTimeout(runTimer);
      // The caller clears busy/activeRun and asks for the next task.
    }
  }
}

function detectCapabilitiesSync(): { agents: string[]; os: string } {
  const agents = Object.entries(ADAPTERS)
    .filter(([name]) => name !== "generic_shell")
    .filter(([name]) => Bun.which(name === "kiro" ? "kiro-cli" : name) || Bun.which(name))
    .map(([name]) => name);
  return { agents: [...new Set([...agents, "generic_shell"])], os: process.platform };
}
