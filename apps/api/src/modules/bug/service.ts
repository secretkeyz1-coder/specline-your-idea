import { and, desc, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CreateBugInput, BugStatus } from "@sdd/contracts";
import { displayKey, errors, nowIso } from "@sdd/shared";
import { nextCounter } from "../project/service.js";
import { getTask } from "../task/repo.js";
import { isLegalBugTransition, isOpenBug } from "@sdd/contracts";
import { audit, type AuditSource } from "../audit/service.js";
import type { ActorType } from "@sdd/contracts";

/**
 * Bugs (Phase 15, T154–T158, FR-130..133, C4).
 * Bugs are independent entities — never a task workflow status.
 */

export type BugRow = typeof schema.bugs.$inferSelect;

export async function createBug(
  db: DbExecutor,
  input: { projectId: string; body: CreateBugInput; actor: { type: ActorType; id: string } },
): Promise<BugRow> {
  if (!input.body.current_behavior?.trim() || !input.body.expected_behavior?.trim() || !input.body.reproduction?.trim()) {
    throw errors.validation("current_behavior, expected_behavior and reproduction are required by policy (FR-132)");
  }
  // Every referenced entity must belong to THIS project: otherwise a bug could
  // point at (and later spawn fix work from) another project's task/run.
  if (input.body.feature_id) {
    const [feature] = await db.select({ projectId: schema.features.projectId }).from(schema.features).where(eq(schema.features.id, input.body.feature_id)).limit(1);
    if (!feature || feature.projectId !== input.projectId) throw errors.notFound("Feature", input.body.feature_id);
  }
  if (input.body.task_id) {
    const task = await getTask(db, input.body.task_id).catch(() => null);
    if (!task || task.projectId !== input.projectId) throw errors.notFound("Task", input.body.task_id);
  }
  if (input.body.run_id) {
    const [run] = await db
      .select({ projectId: schema.tasks.projectId })
      .from(schema.taskRuns)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskRuns.taskId))
      .where(eq(schema.taskRuns.id, input.body.run_id))
      .limit(1);
    if (!run || run.projectId !== input.projectId) throw errors.notFound("Run", input.body.run_id);
  }
  const seq = await nextCounter(db, input.projectId, "bug");
  const [bug] = await db
    .insert(schema.bugs)
    .values({
      projectId: input.projectId,
      featureId: input.body.feature_id ?? null,
      key: displayKey("BUG", seq),
      title: input.body.title,
      severity: input.body.severity,
      currentBehavior: input.body.current_behavior,
      expectedBehavior: input.body.expected_behavior,
      unchangedBehavior: input.body.unchanged_behavior ?? "",
      reproduction: input.body.reproduction,
      createdByActorType: input.actor.type,
      createdByActorId: input.actor.id,
      status: "REPORTED",
    })
    .returning();

  const links: Array<{ entity_type: "TASK" | "RUN" | "FEATURE"; entity_id: string }> = [];
  if (input.body.task_id) links.push({ entity_type: "TASK", entity_id: input.body.task_id });
  if (input.body.run_id) links.push({ entity_type: "RUN", entity_id: input.body.run_id });
  if (input.body.feature_id) links.push({ entity_type: "FEATURE", entity_id: input.body.feature_id });
  for (const link of links) {
    await db.insert(schema.bugLinks).values({ bugId: bug!.id, entityType: link.entity_type, entityId: link.entity_id });
  }

  await audit(db, {
    workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1))[0]!.workspaceId,
    projectId: input.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.actor.type === "MCP" ? "MCP" : input.actor.type === "LOCAL_AGENT" ? "CLI" : "WEB",
    action: "bug.created",
    entityType: "BUG",
    entityId: bug!.id,
    metadata: { key: bug!.key, severity: bug!.severity },
  });
  return bug!;
}

async function linkedTaskId(db: DbExecutor, bugId: string): Promise<string | null> {
  const [link] = await db
    .select({ entityId: schema.bugLinks.entityId })
    .from(schema.bugLinks)
    .where(and(eq(schema.bugLinks.bugId, bugId), eq(schema.bugLinks.entityType, "TASK")))
    .limit(1);
  return link?.entityId ?? null;
}

export async function getBug(db: DbExecutor, bugId: string): Promise<BugRow> {
  const [bug] = await db.select().from(schema.bugs).where(eq(schema.bugs.id, bugId)).limit(1);
  if (!bug) throw errors.notFound("Bug", bugId);
  return bug;
}

export async function listBugs(db: DbExecutor, projectId: string, openOnly = false): Promise<BugRow[]> {
  const rows = await db.select().from(schema.bugs).where(eq(schema.bugs.projectId, projectId)).orderBy(desc(schema.bugs.createdAt));
  return openOnly ? rows.filter((b) => isOpenBug(b.status)) : rows;
}

/**
 * Closing decisions (VERIFIED, CLOSED, WONT_FIX, NOT_A_BUG, DUPLICATE) are a
 * human's to make: an agent token that reported or fixed a bug must not also
 * be the one who declares it resolved. Tokens may move a bug only through the
 * reporting/fixing states.
 */
export function bugTransitionNeedsHuman(to: string): boolean {
  return !isOpenBug(to);
}

export async function transitionBug(
  db: DbExecutor,
  input: { bugId: string; to: BugStatus; note: string; actor: { type: ActorType; id: string }; viaToken?: boolean; source?: AuditSource },
): Promise<BugRow> {
  const bug = await getBug(db, input.bugId);
  if (!isLegalBugTransition(bug.status, input.to)) {
    throw errors.invalidTransition(bug.status, `→ ${input.to}`);
  }
  if (input.viaToken && bugTransitionNeedsHuman(input.to)) {
    throw errors.forbidden(`Moving a bug to ${input.to} is a reviewer's decision — do it in the web app`, { status: input.to });
  }
  // VERIFIED means the fix landed: its fix task must have been approved.
  if (input.to === "VERIFIED" && bug.fixTaskId) {
    const fix = await getTask(db, bug.fixTaskId).catch(() => null);
    if (!fix || fix.workflowStatus !== "DONE") {
      throw errors.conflict("FIX_TASK_NOT_DONE", `The fix task${fix ? ` ${fix.key} (${fix.workflowStatus})` : ""} must be DONE before ${bug.key} can be verified`, {
        fix_task_id: bug.fixTaskId,
        fix_task_status: fix?.workflowStatus ?? null,
      });
    }
  }
  const notes = [...bug.notes, { status: input.to, note: input.note, actor_id: input.actor.id, occurred_at: nowIso() }];
  const [updated] = await db
    .update(schema.bugs)
    .set({ status: input.to, notes, updatedAt: new Date() })
    .where(eq(schema.bugs.id, bug.id))
    .returning();
  await audit(db, {
    workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, bug.projectId)).limit(1))[0]!.workspaceId,
    projectId: bug.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.source ?? "WEB",
    action: "bug.transitioned",
    entityType: "BUG",
    entityId: bug.id,
    metadata: { from: bug.status, to: input.to },
  });
  return updated!;
}

export async function linksOfBug(db: DbExecutor, bugId: string) {
  return db.select().from(schema.bugLinks).where(eq(schema.bugLinks.bugId, bugId));
}

/**
 * Bug → fix task generation (T158, FR-133). The fix task carries full
 * traceability back to the bug via task_requirement_links + a bug row pointer.
 */
export async function generateFixTask(
  db: DbExecutor,
  input: { bugId: string; userId: string; taskId?: string | null; source?: AuditSource },
) {
  const bug = await getBug(db, input.bugId);
  if (!["CONFIRMED", "PLANNED"].includes(bug.status)) {
    throw errors.conflict("BUG_NOT_CONFIRMED", "Only confirmed bugs can generate fix tasks");
  }
  const { createTask, getTask } = await import("../task/repo.js");
  const { applyFixTaskContext, deriveFixTaskContext } = await import("../task/service.js");
  // Idempotent: one live fix task per bug (repeat calls created duplicates).
  if (bug.fixTaskId) {
    const existing = await getTask(db, bug.fixTaskId).catch(() => null);
    if (existing && existing.workflowStatus !== "CANCELLED") return { bug, task: existing };
  }
  const fixContext = await deriveFixTaskContext(db, {
    projectId: bug.projectId,
    featureId: bug.featureId,
    sourceTaskId: input.taskId ?? (await linkedTaskId(db, bug.id)),
  });
  const objective = `Fix ${bug.key}: ${bug.title}\n\nCurrent behavior: ${bug.currentBehavior}\nExpected behavior: ${bug.expectedBehavior}\nUnchanged behavior: ${bug.unchangedBehavior || "(n/a)"}\nReproduction: ${bug.reproduction}`;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, bug.projectId)).limit(1);
  const fixTask = await createTask(db, {
    projectId: bug.projectId,
    featureId: bug.featureId,
    title: `Fix ${bug.key}: ${bug.title}`.slice(0, 200),
    taskType: "bugfix",
    objective,
    contract: {
      title: `Fix ${bug.key}: ${bug.title}`.slice(0, 200),
      task_type: "bugfix",
      objective,
      scope: fixContext.scope,
      constraints: [...fixContext.constraints, "Do not change unrelated behavior.", "Preserve the original failing behavior's tests."].slice(0, 10),
      ui_screen_keys: fixContext.ui_screen_keys,
      acceptance_criteria: [
        `Reproduction from ${bug.key} no longer triggers the faulty behavior.`,
        `Behavior matches: ${bug.expectedBehavior}`,
        ...fixContext.acceptance_criteria,
      ],
      verification: { required: fixContext.verification.required, evidence: ["test_result", "summary"] },
      deliverables: ["implementation", "automated_tests", "execution_summary"],
      stop_conditions: ["The root cause cannot be determined from the reproduction steps."],
      risk_factors: fixContext.riskFactors,
      parallel_safe: false,
      priority: bug.severity === "BLOCKER" || bug.severity === "CRITICAL" ? "P0" : "P1",
      dependency_outputs: {},
    },
    riskFactors: fixContext.riskFactors,
    ...fixContext.risk,
    parallelSafe: false,
    priority: bug.severity === "BLOCKER" || bug.severity === "CRITICAL" ? "P0" : "P1",
    createdFromRevisionIds: fixContext.revisionRefs,
  });
  // fix_task_id first: the bug itself is the task's traceability source.
  await db.update(schema.bugs).set({ fixTaskId: fixTask.id, status: "PLANNED", updatedAt: new Date() }).where(eq(schema.bugs.id, bug.id));
  const readiedTask = await applyFixTaskContext(db, fixTask.id, fixContext.links);
  await audit(db, {
    workspaceId: project!.workspaceId,
    projectId: bug.projectId,
    actorType: "USER",
    actorId: input.userId,
    source: input.source ?? "WEB",
    action: "bug.fix_task_generated",
    entityType: "BUG",
    entityId: bug.id,
    metadata: { task_id: fixTask.id },
  });
  return { bug: await getBug(db, bug.id), task: readiedTask };
}

export { isOpenBug };
