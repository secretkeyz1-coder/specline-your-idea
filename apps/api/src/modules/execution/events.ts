import { asc, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { resolveTransition, type TaskEventType, type WorkflowStatus } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { type TaskRow } from "../task/repo.js";
import { type AuditSource } from "../audit/service.js";
import { publish, topics } from "../../events/bus.js";
import type { ActorType } from "@sdd/contracts";

/** The task event log (append-only, idempotent) and the table-driven task transition that writes to it. */

/** Legacy machine-bound runs were daemon-only; new claims explicitly separate provenance. */
export function isDaemonRun(run: { machineId: string | null; metadata?: Record<string, unknown> | null }): boolean {
  return Boolean(run.machineId) && run.metadata?.daemon_execution !== false;
}

export type ActorInput = { type: ActorType; id: string; source: AuditSource };

/* ── Event log (T113) — append-only, idempotent ── */

export async function appendTaskEvent(
  db: DbExecutor,
  input: {
    taskId: string;
    runId?: string | null;
    eventType: TaskEventType;
    actor: ActorInput;
    payload?: Record<string, unknown>;
    clientSequence?: number | null;
    idempotencyKey?: string | null;
  },
): Promise<typeof schema.taskEvents.$inferSelect | null> {
  // Keys are client-chosen, so they are namespaced by run (or task): one
  // executor must never be able to pre-empt another run's events by reusing
  // its key, and unrelated runs must not collide on a globally-unique column.
  const idempotencyKey = input.idempotencyKey ? scopedIdempotencyKey(input.runId ?? input.taskId, input.idempotencyKey) : null;
  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(schema.taskEvents)
      .where(eq(schema.taskEvents.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) return null; // idempotent retry
  }
  const [row] = await db
    .insert(schema.taskEvents)
    .values({
      taskId: input.taskId,
      runId: input.runId ?? null,
      clientSequence: input.clientSequence ?? null,
      eventType: input.eventType,
      actorType: input.actor.type,
      actorId: input.actor.id,
      payload: input.payload ?? {},
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    publish({ topic: topics.task(input.taskId), type: row.eventType, payload: { task_id: row.taskId, run_id: row.runId, ...row.payload } });
    if (row.runId) publish({ topic: topics.run(row.runId), type: row.eventType, payload: { task_id: row.taskId } });
    // Project-scoped copy: SSE subscribers filter on this topic only, so a
    // project stream can never observe another project's task/run events.
    const [taskRow] = await db
      .select({ projectId: schema.tasks.projectId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, input.taskId))
      .limit(1);
    if (taskRow) {
      publish({
        topic: topics.project(taskRow.projectId),
        type: row.eventType,
        payload: { task_id: row.taskId, run_id: row.runId, project_id: taskRow.projectId, ...row.payload },
      });
    }
  }
  return row ?? null;
}

export function scopedIdempotencyKey(scope: string, key: string): string {
  return `${scope}:${key}`.slice(0, 300);
}

export async function listTaskEvents(db: DbExecutor, taskId: string, limit = 200) {
  return db.select().from(schema.taskEvents).where(eq(schema.taskEvents.taskId, taskId)).orderBy(asc(schema.taskEvents.id)).limit(limit);
}

/* ── Transition service (T107) — table-driven, event-emitting ── */

export async function transitionTask(
  db: DbExecutor,
  input: { taskId: string; action: string; actor: ActorInput; reason?: string; runId?: string | null },
): Promise<TaskRow> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId)).for("update").limit(1);
    if (!locked) throw errors.notFound("Task", input.taskId);
    const target = resolveTransition(locked.workflowStatus as WorkflowStatus, input.action);
    if (!target) {
      throw errors.invalidTransition(locked.workflowStatus, input.action);
    }
    const [updated] = await tx
      .update(schema.tasks)
      .set({ workflowStatus: target, updatedAt: new Date() })
      .where(eq(schema.tasks.id, locked.id))
      .returning();
    await tx.insert(schema.taskEvents).values({
      taskId: locked.id,
      runId: input.runId ?? null,
      eventType: "task_transitioned",
      actorType: input.actor.type,
      actorId: input.actor.id,
      payload: { from: locked.workflowStatus, to: target, action: input.action, reason: input.reason ?? null },
    });
    return updated!;
  });
}
