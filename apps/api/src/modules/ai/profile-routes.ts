import { Elysia, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeWorkspaceAccess } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { createProfile, deleteProfile, profileUsages, updateProfile, toPublicProfile } from "@sdd/ai";
import { audit, type AuditSource } from "../audit/service.js";
import { authorizeProfile } from "./access.js";

/** AI profiles: a model on a connection — create, list, edit, delete. */

export function aiProfileRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["ai"] }).use(authPlugin(infra))

    .post(
      "/workspaces/:workspaceId/ai/profiles",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { admin: true, scope: "ai:manage" });
        const profile = await createProfile(ctx.infra.db, {
          name: ctx.body.name,
          provider_connection_id: ctx.body.provider_connection_id,
          model_id: ctx.body.model_id,
          parameters: (ctx.body.parameters ?? {}) as Record<string, unknown>,
          required_capabilities: (ctx.body.required_capabilities ?? []) as never,
          scopeType: "WORKSPACE",
          workspaceId: ctx.params.workspaceId,
        });
        return { profile: toPublicProfile(profile) };
      },
      {
        params: t.Object({ workspaceId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          provider_connection_id: t.String({ format: "uuid" }),
          model_id: t.String({ minLength: 1, maxLength: 200 }),
          parameters: t.Optional(t.Record(t.String(), t.Unknown())),
          required_capabilities: t.Optional(t.Array(t.Union([t.Literal("structured_output"), t.Literal("tool_calling"), t.Literal("vision"), t.Literal("streaming")]), { maxItems: 4 })),
        }),
      },
    )

    .get(
      "/workspaces/:workspaceId/ai/profiles",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId);
        const profiles = await ctx.infra.db
          .select()
          .from(schema.aiProfiles)
          .where(eq(schema.aiProfiles.workspaceId, ctx.params.workspaceId))
          .orderBy(desc(schema.aiProfiles.createdAt));
        const usage = await profileUsages(ctx.infra.db, profiles.map((p) => p.id));
        return {
          profiles: profiles.map((p) => ({
            ...toPublicProfile(p),
            usage: { bindings: usage.get(p.id)!.map((b) => ({ role: b.role, scope: b.scope, project_id: b.project_id })) },
          })),
        };
      },
      { params: t.Object({ workspaceId: t.String({ format: "uuid" }) }) },
    )

    .patch(
      "/ai/profiles/:profileId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const profile = await authorizeProfile(ctx.infra, principal, ctx.params.profileId);
        const updated = await updateProfile(ctx.infra.db, profile.id, {
          name: ctx.body.name,
          model_id: ctx.body.model_id,
          parameters: ctx.body.parameters as Record<string, unknown> | undefined,
          status: ctx.body.status,
        });
        if (profile.workspaceId) {
          await audit(ctx.infra.db, {
            workspaceId: profile.workspaceId,
            actorType: "USER",
            actorId: principal.userId,
            source: principal.source as AuditSource,
            action: "ai.profile.updated",
            entityType: "AI_PROFILE",
            entityId: profile.id,
            metadata: { name: updated.name, fields: Object.keys(ctx.body), model_id: updated.modelId, previous_model_id: profile.modelId },
          });
        }
        return { profile: toPublicProfile(updated) };
      },
      {
        params: t.Object({ profileId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
          model_id: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
          parameters: t.Optional(t.Record(t.String(), t.Unknown())),
          status: t.Optional(t.Union([t.Literal("ACTIVE"), t.Literal("DISABLED")])),
        }),
      },
    )

    .delete(
      "/ai/profiles/:profileId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const profile = await authorizeProfile(ctx.infra, principal, ctx.params.profileId);
        await deleteProfile(ctx.infra.db, profile.id);
        if (profile.workspaceId) {
          await audit(ctx.infra.db, {
            workspaceId: profile.workspaceId,
            actorType: "USER",
            actorId: principal.userId,
            source: principal.source as AuditSource,
            action: "ai.profile.deleted",
            entityType: "AI_PROFILE",
            entityId: profile.id,
            metadata: { name: profile.name, model_id: profile.modelId },
          });
        }
        return { deleted: true };
      },
      { params: t.Object({ profileId: t.String({ format: "uuid" }) }) },
    );
}
