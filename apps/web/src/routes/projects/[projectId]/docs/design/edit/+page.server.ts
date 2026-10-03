import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";

import { designEditorInitial } from "$lib/design-editor.js";

type Revision = { id: string; version: number; status: string; structuredContent: unknown };

/**
 * Hand-written technical design (manual path, C17). The design is written
 * against approved requirements and a locked stack, so both are shown here.
 */
export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  try {
    const [design, requirements, stack] = await Promise.all([
      api<{ artifact: { approvedRevisionId: string | null } | null; revisions: Revision[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/artifacts/design`),
      api<{ approved_revision: { id: string } | null; requirements: Array<{ key: string; title: string }>; approved_requirements?: Array<{ key: string; title: string }> }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/requirements`),
      api<{ artifact: { approvedRevisionId: string | null } | null; revisions: Revision[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/artifacts/stack`),
    ]);
    // Revisions arrive newest first: open the newest draft, else the approved one.
    const base = design.revisions.find((r) => r.status === "DRAFT") ?? design.revisions.find((r) => r.status === "APPROVED") ?? null;
    const lockedStack = stack.revisions.find((r) => r.status === "APPROVED") ?? null;
    return {
      initial: base ? designEditorInitial(base.structuredContent) : null,
      basedOn: base ? { version: base.version, status: base.status } : null,
      requirementsApproved: Boolean(requirements.approved_revision),
      requirements: (requirements.approved_requirements ?? requirements.requirements).map((r) => ({ key: r.key, title: r.title })),
      stackLocked: Boolean(lockedStack),
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
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/design/edit`, { body: { structured } });
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message, payload });
      return fail(500, { message: "The draft could not be saved. Your text is still here — try again.", payload });
    }
    redirect(303, `/projects/${params.projectId}/docs?tab=design&saved=1`);
  },
};
