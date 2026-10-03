import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom } from "$lib/server/api.js";

/**
 * Bring your own design system: the pasted text is read by the API (tokens
 * directly, prose through the project's AI) into a complete spec. Nothing is
 * stored — the editor shows it, and "Save draft" saves it as usual.
 */
export const POST: RequestHandler = async ({ request, fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { text?: unknown; component_library?: unknown; base_preset_id?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return json({ message: "Paste a design system first." }, { status: 400 });
  try {
    const res = await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/design-system/import`, {
      body: {
        text,
        ...(typeof body?.component_library === "string" ? { component_library: body.component_library } : {}),
        ...(typeof body?.base_preset_id === "string" ? { base_preset_id: body.base_preset_id } : {}),
      },
    });
    return json(res);
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message }, { status: e.status });
    return json({ message: "The design system could not be read. Try again." }, { status: 500 });
  }
};
