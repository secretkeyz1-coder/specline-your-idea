import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { DesignSystemSpecSchema, type DesignSystemSpec } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { createDraftRevision, getApprovedRevision, getOrCreateArtifact, structuredOf } from "../artifact/service.js";
import { listStackComponents } from "../planning/stack.js";
import { checkPalette } from "./color.js";
import { designMarkdown, designSystemFiles, designSystemPackage, DESIGN_SYSTEM_DIR } from "./exports.js";
import { DS_DIRECTIONS } from "./directions.js";
import { COMPONENT_LIBRARIES, COMPONENT_ROLES, findLibrary, libraryInfo, MOCKUP_CLASS, suggestLibraries } from "./libraries.js";
import { DESIGN_SYSTEM_PRESETS } from "./presets.js";
import { previewHtml } from "./render.js";

/**
 * Design system (the "design_system" artifact): optional, after the stack is
 * locked — the library choice depends on it. Written by hand from presets, so
 * it needs no AI call; approval freezes it like any other artifact, and a
 * later stack change marks it stale.
 */

export function catalog() {
  return { presets: DESIGN_SYSTEM_PRESETS, libraries: COMPONENT_LIBRARIES.map(libraryInfo), directions: DS_DIRECTIONS };
}

/** What the agent gets for a spec (USAGE.md, DESIGN.md, tokens.css, design-tokens.json, craft) — nothing is stored. */
export function renderPackage(input: unknown) {
  const parsed = DesignSystemSpecSchema.safeParse(input);
  if (!parsed.success) throw errors.validation("The design system is incomplete or has invalid values", parsed.error.flatten());
  return designSystemPackage(parsed.data);
}

/** Validate a spec and refuse palettes a person could not read. */
export function validateSpec(input: unknown): DesignSystemSpec {
  const parsed = DesignSystemSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw errors.validation("The design system is incomplete or has invalid values", parsed.error.flatten());
  }
  const spec = parsed.data;
  if (!findLibrary(spec.component_library)) throw errors.validation(`Unknown component library "${spec.component_library}"`);
  const failing = [...checkPalette(spec.light, "light"), ...checkPalette(spec.dark, "dark")].filter((c) => !c.ok);
  if (failing.length) {
    throw errors.validation(
      `Some colours are too hard to read: ${failing.map((f) => `${f.pair.toLowerCase()} in ${f.mode} mode (${f.ratio}:1, needs ${f.minimum}:1)`).join("; ")}`,
      { contrast: failing },
    );
  }
  return spec;
}

export function renderPreview(input: unknown, mode: "light" | "dark") {
  const parsed = DesignSystemSpecSchema.safeParse(input);
  if (!parsed.success) throw errors.validation("The design system is incomplete or has invalid values", parsed.error.flatten());
  const spec = parsed.data;
  return {
    html: previewHtml(spec, mode),
    contrast: [...checkPalette(spec.light, "light"), ...checkPalette(spec.dark, "dark")],
  };
}

async function stackOf(db: DbExecutor, projectId: string) {
  const approved = await getApprovedRevision(db, projectId, "stack");
  if (!approved) return null;
  return { revision: approved, components: await listStackComponents(db, approved.revision.id) };
}

export async function getDesignSystemState(db: DbExecutor, projectId: string) {
  const stack = await stackOf(db, projectId);
  const suggestions = stack ? suggestLibraries(stack.components.map((c) => ({ category: c.category, technology: c.technology }))) : [];
  const [artifact] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), eq(schema.artifacts.artifactType, "design_system")))
    .limit(1);
  const base = { stack_approved: Boolean(stack), suggestions };
  if (!artifact) return { ...base, approved: null, draft: null, stale: false };
  const revisions = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.artifactId, artifact.id));
  const approved = revisions.find((r) => r.id === artifact.approvedRevisionId && r.status === "APPROVED") ?? null;
  const draft = revisions.find((r) => r.id === artifact.currentDraftRevisionId && r.status === "DRAFT") ?? null;
  const latest = [...revisions].sort((a, b) => b.version - a.version)[0];
  const view = (r: typeof approved) => {
    if (!r) return null;
    const spec = structuredOf<DesignSystemSpec>(r);
    return { revision_id: r.id, version: r.version, approved_at: r.approvedAt, spec, library_name: spec ? (findLibrary(spec.component_library)?.name ?? spec.component_library) : null };
  };
  return { ...base, approved: view(approved), draft: view(draft), stale: !approved && latest?.status === "STALE" };
}

/** Save the person's choice as a draft revision, ready to approve. */
export async function saveDesignSystemDraft(db: DbExecutor, input: { projectId: string; userId: string; spec: unknown }) {
  const stack = await stackOf(db, input.projectId);
  if (!stack) throw errors.conflict("STACK_NOT_APPROVED", "Lock the stack first — the component library depends on it");
  const spec = validateSpec(input.spec);
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "design_system" });
  const revision = await createDraftRevision(db, {
    artifactId: artifact.id,
    structuredContent: spec,
    content: designMarkdown(spec),
    actorType: "USER",
    actorId: input.userId,
    derivedFrom: [{ artifact_id: stack.revision.artifact.id, version: stack.revision.revision.version }],
  });
  return { revision, spec };
}

/** The approved design system, for UI-reference screens, tasks and the work order. */
export async function approvedDesignSystem(
  db: DbExecutor,
  projectId: string,
): Promise<{ spec: DesignSystemSpec; version: number; artifactId: string } | null> {
  const approved = await getApprovedRevision(db, projectId, "design_system");
  const spec = approved ? structuredOf<DesignSystemSpec>(approved.revision) : null;
  return spec && approved ? { spec, version: approved.revision.version, artifactId: approved.artifact.id } : null;
}

export async function exportDesignSystem(db: DbExecutor, projectId: string) {
  const ds = await approvedDesignSystem(db, projectId);
  if (!ds) return { version: null, dir: DESIGN_SYSTEM_DIR, files: [] };
  return { version: ds.version, dir: DESIGN_SYSTEM_DIR, files: designSystemFiles(ds.spec, ds.version) };
}

/** A compact brief for prompts: library, component names and the style rules. */
export function designSystemBrief(spec: DesignSystemSpec, opts: { mockupClasses?: boolean } = {}): string {
  const lib = findLibrary(spec.component_library);
  return [
    `DESIGN SYSTEM: ${spec.name} — ${spec.summary}`,
    `Component library: ${lib?.name ?? spec.component_library}. Theme files and tokens live in ${DESIGN_SYSTEM_DIR}/ (read DESIGN.md there first).`,
    `Fonts: display ${spec.fonts.display.split(",")[0]}, body ${spec.fonts.body.split(",")[0]}. Radius ${spec.radius}px, density ${spec.density}, depth ${spec.depth}, border ${spec.border_width}px.`,
    "Font resources: CSS family names do not load fonts. Use locally bundled or explicitly configured resources, verify document.fonts in the render test, and report the system fallback when an asset is unavailable. Keep system-ui/monospace fallbacks; do not claim a custom font rendered from its CSS name alone.",
    `Components to use (UI role → ${opts.mockupClasses ? "mockup class → " : ""}library component):`,
    ...COMPONENT_ROLES.map((r) => `- ${r}: ${opts.mockupClasses ? `${MOCKUP_CLASS[r]} → ` : ""}${lib?.components[r] ?? r}`),
    `Style guidance:`,
    spec.guidance,
  ].join("\n");
}
