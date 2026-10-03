import type { PageServerLoad } from "./$types.js";
import { api, sessionFrom, throwLoadError } from "$lib/server/api.js";
import type { TaskSummary } from "$lib/types.js";

export const load: PageServerLoad = async ({ fetch, cookies, params, depends }) => {
  // Live updates re-run only this load (invalidate("app:board")).
  depends("app:board");
  const session = sessionFrom(cookies);
  try {
    const { tasks } = await api<{ tasks: TaskSummary[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/tasks?limit=200`);
    return { projectId: params.projectId, tasks: tasks.filter((t) => t.workflowStatus !== "DRAFT") };
  } catch (e) {
    throwLoadError(e);
  }
};
