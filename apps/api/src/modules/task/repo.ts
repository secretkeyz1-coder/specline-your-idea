import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { TaskContract, WorkflowStatus } from "@sdd/contracts";
import { displayKey, errors } from "@sdd/shared";
import { nextCounter } from "../project/service.js";

/** Task repository (T082). Display keys are per-project atomic sequences. */

export type TaskRow = typeof schema.tasks.$inferSelect;

export async function createTask(
  db: DbExecutor,
  input: {
    projectId: string;
    featureId?: string | null;
    title: string;
    taskType: TaskRow["taskType"];
    objective: string;
    contract: TaskContract;
    riskFactors: TaskContract["risk_factors"];
    hardness: number;
    riskLevel: TaskRow["riskLevel"];
    reviewPolicy: TaskRow["reviewPolicy"];
    parallelSafe: boolean;
    priority: TaskRow["priority"];
    createdFromRevisionIds: Array<{ artifact_id: string; version: number }>;
    splitFromId?: string | null;
  },
): Promise<TaskRow> {
  const seq = await nextCounter(db, input.projectId, "task");
  const [row] = await db
    .insert(schema.tasks)
    .values({
      projectId: input.projectId,
      featureId: input.featureId ?? null,
      key: displayKey("TASK", seq),
      title: input.title,
      taskType: input.taskType,
      objective: input.objective,
      workflowStatus: "DRAFT",
      contract: input.contract,
      riskFactors: input.riskFactors,
      hardness: input.hardness,
      riskLevel: input.riskLevel,
      reviewPolicy: input.reviewPolicy,
      parallelSafe: input.parallelSafe,
      priority: input.priority,
      createdFromRevisionIds: input.createdFromRevisionIds,
      splitFromId: input.splitFromId ?? null,
    })
    .returning();
  return row!;
}

export async function getTask(db: DbExecutor, taskId: string): Promise<TaskRow> {
  const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!row) throw errors.notFound("Task", taskId);
  return row;
}

export async function getTaskByKey(db: DbExecutor, projectId: string, key: string): Promise<TaskRow> {
  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), eq(schema.tasks.key, key)))
    .limit(1);
  if (!row) throw errors.notFound("Task", key);
  return row;
}

export async function listTasks(
  db: DbExecutor,
  projectId: string,
  filter: { status?: WorkflowStatus; featureId?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<TaskRow[]> {
  const conditions = [eq(schema.tasks.projectId, projectId)];
  if (filter.status) conditions.push(eq(schema.tasks.workflowStatus, filter.status));
  if (filter.featureId) conditions.push(eq(schema.tasks.featureId, filter.featureId));
  if (filter.q) conditions.push(sql`(${schema.tasks.key} ILIKE ${`%${filter.q}%`} OR ${schema.tasks.title} ILIKE ${`%${filter.q}%`})`);
  return db
    .select()
    .from(schema.tasks)
    .where(and(...conditions))
    .orderBy(asc(schema.tasks.key))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0);
}

/** Every task of a project (or of one feature) — no pagination. Gates and
 * convergence must see ALL tasks; `listTasks` is a paginated UI query. */
export async function listAllTasks(db: DbExecutor, projectId: string, featureId?: string): Promise<TaskRow[]> {
  const conditions = [eq(schema.tasks.projectId, projectId)];
  if (featureId) conditions.push(eq(schema.tasks.featureId, featureId));
  return db.select().from(schema.tasks).where(and(...conditions)).orderBy(asc(schema.tasks.createdAt));
}

export async function updateTaskFields(
  db: DbExecutor,
  taskId: string,
  fields: Partial<TaskRow>,
): Promise<TaskRow> {
  const [row] = await db
    .update(schema.tasks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(schema.tasks.id, taskId))
    .returning();
  if (!row) throw errors.notFound("Task", taskId);
  return row;
}

/* ── Dependencies (T081/T085) ── */

/** Statuses whose dependency edges may still change (execution order is fixed once work starts). */
export function dependencyEditAllowed(status: string): boolean {
  return status === "DRAFT" || status === "READY";
}

/** Advisory-lock key serialising dependency writes within one project. */
export function dependencyLockKey(projectId: string): string {
  return `task-deps:${projectId}`;
}

export async function addDependency(
  db: DbExecutor,
  taskId: string,
  dependsOnTaskId: string,
  options: { onlyEditable?: boolean } = {},
): Promise<void> {
  if (taskId === dependsOnTaskId) throw errors.validation("A task cannot depend on itself");
  await db.transaction(async (tx) => {
    const [task] = await tx.select({ projectId: schema.tasks.projectId, key: schema.tasks.key, status: schema.tasks.workflowStatus }).from(schema.tasks).where(eq(schema.tasks.id, taskId)).for("update").limit(1);
    if (!task) throw errors.notFound("Task", taskId);
    if (options.onlyEditable && !dependencyEditAllowed(task.status)) {
      throw errors.conflict("DEPENDENCIES_LOCKED", `${task.key} is ${task.status}; dependencies can only change while a task is DRAFT or READY`);
    }
    // Two concurrent edges (A→B and B→A) each pass a cycle check that cannot
    // see the other's uncommitted insert. One lock per project makes the
    // check-then-insert atomic; it is released when the transaction ends.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${dependencyLockKey(task.projectId)}))`);
    // Cycle detection across the graph (T085).
    await assertNoCycle(tx, taskId, dependsOnTaskId);
    await tx.insert(schema.taskDependencies).values({ taskId, dependsOnTaskId }).onConflictDoNothing();
  });
}

export async function removeDependency(db: DbExecutor, taskId: string, dependsOnTaskId: string): Promise<void> {
  await db
    .delete(schema.taskDependencies)
    .where(and(eq(schema.taskDependencies.taskId, taskId), eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId)));
}

/** DFS cycle check: adding edge (task → dependsOn) must not create a cycle. */
export async function assertNoCycle(db: DbExecutor, taskId: string, newDependencyId: string): Promise<void> {
  if (taskId === newDependencyId) throw errors.validation("Dependency cycle rejected: self-dependency");
  // Walk UP from newDependency following its dependencies; if we reach taskId, adding the edge closes a cycle.
  const visited = new Set<string>([newDependencyId]);
  const stack = [newDependencyId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const deps = await db
      .select({ dependsOn: schema.taskDependencies.dependsOnTaskId })
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, current));
    for (const d of deps) {
      if (d.dependsOn === taskId) {
        throw errors.conflict("DEPENDENCY_CYCLE", "Dependency cycle rejected", { task_id: taskId, via: newDependencyId });
      }
      if (!visited.has(d.dependsOn)) {
        visited.add(d.dependsOn);
        stack.push(d.dependsOn);
      }
    }
  }
}

export async function dependenciesOf(db: DbExecutor, taskId: string) {
  return db
    .select({ dependency: schema.taskDependencies, task: schema.tasks })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.dependsOnTaskId))
    .where(eq(schema.taskDependencies.taskId, taskId));
}

export async function dependentsOf(db: DbExecutor, taskId: string) {
  return db
    .select({ dependency: schema.taskDependencies, task: schema.tasks })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
    .where(eq(schema.taskDependencies.dependsOnTaskId, taskId));
}

/** Whole-project graph validation: cycle detection over all edges (T085 DoD). */
export async function validateProjectGraph(db: DbExecutor, projectId: string): Promise<{ acyclic: boolean; cycle?: string[] }> {
  const edges = await db
    .select({ from: schema.taskDependencies.taskId, to: schema.taskDependencies.dependsOnTaskId })
    .from(schema.taskDependencies)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskDependencies.taskId))
    .where(eq(schema.tasks.projectId, projectId));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  let cycle: string[] | undefined;
  const dfs = (node: string, path: string[]): void => {
    color.set(node, GRAY);
    for (const next of adj.get(node) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) {
        cycle = [...path.slice(path.indexOf(next)), next];
        return;
      }
      if (c === WHITE) {
        dfs(next, [...path, next]);
        if (cycle) return;
      }
    }
    color.set(node, BLACK);
  };
  for (const node of adj.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node, [node]);
      if (cycle) return { acyclic: false, cycle };
    }
  }
  return { acyclic: true };
}

/* ── Traceability links (T080) ── */

export async function linkTaskRequirement(
  db: DbExecutor,
  input: { taskId: string; requirementId: string; acceptanceCriterionId?: string | null },
): Promise<void> {
  await db
    .insert(schema.taskRequirementLinks)
    .values({
      taskId: input.taskId,
      requirementId: input.requirementId,
      acceptanceCriterionId: input.acceptanceCriterionId ?? null,
    })
    .onConflictDoNothing();
}

export async function traceabilityOf(db: DbExecutor, taskId: string) {
  return db
    .select({ link: schema.taskRequirementLinks, requirement: schema.requirements, ac: schema.acceptanceCriteria })
    .from(schema.taskRequirementLinks)
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.taskRequirementLinks.requirementId))
    .leftJoin(schema.acceptanceCriteria, eq(schema.acceptanceCriteria.id, schema.taskRequirementLinks.acceptanceCriterionId))
    .where(eq(schema.taskRequirementLinks.taskId, taskId));
}

export { inArray, desc };
