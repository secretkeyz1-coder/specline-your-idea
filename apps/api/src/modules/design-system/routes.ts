import { Elysia, t } from "elysia";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { DesignSystemSpecSchema } from "@sdd/contracts";
import { runStructured } from "@sdd/ai";
import { getProject } from "../project/service.js";
import { catalog, exportDesignSystem, getDesignSystemState, renderPackage, renderPreview, saveDesignSystemDraft } from "./service.js";
import { importDesignSystem, MAX_IMPORT_CHARS } from "./import.js";

const importBody = t.Object({
  text: t.String({ minLength: 1, maxLength: MAX_IMPORT_CHARS + 1000 }),
  base_preset_id: t.Optional(t.String({ maxLength: 60 })),
  component_library: t.Optional(t.String({ maxLength: 40 })),
});

/** Design system: preset catalog, live preview, the project's draft/approved spec and its export. */
export const designSystemRoutes = (infra: Infra) =>
  new Elysia({ prefix: "/api/v1", tags: ["design-system"] })
    .use(authPlugin(infra))

    .get("/design-systems/catalog", (ctx) => {
      ensurePrincipal(ctx);
      return catalog();
    })

    // Pure rendering — nothing is stored; the picker calls it as the person adjusts values.
    .post(
      "/design-systems/preview",
      (ctx) => {
        ensurePrincipal(ctx);
        return renderPreview(ctx.body.spec, ctx.body.mode ?? "light");
      },
      { body: t.Object({ spec: t.Unknown(), mode: t.Optional(t.Union([t.Literal("light"), t.Literal("dark")])) }) },
    )

    // The open-design package for a spec, as the coding agent and the UI-reference generator get it — nothing is stored.
    .post(
      "/design-systems/package",
      (ctx) => {
        ensurePrincipal(ctx);
        return renderPackage(ctx.body.spec);
      },
      {
        body: t.Object({ spec: t.Unknown() }),
        detail: { summary: "The design-system package for a spec: USAGE.md, DESIGN.md, tokens.css (open-design token contract), design-tokens.json and craft references; nothing is stored" },
      },
    )

    // Bring your own: tokens only (no AI) — nothing is stored.
    .post(
      "/design-systems/import",
      (ctx) => {
        ensurePrincipal(ctx);
        return importDesignSystem(ctx.body);
      },
      {
        body: importBody,
        detail: { summary: "Read a pasted design system (CSS variables, theme, tokens JSON) into a complete spec; tokens only, nothing is stored" },
      },
    )

    .get(
      "/projects/:projectId/design-system",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "artifact:read" });
        return getDesignSystemState(ctx.infra.db, ctx.params.projectId);
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/projects/:projectId/design-system",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return saveDesignSystemDraft(ctx.infra.db, { projectId: ctx.params.projectId, userId: principal.userId, spec: ctx.body.spec });
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }), body: t.Object({ spec: t.Unknown() }) },
    )

    // Bring your own, for a project: prose and DESIGN.md text are read by the
    // project's AI (the ARCHITECTURE role, like the technical design). Nothing
    // is stored; the editor saves a draft through the route above.
    .post(
      "/projects/:projectId/design-system/import",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        const project = await getProject(ctx.infra.db, ctx.params.projectId);
        return importDesignSystem(ctx.body, async ({ system, user }) => {
          const result = await runStructured(ctx.infra.gateway(), {
            workspaceId: project.workspaceId,
            projectId: project.id,
            role: "ARCHITECTURE",
            schema: DesignSystemSpecSchema,
            schemaName: "DesignSystemSpec",
            system,
            messages: [{ role: "user", content: user }],
          });
          return result.data;
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: importBody,
        detail: { summary: "Read a pasted design system (tokens, theme, DESIGN.md or a description) into a complete spec; nothing is stored" },
      },
    )

    .get(
      "/projects/:projectId/design-system/export",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "artifact:read" });
        return exportDesignSystem(ctx.infra.db, ctx.params.projectId);
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    );
