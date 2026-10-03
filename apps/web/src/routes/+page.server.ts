import { redirect, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";
import { aiReadiness } from "$lib/server/ai-readiness.js";
import type { ProjectProgress } from "$lib/labels.js";
import { loadJourney } from "$lib/server/journey.js";
import type { Journey } from "$lib/journey.js";
import { isUuid } from "$lib/server/ids.js";
import { HIDDEN_NEXT_COOKIE } from "$lib/today.js";

export const load: PageServerLoad = async ({ fetch, cookies }) => {
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  let projects: Array<{ id: string; key: string; name: string; lifecycleStatus: string; updatedAt: string; archivedAt?: string | null; progress?: ProjectProgress }> = [];
  try {
    const result = await api<{ projects: typeof projects }>(fetch, session, "GET", "/api/v1/projects");
    projects = result.projects;
  } catch (e) {
    // An expired session must lead to the login page, not an empty dashboard.
    if (e instanceof ApiError && e.status === 401) redirect(303, "/login");
    /* other failures are surfaced as the empty state */
  }
  // Today leads with one next step: the most recently touched live project's.
  const live = projects.filter((p) => !p.archivedAt).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const [ai, focus] = await Promise.all([
    // First-run guidance needs to know whether generation will work yet.
    aiReadiness(fetch, session),
    live[0] ? loadJourney(fetch, session, live[0]).then((journey): Journey | null => journey).catch(() => null) : Promise.resolve(null),
  ]);
  // The "Up next" card the person hid (one step of one project), read here so a reload never flashes it.
  const hiddenNext = cookies.get(HIDDEN_NEXT_COOKIE) ?? null;
  return { projects, ai, focus: focus && live[0] ? { projectId: live[0].id, journey: focus } : null, hiddenNext };
};

export const actions: Actions = {
  /** Archive or restore projects: hidden from Today, never deleted. */
  archive: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const ids = form.getAll("projectId").map(String);
    const archived = form.get("archived") !== "0";
    if (ids.length === 0) return fail(422, { message: "Pick at least one project." });
    if (ids.some((id) => !isUuid(id))) return fail(400, { message: "That project id is not valid." });
    try {
      for (const id of ids) await api(fetch, session, "PATCH", `/api/v1/projects/${id}`, { body: { archived } });
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not update the projects." });
    }
    const n = ids.length === 1 ? "1 project" : `${ids.length} projects`;
    return { archivedIds: archived ? ids : [], notice: archived ? `Archived ${n}.` : `Restored ${n}.` };
  },

  create: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    if (!session.token) return fail(401, { message: "Sign in first" });
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const idea = String(form.get("idea") ?? "").trim();
    const constraints = String(form.get("constraints") ?? "")
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (!name || idea.length < 10) {
      return fail(422, { message: "Give the project a name and at least a sentence of idea." });
    }
    try {
      const { project } = await api<{ project: { id: string } }>(fetch, session, "POST", "/api/v1/projects", {
        body: { name, high_level_idea: idea, constraints },
      });
      await api(fetch, session, "POST", `/api/v1/projects/${project.id}/discovery-sessions`, { body: {} }).catch(() => undefined);
      redirect(303, `/projects/${project.id}/discovery`);
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not create the project — is the API running?" });
    }
  },
};
