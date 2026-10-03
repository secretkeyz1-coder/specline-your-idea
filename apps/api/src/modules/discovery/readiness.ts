import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { COVERAGE_TOPICS, type DiscoveryReadiness } from "@sdd/contracts";
import { errors, nowIso } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";
import { getProject, updateLifecycle } from "../project/service.js";
import { assertSessionActive } from "./session.js";
import { type DiscoveryQuestion, type DiscoverySession, REQUIRED_TOPICS } from "./topics.js";

/** The readiness gate before requirements (FR-016) and accepting assumptions for uncovered topics (FR-017). */

/* ── Readiness gate (T042, FR-016) ── */

export function computeReadiness(
  session: DiscoverySession,
  facts: Array<typeof schema.discoveryFacts.$inferSelect>,
  assumptions: Array<typeof schema.discoveryAssumptions.$inferSelect>,
  answers: Array<{ question: DiscoveryQuestion; answer: unknown }>,
): DiscoveryReadiness {
  const pendingBlocking = answers.some(({ question }) => question.blocking && question.status === "PENDING");
  if (pendingBlocking) return "INCOMPLETE";

  const coverage = session.coverage;
  if (COVERAGE_TOPICS.some(topic => coverage[topic]?.blocking && coverage[topic]?.status !== "KNOWN")) return "INCOMPLETE";
  if (uncoveredRequiredTopics(coverage, facts).length > 0) return "INCOMPLETE";

  const unresolvedAssumptions = assumptions.some((a) => a.status === "PROPOSED");
  const nonRequiredGaps = COVERAGE_TOPICS.some((topic) => coverage[topic]?.status === "UNKNOWN" || coverage[topic]?.status === "PARTIAL");
  if (unresolvedAssumptions || nonRequiredGaps) return "READY_WITH_ASSUMPTIONS";
  return "READY";
}

/** Required topics with neither coverage nor a user-stated fact (the readiness gap). */
export function uncoveredRequiredTopics(
  coverage: DiscoverySession["coverage"],
  facts: Array<Pick<typeof schema.discoveryFacts.$inferSelect, "factKey">>,
): string[] {
  return REQUIRED_TOPICS.filter(
    (topic) => coverage[topic]?.status !== "KNOWN" && (coverage[topic]?.status !== "PARTIAL" || coverage[topic]?.blocking) && !facts.some((f) => f.factKey === `${topic}_user`),
  );
}

/** The explicit assumption recorded when discovery completes with a required topic still open. */
export function uncoveredTopicAssumption(topic: string): string {
  return `${topic.replaceAll("_", " ")}: not covered in discovery — the user chose to proceed on assumptions; derive a conservative default from the idea and state it explicitly.`;
}

/**
 * The requirements gate (C7): discovery is ready, or the user explicitly chose
 * to proceed on accepted assumptions. A COMPLETED session passed that choice
 * at completion time (completeDiscovery enforces it), so it is never re-locked
 * — sessions completed before open topics were recorded as assumptions had
 * zero ACCEPTED rows and could never generate requirements.
 */
export function discoveryAllowsRequirements(
  session: Pick<DiscoverySession, "status">,
  readiness: DiscoveryReadiness,
): boolean {
  return session.status === "COMPLETED" || readiness !== "INCOMPLETE";
}

/* ── Accept assumptions (T043, FR-017) ── */

export async function acceptAssumptions(db: DbExecutor, input: { sessionId: string; userId: string; source?: AuditSource }) {
  // One transaction with the session locked: the assumptions, readiness,
  // lifecycle and audit row land together, and a concurrent complete waits.
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(schema.discoverySessions)
      .where(eq(schema.discoverySessions.id, input.sessionId))
      .for("update")
      .limit(1);
    if (!session) throw errors.notFound("Discovery session", input.sessionId);
    assertSessionActive(session);
    await tx
      .update(schema.discoveryAssumptions)
      .set({ status: "ACCEPTED", acceptedBy: input.userId, acceptedAt: new Date() })
      .where(and(eq(schema.discoveryAssumptions.sessionId, session.id), eq(schema.discoveryAssumptions.status, "PROPOSED")));
    const { buildSessionState } = await import("./batch.js");
    const state = await buildSessionState(tx, session);
    const readiness = computeReadiness(state.session, state.facts, state.assumptions, state.answers);
    const [updated] = await tx
      .update(schema.discoverySessions)
      .set({ readiness })
      .where(eq(schema.discoverySessions.id, session.id))
      .returning();
    const project = await getProject(tx, session.projectId);
    if (readiness !== "INCOMPLETE") await updateLifecycle(tx, session.projectId, "DISCOVERY_READY");
    await audit(tx, {
      workspaceId: project.workspaceId,
      projectId: session.projectId,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: "discovery.assumptions_accepted",
      entityType: "DISCOVERY_SESSION",
      entityId: session.id,
      metadata: { at: nowIso() },
    });
    return updated!;
  });
}
