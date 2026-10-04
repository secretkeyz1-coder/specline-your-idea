import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { TaskContractSchema } from "@sdd/contracts";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { buildContextPack, generateTaskPrompt } from "../prompt/service.js";
import { mintSelfConnectCode, selfConnectOptions } from "../agent/pairing.js";
import {
  addTaskRequirementLink,
  computeTaskReadiness,
  generateTasks,
  mergeTasks,
  parallelCandidates,
  readyTask,
  rebaseTasksToApprovedRevisions,
  splitTask,
  updateDraftTask,
} from "./service.js";
import {
  addDependency,
  dependenciesOf,
  dependentsOf,
  getTask,
  listTasks,
  removeDependency,
  traceabilityOf,
  validateProjectGraph,
} from "./repo.js";
import { errors } from "@sdd/shared";
import { nudgeAutoRunMachinesSoon } from "../agent/gateway.js";
import { dependencyEditAllowed } from "./repo.js";
import { screenFilesOf } from "./lint.js";
import { addRenderCheck, screenReviewOf } from "./screen-review.js";
import { approvedUxReference } from "../ux/ux.js";

/** Execution order is fixed once work starts: only DRAFT/READY tasks take dependency edits. */
function assertDependenciesEditable(task: { key: string; workflowStatus: string }): void {
  if (!dependencyEditAllowed(task.workflowStatus)) {
    throw errors.conflict("DEPENDENCIES_LOCKED", `${task.key} is ${task.workflowStatus}; dependencies can only change while a task is DRAFT or READY`);
  }
}

/** Task planning APIs (T093, docs/09 §7–8). */

export function taskRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["tasks"] }).use(authPlugin(infra))

    .post(
      "/projects/:projectId/tasks/generate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `tasks:${principal.userId}`);
        return generateTasks(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({ feature_id: t.Optional(t.Union([t.Null(), t.String({ format: "uuid" })])) }),
      },
    )

    .get(
      "/projects/:projectId/tasks",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        const tasks = await listTasks(ctx.infra.db, ctx.params.projectId, {
          status: (ctx.query.status as never) || undefined,
          featureId: ctx.query.feature_id || undefined,
          q: ctx.query.q || undefined,
          limit: ctx.query.limit ? Number(ctx.query.limit) : undefined,
          offset: ctx.query.offset ? Number(ctx.query.offset) : undefined,
        });
        return { tasks };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        query: t.Object({
          status: t.Optional(t.String()),
          feature_id: t.Optional(t.String()),
          q: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          offset: t.Optional(t.String()),
        }),
      },
    )

    .get(
      "/projects/:projectId/task-graph/validate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        return validateProjectGraph(ctx.infra.db, ctx.params.projectId);
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/projects/:projectId/tasks/parallel-candidates",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        return { groups: await parallelCandidates(ctx.infra.db, ctx.params.projectId) };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/projects/:projectId/tasks/rebase",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        const count = await rebaseTasksToApprovedRevisions(ctx.infra.db, ctx.params.projectId);
        return { rebased: count };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/projects/:projectId/tasks/manual",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        const { persistTaskPlan } = await import("./service.js");
        const { getApprovedRevision } = await import("../artifact/service.js");
        const contract = TaskContractSchema.parse(ctx.body.contract);
        // Lineage for the readiness gate (C6/C9): record which approved
        // revisions this task was authored against. Without this, a non-
        // infrastructure task could NEVER satisfy `artifactsCurrent` (which
        // requires the task to cite the approved requirements AND stack), so
        // every manually created code task was permanently unable to reach
        // READY.
        const approvedReq = await getApprovedRevision(ctx.infra.db, ctx.params.projectId, "requirements");
        const approvedStack = await getApprovedRevision(ctx.infra.db, ctx.params.projectId, "stack");
        const revisionRefs = [
          ...(approvedReq ? [{ artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version }] : []),
          ...(approvedStack ? [{ artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version }] : []),
        ];
        const result = await persistTaskPlan(ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          plan: {
            features: [],
            generation_notes: "manually created task",
            tasks: [
              {
                ref: `manual-${Date.now()}`,
                title: contract.title,
                task_type: contract.task_type,
                feature_hint: "",
                objective: contract.objective,
                requirement_keys: ctx.body.requirement_keys ?? [],
                acceptance_criterion_keys: [],
                depends_on_refs: [],
                scope: contract.scope,
                constraints: contract.constraints,
                ui_screen_keys: contract.ui_screen_keys,
                acceptance_criteria: contract.acceptance_criteria,
                verification: contract.verification,
                deliverables: contract.deliverables,
                stop_conditions: contract.stop_conditions,
                risk_factors: contract.risk_factors,
                parallel_safe: contract.parallel_safe,
                priority: contract.priority,
              },
            ],
          },
          revisionRefs,
        });
        return { tasks: result.tasks };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          contract: t.Unknown(),
          requirement_keys: t.Optional(t.Array(t.String(), { maxItems: 10 })),
        }),
        detail: { summary: "Create a single draft task manually" },
      },
    )

    .get(
      "/tasks/:taskId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        return {
          task,
          dependencies: (await dependenciesOf(ctx.infra.db, task.id)).map((d) => ({ id: d.task.id, key: d.task.key, title: d.task.title, status: d.task.workflowStatus })),
          dependents: (await dependentsOf(ctx.infra.db, task.id)).map((d) => ({ id: d.task.id, key: d.task.key, title: d.task.title, status: d.task.workflowStatus })),
          traceability: (await traceabilityOf(ctx.infra.db, task.id)).map((l) => ({
            requirement_key: l.requirement.key,
            requirement_title: l.requirement.title,
            ac_key: l.ac?.key ?? null,
          })),
          // What a reviewer checks on a screen task; null for any other task.
          screen_review: screenFilesOf(task.contract).length ? screenReviewOf(task.contract, await approvedUxReference(ctx.infra.db, task.projectId)) : null,
        };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/tasks/:taskId/agent-context",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        return buildContextPack(ctx.infra.db, task);
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/tasks/:taskId/prompt",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        return generateTaskPrompt(ctx.infra.db, {
          taskId: task.id,
          userId: principal.userId,
          source: principal.source === "MCP" ? "MCP" : principal.source === "WEB" ? "WEB" : "CLI",
          mode: ctx.body.mode,
        });
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          mode: t.Union([t.Literal("STANDALONE"), t.Literal("CONNECTED_CLI"), t.Literal("CONNECTED_MCP")]),
        }),
      },
    )

    .post(
      "/tasks/:taskId/lint",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        const refreshed = await computeTaskReadiness(ctx.infra.db, task);
        return { readiness: refreshed.readinessStatus, report: refreshed.readinessReport, findings: refreshed.lintFindings };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/tasks/:taskId/ready",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        const readied = await readyTask(ctx.infra.db, { taskId: task.id, userId: principal.userId, source: principal.source });
        nudgeAutoRunMachinesSoon(ctx.infra.db, task.projectId);
        return { task: readied };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .patch(
      "/tasks/:taskId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        return { task: await updateDraftTask(ctx.infra.db, { taskId: task.id, userId: principal.userId, patch: ctx.body as never }) };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Unknown(),
      },
    )

    .post(
      "/tasks/:taskId/render-check",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        return { task: await addRenderCheck(ctx.infra.db, { taskId: task.id, userId: principal.userId }) };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/tasks/:taskId/split",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        return splitTask(ctx.infra.db, { taskId: task.id, userId: principal.userId, parts: ctx.body.parts });
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          parts: t.Array(
            t.Object({
              title: t.String({ minLength: 1, maxLength: 200 }),
              objective: t.String({ minLength: 1, maxLength: 4000 }),
              acceptance_criteria: t.Array(t.String(), { minItems: 1, maxItems: 8 }),
            }),
            { minItems: 2, maxItems: 6 },
          ),
        }),
      },
    )

    .post(
      "/projects/:projectId/tasks/merge",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        const merged = await mergeTasks(ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          taskIds: ctx.body.task_ids,
        });
        return { task: merged };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({ task_ids: t.Array(t.String({ format: "uuid" }), { minItems: 2, maxItems: 6 }) }),
      },
    )

    .post(
      "/tasks/:taskId/dependencies",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        const dep = await getTask(ctx.infra.db, ctx.body.depends_on_task_id);
        if (dep.projectId !== task.projectId) throw errors.forbidden("Dependency must be in the same project");
        assertDependenciesEditable(task);
        await addDependency(ctx.infra.db, task.id, dep.id, { onlyEditable: true });
        return { ok: true };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({ depends_on_task_id: t.String({ format: "uuid" }) }),
      },
    )

    // Traceability editing for DRAFT tasks (fix tasks, manual tasks).
    .post(
      "/tasks/:taskId/requirement-links",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        return {
          task: await addTaskRequirementLink(ctx.infra.db, {
            taskId: task.id,
            requirementKey: ctx.body.requirement_key,
            acceptanceCriterionKey: ctx.body.acceptance_criterion_key ?? null,
          }),
        };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          requirement_key: t.String({ minLength: 1, maxLength: 40 }),
          acceptance_criterion_key: t.Optional(t.String({ minLength: 1, maxLength: 40 })),
        }),
      },
    )

    .delete(
      "/tasks/:taskId/dependencies/:dependencyTaskId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        assertDependenciesEditable(task);
        await removeDependency(ctx.infra.db, task.id, ctx.params.dependencyTaskId);
        return { ok: true };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }), dependencyTaskId: t.String({ format: "uuid" }) }),
      },
    )

    // ── Execution prompt: 1 master prompt for a local AI agent to work
    // through ALL tasks sequentially, using sddctl for lifecycle management ──
    .get(
      "/projects/:projectId/execution-prompt",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const project = (await ctx.infra.db.select().from(schema.projects).where(eq(schema.projects.id, ctx.params.projectId)).limit(1))[0];
        if (!project) throw (await import("@sdd/shared")).errors.notFound("Project");
        await authorizeProjectAccess(ctx.infra.db, principal, project.id, { scope: "task:read" });
        // Copied from the web app, the prompt carries a single-use connect
        // code so the agent is signed in by `sddctl connect` — no device flow.
        const connect = await mintSelfConnectCode(ctx.infra, principal, project, ctx.query.auto_approve === undefined ? undefined : ctx.query.auto_approve === "true");
        const { generateExecutionPrompt } = await import("./service.js");
        const prompt = await generateExecutionPrompt(ctx.infra.db, project, { serverUrl: ctx.infra.config.API_PUBLIC_URL, connect });
        return { prompt, connect_expires_at: connect?.expiresAt.toISOString() ?? null };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        query: t.Object({ auto_approve: t.Optional(t.Union([t.Literal("true"), t.Literal("false")])) }),
      },
    )

    .get(
      "/projects/:projectId/execution-prompt/options",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        return selfConnectOptions(ctx.infra.db, principal, ctx.params.projectId);
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    );
}
