import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { errors, addSeconds } from "@sdd/shared";
import { getTask, updateTaskFields } from "../task/repo.js";
import { getProject } from "../project/service.js";
import { audit } from "../audit/service.js";
import { publish, topics } from "../../events/bus.js";
import { isDaemonRun, appendTaskEvent, transitionTask, type ActorInput } from "./events.js";

/** Ending runs outside the happy path: retiring open runs, unblocking and cancelling tasks. */

/* ── Run retirement / unblock / cancel ── */

const OPEN_RUN_STATUSES = ["CREATED", "STARTING", "RUNNING", "VALIDATING", "BLOCKED"] as const;

/** Close every non-terminal run of a task (SUBMITTED → FINISHED, others → `to`)
 * and release its leases, so no stale run can later be reviewed or resumed.
 *
 * Only runs and leases that existed when the caller's transaction began
 * (`now()` is the transaction start) are retired: a fresh claim that lands
 * right after a requeue made the task READY must keep its run and lease —
 * retiring it too stranded the task in CLAIMED with no live lease. */
export async function retireOpenRuns(db: DbExecutor, taskId: string, to: "FAILED" | "CANCELLED", exceptRunId?: string): Promise<void> {
  const runs = await db
    .select()
    .from(schema.taskRuns)
    .where(and(eq(schema.taskRuns.taskId, taskId), sql`${schema.taskRuns.createdAt} <= now()`));
  for (const run of runs) {
    if (run.id === exceptRunId) continue;
    if (run.status === "SUBMITTED") {
      await db.update(schema.taskRuns).set({ status: "FINISHED", endedAt: run.endedAt ?? new Date() }).where(eq(schema.taskRuns.id, run.id));
    } else if ((OPEN_RUN_STATUSES as readonly string[]).includes(run.status)) {
      await db.update(schema.taskRuns).set({ status: to, endedAt: new Date() }).where(eq(schema.taskRuns.id, run.id));
    }
  }
  await db
    .update(schema.taskLeases)
    .set({ status: "RELEASED", releasedAt: new Date() })
    .where(and(eq(schema.taskLeases.taskId, taskId), eq(schema.taskLeases.status, "ACTIVE"), sql`${schema.taskLeases.issuedAt} <= now()`));
}

/** Open runs of a task that a machine's sdd-agent is executing — read BEFORE
 * retiring them, so the caller can tell those machines to stop. */
export async function openMachineRuns(db: DbExecutor, taskId: string): Promise<Array<{ id: string; taskId: string; machineId: string | null }>> {
  const runs = await db
    .select({ id: schema.taskRuns.id, taskId: schema.taskRuns.taskId, machineId: schema.taskRuns.machineId, metadata: schema.taskRuns.metadata })
    .from(schema.taskRuns)
    .where(and(eq(schema.taskRuns.taskId, taskId), inArray(schema.taskRuns.status, [...OPEN_RUN_STATUSES]), isNotNull(schema.taskRuns.machineId)));
  return runs.filter(isDaemonRun);
}

/**
 * Human decision on a BLOCKED task (docs/12 §3):
 *  - "ready":  abandon the blocked attempt and put the task back in the queue;
 *  - "resume": let the same executor continue the blocked run with a fresh lease.
 */
export async function unblockTask(
  db: DbExecutor,
  input: { taskId: string; mode: "ready" | "resume"; actor: ActorInput; note?: string; leaseSeconds?: number },
) {
  const task = await getTask(db, input.taskId);
  if (task.workflowStatus !== "BLOCKED") {
    throw errors.conflict("TASK_NOT_BLOCKED", `Only BLOCKED tasks can be unblocked (current: ${task.workflowStatus})`);
  }
  const [blockedRun] = await db
    .select()
    .from(schema.taskRuns)
    .where(and(eq(schema.taskRuns.taskId, task.id), eq(schema.taskRuns.status, "BLOCKED")))
    .orderBy(desc(schema.taskRuns.attempt))
    .limit(1);

  const updated = await db.transaction(async (tx) => {
    if (input.mode === "resume") {
      if (!blockedRun) throw errors.conflict("NO_BLOCKED_RUN", "There is no blocked run to resume — unblock to READY instead");
      const next = await transitionTask(tx, { taskId: task.id, action: "unblock_resume", actor: input.actor, reason: input.note, runId: blockedRun.id });
      await tx
        .update(schema.taskLeases)
        .set({ status: "RELEASED", releasedAt: new Date() })
        .where(and(eq(schema.taskLeases.taskId, task.id), eq(schema.taskLeases.status, "ACTIVE")));
      await tx.insert(schema.taskLeases).values({
        taskId: task.id,
        runId: blockedRun.id,
        executorId: blockedRun.executorId,
        executorType: blockedRun.executorType,
        status: "ACTIVE",
        expiresAt: addSeconds(new Date(), input.leaseSeconds ?? 1800),
      });
      await tx.update(schema.taskRuns).set({ status: "RUNNING" }).where(eq(schema.taskRuns.id, blockedRun.id));
      return next;
    }
    const next = await transitionTask(tx, { taskId: task.id, action: "unblock_ready", actor: input.actor, reason: input.note, runId: blockedRun?.id ?? null });
    await retireOpenRuns(tx, task.id, "FAILED");
    return next;
  });
  await updateTaskFields(db, task.id, { attentionStatus: "NONE" });
  await appendTaskEvent(db, {
    taskId: task.id,
    runId: blockedRun?.id ?? null,
    eventType: "task_reopened",
    actor: input.actor,
    payload: { unblocked: input.mode, note: input.note ?? null },
  });
  await audit(db, {
    workspaceId: (await getProject(db, task.projectId)).workspaceId,
    projectId: task.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.actor.source,
    action: input.mode === "resume" ? "task.unblocked_resume" : "task.unblocked_ready",
    entityType: "TASK",
    entityId: task.id,
  });
  publish({ topic: topics.project(task.projectId), type: "task_transitioned", payload: { task_id: task.id, from: "BLOCKED", to: updated.workflowStatus } });
  return updated;
}

/** Cancel a task from any non-terminal state, closing its runs and leases. */
export async function cancelTask(db: DbExecutor, input: { taskId: string; actor: ActorInput; reason: string }) {
  const task = await getTask(db, input.taskId);
  const updated = await db.transaction(async (tx) => {
    const next = await transitionTask(tx, { taskId: task.id, action: "cancel", actor: input.actor, reason: input.reason });
    await retireOpenRuns(tx, task.id, "CANCELLED");
    return next;
  });
  await updateTaskFields(db, task.id, { attentionStatus: "NONE" });
  await audit(db, {
    workspaceId: (await getProject(db, task.projectId)).workspaceId,
    projectId: task.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.actor.source,
    action: "task.cancelled",
    entityType: "TASK",
    entityId: task.id,
    metadata: { reason: input.reason, from: task.workflowStatus },
  });
  publish({ topic: topics.project(task.projectId), type: "task_transitioned", payload: { task_id: task.id, from: task.workflowStatus, to: "CANCELLED" } });
  return updated;
}
