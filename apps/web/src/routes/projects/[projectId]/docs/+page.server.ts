import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import type { DesignSystemState } from "$lib/types.js";
import { foldRequirementSections, linkRequirementKeys, renderMarkdown, sectionChanges, type SectionChanges } from "$lib/markdown.js";

/** The page's h1 already names the document: drop the document's own leading "# Title". */
const withoutTitle = (content: string | null | undefined) => (content ?? "").replace(/^\s*#\s[^\n]*\n+/, "");
import { BAD_ID, formUuid } from "$lib/server/ids.js";

import { designReadinessIssues } from "@sdd/contracts";
import { approvalErrorIssues } from "$lib/design-editor.js";

const TABS = ["requirements", "stack", "design", "system"] as const;

export const load: PageServerLoad = async ({ fetch, cookies, params, url }) => {
  const session = sessionFrom(cookies);
  const requested = url.searchParams.get("tab") ?? "requirements";
  // The UI reference is edited on its canvas; older links to the Docs tab land there.
  if (requested === "ux") redirect(303, `/projects/${projectId(params)}/ux`);
  // The stack is its own chapter (the chooser and the locked view); older links land there.
  if (requested === "stack") redirect(303, `/projects/${projectId(params)}/stack${url.searchParams.get("locked") === "1" ? "?locked=1" : ""}`);
  const tab = (TABS as readonly string[]).includes(requested) ? (requested as (typeof TABS)[number]) : "requirements";
  // Set by the stack screen right after locking, for a one-time confirmation.
  const justLocked = url.searchParams.get("locked") === "1";
  // Arrived straight from a finished discovery: confirm it before asking for more.
  const fromDiscovery = url.searchParams.get("from") === "discovery";
  // Back from the hand-written editor.
  const saved = url.searchParams.get("saved") === "1";

  type Revision = { id: string; version: number; status: string; content: string; createdAt: string; structuredContent: unknown };
  type ArtifactView = { artifact: { id: string; approvedRevisionId: string | null } | null; revisions: Revision[] };
  type RequirementsView = {
    revision: { id: string; version: number; status: string; content: string; approvedAt: string | null } | null;
    approved_revision?: { id: string; version: number; content: string } | null;
    revisions?: Array<{ id: string; version: number; status: string; content: string }>;
    approved_requirements?: Array<{ key: string }>;
    requirements: Array<{ key: string; title: string; statement: string; priority: string; type: string; acceptance_criteria: Array<{ key: string; statement: string }> }>;
  };

  // No artifacts yet is a 200 with nulls from the API; any transport or auth
  // error propagates so an outage never masquerades as "no documents".
  type Routing = { effective: Array<{ role: string; configured: boolean; source?: string; model_id?: string; provider_type?: string }> };
  // One round: the documents must load (an error is the error page); the UI
  // design system and AI routing only enrich the page and fall back.
  const optional = Promise.all([
    api<DesignSystemState>(fetch, session, "GET", `/api/v1/projects/${projectId(params)}/design-system`).catch(
      (): DesignSystemState => ({ stack_approved: false, suggestions: [], approved: null, draft: null, stale: false }),
    ),
    api<Routing>(fetch, session, "GET", `/api/v1/projects/${projectId(params)}/ai-role-bindings`).catch(() => ({ effective: [] as Routing["effective"] })),
  ]);
  let requirements: RequirementsView, stack: ArtifactView, design: ArtifactView;
  try {
    [requirements, stack, design] = await Promise.all([
      api<RequirementsView>(fetch, session, "GET", `/api/v1/projects/${projectId(params)}/requirements`),
      api<ArtifactView>(fetch, session, "GET", `/api/v1/projects/${projectId(params)}/artifacts/stack`),
      api<ArtifactView>(fetch, session, "GET", `/api/v1/projects/${projectId(params)}/artifacts/design`),
    ]);
  } catch (e) {
    throwLoadError(e);
  }
  const [designSystem, routing] = await optional;

  // The kit preview of the version in use, drawn by the API like the editor's.
  const dsSpec = designSystem.approved?.spec ?? designSystem.draft?.spec ?? null;
  const dsPreview =
    tab === "system" && dsSpec
      ? await api<{ html: string }>(fetch, session, "POST", "/api/v1/design-systems/preview", { body: { spec: dsSpec, mode: "light" } })
          .then((r) => r.html)
          .catch(() => "")
      : "";

  // Which generation paths can actually run: without a model bound to the
  // role, writing by hand becomes the primary action instead of a dead button.
  const bound = (role: string) => routing.effective.some((r) => r.role === role && r.configured);
  const ai = { requirements: bound("SPECIFICATION"), design: bound("ARCHITECTURE") };

  // Rendered here, not in the browser: the markdown parser and sanitizer
  // were ~200 KB of the Docs page's client bundle.
  const docRevision = tab === "stack" ? stack.revisions[0] : tab === "design" ? design.revisions[0] : null;
  // Requirement keys the design mentions ("covers FR-001") link to that requirement.
  const requirementKeys = requirements.requirements.map((r) => r.key);
  const requirementHref = (key: string) => `/projects/${projectId(params)}/docs?tab=requirements#req-${key}`;
  const html = {
    requirements: tab === "requirements" ? foldRequirementSections(renderMarkdown(withoutTitle(requirements.revision?.content), { nested: true })) : "",
    doc: docRevision
      ? tab === "design"
        ? linkRequirementKeys(renderMarkdown(withoutTitle(docRevision.content), { nested: true }), requirementKeys, requirementHref)
        : renderMarkdown(withoutTitle(docRevision.content), { nested: true })
      : "",
  };

  // Before approving a draft: what it changes against the version in use
  // (else the one before it). `base: null` = the first version, nothing to compare.
  const changesOf = (
    draft: { version: number; status: string; content: string } | null | undefined,
    approved: { version: number; content: string } | null | undefined,
    revisions: Array<{ version: number; content: string }>,
  ): { base: number | null; items: SectionChanges } | null => {
    if (!draft || draft.status !== "DRAFT") return null;
    const base = approved && approved.version !== draft.version ? approved : (revisions.find((r) => r.version < draft.version) ?? null);
    return base
      ? { base: base.version, items: sectionChanges(base.content, draft.content) }
      : { base: null, items: { added: [], removed: [], changed: [] } };
  };
  const changes =
    tab === "requirements"
      ? changesOf(requirements.revision, requirements.approved_revision, requirements.revisions ?? [])
      : tab === "design"
        ? changesOf(design.revisions[0], design.revisions.find((r) => r.status === "APPROVED"), design.revisions)
        : null;

  // Only what the page reads: the API's `revisions` carries every version's full text.
  const requirementsView = { revision: requirements.revision, approved_revision: requirements.approved_revision ? { version: requirements.approved_revision.version } : null, requirements: requirements.requirements };
  const designIssues = design.revisions[0]?.status === "DRAFT"
    ? designReadinessIssues(design.revisions[0].structuredContent, (requirements.approved_requirements ?? requirements.requirements).map(r => r.key))
    : [];
  return { designIssues, tab, justLocked, fromDiscovery, saved, ai, html, changes, requirements: requirementsView, stack, design, designSystem, dsPreview, routing };
};

function projectId(params: { projectId: string }): string {
  return params.projectId;
}

export const actions: Actions = {
  generateRequirements: async ({ fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/artifacts/requirements/generate`, { body: {} });
      return { ok: true, notice: "Requirements generated — review the draft below." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Requirements generation failed — configure an AI profile or retry." });
    }
  },

  refineRequirements: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    try {
      await api(fetch, session, "POST", `/api/v1/projects/${params.projectId}/artifacts/requirements/refine`, {
        body: { instructions: String(form.get("instructions") ?? "") },
      });
      return { ok: true, notice: "A new draft revision was created." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Refinement failed." });
    }
  },

  approveRevision: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const artifactType = String(form.get("artifactType") ?? "");
    const revisionId = formUuid(form, "revisionId");
    if (!revisionId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/artifact-revisions/${revisionId}/approve`, { body: {} });
      // The step this unlocks is offered by the project's next-step bar, which
      // survives a reload; the notice only confirms what just happened.
      const what = artifactType === "requirements" ? "Requirements" : artifactType === "design" ? "Technical design" : "Revision";
      return { ok: true, notice: `${what} approved and locked — later changes become a new version.` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message, issues: approvalErrorIssues(error.details) });
      return fail(500, { message: "Approval failed." });
    }
  },
};
