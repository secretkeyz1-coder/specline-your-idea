import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import { BAD_ID, formUuid } from "$lib/server/ids.js";
import type { ComponentLibraryInfo, DesignSystemPreset, DesignSystemState, DsDirection } from "$lib/types.js";

export const load: PageServerLoad = async ({ fetch, cookies, params, depends }) => {
  depends("app:design-system");
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  // A failed read is the error page (401: sign in again), not an unhandled 500.
  // The project is read here rather than through parent(): awaiting the layout
  // makes the server run it (and its journey reads) on every visit to this page.
  try {
    const [{ project }, catalog, state] = await Promise.all([
      api<{ project: { id: string; key: string; name: string; lifecycleStatus: string } }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}`),
      api<{ presets: DesignSystemPreset[]; libraries: ComponentLibraryInfo[]; directions?: DsDirection[] }>(fetch, session, "GET", "/api/v1/design-systems/catalog"),
      api<DesignSystemState>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/design-system`),
    ]);
    // Older APIs answer without directions: the page then offers presets only.
    return { project, catalog: { ...catalog, directions: catalog.directions ?? [] }, state };
  } catch (e) {
    throwLoadError(e);
  }
};

export const actions: Actions = {
  save: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    let spec: unknown;
    try {
      spec = JSON.parse(String(form.get("spec") ?? ""));
    } catch {
      return fail(400, { message: "The design system could not be read. Reload the page and try again." });
    }
    try {
      const res = await api<{ revision: { id: string; version: number } }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/design-system`, {
        body: { spec },
      });
      return { ok: true, saved: res.revision.version, notice: `Draft v${res.revision.version} saved. Approve it to use it for screens and tasks.` };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The draft could not be saved. Try again." });
    }
  },

  approve: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const revisionId = formUuid(form, "revisionId");
    if (!revisionId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/artifact-revisions/${revisionId}/approve`, { body: {} });
      return { ok: true, approved: true, notice: "Design system approved. Styled screens, tasks and the agent's work order now use it." };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The design system could not be approved. Try again." });
    }
  },
};
