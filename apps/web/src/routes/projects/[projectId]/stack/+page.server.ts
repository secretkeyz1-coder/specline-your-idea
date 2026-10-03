import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom } from "$lib/server/api.js";
import type { StackCatalog, StackComponent, StackDecision, StackPackage } from "$lib/types.js";

export const load: PageServerLoad = async ({ fetch, cookies, params, url }) => {
  const session = sessionFrom(cookies);
  if (!session.token) redirect(303, "/login");
  type Revision = { version: number; status: string; structuredContent: unknown; approvedAt: string | null; createdAt: string };
  // Everything the page reads, in one round.
  //
  // C7 gate: requirements must be approved BEFORE technology is locked. The API
  // enforces this on the actions, but rendering the stack form here would walk
  // the user into a screen that can only fail — send them to the step that
  // actually unblocks them, with the reason stated.
  //
  // Which planning roles actually have an AI profile bound? With no provider
  // configured the AI recommendation path cannot work, so the page must default
  // to the manual editor rather than presenting a button that always fails
  // (BYO-provider, C21 + manual fallback, C17).
  //
  // What is already on record: the locked baseline (so a return visit shows
  // "Locked · vN" instead of an empty chooser) and a newer unlocked
  // recommendation (so a reload never throws away a paid AI answer — the API
  // stores every recommendation as a DRAFT revision).
  const [projectRead, requirements, routing, stackArtifact] = await Promise.all([
    api<{ project: { id: string; key: string; name: string } }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}`).catch(() => null),
    api<{ revision: { id: string; status: string } | null; approved_revision?: { id: string } | null }>(
      fetch,
      session,
      "GET",
      `/api/v1/projects/${params.projectId}/requirements`,
    ).catch(() => ({ revision: null, approved_revision: null })),
    api<{ effective: Array<{ role: string; configured: boolean }> }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/ai-role-bindings`).catch(
      () => ({ effective: [] as Array<{ role: string; configured: boolean }> }),
    ),
    api<{ revisions: Revision[] }>(fetch, session, "GET", `/api/v1/projects/${params.projectId}/artifacts/stack`).catch(() => ({ revisions: [] as Revision[] })),
  ]);
  if (!projectRead) error(404, "Project not found");
  const { project } = projectRead;
  // A newer draft may be shown as `revision`; the gate is the approved baseline.
  const approved = Boolean(requirements.approved_revision) || requirements.revision?.status === "APPROVED";
  if (!approved) {
    const discovery = await api<{ readiness: string; session: { readiness: string } | null }>(
      fetch,
      session,
      "GET",
      `/api/v1/projects/${params.projectId}/discovery`,
    ).catch(() => null);
    const discoveryOpen = !discovery?.session || (discovery.readiness ?? "INCOMPLETE") === "INCOMPLETE";
    // Requirements come before technology (C7): when discovery is still open the
    // user must finish it first; otherwise they only need to approve the draft.
    redirect(
      303,
      discoveryOpen
        ? `/projects/${params.projectId}/discovery`
        : `/projects/${params.projectId}/docs?tab=requirements`,
    );
  }

  const aiAvailable = routing.effective.some((r) => r.configured);

  const isDecision = (v: unknown): v is StackDecision =>
    typeof v === "object" && v !== null && Array.isArray((v as StackDecision).candidates) && (v as StackDecision).candidates.length > 0;
  // Revisions arrive newest first.
  const approvedRev = stackArtifact.revisions.find((r) => r.status === "APPROVED" && isDecision(r.structuredContent));
  let approvedStack: {
    version: number;
    approvedAt: string | null;
    layers: StackComponent[];
    /** Why it was chosen, for the locked view: the decision's reasoning, not just its layers. */
    mode: StackDecision["mode"];
    candidate: string;
    rationale: string;
    fit: string;
    tradeoffs: StackDecision["candidates"][number]["tradeoffs"];
    conflicts: StackDecision["conflicts"];
  } | null = null;
  if (approvedRev && isDecision(approvedRev.structuredContent)) {
    const d = approvedRev.structuredContent;
    const candidate = d.candidates[d.recommendation_index ?? 0] ?? d.candidates[0]!;
    approvedStack = {
      version: approvedRev.version,
      approvedAt: approvedRev.approvedAt,
      layers: candidate.layers,
      mode: d.mode,
      candidate: candidate.name,
      rationale: d.rationale ?? "",
      fit: candidate.fit_assessment ?? "",
      tradeoffs: candidate.tradeoffs ?? [],
      conflicts: d.conflicts ?? [],
    };
  }
  const latest = stackArtifact.revisions[0];
  const draftDecision =
    latest && latest.status === "DRAFT" && isDecision(latest.structuredContent) && (!approvedRev || latest.version > approvedRev.version)
      ? latest.structuredContent
      : null;

  // Set right after locking, for a one-time confirmation.
  const justLocked = url.searchParams.get("locked") === "1";
  // The per-layer choices stream in after the page: their live registry
  // checks must never hold the stack page (null = choose by typing).
  const catalog = api<StackCatalog>(fetch, session, "GET", "/api/v1/stack/catalog").catch(() => null);
  return { project, aiAvailable, approvedStack, draftDecision, justLocked, catalog };
};

export const actions: Actions = {
  recommend: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const mode = String(form.get("mode") ?? "RECOMMENDED");
    const suggestCategory = String(form.get("suggest") ?? "").trim();
    const categories = form.getAll("category").map(String);
    const technologies = form.getAll("technology").map(String);
    const versions = form.getAll("version").map(String);
    const packages = form.getAll("package").map(String);
    const locked = form.getAll("locked").map(String);
    const manual = categories
      .map((category, i) => ({
        category,
        technology: technologies[i] ?? "",
        version_constraint: (versions[i] ?? "").trim().slice(0, 60) || null,
        package: parsePackage(packages[i]),
        locked: locked.includes(String(i)),
      }))
      .filter((c) => c.technology.trim().length > 0);
    try {
      const result = await api<{
        decision: import("$lib/types.js").StackDecision;
      }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/stack/recommend`, {
        body: {
          mode,
          manual_components: manual,
          suggest_category: suggestCategory || null,
        },
      });
      return { decision: result.decision };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Stack generation failed — you can retry or choose manually." });
    }
  },

  approve: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const raw = String(form.get("components") ?? "[]");
    try {
      const components = JSON.parse(raw) as Array<{
        category: string;
        technology: string;
        version_constraint: string | null;
        selection_source: string;
        locked_by_user: boolean;
        rationale: string;
        package?: StackPackage | null;
        verified?: unknown;
      }>;
      if (!components.length) return fail(422, { message: "Nothing to approve yet." });
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/stack/approve`, {
        body: {
          // The API re-checks every package on lock; a client-side verification is never trusted.
          components: components.map(({ verified: _v, ...c }) => ({ ...c, package: c.package ?? null, selection_source: c.selection_source ?? "USER_SELECTED" })),
          rationale: "",
        },
      });
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "The stack could not be locked. Try again." });
    }
    // Land where the locked stack is on record, with a confirmation; the next
    // step (the technical design) is offered by the project's next-step bar.
    redirect(303, `/projects/${params.projectId}/stack?locked=1`);
  },
};

/** A layer's registry id as the form posts it ("npm:@sveltejs/kit"); anything else is none. */
function parsePackage(raw: string | undefined): StackPackage | null {
  const m = /^(npm|pypi|crates|github):(.{1,214})$/.exec((raw ?? "").trim());
  return m ? { registry: m[1] as StackPackage["registry"], name: m[2]! } : null;
}
