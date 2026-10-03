import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CoverageStatus } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";
import { getProject, updateLifecycle } from "../project/service.js";
import { publish, topics } from "../../events/bus.js";
import { buildSessionState } from "./batch.js";
import { acceptAssumptions, computeReadiness, uncoveredRequiredTopics, uncoveredTopicAssumption } from "./readiness.js";
import { assertSessionActive } from "./session.js";

/** Deferring a question and completing discovery. */

/**
 * Defer a question the user cannot answer (docs/14 §5 — "I don't know —
 * recommend" / "Skip / use assumption").
 *
 * Sending a literal "I don't know" through `answerQuestion` would record it as
 * a USER_STATED *fact* for the topic, which is wrong: the engine would then
 * treat the topic as known and stop asking, while the real information is still
 * missing. Instead the question becomes SKIPPED, the topic stays uncovered, and
 * the open point is recorded as an explicit PROPOSED assumption — which is what
 * the readiness gate and the "accept assumptions" step are designed to handle.
 */
export async function deferQuestion(
  db: DbExecutor,
  input: { questionId: string; userId: string; recommendation?: string | null },
) {
  const [question] = await db.select().from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.id, input.questionId)).limit(1);
  if (!question) throw errors.notFound("Discovery question", input.questionId);
  const [session] = await db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, question.sessionId)).limit(1);
  if (!session) throw errors.notFound("Discovery session");
  assertSessionActive(session);

  // Record the engine's recommended default as an explicit, acceptable assumption.
  const description = input.recommendation?.trim()
    ? `${question.topic.replaceAll("_", " ")}: not specified by the user — recommended default: ${input.recommendation.trim()}`
    : `${question.topic.replaceAll("_", " ")}: deferred by the user — no answer yet, treat as an open assumption.`;

  const existing = await db
    .select({ id: schema.discoveryAssumptions.id })
    .from(schema.discoveryAssumptions)
    .where(and(eq(schema.discoveryAssumptions.sessionId, session.id), eq(schema.discoveryAssumptions.description, description)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(schema.discoveryAssumptions).values({
      sessionId: session.id,
      description,
      impact: question.impact === "high" ? "high" : "medium",
    });
  }

  await db.update(schema.discoveryQuestions).set({ status: "SKIPPED" }).where(eq(schema.discoveryQuestions.id, question.id));

  // Coverage stays explicitly unknown for this topic (do NOT mark it PARTIAL —
  // nothing was actually learned), but the blocking flag is cleared because the
  // user has consciously deferred rather than left the gate unsatisfied.
  const coverage = { ...session.coverage };
  const current = coverage[question.topic] ?? { status: "UNKNOWN" as CoverageStatus, blocking: false };
  coverage[question.topic] = { status: current.status, blocking: false };
  await db.update(schema.discoverySessions).set({ coverage }).where(eq(schema.discoverySessions.id, session.id));

  publish({
    topic: topics.project(session.projectId),
    type: "discovery_deferred",
    payload: { question_id: question.id, topic: question.topic, project_id: session.projectId },
  });

  const [updatedSession] = await db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, session.id)).limit(1);
  const facts = await db
    .select()
    .from(schema.discoveryFacts)
    .where(and(eq(schema.discoveryFacts.sessionId, session.id), eq(schema.discoveryFacts.status, "ACTIVE")));
  const assumptions = await db.select().from(schema.discoveryAssumptions).where(eq(schema.discoveryAssumptions.sessionId, session.id));
  const allQuestions = await db.select().from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.sessionId, session.id));
  const readiness = computeReadiness(
    updatedSession!,
    facts,
    assumptions,
    allQuestions.map((q) => ({ question: q, answer: null })),
  );
  return { session: updatedSession!, facts, assumptions, readiness, assumption: description };
}

/** Mark discovery complete (readiness READY or accepted assumptions). */
export async function completeDiscovery(
  db: DbExecutor,
  input: { sessionId: string; userId: string; acceptAssumptions?: boolean; source?: AuditSource },
) {
  const result = await db.transaction(async (tx) => {
    // Session row lock: a concurrent answer/complete cannot interleave with
    // the readiness check and the status flip below.
    const session = (await tx.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, input.sessionId)).for("update").limit(1))[0];
    if (!session) throw errors.notFound("Discovery session", input.sessionId);
    if (session.status === "COMPLETED") return { session, completed: false }; // idempotent
    if (session.status !== "ACTIVE") throw errors.conflict("DISCOVERY_CLOSED", "This discovery session is no longer active");
    // Readiness is computed from the live state, not the cached column.
    const state = await buildSessionState(tx, session);
    const readiness = computeReadiness(state.session, state.facts, state.assumptions, state.answers);
    const openTopics: string[] = [];
    if (readiness === "INCOMPLETE") {
      // C7: an incomplete discovery may only continue when the user EXPLICITLY
      // chooses to proceed on documented assumptions — never implicitly.
      if (!input.acceptAssumptions) {
        const blocking = state.answers.filter((a) => a.question.blocking && a.question.status === "PENDING").map((a) => a.question.questionText);
        throw errors.conflict(
          "DISCOVERY_INCOMPLETE",
          "Discovery is incomplete — answer the blocking questions, or explicitly continue with assumptions",
          { pending_blocking_questions: blocking },
        );
      }
      // Every required topic still open (and every blocking question left
      // unanswered) becomes an explicit assumption before the proposed ones
      // are accepted: with zero PROPOSED assumptions the requirements gate
      // used to stay shut forever, and the record would not say what was assumed.
      const skippedBlocking = state.answers
        .filter((a) => a.question.blocking && a.question.status === "PENDING")
        .map((a) => a.question.topic)
        .filter((topic) => state.session.coverage[topic]?.status !== "KNOWN");
      const blockingCoverage = Object.entries(state.session.coverage).filter(([, topic]) => topic.blocking && topic.status !== "KNOWN").map(([topic]) => topic);
      for (const topic of new Set([...uncoveredRequiredTopics(state.session.coverage, state.facts), ...skippedBlocking, ...blockingCoverage])) {
        const description = uncoveredTopicAssumption(topic);
        if (state.assumptions.some((a) => a.description === description)) continue;
        await tx.insert(schema.discoveryAssumptions).values({ sessionId: session.id, description, impact: "high" });
        openTopics.push(topic);
      }
    }
    if (input.acceptAssumptions) await acceptAssumptions(tx, { sessionId: session.id, userId: input.userId, source: input.source });
    // Completing discards the leftover batch: it was never answered.
    await tx
      .update(schema.discoveryQuestions)
      .set({ status: "SKIPPED" })
      .where(and(eq(schema.discoveryQuestions.sessionId, session.id), eq(schema.discoveryQuestions.status, "PENDING")));
    await tx
      .update(schema.discoverySessions)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(schema.discoverySessions.id, session.id));
    await updateLifecycle(tx, session.projectId, "DISCOVERY_READY");
    await audit(tx, {
      workspaceId: (await getProject(tx, session.projectId)).workspaceId,
      projectId: session.projectId,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: "discovery.completed",
      entityType: "DISCOVERY_SESSION",
      entityId: session.id,
      metadata: { readiness, accepted_assumptions: Boolean(input.acceptAssumptions), open_topics: openTopics, proposed_assumptions: input.acceptAssumptions ? [] : state.assumptions.filter(a => a.status === "PROPOSED").map(a => a.description) },
    });
    const [updated] = await tx.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, session.id)).limit(1);
    return { session: updated!, completed: true };
  });
  if (result.completed) {
    publish({ topic: topics.project(result.session.projectId), type: "discovery_completed", payload: { project_id: result.session.projectId } });
  }
  return result.session;
}
