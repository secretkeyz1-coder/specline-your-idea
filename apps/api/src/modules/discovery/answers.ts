import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CoverageStatus, AnswerQuestionInput } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { publish, topics } from "../../events/bus.js";
import { computeReadiness } from "./readiness.js";
import { assertSessionActive } from "./session.js";

/** Answering a question and what it covers. */

/* ── Answers (T041) ── */

export async function answerQuestion(
  db: DbExecutor,
  input: { questionId: string; userId: string; body: AnswerQuestionInput },
) {
  const [question] = await db.select().from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.id, input.questionId)).limit(1);
  if (!question) throw errors.notFound("Discovery question", input.questionId);
  const [session] = await db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, question.sessionId)).limit(1);
  if (!session) throw errors.notFound("Discovery session");
  assertSessionActive(session);

  // One final answer per question: retries replace, never append. Row lock +
  // transaction so two concurrent submits cannot leave two answers behind.
  await db.transaction(async (tx) => {
    await tx.select({ id: schema.discoveryQuestions.id }).from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.id, question.id)).for("update");
    await tx.delete(schema.discoveryAnswers).where(eq(schema.discoveryAnswers.questionId, question.id));
    await tx.insert(schema.discoveryAnswers).values({
      questionId: question.id,
      answeredBy: input.userId,
      answer: { text: input.body.answer, selected_options: input.body.selected_options },
    });
    await tx.update(schema.discoveryQuestions).set({ status: "ANSWERED" }).where(eq(schema.discoveryQuestions.id, question.id));
  });

  // User-stated fact per topic (FR-013/FR-014) — separate from AI assumptions.
  const factKey = `${question.topic}_user`;
  await db
    .insert(schema.discoveryFacts)
    .values({
      sessionId: session.id,
      factKey,
      value: input.body.answer,
      sourceType: "USER_STATED",
      sourceRef: question.id,
      confidence: "HIGH",
      status: "ACTIVE",
    })
    .onConflictDoUpdate({
      target: [schema.discoveryFacts.sessionId, schema.discoveryFacts.factKey],
      set: { value: input.body.answer, status: "ACTIVE" },
    });

  // Deterministic coverage update: an answered topic is at least PARTIAL.
  const coverage = { ...session.coverage };
  const current = coverage[question.topic] ?? { status: "UNKNOWN" as CoverageStatus, blocking: false };
  coverage[question.topic] = { status: current.status === "KNOWN" ? "KNOWN" : "PARTIAL", blocking: current.blocking };
  await db.update(schema.discoverySessions).set({ coverage }).where(eq(schema.discoverySessions.id, session.id));

  publish({
    topic: topics.project(session.projectId),
    type: "discovery_answered",
    payload: { question_id: question.id, topic: question.topic, project_id: session.projectId },
  });

  const [updatedSession] = await db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, session.id)).limit(1);
  const freshFacts = await db
    .select()
    .from(schema.discoveryFacts)
    .where(and(eq(schema.discoveryFacts.sessionId, session.id), eq(schema.discoveryFacts.status, "ACTIVE")));
  const freshAssumptions = await db.select().from(schema.discoveryAssumptions).where(eq(schema.discoveryAssumptions.sessionId, session.id));
  const allQuestions = await db.select().from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.sessionId, session.id));
  const readiness = computeReadiness(
    updatedSession!,
    freshFacts,
    freshAssumptions,
    allQuestions.map((q) => ({ question: q, answer: null })),
  );
  return { session: updatedSession!, facts: freshFacts, assumptions: freshAssumptions, readiness };
}
