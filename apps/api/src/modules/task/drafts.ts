import { and, eq, inArray } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { TaskUpdateSchema, type TaskContract, type TaskUpdate } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import {
  addDependency,
  createTask,
  dependenciesOf,
  dependentsOf,
  getTask,
  linkTaskRequirement,
  removeDependency,
  traceabilityOf,
  type TaskRow,
} from "./repo.js";
import { deriveTaskRisk } from "./lint.js";
import { getApprovedRevision } from "../artifact/service.js";
import { listRequirementsForRevision } from "../planning/requirements.js";
import { computeTaskReadiness } from "./readiness.js";

/** Changes to DRAFT tasks (docs/11 §12): edits, requirement links, split and merge (T091/T092), parallel candidates. */

/* ── Draft mutation (docs/11 §12) ── */

export async function updateDraftTask(db: DbExecutor, input: { taskId: string; userId: string; patch: TaskUpdate | unknown }): Promise<TaskRow> {
  const patchInput = input.patch as TaskUpdate;
  const task = await getTask(db, input.taskId);
  if (task.workflowStatus !== "DRAFT") {
    throw errors.conflict("TASK_NOT_MUTABLE", "Only DRAFT tasks may be edited — executed tasks are never silently mutated (docs/11 §12)");
  }
  const patch = TaskUpdateSchema.parse(patchInput);
  const contract: TaskContract = {
    ...task.contract,
    ...patch,
    scope: patch.scope ?? task.contract.scope,
    verification: patch.verification ?? task.contract.verification,
    risk_factors: patch.risk_factors ?? task.contract.risk_factors,
  } as TaskContract;
  const risk = deriveTaskRisk(contract);
  const [updated] = await db
    .update(schema.tasks)
    .set({
      title: patch.title ?? task.title,
      objective: patch.objective ?? task.objective,
      // The column drives lint/traceability rules; keep it in sync with the contract.
      taskType: patch.task_type ?? task.taskType,
      contract,
      riskFactors: contract.risk_factors,
      hardness: risk.hardness,
      riskLevel: risk.riskLevel,
      reviewPolicy: risk.reviewPolicy,
      parallelSafe: patch.parallel_safe ?? task.parallelSafe,
      priority: patch.priority ?? task.priority,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, task.id))
    .returning();
  return updated!;
}

/* ── Traceability editing ── */

/** Link a DRAFT task to a requirement (and optionally one of its acceptance
 * criteria) of the CURRENT approved requirements revision. */
export async function addTaskRequirementLink(
  db: DbExecutor,
  input: { taskId: string; requirementKey: string; acceptanceCriterionKey?: string | null },
) {
  const task = await getTask(db, input.taskId);
  if (task.workflowStatus !== "DRAFT") throw errors.conflict("TASK_NOT_MUTABLE", "Traceability can only be edited while the task is DRAFT");
  const approvedReq = await getApprovedRevision(db, task.projectId, "requirements");
  if (!approvedReq) throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve requirements before linking tasks to them");
  const requirements = await listRequirementsForRevision(db, approvedReq.revision.id);
  const requirement = requirements.find((r) => r.key.toUpperCase() === input.requirementKey.toUpperCase());
  if (!requirement) throw errors.notFound("Requirement", input.requirementKey);
  let acId: string | null = null;
  if (input.acceptanceCriterionKey) {
    const ac = requirement.acceptance_criteria.find((a) => a.key.toUpperCase() === input.acceptanceCriterionKey!.toUpperCase());
    if (!ac) throw errors.notFound("Acceptance criterion", input.acceptanceCriterionKey);
    acId = ac.id;
  }
  await linkTaskRequirement(db, { taskId: task.id, requirementId: requirement.id, acceptanceCriterionId: acId });
  return computeTaskReadiness(db, await getTask(db, task.id));
}

/* ── Split / merge (T091/T092, FR-057) ── */

export async function splitTask(
  db: DbExecutor,
  input: { taskId: string; userId: string; parts: Array<{ title: string; objective: string; acceptance_criteria: string[] }> },
) {
  const task = await getTask(db, input.taskId);
  if (task.workflowStatus !== "DRAFT") throw errors.conflict("TASK_NOT_MUTABLE", "Only DRAFT tasks can be split");
  if (input.parts.length < 2) throw errors.validation("A split needs at least two parts");

  return db.transaction(async (tx) => splitTaskTx(tx, task, input.parts));
}

async function splitTaskTx(db: DbExecutor, task: TaskRow, parts: Array<{ title: string; objective: string; acceptance_criteria: string[] }>) {
  const links = await traceabilityOf(db, task.id);
  const upstream = await dependenciesOf(db, task.id);
  const downstream = await dependentsOf(db, task.id);
  const created: TaskRow[] = [];
  for (const part of parts) {
    const contract: TaskContract = {
      ...task.contract,
      title: part.title,
      objective: part.objective,
      acceptance_criteria: part.acceptance_criteria,
    };
    const risk = deriveTaskRisk(contract);
    const newTask = await createTask(db, {
      projectId: task.projectId,
      featureId: task.featureId,
      title: part.title,
      taskType: task.taskType,
      objective: part.objective,
      contract,
      riskFactors: contract.risk_factors,
      hardness: risk.hardness,
      riskLevel: risk.riskLevel,
      reviewPolicy: risk.reviewPolicy,
      parallelSafe: contract.parallel_safe,
      priority: contract.priority,
      createdFromRevisionIds: task.createdFromRevisionIds,
      splitFromId: task.id,
    });
    for (const link of links) {
      await db
        .insert(schema.taskRequirementLinks)
        .values({ taskId: newTask.id, requirementId: link.requirement.id, acceptanceCriterionId: link.ac?.id ?? null })
        .onConflictDoNothing();
    }
    // Every part inherits the original's prerequisites.
    for (const dep of upstream) await addDependency(db, newTask.id, dep.task.id);
    created.push(newTask);
  }
  // Whatever depended on the original now waits for ALL parts. Without this,
  // dependents saw the cancelled original as "satisfied" and became claimable
  // before the replacement work was done.
  for (const dependent of downstream) {
    await removeDependency(db, dependent.task.id, task.id);
    for (const part of created) await addDependency(db, dependent.task.id, part.id);
  }
  // Original draft superseded; lineage preserved (T091 DoD).
  await db.update(schema.tasks).set({ workflowStatus: "CANCELLED", supersededById: created[0]!.id, updatedAt: new Date() }).where(eq(schema.tasks.id, task.id));
  return { original: task, created };
}

export async function mergeTasks(
  db: DbExecutor,
  input: { projectId: string; userId: string; taskIds: string[] },
) {
  const uniqueIds = [...new Set(input.taskIds)];
  if (uniqueIds.length < 2) throw errors.validation("Merge needs at least two distinct tasks");
  const tasks = await Promise.all(uniqueIds.map((id) => getTask(db, id)));
  // Authorization is per project: every merged task must belong to the
  // project the caller was authorized for (no cross-project merge/overwrite).
  const foreign = tasks.filter((t) => t.projectId !== input.projectId);
  if (foreign.length > 0) throw errors.notFound("Task", foreign[0]!.id);
  if (tasks.some((t) => t.workflowStatus !== "DRAFT")) {
    throw errors.conflict("TASK_NOT_MUTABLE", "Only eligible DRAFT tasks can be merged (T092)");
  }
  return db.transaction(async (tx) => mergeTasksTx(tx, tasks));
}

async function mergeTasksTx(db: DbExecutor, tasks: TaskRow[]) {
  const primary = tasks[0]!;
  const mergedIds = new Set(tasks.map((t) => t.id));
  const contract: TaskContract = {
    ...primary.contract,
    title: tasks.map((t) => t.title).join(" + ").slice(0, 200),
    objective: tasks.map((t) => t.objective).join("\n\n").slice(0, 4000),
    acceptance_criteria: tasks.flatMap((t) => t.contract.acceptance_criteria).slice(0, 10),
  };
  const risk = deriveTaskRisk(contract);
  const [merged] = await db
    .update(schema.tasks)
    .set({
      title: contract.title,
      objective: contract.objective,
      contract,
      riskFactors: contract.risk_factors,
      hardness: risk.hardness,
      riskLevel: risk.riskLevel,
      reviewPolicy: risk.reviewPolicy,
      mergedFromIds: tasks.slice(1).map((t) => t.id),
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, primary.id))
    .returning();

  for (const other of tasks.slice(1)) {
    // Links + dependencies reconciled onto the surviving task.
    const links = await traceabilityOf(db, other.id);
    for (const link of links) {
      await db.insert(schema.taskRequirementLinks).values({ taskId: primary.id, requirementId: link.requirement.id, acceptanceCriterionId: link.ac?.id ?? null }).onConflictDoNothing();
    }
    // Prerequisites of the merged task become prerequisites of the survivor
    // (edges between merged tasks themselves disappear — no self-edges).
    for (const dep of await dependenciesOf(db, other.id)) {
      if (mergedIds.has(dep.task.id)) continue;
      await addDependency(db, primary.id, dep.task.id);
    }
    // Tasks that waited for the merged-away task now wait for the survivor.
    for (const dependent of await dependentsOf(db, other.id)) {
      await removeDependency(db, dependent.task.id, other.id);
      if (mergedIds.has(dependent.task.id)) continue;
      await addDependency(db, dependent.task.id, primary.id);
    }
    await db.update(schema.tasks).set({ workflowStatus: "CANCELLED", supersededById: primary.id, updatedAt: new Date() }).where(eq(schema.tasks.id, other.id));
  }
  // Drop any edge between the survivor and a merged-away task.
  for (const other of tasks.slice(1)) await removeDependency(db, primary.id, other.id);
  return merged!;
}

/* ── Parallel candidates (T090, FR-059) ── */

export async function parallelCandidates(db: DbExecutor, projectId: string) {
  const readyTasks = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), inArray(schema.tasks.workflowStatus, ["READY", "DRAFT"])));
  const groups: Array<{ tasks: Array<{ id: string; key: string; title: string }>; sharedPaths: string[] }> = [];
  for (let i = 0; i < readyTasks.length; i++) {
    for (let j = i + 1; j < readyTasks.length; j++) {
      const a = readyTasks[i]!, b = readyTasks[j]!;
      if (!a.parallelSafe || !b.parallelSafe) continue;
      const overlap = pathOverlap(a.contract.scope.expected_paths, b.contract.scope.expected_paths);
      if (!overlap) continue;
      groups.push({
        tasks: [toRef(a), toRef(b)],
        sharedPaths: overlap,
      });
    }
  }
  return groups;

  function toRef(t: TaskRow) {
    return { id: t.id, key: t.key, title: t.title };
  }
}

function pathOverlap(a: string[], b: string[]): string[] {
  const shared: string[] = [];
  for (const pa of a) {
    const prefix = pa.replace(/\*\*.*$/, "").replace(/[^/]+$/, "");
    for (const pb of b) {
      const bPrefix = pb.replace(/\*\*.*$/, "").replace(/[^/]+$/, "");
      if (prefix && bPrefix && (prefix.startsWith(bPrefix) || bPrefix.startsWith(prefix))) {
        shared.push(prefix);
      }
    }
  }
  return shared;
}
