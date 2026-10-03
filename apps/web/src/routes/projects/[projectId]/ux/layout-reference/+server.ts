import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom } from "$lib/server/api.js";
import type { LayoutReference } from "$lib/types.js";
import { readUiTemplate, templateHtmlForAnalysis, templateHtmlForAdaptation } from "$lib/server/ui-templates.js";

/**
 * The layout reference, as JSON (the canvas stays on the page): analyse a
 * pasted page (nothing stored), use a reference for every screen or one, or
 * stop using it. The API checks a reference against the contract before
 * storing it; a screen changed since the canvas read it answers 409.
 */
type LayoutBody =
  | { op: "analyse"; html: string; name?: string; mode?: "layout" | "adapt" }
  | { op: "analyse-template"; templateId: string; mode?: "layout" | "adapt" }
  | { op: "use"; reference: LayoutReference; screenKey?: string; base?: string }
  | { op: "remove"; screenKey?: string; base?: string };

export const POST: RequestHandler = async ({ request, fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as LayoutBody | null;
  const base = `/api/v1/projects/${params.projectId}/ux/layout-reference`;
  try {
    switch (body?.op) {
      case "analyse-template": {
        if (typeof body.templateId !== "string") return json({ message: "Choose a built-in template first." }, { status: 400 });
        let selected;
        try {
          selected = await readUiTemplate(body.templateId);
        } catch {
          return json({ message: "This built-in template is unavailable. Choose another template." }, { status: 404 });
        }
        let html;
        try { html = body.mode === "adapt" ? await templateHtmlForAdaptation(body.templateId) : templateHtmlForAnalysis(selected.content); }
        catch { return json({ message: "This page is too large to analyse. Choose a smaller entry page or bring a focused HTML sample." }, { status: 422 }); }
        return json(await api(fetch, session, "POST", `${base}/analyse`, { body: { html, name: selected.template.name, mode: body.mode ?? "layout" } }));
      }
      case "analyse":
        if (typeof body.html !== "string" || !body.html.trim()) return json({ message: "Paste the page's HTML first." }, { status: 400 });
        return json(await api(fetch, session, "POST", `${base}/analyse`, { body: { html: body.html, mode: body.mode ?? "layout", ...(body.name?.trim() ? { name: body.name.trim().slice(0, 80) } : {}) } }));
      case "use":
        return json(await api(fetch, session, "PUT", base, { body: { reference: body.reference, screen_key: body.screenKey, base: body.base } }));
      case "remove": {
        const query = new URLSearchParams();
        if (body.screenKey) query.set("screen_key", body.screenKey);
        if (body.base) query.set("base", body.base);
        const qs = query.toString();
        return json(await api(fetch, session, "DELETE", qs ? `${base}?${qs}` : base));
      }
      default:
        return json({ message: "Unknown request." }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message, code: e.code }, { status: e.status });
    return json({ message: "The layout reference could not be saved. Try again." }, { status: 500 });
  }
};
