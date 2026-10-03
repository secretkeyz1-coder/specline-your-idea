import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import type { MachineRow } from "$lib/types.js";
import type { MachineRepoLink } from "./links.js";

export type CliInstall = { available: boolean; version: string | null; install: { sh: string; ps1: string } };

export const load: PageServerLoad = async ({ fetch, cookies }) => {
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  let machines: MachineRow[];
  try {
    ({ machines } = await api<{ machines: MachineRow[] }>(fetch, session, "GET", "/api/v1/agents/machines"));
  } catch (e) {
    // 401 → /login; anything else is shown as an error, not as "no machines".
    throwLoadError(e);
  }
  // The install commands come from the server, which serves the CLI itself.
  const cli = await api<CliInstall>(fetch, session, "GET", "/api/v1/cli").catch(() => null);
  // Links are secondary: if they fail, the machine list still renders with a notice.
  try {
    const { links } = await api<{ links: MachineRepoLink[] }>(fetch, session, "GET", "/api/v1/agents/repo-links");
    return { machines, links, linksError: null as string | null, cli };
  } catch (e) {
    rethrowKitError(e);
    if (e instanceof ApiError && e.status === 401) redirect(303, "/login");
    return {
      machines,
      cli,
      links: [] as MachineRepoLink[],
      linksError: e instanceof ApiError ? e.message : "Linked repositories could not be loaded — try again shortly.",
    };
  }
};

export const actions: Actions = {
  // The two-option review control for one linked repository.
  setReview: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    if (!session.token) redirect(303, "/login");
    const form = await request.formData();
    const linkId = String(form.get("link_id") ?? "");
    const review = String(form.get("review") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(linkId) || (review !== "auto" && review !== "human")) {
      return fail(400, { linkId, message: "Choose how runs from this repository are reviewed." });
    }
    try {
      await api(fetch, session, "PATCH", `/api/v1/agents/repo-links/${linkId}`, { body: { auto_approve: review === "auto" } });
    } catch (e) {
      rethrowKitError(e);
      if (e instanceof ApiError) {
        if (e.status === 401) redirect(303, "/login");
        return fail(e.status, { linkId, message: e.message });
      }
      return fail(502, { linkId, message: "The change did not go through — try again." });
    }
    return {
      linkId,
      notice: review === "auto" ? "Auto-approve is on for this repository." : "Runs from this repository now wait for a human reviewer.",
    };
  },
};
