import { Elysia } from "elysia";
import { and, eq, desc } from "drizzle-orm";
import { createSddMcpHandler, mcpFailure, type McpToolFailure, type SddMcpDeps, type McpPrincipal, type SddMcpServices } from "@sdd/mcp";
import { resolveApiToken } from "@sdd/auth";
import { schema, type SddDatabase } from "@sdd/db";
import { DomainError, errors, sha256Hex } from "@sdd/shared";
import { authorizeProjectAccess, type Principal } from "../../context.js";
import type { Infra } from "../../infra.js";
import { clientIp, rateLimit } from "../../plugins.js";
import { buildContextPack } from "../prompt/service.js";
import { getProject } from "../project/service.js";
import { getApprovedRevision } from "../artifact/service.js";
import { getTask, getTaskByKey, listTasks } from "../task/repo.js";
import { notifyPendingReview, claimTask, heartbeatRun, startRun, reportProgress, reportTestResult, blockRun, submitRunForReview } from "../execution/service.js";
import { findNextClaimable } from "../execution/scheduler.js";
import { createBug } from "../bug/service.js";
import { runAutoReviewAllowed, reviewSubmittedRun } from "../review/automation.js";
import { nudgeAutoRunMachinesSoon } from "../agent/gateway.js";
/**
 * MCP mount (T131/T132): /mcp served by the API process. The same domain
 * services that back REST execute every tool call, with scoped-token
 * authorization and MCP-source audit attribution (FR-104).
 */

async function toMcpPrincipal(infra: Infra, bearer: string): Promise<McpPrincipal | null> {
  const row = await resolveApiToken(infra.db, bearer);
  if (!row) return null;
  return {
    userId: row.user.id,
    email: row.user.email,
    displayName: row.user.displayName,
    scopes: row.token.scopes,
    tokenId: row.token.id,
    tokenWorkspaceId: row.token.workspaceId,
    tokenProjectId: row.token.projectId,
    tokenMachineId: row.token.machineId,
  };
}

function asPrincipal(mcp: McpPrincipal): Principal {
  return {
    userId: mcp.userId,
    email: mcp.email,
    displayName: mcp.displayName,
    isOperator: false,
    source: "MCP",
    scopes: mcp.scopes as Principal["scopes"],
    tokenWorkspaceId: mcp.tokenWorkspaceId,
    tokenProjectId: mcp.tokenProjectId,
    tokenId: mcp.tokenId,
    tokenMachineId: mcp.tokenMachineId ?? null,
  };
}

/** A failed tool call: the MCP adapter turns this into `isError: true` so the
 * agent sees a failure, not a successful result that happens to say "error". */
function mcpError(error: unknown): McpToolFailure {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    const details = error instanceof DomainError ? (error.details ?? null) : null;
    return mcpFailure({ code: code ?? "INTERNAL", message: error.message, details });
  }
  return mcpFailure({ code: "INTERNAL", message: "Unknown error", details: null });
}

async function findProject(db: SddDatabase, principal: McpPrincipal, idOrKey: string) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(idOrKey)) return getProject(db, idOrKey);
  // Key form: resolve ONLY within the caller's own workspaces (and the token's
  // project/workspace narrowing) — project keys are not globally unique.
  const conditions = [eq(schema.projects.key, idOrKey.toUpperCase()), eq(schema.workspaceMembers.userId, principal.userId)];
  if (principal.tokenProjectId) conditions.push(eq(schema.projects.id, principal.tokenProjectId));
  if (principal.tokenWorkspaceId) conditions.push(eq(schema.projects.workspaceId, principal.tokenWorkspaceId));
  const rows = await db
    .select({ project: schema.projects })
    .from(schema.projects)
    .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.projects.workspaceId))
    .where(and(...conditions))
    .limit(2);
  if (rows.length === 0) throw errors.notFound("Project", idOrKey);
  if (rows.length > 1) {
    throw errors.conflict("PROJECT_KEY_AMBIGUOUS", `Project key ${idOrKey} exists in several of your workspaces — pass the project id instead`);
  }
  return rows[0]!.project;
}

async function resolveTaskFor(db: SddDatabase, principal: McpPrincipal, taskIdOrKey: string) {
  let task: typeof schema.tasks.$inferSelect | null = null;
  if (/^TASK-\d+$/i.test(taskIdOrKey)) {
    // Task keys are per-project (every project has a TASK-001), so a bare key
    // is only unambiguous inside the token's project or when exactly one of the
    // caller's projects has it. Never guess: claiming the wrong project's task
    // would run unrelated work.
    const conditions = [eq(schema.tasks.key, taskIdOrKey.toUpperCase()), eq(schema.workspaceMembers.userId, principal.userId)];
    if (principal.tokenProjectId) conditions.push(eq(schema.tasks.projectId, principal.tokenProjectId));
    if (principal.tokenWorkspaceId) conditions.push(eq(schema.projects.workspaceId, principal.tokenWorkspaceId));
    const rows = await db
      .select({ task: schema.tasks })
      .from(schema.tasks)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.tasks.projectId))
      .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.projects.workspaceId))
      .where(and(...conditions))
      .limit(2);
    if (rows.length > 1) {
      throw errors.conflict("TASK_KEY_AMBIGUOUS", `${taskIdOrKey.toUpperCase()} exists in several of your projects — pass the task id, or use a project-scoped token`);
    }
    task = rows[0]?.task ?? null;
  }
  if (!task) {
    task = await getTask(db, taskIdOrKey).catch(() => null);
  }
  if (!task) throw errors.notFound("Task", taskIdOrKey);
  // Authorization on every tool call (T132): cross-project access rejected.
  await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "task:read" });
  return task;
}

async function latestOwnedRun(db: SddDatabase, taskId: string, userId: string) {
  const [activeLease] = await db
    .select()
    .from(schema.taskLeases)
    .where(and(eq(schema.taskLeases.taskId, taskId), eq(schema.taskLeases.status, "ACTIVE"), eq(schema.taskLeases.executorId, userId)))
    .limit(1);
  if (activeLease) {
    const [run] = await db.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, activeLease.runId)).limit(1);
    if (run) return run;
  }
  const runs = await db.select().from(schema.taskRuns).where(eq(schema.taskRuns.taskId, taskId)).orderBy(desc(schema.taskRuns.attempt));
  const owned = runs.find((r) => r.executorId === userId && r.status !== "CANCELLED" && r.status !== "FINISHED") ?? runs.find((r) => r.executorId === userId);
  if (!owned) throw errors.conflict("NO_OWNED_RUN", "No active run owned by this executor — claim/start the task first");
  return owned;
}

export function buildMcpDeps(infra: Infra): SddMcpDeps {
  const db = infra.db;
  const actorOf = (principal: McpPrincipal) => ({ type: "MCP" as const, id: principal.userId, source: "MCP" as const });

  const services: SddMcpServices = {
    async projectContext(principal, idOrKey) {
      try {
        const project = await findProject(db, principal, idOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), project.id, { scope: "project:read" });
        const requirements = await getApprovedRevision(db, project.id, "requirements");
        const stack = await getApprovedRevision(db, project.id, "stack");
        const design = await getApprovedRevision(db, project.id, "design");
        const ready = await listTasks(db, project.id, { status: "READY", limit: 100 });
        return {
          project: { id: project.id, key: project.key, name: project.name, lifecycle: project.lifecycleStatus },
          active_revisions: {
            requirements: requirements ? { id: requirements.revision.id, version: requirements.revision.version } : null,
            stack: stack ? { id: stack.revision.id, version: stack.revision.version } : null,
            design: design ? { id: design.revision.id, version: design.revision.version } : null,
          },
          ready_task_count: ready.length,
          project_rules: project.projectRules,
        };
      } catch (error) {
        return mcpError(error);
      }
    },

    async listReadyTasks(principal, idOrKey, limit) {
      try {
        const project = await findProject(db, principal, idOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), project.id, { scope: "task:read" });
        const tasks = await listTasks(db, project.id, { status: "READY", limit });
        return {
          tasks: tasks.map((t) => ({
            key: t.key,
            title: t.title,
            task_type: t.taskType,
            hardness: t.hardness,
            risk: t.riskLevel,
            priority: t.priority,
            parallel_safe: t.parallelSafe,
          })),
        };
      } catch (error) {
        return mcpError(error);
      }
    },

    async nextTask(principal, idOrKey, limit) {
      try {
        const project = await findProject(db, principal, idOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), project.id, { scope: "task:read" });
        const queue = await findNextClaimable(db, project.id, limit);
        return {
          project_id: project.id,
          queue: queue.map((t) => ({
            position: t.position,
            key: t.key,
            title: t.title,
            task_type: t.taskType,
            priority: t.priority,
            hardness: t.hardness,
            parallel_safe: t.parallelSafe,
          })),
        };
      } catch (error) {
        return mcpError(error);
      }
    },

    async taskContext(principal, taskIdOrKey) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        return await buildContextPack(db, task);
      } catch (error) {
        return mcpError(error);
      }
    },

    async claimTask(principal, taskIdOrKey, executorId) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "task:execute" });
        const machineId = principal.tokenMachineId ?? null;
        if (machineId) {
          const [machine] = await db.select().from(schema.localMachines).where(and(eq(schema.localMachines.id, machineId), eq(schema.localMachines.userId, principal.userId))).limit(1);
          if (!machine || machine.status === "REVOKED") throw errors.forbidden("Token machine is not an active machine owned by you");
        }
        return await claimTask(db, {
          taskId: task.id,
          machineId,
          body: { executor: { type: "MCP_CLIENT", id: executorId }, lease_seconds: 900 },
          actor: actorOf(principal),
        });
      } catch (error) {
        return mcpError(error);
      }
    },

    async startTask(principal, taskIdOrKey) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "run:write" });
        const run = await latestOwnedRun(db, task.id, principal.userId);
        return await startRun(db, { runId: run.id, actor: actorOf(principal) });
      } catch (error) {
        return mcpError(error);
      }
    },

    async heartbeat(principal, taskIdOrKey, leaseSeconds) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "run:write" });
        const run = await latestOwnedRun(db, task.id, principal.userId);
        return await heartbeatRun(db, { runId: run.id, actorId: principal.userId, leaseSeconds });
      } catch (error) {
        return mcpError(error);
      }
    },

    async reportProgress(principal, taskIdOrKey, body) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "run:write" });
        const run = await latestOwnedRun(db, task.id, principal.userId);
        return await reportProgress(db, {
          runId: run.id,
          body: { type: "progress_reported", message: body.message, progress: body.progress },
          actor: actorOf(principal),
        });
      } catch (error) {
        return mcpError(error);
      }
    },

    async reportTest(principal, taskIdOrKey, body) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "run:write" });
        const run = await latestOwnedRun(db, task.id, principal.userId);
        return await reportTestResult(db, {
          runId: run.id,
          body: {
            command: body.command,
            status: body.status as "PASSED" | "FAILED" | "ERROR" | "SKIPPED",
            exit_code: body.exit_code,
            duration_ms: body.duration_ms,
            summary: body.summary,
          },
          actor: actorOf(principal),
        });
      } catch (error) {
        return mcpError(error);
      }
    },

    async blockTask(principal, taskIdOrKey, body) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "run:write" });
        const run = await latestOwnedRun(db, task.id, principal.userId);
        return await blockRun(db, { runId: run.id, body: { reason_code: body.reason_code, message: body.message }, actor: actorOf(principal) });
      } catch (error) {
        return mcpError(error);
      }
    },

    async requestReview(principal, taskIdOrKey, body) {
      try {
        const task = await resolveTaskFor(db, principal, taskIdOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), task.projectId, { scope: "run:submit" });
        const run = await latestOwnedRun(db, task.id, principal.userId);
        if (principal.tokenMachineId && run.machineId && principal.tokenMachineId !== run.machineId) throw errors.forbidden("Run belongs to a different machine");
        const submitted = await submitRunForReview(db, {
          runId: run.id,
          deferReviewNotification: true,
          body: { summary: body.summary, commit_sha: body.commit_sha, files_changed: body.files_changed ?? [], evidence: body.evidence },
          actor: actorOf(principal),
        });
        const allowed = await runAutoReviewAllowed(db, task.projectId, principal.userId, run, principal.tokenMachineId);
        const reviewed = await reviewSubmittedRun(infra.gateway(), db, run.id, principal.userId, allowed);
        if (reviewed.auto_approved || reviewed.changes_requested) nudgeAutoRunMachinesSoon(db, task.projectId);
        await notifyPendingReview(db, await getTask(db, task.id), run.id, body.summary);
        return { ...submitted, ...reviewed };
      } catch (error) {
        return mcpError(error);
      }
    },

    async reportBug(principal, idOrKey, body) {
      try {
        const project = await findProject(db, principal, idOrKey);
        await authorizeProjectAccess(db, asPrincipal(principal), project.id, { write: true, scope: "bug:write" });
        let taskId: string | null = null;
        if (body.task_key) {
          const task = await getTaskByKey(db, project.id, body.task_key.toUpperCase());
          taskId = task.id;
        }
        const bug = await createBug(db, {
          projectId: project.id,
          body: {
            title: body.title,
            severity: "MAJOR",
            current_behavior: body.current_behavior,
            expected_behavior: body.expected_behavior,
            unchanged_behavior: body.unchanged_behavior ?? "",
            reproduction: body.reproduction,
            task_id: taskId,
          },
          actor: { type: "MCP", id: principal.userId },
        });
        return { bug: { key: bug.key, id: bug.id, status: bug.status } };
      } catch (error) {
        return mcpError(error);
      }
    },
  };

  return { resolvePrincipal: (bearer) => toMcpPrincipal(infra, bearer), services };
}

/** Elysia mount: delegate POST /mcp to the stateless MCP handler. */
export function mcpRoutes(infra: Infra) {
  const handler = createSddMcpHandler(buildMcpDeps(infra));
  // RATE_LIMIT_MCP_MAX applies to the MCP surface itself, keyed by the bearer
  // token (hashed) so one agent cannot starve the instance.
  const limited = async (ctx: { request: Request; server?: unknown }) => {
    const bearer = ctx.request.headers.get("authorization") ?? "";
    const key = bearer ? `mcp:tok:${sha256Hex(bearer).slice(0, 32)}` : `mcp:ip:${clientIp(ctx as never, infra.config.SDD_TRUST_PROXY)}`;
    try {
      await rateLimit(infra, "MCP", key);
    } catch (error) {
      if (error instanceof DomainError) {
        return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
          status: error.status,
          headers: { "content-type": "application/json", ...(error.status === 429 ? { "retry-after": "60" } : {}) },
        });
      }
      throw error;
    }
    return handler(ctx.request);
  };
  // The MCP SDK reads the raw Request body; Elysia must not consume it first.
  return new Elysia({ tags: ["mcp"] })
    .post("/mcp", limited, { parse: "none" })
    .post("/mcp/*", limited, { parse: "none" });
}
