import { Elysia, t } from "elysia";
import { LayoutReferenceSchema, MAX_UX_SCREENS, UxPlatformSchema, type LayoutReference, type UxPlatform } from "@sdd/contracts";
import { DomainError, errors } from "@sdd/shared";
import { authorizeProjectAccess } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { analyseLayoutReference, LAYOUT_INPUT_MAX, setLayoutReference } from "./ux-layout.js";
import { reviewUxScreen } from "./ux-review.js";

/** A layout reference as sent back by the page: checked against the contract, never trusted as is. */
/** A platform the web sent (plan, change look), checked against the contract. */
function platformFrom(value: unknown): UxPlatform {
  const parsed = UxPlatformSchema.safeParse(value);
  if (!parsed.success) throw errors.validation("That platform is not valid — choose web or Android, and at least one device");
  return parsed.data;
}

function layoutReferenceOf(value: unknown): LayoutReference {
  const parsed = LayoutReferenceSchema.safeParse(value);
  if (!parsed.success) throw errors.validation("That layout reference is not valid — analyse the page again");
  return parsed.data;
}
import {
  addUxComment,
  addUxScreen,
  generateUxScreen,
  getUxState,
  getUxSummary,
  removeUxScreen,
  confirmUxScope,
  saveUxScreenContent,
  startUxDraft,
  undoUxScreen,
  restoreUxScreen,
  checkUxScreen,
  clearUxScreen,
  editUxElement,
  restyleUxReference,
  setUxBrief,
  updateUxComment,
} from "./ux.js";

/** UI reference REST endpoints: the draft, its screens, canvas edits, comments and the scope confirmation. */

export function uxRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["ux"] }).use(authPlugin(infra))

    /* ── UI reference (optional, after the design) ── */
    .get(
      "/projects/:projectId/ux",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "artifact:read" });
        return getUxState(ctx.infra.db, ctx.params.projectId);
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }) }) },
    )

    .get(
      "/projects/:projectId/ux/summary",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { scope: "artifact:read" });
        return getUxSummary(ctx.infra.db, ctx.params.projectId);
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        detail: { summary: "The approved version, whether it applies, its screen count and whether a draft is open — without the screens' drawings" },
      },
    )

    .post(
      "/projects/:projectId/ux/plan",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        const mode = ctx.body?.mode ?? "plan";
        if (mode === "plan") await rateLimit(ctx.infra, "AI", `ux:${principal.userId}`);
        return startUxDraft(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          mode,
          screenCount: ctx.body?.screen_count ?? null,
          guidance: ctx.body?.guidance,
          fidelity: ctx.body?.fidelity,
          layoutReference: ctx.body?.layout_reference ? layoutReferenceOf(ctx.body.layout_reference) : null,
          platform: ctx.body?.platform ? platformFrom(ctx.body.platform) : null,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Optional(
          t.Object({
            mode: t.Optional(t.Union([t.Literal("plan"), t.Literal("revise")])),
            /** Exactly this many screens; omitted or null lets the AI recommend the number. */
            screen_count: t.Optional(t.Union([t.Integer({ minimum: 1, maximum: MAX_UX_SCREENS }), t.Null()])),
            guidance: t.Optional(t.String({ maxLength: 1000 })),
            /** "styled" draws the screens with the approved design system. */
            fidelity: t.Optional(t.Union([t.Literal("neutral"), t.Literal("styled")])),
            /** An analysed layout reference (from …/ux/layout-reference/analyse) every screen follows. */
            layout_reference: t.Optional(t.Any()),
            /** Web app or Android app and its devices (UxPlatform); omitted: what the stack and requirements suggest. */
            platform: t.Optional(t.Any()),
          }),
        ),
      },
    )

    .post(
      "/projects/:projectId/ux/layout-reference/analyse",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux:${principal.userId}`);
          return { reference: await analyseLayoutReference(ctx.infra.gateway(), ctx.infra.db, { projectId: ctx.params.projectId, html: ctx.body.html, name: ctx.body.name, mode: ctx.body.mode }) };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          /** The page's HTML; read up to LAYOUT_INPUT_MAX characters, text and scripts removed before the AI sees it. */
          html: t.String({ minLength: 1, maxLength: LAYOUT_INPUT_MAX * 2 }),
            name: t.Optional(t.String({ maxLength: 80 })),
            mode: t.Optional(t.Union([t.Literal("layout"), t.Literal("adapt")])),
        }),
        detail: { summary: "Read a page's layout (regions, grid, density, patterns) into a layout reference — not stored; the page's text never reaches the AI" },
      },
    )

    .put(
      "/projects/:projectId/ux/brief",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return setUxBrief(ctx.infra.db, { projectId: ctx.params.projectId, brief: ctx.body.brief, base: ctx.body.base });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          /** users, devices, direction, hierarchy, references (strings) and assumptions (strings); stored with source "user". */
          brief: t.Any(),
          /** The brief's digest as the page saw it (the `base` a previous answer returned); omitted = not checked. */
          base: t.Optional(t.String({ maxLength: 80 })),
        }),
        detail: { summary: "Write the draft's product brief (users, devices, visual direction, hierarchy, references); every draw, redraw, AI edit and the next plan carry it" },
      },
    )

    .put(
      "/projects/:projectId/ux/layout-reference",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return setLayoutReference(ctx.infra.db, {
          projectId: ctx.params.projectId,
          reference: layoutReferenceOf(ctx.body.reference),
          screenKey: ctx.body.screen_key,
          base: ctx.body.base,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          reference: t.Any(),
          /** One screen's own reference; omitted = every screen. */
          screen_key: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
          base: t.Optional(t.String({ maxLength: 80 })),
        }),
        detail: { summary: "Use a layout reference for every screen of the draft, or for one screen; drawings stay and show as out of date until redrawn" },
      },
    )

    .delete(
      "/projects/:projectId/ux/layout-reference",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return setLayoutReference(ctx.infra.db, { projectId: ctx.params.projectId, reference: null, screenKey: ctx.query.screen_key, base: ctx.query.base });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        query: t.Object({ screen_key: t.Optional(t.String({ minLength: 1, maxLength: 60 })), base: t.Optional(t.String({ maxLength: 80 })) }),
        detail: { summary: "Stop using the draft's layout reference (or one screen's own)" },
      },
    )

    .post(
      "/projects/:projectId/ux/look",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return restyleUxReference(ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          fidelity: ctx.body.fidelity,
          platform: ctx.body.platform ? platformFrom(ctx.body.platform) : null,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          fidelity: t.Union([t.Literal("neutral"), t.Literal("styled")]),
          /** Draw them as another platform too (UxPlatform): a web app as an Android app, or back. */
          platform: t.Optional(t.Any()),
        }),
        detail: { summary: "Keep the planned screens and draw them again with another look or platform (a new draft; every drawing is cleared onto its undo history)" },
      },
    )

    .post(
      "/projects/:projectId/ux/screens",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return addUxScreen(ctx.infra.db, {
          projectId: ctx.params.projectId,
          name: ctx.body.name,
          purpose: ctx.body.purpose ?? "",
          keyElements: ctx.body.key_elements ?? [],
          requirementKeys: ctx.body.requirement_keys ?? [],
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 80 }),
          purpose: t.Optional(t.String({ maxLength: 400 })),
          key_elements: t.Optional(t.Array(t.String({ maxLength: 160 }), { maxItems: 12 })),
          requirement_keys: t.Optional(t.Array(t.String({ maxLength: 32 }), { maxItems: 10 })),
        }),
      },
    )

    .delete(
      "/projects/:projectId/ux/screens/:screenKey",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return removeUxScreen(ctx.infra.db, { projectId: ctx.params.projectId, screenKey: ctx.params.screenKey });
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }) },
    )

    .post(
      "/projects/:projectId/ux/confirm-scope",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return confirmUxScope(ctx.infra.db, { projectId: ctx.params.projectId });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        detail: { summary: "Accept the scope the UI reference plan leaves out (requested count or screen limit); approval needs it" },
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/generate",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux:${principal.userId}`);
        return generateUxScreen(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          screenKey: ctx.params.screenKey,
          instruction: ctx.body?.instruction?.trim() || undefined,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Optional(t.Object({ instruction: t.Optional(t.String({ maxLength: 2000 })) })),
      },
    )

    /* The same drawing with a live preview: server-sent events carry the
     * screen's frame, its content so far (sanitized) and the checking phase,
     * then `done` (the stored draft has the screen) or `error`. Refusals
     * (access, rate limit) answer before the stream opens, as JSON. */
    .post(
      "/projects/:projectId/ux/screens/:screenKey/generate-stream",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux:${principal.userId}`);
        const encoder = new TextEncoder();
        const input = {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          screenKey: ctx.params.screenKey,
          instruction: ctx.body?.instruction?.trim() || undefined,
        };
        const stream = new ReadableStream({
          start(controller) {
            let open = true;
            const send = (event: string, data: unknown) => {
              if (!open) return;
              try {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
              } catch {
                open = false;
              }
            };
            // Providers that do not stream stay quiet for minutes: keep the connection alive.
            const heartbeat = setInterval(() => {
              if (!open) return;
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                open = false;
              }
            }, 15_000);
            // The page going away does not stop the drawing: it is stored for the next visit.
            ctx.request.signal?.addEventListener("abort", () => {
              open = false;
            });
            void generateUxScreen(ctx.infra.gateway(), ctx.infra.db, { ...input, onPreview: (e) => send(e.type, e) })
              .then(() => send("done", { ok: true }))
              .catch((error: unknown) => {
                if (!(error instanceof DomainError)) {
                  ctx.infra.logger.error("ux screen stream failed", { screenKey: input.screenKey, error: error instanceof Error ? error.message : String(error) });
                }
                send("error", error instanceof DomainError ? { code: error.code, message: error.message } : { code: "INTERNAL", message: "The screen could not be generated. Try again." });
              })
              .finally(() => {
                clearInterval(heartbeat);
                if (open) {
                  open = false;
                  try {
                    controller.close();
                  } catch {
                    /* already closed */
                  }
                }
              });
          },
        });
        ctx.set.headers["content-type"] = "text/event-stream";
        ctx.set.headers["cache-control"] = "no-cache";
        ctx.set.headers["connection"] = "keep-alive";
        return stream;
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Optional(t.Object({ instruction: t.Optional(t.String({ maxLength: 2000 })) })),
      },
    )

    /* ── Canvas edits: saved content, undo, comments pinned to elements ──
     * No AI call, but each save, undo, restore and check renders the screen in
     * two browser contexts: they share a per-user bucket of their own
     * (`ux-edit:`, sized like the AI one) so a script cannot spin Chromium up
     * without limit, and editing never eats into the AI budget. */
    .post(
      "/projects/:projectId/ux/screens/:screenKey/content",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux-edit:${principal.userId}`);
        return saveUxScreenContent(ctx.infra.db, {
          projectId: ctx.params.projectId,
          screenKey: ctx.params.screenKey,
          content: ctx.body.content,
          note: ctx.body.note,
          base: ctx.body.base,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Object({
          content: t.String({ minLength: 1, maxLength: 150_000 }),
          note: t.Optional(t.String({ maxLength: 160 })),
          /** The screen version the canvas edited (history marker); a newer screen answers 409 UX_SCREEN_CHANGED. */
          base: t.Optional(t.String({ maxLength: 80 })),
        }),
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/undo",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux-edit:${principal.userId}`);
        return undoUxScreen(ctx.infra.db, { projectId: ctx.params.projectId, screenKey: ctx.params.screenKey, base: ctx.body?.base });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Optional(t.Object({ base: t.Optional(t.String({ maxLength: 80 })) })),
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/element",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux:${principal.userId}`);
        return editUxElement(ctx.infra.gateway(), ctx.infra.db, {
          projectId: ctx.params.projectId,
          userId: principal.userId,
          screenKey: ctx.params.screenKey,
          nid: ctx.body.nid,
          instruction: ctx.body.instruction,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Object({ nid: t.String({ pattern: "^n[0-9]{1,6}$" }), instruction: t.String({ minLength: 3, maxLength: 2000 }) }),
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/restore",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux-edit:${principal.userId}`);
        return restoreUxScreen(ctx.infra.db, {
          projectId: ctx.params.projectId,
          screenKey: ctx.params.screenKey,
          index: ctx.body.index,
          at: ctx.body.at,
          base: ctx.body.base,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Object({
          /** The version's time (history[].at); the index alone is accepted from older clients. */
          at: t.Optional(t.String({ maxLength: 40 })),
          index: t.Optional(t.Integer({ minimum: 0, maximum: 9 })),
          base: t.Optional(t.String({ maxLength: 80 })),
        }),
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/clear",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return clearUxScreen(ctx.infra.db, { projectId: ctx.params.projectId, screenKey: ctx.params.screenKey, base: ctx.body?.base });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Optional(t.Object({ base: t.Optional(t.String({ maxLength: 80 })) })),
        detail: { summary: "Clear a screen's drawing and keep its plan, so it can be drawn again (the drawing stays on its undo history)" },
      },
    )

    .put(
      "/projects/:projectId/ux/screens/:screenKey/review",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        return reviewUxScreen(ctx.infra.db, { projectId: ctx.params.projectId, screenKey: ctx.params.screenKey, aspects: ctx.body.aspects, base: ctx.body.base });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Object({
          aspects: t.Array(
            t.Object({
              aspect: t.Union([t.Literal("focus"), t.Literal("composition"), t.Literal("hierarchy"), t.Literal("product_fit"), t.Literal("devices")]),
              status: t.Union([t.Literal("ok"), t.Literal("revise"), t.Literal("unchecked")]),
              element: t.Optional(t.String({ maxLength: 200 })),
              change: t.Optional(t.String({ maxLength: 500 })),
            }),
            { maxItems: 5 },
          ),
          base: t.Optional(t.String({ maxLength: 80 })),
        }),
        detail: { summary: "Record a person's visual review of a drawn screen (aturan.md §5.6): five aspects, each fits / needs revision / not checked — never a blocker or a score" },
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/check",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux-edit:${principal.userId}`);
        return checkUxScreen(ctx.infra.db, { projectId: ctx.params.projectId, screenKey: ctx.params.screenKey });
      },
      { params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }) },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/comments",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux-edit:${principal.userId}`);
        return addUxComment(ctx.infra.db, {
          projectId: ctx.params.projectId,
          screenKey: ctx.params.screenKey,
          nid: ctx.body.nid,
          anchor: ctx.body.anchor ?? "",
          text: ctx.body.text,
          userId: principal.userId,
        });
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }), screenKey: t.String({ minLength: 1, maxLength: 60 }) }),
        body: t.Object({
          nid: t.String({ pattern: "^n[0-9]{1,6}$" }),
          anchor: t.Optional(t.String({ maxLength: 160 })),
          text: t.String({ minLength: 1, maxLength: 2000 }),
        }),
      },
    )

    .post(
      "/projects/:projectId/ux/screens/:screenKey/comments/:commentId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeProjectAccess(ctx.infra.db, principal, ctx.params.projectId, { write: true, scope: "artifact:write" });
        await rateLimit(ctx.infra, "AI", `ux-edit:${principal.userId}`);
        return updateUxComment(ctx.infra.db, {
          projectId: ctx.params.projectId,
          screenKey: ctx.params.screenKey,
          commentId: ctx.params.commentId,
          action: ctx.body.action,
        });
      },
      {
        params: t.Object({
          projectId: t.String({ format: "uuid" }),
          screenKey: t.String({ minLength: 1, maxLength: 60 }),
          commentId: t.String({ format: "uuid" }),
        }),
        body: t.Object({ action: t.Union([t.Literal("resolve"), t.Literal("reopen"), t.Literal("delete")]) }),
      },
    );
}
