import { Elysia, t } from "elysia";
import { eq, sql } from "drizzle-orm";
import { schema } from "@sdd/db";
import { createWorkspaceWithOwner } from "@sdd/auth";
import { errors } from "@sdd/shared";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { authorizeWorkspaceAccess, requireBrowserSession } from "../../context.js";
import { audit } from "../audit/service.js";

/** Workspace routes (FR-001) + member listing. */

export function workspaceRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/workspaces", tags: ["workspace"] }).use(authPlugin(infra))
    .get("/", async (ctx) => {
      const principal = ensurePrincipal(ctx);
      const rows = await ctx.infra.db
        .select({
          workspace: schema.workspaces,
          role: schema.workspaceMembers.role,
          projectCount: sql<number>`(SELECT count(*)::int FROM ${schema.projects} WHERE ${schema.projects.workspaceId} = ${schema.workspaces.id})`,
        })
        .from(schema.workspaceMembers)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
        .where(eq(schema.workspaceMembers.userId, principal.userId));
      return { workspaces: rows.map((r) => ({ ...r.workspace, role: r.role, project_count: r.projectCount })) };
    })

    .post(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        // A new workspace makes its creator OWNER: an API token (possibly
        // narrowed to one project) must not mint that authority for itself.
        requireBrowserSession(principal, "Creating a workspace");
        await rateLimit(ctx.infra, "AI", `ws-create:${principal.userId}`);
        const name = ctx.body.name.trim();
        if (name.length < 2) throw errors.validation("Workspace name too short");
        const workspace = await ctx.infra.db.transaction(async (tx) => {
          const created = await createWorkspaceWithOwner(tx, { name, ownerUserId: principal.userId });
          await audit(tx, {
            workspaceId: created.id,
            actorType: "USER",
            actorId: principal.userId,
            source: principal.source,
            action: "workspace.created",
            entityType: "WORKSPACE",
            entityId: created.id,
          });
          return created;
        });
        ctx.set.status = 201;
        return { workspace };
      },
      { body: t.Object({ name: t.String({ minLength: 2, maxLength: 80 }) }) },
    )

    .get(
      "/:workspaceId/members",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        // The member list (emails) is workspace-wide data: a token narrowed to
        // one project may not read it.
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { wholeWorkspace: true });
        const members = await ctx.infra.db
          .select({ member: schema.workspaceMembers, user: schema.users })
          .from(schema.workspaceMembers)
          .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
          .where(eq(schema.workspaceMembers.workspaceId, ctx.params.workspaceId));
        return {
          members: members.map((m) => ({
            user_id: m.user.id,
            email: m.user.email,
            display_name: m.user.displayName,
            role: m.member.role,
          })),
        };
      },
      { params: t.Object({ workspaceId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/:workspaceId/members",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { admin: true, scope: "workspace:admin" });
        const email = ctx.body.email.trim().toLowerCase();
        const [user] = await ctx.infra.db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
        if (!user) throw errors.notFound("User with that email");
        await ctx.infra.db.transaction(async (tx) => {
          const added = await tx
            .insert(schema.workspaceMembers)
            .values({ workspaceId: ctx.params.workspaceId, userId: user.id, role: ctx.body.role })
            .onConflictDoNothing()
            .returning({ userId: schema.workspaceMembers.userId });
          // Granting access is a security event; an existing member is a no-op.
          if (added.length > 0) {
            await audit(tx, {
              workspaceId: ctx.params.workspaceId,
              actorType: "USER",
              actorId: principal.userId,
              source: principal.source,
              action: "workspace.member_added",
              entityType: "USER",
              entityId: user.id,
              metadata: { role: ctx.body.role },
            });
          }
        });
        ctx.set.status = 201;
        return { ok: true };
      },
      {
        params: t.Object({ workspaceId: t.String({ format: "uuid" }) }),
        body: t.Object({
          email: t.String({ format: "email" }),
          role: t.Union([t.Literal("ADMIN"), t.Literal("MEMBER"), t.Literal("VIEWER")]),
        }),
      },
    );
}
