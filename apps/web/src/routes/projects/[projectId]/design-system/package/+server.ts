import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types.js";
import { api, ApiError, sessionFrom } from "$lib/server/api.js";

/**
 * What the agent gets for the current (unsaved) values: USAGE.md, DESIGN.md,
 * tokens.css, design-tokens.json and the craft references, built by the API.
 * Nothing is stored.
 */
export const POST: RequestHandler = async ({ request, fetch, cookies }) => {
  const session = sessionFrom(cookies);
  if (!session.token) return json({ message: "Sign in again to continue." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { spec?: unknown } | null;
  if (!body?.spec) return json({ message: "Nothing to package." }, { status: 400 });
  try {
    return json(await api(fetch, session, "POST", "/api/v1/design-systems/package", { body: { spec: body.spec } }));
  } catch (e) {
    if (e instanceof ApiError) return json({ message: e.message }, { status: e.status });
    return json({ message: "The package could not be built." }, { status: 500 });
  }
};
