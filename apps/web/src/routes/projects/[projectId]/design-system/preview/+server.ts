import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom } from "$lib/server/api.js";

/**
 * Live preview while the design system is being adjusted: renders the kit for
 * the current (unsaved) values and returns the contrast checks. Nothing is stored.
 */
export const POST: RequestHandler = async ({ request, fetch, cookies }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { spec?: unknown; mode?: unknown } | null;
  if (!body?.spec) return json({ message: "Nothing to preview." }, { status: 400 });
  try {
    const res = await api(fetch, session, "POST", "/api/v1/design-systems/preview", {
      body: { spec: body.spec, mode: body.mode === "dark" ? "dark" : "light" },
    });
    return json(res);
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message }, { status: e.status });
    return json({ message: "The preview could not be drawn." }, { status: 500 });
  }
};
