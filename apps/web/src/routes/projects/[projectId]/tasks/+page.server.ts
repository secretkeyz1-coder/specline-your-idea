import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import type { TaskSummary } from "$lib/types.js";
import { BAD_ID, formUuid } from "$lib/server/ids.js";
import { splitPartsFromForm } from "$lib/server/split-parts.js";

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  try {
    const [{ tasks }, graph, promptOptions] = await Promise.all([
      api<{ tasks: TaskSummary[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/tasks?limit=200`),
      api<{ acyclic: boolean; cycle?: string[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/task-graph/validate`),
      api<{ self_connect: boolean; auto_approve: boolean }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/execution-prompt/options`).catch(
        () => ({ self_connect: false, auto_approve: false }),
      ),
    ]);
    return { tasks, graph, promptOptions };
  } catch (e) {
    throwLoadError(e);
  }
};

export const actions: Actions = {
  generate: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      const result = await api<{ created: number; autoReadied: number; leftDraft: string[] }>(
        fetch,
        session,
        "POST",
        `/api/v1/projects/${params.projectId}/tasks/generate`,
        { body: {} },
      );
      // Tasks are auto-approved into READY on generation — no per-task approval.
      // The next step is named by the project's persistent next-step bar; the
      // notice only confirms what happened.
      const left = result.leftDraft.length;
      const draftNote = left
        ? ` ${left} ${left === 1 ? "task was" : "tasks were"} left in draft (readiness checks failed): ${result.leftDraft.slice(0, 5).join(", ")}${left > 5 ? "…" : ""}.`
        : ` All ${result.autoReadied} approved into Ready and live on the board.`;
      return { ok: true, notice: `Task plan generated: ${result.created} ${result.created === 1 ? "task" : "tasks"} created.${draftNote}` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Task generation failed." });
    }
  },

  /** Bulk auto-approve: every DRAFT task in the project goes to READY. */
  readyAll: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      const { tasks } = await api<{ tasks: Array<{ id: string; key: string; workflowStatus: string }> }>(
        fetch,
        session,
        "GET",
        `/api/v1/projects/${params.projectId}/tasks?limit=500`,
      );
      const drafts = tasks.filter((t) => t.workflowStatus === "DRAFT");
      let readied = 0;
      const failed: string[] = [];
      for (const task of drafts) {
        try {
          await api(fetch, session, "POST", `/api/v1/tasks/${task.id}/ready`, { body: {} });
          readied += 1;
        } catch {
          failed.push(task.key);
        }
      }
      const failNote = failed.length ? ` ${failed.length} could not be approved: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? "…" : ""}.` : "";
      return { ok: true, notice: `Approved ${readied} of ${drafts.length} draft ${drafts.length === 1 ? "task" : "tasks"}.${failNote}` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "The draft tasks could not be approved. Try again." });
    }
  },

  /** Generate the 1-prompt execution prompt for a local AI agent. It carries a
   *  single-use connect code, so the agent needs no separate sign-in. */
  executionPrompt: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const autoApprove = form.get("auto_approve") === "on";
    try {
      const result = await api<{ prompt: string }>(
        fetch,
        session,
        "GET",
        `/api/v1/projects/${params.projectId}/execution-prompt?auto_approve=${autoApprove}`,
      );
      return { prompt: result.prompt };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not generate the execution prompt." });
    }
  },

  ready: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/ready`, { body: {} });
      return { ok: true, notice: "Task approved into Ready." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) {
        // The API already returns the exact failing readiness checks; surfacing
        // them turns an unexplained refusal into a list the user can act on.
        const details = error.details as { checks?: Array<{ id: string; label: string; detail?: string }> } | null;
        const checks = (details?.checks ?? []).map((c) => ({ label: c.label, detail: c.detail ?? "" }));
        return fail(error.status, { message: error.message, checks });
      }
      return fail(500, { message: "Could not ready the task." });
    }
  },

  /** Draft action: add the standard render check to a screen task that lint keeps out of Ready without one. */
  renderCheck: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/render-check`, { body: {} });
      return { ok: true, notice: "Render check added. Approve the task when it is ready." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not add the render check." });
    }
  },

  /** Draft actions (docs/14 §11): edit title/objective and re-lint. */
  edit: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    const title = String(form.get("title") ?? "").trim();
    const objective = String(form.get("objective") ?? "").trim();
    if (!title && !objective) return fail(422, { message: "Change the title or the objective first." });
    try {
      await api(fetch, session, "PATCH", `/api/v1/tasks/${taskId}`, {
        body: { ...(title ? { title } : {}), ...(objective ? { objective } : {}) },
      });
      // Re-evaluate readiness so the table reflects the edit immediately.
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/lint`, { body: {} }).catch(() => undefined);
      return { ok: true, notice: "Draft task updated and re-checked." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not update the draft task." });
    }
  },

  /** Draft action (docs/14 §11): split one task into bounded parts. */
  split: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    const parts = splitPartsFromForm(form);
    if (parts.length < 2) return fail(422, { message: "A split needs at least two parts." });
    try {
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/split`, { body: { parts } });
      return { ok: true, notice: `Task split into ${parts.length} parts.` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not split the task." });
    }
  },

  /** Draft action (docs/14 §11): regenerate the whole plan from the design. */
  /** @deprecated kept for old bookmarks/forms; the UI uses `generate` with a confirmation. */
  regenerate: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/tasks/generate`, { body: {} });
      return { ok: true, notice: "Task plan regenerated from the approved design." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Regeneration failed." });
    }
  },
};
