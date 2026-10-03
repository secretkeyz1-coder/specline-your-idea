import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types.js";
import { api, sessionFrom, throwLoadError } from "$lib/server/api.js";
import { loadJourney } from "$lib/server/journey.js";

export const load: LayoutServerLoad = async ({ fetch, cookies, params, depends }) => {
  // Any approval or generation invalidates everything; pages that change the
  // journey without a form action call invalidate("app:journey").
  depends("app:journey");
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  try {
    const { project } = await api<{ project: { id: string; key: string; name: string; lifecycleStatus: string } }>(
      fetch,
      session,
      "GET",
      `/api/v1/projects/${params.projectId}`,
    );
    return { project, journey: await loadJourney(fetch, session, project) };
  } catch (e) {
    throwLoadError(e);
  }
};
