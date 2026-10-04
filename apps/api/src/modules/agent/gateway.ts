import { Elysia, t } from "elysia";
import { and, eq, ne } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { hasScope, resolveApiToken } from "@sdd/auth";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { audit } from "../audit/service.js";
import { isDaemonRun } from "../execution/events.js";
import { findNextClaimable } from "../execution/scheduler.js";
import { DomainError } from "@sdd/shared";
import type { CliMachineJob } from "@sdd/ai";
import type { CliRunResult } from "@sdd/agent-cli";

/**
 * Outbound WebSocket agent gateway (T171/T172, docs/09 §22, docs/13 §7–9).
 * Daemons dial OUT to /api/v1/agent/connect — laptops never expose a port (C11).
 * The dispatch protocol carries structured execution intent only; there is no
 * arbitrary shell-command field (docs/13 §8). Actual execution-state updates
 * still flow through the same REST/CLI command services.
 */

export interface GatewayConnection {
  machineId: string;
  userId: string;
  capabilities: Record<string, unknown>;
  send: (message: unknown) => void;
  socket: unknown;
  connectedAt: number;
  lastSeenAt: number;
}

const connections = new Map<string, GatewayConnection>();
interface PendingDispatch {
  machineId: string;
  resolve: (result: { acked: boolean; reason?: string }) => void;
}
const pendingDispatches = new Map<string, PendingDispatch>();

/** AI jobs sent to a machine's sdd-agent, waiting for its `ai_result`. */
interface PendingAiJob {
  machineId: string;
  resolve: (result: CliRunResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingAiJobs = new Map<string, PendingAiJob>();

/**
 * Run one CLI prompt on a connected machine and wait for the answer. The job
 * carries the prompt and the tool name only — never a command line or a
 * credential; the daemon builds the invocation and uses its own CLI login.
 */
export function runAiOnMachine(machineId: string, job: CliMachineJob): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const conn = getConnection(machineId);
    if (!conn) {
      reject(new DomainError("MACHINE_OFFLINE", "The machine that runs this CLI is offline — start `sdd-agent connect` on it", 503));
      return;
    }
    const jobId = crypto.randomUUID();
    // The daemon enforces job.timeoutMs itself; this is the backstop for a lost socket.
    const timer = setTimeout(() => {
      pendingAiJobs.delete(jobId);
      reject(new DomainError("PROVIDER_TIMEOUT", `The machine did not answer within ${Math.round(job.timeoutMs / 1000) + 60}s`, 504));
    }, job.timeoutMs + 60_000);
    pendingAiJobs.set(jobId, { machineId, resolve, reject, timer });
    try {
      conn.send({ type: "ai_generate", job_id: jobId, tool: job.tool, model: job.model, system: job.system, prompt: job.prompt, timeout_ms: job.timeoutMs, max_output_bytes: job.maxOutputBytes });
    } catch {
      clearTimeout(timer);
      pendingAiJobs.delete(jobId);
      reject(new DomainError("MACHINE_OFFLINE", "Could not reach the machine that runs this CLI", 503));
    }
  });
}

/** What CLIs a connected machine reported (installed, version, signed in). */
export function machineCliCapabilities(machineId: string): unknown[] | null {
  const conn = getConnection(machineId);
  const list = conn?.capabilities["ai_cli"];
  return conn ? (Array.isArray(list) ? list : []) : null;
}
/** Post-hello socket identity: every later message is authorized by the socket
 * it arrives on — never by a caller-supplied machine_id field. */
const socketAuth = new WeakMap<object, { machineId: string; userId: string }>();
/**
 * Elysia hands each ws event (open, message, close) a NEW wrapper object; only
 * the underlying Bun socket (`raw`) is stable. Every per-socket lookup keys on
 * it — keyed on the wrapper, `hello` never cleared the open handler's deadline
 * and a healthy daemon was dropped with HELLO_TIMEOUT ten seconds later.
 */
const socketKey = (ws: unknown): object => ((ws as { raw?: object }).raw ?? ws) as object;
/** Sockets that have not completed `hello` yet, with their deadline timer. */
const helloDeadlines = new WeakMap<object, ReturnType<typeof setTimeout>>();
const HELLO_TIMEOUT_MS = 10_000;

function closeQuietly(socket: unknown, code?: number, reason?: string) {
  try {
    (socket as { close: (code?: number, reason?: string) => void }).close(code, reason);
  } catch {
    // already closed
  }
}

/** Drop a machine's live socket (revocation). Returns true if one was open. */
export function disconnectMachine(machineId: string, reason = "revoked"): boolean {
  const conn = connections.get(machineId);
  if (!conn) return false;
  connections.delete(machineId);
  try {
    conn.send({ type: "revoked", reason });
  } catch {
    // socket may already be gone
  }
  closeQuietly(conn.socket, 4003, reason);
  return true;
}

export function getConnection(machineId: string): GatewayConnection | undefined {
  const conn = connections.get(machineId);
  if (conn && Date.now() - conn.lastSeenAt > 90_000) return undefined; // stale
  return conn;
}

export function listOnlineMachines(): Array<{ machineId: string; userId: string; connectedAt: number }> {
  const out: Array<{ machineId: string; userId: string; connectedAt: number }> = [];
  for (const [id, conn] of connections) {
    if (Date.now() - conn.lastSeenAt <= 90_000) {
      out.push({ machineId: id, userId: conn.userId, connectedAt: conn.connectedAt });
    }
  }
  return out;
}

/** Server → daemon dispatch. Resolves when the daemon acks (or times out). */
export function dispatchToMachine(machineId: string, command: Record<string, unknown>, timeoutMs = 10_000): Promise<{ acked: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const conn = getConnection(machineId);
    if (!conn) {
      resolve({ acked: false, reason: "MACHINE_OFFLINE" });
      return;
    }
    const commandId = String(command["command_id"] ?? "");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      if (commandId) pendingDispatches.delete(commandId);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve({ acked: false, reason: "ACK_TIMEOUT" });
    }, timeoutMs);

    if (commandId) {
      pendingDispatches.set(commandId, {
        machineId,
        resolve: (result) => {
          cleanup();
          resolve(result);
        },
      });
    }
    conn.send(command);
  });
}

/**
 * Server → daemon nudge: READY work may have become claimable in this project
 * (approval, requeue, unblock, readied task, auto-approve switched on). Only
 * online machines with an ACTIVE AUTO_RUN link to the project are told; each
 * daemon then asks `dispatch-next` itself, so the scheduler stays the single
 * authority for what runs. Best-effort: the daemon also polls while idle.
 */
export async function nudgeAutoRunMachines(db: DbExecutor, projectId: string): Promise<number> {
  const links = await db
    .select({ machineId: schema.repositoryLinks.machineId })
    .from(schema.repositoryLinks)
    .where(
      and(
        eq(schema.repositoryLinks.projectId, projectId),
        eq(schema.repositoryLinks.status, "ACTIVE"),
        eq(schema.repositoryLinks.permissionMode, "AUTO_RUN"),
      ),
    );
  let sent = 0;
  for (const { machineId } of links) {
    const conn = getConnection(machineId);
    if (!conn) continue;
    try {
      conn.send({ type: "work_available", project_id: projectId });
      sent += 1;
    } catch {
      // socket went away; the daemon re-polls when it reconnects
    }
  }
  return sent;
}

/** Fire-and-forget variant for request handlers: a nudge must never fail the request. */
export function nudgeAutoRunMachinesSoon(db: DbExecutor, projectId: string): void {
  void nudgeAutoRunMachines(db, projectId).catch(() => undefined);
}

/**
 * Tell the machines executing these runs to stop them (task cancelled,
 * requeued or unblocked to READY). The server has already retired the runs;
 * this only stops the local process so it does not keep editing the working
 * copy. Returns how many machines were reached.
 */
export function stopRunsOnMachines(runs: Array<{ id: string; taskId: string; machineId: string | null }>, reason: string): number {
  let sent = 0;
  for (const run of runs) {
    if (!run.machineId) continue;
    const conn = getConnection(run.machineId);
    if (!conn) continue;
    try {
      conn.send({ type: "cancel_task", task_id: run.taskId, run_id: run.id, reason });
      sent += 1;
    } catch {
      // offline: its next heartbeat gets a lease error and stops the run
    }
  }
  return sent;
}

/**
 * Whether a blocked daemon run can be resumed: the machine that ran it must be
 * online and still hold an ACTIVE AUTO_RUN link to the project (remote
 * dispatch requires AUTO_RUN, docs/13 §10). Null = resumable.
 */
export async function daemonResumeBlocker(db: DbExecutor, run: { machineId: string | null; metadata?: Record<string, unknown> | null }, projectId: string): Promise<string | null> {
  if (!run.machineId || !isDaemonRun(run)) return null;
  const [link] = await db
    .select()
    .from(schema.repositoryLinks)
    .where(and(eq(schema.repositoryLinks.projectId, projectId), eq(schema.repositoryLinks.machineId, run.machineId)))
    .limit(1);
  if (!link || link.status !== "ACTIVE" || link.permissionMode !== "AUTO_RUN") {
    return "The machine that ran this task no longer auto-runs this project, so nothing would continue the run. Unblock it to READY instead.";
  }
  if (!getConnection(run.machineId)) {
    return "The machine that ran this task is offline, so nothing would continue the run. Start `sdd-agent connect` on it, or unblock it to READY instead.";
  }
  return null;
}

/** Hand a resumed (IN_PROGRESS, fresh lease) daemon run back to its machine. */
export async function dispatchResume(
  db: DbExecutor,
  run: { id: string; machineId: string | null; metadata?: Record<string, unknown> | null },
  task: { id: string; key: string; projectId: string },
): Promise<{ acked: boolean; reason?: string }> {
  if (!run.machineId || !isDaemonRun(run)) return { acked: false, reason: "NOT_A_DAEMON_RUN" };
  const [link] = await db
    .select({ id: schema.repositoryLinks.id })
    .from(schema.repositoryLinks)
    .where(and(eq(schema.repositoryLinks.projectId, task.projectId), eq(schema.repositoryLinks.machineId, run.machineId)))
    .limit(1);
  return dispatchToMachine(run.machineId, {
    type: "execute_task",
    command_id: crypto.randomUUID(),
    task_id: task.id,
    task_key: task.key,
    project_id: task.projectId,
    repository_link_id: link?.id ?? null,
    resume_run_id: run.id,
    prompt_mode: "CONNECTED_CLI",
  });
}

export function agentGateway(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/agent", tags: ["agents"] }).use(authPlugin(infra))
    .ws("/connect", {
      open: (ws) => {
        infra.logger.debug("agent ws opened");
        // Unauthenticated sockets must not linger: require `hello` promptly.
        helloDeadlines.set(
          socketKey(ws),
          setTimeout(() => {
            if (!socketAuth.get(socketKey(ws))) {
              try {
                ws.send(JSON.stringify({ type: "hello_error", code: "HELLO_TIMEOUT" }));
              } catch {
                // ignore
              }
              closeQuietly(ws);
            }
          }, HELLO_TIMEOUT_MS),
        );
      },
      message: async (ws, messageRaw) => {
        // Elysia delivers already-parsed objects; be robust to raw frames too.
        let message: Record<string, unknown> | null = null;
        if (messageRaw !== null && typeof messageRaw === "object" && !(messageRaw instanceof Uint8Array) && !(messageRaw instanceof Blob)) {
          message = messageRaw as Record<string, unknown>;
        } else {
          try {
            const text =
              typeof messageRaw === "string"
                ? messageRaw
                : messageRaw instanceof Uint8Array
                  ? new TextDecoder().decode(messageRaw)
                  : messageRaw instanceof Blob
                    ? await messageRaw.text()
                    : String(messageRaw);
            message = JSON.parse(text) as Record<string, unknown>;
          } catch {
            message = null;
          }
        }
        if (!message || typeof message !== "object") {
          ws.send(JSON.stringify({ type: "error", code: "BAD_JSON" }));
          return;
        }
        const type = message["type"];

        if (type === "hello") {
          const token = String(message["token"] ?? "");
          const row = await resolveApiToken(infra.db, token);
          if (!row) {
            ws.send(JSON.stringify({ type: "hello_error", code: "UNAUTHORIZED" }));
            ws.close();
            return;
          }
          // Only a token granted machine:register may drive a dispatch channel.
          if (!hasScope(row.token.scopes, "machine:register")) {
            ws.send(JSON.stringify({ type: "hello_error", code: "FORBIDDEN", message: "Token lacks machine:register" }));
            ws.close();
            return;
          }
          const machineId = String(message["machine_id"] ?? "");
          if (row.token.machineId && row.token.machineId !== machineId) {
            ws.send(JSON.stringify({ type: "hello_error", code: "MACHINE_MISMATCH" }));
            ws.close();
            return;
          }
          const [machine] = await infra.db
            .select()
            .from(schema.localMachines)
            .where(and(eq(schema.localMachines.id, machineId), eq(schema.localMachines.userId, row.user.id)))
            .limit(1);
          if (!machine || machine.status === "REVOKED") {
            ws.send(JSON.stringify({ type: "hello_error", code: "MACHINE_UNKNOWN" }));
            ws.close();
            return;
          }
          await infra.db
            .update(schema.localMachines)
            .set({ status: "ONLINE", lastSeenAt: new Date(), capabilities: (message["capabilities"] as Record<string, unknown>) ?? machine.capabilities })
            .where(and(eq(schema.localMachines.id, machine.id), ne(schema.localMachines.status, "REVOKED")));
          const deadline = helloDeadlines.get(socketKey(ws));
          if (deadline) clearTimeout(deadline);
          // One live channel per machine: close the previous socket explicitly
          // instead of silently orphaning it.
          const previous = connections.get(machine.id);
          if (previous && socketKey(previous.socket) !== socketKey(ws)) {
            connections.delete(machine.id);
            try {
              previous.send({ type: "superseded" });
            } catch {
              // ignore
            }
            closeQuietly(previous.socket, 4000, "superseded");
          }
          connections.set(machine.id, {
            machineId: machine.id,
            userId: row.user.id,
            capabilities: (message["capabilities"] as Record<string, unknown>) ?? {},
            send: (m) => ws.send(JSON.stringify(m)),
            socket: ws,
            connectedAt: Date.now(),
            lastSeenAt: Date.now(),
          });
          socketAuth.set(socketKey(ws), { machineId: machine.id, userId: row.user.id });
          ws.send(JSON.stringify({ type: "hello_ok", machine_id: machine.id, server_time: new Date().toISOString() }));
          infra.logger.info("agent connected", { machineId: machine.id, userId: row.user.id });
          return;
        }

        // Post-hello messages are authorized by the SOCKET's hello identity —
        // a caller-supplied machine_id field is never trusted for routing
        // (any open socket must not be able to act for another machine).
        const binding = socketAuth.get(socketKey(ws));
        if (!binding) {
          ws.send(JSON.stringify({ type: "error", code: "NOT_AUTHENTICATED" }));
          return;
        }
        if (typeof message["machine_id"] === "string" && message["machine_id"] !== binding.machineId) {
          ws.send(JSON.stringify({ type: "error", code: "MACHINE_MISMATCH" }));
          return;
        }
        const conn = connections.get(binding.machineId);
        if (conn) conn.lastSeenAt = Date.now();

        if (type === "heartbeat") {
          // Never resurrect a revoked machine: the status guard makes revocation stick.
          const alive = await infra.db
            .update(schema.localMachines)
            .set({ lastSeenAt: new Date(), status: "ONLINE" })
            .where(and(eq(schema.localMachines.id, binding.machineId), ne(schema.localMachines.status, "REVOKED")))
            .returning({ id: schema.localMachines.id });
          if (alive.length === 0) {
            if (!disconnectMachine(binding.machineId, "machine revoked")) closeQuietly(ws, 4003, "revoked");
            return;
          }
          ws.send(JSON.stringify({ type: "heartbeat_ok" }));
          return;
        }
        if (type === "command_ack") {
          const commandId = String(message["command_id"] ?? "");
          const pending = pendingDispatches.get(commandId);
          if (pending && pending.machineId === binding.machineId) {
            // Spec docs/09 §22: the daemon may NACK with accepted:false.
            pending.resolve({ acked: message["accepted"] !== false, reason: message["accepted"] === false ? "DAEMON_REJECTED" : undefined });
          }
          infra.logger.debug("agent command_ack", { machineId: binding.machineId, commandId });
          return;
        }
        if (type === "ai_capabilities") {
          if (conn && Array.isArray(message["ai_cli"])) conn.capabilities = { ...conn.capabilities, ai_cli: (message["ai_cli"] as unknown[]).slice(0, 10) };
          return;
        }
        if (type === "ai_result") {
          const jobId = String(message["job_id"] ?? "");
          const pending = pendingAiJobs.get(jobId);
          // Only the machine the job was sent to may answer it.
          if (!pending || pending.machineId !== binding.machineId) return;
          clearTimeout(pending.timer);
          pendingAiJobs.delete(jobId);
          if (message["ok"] === true && typeof message["text"] === "string") {
            const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
            pending.resolve({
              text: message["text"],
              inputTokens: num(message["input_tokens"]),
              outputTokens: num(message["output_tokens"]),
              costUsd: num(message["cost_usd"]),
              durationMs: num(message["duration_ms"]) ?? 0,
            });
          } else {
            const code = String(message["error_code"] ?? "FAILED").replace(/[^A-Z_]/g, "").slice(0, 40) || "FAILED";
            const detail = String(message["error_message"] ?? "The CLI run failed").slice(0, 500);
            pending.reject(new DomainError(`CLI_${code}`, `On the machine: ${detail}`, code === "TIMEOUT" ? 504 : 502));
          }
          return;
        }
        if (type === "command_result" || type === "run_event") {
          infra.logger.debug("agent message", { machineId: binding.machineId, type });
          return;
        }
        ws.send(JSON.stringify({ type: "error", code: "UNKNOWN_MESSAGE" }));
      },
      close: async (ws) => {
        const deadline = helloDeadlines.get(socketKey(ws));
        if (deadline) clearTimeout(deadline);
        for (const [id, conn] of connections) {
          if (socketKey(conn.socket) === socketKey(ws)) {
            connections.delete(id);
            await infra.db
              .update(schema.localMachines)
              .set({ status: "OFFLINE", lastSeenAt: new Date() })
              .where(and(eq(schema.localMachines.id, id), ne(schema.localMachines.status, "REVOKED")));
            infra.logger.info("agent disconnected", { machineId: id });
          }
        }
      },
    })

    .post(
      "/machines/:machineId/dispatch",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [machine] = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(and(eq(schema.localMachines.id, ctx.params.machineId), eq(schema.localMachines.userId, principal.userId)))
          .limit(1);
        if (!machine) throw (await import("@sdd/shared")).errors.notFound("Machine");
        if (machine.status === "REVOKED") throw (await import("@sdd/shared")).errors.forbidden("Machine is revoked");

        const { task } = await (async () => {
          const { getTask } = await import("../task/repo.js");
          return { task: await getTask(ctx.infra.db, ctx.body.task_id) };
        })();
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:execute" });

        // Dispatch safety: only AUTO_RUN repo links may be dispatched server-side
        // (docs/13 §10 — Manual/Assisted require local confirmation).
        const [link] = await ctx.infra.db
          .select()
          .from(schema.repositoryLinks)
          .where(and(eq(schema.repositoryLinks.projectId, task.projectId), eq(schema.repositoryLinks.machineId, machine.id)))
          .limit(1);
        if (!link || link.status !== "ACTIVE") {
          throw (await import("@sdd/shared")).errors.conflict("NO_REPO_LINK", "This machine has no active repository link for the task's project");
        }
        if (link.permissionMode !== "AUTO_RUN") {
          throw (await import("@sdd/shared")).errors.conflict(
            "DISPATCH_NOT_PERMITTED",
            `Repository permission mode is ${link.permissionMode}; remote dispatch requires AUTO_RUN (docs/13 §10)`,
          );
        }

        const commandId = crypto.randomUUID();
        const result = await dispatchToMachine(machine.id, {
          type: "execute_task",
          command_id: commandId,
          task_id: task.id,
          task_key: task.key,
          project_id: task.projectId,
          repository_link_id: link.id,
          execution_profile_id: ctx.body.execution_profile_id ?? null,
          prompt_mode: ctx.body.prompt_mode ?? "CONNECTED_CLI",
        });
        await audit(ctx.infra.db, {
          workspaceId: (await ctx.infra.db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).limit(1))[0]!.workspaceId,
          projectId: task.projectId,
          actorType: "USER",
          actorId: principal.userId,
          source: "DAEMON",
          action: "task.dispatched",
          entityType: "TASK",
          entityId: task.id,
          metadata: { machine_id: machine.id, command_id: commandId, acked: result.acked },
        });
        return result.acked ? { dispatched: true, command_id: commandId } : { dispatched: false, reason: result.reason };
      },
      {
        params: t.Object({ machineId: t.String({ format: "uuid" }) }),
        body: t.Object({
          task_id: t.String({ format: "uuid" }),
          execution_profile_id: t.Optional(t.Union([t.Null(), t.String({ format: "uuid" })])),
          prompt_mode: t.Optional(t.Union([t.Literal("CONNECTED_CLI"), t.Literal("CONNECTED_MCP"), t.Literal("STANDALONE")])),
        }),
      },
    )

    // ── Auto-feed (business-workflow audit §Scheduler): pops the next
    // dependency-free READY task for this machine's AUTO_RUN links and pushes
    // it over the daemon's own WebSocket. The daemon calls this whenever it
    // goes idle — that is the whole "1 prompt runs everything" loop.
    .post(
      "/machines/:machineId/dispatch-next",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [machine] = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(and(eq(schema.localMachines.id, ctx.params.machineId), eq(schema.localMachines.userId, principal.userId)))
          .limit(1);
        if (!machine) throw (await import("@sdd/shared")).errors.notFound("Machine");
        if (machine.status === "REVOKED") throw (await import("@sdd/shared")).errors.forbidden("Machine is revoked");

        // The daemon serves exactly one linked repository (its working copy), so
        // it names the project; picking "any AUTO_RUN link" could dispatch a task
        // from a project whose code is not on disk where the daemon runs.
        const projectId = ctx.body?.project_id;
        const [autoLink] = await ctx.infra.db
          .select()
          .from(schema.repositoryLinks)
          .where(
            and(
              eq(schema.repositoryLinks.machineId, machine.id),
              eq(schema.repositoryLinks.status, "ACTIVE"),
              eq(schema.repositoryLinks.permissionMode, "AUTO_RUN"),
              ...(projectId ? [eq(schema.repositoryLinks.projectId, projectId)] : []),
            ),
          )
          .limit(1);
        if (!autoLink) {
          return { dispatched: false, reason: "NO_AUTO_RUN_LINK" };
        }
        await authorizeProjectAccess(ctx.infra.db, principal, autoLink.projectId, { scope: "task:execute" });

        const [next] = await findNextClaimable(ctx.infra.db, autoLink.projectId, 1);
        if (!next) {
          return { dispatched: false, reason: "EMPTY_QUEUE" };
        }

        const commandId = crypto.randomUUID();
        const result = await dispatchToMachine(machine.id, {
          type: "execute_task",
          command_id: commandId,
          task_id: next.id,
          task_key: next.key,
          project_id: autoLink.projectId,
          repository_link_id: autoLink.id,
          prompt_mode: "CONNECTED_CLI",
        });
        if (!result.acked) {
          return { dispatched: false, reason: result.reason };
        }
        await audit(ctx.infra.db, {
          workspaceId: (await ctx.infra.db.select().from(schema.projects).where(eq(schema.projects.id, autoLink.projectId)).limit(1))[0]!.workspaceId,
          projectId: autoLink.projectId,
          actorType: "SYSTEM",
          actorId: principal.userId,
          source: "DAEMON",
          action: "task.dispatched",
          entityType: "TASK",
          entityId: next.id,
          metadata: { machine_id: machine.id, command_id: commandId, scheduler: true },
        });
        return { dispatched: true, task: { id: next.id, key: next.key }, command_id: commandId };
      },
      {
        params: t.Object({ machineId: t.String({ format: "uuid" }) }),
        body: t.Optional(t.Object({ project_id: t.Optional(t.String({ format: "uuid" })) })),
      },
    );
}
