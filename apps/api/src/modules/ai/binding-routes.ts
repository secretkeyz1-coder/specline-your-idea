import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeProjectAccess, authorizeWorkspaceAccess } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import {
  deleteRoleBinding,
  describeEffectiveRouting,
  assertCliTargetAllowed,
  listProjectRoleBindings,
  listRoleBindings,
  putRoleBinding,
  toPublicConnection,
  toPublicProfile,
  toRedactedConnection,
} from "@sdd/ai";
import { AIRole } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";

/** Role bindings: which profile answers each AI role, as the workspace default or for one project, with why a bound role cannot run. */

const ROLE_VALUES = AIRole.options;

/** Why a bound role cannot run on its model, in words for the settings page; null when it can. */
function bindingProblem(
  profileStatus: string,
  connection: { status: string; providerType: string; baseUrl: string | null; scopeType: string },
): string | null {
  if (profileStatus !== "ACTIVE") return "The model is disabled — the role uses its fallback";
  if (connection.status !== "ACTIVE") return "The connection is disabled — the role uses its fallback";
  if (connection.providerType === "LOCAL_CLI") {
    try {
      assertCliTargetAllowed(connection.baseUrl, connection.scopeType);
    } catch (error) {
      return error instanceof Error ? error.message : "Its CLI connection is refused";
    }
  }
  return null;
}

function validRole(role: string): (typeof ROLE_VALUES)[number] {
  if (!ROLE_VALUES.includes(role as never)) throw errors.validation(`Invalid role; use one of ${ROLE_VALUES.join(", ")}`);
  return role as (typeof ROLE_VALUES)[number];
}

export function aiBindingRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["ai"] }).use(authPlugin(infra))

    .get(
      "/workspaces/:workspaceId/ai-role-bindings",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { admin: true, scope: "ai:manage" });
        const [{ workspace }, overrides] = await Promise.all([
          listRoleBindings(ctx.infra.db, null, ctx.params.workspaceId),
          listProjectRoleBindings(ctx.infra.db, ctx.params.workspaceId),
        ]);
        return {
          bindings: workspace.map((b) => ({
            role: b.binding.role,
            scope: b.binding.scopeType,
            ai_profile_id: b.binding.aiProfileId,
            profile_name: b.profile.name,
            model_id: b.profile.modelId,
            provider_name: b.connection.name,
            // The resolver skips a disabled profile or connection, so a bound
            // role on one of them actually runs on the fallback.
            active: b.profile.status === "ACTIVE" && b.connection.status === "ACTIVE",
          })),
          // Project overrides win over the defaults above, so the page lists
          // them too, with why one cannot run (disabled, or a server CLI saved
          // for a workspace before server CLIs became SYSTEM-only).
          project_overrides: overrides.map((b) => ({
            project: b.project,
            role: b.binding.role,
            ai_profile_id: b.binding.aiProfileId,
            profile_name: b.profile.name,
            model_id: b.profile.modelId,
            provider_name: b.connection.name,
            problem: bindingProblem(b.profile.status, b.connection),
          })),
        };
      },
      { params: t.Object({ workspaceId: t.String({ format: "uuid" }) }) },
    )


    .put(
      "/projects/:projectId/ai-role-bindings/:role",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { admin: true, scope: "ai:manage" });
        if (!ROLE_VALUES.includes(ctx.params.role as never)) throw errors.validation(`Invalid role; use one of ${ROLE_VALUES.join(", ")}`);
        const workspaceId = (await ctx.infra.db.select().from(schema.projects).where(eq(schema.projects.id, ctx.params.projectId)).limit(1))[0]!.workspaceId;
        const binding = await putRoleBinding(ctx.infra.db, {
          scopeType: "PROJECT",
          workspaceId,
          projectId: ctx.params.projectId,
          role: ctx.params.role as never,
          aiProfileId: ctx.body.ai_profile_id,
          userId: principal.userId,
        });
        return { binding: { id: binding.id, role: binding.role, scope: binding.scopeType, ai_profile_id: binding.aiProfileId } };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), role: t.String() }),
        body: t.Object({ ai_profile_id: t.String({ format: "uuid" }) }),
      },
    )

    .put(
      "/workspaces/:workspaceId/ai-role-bindings/:role",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { admin: true, scope: "ai:manage" });
        if (!ROLE_VALUES.includes(ctx.params.role as never)) throw errors.validation(`Invalid role; use one of ${ROLE_VALUES.join(", ")}`);
        const binding = await putRoleBinding(ctx.infra.db, {
          scopeType: "WORKSPACE",
          workspaceId: ctx.params.workspaceId,
          projectId: null,
          role: ctx.params.role as never,
          aiProfileId: ctx.body.ai_profile_id,
          userId: principal.userId,
        });
        return { binding: { id: binding.id, role: binding.role, scope: binding.scopeType, ai_profile_id: binding.aiProfileId } };
      },
      {
        params: t.Object({ workspaceId: t.String({ format: "uuid" }), role: t.String() }),
        body: t.Object({ ai_profile_id: t.String({ format: "uuid" }) }),
      },
    )

    .delete(
      "/workspaces/:workspaceId/ai-role-bindings/:role",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { admin: true, scope: "ai:manage" });
        const role = validRole(ctx.params.role);
        const removed = await deleteRoleBinding(ctx.infra.db, { scopeType: "WORKSPACE", workspaceId: ctx.params.workspaceId, projectId: null, role });
        if (!removed) throw errors.notFound("Role binding");
        await audit(ctx.infra.db, {
          workspaceId: ctx.params.workspaceId,
          actorType: "USER",
          actorId: principal.userId,
          source: principal.source as AuditSource,
          action: "ai.role_binding.removed",
          entityType: "AI_ROLE_BINDING",
          entityId: `${ctx.params.workspaceId}:${role}`,
          metadata: { role, scope: "WORKSPACE" },
        });
        return { deleted: true };
      },
      { params: t.Object({ workspaceId: t.String({ format: "uuid" }), role: t.String() }) },
    )

    .delete(
      "/projects/:projectId/ai-role-bindings/:role",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { admin: true, scope: "ai:manage" });
        const role = validRole(ctx.params.role);
        const [project] = await ctx.infra.db.select().from(schema.projects).where(eq(schema.projects.id, ctx.params.projectId)).limit(1);
        const removed = await deleteRoleBinding(ctx.infra.db, { scopeType: "PROJECT", workspaceId: project!.workspaceId, projectId: project!.id, role });
        if (!removed) throw errors.notFound("Role binding");
        await audit(ctx.infra.db, {
          workspaceId: project!.workspaceId,
          projectId: project!.id,
          actorType: "USER",
          actorId: principal.userId,
          source: principal.source as AuditSource,
          action: "ai.role_binding.removed",
          entityType: "AI_ROLE_BINDING",
          entityId: `${project!.id}:${role}`,
          metadata: { role, scope: "PROJECT" },
        });
        return { deleted: true };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }), role: t.String() }) },
    )

    .get(
      "/projects/:projectId/ai-role-bindings",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const access = await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId);
        const project = access.project;
        const bindings = await listRoleBindings(ctx.infra.db, project.id, project.workspaceId);
        const routing = await Promise.all(
          ROLE_VALUES.map((role) =>
            describeEffectiveRouting(ctx.infra.db, project.workspaceId, project.id, role).catch(() => ({ role, configured: false as const })),
          ),
        );
        // Same rule as the provider list: a SYSTEM connection's configuration
        // (operator base URL, public headers) is for admins and operators.
        const seesSystem = principal.isOperator || access.canAdmin;
        const provider = (c: Parameters<typeof toPublicConnection>[0]) => (c.scopeType === "SYSTEM" && !seesSystem ? toRedactedConnection(c) : toPublicConnection(c));
        return {
          effective: routing,
          project_bindings: bindings.project.map((b) => ({ ...b.binding, profile: toPublicProfile(b.profile), provider: provider(b.connection) })),
          workspace_bindings: bindings.workspace.map((b) => ({ ...b.binding, profile: toPublicProfile(b.profile), provider: provider(b.connection) })),
        };
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    );
}
