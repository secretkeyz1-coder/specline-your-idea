import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { errors } from "@sdd/shared";
import { ArtifactType } from "@sdd/contracts";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { generateRequirements, refineRequirements, editRequirementsDraft, listRequirementsForRevision } from "./requirements.js";
import { recommendStack, validateCustomStack, approveStack } from "./stack.js";
import { STACK_CATALOG_REVIEWED_AT, verifiedCatalog } from "./stack-catalog.js";
import { generateDesign, refineDesign, editDesignDraft } from "./design.js";
import { approveRevision, getArtifactWithRevisions, getRevision } from "../artifact/service.js";

/** Artifact / requirements / stack / design REST endpoints (docs/09 §4–6). */

export function planningRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["planning"] }).use(authPlugin(infra))

    /* ── Requirements (docs/09 §4) ── */
    .post(
      "/projects/:projectId/artifacts/requirements/generate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `planning:${principal.userId}`);
        return generateRequirements(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
        });
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/projects/:projectId/artifacts/requirements/refine",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `planning:${principal.userId}`);
        return refineRequirements(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          instructions: ctx.body.instructions,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({ instructions: t.String({ minLength: 3, maxLength: 4000 }) }),
      },
    )

    .post(
      "/projects/:projectId/artifacts/requirements/edit",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return editRequirementsDraft(ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          data: ctx.body.structured,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({ structured: t.Unknown() }),
      },
    )

    .get(
      "/projects/:projectId/requirements",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        // The ACTIVE revision: the approved baseline when one exists, otherwise
        // the newest draft — a freshly generated plan must be reviewable and
        // approvable, not invisible (FR-020..025, docs/09 §4).
        const [artifact] = await ctx.infra.db
          .select()
          .from(schema.artifacts)
          .where(and(eq(schema.artifacts.projectId, ctx.params.projectId), eq(schema.artifacts.artifactType, "requirements")))
          .limit(1);
        if (!artifact) return { revision: null, artifact: null, requirements: [], revisions: [] };
        const revisions = await ctx.infra.db
          .select()
          .from(schema.artifactRevisions)
          .where(eq(schema.artifactRevisions.artifactId, artifact.id))
          .orderBy(desc(schema.artifactRevisions.version));
        const approvedRevision = artifact.approvedRevisionId ? revisions.find((r) => r.id === artifact.approvedRevisionId) ?? null : null;
        // A newer DRAFT (e.g. a refinement of the approved baseline) is what the
        // user must review next, so it takes precedence; the approved baseline is
        // still returned separately for gates that need it.
        const newestDraft = revisions.find((r) => r.status === "DRAFT") ?? null;
        const revision =
          newestDraft && (!approvedRevision || newestDraft.version > approvedRevision.version)
            ? newestDraft
            : approvedRevision ?? revisions[0] ?? null;
        return {
          revision,
          approved_revision: approvedRevision,
          artifact,
          requirements: revision ? await listRequirementsForRevision(ctx.infra.db, revision.id) : [],
          revisions,
        };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    /* ── Artifacts generic (docs/09 §4) ── */
    .get(
      "/artifacts/:artifactId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { artifact } = await getArtifactWithRevisions(ctx.infra.db, ctx.params.artifactId);
        await authorizeProjectAccess(ctx.infra.db, principal, artifact.projectId, { scope: "artifact:read" });
        return getArtifactWithRevisions(ctx.infra.db, ctx.params.artifactId);
      },
      { params: t.Object({ artifactId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/artifact-revisions/:revisionId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const revision = await getRevision(ctx.infra.db, ctx.params.revisionId);
        const artifact = (await ctx.infra.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, revision.artifactId)).limit(1))[0]!;
        await authorizeProjectAccess(ctx.infra.db, principal, artifact.projectId, { scope: "artifact:read" });
        return { revision, artifact };
      },
      { params: t.Object({ revisionId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/artifact-revisions/:revisionId/approve",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const revision = await getRevision(ctx.infra.db, ctx.params.revisionId);
        const artifact = (await ctx.infra.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, revision.artifactId)).limit(1))[0]!;
        await authorizeProjectAccess(ctx.infra.db, principal, artifact.projectId, { write: true, scope: "artifact:write" });
        // The project's active-revision pointer and lifecycle move inside the
        // approval transaction (approveRevision), never after it.
        const approved = await approveRevision(ctx.infra.db, {
          revisionId: ctx.params.revisionId,
          userId: principal.userId,
          note: ctx.body.note,
          source: principal.source,
        });
        return { revision: approved };
      },
      {
        params: t.Object({ revisionId: t.String({ format: "uuid" }) }),
        body: t.Object({ note: t.Optional(t.String({ maxLength: 2000 })) }),
      },
    )

    .get(
      "/projects/:projectId/artifacts/:type",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "artifact:read" });
        const parsedType = ArtifactType.safeParse(ctx.params.type);
        if (!parsedType.success) throw errors.validation(`Unknown artifact type ${ctx.params.type}`);
        // Read-only: a GET with read access must not create rows. The artifact
        // is created by the first generation/edit; until then it is empty.
        const [artifact] = await ctx.infra.db
          .select()
          .from(schema.artifacts)
          .where(and(eq(schema.artifacts.projectId, ctx.params.projectId), eq(schema.artifacts.artifactType, parsedType.data)))
          .limit(1);
        if (!artifact) return { artifact: null, revisions: [] };
        return getArtifactWithRevisions(ctx.infra.db, artifact.id);
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), type: t.String() }),
        detail: { summary: "Get a project artifact with all revisions ({artifact: null, revisions: []} before the first draft)" },
      },
    )

    /* ── Stack (docs/09 §5) ── */
    // Per-layer choices for setting the stack by hand, each with its live
    // release facts. Registries that are slow to answer are left pending
    // (verified: null) rather than holding the page; they fill the cache.
    .get(
      "/stack/catalog",
      async (ctx) => {
        ensurePrincipal(ctx);
        return { reviewed_at: STACK_CATALOG_REVIEWED_AT, checked_at: new Date().toISOString(), layers: await verifiedCatalog({ deadlineMs: 2500 }) };
      },
      { detail: { summary: "Technologies per stack layer, with their latest release checked live against npm, PyPI, crates.io or GitHub" } },
    )

    .post(
      "/projects/:projectId/stack/recommend",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `stack:${principal.userId}`);
        return recommendStack(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          body: {
            mode: ctx.body.mode,
            preferences: ctx.body.preferences ?? {},
            manual_components: (ctx.body.manual_components ?? []).map((c) => ({ ...c, locked: c.locked ?? false })),
            suggest_category: ctx.body.suggest_category ?? null,
          },
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          mode: t.Union([t.Literal("RECOMMENDED"), t.Literal("MANUAL")]),
          preferences: t.Optional(t.Record(t.String(), t.String())),
          manual_components: t.Optional(
            t.Array(
              t.Object({
                category: t.String(),
                technology: t.String(),
                version_constraint: t.Union([t.Null(), t.String()]),
                locked: t.Optional(t.Boolean()),
                package: t.Optional(
                  t.Union([
                    t.Null(),
                    t.Object({
                      registry: t.Union([t.Literal("npm"), t.Literal("pypi"), t.Literal("crates"), t.Literal("github")]),
                      name: t.String({ minLength: 1, maxLength: 214 }),
                    }),
                  ]),
                ),
              }),
              { maxItems: 20 },
            ),
          ),
          suggest_category: t.Optional(t.Union([t.Null(), t.String()])),
        }),
      },
    )

    .post(
      "/projects/:projectId/stack/validate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `stack:${principal.userId}`);
        return validateCustomStack(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          body: {
            mode: "MANUAL",
            preferences: ctx.body.preferences ?? {},
            manual_components: (ctx.body.manual_components ?? []).map((c) => ({ ...c, locked: c.locked ?? false })),
            suggest_category: null,
          },
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          preferences: t.Optional(t.Record(t.String(), t.String())),
          manual_components: t.Array(
            t.Object({
              category: t.String(),
              technology: t.String(),
              version_constraint: t.Union([t.Null(), t.String()]),
              locked: t.Optional(t.Boolean()),
              package: t.Optional(
                t.Union([
                  t.Null(),
                  t.Object({
                    registry: t.Union([t.Literal("npm"), t.Literal("pypi"), t.Literal("crates"), t.Literal("github")]),
                    name: t.String({ minLength: 1, maxLength: 214 }),
                  }),
                ]),
              ),
            }),
            { maxItems: 20 },
          ),
        }),
      },
    )

    .post(
      "/projects/:projectId/stack/approve",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return approveStack(ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          components: ctx.body.components,
          rationale: ctx.body.rationale ?? "",
          source: principal.source,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          components: t.Array(
            t.Object({
              category: t.String({ maxLength: 64 }),
              technology: t.String({ maxLength: 120 }),
              version_constraint: t.Union([t.Null(), t.String()]),
              selection_source: t.Union([t.Literal("AI_RECOMMENDED"), t.Literal("USER_SELECTED"), t.Literal("AI_ASSISTED")]),
              locked_by_user: t.Boolean(),
              rationale: t.String({ maxLength: 500 }),
              package: t.Optional(
                t.Union([
                  t.Null(),
                  t.Object({
                    registry: t.Union([t.Literal("npm"), t.Literal("pypi"), t.Literal("crates"), t.Literal("github")]),
                    name: t.String({ minLength: 1, maxLength: 214 }),
                  }),
                ]),
              ),
            }),
            { minItems: 1, maxItems: 20 },
          ),
          rationale: t.Optional(t.String({ maxLength: 2000 })),
        }),
      },
    )

    /* ── Design (docs/09 §6) ── */
    .post(
      "/projects/:projectId/design/generate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `design:${principal.userId}`);
        return generateDesign(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
        });
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/projects/:projectId/design/edit",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return editDesignDraft(ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          data: ctx.body.structured,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({ structured: t.Unknown() }),
      },
    )

    .post(
      "/design/:designId/refine",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const artifact = (await ctx.infra.db.select().from(schema.artifacts).where(eq(schema.artifacts.id, ctx.params.designId)).limit(1))[0]!;
        if (!artifact || artifact.artifactType !== "design") throw errors.notFound("Design artifact");
        await authorizeProjectAccess(ctx.infra.db, principal, artifact.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `design:${principal.userId}`);
        return refineDesign(ctx.infra.gateway(), ctx.infra.db, {
          projectId: artifact.projectId,
          userId: principal.userId,
          section: ctx.body.section ?? "overview",
          instructions: ctx.body.instructions,
        });
      },
      {
        params: t.Object({ designId: t.String({ format: "uuid" }) }),
        body: t.Object({
          instructions: t.String({ minLength: 3, maxLength: 4000 }),
          section: t.Optional(t.String({ maxLength: 80 })),
        }),
      },
    );
}

