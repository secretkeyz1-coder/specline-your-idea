import { Elysia, t } from "elysia";
import { and, desc, eq, ne } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeProjectAccess, requireBrowserSession, requireScope } from "../../context.js";
import { listApiTokens, revokeApiToken, revokeMachineTokens, roleCanAdmin } from "@sdd/auth";
import { DomainError, errors } from "@sdd/shared";
import { disconnectMachine, nudgeAutoRunMachinesSoon } from "./gateway.js";
import { decideLinkModeFromApi, isAutoApprove, modeForAutoApprove } from "./link-policy.js";
import { audit } from "../audit/service.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { RegisterMachineSchema } from "@sdd/contracts";

/** Machine registration (T170, docs/09 §21). The WebSocket gateway itself is
 * mounted in index.ts via Elysia's .ws() at /api/v1/agent/connect. */

export function machineRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/agents/machines", tags: ["agents"] }).use(authPlugin(infra))
    .post(
      "/register",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        requireScope(principal, "machine:register");
        const body = RegisterMachineSchema.parse(ctx.body);
        const [existing] = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(and(eq(schema.localMachines.userId, principal.userId), eq(schema.localMachines.fingerprint, body.fingerprint)))
          .limit(1);
        if (existing) {
          // Re-registering must not un-revoke a machine an admin revoked.
          if (existing.status === "REVOKED") throw errors.forbidden("This machine was revoked and cannot re-register");
          const [updated] = await ctx.infra.db
            .update(schema.localMachines)
            .set({ name: body.name, platform: body.platform, capabilities: body.capabilities, lastSeenAt: new Date() })
            .where(and(eq(schema.localMachines.id, existing.id), ne(schema.localMachines.status, "REVOKED")))
            .returning();
          return { machine: updated };
        }
        const [machine] = await ctx.infra.db
          .insert(schema.localMachines)
          .values({
            userId: principal.userId,
            name: body.name,
            fingerprint: body.fingerprint,
            platform: body.platform,
            capabilities: body.capabilities,
            status: "OFFLINE",
            lastSeenAt: new Date(),
          })
          .returning();
        ctx.set.status = 201;
        return { machine };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          fingerprint: t.String({ minLength: 8, maxLength: 200 }),
          platform: t.String({ maxLength: 60 }),
          capabilities: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      },
    )

    .get(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const machines = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(eq(schema.localMachines.userId, principal.userId))
          .orderBy(desc(schema.localMachines.createdAt));
        return { machines };
      },
    )

    .post(
      "/:machineId/heartbeat",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [machine] = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(and(eq(schema.localMachines.id, ctx.params.machineId), eq(schema.localMachines.userId, principal.userId)))
          .limit(1);
        if (!machine) throw errors.notFound("Machine");
        if (machine.status === "REVOKED") throw errors.forbidden("Machine is revoked");
        const [updated] = await ctx.infra.db
          .update(schema.localMachines)
          .set({ lastSeenAt: new Date(), status: "ONLINE" })
          .where(and(eq(schema.localMachines.id, machine.id), ne(schema.localMachines.status, "REVOKED")))
          .returning();
        if (!updated) throw errors.forbidden("Machine is revoked");
        return { machine: updated };
      },
      { params: t.Object({ machineId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/:machineId/revoke",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const [machine] = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(and(eq(schema.localMachines.id, ctx.params.machineId), eq(schema.localMachines.userId, principal.userId)))
          .limit(1);
        if (!machine) throw errors.notFound("Machine");
        // Revocation is for humans: a stolen machine token must not manage machines.
        requireBrowserSession(principal, "Revoking a machine");
        const [updated] = await ctx.infra.db
          .update(schema.localMachines)
          .set({ status: "REVOKED" })
          .where(eq(schema.localMachines.id, machine.id))
          .returning();
        await ctx.infra.db.update(schema.repositoryLinks).set({ status: "REVOKED" }).where(eq(schema.repositoryLinks.machineId, machine.id));
        // Make it stick: kill machine-bound credentials and the live channel.
        const tokensRevoked = await revokeMachineTokens(ctx.infra.db, machine.id);
        const disconnected = disconnectMachine(machine.id);
        return { machine: updated, tokens_revoked: tokensRevoked, disconnected };
      },
      { params: t.Object({ machineId: t.String({ format: "uuid" }) }) },
    );

}

/** Personal access tokens: list + revoke (docs/13 — tokens must be revocable). */
export function apiTokenRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/auth/tokens", tags: ["auth"] }).use(authPlugin(infra))
    .get("/", async (ctx) => {
      const principal = ensurePrincipal(ctx);
      requireBrowserSession(principal, "Listing API tokens");
      const tokens = await listApiTokens(ctx.infra.db, principal.userId);
      return {
        tokens: tokens.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.tokenPrefix,
          scopes: row.scopes,
          workspace_id: row.workspaceId,
          project_id: row.projectId,
          machine_id: row.machineId,
          expires_at: row.expiresAt,
          revoked_at: row.revokedAt,
          last_used_at: row.lastUsedAt,
          created_at: row.createdAt,
        })),
      };
    })
    .post(
      "/:tokenId/revoke",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        // A token may always revoke itself (sddctl logout); anything else needs
        // the signed-in user.
        if (principal.tokenId !== ctx.params.tokenId) requireBrowserSession(principal, "Revoking another API token");
        const revoked = await revokeApiToken(ctx.infra.db, ctx.params.tokenId, principal.userId);
        if (!revoked) throw errors.notFound("Active API token", ctx.params.tokenId);
        return { ok: true };
      },
      { params: t.Object({ tokenId: t.String({ format: "uuid" }) }) },
    );
}

/** Repository links (server-verified project mapping, T122). */
export function repositoryLinkRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/agents/repo-links", tags: ["agents"] }).use(authPlugin(infra))
    .post(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const viaToken = principal.scopes !== null;
        const [machine] = await ctx.infra.db
          .select()
          .from(schema.localMachines)
          .where(and(eq(schema.localMachines.id, ctx.body.machine_id), eq(schema.localMachines.userId, principal.userId)))
          .limit(1);
        if (!machine || machine.status === "REVOKED") throw errors.notFound("Machine");
        // A machine-bound (pairing) token speaks only for its own machine.
        if (principal.tokenMachineId && principal.tokenMachineId !== machine.id) {
          throw errors.forbidden("This token is bound to another machine");
        }
        const access = await authorizeProjectAccess(ctx.infra.db, principal, ctx.body.project_id, { scope: "machine:register" });
        const project = access.project;
        const [existing] = await ctx.infra.db
          .select()
          .from(schema.repositoryLinks)
          .where(and(eq(schema.repositoryLinks.projectId, project.id), eq(schema.repositoryLinks.machineId, machine.id)))
          .limit(1);
        // Omitted = keep the current mode (MANUAL for a new link). Tokens may
        // create/keep a link or lower its mode, never set or raise AUTO_RUN:
        // auto-approve is a web-app decision by a project admin.
        const decision = decideLinkModeFromApi({
          viaToken,
          current: existing?.permissionMode ?? null,
          requested: ctx.body.permission_mode,
        });
        if (!decision.ok) throw new DomainError(decision.code, decision.message, 403);
        const mode = decision.mode;
        if (mode === "AUTO_RUN" && existing?.permissionMode !== "AUTO_RUN" && !access.canAdmin) {
          throw errors.forbidden("Only a project admin can turn on auto-approve for a repository");
        }
        const previousMode = existing?.permissionMode ?? null;
        let link: typeof schema.repositoryLinks.$inferSelect | undefined;
        if (existing) {
          [link] = await ctx.infra.db
            .update(schema.repositoryLinks)
            .set({
              repoFingerprint: ctx.body.repo_fingerprint,
              displayPath: ctx.body.display_path,
              defaultBranch: ctx.body.default_branch ?? null,
              status: "ACTIVE",
              ...(mode ? { permissionMode: mode } : {}),
            })
            .where(eq(schema.repositoryLinks.id, existing.id))
            .returning();
        } else {
          [link] = await ctx.infra.db
            .insert(schema.repositoryLinks)
            .values({
              projectId: project.id,
              machineId: machine.id,
              repoFingerprint: ctx.body.repo_fingerprint,
              displayPath: ctx.body.display_path,
              defaultBranch: ctx.body.default_branch ?? null,
              ...(mode ? { permissionMode: mode } : {}),
            })
            .returning();
          ctx.set.status = 201;
        }
        if (link && previousMode !== null && previousMode !== link.permissionMode) {
          await audit(ctx.infra.db, {
            workspaceId: project.workspaceId,
            projectId: project.id,
            actorType: viaToken ? "LOCAL_AGENT" : "USER",
            actorId: principal.userId,
            source: principal.source,
            action: "repository_link.permission_changed",
            entityType: "REPOSITORY_LINK",
            entityId: link.id,
            metadata: { machine_id: machine.id, from: previousMode, to: link.permissionMode },
          });
        }
        return { link };
      },
      {
        body: t.Object({
          machine_id: t.String({ format: "uuid" }),
          project_id: t.String({ format: "uuid" }),
          repo_fingerprint: t.String({ minLength: 8, maxLength: 200 }),
          display_path: t.String({ maxLength: 300 }),
          default_branch: t.Optional(t.String({ maxLength: 120 })),
          permission_mode: t.Optional(t.Union([t.Literal("MANUAL"), t.Literal("ASSISTED"), t.Literal("AUTO_RUN")])),
        }),
      },
    )

    // The two-option control on the Machines page: "Auto-approve runs whose
    // required checks pass" (AUTO_RUN) vs "Human review" (MANUAL). Turning it on
    // removes the human reviewer, so only a project admin in a browser may
    // change it, and every change is audited.
    .patch(
      "/:linkId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        requireBrowserSession(principal, "Changing a repository's approval mode");
        const [link] = await ctx.infra.db.select().from(schema.repositoryLinks).where(eq(schema.repositoryLinks.id, ctx.params.linkId)).limit(1);
        if (!link) throw errors.notFound("Repository link", ctx.params.linkId);
        const { project } = await authorizeProjectAccess(ctx.infra.db, principal, link.projectId, { admin: true });
        if (link.status !== "ACTIVE") throw errors.conflict("LINK_REVOKED", "This repository link was revoked with its machine");
        const hasFlag = ctx.body.auto_approve !== undefined;
        const hasMode = ctx.body.permission_mode !== undefined;
        if (hasFlag === hasMode) throw errors.validation("Send exactly one of auto_approve or permission_mode");
        const next = ctx.body.permission_mode ?? modeForAutoApprove(ctx.body.auto_approve === true, link.permissionMode);
        if (next === link.permissionMode) return { link, changed: false };
        const [updated] = await ctx.infra.db
          .update(schema.repositoryLinks)
          .set({ permissionMode: next })
          .where(and(eq(schema.repositoryLinks.id, link.id), eq(schema.repositoryLinks.status, "ACTIVE")))
          .returning();
        if (!updated) throw errors.conflict("LINK_REVOKED", "This repository link was revoked with its machine");
        await audit(ctx.infra.db, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorType: "USER",
          actorId: principal.userId,
          source: "WEB",
          action: "repository_link.permission_changed",
          entityType: "REPOSITORY_LINK",
          entityId: link.id,
          metadata: { machine_id: link.machineId, from: link.permissionMode, to: next, auto_approve: isAutoApprove(next) },
        });
        // A link that just started auto-approving can take READY work right away.
        if (isAutoApprove(next)) nudgeAutoRunMachinesSoon(ctx.infra.db, project.id);
        return { link: updated, changed: true };
      },
      {
        params: t.Object({ linkId: t.String({ format: "uuid" }) }),
        body: t.Object({
          auto_approve: t.Optional(t.Boolean()),
          permission_mode: t.Optional(t.Union([t.Literal("MANUAL"), t.Literal("ASSISTED"), t.Literal("AUTO_RUN")])),
        }),
      },
    )

    .get(
      "/",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const projectId = ctx.query.project_id;
        if (projectId) {
          await authorizeProjectAccess(ctx.infra.db, principal, projectId, { scope: "project:read" });
          const links = await ctx.infra.db
            .select({ link: schema.repositoryLinks, machine: schema.localMachines })
            .from(schema.repositoryLinks)
            .innerJoin(schema.localMachines, eq(schema.localMachines.id, schema.repositoryLinks.machineId))
            .where(eq(schema.repositoryLinks.projectId, projectId));
          return { links };
        }
        // Every link of every machine the caller owns (the Machines page), and
        // whether this caller may change its approval mode.
        const conditions = [eq(schema.localMachines.userId, principal.userId)];
        if (principal.tokenProjectId) conditions.push(eq(schema.repositoryLinks.projectId, principal.tokenProjectId));
        if (principal.tokenWorkspaceId) conditions.push(eq(schema.projects.workspaceId, principal.tokenWorkspaceId));
        const rows = await ctx.infra.db
          .select({
            link: schema.repositoryLinks,
            machine: schema.localMachines,
            project: { id: schema.projects.id, key: schema.projects.key, name: schema.projects.name, workspaceId: schema.projects.workspaceId },
          })
          .from(schema.repositoryLinks)
          .innerJoin(schema.localMachines, eq(schema.localMachines.id, schema.repositoryLinks.machineId))
          .innerJoin(schema.projects, eq(schema.projects.id, schema.repositoryLinks.projectId))
          .where(and(...conditions))
          .orderBy(desc(schema.repositoryLinks.createdAt));
        const roles = await ctx.infra.db
          .select({ workspaceId: schema.workspaceMembers.workspaceId, role: schema.workspaceMembers.role })
          .from(schema.workspaceMembers)
          .where(eq(schema.workspaceMembers.userId, principal.userId));
        const roleOf = new Map(roles.map((r) => [r.workspaceId, r.role]));
        const links = rows
          // Membership can lapse after linking; such projects are no longer the caller's to see.
          .filter((row) => roleOf.has(row.project.workspaceId))
          .map((row) => ({
            ...row,
            auto_approve: isAutoApprove(row.link.permissionMode),
            can_change_mode: principal.scopes === null && roleCanAdmin(roleOf.get(row.project.workspaceId) ?? null),
          }));
        return { links };
      },
      { query: t.Object({ project_id: t.Optional(t.String({ format: "uuid" })) }) },
    );
}
