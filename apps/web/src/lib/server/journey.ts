import { api, type Session } from "./api.js";
import { buildJourney, type Journey, type MilestoneId } from "$lib/journey.js";

type Fetch = typeof fetch;

/**
 * Everything the journey needs, fetched in one parallel round. Loaded by the
 * project layout so every project page can show the same next step.
 * Failures stay visible as unavailable status; guidance never invents a new-work state.
 */
export async function loadJourney(fetch: Fetch, session: Session, project: { id: string; lifecycleStatus: string }): Promise<Journey> {
  const unavailable: MilestoneId[] = [];
  const safe = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return await api<T>(fetch, session, "GET", path);
    } catch {
      const chapter: MilestoneId = path.includes("requirements") ? "requirements" : path.includes("stack") ? "stack" : path.includes("design-system") ? "system" : path.includes("design") ? "design" : path.includes("ux") ? "screens" : path.includes("tasks") ? "tasks" : path.includes("release-status") ? "release" : "build";
      if (!path.includes("ai-role-bindings")) unavailable.push(chapter);
      return fallback;
    }
  };
  const p = project.id;
  type ArtifactList = { artifact: { approvedRevisionId: string | null } | null; revisions: Array<{ status: string; version?: number }> };
  const [requirements, stack, design, ux, designSystem, tasks, release, routing] = await Promise.all([
    safe<{ revision: { status: string; version?: number } | null; approved_revision?: { id: string; version?: number } | null; requirements?: Array<{ priority: string }> }>(
      `/api/v1/projects/${p}/requirements`,
      { revision: null, approved_revision: null, requirements: [] },
    ),
    safe<ArtifactList>(`/api/v1/projects/${p}/artifacts/stack`, { artifact: null, revisions: [] }),
    safe<ArtifactList>(`/api/v1/projects/${p}/artifacts/design`, { artifact: null, revisions: [] }),
    // The summary counts screens in the database; the full state frames every drawing.
    safe<{ approved: { version: number; applicable: boolean | null; screens: number } | null; has_draft: boolean }>(`/api/v1/projects/${p}/ux/summary`, { approved: null, has_draft: false }),
    safe<{ approved: { spec?: { name?: string } } | null; draft: unknown | null } | null>(`/api/v1/projects/${p}/design-system`, null),
    safe<{ tasks: Array<{ id: string; key: string; title: string; workflowStatus: string }> }>(`/api/v1/projects/${p}/tasks?limit=1000`, { tasks: [] }),
    safe<{ features: Array<{ status: string; checked: boolean; can_complete: boolean }> }>(`/api/v1/projects/${p}/features/release-status`, { features: [] }),
    safe<{ effective: Array<{ role: string; configured: boolean }> } | null>(`/api/v1/projects/${p}/ai-role-bindings`, null),
  ]);

  const approvedVersion = (list: ArtifactList) => list.revisions.find((r) => r.status === "APPROVED")?.version ?? null;

  return buildJourney({
    unavailable,
    projectId: p,
    lifecycle: project.lifecycleStatus,
    requirements: {
      approved: Boolean(requirements.approved_revision) || requirements.revision?.status === "APPROVED",
      hasDraft: requirements.revision?.status === "DRAFT",
    },
    stackApproved: Boolean(stack.artifact?.approvedRevisionId),
    design: { approved: Boolean(design.artifact?.approvedRevisionId), hasDraft: design.revisions.some((r) => r.status === "DRAFT") },
    ux: {
      approved: Boolean(ux.approved?.applicable),
      notApplicable: ux.approved?.applicable === false,
      hasDraft: ux.has_draft,
    },
    designSystem: designSystem ? { approved: Boolean(designSystem.approved), hasDraft: Boolean(designSystem.draft) } : undefined,
    tasks: tasks.tasks,
    features: release.features.map((f) => ({ status: f.status, checked: f.checked, canComplete: f.can_complete })),
    facts: {
      requirements: {
        count: requirements.requirements?.length ?? 0,
        must: (requirements.requirements ?? []).filter((r) => r.priority === "P0").length,
        version: requirements.approved_revision?.version ?? requirements.revision?.version ?? null,
      },
      stack: { hasDraft: stack.revisions.some((r) => r.status === "DRAFT"), version: approvedVersion(stack) },
      design: { version: approvedVersion(design) },
      screens: { count: ux.approved?.screens ?? 0, version: ux.approved?.version ?? null },
      system: { name: designSystem?.approved?.spec?.name ?? null },
    },
    // Unknown routing (the call failed) keeps the AI path on offer.
    ai: routing ? { design: routing.effective.some((r) => r.role === "ARCHITECTURE" && r.configured) } : undefined,
  });
}
