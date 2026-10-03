import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeProjectAccess, authorizeWorkspaceAccess, principalCan } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { errors } from "@sdd/shared";
import { aiProviderRoutes } from "./provider-routes.js";
import { aiProfileRoutes } from "./profile-routes.js";
import { aiBindingRoutes } from "./binding-routes.js";

/**
 * AI provider/profile/role-binding APIs (T029/T032, docs/09 §19), and generation
 * runs. Each group carries its own /api/v1 prefix: the wrapper adds none, or
 * the paths would carry it twice.
 */
export function aiRoutes(infra: Infra) {
  return new Elysia().use(aiProviderRoutes(infra)).use(aiProfileRoutes(infra)).use(aiBindingRoutes(infra)).use(generationRunRoutes(infra));
}

/** One AI generation run, for the project or workspace it belongs to. */
function generationRunRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["ai"] }).use(authPlugin(infra))

    .get(
      "/ai/generation-runs/:generationRunId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        // A token must carry a read scope for what a run belongs to.
        if (!principalCan(principal, "project:read") && !principalCan(principal, "artifact:read")) {
          throw errors.forbidden("Missing required scope: project:read or artifact:read", { scope: "project:read" });
        }
        const [run] = await ctx.infra.db.select().from(schema.aiGenerationRuns).where(eq(schema.aiGenerationRuns.id, ctx.params.generationRunId)).limit(1);
        if (!run) throw errors.notFound("Generation run");
        if (run.projectId) {
          // Enforces a project-narrowed token's project, like every project route.
          await authorizeProjectAccess(ctx.infra.db, principal, run.projectId);
        } else {
          if (principal.tokenProjectId) throw errors.forbidden("Token is not valid for workspace-level generation runs");
          await authorizeWorkspaceAccess(ctx.infra.db, principal, run.workspaceId);
        }
        return { run };
      },
      { params: t.Object({ generationRunId: t.String({ format: "uuid" }) }) },
    );
}
