import { and, eq, lte, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { getTask } from "../task/repo.js";
import { getProject } from "../project/service.js";
import { notifyWorkspaceMembers } from "../notification/service.js";
import { transitionTask } from "./events.js";
import { transitionRun } from "./runs.js";

/** The lease-expiry worker: expired claims go back to READY and their runs fail. */

/* ── Lease expiry worker (T112) ── */

export async function sweepExpiredLeases(db: DbExecutor): Promise<number> {
  const expired = await db
    .select({ lease: schema.taskLeases, run: schema.taskRuns })
    .from(schema.taskLeases)
    .innerJoin(schema.taskRuns, eq(schema.taskRuns.id, schema.taskLeases.runId))
    .where(and(eq(schema.taskLeases.status, "ACTIVE"), sql`${schema.taskLeases.expiresAt} <= now()`))
    .limit(100);
  let swept = 0;
  for (const { lease, run } of expired) {
    // Conditional expiry: re-check status and expiry inside the UPDATE so a
    // heartbeat that landed between the candidate select and this transaction
    // rejuvenates the lease instead of being wrongly expired (TOCTOU).
    const expiredRow = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.taskLeases)
        .set({ status: "EXPIRED" })
        .where(
          and(
            eq(schema.taskLeases.id, lease.id),
            eq(schema.taskLeases.status, "ACTIVE"),
            lte(schema.taskLeases.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!row) return null;
      await tx.insert(schema.taskEvents).values({
        taskId: lease.taskId,
        runId: run.id,
        eventType: "lease_expired",
        actorType: "SYSTEM",
        actorId: "lease-worker",
        payload: { expired_at: lease.expiresAt.toISOString() },
      });
      return row;
    });
    if (!expiredRow) continue;
    swept += 1;
    const task = await getTask(db, lease.taskId);
    // Recovery policy (docs/06 §10): a CLAIMED task whose lease died never
    // started work — release it back to READY so executors can reclaim.
    if (task.workflowStatus === "CLAIMED") {
      await transitionTask(db, {
        taskId: task.id,
        action: "release",
        actor: { type: "SYSTEM", id: "lease-worker", source: "SYSTEM" },
        reason: "lease expired before execution started",
        runId: run.id,
      });
      await transitionRun(db, run.id, "FAILED");
      continue;
    }
    // Lease expiry ≠ execution stopped — never assume DONE/FAIL (docs/12 §5);
    // IN_PROGRESS/VALIDATING tasks need a human unblock decision.
    await db.transaction(async (tx) => {
      await tx.update(schema.tasks).set({ attentionStatus: "LEASE_EXPIRED" }).where(eq(schema.tasks.id, lease.taskId));
    });
    const project = await getProject(db, task.projectId);
    await notifyWorkspaceMembers(db, {
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      type: "lease_expired",
      title: `${task.key} lease expired`,
      body: "The execution lease expired. The task needs attention — reclaim or requeue it.",
      entityType: "TASK",
      entityId: task.id,
      dedupeKey: `lease-expired:${lease.id}`,
    });
  }
  return swept;
}

/** Start the periodic lease sweeper (idempotent per process). */
export function startLeaseSweeper(db: ReturnType<typeof import("@sdd/db").createDb>, intervalMs = 30_000): () => void {
  let running = true;
  const loop = async () => {
    while (running) {
      try {
        await sweepExpiredLeases(db);
      } catch {
        // logged by caller; sweeper must survive transient DB errors
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  return () => {
    running = false;
  };
}
