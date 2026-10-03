import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";

/**
 * SchedulerService (docs/12 + business-workflow audit): the single authority
 * for "which task may be executed next". Every transport — REST, CLI, MCP,
 * daemon dispatch — resolves through this service so ordering rules exist in
 * exactly one place:
 *
 *   claimable  = READY
 *              ∧ every dependency DONE/CANCELLED
 *              ∧ no ACTIVE lease on the task
 *   order      = priority (P0 → P3), then earliest key
 */

export interface QueuedTask {
  id: string;
  key: string;
  title: string;
  taskType: string;
  priority: string;
  parallelSafe: boolean;
  hardness: number;
  position: number;
}

/** Claimable tasks in execution order (dependency- and lease-aware). */
export async function findNextClaimable(db: DbExecutor, projectId: string, limit = 10): Promise<QueuedTask[]> {
  const rows = await db
    .select({
      id: schema.tasks.id,
      key: schema.tasks.key,
      title: schema.tasks.title,
      taskType: schema.tasks.taskType,
      priority: schema.tasks.priority,
      parallelSafe: schema.tasks.parallelSafe,
      hardness: schema.tasks.hardness,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        eq(schema.tasks.workflowStatus, "READY"),
        // every dependency reached a terminal-success state
        sql`NOT EXISTS (
          SELECT 1 FROM ${sql.raw("task_dependencies d")}
          JOIN ${sql.raw("tasks dep")} ON dep.id = d.depends_on_task_id
          WHERE d.task_id = ${schema.tasks.id}
            AND dep.workflow_status NOT IN ('DONE', 'CANCELLED')
        )`,
        // nobody holds an active lease on it
        sql`NOT EXISTS (
          SELECT 1 FROM ${sql.raw("task_leases l")}
          WHERE l.task_id = ${schema.tasks.id} AND l.status = 'ACTIVE'
        )`,
      ),
    )
    .orderBy(schema.tasks.priority, schema.tasks.key)
    .limit(limit);

  return rows.map((r, i) => ({ ...r, position: i + 1 }));
}

/** Coarse execution summary for `sddctl status` and board HUDs. */
export async function executionSummary(db: DbExecutor, projectId: string) {
  const rows = await db
    .select({ status: schema.tasks.workflowStatus, count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId))
    .groupBy(schema.tasks.workflowStatus);
  const by = (s: string) => rows.find((r) => r.status === s)?.count ?? 0;
  const done = by("DONE") + by("CANCELLED");
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const running = by("CLAIMED") + by("IN_PROGRESS") + by("VALIDATING");
  return {
    total,
    done,
    ready: by("READY"),
    running,
    review: by("NEEDS_REVIEW"),
    blocked: by("BLOCKED") + by("CHANGES_REQUESTED"),
    draft: by("DRAFT"),
  };
}

/** Tasks the scheduler considers blocked right now (deps pending). */
export async function listBlockedByDependencies(db: DbExecutor, projectId: string, limit = 50) {
  return db
    .select({
      id: schema.tasks.id,
      key: schema.tasks.key,
      title: schema.tasks.title,
      workflowStatus: schema.tasks.workflowStatus,
      blocker: schema.tasks.key,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.projectId, projectId),
        inArray(schema.tasks.workflowStatus, ["READY", "DRAFT"]),
        sql`EXISTS (
          SELECT 1 FROM ${sql.raw("task_dependencies d")}
          JOIN ${sql.raw("tasks dep")} ON dep.id = d.depends_on_task_id
          WHERE d.task_id = ${schema.tasks.id}
            AND dep.workflow_status NOT IN ('DONE', 'CANCELLED')
        )`,
      ),
    )
    .orderBy(schema.tasks.key)
    .limit(limit);
}
