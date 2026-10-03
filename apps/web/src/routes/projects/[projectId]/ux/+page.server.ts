import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";
import type { DesignSystemState, UxDevice, UxPlatform, UxState } from "$lib/types.js";
import { BAD_ID, formUuid } from "$lib/server/ids.js";

/** Mirrors MAX_UX_SCREENS in @sdd/contracts: each screen is its own AI call. */
const MAX_SCREENS = 12;

const DEVICES: readonly UxDevice[] = ["desktop", "phone", "tablet-landscape", "tablet-portrait"];

/**
 * The platform a form sends (JSON in "platform"), when the person chose one:
 * web app or Android app and its devices, primary first. Undefined when the
 * field is absent; null when it can't be read. The API checks it again.
 */
function readPlatform(form: FormData): UxPlatform | null | undefined {
  const raw = form.get("platform");
  if (!raw) return undefined;
  try {
    const v = JSON.parse(String(raw)) as Partial<UxPlatform>;
    const kind = v.kind === "native-mobile" ? "native-mobile" : v.kind === "web" ? "web" : null;
    const devices = [...new Set((Array.isArray(v.devices) ? v.devices : []).filter((d): d is UxDevice => DEVICES.includes(d as UxDevice)))].slice(0, 3);
    if (!kind || devices.length === 0) return null;
    return {
      kind,
      os: kind === "native-mobile" ? "android" : null,
      devices,
      source: v.source === "detected" ? "detected" : "user",
      reason: typeof v.reason === "string" ? v.reason.slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}

export const load: PageServerLoad = async ({ fetch, cookies, params, depends }) => {
  depends("app:ux");
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  // Everything the page reads, in one round.
  const [projectRead, ux, routing, ds, catalog] = await Promise.all([
    api<{ project: { id: string; key: string; name: string } }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}`).catch(() => null),
    api<UxState>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/ux`).catch((e: unknown) => e as Error),
    api<{ effective: Array<{ role: string; configured: boolean }> }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/ai-role-bindings`).catch(
      () => ({ effective: [] as Array<{ role: string; configured: boolean }> }),
    ),
    // Styled screens need an approved design system.
    api<DesignSystemState>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/design-system`).catch(() => null),
    // The canvas names each element's component in the chosen library ("Dialog" in shadcn/ui, "modal" in daisyUI).
    api<{ libraries: Array<{ id: string; name: string; components: Record<string, string> }> }>(fetch, session, "GET", "/api/v1/design-systems/catalog").catch(() => null),
  ]);
  if (!projectRead) error(404, "Project not found");
  const { project } = projectRead;
  if (ux instanceof Error) throw ux;
  // The reference is drawn from the approved design — before that there is
  // nothing to draw from, so send the user to the step that unblocks them.
  if (!ux.design_approved) redirect(303, `/projects/${params.projectId}/docs?tab=design`);

  const aiAvailable = routing.effective.some((r) => r.role === "ARCHITECTURE" && r.configured);
  const designSystem = ds?.approved?.spec ? { name: ds.approved.spec.name, version: ds.approved.version } : null;
  const lib = (ds?.approved?.spec && catalog?.libraries.find((l) => l.id === ds?.approved?.spec?.component_library)) || null;
  const library = lib ? { name: lib.name, components: lib.components } : null;

  return { project, ux, aiAvailable, designSystem, library };
};

export const actions: Actions = {
  plan: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const mode = form.get("mode") === "revise" ? "revise" : "plan";
    // "auto" (or nothing) lets the AI recommend the number of screens.
    const count = Number(form.get("screenCount"));
    const screenCount = form.get("countMode") === "set" && Number.isInteger(count) ? count : null;
    if (form.get("countMode") === "set" && (screenCount === null || screenCount < 1 || screenCount > MAX_SCREENS)) {
      return fail(400, { message: `Choose between 1 and ${MAX_SCREENS} screens, or let the AI recommend the number.` });
    }
    const guidance = String(form.get("guidance") ?? "").trim().slice(0, 1000);
    const fidelity = form.get("fidelity") === "styled" ? "styled" : "neutral";
    // An analysed layout reference the plan should follow; the API checks it against the contract.
    let layoutReference: unknown = null;
    try {
      layoutReference = form.get("layoutReference") ? JSON.parse(String(form.get("layoutReference"))) : null;
    } catch {
      return fail(400, { message: "The layout reference could not be read — add it again." });
    }
    // Sent only when the person changed the detected platform.
    const platform = readPlatform(form);
    if (platform === null) return fail(400, { message: "Choose a platform and at least one device." });
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/ux/plan`, {
        body:
          mode === "plan"
            ? {
                mode,
                screen_count: screenCount,
                fidelity,
                ...(guidance ? { guidance } : {}),
                ...(layoutReference ? { layout_reference: layoutReference } : {}),
                ...(platform ? { platform } : {}),
              }
            : { mode },
      });
      return { ok: true };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The screen plan could not be created. Try again." });
    }
  },

  addScreen: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const lines = (field: string) =>
      String(form.get(field) ?? "")
        .split(field === "requirementKeys" ? /[,\s]+/ : /\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean);
    const values = {
      name,
      purpose: String(form.get("purpose") ?? "").trim(),
      keyElements: String(form.get("keyElements") ?? ""),
      requirementKeys: String(form.get("requirementKeys") ?? ""),
    };
    if (!name) return fail(400, { addError: "Give the screen a name.", values });
    try {
      const res = await api<{ screen: { key: string } }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/ux/screens`, {
        body: {
          name: name.slice(0, 80),
          purpose: values.purpose.slice(0, 400),
          key_elements: lines("keyElements").slice(0, 12).map((e) => e.slice(0, 160)),
          requirement_keys: lines("requirementKeys").slice(0, 10).map((k) => k.slice(0, 32)),
        },
      });
      return { ok: true, added: res.screen.key, notice: `"${name}" added. Draw it when you're ready.` };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { addError: e.message, values });
      return fail(500, { addError: "The screen could not be added. Try again.", values });
    }
  },

  removeScreen: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const key = String(form.get("screenKey") ?? "");
    try {
      await api(fetch, session, "DELETE", `/api/v1/projects/${params.projectId}/ux/screens/${encodeURIComponent(key)}`);
      return { ok: true, notice: "Screen removed from the draft." };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The screen could not be removed. Try again." });
    }
  },

  /** Keep the planned screens and draw them again with another look. */
  restyle: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const fidelity = form.get("fidelity") === "styled" ? "styled" : "neutral";
    // Redrawing as another platform (a web reference for an Android stack) keeps the plan too.
    const platform = readPlatform(form);
    if (platform === null) return fail(400, { message: "Choose a platform and at least one device." });
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/ux/look`, { body: { fidelity, ...(platform ? { platform } : {}) } });
      return { ok: true, restyled: true };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The look could not be changed. Try again." });
    }
  },

  confirmScope: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/ux/confirm-scope`, { body: {} });
      return { ok: true, notice: "Left-out scope accepted. It is recorded with this draft." };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The scope could not be confirmed. Try again." });
    }
  },

  approve: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const revisionId = formUuid(form, "revisionId");
    if (!revisionId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/artifact-revisions/${revisionId}/approve`, { body: {} });
      return { ok: true, notice: "UI reference approved and locked. Tasks generated from now on — and the agent's work order — follow it." };
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) return fail(e.status, { message: e.message });
      return fail(500, { message: "The UI reference could not be approved. Try again." });
    }
  },
};
