import { Elysia, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { exportProjectMarkdown, exportTaskWorkOrder, exportAgentsMd, exportBundle } from "./service.js";
import { listNotifications, markRead, unreadCount } from "../notification/service.js";

/** Export + activity + notifications routes (T201–T204, T193). */

export function exportRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["export"] }).use(authPlugin(infra))
    .get(
      "/projects/:projectId/export/markdown",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        const markdown = await exportProjectMarkdown(ctx.infra.db, ctx.params.projectId);
        ctx.set.headers["content-type"] = "text/markdown; charset=utf-8";
        ctx.set.headers["content-disposition"] = `attachment; filename="project.md"`;
        return markdown;
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/tasks/:taskId/export/work-order",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const { getTask } = await import("../task/repo.js");
        const task = await getTask(ctx.infra.db, ctx.params.taskId);
        await authorizeProjectAccess(ctx.infra.db, principal, task.projectId, { scope: "task:read" });
        const { json, markdown } = await exportTaskWorkOrder(ctx.infra.db, task.id);
        if (ctx.query.format === "markdown") {
          ctx.set.headers["content-type"] = "text/markdown; charset=utf-8";
          return markdown;
        }
        ctx.set.headers["content-type"] = "application/json";
        return json;
      },
      {
        params: t.Object({ taskId: t.String({ format: "uuid" }) }),
        query: t.Object({ format: t.Optional(t.String()) }),
      },
    )

    .get(
      "/projects/:projectId/export/agents-md",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        ctx.set.headers["content-type"] = "text/markdown; charset=utf-8";
        return exportAgentsMd(ctx.infra.db, ctx.params.projectId);
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/projects/:projectId/export/bundle",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        const bundle = await exportBundle(ctx.infra.db, ctx.params.projectId);
        ctx.set.headers["content-type"] = "application/json";
        return bundle;
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    );
}

export function activityRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["activity"] }).use(authPlugin(infra))
    .get(
      "/projects/:projectId/activity",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        const events = await ctx.infra.db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.projectId, ctx.params.projectId))
          .orderBy(desc(schema.auditEvents.occurredAt))
          .limit(Math.trunc(ctx.query.limit ?? 100));
        return { events };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        // Bounded: an unchecked limit let one request pull the whole audit log.
        query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })) }),
      },
    )

    .get(
      "/notifications",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        return {
          notifications: await listNotifications(ctx.infra.db, principal.userId),
          unread: await unreadCount(ctx.infra.db, principal.userId),
        };
      },
    )

    .post(
      "/notifications/:notificationId/read",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await markRead(ctx.infra.db, principal.userId, ctx.params.notificationId);
        return { ok: true };
      },
      { params: t.Object({ notificationId: t.String({ format: "uuid" }) }) },
    );
}
