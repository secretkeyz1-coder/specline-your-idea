import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";

type Revision = { id: string; version: number; status: string; structuredContent: unknown };

/**
 * Hand-written requirements (the manual path every AI step must have, C17).
 * Opens on the newest draft, or on the approved version to start a new one.
 */
export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  try {
    const res = await api<{ revision: Revision | null; approved_revision: Revision | null }>(
      fetch,
      session,
      "GET",
      `/api/v1/projects/${params.projectId}/requirements`,
    );
    const base = res.revision;
    return {
      initial: (base?.structuredContent as Record<string, unknown> | null) ?? null,
      basedOn: base ? { version: base.version, status: base.status } : null,
    };
  } catch (e) {
    throwLoadError(e);
  }
};

export const actions: Actions = {
  save: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const payload = String(form.get("payload") ?? "");
    let structured: unknown;
    try {
      structured = JSON.parse(payload);
    } catch {
      return fail(400, { message: "The form could not be read. Try again.", payload });
    }
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/artifacts/requirements/edit`, { body: { structured } });
    } catch (e) {
      rethrowKitError(e);
      // Keep every field the person typed; only the message changes.
      if (e instanceof ApiError) return fail(e.status, { message: e.message, payload });
      return fail(500, { message: "The draft could not be saved. Your text is still here — try again.", payload });
    }
    redirect(303, `/projects/${params.projectId}/docs?tab=requirements&saved=1`);
  },
};
