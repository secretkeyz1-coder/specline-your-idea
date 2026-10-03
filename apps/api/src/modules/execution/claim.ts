import { and, eq, notInArray, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { ClaimTaskInput } from "@sdd/contracts";
import { errors, addSeconds } from "@sdd/shared";
import { getTask, type TaskRow } from "../task/repo.js";
import { computeTaskReadiness } from "../task/readiness.js";
import { getProject } from "../project/service.js";
import { audit } from "../audit/service.js";
import { publish, topics } from "../../events/bus.js";
import type { ActorInput } from "./events.js";

/** The claim transaction: dependencies satisfied, one lease, one run — atomic under concurrency (FR-070/071, NFR-004). */

/* ── Claim transaction (T108) ── */

/** Execution-order guard shared by every path that starts work on a task. */
export async function assertDependenciesSatisfied(db: DbExecutor, task: { id: string; key: string }): Promise<void> {
  const blockingDeps = await db
    .select({ key: schema.tasks.key, status: schema.tasks.workflowStatus })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.dependsOnTaskId))
    .where(
      and(
        eq(schema.taskDependencies.taskId, task.id),
        notInArray(schema.tasks.workflowStatus, ["DONE", "CANCELLED"]),
      ),
    );
  if (blockingDeps.length > 0) {
    throw errors.conflict(
      "TASK_DEPENDENCIES_INCOMPLETE",
      `Cannot start ${task.key}: waiting on ${blockingDeps.map((d) => `${d.key} (${d.status})`).join(", ")}`,
      { dependencies: blockingDeps },
    );
  }
}

export async function claimTask(
  db: DbExecutor,
  input: {
    taskId: string;
    body: ClaimTaskInput;
    actor: ActorInput;
    /** The caller's machine when its sdd-agent claims a dispatched task (the
     * route verifies ownership). Marks a daemon run: cancel/resume are pushed to it. */
    machineId?: string | null;
  },
) {
  const task = await getTask(db, input.taskId);
  const project = await getProject(db, task.projectId);

  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).for("update").limit(1);
    if (!locked) throw errors.notFound("Task", input.taskId);
    if (locked.workflowStatus !== "READY") {
      throw errors.taskNotReady(locked.key);
    }
    const ready = await computeTaskReadiness(tx, locked as TaskRow);
    if (ready.readinessStatus !== "READY") throw errors.conflict("TASK_NOT_READINESS_OK", "Task contract or approved specification changed; rebase or repair before claiming", { checks: ready.readinessReport.checks });
    // Dependency-order guard. Tasks are auto-approved into READY on generation
    // (no manual approval gate), so execution ordering is enforced here: an
    // agent cannot begin work whose prerequisites have not reached DONE.
    await assertDependenciesSatisfied(tx, locked);
    // Active lease check (defense in depth — the partial unique index is the
    // hard guarantee even across concurrent transactions).
    const [activeLease] = await tx
      .select()
      .from(schema.taskLeases)
      .where(and(eq(schema.taskLeases.taskId, task.id), eq(schema.taskLeases.status, "ACTIVE")))
      .limit(1);
    if (activeLease && !leaseExpired(activeLease)) {
      throw errors.taskAlreadyClaimed(locked.key);
    }
    if (activeLease) {
      // Clock-expired but still ACTIVE: retire the row inside this transaction,
      // or the partial unique index (task_leases_one_active_unique) turns the
      // fresh lease insert below into a raw unique-violation 500.
      await tx
        .update(schema.taskLeases)
        .set({ status: "EXPIRED", releasedAt: new Date() })
        .where(eq(schema.taskLeases.id, activeLease.id));
    }
    const [{ attempt }] = await tx
      .select({ attempt: sql<number>`coalesce(max(${schema.taskRuns.attempt}), 0)` })
      .from(schema.taskRuns)
      .where(eq(schema.taskRuns.taskId, task.id));
    const nextAttempt = (attempt ?? 0) + 1;
    const [run] = await tx
      .insert(schema.taskRuns)
      .values({
        taskId: task.id,
        attempt: nextAttempt,
        executorType: input.body.executor.type,
        // Ownership is bound to the authenticated principal; the declared
        // executor id is descriptive metadata only (lease checks compare this).
        executorId: input.actor.id,
        machineId: input.machineId ?? null,
        metadata: { declared_executor: input.body.executor.id },
        status: "CREATED",
      })
      .returning();
    const expiresAt = addSeconds(new Date(), input.body.lease_seconds);
    const [lease] = await tx
      .insert(schema.taskLeases)
      .values({
        taskId: task.id,
        runId: run!.id,
        // Same ownership binding as the run: lease checks compare principals.
        executorId: input.actor.id,
        executorType: input.body.executor.type,
        status: "ACTIVE",
        expiresAt,
      })
      .returning();
    const [updated] = await tx
      .update(schema.tasks)
      .set({ workflowStatus: "CLAIMED", updatedAt: new Date() })
      .where(eq(schema.tasks.id, task.id))
      .returning();
    await tx.insert(schema.taskEvents).values({
      taskId: task.id,
      runId: run!.id,
      eventType: "task_claimed",
      actorType: input.actor.type,
      actorId: input.actor.id,
      payload: { lease_id: lease!.id, attempt: nextAttempt, executor: input.body.executor },
    });
    return { task: updated!, run: run!, lease: lease!, attempt: nextAttempt };
  });

  await audit(db, {
    workspaceId: project.workspaceId,
    projectId: task.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.actor.source,
    action: "task.claimed",
    entityType: "TASK",
    entityId: task.id,
    metadata: { run_id: result.run.id, attempt: result.attempt },
  });
  publish({ topic: topics.project(task.projectId), type: "task_transitioned", payload: { task_id: task.id, from: "READY", to: "CLAIMED" } });
  return {
    task_id: result.task.key,
    run_id: result.run.id,
    lease_id: result.lease.id,
    lease_expires_at: result.lease.expiresAt.toISOString(),
    attempt: result.attempt,
  };
}

export function leaseExpired(lease: typeof schema.taskLeases.$inferSelect): boolean {
  return lease.status === "EXPIRED" || lease.expiresAt.getTime() <= Date.now();
}
