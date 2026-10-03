import type { AuditSource } from "../audit/service.js";
import { desc, eq, inArray } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { ConvergenceOutputSchema, qualityCriteria, type ConvergenceOutput } from "@sdd/contracts";
import { RunEvidenceSchema } from "@sdd/contracts";
import { isBlockingBug, isLegalBugTransition, isOpenBug } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, CONVERGENCE_SYSTEM_PROMPT } from "@sdd/ai";
import { getApprovedRevision } from "../artifact/service.js";
import { listRequirementsForRevision } from "../planning/requirements.js";
import { createTask, getTask, listAllTasks } from "../task/repo.js";
import { appShellLine, applyFixTaskContext, deriveFixTaskContext } from "../task/service.js";
import { designContextLines } from "../task/generation.js";
import { getProject } from "../project/service.js";
import { approvedUxReference, uxFilePath } from "../ux/ux.js";
import { audit } from "../audit/service.js";
import { publish, topics } from "../../events/bus.js";

/**
 * Convergence engine (Phase 16, T162–T167, FR-140..144, C18).
 * A feature is COMPLETE only through the convergence gate.
 */

type TaskRow = Awaited<ReturnType<typeof listAllTasks>>[number];
type RunRow = typeof schema.taskRuns.$inferSelect;
type ReviewRow = typeof schema.reviews.$inferSelect;
type TestRow = typeof schema.testResults.$inferSelect;

/** Files listed per task in the convergence context before the rest is summarised as a count. */
const MAX_EVIDENCE_FILES = 15;

/**
 * The run whose evidence stands for a DONE task: the one its latest approving
 * (or waiving) review decided on. Without such a review, the highest finished
 * attempt. Taking "the last row" of an unordered query, as before, could
 * surface an older failed attempt's summary as the evidence.
 */
export function evidenceRunOf(taskId: string, runs: RunRow[], taskReviews: ReviewRow[]): RunRow | null {
  const own = runs.filter((r) => r.taskId === taskId);
  const approving = taskReviews
    .filter((r) => (r.decision === "APPROVED" || r.decision === "WAIVED") && r.runId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const review of approving) {
    const run = own.find((r) => r.id === review.runId);
    if (run) return run;
  }
  const byAttempt = [...own].sort((a, b) => b.attempt - a.attempt);
  return byAttempt.find((r) => r.status === "FINISHED" || r.status === "SUBMITTED") ?? byAttempt[0] ?? null;
}

/** One DONE task's evidence block: summary, commit, files, latest result per verification command, reviews. */
export function taskEvidenceLines(
  task: { key: string; title: string; requirementKeys: string[] },
  run: RunRow | null,
  taskReviews: ReviewRow[],
  tests: TestRow[],
): string {
  const latest = new Map<string, TestRow>();
  for (const t of [...tests].filter((t) => run && t.runId === run.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    latest.set(t.command.trim().replace(/\s+/g, " "), t);
  }
  const files = run?.filesChanged ?? [];
  const shownFiles = files.slice(0, MAX_EVIDENCE_FILES).join(", ") + (files.length > MAX_EVIDENCE_FILES ? ` (+${files.length - MAX_EVIDENCE_FILES} more)` : "");
  const verification = [...latest.entries()].map(([command, t]) => `\`${command}\` ${t.status}`).join("; ");
  return [
    `- ${task.key}: ${task.title}`,
    `  requirements: ${task.requirementKeys.join(", ") || "(none)"}`,
    `  summary: ${run?.summary ?? "(none)"}`,
    `  commit: ${run?.commitSha ?? "(none)"}`,
    `  files changed: ${shownFiles || "(none reported)"}`,
    `  verification: ${verification || "(none reported)"}`,
    `  review: ${taskReviews.map((r) => r.decision).join(",") || "(none)"}`,
    `  implementation evidence: ${JSON.stringify(run?.metadata?.evidence ? { ...(run.metadata.evidence as object), artifacts: (run.metadata.evidence as import("@sdd/contracts").RunEvidence).artifacts?.map(({ image, ...a }) => a) } : null)}`,
    `  criterion review: ${JSON.stringify(run?.metadata?.ai_review ?? null)}`,
    `  verification details: ${JSON.stringify([...latest.values()].map(t => ({ command: t.command, exit_code: t.exitCode, summary: t.summary, artifact_ref: t.artifactRef })))}`,
  ].join("\n");
}

export function convergenceCoverageIssues(requirements: Array<{ key: string; statement?: string; acceptance_criteria: Array<{ key: string }> }>, coverage: ConvergenceOutput["coverage"]): string[] {
  const expected = new Set(requirements.flatMap(r => (r.acceptance_criteria.length ? r.acceptance_criteria : qualityCriteria({ key: r.key, statement: r.statement ?? r.key })).map(ac => `${r.key}/${ac.key}`)));
  const seen = new Set<string>(), issues: string[] = [];
  for (const c of coverage) {
    const key = `${c.requirement_key}/${c.acceptance_criterion_key}`;
    if (!expected.has(key) || seen.has(key)) issues.push(`Invalid or duplicate coverage ${key}`);
    seen.add(key);
    if (c.status !== "COVERED" || !c.evidence.trim()) issues.push(`${key} is not proven covered`);
  }
  for (const key of expected) if (!seen.has(key)) issues.push(`Missing coverage ${key}`);
  return issues;
}

/**
 * What a feature is accountable for, derived from task traceability.
 *
 * Requirements: the ones the feature's own tasks link to, plus a requirement
 * sharing the feature's key (plans that name features after requirements).
 * Evidence: every task — in any feature — linked to one of those requirements,
 * so work done under a neighbouring feature still counts for this one.
 *
 * Judging a feature against the whole project's requirements (the old
 * behaviour) made every other feature's requirements look MISSING, so no
 * feature could ever pass the gate.
 */
/** What every feature's scope is computed from, read once per project. */
async function projectScopeContext(db: DbExecutor, projectId: string) {
  const [approvedReq, allTasks, approvedDesign] = await Promise.all([getApprovedRevision(db, projectId, "requirements"), listAllTasks(db, projectId), getApprovedRevision(db, projectId, "design")]);
  const planning = await db.select({ approvedAt: schema.artifactRevisions.approvedAt }).from(schema.artifacts).innerJoin(schema.artifactRevisions, eq(schema.artifactRevisions.id, schema.artifacts.approvedRevisionId)).where(eq(schema.artifacts.projectId, projectId));
  const planningApprovedAt = planning.reduce((latest, row) => Math.max(latest, row.approvedAt?.getTime() ?? 0), 0);
  const links = allTasks.length
    ? await db
        .select({ taskId: schema.taskRequirementLinks.taskId, requirementId: schema.taskRequirementLinks.requirementId, acceptanceCriterionId: schema.taskRequirementLinks.acceptanceCriterionId })
        .from(schema.taskRequirementLinks)
        .where(inArray(schema.taskRequirementLinks.taskId, allTasks.map((t) => t.id)))
    : [];
  const linkedIds = [...new Set(links.map((l) => l.requirementId))];
  // Links point at a specific revision's rows; keys survive re-approval.
  const [linkedRows, approved] = await Promise.all([
    linkedIds.length
      ? db.select({ id: schema.requirements.id, key: schema.requirements.key }).from(schema.requirements).where(inArray(schema.requirements.id, linkedIds))
      : Promise.resolve([]),
    approvedReq ? listRequirementsForRevision(db, approvedReq.revision.id) : Promise.resolve([]),
  ]);
  const keyById = new Map(linkedRows.map((r) => [r.id, r.key]));
  const keysByTask = new Map<string, Set<string>>();
  for (const l of links) {
    const key = keyById.get(l.requirementId);
    if (!key) continue;
    if (!keysByTask.has(l.taskId)) keysByTask.set(l.taskId, new Set());
    keysByTask.get(l.taskId)!.add(key);
  }
  const activeFeatures = await db.select({ id: schema.features.id, status: schema.features.status }).from(schema.features).where(eq(schema.features.projectId, projectId));
  const activeFeatureIds = new Set(activeFeatures.filter(f => f.status !== "CANCELLED").map(f => f.id));
  const acRows = links.some(l => l.acceptanceCriterionId) ? await db.select().from(schema.acceptanceCriteria).where(inArray(schema.acceptanceCriteria.id, links.flatMap(l => l.acceptanceCriterionId ? [l.acceptanceCriterionId] : []))) : [];
  const acById = new Map(acRows.map(ac => [ac.id, ac.key]));
  const activeTaskIds = new Set(allTasks.filter(t => t.workflowStatus !== "CANCELLED" && t.featureId && activeFeatureIds.has(t.featureId)).map(t => t.id));
  const linkedCriteria = new Set(links.filter(l => activeTaskIds.has(l.taskId) && l.acceptanceCriterionId).map(l => `${keyById.get(l.requirementId)}/${acById.get(l.acceptanceCriterionId!)}`));
  return { approvedReq, allTasks, keysByTask, approved, linkedCriteria, approvedDesign, planningApprovedAt, activeTaskIds };
}
type ScopeContext = Awaited<ReturnType<typeof projectScopeContext>>;

async function featureScope(db: DbExecutor, feature: { id: string; key: string; projectId: string }) {
  return scopeOf(await projectScopeContext(db, feature.projectId), feature);
}

/** The approved requirements a feature answers for, and every task accountable for them. */
function scopeOf({ approvedReq, allTasks, keysByTask, approved, approvedDesign }: ScopeContext, feature: { id: string; key: string }) {
  const keys = new Set<string>();
  for (const t of allTasks) if (t.featureId === feature.id) for (const k of keysByTask.get(t.id) ?? []) keys.add(k);
  if (approved.some((r) => r.key === feature.key)) keys.add(feature.key);

  const requirements = approved.filter((r) => keys.has(r.key));
  const tasks: Array<TaskRow & { requirementKeys: string[] }> = allTasks
    .filter((t) => t.featureId === feature.id || [...(keysByTask.get(t.id) ?? [])].some((k) => keys.has(k)) || ((approvedDesign?.revision.structuredContent as import("@sdd/contracts").DesignArtifact | null)?.delivery_checks ?? []).some(c => t.contract.verification.required.some(v => v.command.trim() === c.command.trim())))
    .map((t) => ({ ...t, requirementKeys: [...(keysByTask.get(t.id) ?? [])] }));
  return { approvedReq, requirements, tasks };
}

export async function startConvergenceRun(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { featureId: string; userId: string; source?: AuditSource },
) {
  const [feature] = await db.select().from(schema.features).where(eq(schema.features.id, input.featureId)).limit(1);
  if (!feature) throw errors.notFound("Feature", input.featureId);
  const project = await getProject(db, feature.projectId);
  const { approvedReq, requirements, tasks: featureTasks } = await featureScope(db, feature);
  if (!approvedReq) throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Convergence requires an approved requirements revision");
  if (requirements.length === 0) {
    throw errors.conflict(
      "FEATURE_HAS_NO_REQUIREMENTS",
      "This feature has no tasks linked to an approved requirement, so there is nothing to check it against",
    );
  }
  const approvedDesign = await getApprovedRevision(db, feature.projectId, "design");

  // Completed task evidence (T164). Unpaginated: evidence must be complete.
  const doneTasks = featureTasks.filter((t) => t.workflowStatus === "DONE");
  const runs = doneTasks.length
    ? await db.select().from(schema.taskRuns).where(inArray(schema.taskRuns.taskId, doneTasks.map((t) => t.id)))
    : [];
  const reviews = doneTasks.length
    ? await db.select().from(schema.reviews).where(inArray(schema.reviews.taskId, doneTasks.map((t) => t.id)))
    : [];
  const evidenceRunIds = doneTasks
    .map((t) => evidenceRunOf(t.id, runs, reviews.filter((r) => r.taskId === t.id))?.id)
    .filter((id): id is string => Boolean(id));
  const tests = evidenceRunIds.length
    ? await db.select().from(schema.testResults).where(inArray(schema.testResults.runId, evidenceRunIds))
    : [];
  const openBugs = (await db.select().from(schema.bugs).where(eq(schema.bugs.projectId, feature.projectId))).filter(
    (b) => (b.featureId === null || b.featureId === feature.id) && isOpenBug(b.status),
  );

  // Screens of the approved UI reference that serve an in-scope requirement.
  const scopeKeys = new Set(requirements.map((r) => r.key));
  const ux = await approvedUxReference(db, feature.projectId);
  const screens = (ux?.screens ?? []).filter((s) => s.requirement_keys.some((k) => scopeKeys.has(k)));

  const context = [
    `FEATURE: ${feature.key} — ${feature.title}`,
    feature.description ? `DESCRIPTION: ${feature.description}` : "",
    "",
    "SCOPE: evaluate ONLY the requirements listed below. Other requirements of the project belong to other features and are out of scope — do not report them.",
    "",
    "REQUIREMENTS IN SCOPE:",
    ...requirements.map(
      (r) =>
        `- ${r.key} [${r.priority}] ${r.title}\n  ${r.statement}\n${r.acceptance_criteria.map((ac) => `  · ${ac.key}: ${ac.statement}`).join("\n")}`,
    ),
    "",
    "COMPLETED TASKS + EVIDENCE:",
    ...doneTasks.map((t) => {
      const taskReviews = reviews.filter((r) => r.taskId === t.id);
      return taskEvidenceLines(t, evidenceRunOf(t.id, runs, taskReviews), taskReviews, tests);
    }),
    "",
    "INCOMPLETE TASKS:",
    ...featureTasks.filter((t) => !["DONE", "CANCELLED"].includes(t.workflowStatus)).map((t) => `- ${t.key} (${t.workflowStatus}): ${t.title}`),
    "",
    ...(screens.length
      ? [
          "UI REFERENCE (approved; layout, elements and flow are binding):",
          ...screens.map((s) => `- ${uxFilePath(s.key)} — ${s.name}: key elements: ${s.key_elements.join("; ")}`),
          // The shell is checked here too, or a screen built as a standalone page passes (docs/28 R4).
          appShellLine(ux!),
          ...screens.map(s => `APPROVED SCREEN HTML ${s.key}: ${s.html ?? "(not supplied)"}`),
          "",
        ]
      : []),
    "OPEN BUGS:",
    ...(openBugs.length ? openBugs.map((b) => `- ${b.key} [${b.severity}] ${b.title} (${b.status})`) : ["(none)"]),
    ...designContextLines(approvedDesign?.revision.structuredContent as import("@sdd/contracts").DesignArtifact | null),
  ].join("\n");

  const [run] = await db
    .insert(schema.convergenceRuns)
    .values({
      featureId: feature.id,
      requirementsRevisionId: approvedReq.revision.id,
      designRevisionId: approvedDesign?.revision.id ?? null,
      status: "RUNNING",
    })
    .returning();

  try {
    const renderImages = new Map<string, string>();
    for (const task of [...doneTasks].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())) {
      const accepted = evidenceRunOf(task.id, runs, reviews.filter(r => r.taskId === task.id));
      const evidence = RunEvidenceSchema.safeParse(accepted?.metadata?.evidence);
      if (evidence.success) for (const artifact of evidence.data.artifacts) if (artifact.image && screens.some(s => artifact.path.includes(`/${s.key}-`))) renderImages.set(artifact.path, artifact.image);
    }
    if (screens.length && ux?.platform?.kind !== "native-mobile") for (const screen of screens) for (const width of [1280, 360]) {
      if (!renderImages.has(`docs/ui-reference/renders/${screen.key}-${width}.png`)) throw errors.conflict("RELEASE_RENDER_MISSING", `Missing release screenshot ${screen.key}-${width}.png`);
    }
    if (context.length > 1500000 || renderImages.size > 40) throw errors.conflict("REVIEW_CONTEXT_TOO_LARGE", "Release evidence exceeds the review budget; split the feature before reviewing");
    const result = await runStructured(gateway, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      artifactId: null,
      role: "CONVERGENCE",
      schema: ConvergenceOutputSchema,
      schemaName: "ConvergenceOutput",
      system: CONVERGENCE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: context, images: [...renderImages.values()] }],    });
    const out = result.data as ConvergenceOutput;
    const coverageIssues = convergenceCoverageIssues(requirements, out.coverage);
    // A model's YES never overrides incomplete or unknown criterion coverage.
    if (coverageIssues.length || out.findings.some(f => ["HIGH", "BLOCKING"].includes(f.severity) && f.finding_type !== "COVERED")) out.completion_recommended = false;
    if (out.findings.some(f => f.requirement_key && !requirements.some(r => r.key === f.requirement_key && (!f.acceptance_criterion_key || r.acceptance_criteria.some(ac => ac.key === f.acceptance_criterion_key))))) throw errors.conflict("REVIEW_SCOPE_INVALID", "Reviewer findings reference an unknown requirement or criterion");
    for (const r of requirements) for (const ac of r.acceptance_criteria) {
      const c = out.coverage.find(c => c.requirement_key === r.key && c.acceptance_criterion_key === ac.key);
      if ((!c || c.status !== "COVERED") && !out.findings.some(f => f.requirement_key === r.key && (!f.acceptance_criterion_key || f.acceptance_criterion_key === ac.key))) out.findings.push({ finding_type: c?.status ?? "MISSING", severity: "BLOCKING", requirement_key: r.key, acceptance_criterion_key: ac.key, description: `Prove ${r.key}/${ac.key}: ${ac.statement}`.slice(0, 1200), evidence: c?.evidence ?? "Reviewer did not provide criterion evidence", suggested_task: null });
    }
    for (const f of out.findings) {
      await db.insert(schema.convergenceFindings).values({
        convergenceRunId: run!.id,
        findingType: f.finding_type,
        severity: f.severity,
        description: f.description,
        evidence: f.evidence,
        suggestedTask: f.suggested_task,
        requirementKey: f.requirement_key,
        acceptanceCriterionKey: f.acceptance_criterion_key,
        sourceRef: f.requirement_key ?? "",
        resolutionStatus: "OPEN",
      });
    }
    const [completed] = await db
      .update(schema.convergenceRuns)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        summary: out.summary,
        completionRecommended: out.completion_recommended ? "YES" : "NO",
        coverage: out.coverage,
        aiGenerationRunId: result.generationRunId,
      })
      .where(eq(schema.convergenceRuns.id, run!.id))
      .returning();
    await audit(db, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: "convergence.run_completed",
      entityType: "CONVERGENCE_RUN",
      entityId: run!.id,
      metadata: { findings: out.findings.length },
    });
    return { run: completed!, findings: out.findings };
  } catch (error) {
    await db.update(schema.convergenceRuns).set({ status: "FAILED", completedAt: new Date() }).where(eq(schema.convergenceRuns.id, run!.id));
    throw error;
  }
}

export async function getConvergenceRun(db: DbExecutor, runId: string) {
  const [run] = await db.select().from(schema.convergenceRuns).where(eq(schema.convergenceRuns.id, runId)).limit(1);
  if (!run) throw errors.notFound("Convergence run", runId);
  const findings = await db.select().from(schema.convergenceFindings).where(eq(schema.convergenceFindings.convergenceRunId, runId));
  return { run, findings };
}

export async function listConvergenceRuns(db: DbExecutor, featureId: string) {
  return runsWithFindings(db, await db.select().from(schema.convergenceRuns).where(eq(schema.convergenceRuns.featureId, featureId)).orderBy(desc(schema.convergenceRuns.createdAt)));
}

/** Attach each run's findings with one query, keeping the runs' order. */
async function runsWithFindings(db: DbExecutor, runs: Array<typeof schema.convergenceRuns.$inferSelect>) {
  const findings = runs.length
    ? await db.select().from(schema.convergenceFindings).where(inArray(schema.convergenceFindings.convergenceRunId, runs.map((r) => r.id)))
    : [];
  return runs.map((run) => ({ run, findings: findings.filter((f) => f.convergenceRunId === run.id) }));
}

/** Generate a traceable task from a blocking finding (T166, FR-143). */
export async function generateTaskFromFinding(db: DbExecutor, input: { findingId: string; userId: string }) {
  return db.transaction(async tx => {
    await tx.select({ id: schema.convergenceFindings.id }).from(schema.convergenceFindings).where(eq(schema.convergenceFindings.id, input.findingId)).for("update").limit(1);
    return generateTaskFromFindingLocked(tx, input);
  });
}

async function generateTaskFromFindingLocked(
  db: DbExecutor,
  input: { findingId: string; userId: string },
) {
  const [finding] = await db.select().from(schema.convergenceFindings).where(eq(schema.convergenceFindings.id, input.findingId)).limit(1);
  if (!finding) throw errors.notFound("Convergence finding", input.findingId);
  const [run] = await db.select().from(schema.convergenceRuns).where(eq(schema.convergenceRuns.id, finding.convergenceRunId)).limit(1);
  if (!run) throw errors.notFound("Convergence run", finding.convergenceRunId);
  const [feature] = await db.select().from(schema.features).where(eq(schema.features.id, run.featureId)).limit(1);
  if (!feature) throw errors.notFound("Feature", run.featureId);

  // Idempotent: a finding yields at most one live task (repeat clicks used to
  // create duplicate tasks).
  if (finding.generatedTaskId) {
    const existing = await getTask(db, finding.generatedTaskId).catch(() => null);
    if (existing && existing.workflowStatus !== "CANCELLED") return { finding, task: existing };
  }

  const objective = `${finding.suggestedTask?.objective ?? `Resolve convergence finding on ${feature.key}: ${finding.description}`}\n\nFinding: ${finding.description}\nEvidence: ${finding.evidence}`.slice(0, 4000);
  const fixContext = await deriveFixTaskContext(db, {
    projectId: feature.projectId,
    featureId: feature.id,
    requirementKey: finding.requirementKey,
    acceptanceCriterionKey: finding.acceptanceCriterionKey,
  });
  const createdFromRevisionIds = fixContext.revisionRefs;

  const task = await createTask(db, {
    projectId: feature.projectId,
    featureId: feature.id,
    title: (finding.suggestedTask?.title ?? `Convergence fix: ${finding.description.slice(0, 160)}`).slice(0, 200),
    taskType: "code",
    objective,
    contract: {
      title: (finding.suggestedTask?.title ?? `Convergence fix: ${finding.description.slice(0, 160)}`).slice(0, 200),
      task_type: "code",
      objective,
      scope: fixContext.scope,
      constraints: fixContext.constraints,
      ui_screen_keys: fixContext.ui_screen_keys,
      acceptance_criteria: [finding.description.slice(0, 600), "Add a regression test that fails for the reported gap and passes after the fix.", ...fixContext.acceptance_criteria],
      verification: { required: fixContext.verification.required, evidence: ["test_result", "diff", "summary"] },
      deliverables: ["implementation", "automated_tests", "execution_summary"],
      stop_conditions: ["The finding conflicts with an approved requirement."],
      risk_factors: fixContext.riskFactors,
      parallel_safe: false,
      priority: finding.severity === "BLOCKING" ? "P0" : "P1",
      dependency_outputs: {},
    },
    riskFactors: fixContext.riskFactors,
    ...fixContext.risk,
    parallelSafe: false,
    priority: finding.severity === "BLOCKING" ? "P0" : "P1",
    createdFromRevisionIds,
  });
  const readied = await applyFixTaskContext(db, task.id, fixContext.links);
  const [updatedFinding] = await db
    .update(schema.convergenceFindings)
    .set({ resolutionStatus: "TASK_GENERATED", generatedTaskId: task.id })
    .where(eq(schema.convergenceFindings.id, finding.id))
    .returning();
  publish({ topic: topics.project(feature.projectId), type: "convergence_task_generated", payload: { task_id: task.id } });
  return { finding: updatedFinding!, task: readied };
}

/**
 * Feature completion gate (T167, FR-144, C18): blocking findings or open
 * blocking bugs prevent COMPLETE.
 */
export async function evaluateFeatureCompletionGate(db: DbExecutor, featureId: string) {
  const [feature] = await db.select().from(schema.features).where(eq(schema.features.id, featureId)).limit(1);
  if (!feature) throw errors.notFound("Feature", featureId);
  const [runs, projectBugs, scope] = await Promise.all([
    listConvergenceRuns(db, featureId),
    db.select().from(schema.bugs).where(eq(schema.bugs.projectId, feature.projectId)),
    projectScopeContext(db, feature.projectId),
  ]);
  return completionGate(feature, runs[0], projectBugs, scope);
}

/**
 * The completion gate of every feature in a project, reading what they share
 * (bugs, tasks, requirement links, approved requirements) once instead of per
 * feature. Runs newest first, like listConvergenceRuns.
 */
export async function evaluateProjectCompletionGates(db: DbExecutor, projectId: string) {
  const features = await db.select().from(schema.features).where(eq(schema.features.projectId, projectId)).orderBy(desc(schema.features.createdAt));
  if (!features.length) return [];
  const [runs, projectBugs, scope] = await Promise.all([
    db
      .select()
      .from(schema.convergenceRuns)
      .where(inArray(schema.convergenceRuns.featureId, features.map((f) => f.id)))
      .orderBy(desc(schema.convergenceRuns.createdAt)),
    db.select().from(schema.bugs).where(eq(schema.bugs.projectId, projectId)),
    projectScopeContext(db, projectId),
  ]);
  const latestRuns = features.map((f) => runs.find((r) => r.featureId === f.id)).filter((r) => r !== undefined);
  const latest = await runsWithFindings(db, latestRuns);
  return features.map((feature) => ({
    feature,
    checked: runs.some((r) => r.featureId === feature.id),
    gate: completionGate(feature, latest.find((l) => l.run.featureId === feature.id), projectBugs, scope),
  }));
}

function completionGate(
  feature: { id: string; key: string },
  latest: { run: typeof schema.convergenceRuns.$inferSelect; findings: Array<typeof schema.convergenceFindings.$inferSelect> } | undefined,
  projectBugs: Array<typeof schema.bugs.$inferSelect>,
  scope: ScopeContext,
) {
  const featureId = feature.id;
  const openBlockingFindings = latest ? latest.findings.filter((f) => ["BLOCKING", "HIGH"].includes(f.severity) && ["OPEN", "TASK_GENERATED"].includes(f.resolutionStatus) && f.findingType !== "COVERED") : [];
  const blockingBugs = projectBugs.filter((b) => (b.featureId === null || b.featureId === featureId) && isBlockingBug(b.status));

  // Every task accountable for the feature's requirements, wherever it lives.
  // A feature with no such task has no work behind it and cannot be complete —
  // before, "all zero tasks are done" let it pass.
  const { tasks: featureTasks, requirements: scopedRequirements } = scopeOf(scope, feature);
  const incomplete = featureTasks.filter((t) => !["DONE", "CANCELLED"].includes(t.workflowStatus));
  const noTasks = featureTasks.every(t => t.workflowStatus === "CANCELLED") || scopedRequirements.length === 0;
  const approvedReq = scope.approvedReq;
  const linkedKeys = new Set(scope.allTasks.filter(t => scope.activeTaskIds.has(t.id)).flatMap(t => [...(scope.keysByTask.get(t.id) ?? [])]));
  const uncovered = scope.approved.filter(r => !linkedKeys.has(r.key) || r.acceptance_criteria.some(ac => !scope.linkedCriteria.has(`${r.key}/${ac.key}`)));
  const stale = latest && (latest.run.designRevisionId !== (scope.approvedDesign?.revision.id ?? null) || scope.planningApprovedAt > latest.run.createdAt.getTime()) ? "An approved planning artifact changed; rerun Convergence." : latest
    ? convergenceVerdictStale(latest.run, { approvedRequirementsRevisionId: approvedReq?.revision.id ?? null, scopeTasks: featureTasks })
    : null;

  const coverageIssues = latest ? convergenceCoverageIssues(scopedRequirements, latest.run.coverage) : ["No review coverage"];
  const design = scope.approvedDesign?.revision.structuredContent as import("@sdd/contracts").DesignArtifact | null;
  const deliveryIssues = design ? !design.delivery_checks?.length ? ["No bounded production build/startup/journey checks are defined"] : design.delivery_checks.flatMap(check => {
    const owners = scope.allTasks.filter(t => t.workflowStatus !== "CANCELLED" && t.contract.verification.required.some(v => v.type !== "manual" && v.command.trim() === check.command.trim()));
    return [...(!owners.some(t => t.workflowStatus === "DONE") ? [`Unproven delivery check: ${check.command}`] : []), ...check.expected_paths.filter(path => !scope.allTasks.some(t => t.workflowStatus === "DONE" && t.contract.scope.expected_paths.includes(path))).map(path => `Unowned delivery output: ${path}`)];
  }) : [];
  const canComplete =
    coverageIssues.length === 0 &&
    deliveryIssues.length === 0 &&
    !noTasks &&
    uncovered.length === 0 &&
    openBlockingFindings.length === 0 &&
    blockingBugs.length === 0 &&
    incomplete.length === 0 &&
    !stale &&
    Boolean(latest?.run.status === "COMPLETED" && latest.run.completionRecommended === "YES");
  return {
    canComplete,
    blockers: {
      open_blocking_findings: openBlockingFindings.map((f) => ({ id: f.id, description: f.description })),
      blocking_bugs: blockingBugs.map((b) => ({ id: b.id, key: b.key, title: b.title })),
      incomplete_tasks: incomplete.map((t) => ({ id: t.id, key: t.key, status: t.workflowStatus })),
      convergence_recommended: latest?.run.completionRecommended === "YES" && !stale && !coverageIssues.length,
      coverage_issues: coverageIssues,
      delivery_issues: deliveryIssues,
      convergence_stale: stale,
      no_tasks: noTasks,
      uncovered_requirements: uncovered.map(r => r.key),
    },
  };
}

/**
 * A convergence verdict speaks for the requirements revision and task state it
 * examined. It no longer counts once the approved requirements moved on, or
 * any in-scope task changed after the run finished (reopened, new work, a
 * newer attempt) — run convergence again. Null = still current.
 */
export function convergenceVerdictStale(
  run: { requirementsRevisionId: string; completedAt: Date | null; createdAt?: Date },
  current: { approvedRequirementsRevisionId: string | null; scopeTasks: Array<{ key: string; updatedAt: Date }> },
): string | null {
  if (!run.completedAt) return null; // still running / failed: not a verdict
  if (current.approvedRequirementsRevisionId !== run.requirementsRevisionId) {
    return "The approved requirements changed after this convergence run — run convergence again.";
  }
  const changed = current.scopeTasks.filter((t) => t.updatedAt.getTime() > (run.createdAt ?? run.completedAt)!.getTime());
  if (changed.length > 0) {
    return `${changed.map((t) => t.key).slice(0, 5).join(", ")}${changed.length > 5 ? ` and ${changed.length - 5} more` : ""} changed after this convergence run — run convergence again.`;
  }
  return null;
}

export async function completeFeature(db: DbExecutor, input: { featureId: string; userId: string; source?: AuditSource }) {
  const gate = await evaluateFeatureCompletionGate(db, input.featureId);
  if (!gate.canComplete) {
    throw errors.conflict("CONVERGENCE_GATE_BLOCKED", "Feature cannot be completed while blocking findings/bugs or incomplete tasks remain (C18)", gate.blockers);
  }
  const [feature] = await db
    .update(schema.features)
    .set({ status: "COMPLETE", updatedAt: new Date() })
    .where(eq(schema.features.id, input.featureId))
    .returning();
  const project = await getProject(db, feature!.projectId);
  await audit(db, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorType: "USER",
    actorId: input.userId,
    source: input.source ?? "WEB",
    action: "feature.completed",
    entityType: "FEATURE",
    entityId: input.featureId,
  });
  return feature!;
}

export { isLegalBugTransition, isOpenBug };
