import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { CreateProjectSchema } from "@sdd/contracts";
import { authorizeProjectAccess, authorizeWorkspaceAccess, primaryWorkspaceId } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { audit } from "../audit/service.js";
import { createProject, getProject, listProjectsWithProgress } from "./service.js";

/** Project REST endpoints (T020, docs/09 §2). */

export function projectRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/projects", tags: ["project"] }).use(authPlugin(infra))
    .post(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const body = CreateProjectSchema.parse(ctx.body);
        // An explicit workspace, else the same default GET /projects lists. The
        // write check also refuses tokens narrowed to a single project: they
        // must not create projects beside the one they were issued for.
        const wsId = ctx.body.workspace_id ?? (await primaryWorkspaceId(ctx.infra.db, principal));
        await authorizeWorkspaceAccess(ctx.infra.db, principal, wsId, { write: true, scope: "artifact:write" });
        const project = await createProject(ctx.infra.db, { workspaceId: wsId, userId: principal.userId, source: principal.source, body });
        ctx.set.status = 201;
        return { project };
      },
      {
        detail: { summary: "Create project from a high-level idea (FR-002)" },
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 160 }),
          high_level_idea: t.String({ minLength: 1, maxLength: 20000 }),
          constraints: t.Optional(t.Array(t.String(), { maxItems: 10 })),
          key: t.Optional(t.String({ pattern: "^[A-Za-z][A-Za-z0-9-]{1,20}$" })),
          /** Target workspace; omitted → the caller's default (see primaryWorkspaceId). */
          workspace_id: t.Optional(t.String({ format: "uuid" })),
        }),
      },
    )

    .get(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const workspaceId = ctx.query.workspace_id ?? (await primaryWorkspaceId(ctx.infra.db, principal));
        await authorizeWorkspaceAccess(ctx.infra.db, principal, workspaceId, { scope: "project:read" });
        const projects = await listProjectsWithProgress(ctx.infra.db, workspaceId);
        // A token issued for one project sees only that project.
        return { projects: principal.tokenProjectId ? projects.filter((p) => p.id === principal.tokenProjectId) : projects };
      },
      { query: t.Object({ workspace_id: t.Optional(t.String({ format: "uuid" })) }) },
    )

    .get(
      "/:projectId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        return { project: await getProject(ctx.infra.db, ctx.params.projectId) };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .patch(
      "/:projectId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const access = await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "workspace:admin" });
        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (ctx.body.name) updates["name"] = ctx.body.name.trim();
        if (ctx.body.high_level_idea) updates["highLevelIdea"] = ctx.body.high_level_idea.trim();
        if (ctx.body.project_rules) updates["projectRules"] = ctx.body.project_rules;
        if (ctx.body.archived !== undefined) updates["archivedAt"] = ctx.body.archived ? new Date() : null;
        await ctx.infra.db.transaction(async (tx) => {
          await tx.update(schema.projects).set(updates).where(eq(schema.projects.id, ctx.params.projectId));
          // Project rules steer every later generation, so who changed them is on record.
          await audit(tx, {
            workspaceId: access.workspaceId,
            projectId: ctx.params.projectId,
            actorType: "USER",
            actorId: principal.userId,
            source: principal.source,
            action: "project.updated",
            entityType: "PROJECT",
            entityId: ctx.params.projectId,
            metadata: {
              fields: Object.keys(updates).filter((k) => k !== "updatedAt"),
              ...(ctx.body.project_rules ? { project_rules: ctx.body.project_rules } : {}),
            },
          });
        });
        return { project: await getProject(ctx.infra.db, ctx.params.projectId) };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 160 })),
          high_level_idea: t.Optional(t.String({ minLength: 1, maxLength: 20000 })),
          project_rules: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 50 })),
          archived: t.Optional(t.Boolean()),
        }),
      },
    );
}
