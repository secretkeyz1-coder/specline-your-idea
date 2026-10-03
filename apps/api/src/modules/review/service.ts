import type { AuditSource } from "../audit/service.js";
import { and, desc, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CreateReviewInput } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { getTask, updateTaskFields } from "../task/repo.js";
import { transitionTask, appendTaskEvent, retireOpenRuns, type ActorInput } from "../execution/service.js";
import { getProject } from "../project/service.js";
import { audit } from "../audit/service.js";
import { notifyWorkspaceMembers } from "../notification/service.js";
import { publish, topics } from "../../events/bus.js";

/**
 * Review (Phase 14, T147–T151, FR-120..124, C15).
 * Any workspace user may approve, the implementer included (owner decision,
 * 2026-10-01: no reviewer roles). Agents never approve; auto-approval is a
 * policy decision taken by the server for narrowly-classified low-risk work.
 */

export async function listReviewsForTask(db: DbExecutor, taskId: string) {
  return db.select().from(schema.reviews).where(eq(schema.reviews.taskId, taskId)).orderBy(desc(schema.reviews.createdAt));
}

export async function createReview(
  db: DbExecutor,
  input: { body: CreateReviewInput; actor: ActorInput },
) {
  const task0 = await getTask(db, input.body.task_id);
  const project = await getProject(db, task0.projectId);
  const isAutoPolicy = input.actor.type === "SYSTEM";

  if (input.body.decision === "CHANGES_REQUESTED" && input.body.findings.length === 0) {
    throw errors.validation("Findings are required when requesting changes (FR-122)");
  }
  if (task0.reviewPolicy === "HUMAN_REQUIRED" && input.actor.type !== "USER") {
    throw errors.forbidden("This task requires HUMAN review (high-risk classification)");
  }
  if ((input.body.decision === "APPROVED" || input.body.decision === "WAIVED") && input.actor.type !== "USER" && !isAutoPolicy) {
    // Reviewer must be a user actor unless a policy automation decides.
    throw errors.forbidden("Only reviewers or review policy automation can approve");
  }

  // Decision + transition happen under the task row lock, so two concurrent
  // reviews (e.g. APPROVED vs CHANGES_REQUESTED) cannot both be recorded.
  const decided = await db.transaction(async (tx) => {
    const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, task0.id)).for("update").limit(1);
    if (!task) throw errors.notFound("Task", task0.id);
    if (task.workflowStatus !== "NEEDS_REVIEW") {
      throw errors.conflict("TASK_NOT_IN_REVIEW", `Reviews require NEEDS_REVIEW state (current: ${task.workflowStatus})`);
    }
    // The SERVER resolves the run under review: always the latest SUBMITTED
    // attempt. A caller-chosen older run (e.g. someone else's earlier attempt)
    // must not be usable to side-step the self-approval guard (docs/12 §4, C15).
    const [reviewRun] = await tx
      .select()
      .from(schema.taskRuns)
      .where(and(eq(schema.taskRuns.taskId, task.id), eq(schema.taskRuns.status, "SUBMITTED")))
      .orderBy(desc(schema.taskRuns.attempt))
      .limit(1);
    if (input.body.run_id && reviewRun && input.body.run_id !== reviewRun.id) {
      throw errors.conflict("RUN_NOT_UNDER_REVIEW", "Only the latest submitted run can be reviewed", { run_under_review: reviewRun.id });
    }
    // Any workspace user may approve, including the person whose agent ran the
    // task (owner decision: no reviewer roles). Approval still has to come from
    // a user or the review policy — an agent token can't approve (checked above).
    const [review] = await tx
      .insert(schema.reviews)
      .values({
        taskId: task.id,
        runId: reviewRun?.id ?? null,
        reviewerType: input.actor.type === "USER" ? "USER" : isAutoPolicy ? "SYSTEM" : "AI",
        reviewerId: input.actor.id,
        decision: input.body.decision,
        findings: input.body.findings,
        summary: input.body.summary,
      })
      .returning();
    const approving = input.body.decision === "APPROVED" || input.body.decision === "WAIVED";
    const updated = await transitionTask(tx, {
      taskId: task.id,
      action: approving ? "approve" : "request_changes",
      actor: input.actor,
      reason:
        input.body.decision === "WAIVED"
          ? `waived: ${input.body.summary}`
          : input.body.decision === "CHANGES_REQUESTED"
            ? input.body.findings.map((f) => f.message).join("; ")
            : input.body.decision === "REJECTED"
              ? "rejected"
              : input.body.summary,
      runId: reviewRun?.id ?? null,
    });
    // Whatever the decision, the reviewed attempt is over: close it (and any
    // other stale run/lease) so it can never be re-reviewed later.
    await retireOpenRuns(tx, task.id, "FAILED");
    return { review: review!, updated, reviewRun: reviewRun ?? null };
  });
  const task = task0;
  const review = decided.review;
  const runId = decided.reviewRun?.id ?? null;

  const eventType =
    input.body.decision === "APPROVED" ? "review_approved" : input.body.decision === "CHANGES_REQUESTED" ? "changes_requested" : "review_approved";

  if (input.body.decision === "APPROVED") {
    const updated = decided.updated;
    await updateTaskFields(db, task.id, { executionResult: "PASS", attentionStatus: "NONE" });
    await appendTaskEvent(db, {
      taskId: task.id,
      runId,
      eventType: "task_completed",
      actor: input.actor,
      payload: { review_id: review!.id },
    });
    await audit(db, {
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      source: input.actor.source,
      action: "review.approved",
      entityType: "TASK",
      entityId: task.id,
      metadata: { review_id: review!.id },
    });
    return { review: review!, task: updated };
  }

  if (input.body.decision === "CHANGES_REQUESTED") {
    const updated = decided.updated;
    await updateTaskFields(db, task.id, { executionResult: "FAIL" });
    await appendTaskEvent(db, {
      taskId: task.id,
      runId,
      eventType,
      actor: input.actor,
      payload: { review_id: review!.id, findings: input.body.findings },
    });
    await audit(db, {
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      source: input.actor.source,
      action: "review.changes_requested",
      entityType: "TASK",
      entityId: task.id,
      metadata: { review_id: review!.id, findings: input.body.findings.length },
    });
    await notifyWorkspaceMembers(db, {
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      type: "changes_requested",
      title: `${task.key}: changes requested`,
      body: input.body.findings.map((f) => `[${f.severity}] ${f.message}`).join("\n").slice(0, 400),
      entityType: "TASK",
      entityId: task.id,
      dedupeKey: `changes:${review!.id}`,
    });
    return { review: review!, task: updated };
  }

  // REJECTED / WAIVED are recorded; WAIVED is admin-only (enforced by the route).
  if (input.body.decision === "WAIVED") {
    const updated = decided.updated;
    await updateTaskFields(db, task.id, { executionResult: "PASS", attentionStatus: "NONE" });
    await appendTaskEvent(db, { taskId: task.id, runId, eventType: "review_approved", actor: input.actor, payload: { review_id: review!.id, waived: true } });
    await audit(db, {
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      source: input.actor.source,
      action: "review.waived",
      entityType: "TASK",
      entityId: task.id,
    });
    return { review: review!, task: updated };
  }

  await updateTaskFields(db, task.id, { executionResult: "FAIL" });
  return { review: review!, task: decided.updated };
}

/** Requeue after changes requested: a new run attempt may begin (T151, FR-057). */
export async function requeueTask(db: DbExecutor, input: { taskId: string; userId: string; source?: AuditSource }) {
  const task = await getTask(db, input.taskId);
  const project = await getProject(db, task.projectId);
  // READY and the retirement of the previous attempt commit together, under
  // the task row lock: before, a claim landing between the two writes had its
  // brand-new run and lease retired, stranding the task in CLAIMED.
  // The event and audit rows carry the caller's real source and commit with it.
  const source = input.source ?? "WEB";
  const updated = await db.transaction(async (tx) => {
    await transitionTask(tx, {
      taskId: task.id,
      action: "requeue",
      actor: { type: "USER", id: input.userId, source },
      reason: "requeued for a new execution attempt",
    });
    // The previous attempt is over: close its runs (RUNNING/SUBMITTED would
    // otherwise stay open forever) and release any lease.
    await retireOpenRuns(tx, task.id, "FAILED");
    const fields = await updateTaskFields(tx, task.id, { executionResult: "NONE", attentionStatus: "NONE" });
    await appendTaskEvent(tx, {
      taskId: task.id,
      eventType: "task_reopened",
      actor: { type: "USER", id: input.userId, source },
      payload: { requeued: true },
    });
    await audit(tx, {
      workspaceId: project.workspaceId,
      projectId: task.projectId,
      actorType: "USER",
      actorId: input.userId,
      source,
      action: "task.reopened",
      entityType: "TASK",
      entityId: task.id,
    });
    return fields;
  });
  publish({ topic: topics.project(task.projectId), type: "task_transitioned", payload: { task_id: task.id, to: "READY" } });
  return updated;
}
