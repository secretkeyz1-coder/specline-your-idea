import { and, asc, desc, eq, ne } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { COVERAGE_TOPICS, type CoverageStatus } from "@sdd/contracts";
import { errors, isUniqueViolation } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";
import { updateLifecycle } from "../project/service.js";
import { BLOCKING_TOPICS, type DiscoveryQuestion, type DiscoverySession } from "./topics.js";

/** The discovery session: start (one ACTIVE per project), the active session, and the transcript the model and the UI read. */

/* ── Session lifecycle (T039) ── */

export async function startDiscovery(
  db: DbExecutor,
  input: { projectId: string; userId: string; source?: AuditSource },
): Promise<DiscoverySession> {
  return startDiscoveryLocked(db, input).catch((error: unknown) => {
    // The partial unique index is the backstop behind the row lock below.
    if (isUniqueViolation(error, "discovery_sessions_one_active")) {
      throw errors.conflict("DISCOVERY_ALREADY_ACTIVE", "Discovery is already running for this project — reload the page");
    }
    throw error;
  });
}

function startDiscoveryLocked(
  db: DbExecutor,
  input: { projectId: string; userId: string; source?: AuditSource },
): Promise<DiscoverySession> {
  return db.transaction(async (tx) => {
    // Project row lock serializes concurrent starts (two tabs, the create form
    // plus the discovery page): without it both saw "no session" and each
    // inserted an ACTIVE one, splitting the answers across two sessions.
    const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).for("update").limit(1);
    if (!project) throw errors.notFound("Project", input.projectId);
    // Reuse the latest ACTIVE *or COMPLETED* session: creating a fresh empty
    // session after completion made getActiveSession() return the empty one and
    // hid every earlier answer. Only an ABANDONED session is replaced.
    const existing = await getActiveSession(tx, input.projectId);
    if (existing) return existing;

    const coverage: Record<string, { status: CoverageStatus; blocking: boolean }> = {};
    for (const topic of COVERAGE_TOPICS) {
      coverage[topic] = { status: "UNKNOWN", blocking: BLOCKING_TOPICS.includes(topic as never) };
    }
    const [session] = await tx
      .insert(schema.discoverySessions)
      .values({
        projectId: input.projectId,
        startedBy: input.userId,
        status: "ACTIVE",
        readiness: "INCOMPLETE",
        coverage,
      })
      .returning();
    await updateLifecycle(tx, input.projectId, "DISCOVERY_ACTIVE");
    await audit(tx, {
      workspaceId: project.workspaceId,
      projectId: input.projectId,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: "discovery.started",
      entityType: "DISCOVERY_SESSION",
      entityId: session!.id,
    });
    return session!;
  });
}

/** Answers, deferrals and accepted assumptions only change an ACTIVE session. */
export function assertSessionActive(session: DiscoverySession): void {
  // A completed/abandoned discovery is a closed record: requirements may
  // already be built on it, so late changes must not silently alter it.
  if (session.status !== "ACTIVE") {
    throw errors.conflict("DISCOVERY_CLOSED", "This discovery session is closed — answers can no longer change");
  }
}

export async function getActiveSession(db: DbExecutor, projectId: string): Promise<DiscoverySession | null> {
  const [session] = await db
    .select()
    .from(schema.discoverySessions)
    .where(and(eq(schema.discoverySessions.projectId, projectId), ne(schema.discoverySessions.status, "ABANDONED")))
    .orderBy(desc(schema.discoverySessions.createdAt))
    .limit(1);
  return session ?? null;
}

/* ── Transcript for the model / UI ── */

export async function buildTranscript(db: DbExecutor, session: DiscoverySession, project: typeof schema.projects.$inferSelect) {
  const answers = await db
    .select({ question: schema.discoveryQuestions, answer: schema.discoveryAnswers })
    .from(schema.discoveryQuestions)
    .leftJoin(schema.discoveryAnswers, eq(schema.discoveryAnswers.questionId, schema.discoveryQuestions.id))
    .where(eq(schema.discoveryQuestions.sessionId, session.id))
    .orderBy(asc(schema.discoveryQuestions.sequence));
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
  const contradictions = await db
    .select()
    .from(schema.discoveryContradictions)
    .where(eq(schema.discoveryContradictions.sessionId, session.id))
    .orderBy(desc(schema.discoveryContradictions.createdAt));
  return { project, session, answers, facts, assumptions, contradictions };
}

export function transcriptText(
  project: typeof schema.projects.$inferSelect,
  answers: Array<{ question: DiscoveryQuestion; answer: typeof schema.discoveryAnswers.$inferSelect | null }>,
  facts: Array<typeof schema.discoveryFacts.$inferSelect>,
  assumptions: Array<typeof schema.discoveryAssumptions.$inferSelect>,
): string {
  const nl = String.fromCharCode(10);
  const lines: string[] = [];
  lines.push(`PROJECT: ${project.name}`);
  lines.push(`HIGH-LEVEL IDEA: ${project.highLevelIdea}`);
  if (project.constraints.length) lines.push(`INITIAL CONSTRAINTS: ${project.constraints.join("; ")}`);
  if (facts.length) {
    lines.push("KNOWN FACTS:");
    for (const f of facts) lines.push(`- (${f.sourceType}) ${f.factKey}: ${f.value}`);
  }
  if (assumptions.length) {
    lines.push("CURRENT ASSUMPTIONS:");
    for (const a of assumptions) lines.push(`- [${a.status}] ${a.description}`);
  }
  if (answers.length) {
    lines.push("ANSWERED SO FAR:");
    for (const { question, answer } of answers) {
      if (!answer) continue;
      lines.push(`- Q (${question.topic}): ${question.questionText}`);
      lines.push(`  A: ${answer.answer.text}${answer.answer.selected_options?.length ? ` [chosen: ${answer.answer.selected_options.join(", ")}]` : ""}`);
    }
  }
  return lines.join(nl);
}
