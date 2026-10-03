import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import type { BugRow } from "$lib/types.js";
import { BAD_ID, formUuid } from "$lib/server/ids.js";

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  try {
    const { bugs } = await api<{ bugs: BugRow[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/bugs`);
    return { bugs };
  } catch (e) {
    throwLoadError(e);
  }
};

export const actions: Actions = {
  create: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/bugs`, {
        body: {
          title: String(form.get("title") ?? ""),
          severity: String(form.get("severity") ?? "MAJOR"),
          current_behavior: String(form.get("current") ?? ""),
          expected_behavior: String(form.get("expected") ?? ""),
          unchanged_behavior: String(form.get("unchanged") ?? ""),
          reproduction: String(form.get("reproduction") ?? ""),
        },
      });
      return { ok: true, notice: "Bug recorded." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not record the bug." });
    }
  },

  confirm: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const bugId = formUuid(form, "bugId");
    if (!bugId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/bugs/${bugId}/confirm`, { body: { note: "" } });
      return { ok: true, notice: "Bug confirmed." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "The bug could not be confirmed. Try again." });
    }
  },

  generateFixTask: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const bugId = formUuid(form, "bugId");
    if (!bugId) return fail(400, { message: BAD_ID });
    try {
      const result = await api<{ task: { key: string } }>(fetch, session, "POST", `/api/v1/bugs/${bugId}/generate-fix-tasks`, {});
      return { ok: true, notice: `Fix task ${result.task.key} created.` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "The fix task could not be created. Try again." });
    }
  },
};
