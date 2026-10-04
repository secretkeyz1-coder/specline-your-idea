import { and, asc, eq, ne, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { TaskReviewOutputSchema, type TaskContract, type RunEvidence } from "@sdd/contracts";
import { runStructured, REVIEW_PROMPT, type GatewayDeps } from "@sdd/ai";
import { buildContextPack } from "../prompt/service.js";
import { getTask } from "../task/repo.js";
import { createReview, requeueTask } from "./service.js";
import { approvedUxReference, uxFilePath } from "../ux/ux.js";
import { screenFilesOf, SHELL_TITLE } from "../task/lint.js";
import { isAuthScreen } from "../ux/ux-od-seeds.js";
import { autoApproveWithheld } from "../task/screen-review.js";

export async function autoReviewAllowed(db: DbExecutor, projectId: string, userId: string, machineId: string | null, tokenMachineId?: string | null) {
  if (!machineId || (tokenMachineId && tokenMachineId !== machineId)) return false;
  const [link] = await db.select({ id: schema.repositoryLinks.id }).from(schema.repositoryLinks)
    .innerJoin(schema.localMachines, eq(schema.localMachines.id, schema.repositoryLinks.machineId))
    .where(and(eq(schema.repositoryLinks.projectId, projectId), eq(schema.localMachines.id, machineId), eq(schema.localMachines.userId, userId), ne(schema.localMachines.status, "REVOKED"), eq(schema.repositoryLinks.status, "ACTIVE"), eq(schema.repositoryLinks.permissionMode, "AUTO_RUN"))).limit(1);
  return Boolean(link);
}

/** Submission credentials cannot lend machine attribution to an unbound run. */
export async function runAutoReviewAllowed(db: DbExecutor, projectId: string, userId: string, run: { machineId: string | null }, tokenMachineId?: string | null) {
  return autoReviewAllowed(db, projectId, userId, run.machineId, tokenMachineId);
}

export function reviewApprovalIssues(contract: TaskContract, result: { acceptance_coverage: Array<{ criterion_index: number; status: string; evidence: string }>; findings: Array<{ severity: string }>; source_consistency?: Array<{ requirement_key: string; status: string; evidence: string }> }, sourceKeys: string[] = []): string[] {
  const issues: string[] = [];
  const seen = new Set<number>();
  for (const c of result.acceptance_coverage) {
    if (!Number.isInteger(c.criterion_index) || c.criterion_index < 0 || seen.has(c.criterion_index) || c.criterion_index >= contract.acceptance_criteria.length) issues.push("Duplicate or unknown criterion coverage");
    seen.add(c.criterion_index);
    if (c.status !== "COVERED" || !c.evidence.trim()) issues.push(`Criterion ${c.criterion_index + 1} is not proven covered`);
  }
  if (seen.size !== contract.acceptance_criteria.length) issues.push("Reviewer did not assess every acceptance criterion");
  if (result.findings.some(f => ["BLOCKING", "HIGH"].includes(f.severity))) issues.push("Unresolved blocking/high findings");
  for (const key of sourceKeys) {
    const entries = result.source_consistency?.filter(c => c.requirement_key === key) ?? [];
    if (entries.length !== 1 || entries[0]?.status !== "CONSISTENT" || !entries[0]?.evidence.trim()) issues.push(`Source outcome ${key} is not proven consistent`);
  }
  if (result.source_consistency?.some(c => !sourceKeys.includes(c.requirement_key))) issues.push("Unknown source consistency requirement");
  return issues;
}

/** A failed/missing reviewer leaves the submitted run available to a person. Never fall back to approving on test status. */
export async function reviewSubmittedRun(gateway: GatewayDeps, db: DbExecutor, runId: string, userId: string, autonomous: boolean) {
  // ponytail: a three-hour lease bounds duplicate provider calls without holding a pool connection during AI work.
  const token = crypto.randomUUID();
  const lease = { token, expires_at: new Date(Date.now() + 3 * 60 * 60_000).toISOString() };
  // Bun SQL can store Drizzle JSON payloads as a JSON string; unwrap before applying PostgreSQL JSON operators.
  const metadata = sql`CASE WHEN jsonb_typeof(${schema.taskRuns.metadata}) = 'string' THEN (${schema.taskRuns.metadata} #>> '{}')::jsonb ELSE coalesce(${schema.taskRuns.metadata}, '{}'::jsonb) END`;
  const [claimed] = await db.update(schema.taskRuns).set({ metadata: sql`(${metadata}) || jsonb_build_object('review_lock', jsonb_build_object('token', ${token}::text, 'expires_at', ${lease.expires_at}::text))` })
    .where(and(eq(schema.taskRuns.id, runId), sql`((${metadata})->'review_lock'->>'expires_at' IS NULL OR ((${metadata})->'review_lock'->>'expires_at')::timestamptz < now())`)).returning({ id: schema.taskRuns.id });
  if (!claimed) return { auto_approve_withheld: "Review already running or run not found", auto_approved: false, changes_requested: false };
  try { return await reviewSubmittedRunLocked(gateway, db, runId, userId, autonomous); }
  finally {
    await db.update(schema.taskRuns).set({ metadata: sql`(${metadata}) - 'review_lock'` }).where(and(eq(schema.taskRuns.id, runId), sql`(${metadata})->'review_lock'->>'token' = ${token}`));
  }
}

async function reviewSubmittedRunLocked(gateway: GatewayDeps, db: DbExecutor, runId: string, userId: string, autonomous: boolean) {
  const [run] = await db.select().from(schema.taskRuns).where(eq(schema.taskRuns.id, runId)).limit(1);
  if (!run) return { auto_approve_withheld: "Submitted run not found" };
  const task = await getTask(db, run.taskId);
  if (task.workflowStatus === "DONE") return { task, auto_approved: true };
  if (task.workflowStatus !== "NEEDS_REVIEW") return { task };
  const evidence = run.metadata?.evidence as RunEvidence | undefined;
  if (!evidence?.diff.trim() || evidence.diff_truncated) return { task, auto_approve_withheld: "Complete implementation diff required for AI review" };
  const pack = await buildContextPack(db, task);
  const ux = await approvedUxReference(db, task.projectId);
  const screenFiles = screenFilesOf(task.contract);
  const shellTask = SHELL_TITLE.test(task.title) && !screenFiles.length;
  const screens = (ux?.screens ?? []).filter(s => screenFiles.includes(uxFilePath(s.key)) || (shellTask && !isAuthScreen(s))).slice(0, shellTask ? 1 : undefined);
  if (screens.length && ux?.platform?.kind !== "native-mobile") for (const screen of screens) for (const width of [1280, 360]) {
    if (!evidence.artifacts.some(a => a.path === `docs/ui-reference/renders/${screen.key}-${width}.png` && a.image)) return { task, auto_approve_withheld: `Missing screenshot ${screen.key}-${width}.png` };
  }
  const tests = await db.select().from(schema.testResults).where(eq(schema.testResults.runId, runId)).orderBy(asc(schema.testResults.createdAt));
  const events = await db.select().from(schema.taskEvents).where(eq(schema.taskEvents.runId, runId)).orderBy(asc(schema.taskEvents.id));
  try {
    const result = await runStructured(gateway, {
      workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).limit(1))[0]!.workspaceId,
      projectId: task.projectId, role: "REVIEW", schema: TaskReviewOutputSchema, schemaName: "TaskReviewOutput",
      system: REVIEW_PROMPT,
      messages: [{ role: "user", content: JSON.stringify({ contract: task.contract, context: pack, ui_reference: screens.map(s => ({ key: s.key, html: s.html })), implementation: { summary: run.summary, commit: run.commitSha, files: run.filesChanged, evidence: { ...evidence, artifacts: evidence.artifacts.map(({ image, ...a }) => a) } }, tests, events: events.slice(-40) }), images: evidence.artifacts.filter(a => screens.some(s => a.path.includes(`/${s.key}-`))).flatMap(a => a.image ? [a.image] : []) }],
    });
    await db.update(schema.taskRuns).set({ metadata: { ...run.metadata, ai_review: { ...result.data, generation_run_id: result.generationRunId } } }).where(eq(schema.taskRuns.id, runId));
    if (!autonomous || !task.contract.verification.required.length || task.reviewPolicy === "HUMAN_REQUIRED" || task.contract.verification.required.some(c => c.type === "manual")) return { task, ai_review: result.data, auto_approve_withheld: "Human decision required" };
    const withheld = autoApproveWithheld(task.contract, ux);
    if (withheld) return { task, ai_review: result.data, auto_approve_withheld: withheld };
    if (!await autoReviewAllowed(db, task.projectId, userId, run.machineId)) return { task, ai_review: result.data, auto_approve_withheld: "Repository auto-approve is no longer enabled" };
    const issues = reviewApprovalIssues(task.contract, result.data, pack.requirements.map(r => r.key));
    const approved = result.data.recommended_decision === "APPROVED" && !issues.length;
    const review = await createReview(db, {
      actor: { type: "SYSTEM", id: "ai-review-policy", source: "SYSTEM" },
      body: { task_id: task.id, run_id: runId, decision: approved ? "APPROVED" : "CHANGES_REQUESTED", summary: result.data.summary,
        findings: approved ? result.data.findings : [...result.data.findings, ...issues.map(message => ({ severity: "BLOCKING" as const, message }))].slice(0, 30).concat(!result.data.findings.length && !issues.length ? [{ severity: "HIGH" as const, message: "Reviewer requested changes; inspect the review summary." }] : []) },
    });
    // At most three attempts: repeated gaps need a person's diagnosis, not an unbounded agent loop.
    if (!approved && run.attempt < 3) return { task: await requeueTask(db, { taskId: task.id, userId, source: "SYSTEM" }), changes_requested: true, ai_review: result.data };
    return { task: review.task, auto_approved: approved, changes_requested: !approved, ai_review: result.data };
  } catch (error) {
    return { task: await getTask(db, task.id), auto_approve_withheld: `AI review unavailable: ${error instanceof Error ? error.message : "unknown error"}` };
  }
}
