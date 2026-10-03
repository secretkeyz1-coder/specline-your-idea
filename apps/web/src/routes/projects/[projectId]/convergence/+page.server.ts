import { fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import { BAD_ID, formUuid } from "$lib/server/ids.js";

type Finding = {
  id: string;
  findingType: string;
  severity: string;
  description: string;
  evidence: string;
  requirementKey: string | null;
  acceptanceCriterionKey: string | null;
  resolutionStatus: string;
};

type Gate = {
  canComplete: boolean;
  blockers: {
    open_blocking_findings: Array<{ id: string; description: string }>;
    blocking_bugs: Array<{ id: string; key: string; title: string }>;
    incomplete_tasks: Array<{ id: string; key: string; status: string }>;
    convergence_recommended: boolean;
    no_tasks?: boolean;
  };
};
type RunWithFindings = { run: { id: string; status: string; summary: string; completionRecommended: string; createdAt: string }; findings: Finding[] };

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  // An outage must not render as "no features" or "never checked": any
  // failed read shows the error page (401 goes to sign-in) instead.
  try {
    const features = await api<{ features: Array<{ id: string; key: string; title: string; status: string }> }>(
      fetch,
      session,
      "GET",
      `/api/v1/projects/${params.projectId}/features`,
    );
    const perFeature = await Promise.all(
      features.features.map(async (feature) => {
        const id = encodeURIComponent(feature.id);
        const [runs, gate] = await Promise.all([
          api<{ runs: RunWithFindings[] }>(fetch, session, "GET", `/api/v1/features/${id}/convergence-runs`),
          api<Gate>(fetch, session, "GET", `/api/v1/features/${id}/completion-gate`),
        ]);
        return { feature, runs: runs.runs, gate };
      }),
    );
    return { features: features.features, perFeature };
  } catch (e) {
    throwLoadError(e);
  }
};

export const actions: Actions = {
  run: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const featureId = formUuid(form, "featureId");
    if (!featureId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/features/${featureId}/convergence-runs`, { body: {} });
      return { ok: true, notice: "Release check finished — the results are on the feature card." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "The release check could not run. Try again in a moment." });
    }
  },

  generateTask: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const findingId = formUuid(form, "findingId");
    if (!findingId) return fail(400, { message: BAD_ID });
    try {
      const result = await api<{ task: { key: string } }>(fetch, session, "POST", `/api/v1/convergence-findings/${findingId}/generate-task`, {});
      return { ok: true, notice: `Fix task ${result.task.key} created — find it in Tasks.` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "The fix task could not be created. Try again in a moment." });
    }
  },

  complete: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const featureId = formUuid(form, "featureId");
    if (!featureId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/features/${featureId}/complete`, { body: {} });
      return { ok: true, notice: "Feature marked complete." };
    } catch (error) {
      rethrowKitError(error);
      // A refusal (the gate's 409 and its reason) comes from the API as an ApiError;
      // anything else is a transport failure, not "not ready yet".
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(502, { message: "The server could not be reached, so the feature was not marked complete. Try again in a moment." });
    }
  },
};
