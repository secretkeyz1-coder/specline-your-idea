import { Elysia, t } from "elysia";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { answerQuestion, acceptAssumptions, completeDiscovery, computeReadiness, deferQuestion, getActiveSession, nextBatch, startDiscovery } from "./service.js";
import { isUnansweredBuiltIn } from "./topics.js";
import { DomainError, errors } from "@sdd/shared";

/** Discovery REST endpoints (T044, docs/09 §3). */

export function discoveryRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["discovery"] }).use(authPlugin(infra))
    .post(
      "/projects/:projectId/discovery-sessions",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        // Starting also drafts the first batch with the model: same AI budget as /discovery/next.
        await rateLimit(ctx.infra, "AI", `discovery:${principal.userId}`);
        const session = await startDiscovery(ctx.infra.db, { projectId: ctx.params.projectId, userId: principal.userId, source: principal.source });
        try {
          await nextBatch(ctx.infra.gateway(), ctx.infra.db, { projectId: ctx.params.projectId, userId: principal.userId });
        } catch (error) {
          // The session exists either way, and POST /discovery/next can draft
          // the batch later — so a domain-level refusal (e.g. no AI
          // provider bound) is logged, not fatal. Anything else (database
          // failure, bug) must surface instead of being swallowed.
          if (!(error instanceof DomainError)) throw error;
          ctx.logger.warn("first discovery batch not drafted", { code: error.code, message: error.message });
        }
        ctx.set.status = 201;
        return { session };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/projects/:projectId/discovery",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        const session = await getActiveSession(ctx.infra.db, ctx.params.projectId);
        if (!session) return { session: null, question: null, facts: [], assumptions: [], readiness: "INCOMPLETE" };
        const facts = await ctx.infra.db
          .select()
          .from(schema.discoveryFacts)
          .where(eq(schema.discoveryFacts.sessionId, session.id));
        const assumptions = await ctx.infra.db
          .select()
          .from(schema.discoveryAssumptions)
          .where(eq(schema.discoveryAssumptions.sessionId, session.id));
        const history = await ctx.infra.db
          .select({ question: schema.discoveryQuestions, answer: schema.discoveryAnswers })
          .from(schema.discoveryQuestions)
          .leftJoin(schema.discoveryAnswers, eq(schema.discoveryAnswers.questionId, schema.discoveryQuestions.id))
          .where(eq(schema.discoveryQuestions.sessionId, session.id));
        const answered = history.filter((h) => h.question.status === "ANSWERED");
        // Readiness must see PENDING blocking questions too (not only answered
        // rows) — otherwise it reported READY while a blocking question was open.
        // Unanswered questions from the retired built-in bank are not shown (a read never deletes; the next batch drops them).
        const readiness = computeReadiness(
          session,
          facts.filter((f) => f.status === "ACTIVE"),
          assumptions,
          history.filter((h) => !isUnansweredBuiltIn(h.question)).map((h) => ({ question: h.question, answer: h.answer })),
        );
        const pending = (
          await ctx.infra.db
            .select()
            .from(schema.discoveryQuestions)
            .where(and(eq(schema.discoveryQuestions.sessionId, session.id), eq(schema.discoveryQuestions.status, "PENDING")))
            .orderBy(asc(schema.discoveryQuestions.sequence))
        ).filter((q) => !isUnansweredBuiltIn(q));
        return {
          session: { ...session, readiness },
          answered,
          pending,
          facts,
          assumptions,
          contradictions: await ctx.infra.db.select().from(schema.discoveryContradictions).where(eq(schema.discoveryContradictions.sessionId, session.id)),
          readiness,
        };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/projects/:projectId/discovery/next",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `discovery:${principal.userId}`);
        return nextBatch(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          deepen: ctx.query.deepen === "true",
        });
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/discovery/questions/:questionId/answer",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [question] = await ctx.infra.db.select().from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.id, ctx.params.questionId)).limit(1);
        if (!question) throw errors.notFound("Discovery question");
        const [session] = await ctx.infra.db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, question.sessionId)).limit(1);
        await authorizeProjectAccess(ctx.infra.db, principal, session!.projectId, { write: true, scope: "artifact:write" });
        return answerQuestion(ctx.infra.db, {
          questionId: ctx.params.questionId,
          userId: principal.userId,
          body: { answer: ctx.body.answer, selected_options: ctx.body.selected_options },
        });
      },
      {
        params: t.Object({ questionId: t.String({ format: "uuid" }) }),
        body: t.Object({
          answer: t.String({ minLength: 1, maxLength: 5000 }),
          selected_options: t.Optional(t.Array(t.String(), { maxItems: 8 })),
        }),
      },
    )

    .post(
      "/discovery/questions/:questionId/defer",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [question] = await ctx.infra.db.select().from(schema.discoveryQuestions).where(eq(schema.discoveryQuestions.id, ctx.params.questionId)).limit(1);
        if (!question) throw errors.notFound("Discovery question");
        const [session] = await ctx.infra.db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, question.sessionId)).limit(1);
        await authorizeProjectAccess(ctx.infra.db, principal, session!.projectId, { write: true, scope: "artifact:write" });
        return deferQuestion(ctx.infra.db, {
          questionId: ctx.params.questionId,
          userId: principal.userId,
          recommendation: ctx.body.recommendation ?? null,
        });
      },
      {
        params: t.Object({ questionId: t.String({ format: "uuid" }) }),
        body: t.Object({
          recommendation: t.Optional(t.Union([t.Null(), t.String({ maxLength: 2000 })])),
        }),
      },
    )

    .post(
      "/discovery/sessions/:sessionId/accept-assumptions",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [session] = await ctx.infra.db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, ctx.params.sessionId)).limit(1);
        if (!session) throw errors.notFound("Discovery session");
        await authorizeProjectAccess(ctx.infra.db, principal, session.projectId, { write: true, scope: "artifact:write" });
        const updated = await acceptAssumptions(ctx.infra.db, { sessionId: ctx.params.sessionId, userId: principal.userId, source: principal.source });
        return { session: updated };
      },
      { params: t.Object({ sessionId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/discovery/sessions/:sessionId/complete",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [session] = await ctx.infra.db.select().from(schema.discoverySessions).where(eq(schema.discoverySessions.id, ctx.params.sessionId)).limit(1);
        if (!session) throw errors.notFound("Discovery session");
        await authorizeProjectAccess(ctx.infra.db, principal, session.projectId, { write: true, scope: "artifact:write" });
        const updated = await completeDiscovery(ctx.infra.db, {
          sessionId: ctx.params.sessionId,
          userId: principal.userId,
          acceptAssumptions: ctx.body?.accept_assumptions === true,
          source: principal.source,
        });
        return { session: updated };
      },
      {
        params: t.Object({ sessionId: t.String({ format: "uuid" }) }),
        body: t.Optional(t.Object({ accept_assumptions: t.Optional(t.Boolean()) })),
      },
    );
}
