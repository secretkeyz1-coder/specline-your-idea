import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { resolveTransition, type WorkflowStatus } from "@sdd/contracts";
import { SubmitRunSchema, type RunEvidence, type SubmitRunInput } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { type TaskRow } from "../task/repo.js";
import { getProject } from "../project/service.js";
import { audit, type AuditSource } from "../audit/service.js";
import { notifyWorkspaceMembers } from "../notification/service.js";
import { assertDependenciesSatisfied, leaseExpired } from "./claim.js";
import { appendTaskEvent, transitionTask, type ActorInput } from "./events.js";
import { requireActiveLease, requireRunForTask, transitionRun } from "./runs.js";
import { createHash } from "node:crypto";

/** Submitting a run for review: the evidence policy (every required check reported, latest PASSED), and manual runs. */

const normalizeCommand = (command: string) => command.trim().replace(/\s+/g, " ");

/**
 * Evidence policy (C2): EVERY required verification command must have been
 * reported for this run, and its most recent result must be PASSED. A single
 * unrelated passing row (e.g. `echo ok`) is not evidence for the contract.
 */
export async function verifyEvidencePolicy(db: DbExecutor, runId: string, task: TaskRow, submission?: SubmitRunInput): Promise<void> {
  if (submission) {
    const kinds = task.contract.verification?.evidence ?? [];
    if (submission.exit_code != null && submission.exit_code !== 0) throw errors.conflict("EVIDENCE_NOT_PASSING", "Implementation exited unsuccessfully");
    if (kinds.includes("commit") && !submission.commit_sha) throw errors.conflict("EVIDENCE_MISSING", "Required commit evidence is missing");
    if (kinds.includes("diff") && !submission.evidence?.diff.trim()) throw errors.conflict("EVIDENCE_MISSING", "Required diff evidence is missing");
    if (kinds.includes("manual_note") && !submission.summary.trim()) throw errors.conflict("EVIDENCE_MISSING", "Required manual note is missing");
  }
  const required = task.contract.verification?.required ?? [];
  if (required.length === 0) return;
  const reported = await db
    .select()
    .from(schema.testResults)
    .where(eq(schema.testResults.runId, runId))
    .orderBy(asc(schema.testResults.createdAt));
  if (reported.length === 0) {
    throw errors.conflict(
      "EVIDENCE_MISSING",
      "Required verification evidence is missing — report test results before requesting review (C2)",
      { required_commands: required.map((r) => r.command) },
    );
  }
  const latestByCommand = new Map<string, (typeof reported)[number]>();
  for (const row of reported) latestByCommand.set(normalizeCommand(row.command), row); // ascending → last wins
  const missing: string[] = [];
  const failing: Array<{ command: string; status: string }> = [];
  for (const item of required) {
    const latest = latestByCommand.get(normalizeCommand(item.command));
    if (!latest) missing.push(item.command);
    else if (latest.status !== "PASSED" || (item.type !== "manual" && latest.exitCode !== 0)) failing.push({ command: item.command, status: `${latest.status} (exit ${latest.exitCode ?? "unknown"})` });
  }
  if (missing.length > 0) {
    throw errors.conflict("EVIDENCE_MISSING", `No result reported for required verification: ${missing.join(", ")}`, {
      required_commands: required.map((r) => r.command),
      missing,
    });
  }
  // A FAILED/ERROR/SKIPPED latest row is not evidence of success (C2).
  if (failing.length > 0) {
    throw errors.conflict("EVIDENCE_NOT_PASSING", "Required verification commands must pass before review", {
      required_commands: required.map((r) => r.command),
      failing,
    });
  }
}

function parseEvidenceSubmission(value: SubmitRunInput) {
  const body = SubmitRunSchema.parse(value);
  for (const artifact of body.evidence?.artifacts ?? []) if (artifact.image) {
    const bytes = Buffer.from(artifact.image.split(",")[1]!, "base64");
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw errors.validation("Screenshot content does not match its PNG signature or hash");
  }
  return body;
}

export async function submitRunForReview(
  db: DbExecutor,
  input: { runId: string; body: SubmitRunInput; actor: ActorInput; deferReviewNotification?: boolean },
) {
  input.body = parseEvidenceSubmission(input.body);
  const { run, task } = await requireRunForTask(db, input.runId);
  if (["SUBMITTED", "FINISHED"].includes(run.status)) {
    if (JSON.stringify(run.filesChanged) !== JSON.stringify(input.body.files_changed) || run.exitCode !== (input.body.exit_code ?? null) || run.summary !== input.body.summary || run.commitSha !== (input.body.commit_sha ?? null) || JSON.stringify(run.metadata?.evidence ?? null) !== JSON.stringify(input.body.evidence ?? null)) throw errors.conflict("SUBMISSION_MISMATCH", "A submitted run cannot be replaced with different evidence");
    return { task };
  }
  // One transaction under the lease row lock: a failure between the task
  // transition and the run/lease writes used to leave NEEDS_REVIEW with a
  // RUNNING run and a live lease.
  const updatedTask = await db.transaction(async (tx) => {
    // Lock order task → lease, same as cancel/review, so they cannot deadlock.
    const [current] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).for("update").limit(1);
    await requireActiveLease(tx, run.id, input.actor.id, true);
    await verifyEvidencePolicy(tx, run.id, task, input.body);
    // submit is only legal from VALIDATING — walk the legal path when the
    // executor submits straight from IN_PROGRESS.
    if (current?.workflowStatus === "IN_PROGRESS") {
      await transitionTask(tx, { taskId: task.id, action: "begin_validation", actor: input.actor, runId: run.id });
      await transitionRun(tx, run.id, "VALIDATING");
    }
    const next = await transitionTask(tx, {
      taskId: task.id,
      action: "submit",
      actor: input.actor,
      reason: "implementation and required verification complete",
      runId: run.id,
    });
    await tx
      .update(schema.taskRuns)
      .set({
        status: "SUBMITTED",
        endedAt: new Date(),
        exitCode: input.body.exit_code ?? null,
        summary: input.body.summary,
        commitSha: input.body.commit_sha ?? null,
        filesChanged: input.body.files_changed ?? [],
        metadata: { ...run.metadata, evidence: input.body.evidence ?? null },
      })
      .where(eq(schema.taskRuns.id, run.id));
    // Release the lease: ownership returns to the server pending review.
    await tx
      .update(schema.taskLeases)
      .set({ status: "RELEASED", releasedAt: new Date() })
      .where(and(eq(schema.taskLeases.runId, run.id), eq(schema.taskLeases.status, "ACTIVE")));
    return next;
  });
  await appendTaskEvent(db, {
    taskId: task.id,
    runId: run.id,
    eventType: "review_requested",
    actor: input.actor,
    payload: { summary: input.body.summary, commit_sha: input.body.commit_sha ?? null, files_changed: input.body.files_changed ?? [] },
  });
  await audit(db, {
    workspaceId: (await getProject(db, task.projectId)).workspaceId,
    projectId: task.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    source: input.actor.source,
    action: "run.submitted",
    entityType: "RUN",
    entityId: run.id,
  });
  if (!input.deferReviewNotification) await notifyPendingReview(db, updatedTask, run.id, input.body.summary);
  return { task: updatedTask };
}

export async function notifyPendingReview(db: DbExecutor, task: TaskRow, runId: string, summary: string) {
  if (task.workflowStatus !== "NEEDS_REVIEW") return;
  const project = await getProject(db, task.projectId);
  await notifyWorkspaceMembers(db, {
    workspaceId: project.workspaceId,
    projectId: task.projectId,
    type: "review_requested",
    title: `${task.key} needs review`,
    body: summary.slice(0, 200),
    entityType: "TASK",
    entityId: task.id,
    dedupeKey: `review:${runId}`,
  });
}

/** Manual fallback (C17): record an externally-executed run with pasted evidence. */
export async function recordManualRun(
  db: DbExecutor,
  input: {
    taskId: string;
    userId: string;
    source?: AuditSource;
    summary: string;
    commitSha?: string | null;
    filesChanged?: string[];
    exitCode?: number | null;
    evidence?: RunEvidence;
    testResults?: Array<{ command: string; status: "PASSED" | "FAILED" | "ERROR" | "SKIPPED"; exit_code?: number | null; summary?: string | null }>;
  },
) {
  const submission = parseEvidenceSubmission({ summary: input.summary, commit_sha: input.commitSha, files_changed: input.filesChanged ?? [], exit_code: input.exitCode, evidence: input.evidence });
  const manualActor: ActorInput = { type: "USER", id: input.userId, source: input.source ?? "WEB" };
  // Everything commits or nothing does: a rejected manual run must not leave a
  // SUBMITTED run row behind (which the review guard would later pick up).
  const result = await db.transaction(async (tx) => {
    const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId)).for("update").limit(1);
    if (!task) throw errors.notFound("Task", input.taskId);
    if (task.workflowStatus === "BLOCKED") {
      throw errors.conflict("TASK_BLOCKED", "Unblock the task before recording a manual run");
    }
    if (!["READY", "CHANGES_REQUESTED"].includes(task.workflowStatus)) {
      throw errors.conflict("TASK_NOT_READY", `Manual runs can be recorded for READY/CHANGES_REQUESTED tasks (current: ${task.workflowStatus})`);
    }
    // Same guards as an executor claim: dependency order and no live lease.
    await assertDependenciesSatisfied(tx, task);
    const [activeLease] = await tx
      .select()
      .from(schema.taskLeases)
      .where(and(eq(schema.taskLeases.taskId, task.id), eq(schema.taskLeases.status, "ACTIVE")))
      .limit(1);
    if (activeLease && !leaseExpired(activeLease)) throw errors.taskAlreadyClaimed(task.key);

    // Attempt number is computed under the task row lock (no concurrent claim).
    const [{ attempt }] = await tx
      .select({ attempt: sql<number>`coalesce(max(${schema.taskRuns.attempt}), 0)` })
      .from(schema.taskRuns)
      .where(eq(schema.taskRuns.taskId, task.id));
    const [run] = await tx
      .insert(schema.taskRuns)
      .values({
        taskId: task.id,
        attempt: (attempt ?? 0) + 1,
        executorType: "MANUAL",
        executorId: input.userId,
        status: "SUBMITTED",
        startedAt: new Date(),
        endedAt: new Date(),
        exitCode: input.exitCode ?? null,
        summary: input.summary,
        commitSha: input.commitSha ?? null,
        filesChanged: input.filesChanged ?? [],
        metadata: { evidence: submission.evidence ?? null },
      })
      .returning();
    for (const test of input.testResults ?? []) {
      await tx.insert(schema.testResults).values({
        runId: run!.id,
        command: test.command,
        status: test.status,
        exitCode: test.exit_code ?? null,
        summary: test.summary ?? null,
      });
    }
    // Same evidence policy as executor submissions (C2).
    await verifyEvidencePolicy(tx, run!.id, task as TaskRow, submission);
    // Walk the legal path explicitly so the task lands on NEEDS_REVIEW exactly
    // like submitRunForReview: CHANGES_REQUESTED requeues first, then
    // claim → start → begin_validation → submit. Illegal transitions propagate.
    let current = task as TaskRow;
    for (const action of ["requeue", "claim", "start", "begin_validation", "submit"] as const) {
      if (resolveTransition(current.workflowStatus as WorkflowStatus, action)) {
        current = await transitionTask(tx, { taskId: task.id, action, actor: manualActor, runId: run!.id });
      }
    }
    if (current.workflowStatus !== "NEEDS_REVIEW") {
      throw errors.invalidTransition(current.workflowStatus, "submit");
    }
    return { task: current, run: run! };
  });
  await appendTaskEvent(db, {
    taskId: result.task.id,
    runId: result.run.id,
    eventType: "review_requested",
    actor: manualActor,
    payload: { manual: true, summary: input.summary },
  });
  return result;
}
