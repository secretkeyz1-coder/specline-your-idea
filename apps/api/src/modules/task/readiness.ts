import type { AuditSource } from "../audit/service.js";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { errors } from "@sdd/shared";
import { dependenciesOf, getTask, traceabilityOf, validateProjectGraph, type TaskRow } from "./repo.js";
import { lintTask, screenFilesOf } from "./lint.js";
import { getApprovedRevision, isRefCurrent } from "../artifact/service.js";
import { approvedUxReference, uxFilePath } from "../ux/ux.js";
import { audit } from "../audit/service.js";
import { publish, topics } from "../../events/bus.js";

/** Readiness (T089, FR-054): derived from lint, traceability and whether the task's spec lineage is current — never assumed (C9). */

/* ── Readiness (T089, FR-054) ── */

export async function loadReadinessBaseline(db: DbExecutor, projectId: string) {
  const [requirements, stack, design, ux, design_system, uiArtifacts, reference] = await Promise.all([
    getApprovedRevision(db, projectId, "requirements"), getApprovedRevision(db, projectId, "stack"), getApprovedRevision(db, projectId, "design"),
    getApprovedRevision(db, projectId, "ux"), getApprovedRevision(db, projectId, "design_system"),
    db.select({ id: schema.artifacts.id, approvedRevisionId: schema.artifacts.approvedRevisionId }).from(schema.artifacts).where(and(eq(schema.artifacts.projectId, projectId), inArray(schema.artifacts.artifactType, ["design", "ux", "design_system"]))),
    approvedUxReference(db, projectId),
  ]);
  return { requirements, stack, design, ux, design_system, uiArtifacts, reference };
}

/** Shared styles and the root layout enable screens without owning one. */
export function needsScreenLinks(task: Pick<TaskRow, "title" | "taskType">): boolean {
  if (/\b(screen|page|dialog|layar|halaman|form)\b/i.test(task.title)) return true;
  return ["frontend", "ui"].includes(task.taskType) && !/\b(design system|design tokens|root layout|global styles?|global stylesheet)\b/i.test(task.title);
}

export async function computeTaskReadiness(db: DbExecutor, task: TaskRow, cachedGraph?: { acyclic: boolean }, cachedBaseline?: Awaited<ReturnType<typeof loadReadinessBaseline>>): Promise<TaskRow> {
  const baseline = cachedBaseline ?? await loadReadinessBaseline(db, task.projectId);
  const links = await traceabilityOf(db, task.id);
  const isInfrastructure = ["infrastructure", "documentation", "research"].includes(task.taskType);
  // A bug-fix task is traceable through the bug that spawned it (C1): the bug
  // row points at it via fix_task_id.
  const sourceBug =
    links.length === 0 && task.taskType === "bugfix"
      ? (await db.select({ id: schema.bugs.id }).from(schema.bugs).where(eq(schema.bugs.fixTaskId, task.id)).limit(1))[0]
      : undefined;
  const hasTraceability = links.length > 0 || isInfrastructure || Boolean(sourceBug);

  const deps = await dependenciesOf(db, task.id);
  const dependenciesExist = deps.every((d) => d.task.id);
  const pendingDeps = deps.filter((d) => d.task.workflowStatus !== "DONE" && d.task.workflowStatus !== "CANCELLED");

  const approvedReq = baseline.requirements;
  const approvedStack = baseline.stack;
  const approvedDesign = baseline.design;
  let artifactsCurrent = false;
  if (isInfrastructure) {
    artifactsCurrent = true;
  } else if (approvedReq && approvedStack) {
    const used = task.createdFromRevisionIds;
    // A task is current only if it was built from the revision that is
    // approved NOW — or from another version with the same content (approved
    // again, unchanged). `<=` treated tasks from requirements v1 as current
    // under v2, so a requirements change never flagged downstream tasks.
    const refTo = (approved: { artifact: { id: string } } | null) => (approved ? used.find((r) => r.artifact_id === approved.artifact.id) : undefined);
    const isCurrent = (approved: Awaited<ReturnType<typeof getApprovedRevision>>) => isRefCurrent(db, refTo(approved), approved);
    // Tasks that recorded the design, UI reference or design system they used must match the current one.
    const optional = [approvedDesign, baseline.ux, baseline.design_system];
    const recordedOnly = async (approved: Awaited<ReturnType<typeof getApprovedRevision>>) => !refTo(approved) || (await isCurrent(approved));
    // A recorded UI reference or design system that is no longer approved at all is a change too.
    const uiArtifacts = baseline.uiArtifacts;
    const lostUi = uiArtifacts.some((a) => !a.approvedRevisionId && used.some((r) => r.artifact_id === a.id));
    artifactsCurrent =
      (await isCurrent(approvedReq)) &&
      (await isCurrent(approvedStack)) &&
      !lostUi &&
      (await Promise.all(optional.map(recordedOnly))).every(Boolean);
  }

  // duplicate titles in project
  const sameTitle = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, task.projectId), eq(schema.tasks.title, task.title)));
  const graph = cachedGraph ?? (await validateProjectGraph(db, task.projectId));
  // A task that builds a screen is checked against the approved UI reference:
  // a render check on the web (a native screen has no browser to load), and
  // the screen's key elements in its criteria.
  const ux = baseline.reference;
  const uiTask = needsScreenLinks(task);
  const inferredScreens = uiTask && ux ? ux.screens.filter(s => links.some(l => s.requirement_keys.includes(l.requirement.key))) : [];
  const ui = ux
    ? {
        renderChecks: ux.platform?.kind !== "native-mobile",
        keyElements: Object.fromEntries(ux.screens.map((s) => [uxFilePath(s.key), s.key_elements])),
      }
    : null;

  const lint = lintTask(
    { title: task.title, objective: task.objective, key: task.key, contract: task.contract, workflowStatus: task.workflowStatus },
    {
      hasTraceability,
      dependenciesExist,
      graphAcyclic: graph.acyclic,
      artifactsCurrent,
      duplicateTitles: sameTitle.length,
      reviewPolicyResolved: Boolean(task.reviewPolicy),
      ui,
    },
  );

  const checks = [
    { id: "lint", label: "Task lint", ok: lint.ok, detail: lint.ok ? undefined : lint.findings.filter((f) => f.severity === "BLOCKING").map((f) => f.message).join("; ") },
    { id: "traceability", label: "Requirement traceability", ok: hasTraceability },
    { id: "artifacts", label: "Spec artifacts current", ok: artifactsCurrent },
    { id: "screen_links", label: "UI screens explicitly linked", ok: !inferredScreens.length || screenFilesOf(task.contract).length > 0 || /\b(shell|navigation|sidebar|navigasi)\b/i.test(task.title) },
  ];
  // NOTE: the old "Plan approval" check (lifecycleStatus !== "TASK_REVIEW")
  // was removed — TASK_REVIEW was never set anywhere, so the check could never
  // fail; it was dead code that pretended to gate plan approval.
  const ok = checks.every((c) => c.ok);
  const [updated] = await db
    .update(schema.tasks)
    .set({
      readinessStatus: ok ? "READY" : "NOT_READY",
      // Dependency completion is deliberately NOT a READY blocker: tasks enter
      // the board immediately after generation (auto-approve). Execution order
      // is enforced at claim time instead (see claimTask in execution/service).
      readinessReport: { ok, checks, pendingDependencies: pendingDeps.map((d) => d.task.key) },
      lintFindings: lint.findings,
      updatedAt: new Date(),
    })
    .where(eq(schema.tasks.id, task.id))
    .returning();
  return updated!;
}

/** Approve a DRAFT task into READY once readiness passes (transition table: DRAFT→READY). */
export async function readyTask(db: DbExecutor, input: { taskId: string; userId: string; source?: AuditSource }): Promise<TaskRow> {
  const task = await getTask(db, input.taskId);
  if (task.workflowStatus === "READY") return task; // idempotent retry — nothing to do
  if (task.workflowStatus !== "DRAFT") {
    throw errors.conflict("TASK_NOT_DRAFT", `Only DRAFT tasks can be readied (current: ${task.workflowStatus})`, {
      task_id: task.id,
      current_status: task.workflowStatus,
    });
  }
  const refreshed = await computeTaskReadiness(db, task);
  if (refreshed.readinessStatus !== "READY") {
    throw errors.conflict("TASK_NOT_READINESS_OK", "Task failed readiness checks", {
      checks: refreshed.readinessReport.checks.filter((c) => !c.ok),
    });
  }
  // Conditional on DRAFT: a concurrent cancel/split between the readiness
  // check and this write must win, not be overwritten back to READY.
  const [updated] = await db
    .update(schema.tasks)
    .set({ workflowStatus: "READY", updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.workflowStatus, "DRAFT")))
    .returning();
  if (!updated) {
    const current = await getTask(db, task.id);
    if (current.workflowStatus === "READY") return current; // a concurrent ready won
    throw errors.conflict("TASK_NOT_DRAFT", `Only DRAFT tasks can be readied (current: ${current.workflowStatus})`, {
      task_id: task.id,
      current_status: current.workflowStatus,
    });
  }
  await audit(db, {
    workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).limit(1))[0]!.workspaceId,
    projectId: task.projectId,
    actorType: "USER",
    actorId: input.userId,
    source: input.source ?? "WEB",
    action: "task.readied",
    entityType: "TASK",
    entityId: task.id,
  });
  publish({ topic: topics.project(task.projectId), type: "task_transitioned", payload: { task_id: task.id, from: task.workflowStatus, to: "READY" } });
  return updated!;
}

/** Rebase draft or ready tasks to current approved specification revisions (resolves stale spec locks). */
export async function rebaseTasksToApprovedRevisions(db: DbExecutor, projectId: string): Promise<number> {
  const approvedReq = await getApprovedRevision(db, projectId, "requirements");
  const approvedStack = await getApprovedRevision(db, projectId, "stack");
  const approvedDesign = await getApprovedRevision(db, projectId, "design");
  if (!approvedReq || !approvedStack) return 0;
  const approvedUx = await getApprovedRevision(db, projectId, "ux");
  const approvedDs = await getApprovedRevision(db, projectId, "design_system");
  const newRefs = [
    { artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version },
    { artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version },
    ...(approvedDesign ? [{ artifact_id: approvedDesign.artifact.id, version: approvedDesign.revision.version }] : []),
    ...[approvedUx, approvedDs].filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => ({ artifact_id: r.artifact.id, version: r.revision.version })),
  ];
  const targetTasks = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.projectId, projectId), inArray(schema.tasks.workflowStatus, ["DRAFT", "READY"])));
  const graph = await validateProjectGraph(db, projectId);
  for (const t of targetTasks) {
    await db.update(schema.tasks).set({ createdFromRevisionIds: newRefs, updatedAt: new Date() }).where(eq(schema.tasks.id, t.id));
    const [updated] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id)).limit(1);
    if (updated) {
      await computeTaskReadiness(db, updated, graph);
    }
  }
  return targetTasks.length;
}
