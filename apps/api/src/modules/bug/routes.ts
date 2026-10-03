import { Elysia, t } from "elysia";
import { CreateBugSchema } from "@sdd/contracts";
import { authorizeProjectAccess, type Principal } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { createBug, getBug, listBugs, linksOfBug, transitionBug, generateFixTask } from "./service.js";

/** Bug REST endpoints (T159, docs/09 §17). */

/** Who is acting: a browser user, or an agent through a CLI/MCP/machine token. */
function bugActor(principal: Principal): { actor: { type: "USER" | "LOCAL_AGENT" | "MCP"; id: string }; viaToken: boolean; source: Principal["source"] } {
  const viaToken = principal.scopes !== null;
  return {
    actor: { type: !viaToken ? "USER" : principal.source === "MCP" ? "MCP" : "LOCAL_AGENT", id: principal.userId },
    viaToken,
    source: principal.source,
  };
}

export function bugRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["bugs"] }).use(authPlugin(infra))
    .post(
      "/projects/:projectId/bugs",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "bug:write" });
        const bug = await createBug(ctx.infra.db, {
          projectId: ctx.params.projectId,
          body: CreateBugSchema.parse(ctx.body),
          actor: bugActor(principal).actor,
        });
        return { bug };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          title: t.String({ minLength: 1, maxLength: 200 }),
          severity: t.Optional(t.Union([t.Literal("BLOCKER"), t.Literal("CRITICAL"), t.Literal("MAJOR"), t.Literal("MINOR"), t.Literal("TRIVIAL")])),
          current_behavior: t.String({ minLength: 1, maxLength: 4000 }),
          expected_behavior: t.String({ minLength: 1, maxLength: 4000 }),
          unchanged_behavior: t.Optional(t.String({ maxLength: 4000 })),
          reproduction: t.String({ minLength: 1, maxLength: 4000 }),
          feature_id: t.Optional(t.String({ format: "uuid" })),
          task_id: t.Optional(t.String({ format: "uuid" })),
          run_id: t.Optional(t.String({ format: "uuid" })),
        }),
      },
    )

    .get(
      "/projects/:projectId/bugs",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "project:read" });
        return { bugs: await listBugs(ctx.infra.db, ctx.params.projectId, ctx.query.open === "true") };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        query: t.Object({ open: t.Optional(t.String()) }),
      },
    )

    .get(
      "/bugs/:bugId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const bug = await getBug(ctx.infra.db, ctx.params.bugId);
        await authorizeProjectAccess(ctx.infra.db, principal, bug.projectId, { scope: "project:read" });
        return { bug, links: await linksOfBug(ctx.infra.db, bug.id) };
      },
      { params: t.Object({ bugId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/bugs/:bugId/confirm",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const bug = await getBug(ctx.infra.db, ctx.params.bugId);
        await authorizeProjectAccess(ctx.infra.db, principal, bug.projectId, { write: true, scope: "bug:write" });
        return { bug: await transitionBug(ctx.infra.db, { bugId: bug.id, to: "CONFIRMED", note: ctx.body.note ?? "", ...bugActor(principal) }) };
      },
      {
        params: t.Object({ bugId: t.String({ format: "uuid" }) }),
        body: t.Object({ note: t.Optional(t.String({ maxLength: 1000 })) }),
      },
    )

    .post(
      "/bugs/:bugId/transition",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const bug = await getBug(ctx.infra.db, ctx.params.bugId);
        await authorizeProjectAccess(ctx.infra.db, principal, bug.projectId, { write: true, scope: "bug:write" });
        // Tokens (CLI/MCP/machine) may move a bug through the reporting and
        // fixing states only; closing decisions need a person in the browser.
        return { bug: await transitionBug(ctx.infra.db, { bugId: bug.id, to: ctx.body.status, note: ctx.body.note ?? "", ...bugActor(principal) }) };
      },
      {
        params: t.Object({ bugId: t.String({ format: "uuid" }) }),
        body: t.Object({
          status: t.Union([
            t.Literal("ASSESSING"), t.Literal("CONFIRMED"), t.Literal("PLANNED"), t.Literal("IN_FIX"), t.Literal("VERIFYING"),
            t.Literal("VERIFIED"), t.Literal("CLOSED"), t.Literal("NOT_A_BUG"), t.Literal("DUPLICATE"), t.Literal("WONT_FIX"),
          ]),
          note: t.Optional(t.String({ maxLength: 1000 })),
        }),
      },
    )

    .post(
      "/bugs/:bugId/generate-fix-tasks",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const bug = await getBug(ctx.infra.db, ctx.params.bugId);
        await authorizeProjectAccess(ctx.infra.db, principal, bug.projectId, { write: true, scope: "bug:write" });
        return generateFixTask(ctx.infra.db, { bugId: bug.id, userId: principal.userId, source: principal.source });
      },
      { params: t.Object({ bugId: t.String({ format: "uuid" }) }) },
    );
}
