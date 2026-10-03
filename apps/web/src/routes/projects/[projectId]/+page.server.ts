import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";

/** The project notebook (T078): the chapters come from the layout's journey; this adds the features with their task counts. */

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  const projectId = params.projectId;

  const safe = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return await api<T>(fetch, session, "GET", path);
    } catch {
      return fallback;
    }
  };

  const [{ project }, featuresResult, tasksResult] = await Promise.all([
    api<{ project: { id: string; key: string; name: string; lifecycleStatus: string; highLevelIdea: string; constraints: string[]; projectRules: string[] } }>(
      fetch,
      session,
      "GET",
      `/api/v1/projects/${projectId}`,
    ),
    safe<{ features: Array<{ id: string; key: string; title: string; description: string; status: string; checked: boolean; can_complete: boolean }> }>(
      `/api/v1/projects/${projectId}/features/release-status`,
      { features: [] },
    ),
    safe<{ tasks: Array<{ id: string; key: string; title: string; workflowStatus: string; featureId: string | null }> }>(
      `/api/v1/projects/${projectId}/tasks?limit=200`,
      { tasks: [] },
    ),
  ]);


  const counts = new Map<string, { total: number; done: number }>();
  for (const feature of featuresResult.features) counts.set(feature.id, { total: 0, done: 0 });
  for (const task of tasksResult.tasks) {
    if (!task.featureId) continue;
    const bucket = counts.get(task.featureId) ?? { total: 0, done: 0 };
    bucket.total += 1;
    if (task.workflowStatus === "DONE") bucket.done += 1;
    counts.set(task.featureId, bucket);
  }

  return {
    project,
    features: featuresResult.features.map((f) => ({ ...f, counts: counts.get(f.id) ?? { total: 0, done: 0 } })),
  };
};

export const actions: Actions = {
  generateDesign: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/design/generate`, { body: {} });
      return { ok: true, step: "design" };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Design generation failed." });
    }
  },

  generateTasks: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/tasks/generate`, { body: {} });
      return { ok: true, step: "tasks" };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Task generation failed." });
    }
  },
};
