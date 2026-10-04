import { Elysia, t } from "elysia";
import { and, desc, eq, ne, inArray } from "drizzle-orm";
import { schema, type SddDatabase } from "@sdd/db";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { subscribe } from "../../events/bus.js";
import { isDaemonRun, notifyPendingReview, cancelTask, claimTask, heartbeatRun, listTaskEvents, openMachineRuns, recordManualRun, blockRun, reportProgress, reportTestResult, startRun, submitRunForReview, unblockTask, type ActorInput } from "./service.js";
import { daemonResumeBlocker, dispatchResume, nudgeAutoRunMachinesSoon, stopRunsOnMachines } from "../agent/gateway.js";
import { executionSummary, findNextClaimable } from "./scheduler.js";
import { runAutoReviewAllowed, reviewSubmittedRun } from "../review/automation.js";
import { createReview, listReviewsForTask, requeueTask } from "../review/service.js";
import { getTask } from "../task/repo.js";
import { renderCheckCommand, screenFilesOf } from "../task/lint.js";
import { autoApproveWithheld } from "../task/screen-review.js";
import { approvedUxReference } from "../ux/ux.js";
import { getProject } from "../project/service.js";
import { errors } from "@sdd/shared";

/** Execution + review REST APIs (T117/T152, docs/09 §9–16). */

function actorOf(principal: { userId: string; source: string }, executorId?: string): ActorInput {
  const type: ActorInput["type"] = principal.source === "WEB" ? "USER" : principal.source === "CLI" ? "LOCAL_AGENT" : principal.source === "MCP" ? "MCP" : "DAEMON";
  return { type, id: executorId ?? principal.userId, source: principal.source as import("../audit/service.js").AuditSource };
}

export function executionRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["execution"] }).use(authPlugin(infra))

    // ── Scheduler: the single authority for "what may run next" (docs/12) ──
    .get(
      "/projects/:projectId/scheduler/next",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        const [head] = await findNextClaimable(ctx.infra.db, ctx.params.projectId, 1);
        return { task: head ?? null };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/projects/:projectId/scheduler/queue",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        return { queue: await findNextClaimable(ctx.infra.db, ctx.params.projectId, 50) };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/projects/:projectId/scheduler/summary",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "task:read" });
        const summary = await executionSummary(ctx.infra.db, ctx.params.projectId);
        const queue = await findNextClaimable(ctx.infra.db, ctx.params.projectId, 5);
        return { summary, next: queue[0] ?? null };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/tasks/:taskId/claim",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:execute" });
        await rateLimit(ctx.infra, "MCP", `claim:${principal.userId}`);
        // An sdd-agent names its machine so cancel/requeue/resume can reach the
        // process running the work. It must be the caller's own live machine.
        const machineId = ctx.body.machine_id ?? principal.tokenMachineId ?? null;
        if (machineId) {
          const [machine] = await ctx.infra.db
            .select({ id: schema.localMachines.id })
            .from(schema.localMachines)
            .where(and(eq(schema.localMachines.id, machineId), eq(schema.localMachines.userId, principal.userId), ne(schema.localMachines.status, "REVOKED")))
            .limit(1);
          if (!machine || (principal.tokenMachineId && principal.tokenMachineId !== machineId)) throw errors.forbidden("machine_id is not one of your machines");
        }
        return claimTask(ctx.infra.db, {
          machineId,
          daemonExecution: ctx.body.machine_id !== undefined,
          taskId: task.id,
          body: {
            executor: {
              type: ctx.body.executor.type,
              id: ctx.body.executor.id,
            },
            lease_seconds: ctx.body.lease_seconds ?? 900,
          },
          // Identity = authenticated principal; the declared executor id is
          // metadata on the run, never the lease owner (docs/12 §4).
          actor: actorOf(principal),
        });
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          executor: t.Object({ type: t.Union([t.Literal("LOCAL_AGENT"), t.Literal("MCP_CLIENT"), t.Literal("MANUAL")]), id: t.String({ minLength: 1 }) }),
          lease_seconds: t.Optional(t.Number({ minimum: 60, maximum: 3600 })),
          machine_id: t.Optional(t.String({ format: "uuid" })),
        }),
      },
    )

    .post(
      "/runs/:runId/start",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run, task } = await runForPrincipal(ctx.infra.db, ctx.params.runId, principal.userId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:write" });
        return startRun(ctx.infra.db, { runId: run.id, actor: actorOf(principal) });
      },
      { params: t.Object({ runId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/runs/:runId/heartbeat",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run, task } = await runForPrincipal(ctx.infra.db, ctx.params.runId, principal.userId);
        // A removed member (or a token for another project) must not be able to
        // keep a lease alive indefinitely.
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:write" });
        return heartbeatRun(ctx.infra.db, {
          runId: run.id,
          actorId: principal.userId,
          leaseSeconds: ctx.body.lease_seconds ?? 900,
          note: ctx.body.note,
        });
      },
      {
        params: t.Object({ runId: t.String({ format: "uuid" }) }),
        body: t.Object({ lease_seconds: t.Optional(t.Number({ minimum: 60, maximum: 3600 })), note: t.Optional(t.String()) }),
      },
    )

    .post(
      "/runs/:runId/events",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run, task } = await runForPrincipal(ctx.infra.db, ctx.params.runId, principal.userId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:write" });
        return reportProgress(ctx.infra.db, {
          runId: run.id,
          body: {
            type: ctx.body.type,
            client_sequence: ctx.body.client_sequence,
            message: ctx.body.message,
            progress: ctx.body.progress,
            files_changed: ctx.body.files_changed,
            idempotency_key: ctx.body.idempotency_key ?? ctx.request.headers.get("idempotency-key") ?? undefined,
          },
          actor: actorOf(principal),
        });
      },
      {
        params: t.Object({ runId: t.String({ format: "uuid" }) }),
        body: t.Object({
          type: t.Union([t.Literal("progress_reported"), t.Literal("file_change_reported"), t.Literal("validation_started"), t.Literal("validation_completed")]),
          client_sequence: t.Optional(t.Number({ minimum: 0 })),
          message: t.Optional(t.String({ maxLength: 2000 })),
          progress: t.Optional(t.Object({ completed_steps: t.Number(), total_steps: t.Number() })),
          files_changed: t.Optional(t.Array(t.String(), { maxItems: 100 })),
          idempotency_key: t.Optional(t.String({ maxLength: 200 })),
        }),
      },
    )

    .post(
      "/runs/:runId/tests",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run, task } = await runForPrincipal(ctx.infra.db, ctx.params.runId, principal.userId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:write" });
        return reportTestResult(ctx.infra.db, {
          runId: run.id,
          body: {
            command: ctx.body.command,
            suite: ctx.body.suite,
            status: ctx.body.status,
            exit_code: ctx.body.exit_code,
            duration_ms: ctx.body.duration_ms,
            summary: ctx.body.summary,
            artifact_ref: ctx.body.artifact_ref,
            // An explicit body key names the logical report; the header is a
            // transport-level fallback and must not override it.
            idempotency_key: ctx.body.idempotency_key ?? ctx.request.headers.get("idempotency-key") ?? undefined,
          },
          actor: actorOf(principal),
        });
      },
      {
        params: t.Object({ runId: t.String({ format: "uuid" }) }),
        body: t.Object({
          command: t.String({ minLength: 1, maxLength: 600 }),
          suite: t.Optional(t.String()),
          status: t.Union([t.Literal("PASSED"), t.Literal("FAILED"), t.Literal("ERROR"), t.Literal("SKIPPED")]),
          exit_code: t.Optional(t.Number()),
          duration_ms: t.Optional(t.Number({ minimum: 0 })),
          summary: t.Optional(t.String({ maxLength: 4000 })),
          artifact_ref: t.Optional(t.String()),
          idempotency_key: t.Optional(t.String()),
        }),
      },
    )

    .post(
      "/runs/:runId/block",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run, task } = await runForPrincipal(ctx.infra.db, ctx.params.runId, principal.userId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:write" });
        return blockRun(ctx.infra.db, {
          runId: run.id,
          body: { reason_code: ctx.body.reason_code, message: ctx.body.message },
          actor: actorOf(principal),
        });
      },
      {
        params: t.Object({ runId: t.String({ format: "uuid" }) }),
        body: t.Object({ reason_code: t.String({ minLength: 1, maxLength: 80 }), message: t.String({ minLength: 1, maxLength: 2000 }) }),
      },
    )

    .post(
      "/runs/:runId/request-review",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run, task } = await runForPrincipal(ctx.infra.db, ctx.params.runId, principal.userId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:submit" });
        if (principal.tokenMachineId && run.machineId && principal.tokenMachineId !== run.machineId) throw errors.forbidden("Run belongs to a different machine");
        const submitted = await submitRunForReview(ctx.infra.db, {
          runId: run.id,
          deferReviewNotification: true,
          body: {
            summary: ctx.body.summary,
            commit_sha: ctx.body.commit_sha,
            files_changed: ctx.body.files_changed ?? [],
            exit_code: ctx.body.exit_code,
            evidence: ctx.body.evidence,
          },
          actor: actorOf(principal),
        });

        // ── Autonomous review policy (business-workflow audit §Execution) ──
        // When the machine runs under an AUTO_RUN repository link (or the task
        // itself is low-risk AUTO_APPROVE_ALLOWED) and every reported
        // verification passed, the control plane's review-policy automation —
        // never the implementer — closes the task. C15 is preserved: the
        // decision is made by the SYSTEM actor under an explicit policy, and
        // the review record stays auditable.
        // Only the run's persisted claim-time machine attribution can authorize
        // automation. Submission credentials or body cannot bind a legacy unbound run.
        // Auto-approve fires ONLY for AUTO_RUN machines AND non-HUMAN_REQUIRED
        // tasks. HUMAN_REQUIRED (high-risk: security/encryption, docs/11 §8)
        // always parks at NEEDS_REVIEW for a human reviewer — the policy
        // automation must never approve high-risk work (docs/12 §4).
        const humanRequired = task.reviewPolicy === "HUMAN_REQUIRED";
        // Evidence was already enforced per required command by
        // submitRunForReview; a contract with no required verification has
        // nothing machine-checkable, so it always goes to a human.
        const hasRequiredEvidence = (task.contract.verification?.required ?? []).length > 0;
        const autoMode = !humanRequired && hasRequiredEvidence && await runAutoReviewAllowed(ctx.infra.db, task.projectId, principal.userId, run, principal.tokenMachineId);
        // A screen is approved by policy only once its render check passed: a
        // web screen task without one has shown nobody the screen (docs/28 R7).
        const ux = autoMode && screenFilesOf(task.contract).length ? await approvedUxReference(ctx.infra.db, task.projectId) : null;
        const withheld = autoMode ? autoApproveWithheld(task.contract, ux) : null;
        if (withheld) {
          await notifyPendingReview(ctx.infra.db, submitted.task, run.id, ctx.body.summary);
          return { ...submitted, auto_approve_withheld: withheld };
        }
        ctx.server?.timeout(ctx.request, 0);
        const reviewed = await reviewSubmittedRun(ctx.infra.gateway(), ctx.infra.db, run.id, principal.userId, autoMode);
        if (reviewed.auto_approved || reviewed.changes_requested) nudgeAutoRunMachinesSoon(ctx.infra.db, task.projectId);
        await notifyPendingReview(ctx.infra.db, await getTask(ctx.infra.db, task.id), run.id, ctx.body.summary);
        return { ...submitted, ...reviewed };
      },
      {
        params: t.Object({ runId: t.String({ format: "uuid" }) }),
        body: t.Object({
          summary: t.String({ minLength: 1, maxLength: 8000 }),
          commit_sha: t.Optional(t.Union([t.Null(), t.String({ maxLength: 80 })])),
          files_changed: t.Optional(t.Array(t.String({ maxLength: 300 }), { maxItems: 200 })),
          exit_code: t.Optional(t.Number()),
          machine_id: t.Optional(t.String({ format: "uuid" })),
          evidence: t.Optional(t.Any()),
        }),
      },
    )

    .post(
      "/tasks/:taskId/manual-run",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "run:submit" });
        return recordManualRun(ctx.infra.db, {
          taskId: task.id,
          userId: principal.userId,
          source: principal.source,
          summary: ctx.body.summary,
          commitSha: ctx.body.commit_sha,
          filesChanged: ctx.body.files_changed,
          exitCode: ctx.body.exit_code,
          testResults: ctx.body.test_results,
          evidence: ctx.body.evidence,
        });
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          summary: t.String({ minLength: 1, maxLength: 8000 }),
          commit_sha: t.Optional(t.Union([t.Null(), t.String({ maxLength: 80 })])),
          files_changed: t.Optional(t.Array(t.String(), { maxItems: 200 })),
          exit_code: t.Optional(t.Number()),
          evidence: t.Optional(t.Any()),
          // Pasted verification evidence: one entry per required command.
          test_results: t.Optional(
            t.Array(
              t.Object({
                command: t.String({ minLength: 1, maxLength: 600 }),
                status: t.Union([t.Literal("PASSED"), t.Literal("FAILED"), t.Literal("ERROR"), t.Literal("SKIPPED")]),
                exit_code: t.Optional(t.Union([t.Null(), t.Number()])),
                summary: t.Optional(t.Union([t.Null(), t.String({ maxLength: 4000 })])),
              }),
              { maxItems: 20 },
            ),
          ),
        }),
        detail: { summary: "Manual fallback: record an externally executed run (C17)" },
      },
    )

    .get(
      "/tasks/:taskId/events",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        return { events: await listTaskEvents(ctx.infra.db, task.id) };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/tasks/:taskId/runs",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        const runs = await ctx.infra.db.select().from(schema.taskRuns).where(eq(schema.taskRuns.taskId, task.id)).orderBy(desc(schema.taskRuns.attempt));
        const tests = runs.length ? await ctx.infra.db.select().from(schema.testResults).where(inArray(schema.testResults.runId, runs.map(r => r.id))) : [];
        const out = runs.map(run => ({ run: { ...run, metadata: { ai_review: run.metadata?.ai_review ?? null } }, tests: tests.filter(t => t.runId === run.id) }));
        return { runs: out };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/tasks/:taskId/reviews",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        return { reviews: await listReviewsForTask(ctx.infra.db, task.id) };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/reviews",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.body.task_id);
        const access = await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "review:approve" });
        if (ctx.body.decision === "WAIVED" && !access.canAdmin) {
          throw errors.forbidden("Only workspace admins can waive a review");
        }
        const result = await createReview(ctx.infra.db, {
          body: {
            task_id: ctx.body.task_id,
            run_id: ctx.body.run_id,
            decision: ctx.body.decision,
            summary: ctx.body.summary ?? "",
            findings: (ctx.body.findings ?? []).map((f) => ({ severity: f.severity, message: f.message })),
          },
          actor: actorOf(principal),
        });
        // An approval can unlock dependent tasks: wake idle auto-run machines.
        if (result.task.workflowStatus === "DONE") nudgeAutoRunMachinesSoon(ctx.infra.db, task.projectId);
        return result;
      },
      {
        body: t.Object({
          task_id: t.String({ format: "uuid" }),
          run_id: t.Optional(t.String({ format: "uuid" })),
          decision: t.Union([t.Literal("APPROVED"), t.Literal("CHANGES_REQUESTED"), t.Literal("REJECTED"), t.Literal("WAIVED")]),
          summary: t.Optional(t.String({ maxLength: 4000 })),
          findings: t.Optional(
            t.Array(
              t.Object({
                severity: t.Union([t.Literal("BLOCKING"), t.Literal("HIGH"), t.Literal("MEDIUM"), t.Literal("LOW"), t.Literal("INFO")]),
                message: t.String({ maxLength: 1000 }),
              }),
              { maxItems: 30 },
            ),
          ),
        }),
      },
    )

    .post(
      "/tasks/:taskId/requeue",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "task:execute" });
        const running = await openMachineRuns(ctx.infra.db, task.id);
        const requeued = await requeueTask(ctx.infra.db, { taskId: task.id, userId: principal.userId, source: principal.source });
        // The retired attempt must not keep editing the working copy.
        stopRunsOnMachines(running, "requeued");
        nudgeAutoRunMachinesSoon(ctx.infra.db, task.projectId);
        return { task: requeued };
      },
      { params: t.Object({ taskId: t.String({ format: "uuid" }) }) },
    )

    // BLOCKED is not a dead end: a human decides to requeue or resume (docs/12 §3).
    .post(
      "/tasks/:taskId/unblock",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "task:execute" });
        const mode = ctx.body.mode ?? "ready";
        const [blockedRun] = await ctx.infra.db
          .select()
          .from(schema.taskRuns)
          .where(and(eq(schema.taskRuns.taskId, task.id), eq(schema.taskRuns.status, "BLOCKED")))
          .orderBy(desc(schema.taskRuns.attempt))
          .limit(1);
        // A daemon run has no one at the keyboard: "resume" only makes sense
        // when its machine can be handed the run again right now.
        if (mode === "resume" && blockedRun && isDaemonRun(blockedRun)) {
          const blocker = await daemonResumeBlocker(ctx.infra.db, blockedRun, task.projectId);
          if (blocker) throw errors.conflict("RESUME_NEEDS_MACHINE", blocker, { machine_id: blockedRun.machineId, suggested_mode: "ready" });
        }
        const running = mode === "ready" ? await openMachineRuns(ctx.infra.db, task.id) : [];
        const updated = await unblockTask(ctx.infra.db, {
          taskId: task.id,
          mode,
          note: ctx.body.note,
          actor: actorOf(principal),
        });
        if (mode === "ready") {
          stopRunsOnMachines(running, "unblocked to READY");
          nudgeAutoRunMachinesSoon(ctx.infra.db, task.projectId);
          return { task: updated };
        }
        if (blockedRun && isDaemonRun(blockedRun)) {
          const dispatched = await dispatchResume(ctx.infra.db, blockedRun, task);
          return { task: updated, resume_dispatched: dispatched.acked, ...(dispatched.acked ? {} : { resume_reason: dispatched.reason }) };
        }
        return { task: updated };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({
          mode: t.Optional(t.Union([t.Literal("ready"), t.Literal("resume")])),
          note: t.Optional(t.String({ maxLength: 2000 })),
        }),
      },
    )

    .post(
      "/tasks/:taskId/cancel",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { write: true, scope: "artifact:write" });
        const running = await openMachineRuns(ctx.infra.db, task.id);
        const cancelled = await cancelTask(ctx.infra.db, { taskId: task.id, reason: ctx.body.reason, actor: actorOf(principal) });
        stopRunsOnMachines(running, "cancelled");
        return { task: cancelled };
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        body: t.Object({ reason: t.String({ minLength: 1, maxLength: 2000 }) }),
      },
    );
}

async function runForPrincipal(db: SddDatabase, runId: string, userId: string) {
  const [run] = await db.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, runId)).limit(1);
  if (!run) throw (await import("@sdd/shared")).errors.notFound("Run", runId);
  const task = await getTask(db, run.taskId);
  void userId;
  return { run, task };
}

/** SSE subscription endpoint (T141, docs/09 §23). */
export function sseRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["realtime"] }).use(authPlugin(infra)).get(
    "/projects/:projectId/events",
    async (ctx) => {
      const principal = ensurePrincipal(ctx);
      const project = await getProject(ctx.infra.db, ctx.params.projectId);
      await authorizeProjectAccess(ctx.infra.db, principal, project.id, { scope: "project:read" });
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          const send = (data: string) => controller.enqueue(encoder.encode(data));
          send(`retry: 3000\n\n`);
          send(`event: connected\ndata: ${JSON.stringify({ project_id: project.id })}\n\n`);
          const unsubscribe = subscribe((event) => {
            if (event.topic !== `project:${project.id}`) return;
            send(`event: update\ndata: ${JSON.stringify(event)}\n\n`);
          });
          const heartbeat = setInterval(() => {
            try {
              send(`: ping\n\n`);
            } catch {
              clearInterval(heartbeat);
            }
          }, 15_000);
          ctx.request.signal?.addEventListener("abort", () => {
            clearInterval(heartbeat);
            unsubscribe();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
      });
      ctx.set.headers["content-type"] = "text/event-stream";
      ctx.set.headers["cache-control"] = "no-cache";
      ctx.set.headers["connection"] = "keep-alive";
      return stream;
    },
    { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
  );
}
