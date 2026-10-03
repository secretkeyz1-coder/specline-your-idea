import { Elysia, t } from "elysia";
import { and, desc, eq, ne } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { startConvergenceRun, getConvergenceRun, generateTaskFromFinding, evaluateFeatureCompletionGate, evaluateProjectCompletionGates, completeFeature, listConvergenceRuns } from "./service.js";
import { orchestrateProject } from "./orchestrator.js";

/** Convergence REST endpoints (T168, docs/09 §18). */

export function convergenceRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["convergence"] }).use(authPlugin(infra))
    .post("/projects/:projectId/orchestrate", async ctx => {
      const principal = ensurePrincipal(ctx);
      await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "run:submit" });
      await rateLimit(ctx.infra, "AI", `orchestrate:${principal.userId}`);
      const links = await ctx.infra.db.select({ link: schema.repositoryLinks }).from(schema.repositoryLinks)
        .innerJoin(schema.localMachines, eq(schema.localMachines.id, schema.repositoryLinks.machineId))
        .where(and(eq(schema.repositoryLinks.projectId, ctx.params.projectId), eq(schema.localMachines.userId, principal.userId), ne(schema.localMachines.status, "REVOKED"), ...(principal.tokenMachineId ? [eq(schema.localMachines.id, principal.tokenMachineId)] : []), eq(schema.repositoryLinks.status, "ACTIVE"), eq(schema.repositoryLinks.permissionMode, "AUTO_RUN")));
      if (!links.length) throw (await import("@sdd/shared")).errors.forbidden("Automatic release review requires an active AUTO_RUN repository link");
      ctx.server?.timeout(ctx.request, 0);
      return orchestrateProject(ctx.infra.gateway(), ctx.infra.db, ctx.params.projectId, principal.userId);
    }, { params: t.Object({ projectId: t.String({ format: "uuid" }) }) })
    .post(
      "/features/:featureId/convergence-runs",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [feature] = await ctx.infra.db.select().from(schema.features).where(eq(schema.features.id, ctx.params.featureId)).limit(1);
        if (!feature) throw (await import("@sdd/shared")).errors.notFound("Feature");
        await authorizeProjectAccess(ctx.infra.db, principal, feature.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `convergence:${principal.userId}`);
        return startConvergenceRun(ctx.infra.gateway(), ctx.infra.db, { featureId: feature.id, userId: principal.userId, source: principal.source });
      },
      { params: t.Object({ featureId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/convergence-runs/:runId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { run } = await getConvergenceRun(ctx.infra.db, ctx.params.runId);
        const [feature] = await ctx.infra.db.select().from(schema.features).where(eq(schema.features.id, run.featureId)).limit(1);
        await authorizeProjectAccess(ctx.infra.db, principal, feature!.projectId, { scope: "project:read" });
        return getConvergenceRun(ctx.infra.db, ctx.params.runId);
      },
      { params: t.Object({ runId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/features/:featureId/convergence-runs",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [feature] = await ctx.infra.db.select().from(schema.features).where(eq(schema.features.id, ctx.params.featureId)).limit(1);
        if (!feature) throw (await import("@sdd/shared")).errors.notFound("Feature");
        await authorizeProjectAccess(ctx.infra.db, principal, feature.projectId, { scope: "project:read" });
        return { runs: await listConvergenceRuns(ctx.infra.db, feature.id) };
      },
      { params: t.Object({ featureId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/convergence-findings/:findingId/generate-task",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [finding] = await ctx.infra.db.select().from(schema.convergenceFindings).where(eq(schema.convergenceFindings.id, ctx.params.findingId)).limit(1);
        if (!finding) throw (await import("@sdd/shared")).errors.notFound("Finding");
        const [run] = await ctx.infra.db.select().from(schema.convergenceRuns).where(eq(schema.convergenceRuns.id, finding.convergenceRunId)).limit(1);
        const [feature] = await ctx.infra.db.select().from(schema.features).where(eq(schema.features.id, run!.featureId)).limit(1);
        await authorizeProjectAccess(ctx.infra.db, principal, feature!.projectId, { write: true, scope: "artifact:write" });
        return generateTaskFromFinding(ctx.infra.db, { findingId: finding.id, userId: principal.userId });
      },
      { params: t.Object({ findingId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/features/:featureId/completion-gate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [feature] = await ctx.infra.db.select().from(schema.features).where(eq(schema.features.id, ctx.params.featureId)).limit(1);
        if (!feature) throw (await import("@sdd/shared")).errors.notFound("Feature");
        await authorizeProjectAccess(ctx.infra.db, principal, feature.projectId, { scope: "project:read" });
        return evaluateFeatureCompletionGate(ctx.infra.db, feature.id);
      },
      { params: t.Object({ featureId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/features/:featureId/complete",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [feature] = await ctx.infra.db.select().from(schema.features).where(eq(schema.features.id, ctx.params.featureId)).limit(1);
        if (!feature) throw (await import("@sdd/shared")).errors.notFound("Feature");
        await authorizeProjectAccess(ctx.infra.db, principal, feature.projectId, { write: true, scope: "artifact:write" });
        return { feature: await completeFeature(ctx.infra.db, { featureId: feature.id, userId: principal.userId, source: principal.source }) };
      },
      { params: t.Object({ featureId: t.String({ format: "uuid" }) }) },
    );
}

/** Feature endpoints (plan map data source — docs/14 §9, T078). */
export function featureRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/projects/:projectId/features", tags: ["features"] }).use(authPlugin(infra))
    .get(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        const features = await ctx.infra.db
          .select()
          .from(schema.features)
          .where(eq(schema.features.projectId, ctx.params.projectId))
          .orderBy(desc(schema.features.createdAt));
        return { features };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    // Every feature with its release-check verdict, in one call — the journey
    // and the plan map need "checked / gaps / ready" without N+1 requests.
    .get(
      "/release-status",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        const out = [];
        for (const { feature: f, checked, gate } of await evaluateProjectCompletionGates(ctx.infra.db, ctx.params.projectId)) {
          out.push({
            id: f.id,
            key: f.key,
            title: f.title,
            description: f.description,
            status: f.status,
            checked,
            can_complete: gate.canComplete,
            recommended: gate.blockers.convergence_recommended,
            blocking_findings: gate.blockers.open_blocking_findings.length,
            blocking_bugs: gate.blockers.blocking_bugs.length,
            incomplete_tasks: gate.blockers.incomplete_tasks.length,
            no_tasks: gate.blockers.no_tasks,
          });
        }
        return { features: out };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        const { nextCounter } = await import("../project/service.js");
        const { displayKey } = await import("@sdd/shared");
        const seq = await nextCounter(ctx.infra.db, ctx.params.projectId, "feature");
        const [feature] = await ctx.infra.db
          .insert(schema.features)
          .values({
            projectId: ctx.params.projectId,
            key: ctx.body.key ?? displayKey("FTR", seq),
            title: ctx.body.title,
            description: ctx.body.description ?? "",
            priority: ctx.body.priority ?? "P1",
          })
          .returning();
        return { feature };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 200 }),
          description: t.Optional(t.String({ maxLength: 2000 })),
          key: t.Optional(t.String({ pattern: "^[A-Z0-9-]{2,32}$" })),
          priority: t.Optional(t.Union([t.Literal("P0"), t.Literal("P1"), t.Literal("P2"), t.Literal("P3")])),
        }),
      },
    );
}
