import { and, eq, gt, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { isLegalRunTransition, type RunStatus } from "@sdd/contracts";
import type { RunEventInput, TestReportInput, BlockRunInput } from "@sdd/contracts";
import { errors, addSeconds } from "@sdd/shared";
import { getTask } from "../task/repo.js";
import { getProject } from "../project/service.js";
import { audit } from "../audit/service.js";
import { notifyWorkspaceMembers } from "../notification/service.js";
import { leaseExpired } from "./claim.js";
import { appendTaskEvent, scopedIdempotencyKey, transitionTask, type ActorInput } from "./events.js";

/** Actions on an active run: start, heartbeat, progress, test results, block — each under the executor's lease. */

/* ── Run actions (T110–T116) ── */

export async function requireRunForTask(db: DbExecutor, runId: string) {
  const [run] = await db.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, runId)).limit(1);
  if (!run) throw errors.notFound("Run", runId);
  const task = await getTask(db, run.taskId);
  return { run, task };
}

export async function transitionRun(db: DbExecutor, runId: string, to: RunStatus): Promise<void> {
  const [run] = await db.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, runId)).limit(1);
  if (run!.status === to) return;
  if (!isLegalRunTransition(run!.status, to)) {
    throw errors.invalidTransition(run!.status, `→ ${to}`);
  }
  await db.update(schema.taskRuns).set({ status: to }).where(eq(schema.taskRuns.id, runId));
}

/** `lock` (inside a transaction) holds the lease row so the sweeper or a
 * cancel cannot retire it half-way through a multi-step run write. */
export async function requireActiveLease(db: DbExecutor, runId: string, executorId: string, lock = false) {
  const query = db
    .select()
    .from(schema.taskLeases)
    .where(and(eq(schema.taskLeases.runId, runId), eq(schema.taskLeases.status, "ACTIVE")));
  const [lease] = await (lock ? query.for("update").limit(1) : query.limit(1));
  if (!lease) throw errors.conflict("LEASE_NOT_ACTIVE", "No active lease for this run", { run_id: runId });
  if (leaseExpired(lease)) {
    // The sweeper may not have visited yet — a clock-expired lease confers no
    // authority, so heartbeats cannot resurrect it (only a fresh claim can).
    throw errors.conflict("LEASE_EXPIRED", "Lease has expired — the task must be reclaimed before updating this run", {
      run_id: runId,
      lease_id: lease.id,
      expired_at: lease.expiresAt.toISOString(),
    });
  }
  if (lease.executorId !== executorId) {
    throw errors.forbidden("Only the lease owner may update this run");
  }
  return lease;
}

export async function startRun(
  db: DbExecutor,
  input: { runId: string; actor: ActorInput },
) {
  const { run, task } = await requireRunForTask(db, input.runId);
  // Task and run move together or not at all: a failure half-way used to
  // leave the task IN_PROGRESS with its run still CREATED.
  const transitioned = await db.transaction(async (tx) => {
    // Lock order task → lease, same as cancel/review, so they cannot deadlock.
    await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, task.id)).for("update").limit(1);
    await requireActiveLease(tx, run.id, input.actor.id, true);
    const next = await transitionTask(tx, {
      taskId: task.id,
      action: "start",
      actor: input.actor,
      runId: run.id,
    });
    // CREATED → STARTING → RUNNING per the run lifecycle.
    await transitionRun(tx, run.id, "STARTING");
    await transitionRun(tx, run.id, "RUNNING");
    await tx.update(schema.taskRuns).set({ startedAt: new Date(), status: "RUNNING" }).where(eq(schema.taskRuns.id, run.id));
    return next;
  });
  await appendTaskEvent(db, { taskId: task.id, runId: run.id, eventType: "run_started", actor: input.actor });
  return { task: transitioned, run: { ...run, status: "RUNNING" as RunStatus } };
}

/** Owner-authenticated run writes renew the lease by at least this much. */
export const WRITE_LEASE_RENEWAL_SECONDS = 900;

/**
 * A progress or test report proves the executor is alive, so it extends the
 * lease (never shortens it). Agents driven through the CLI or MCP rarely call
 * heartbeat explicitly; without this a long task lost its 900 s lease mid-run.
 */
async function renewLeaseOnWrite(db: DbExecutor, leaseId: string): Promise<void> {
  const floor = addSeconds(new Date(), WRITE_LEASE_RENEWAL_SECONDS);
  await db
    .update(schema.taskLeases)
    .set({ lastHeartbeatAt: new Date(), expiresAt: sql`greatest(${schema.taskLeases.expiresAt}, ${floor.toISOString()}::timestamptz)` })
    .where(and(eq(schema.taskLeases.id, leaseId), eq(schema.taskLeases.status, "ACTIVE"), gt(schema.taskLeases.expiresAt, new Date())));
}

export async function heartbeatRun(
  db: DbExecutor,
  input: { runId: string; actorId: string; leaseSeconds: number; note?: string },
) {
  const { run } = await requireRunForTask(db, input.runId);
  const lease = await requireActiveLease(db, run.id, input.actorId);
  const expiresAt = addSeconds(new Date(), input.leaseSeconds);
  // Conditional renewal: if the sweeper expired the lease between the check
  // above and this write, the heartbeat must fail instead of "succeeding" on a
  // lease that no longer confers authority.
  const renewed = await db
    .update(schema.taskLeases)
    .set({ lastHeartbeatAt: new Date(), expiresAt })
    .where(and(eq(schema.taskLeases.id, lease.id), eq(schema.taskLeases.status, "ACTIVE"), gt(schema.taskLeases.expiresAt, new Date())))
    .returning({ id: schema.taskLeases.id });
  if (renewed.length === 0) {
    throw errors.conflict("LEASE_EXPIRED", "Lease has expired — the task must be reclaimed before updating this run", { run_id: run.id, lease_id: lease.id });
  }
  return { lease_expires_at: expiresAt.toISOString() };
}

export async function reportProgress(
  db: DbExecutor,
  input: { runId: string; body: RunEventInput; actor: ActorInput },
) {
  const { run, task } = await requireRunForTask(db, input.runId);
  const lease = await requireActiveLease(db, run.id, input.actor.id);
  await renewLeaseOnWrite(db, lease.id);
  await appendTaskEvent(db, {
    taskId: task.id,
    runId: run.id,
    eventType: input.body.type,
    actor: input.actor,
    payload: { message: input.body.message ?? null, progress: input.body.progress ?? null, files_changed: input.body.files_changed ?? [] },
    clientSequence: input.body.client_sequence ?? null,
    idempotencyKey: input.body.idempotency_key ?? null,
  });
  return { ok: true };
}

export async function reportTestResult(
  db: DbExecutor,
  input: { runId: string; body: TestReportInput; actor: ActorInput },
) {
  if (input.body.status === "PASSED" && input.body.exit_code != null && input.body.exit_code !== 0) {
    throw errors.validation("A PASSED result cannot have a nonzero exit code");
  }
  const { run, task } = await requireRunForTask(db, input.runId);
  const lease = await requireActiveLease(db, run.id, input.actor.id);
  await renewLeaseOnWrite(db, lease.id);
  const [result] = await db
    .insert(schema.testResults)
    .values({
      runId: run.id,
      command: input.body.command,
      suite: input.body.suite ?? null,
      status: input.body.status,
      exitCode: input.body.exit_code ?? null,
      durationMs: input.body.duration_ms ?? null,
      summary: input.body.summary ?? null,
      artifactRef: input.body.artifact_ref ?? null,
      idempotencyKey: input.body.idempotency_key ? scopedIdempotencyKey(run.id, input.body.idempotency_key) : null,
    })
    .onConflictDoNothing()
    .returning();
  if (!result) return { ok: true, duplicate: true }; // idempotent retry
  await appendTaskEvent(db, {
    taskId: task.id,
    runId: run.id,
    eventType: "test_reported",
    actor: input.actor,
    payload: { test_result_id: result.id, command: result.command, status: result.status, summary: result.summary },
  });
  // First reported evidence begins validation: IN_PROGRESS → VALIDATING,
  // keeping the run lifecycle in lockstep (docs/12 §2/§6).
  if (task.workflowStatus === "IN_PROGRESS") {
    await transitionTask(db, { taskId: task.id, action: "begin_validation", actor: input.actor, runId: run.id });
    await transitionRun(db, run.id, "VALIDATING");
  }
  await audit(db, {
    workspaceId: (await getProject(db, task.projectId)).workspaceId,
    projectId: task.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.actor.source,
    action: "run.test_reported",
    entityType: "RUN",
    entityId: run.id,
    metadata: { status: result.status },
  });
  return { ok: true, test_result_id: result.id };
}

export async function blockRun(
  db: DbExecutor,
  input: { runId: string; body: BlockRunInput; actor: ActorInput },
) {
  const { run, task } = await requireRunForTask(db, input.runId);
  await requireActiveLease(db, run.id, input.actor.id);
  // Task/run status consistent: BLOCKED action is legal from IN_PROGRESS/VALIDATING.
  const updatedTask = await transitionTask(db, {
    taskId: task.id,
    action: "block",
    actor: input.actor,
    reason: `${input.body.reason_code}: ${input.body.message}`,
    runId: run.id,
  });
  await transitionRun(db, run.id, "BLOCKED");
  // A blocked run is waiting on a human, not executing: release the lease so
  // the sweeper cannot later overwrite NEEDS_INPUT with LEASE_EXPIRED. Resuming
  // (unblockTask "resume") issues a fresh lease to the same executor.
  await db
    .update(schema.taskLeases)
    .set({ status: "RELEASED", releasedAt: new Date() })
    .where(and(eq(schema.taskLeases.runId, run.id), eq(schema.taskLeases.status, "ACTIVE")));
  await appendTaskEvent(db, {
    taskId: task.id,
    runId: run.id,
    eventType: "run_blocked",
    actor: input.actor,
    payload: { reason_code: input.body.reason_code, message: input.body.message },
  });
  await db
    .update(schema.tasks)
    .set({ attentionStatus: "NEEDS_INPUT" })
    .where(eq(schema.tasks.id, task.id));
  const project = await getProject(db, task.projectId);
  await notifyWorkspaceMembers(db, {
    workspaceId: project.workspaceId,
    projectId: task.projectId,
    type: "task_blocked",
    title: `${task.key} blocked`,
    body: `${input.body.reason_code}: ${input.body.message}`,
    entityType: "TASK",
    entityId: task.id,
    dedupeKey: `block:${run.id}`,
  });
  return { task: updatedTask };
}
