import { and, eq, inArray } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { ArtifactType, DesignSystemSpec, TaskContract, UxReference, UxScreen } from "@sdd/contracts";
import { getApprovedRevision, isRefCurrent, structuredOf } from "../artifact/service.js";
import { findLibrary } from "../design-system/libraries.js";
import { DESIGN_SYSTEM_DIR } from "../design-system/exports.js";
import { uxFilePath } from "../ux/ux-draft.js";

/**
 * What the copyable prompts may build on: the APPROVED planning artifacts only.
 * A draft, a stale revision or a skipped optional artifact is never embedded;
 * the prompt says so in plain words instead, and warns when the tasks were cut
 * from an older approved version than the one approved now.
 */

export type SpecKind = "requirements" | "stack" | "design" | "ux" | "design_system";

export const SPEC_LABEL: Record<SpecKind, string> = {
  requirements: "Product requirements",
  stack: "Tech stack",
  design: "Technical design",
  ux: "UI reference",
  design_system: "Design system",
};

/** The state of one planning artifact, as far as a prompt is concerned. */
export type SpecState =
  | { state: "approved"; version: number; newerDraft: number | null }
  | { state: "not_applicable"; version: number }
  | { state: "draft"; version: number }
  | { state: "stale"; version: number }
  | { state: "none" };

const REQUIRED: SpecKind[] = ["requirements", "stack", "design"];

/**
 * One sentence per artifact that is NOT usable as approved (or approved with a
 * newer unapproved draft next to it). Null when the approved version stands
 * alone and needs no comment.
 */
export function specStatusNote(kind: SpecKind, s: SpecState): string | null {
  const label = SPEC_LABEL[kind];
  const required = REQUIRED.includes(kind);
  switch (s.state) {
    case "approved":
      return s.newerDraft
        ? `${label}: v${s.version} is approved and binding; v${s.newerDraft} is an unapproved draft — ignore it.`
        : null;
    case "not_applicable":
      return kind === "ux"
        ? `${label}: not applicable (the product has no user interface to mock up) — follow the technical design only.`
        : `${label}: not applicable.`;
    case "draft":
      return required
        ? `${label}: NOT APPROVED — v${s.version} is a draft awaiting approval in the web app, so it is left out. Do not build on it; stop and ask the user to approve it.`
        : `${label}: v${s.version} is an unapproved draft, so it is left out — ${optionalFallback(kind)}`;
    case "stale":
      return required
        ? `${label}: NOT APPROVED — v${s.version} went stale after an upstream change and must be approved again, so it is left out. Stop and ask the user to re-approve it.`
        : `${label}: stale — v${s.version} predates an upstream change and is no longer approved, so it is left out — ${optionalFallback(kind)}`;
    case "none":
      return required
        ? `${label}: none approved yet, so it is left out. Stop and ask the user to finish it in the web app.`
        : `${label}: skipped — ${optionalFallback(kind)}`;
  }
}

function optionalFallback(kind: SpecKind): string {
  return kind === "ux"
    ? "follow the technical design and the design system (or the stack's defaults) for layout."
    : "take visual styling from the stack's defaults and the UI reference, and do not invent a new look.";
}

/** A task's lineage against the version approved now, per artifact. */
export interface LineageEntry {
  kind: SpecKind;
  /** The version approved now, or null when the artifact is no longer approved at all. */
  approvedVersion: number | null;
  /** Tasks whose recorded version differs from (and is not identical to) the approved one. */
  outdated: Array<{ taskKey: string; usedVersion: number }>;
}

/**
 * Warnings for tasks cut from an older version of an artifact than the one
 * approved now (or from a UI reference / design system no longer approved).
 */
export function lineageNotes(entries: LineageEntry[], opts: { single?: boolean } = {}): string[] {
  const notes: string[] = [];
  for (const e of entries) {
    if (!e.outdated.length) continue;
    const label = SPEC_LABEL[e.kind];
    const used = [...new Set(e.outdated.map((o) => o.usedVersion))].sort((a, b) => a - b).map((v) => `v${v}`).join(", ");
    const keys = `${e.outdated.slice(0, 8).map((o) => o.taskKey).join(", ")}${e.outdated.length > 8 ? ", …" : ""}`;
    const who = opts.single ? "This task was" : e.outdated.length === 1 ? `1 task (${keys}) was` : `${e.outdated.length} tasks (${keys}) were`;
    notes.push(
      e.approvedVersion === null
        ? `${who} cut with ${label} ${used}, which is no longer approved. Check the task against the current specs before building it; stop and report a conflict.`
        : `${who} cut from ${label} ${used}; v${e.approvedVersion} is approved now. The approved v${e.approvedVersion} wins: where the task contract contradicts it, stop and report instead of guessing.`,
    );
  }
  return notes;
}

/** Layers of the approved stack, one line each. */
export function stackLayerLines(layers: Array<{ category: string; technology: string; version?: string | null }>): string[] {
  return layers.map((l) => `- ${l.category}: ${l.technology}${l.version ? ` (${l.version})` : ""}`);
}

const PALETTE_ORDER = ["bg", "surface", "surface2", "fg", "fgMuted", "border", "borderStrong", "accent", "accentFg", "success", "warn", "danger", "info"];

/** The design system's essentials inline: the agent needs them even before `sddctl ui pull` ran. */
export function designSystemEssentials(spec: DesignSystemSpec, version: number): string[] {
  const lib = findLibrary(spec.component_library);
  const palette = (mode: "light" | "dark") => {
    const colours = spec[mode] as Record<string, string>;
    const keys = [...PALETTE_ORDER.filter((k) => k in colours), ...Object.keys(colours).filter((k) => !PALETTE_ORDER.includes(k))];
    return `- ${mode}: ${keys.map((k) => `${k} ${colours[k]}`).join(", ")}`;
  };
  return [
    `**${spec.name}** (v${version})${spec.summary ? ` — ${spec.summary}` : ""}`,
    `Component library: ${lib?.name ?? spec.component_library}. Theme files and tokens: \`${DESIGN_SYSTEM_DIR}/\` (read DESIGN.md there first).`,
    `Fonts: display ${spec.fonts.display}; body ${spec.fonts.body}; mono ${spec.fonts.mono}.`,
    `Shape: radius ${spec.radius}px (cards 1.5x), density ${spec.density}, depth ${spec.depth}, border ${spec.border_width}px.`,
    `Colour tokens:`,
    palette("light"),
    palette("dark"),
    ...(spec.guidance.trim() ? [`Style guidance:`, spec.guidance.trim()] : []),
  ];
}

/** Task types that build or change user interface, and so get the screens their requirements touch. */
export const UI_TASK_TYPES = new Set(["frontend", "code", "integration", "bugfix", "test", "refactor"]);

/**
 * The UI-reference screens one task builds: any screen whose file the contract
 * names, plus — for tasks that touch UI — every screen serving one of the
 * task's requirements.
 */
export function relevantScreens(
  screens: UxScreen[],
  task: { taskType: string; requirementKeys: string[]; contract: TaskContract | null; objective?: string },
): UxScreen[] {
  const c = task.contract;
  const text = [
    task.objective ?? "",
    ...(c?.constraints ?? []),
    ...(c?.scope?.expected_paths ?? []),
    ...(c?.deliverables ?? []),
    ...(c?.acceptance_criteria ?? []),
  ].join("\n");
  const keys = new Set(task.requirementKeys);
  return screens.filter(
    (s) =>
      text.includes(uxFilePath(s.key)) ||
      (UI_TASK_TYPES.has(task.taskType) && s.requirement_keys.some((k) => keys.has(k))),
  );
}

/* ── Database reads ── */

/** The state of every planning artifact of a project, in one pass. */
export async function specStates(db: DbExecutor, projectId: string): Promise<Record<SpecKind, SpecState>> {
  const kinds: SpecKind[] = ["requirements", "stack", "design", "ux", "design_system"];
  const artifacts = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), inArray(schema.artifacts.artifactType, kinds as ArtifactType[])));
  const revisions = artifacts.length
    ? await db
        .select({
          id: schema.artifactRevisions.id,
          artifactId: schema.artifactRevisions.artifactId,
          version: schema.artifactRevisions.version,
          status: schema.artifactRevisions.status,
        })
        .from(schema.artifactRevisions)
        .where(inArray(schema.artifactRevisions.artifactId, artifacts.map((a) => a.id)))
    : [];
  const out = {} as Record<SpecKind, SpecState>;
  for (const kind of kinds) {
    const artifact = artifacts.find((a) => a.artifactType === kind);
    const own = revisions.filter((r) => r.artifactId === artifact?.id).sort((a, b) => b.version - a.version);
    const approved = own.find((r) => r.id === artifact?.approvedRevisionId && r.status === "APPROVED");
    const latest = own[0];
    if (approved) {
      const newer = own.find((r) => r.status === "DRAFT" && r.version > approved.version);
      out[kind] = { state: "approved", version: approved.version, newerDraft: newer?.version ?? null };
    } else if (!latest) out[kind] = { state: "none" };
    else if (latest.status === "STALE") out[kind] = { state: "stale", version: latest.version };
    else if (latest.status === "DRAFT") out[kind] = { state: "draft", version: latest.version };
    else out[kind] = { state: "none" };
  }
  // An approved UI reference that declares no user interface is "not applicable", not a mockup set.
  if (out.ux.state === "approved") {
    const approved = await getApprovedRevision(db, projectId, "ux");
    const ref = approved ? structuredOf<UxReference>(approved.revision) : null;
    if (ref && !ref.applicable) out.ux = { state: "not_applicable", version: out.ux.version };
  }
  return out;
}

/** Lineage of the given tasks against the artifacts approved now (see readiness). */
export async function taskLineage(
  db: DbExecutor,
  projectId: string,
  tasks: Array<{ key: string; createdFromRevisionIds: Array<{ artifact_id: string; version: number }> }>,
): Promise<LineageEntry[]> {
  const kinds: SpecKind[] = ["requirements", "stack", "design", "ux", "design_system"];
  const artifacts = await db
    .select({ id: schema.artifacts.id, type: schema.artifacts.artifactType })
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), inArray(schema.artifacts.artifactType, kinds as ArtifactType[])));
  const entries: LineageEntry[] = [];
  for (const kind of kinds) {
    const artifact = artifacts.find((a) => a.type === kind);
    if (!artifact) continue;
    const approved = await getApprovedRevision(db, projectId, kind);
    const verdicts = new Map<number, boolean>();
    const outdated: LineageEntry["outdated"] = [];
    for (const t of tasks) {
      const ref = t.createdFromRevisionIds.find((r) => r.artifact_id === artifact.id);
      if (!ref) continue;
      if (!verdicts.has(ref.version)) verdicts.set(ref.version, approved ? await isRefCurrent(db, ref, approved) : false);
      if (!verdicts.get(ref.version)) outdated.push({ taskKey: t.key, usedVersion: ref.version });
    }
    entries.push({ kind, approvedVersion: approved?.revision.version ?? null, outdated });
  }
  return entries;
}

/** Approved stack layers, with the version constraint each was locked at. */
export async function approvedStackLayers(db: DbExecutor, projectId: string) {
  const approved = await getApprovedRevision(db, projectId, "stack");
  if (!approved) return null;
  const rows = await db.select().from(schema.stackComponents).where(eq(schema.stackComponents.stackRevisionId, approved.revision.id));
  return {
    version: approved.revision.version,
    layers: rows.map((r) => ({ category: r.category, technology: r.technology, version: r.versionConstraint ?? null })),
  };
}
