import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { DiscoveryResponseSchema, COVERAGE_TOPICS, type CoverageStatus, type DiscoveryReadiness } from "@sdd/contracts";
import { DomainError, errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, DISCOVERY_SYSTEM_PROMPT, DISCOVERY_SELECTION_PROMPT } from "@sdd/ai";
import { getProject } from "../project/service.js";
import { computeReadiness } from "./readiness.js";
import { getActiveSession, transcriptText } from "./session.js";
import { BATCH_SIZE, BUILT_IN_KEY, isUnansweredBuiltIn, type DiscoveryQuestion, type DiscoverySession } from "./topics.js";

/** The next batch of questions: one AI turn, persisted as the PENDING batch — never stray singles. Questions only ever come from the model. */

/* ── Next batch (T040 — batch model) ── */

export interface NextBatchResult {
  questions: DiscoveryQuestion[];
  readiness: DiscoveryReadiness;
  source: "AI" | "COMPLETE" | "BATCH_IN_PROGRESS";
  complete: boolean;
  understanding: string;
  facts: Array<typeof schema.discoveryFacts.$inferSelect>;
  assumptions: Array<typeof schema.discoveryAssumptions.$inferSelect>;
  coverage: Record<string, { status: CoverageStatus; blocking: boolean }>;
  session: DiscoverySession;
}

export async function nextBatch(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; deepen?: boolean },
): Promise<NextBatchResult> {
  const project = await getProject(db, input.projectId);
  const session = await getActiveSession(db, input.projectId);
  if (!session) throw errors.notFound("Discovery session — start one first");

  const state0 = await buildSessionState(db, session);
  const readiness = computeReadiness(state0.session, state0.facts, state0.assumptions, state0.answers);
  if (session.status !== "ACTIVE") {
    // A completed discovery is read-only; it never asks new questions.
    return assemble(session, [], state0.facts, state0.assumptions, readiness, "COMPLETE", true);
  }

  // Unanswered questions from the retired built-in bank are dropped, never asked: the model asks instead.
  await db
    .delete(schema.discoveryQuestions)
    .where(
      and(
        eq(schema.discoveryQuestions.sessionId, session.id),
        eq(schema.discoveryQuestions.status, "PENDING"),
        sql`right(${schema.discoveryQuestions.questionKey}, ${BUILT_IN_KEY.length}) = ${BUILT_IN_KEY}`,
      ),
    );

  // Finish the current batch first — new questions come only when it is done.
  const pending = await db
    .select()
    .from(schema.discoveryQuestions)
    .where(and(eq(schema.discoveryQuestions.sessionId, session.id), eq(schema.discoveryQuestions.status, "PENDING")))
    .orderBy(asc(schema.discoveryQuestions.sequence));
  if (pending.length > 0 && !input.deepen) {
    return assemble(session, pending, state0.facts, state0.assumptions, readiness, "BATCH_IN_PROGRESS", false);
  }

  // Hard cap at 15 answered questions (Capped Discovery): transition to completion
  const answeredCount = state0.answers.filter((a) => a.question.status === "ANSWERED").length;
  if (!input.deepen && answeredCount >= 15) {
    const finalReadiness = readiness === "INCOMPLETE" ? "READY_WITH_ASSUMPTIONS" : readiness;
    await db.update(schema.discoverySessions).set({ readiness: finalReadiness }).where(eq(schema.discoverySessions.id, session.id));
    return assemble(session, [], state0.facts, state0.assumptions, finalReadiness, "COMPLETE", true);
  }

  // Readiness gate: continuing vs deepening is an explicit user choice.
  if (!input.deepen && readiness !== "INCOMPLETE") {
    return assemble(session, [], state0.facts, state0.assumptions, readiness, "COMPLETE", true);
  }

  const transcript = transcriptText(project, state0.answers, state0.facts, state0.assumptions);
  let response: Awaited<ReturnType<typeof generateDiscoveryTurn>>;
  try {
    response = await generateDiscoveryTurn(gateway, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      transcript,
      instruction:
        DISCOVERY_SELECTION_PROMPT +
        nl() +
        nl() +
        `Return the next BATCH of up to ${BATCH_SIZE} distinct high-impact questions, ordered by impact. Adapt to everything already answered; never repeat an answered topic unless resolving a contradiction.`,
    });
  } catch (e) {
    // No canned questions stand in: the person sees why the AI could not ask
    // (no provider, timeout, bad output) and tries again. Nothing is lost —
    // every answer so far is stored, and requirements can be written by hand.
    if (e instanceof DomainError) throw e;
    throw new DomainError(
      "DISCOVERY_AI_UNAVAILABLE",
      "The AI could not write the next questions. Try again, or check your AI provider in Settings.",
      502,
    );
  }

  await applyDiscoveryResponse(db, session, response.data);
  const inserted = await persistBatch(db, session, response.data.questions, state0.answers.length + 1);
  const state = await buildSessionState(db, session);
  const newReadiness = computeReadiness(state.session, state.facts, state.assumptions, state.answers);
  // The model asked nothing new: it has what it needs, so discovery can be finished.
  if (inserted.length === 0) return assemble(session, [], state.facts, state.assumptions, newReadiness, "COMPLETE", true);
  return assemble(session, inserted, state.facts, state.assumptions, newReadiness, "AI", false);
}

function nl(): string {
  return String.fromCharCode(10);
}

function assemble(
  session: DiscoverySession,
  questions: DiscoveryQuestion[],
  facts: Array<typeof schema.discoveryFacts.$inferSelect>,
  assumptions: Array<typeof schema.discoveryAssumptions.$inferSelect>,
  readiness: DiscoveryReadiness,
  source: NextBatchResult["source"],
  complete: boolean,
): NextBatchResult {
  return {
    questions,
    readiness,
    source,
    complete,
    understanding: session.understanding,
    facts,
    assumptions,
    coverage: session.coverage,
    session,
  };
}

export async function buildSessionState(db: DbExecutor, session: DiscoverySession) {
  const [fresh] = await db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, session.id)).limit(1);
  const facts = await db
    .select()
    .from(schema.discoveryFacts)
    .where(and(eq(schema.discoveryFacts.sessionId, session.id), eq(schema.discoveryFacts.status, "ACTIVE")))
    .orderBy(asc(schema.discoveryFacts.createdAt));
  const assumptions = await db
    .select()
    .from(schema.discoveryAssumptions)
    .where(eq(schema.discoveryAssumptions.sessionId, session.id))
    .orderBy(asc(schema.discoveryAssumptions.createdAt));
  const answers = await db
    .select({ question: schema.discoveryQuestions, answer: schema.discoveryAnswers })
    .from(schema.discoveryQuestions)
    .leftJoin(schema.discoveryAnswers, eq(schema.discoveryAnswers.questionId, schema.discoveryQuestions.id))
    .where(eq(schema.discoveryQuestions.sessionId, session.id))
    .orderBy(asc(schema.discoveryQuestions.sequence));
  // Unanswered questions from the retired built-in bank neither block readiness nor count as asked.
  return { session: fresh!, facts, assumptions, answers: answers.filter((a) => !isUnansweredBuiltIn(a.question)) };
}

async function generateDiscoveryTurn(
  gateway: GatewayDeps,
  input: { workspaceId: string; projectId: string; transcript: string; instruction: string },
) {
  return runStructured(
    {
      db: gateway.db,
      secretBox: gateway.secretBox,
      allowPrivateEgress: gateway.allowPrivateEgress,
      maxResponseBytes: gateway.maxResponseBytes,
      logger: gateway.logger,
    },
    {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      role: "DISCOVERY",
      schema: DiscoveryResponseSchema,
      schemaName: "DiscoveryResponse",
      system: `${DISCOVERY_SYSTEM_PROMPT}${nl()}${nl()}${input.instruction}${nl()}${nl()}Output discipline: reply with ONLY the JSON object. Keep string values concise; no reasoning narration in the output.`,
      maxTokens: 6000,
      messages: [{ role: "user", content: input.transcript }],
    },
  );
}

async function persistBatch(
  db: DbExecutor,
  session: DiscoverySession,
  questions: Array<{
    key: string;
    topic: string;
    question: string;
    reason: string;
    answer_type: string;
    options?: string[];
    impact: string;
    blocking: boolean;
  }>,
  startSequence: number,
): Promise<DiscoveryQuestion[]> {
  const inserted: DiscoveryQuestion[] = [];
  let sequence = startSequence;
  for (const q of questions) {
    const [row] = await db
      .insert(schema.discoveryQuestions)
      .values({
        sessionId: session.id,
        questionKey: q.key,
        topic: q.topic,
        questionText: q.question,
        reason: q.reason ?? "",
        answerType: (q.answer_type ?? "TEXT").toUpperCase() as DiscoveryQuestion["answerType"],
        options: q.options ?? [],
        impact: (q.impact ?? "high") as DiscoveryQuestion["impact"],
        blocking: q.blocking ?? false,
        sequence: sequence++,
      })
      // A key that was already asked (ANSWERED/SKIPPED) must stay as it is: the
      // old upsert flipped answered questions back to PENDING and re-asked them.
      .onConflictDoNothing({ target: [schema.discoveryQuestions.sessionId, schema.discoveryQuestions.questionKey] })
      .returning();
    if (row) inserted.push(row);
  }
  return inserted;
}

async function applyDiscoveryResponse(
  db: DbExecutor,
  session: DiscoverySession,
  data: import("@sdd/contracts").DiscoveryResponse,
): Promise<void> {
  // Model QUESTIONS are persisted by persistBatch (exactly one batch per turn).
  for (const fact of data.facts) {
    // `<topic>_user` keys belong to the user (FR-014): the model may not write them.
    if (fact.key.endsWith("_user")) continue;
    await db
      .insert(schema.discoveryFacts)
      .values({
        sessionId: session.id,
        factKey: fact.key,
        value: fact.value,
        sourceType: "DERIVED",
        confidence: fact.confidence === "USER_STATED" ? "HIGH" : "MEDIUM",
        status: "ACTIVE",
      })
      .onConflictDoUpdate({
        target: [schema.discoveryFacts.sessionId, schema.discoveryFacts.factKey],
        set: { value: fact.value, status: "ACTIVE" },
        // Never overwrite a USER_STATED value with a model-derived one.
        setWhere: sql`${schema.discoveryFacts.sourceType} <> 'USER_STATED'`,
      });
  }
  for (const assumption of data.assumptions) {
    const existing = await db
      .select({ id: schema.discoveryAssumptions.id })
      .from(schema.discoveryAssumptions)
      .where(and(eq(schema.discoveryAssumptions.sessionId, session.id), eq(schema.discoveryAssumptions.description, assumption.description)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.discoveryAssumptions).values({
        sessionId: session.id,
        description: assumption.description,
        impact: assumption.impact,
      });
    }
  }
  for (const contradiction of data.contradictions) {
    await db.insert(schema.discoveryContradictions).values({
      sessionId: session.id,
      description: contradiction.description,
      relatedKeys: contradiction.related_keys,
    });
  }
  const coverage = { ...session.coverage, ...data.coverage };
  await db
    .update(schema.discoverySessions)
    .set({ coverage, understanding: data.understanding || session.understanding })
    .where(eq(schema.discoverySessions.id, session.id));
}
