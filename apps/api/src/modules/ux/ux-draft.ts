import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import {
  UX_SCREEN_HISTORY,
  type UxSampleData,
  type DesignArtifact,
  type UxComment,
  type UxLintFinding,
  type UxReference,
  type UxScreen,
  type UxScreenVersion,
  type UxVisualBrief,
  type DesignSystemSpec,
} from "@sdd/contracts";
import { errors } from "@sdd/shared";
import { getApprovedRevision, getOrCreateArtifact, isRefCurrent, structuredOf } from "../artifact/service.js";
import { listRequirementsForRevision } from "../planning/requirements.js";
import { listStackComponents } from "../planning/stack.js";
import { getProject } from "../project/service.js";
import { approvedDesignSystem } from "../design-system/service.js";
import { sanitizeHtml } from "./ux-sanitize.js";
import { separateStyles } from "./ux-html-parser.js";
import { NEUTRAL_SPEC, assembleScreen, nodeTexts, screenContent } from "./ux-shell.js";
import { lintOptionsFor, lintScreenHtml } from "./ux-lint.js";
import { renderDigest, renderLint, renderUnchecked } from "./ux-render.js";
import { platformOf, renderSizes } from "./ux-platform.js";
import { effectiveLayout, templateDesignSystem } from "./ux-layout.js";

/** The UI-reference draft underneath every change: planning context, the row-locked draft (mutateDraft), version markers, comments' anchors, the checks a screen gets, and the stored markdown. */

export const MAX_HTML_BYTES = 150_000;

export const uxFilePath = (key: string) => `docs/ui-reference/${key}.html`;

export function slug(value: string, taken: Set<string>): string {
  const base =
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "screen";
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
  taken.add(key);
  return key;
}

export function renderUxMarkdown(ref: UxReference): string {
  if (!ref.applicable) return `# UI reference\n\nNot applicable: ${ref.reason || "this product has no user interface."}\n`;
  return [
    "# UI reference",
    "",
    ref.fidelity === "styled"
      ? "Mockups of the key screens drawn with the approved design system. Layout, elements, flow and look are binding."
      : "Mid-fidelity, neutral mockups of the key screens. Layout, elements and flow are binding; visual styling follows the stack.",
    "",
    ...(ref.count_conflict?.uncovered.length
      ? [`Count conflict: at ${ref.requested_count ?? ref.screens.length} screens, ${ref.count_conflict.uncovered.join(", ")} ${ref.count_conflict.uncovered.length === 1 ? "has" : "have"} no screen (at least ${ref.count_conflict.minimum_count} needed). ${ref.count_conflict.note}`.trim(), ""]
      : []),
    ...(ref.platform?.kind === "native-mobile"
      ? [`Platform: an Android app (Material 3) for ${ref.platform.devices.map((d) => d.replace("-", " ")).join(", ")}. The mockups are HTML pictures of native screens: build them with the stack's own components.`, ""]
      : []),
    ...briefMarkdown(ref.brief),
    ...(ref.layout_reference
      ? [`Layout reference: "${ref.layout_reference.name}" — ${ref.layout_reference.brief.archetype}. Screens follow its layout; their content and look come from the requirements and the kit.`, ""]
      : []),
    ...(ref.uncovered_scope?.length ? ["Left out (beyond the screen limit):", ...ref.uncovered_scope.map((u) => `- ${u}`), ""] : []),
    ...(ref.no_ui_requirements?.length ? ["Requirements with nothing to see:", ...ref.no_ui_requirements.map((r) => `- ${r.key}${r.reason ? `: ${r.reason}` : ""}`), ""] : []),
    "Static mockups show layout and content; behaviour (focus, keyboard, validation, what happens after an action) is built and tested in the tasks.",
    "",
    ...ref.screens.flatMap((s) => [
      `## ${s.name} (\`${s.key}\`)`,
      "",
      s.purpose,
      "",
      s.requirement_keys.length ? `Requirements: ${s.requirement_keys.join(", ")}` : "",
      "Key elements:",
      ...s.key_elements.map((e) => `- ${e}`),
      ...(s.primary_action?.label ? [`Primary action: ${s.primary_action.label}${s.primary_action.result ? ` → ${s.primary_action.result}` : ""}`] : []),
      ...(s.overlays?.length
        ? ["Overlays:", ...s.overlays.map((o) => `- ${o.kind}: ${o.name}${o.purpose ? ` — ${o.purpose}` : ""}${o.result ? ` → ${o.result}` : ""}`)]
        : []),
      // Every state is written down, drawn or not: two frames are pictures, the rest are behaviour to build.
      ...(s.states?.length ? ["States:", ...s.states.map((st) => `- ${st.state}${st.when ? ` (${st.when})` : ""}${st.response ? `: ${st.response}` : ""}`)] : []),
      ...(s.layout_note ? [`Composition: ${s.layout_note}`] : []),
      ...(s.layout_reference ? [`Layout reference (this screen): "${s.layout_reference.name}" — ${s.layout_reference.brief.archetype}`] : []),
      "",
      `File: \`${uxFilePath(s.key)}\`${s.html ? "" : " (not generated yet)"}`,
      "",
    ]),
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
}

/** The brief's parts with their labels, in the order the rules list them (aturan.md §4 Lapis 1). */
function briefRows(brief: UxVisualBrief): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Users and context", brief.users],
    ["Devices", brief.devices],
    ["Visual direction", brief.direction],
    ["Hierarchy and content", brief.hierarchy],
    ["References and limits", brief.references],
  ];
  return rows.filter(([, value]) => value.trim());
}

/** The product brief in the stored markdown, so the tasks read the same direction the screens were drawn with. */
function briefMarkdown(brief: UxVisualBrief | undefined): string[] {
  if (!brief) return [];
  const rows = briefRows(brief);
  if (!rows.length && !brief.assumptions.length) return [];
  return [
    "Product brief:",
    ...rows.map(([label, value]) => `- ${label}: ${value}`),
    ...(brief.assumptions.length ? [`- Assumed (not stated in the requirements): ${brief.assumptions.join("; ")}`] : []),
    "",
  ];
}

/**
 * The product's visual brief as the plan, draw, redraw and element prompts
 * carry it. It decides composition, emphasis and media; it never adds a
 * feature. Its assumptions are named as such, so the model does not treat a
 * guess as a requirement.
 */
export function briefLines(brief: UxVisualBrief | undefined): string[] {
  if (!brief) return [];
  const rows = briefRows(brief);
  if (!rows.length && !brief.assumptions.length) return [];
  return [
    `PRODUCT BRIEF (${brief.source === "user" ? "written by the person" : "drafted from the requirements"} — let it decide composition, emphasis, density and media; it never adds features or data):`,
    ...rows.map(([label, value]) => `- ${label}: ${value}`),
    ...(brief.assumptions.length ? [`- Assumed, not stated in the requirements: ${brief.assumptions.join("; ")}`] : []),
  ];
}

/** What a brief edit was made against: a digest of the brief as the page saw it ("-" when there was none). */
export function briefBase(brief: UxVisualBrief | undefined): string {
  return brief ? createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 16) : "-";
}

/** The approved requirements' titles by key, for prompts that name what a screen serves; empty when none are approved. */
export async function requirementTitles(db: DbExecutor, projectId: string): Promise<Map<string, string>> {
  const approved = await getApprovedRevision(db, projectId, "requirements");
  if (!approved) return new Map();
  return new Map((await listRequirementsForRevision(db, approved.revision.id)).map((r) => [r.key, r.title]));
}

/** Remove an injected design-system stylesheet (it is re-added after each draw). */
export function stripDesignSystem(html: string): string {
  return separateStyles(html, attrs => Object.hasOwn(attrs, "data-design-system")).html;
}

/** Keep only the HTML document, whatever the model wrapped around it. */
export function extractHtml(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  const end = t.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) t = t.slice(0, end + "</html>".length);
  return t;
}

/**
 * The reference is shown in a sandboxed iframe with a restrictive CSP, and
 * later written into a user's repository — everything active is removed
 * anyway (a parser-based allowlist, ux-sanitize.ts), so the stored document
 * is inert wherever it ends up.
 */
export { sanitizeHtml };

/**
 * What a canvas edit was made against: the screen's newest history entry and
 * how many there are. Every change of a screen's content pushes a history
 * entry (with its own time) or pops one (undo), so the marker changes with
 * the content; comments and checks, which leave the content alone, leave it
 * alone. The canvas has the same history, so it sends the marker as it saw it.
 */
export function screenBase(screen: Pick<UxScreen, "history">): string {
  const history = screen.history ?? [];
  return `${history[0]?.at ?? "-"}#${history.length}`;
}

/** A conflict when the screen changed after the canvas read it; no base (an older client) is not checked. */
export function checkBase(screen: UxScreen, base: string | undefined) {
  if (base !== undefined && base !== screenBase(screen)) {
    throw errors.conflict("UX_SCREEN_CHANGED", "The screen changed since you opened it — it was reloaded; make the change again");
  }
}

/** The words of an anchor ("Button: Save changes" → "save changes"), without the canvas's ellipsis. */
function anchorWords(anchor: string): string {
  const i = anchor.indexOf(": ");
  return (i === -1 ? "" : anchor.slice(i + 2)).replace(/…$/, "").replace(/\s+/g, " ").trim();
}

/**
 * Comments pinned to a screen whose content changed (a redraw renumbers the
 * elements from n1; an edit or undo moves them): a comment keeps its element
 * while that element still says what the comment was made on, else moves to
 * the element that does (the innermost one), else is detached (nid null — the
 * canvas shows "element no longer exists").
 */
export function reanchorComments(comments: UxComment[] | undefined, content: string): UxComment[] | undefined {
  if (!comments?.length) return comments;
  const nodes = nodeTexts(content);
  const byNid = new Map(nodes.map((n) => [n.nid, n.text]));
  return comments.map((c) => {
    const words = anchorWords(c.anchor);
    const says = (text: string) => !words || text.startsWith(words);
    if (c.nid && byNid.has(c.nid) && says(byNid.get(c.nid)!)) return c;
    let best: { nid: string; text: string } | null = null;
    if (words) {
      for (const n of nodes) if (n.text.startsWith(words) && (!best || n.text.length <= best.text.length)) best = n;
    }
    return { ...c, nid: best?.nid ?? null };
  });
}

export async function planningContext(db: DbExecutor, projectId: string) {
  const project = await getProject(db, projectId);
  const approvedReq = await getApprovedRevision(db, projectId, "requirements");
  if (!approvedReq) throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve the requirements first");
  const approvedStack = await getApprovedRevision(db, projectId, "stack");
  if (!approvedStack) throw errors.conflict("STACK_NOT_APPROVED", "Lock the stack first");
  const approvedDesign = await getApprovedRevision(db, projectId, "design");
  if (!approvedDesign) throw errors.conflict("DESIGN_NOT_APPROVED", "Approve the technical design before creating a UI reference");
  const reqs = await listRequirementsForRevision(db, approvedReq.revision.id);
  const stack = await listStackComponents(db, approvedStack.revision.id);
  const design = structuredOf<DesignArtifact>(approvedDesign.revision);
  const text = [
    `PROJECT: ${project.name}`,
    `IDEA: ${project.highLevelIdea}`,
    "",
    "APPROVED STACK:",
    ...stack.map((s) => `- ${s.category}: ${s.technology}`),
    "",
    "APPROVED REQUIREMENTS:",
    ...reqs.map(
      (r) => `- ${r.key} [${r.priority}] ${r.title}\n  ${r.statement}\n${r.acceptance_criteria.map((ac) => `  · ${ac.key}: ${ac.statement}`).join("\n")}`,
    ),
    "",
    "FULL APPROVED TECHNICAL DESIGN (permissions, transitions, errors and limits apply to UI):",
    JSON.stringify(design),
    "APPROVED PRODUCT CONTEXT:",
    JSON.stringify(approvedReq.revision.structuredContent),
    "PROJECT RULES:",
    ...project.projectRules,
    "DESIGN OVERVIEW:",
    design?.overview ?? "",
    "",
    "COMPONENTS:",
    ...(design?.components ?? []).map((c) => `- ${c.name}: ${c.responsibility}`),
  ].join("\n");
  return {
    project,
    text,
    requirementKeys: reqs.map((r) => r.key),
    requirements: reqs.map((r) => ({ key: r.key, priority: r.priority })),
    derivedFrom: [
      { artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version },
      { artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version },
      { artifact_id: approvedDesign.artifact.id, version: approvedDesign.revision.version },
    ],
  };
}

/**
 * Whether a reference was planned from the requirements, stack and technical
 * design approved now (the same version, or one with the same content). A
 * reference that went stale only because its design system changed passes:
 * its screens still describe the product, only their drawings are outdated.
 */
export async function planInputsCurrent(db: DbExecutor, projectId: string, derivedFrom: Array<{ artifact_id: string; version: number }>): Promise<boolean> {
  for (const type of ["requirements", "stack", "design"] as const) {
    const approved = await getApprovedRevision(db, projectId, type);
    if (!approved) return false;
    if (!(await isRefCurrent(db, derivedFrom.find((d) => d.artifact_id === approved.artifact.id), approved))) return false;
  }
  return true;
}

/** The current draft revision, or a conflict when there is nothing to edit. */
export async function currentDraft(db: DbExecutor, projectId: string) {
  const artifact = await getOrCreateArtifact(db, { projectId, artifactType: "ux" });
  const draftId = artifact.currentDraftRevisionId;
  const [draft] = draftId ? await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, draftId)).limit(1) : [];
  if (!draft || draft.status !== "DRAFT") {
    throw errors.conflict("UX_NO_DRAFT", "There is no UI reference draft — plan the screens first");
  }
  return { artifact, draft };
}

/**
 * Change the draft's reference under a row lock: screens are drawn in
 * parallel and each finishes on its own, so every write re-reads the latest.
 *
 * The draft must still be the artifact's current one. A drawing or an AI
 * edit takes a while; if "Plan again" or "Revise" made a new draft meanwhile,
 * the old one is still a DRAFT row, and the change used to land there —
 * saved, and never seen again. The artifact row is locked first (the order
 * approval and new drafts lock in), then the revision.
 */
export async function mutateDraft(db: DbExecutor, draftId: string, change: (current: UxReference) => UxReference) {
  return db.transaction(async (tx) => {
    const [ref] = await tx.select({ artifactId: schema.artifactRevisions.artifactId }).from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, draftId)).limit(1);
    if (!ref) throw errors.conflict("UX_NO_DRAFT", "This UI reference draft is no longer editable");
    const [artifact] = await tx.select().from(schema.artifacts).where(eq(schema.artifacts.id, ref.artifactId)).for("update").limit(1);
    const [row] = await tx.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, draftId)).for("update").limit(1);
    if (!row || row.status !== "DRAFT") throw errors.conflict("UX_NO_DRAFT", "This UI reference draft is no longer editable");
    if (artifact?.currentDraftRevisionId !== draftId) {
      throw errors.conflict("UX_DRAFT_REPLACED", "The draft was replaced (plan again or revise) — reload");
    }
    const before = structuredOf<UxReference>(row)!;
    const lintOf = new Map(before.screens.map((s) => [s.key, s.lint]));
    const next = change(before);
    // A screen whose findings were replaced records what their render measured (or that none ran).
    for (const s of next.screens ?? []) {
      if (s.lint !== lintOf.get(s.key)) s.render_digest = renderStampOf(s.lint);
    }
    const [saved] = await tx
      .update(schema.artifactRevisions)
      .set({
        structuredContent: next as never,
        content: renderUxMarkdown(next),
        checksum: createHash("sha256").update(JSON.stringify(next)).digest("hex"),
      })
      .where(and(eq(schema.artifactRevisions.id, row.id), eq(schema.artifactRevisions.status, "DRAFT")))
      .returning();
    return saved!;
  });
}

/** The drawn content of a reference's screens (all, or all but one), for the tones its badges already use. */
export function drawnHtml(ref: UxReference, except: string | null): string[] {
  return ref.screens.filter((s) => s.html && s.key !== except).map((s) => screenContent(s.html!));
}

/** The shared example data as the screen and element prompts carry it. */
export function sampleDataLines(sheet: UxSampleData | undefined): string[] {
  if (!sheet || (!sheet.records.length && !sheet.people.length && !sheet.notes && !sheet.statuses?.length)) return [];
  return [
    "SHARED EXAMPLE DATA (show the subset relevant to this screen; preserve names, facts, linked IDs, statuses and dates across screens. Do not invent related transaction/request histories independently. If history is not supplied, show a clearly labelled empty history or the supplied records only; illustrate other states in the planned frames, not fabricated rows):",
    ...sheet.records.map((r) => `- ${r.kind}: ${r.name}${r.facts ? ` — ${r.facts}` : ""}`),
    ...(sheet.people.length ? [`- People: ${sheet.people.map((p) => `${p.name} (${p.role})`).join(", ")}`] : []),
    ...(sheet.notes ? [`- Notes: ${sheet.notes}`] : []),
    ...(sheet.statuses?.length ? [`- Status badges (tone class): ${sheet.statuses.map((s) => `${s.label} = ${s.tone === "neutral" ? "ds-badge" : `ds-badge-${s.tone}`}`).join(", ")}`] : []),
    ...(sheet.aggregates?.length
      ? [`- Aggregates (the only totals and KPIs a stat card may show besides the records): ${sheet.aggregates.map((a) => `${a.label} = ${a.value}${a.basis ? ` (${a.basis})` : ""}`).join("; ")}`]
      : []),
  ];
}

/**
 * The digest of what a screenLint render measured rides on the findings array
 * it returns (not serialised); mutateDraft copies it to `render_digest` when a
 * screen's lint is replaced, so every write path records it without passing it on.
 */
export const RENDER_STAMP = Symbol("render digest");
type Stamped = UxLintFinding[] & { [RENDER_STAMP]?: string };

/** The render digest a findings list carries, if it came from a render that ran. */
export function renderStampOf(lint: unknown): string | null {
  return Array.isArray(lint) ? ((lint as Stamped)[RENDER_STAMP] ?? null) : null;
}

/** The framed document and sizes a screen is rendered at, for its checks and approval. */
export function framedForRender(content: string, ref: UxReference, screenKey: string, spec: DesignSystemSpec, brand: string) {
  const sizes = renderSizes(platformOf(ref));
  const html = assembleScreen({ content, spec, brand, screens: ref.screens, currentKey: screenKey, shell: ref.shell, platform: ref.platform, generator: ref.generator });
  return { html, sizes, digest: renderDigest(html, sizes) };
}

/**
 * Every finding on a screen's content: the HTML lint, plus the render check of
 * the screen as it will be framed (the platform's narrowest and widest device).
 * Without a browser the render check is skipped and recorded as
 * `render-unchecked` — not checked, never a pass (aturan.md §5.4).
 */
export async function screenLint(content: string, ref: UxReference, screenKey: string, spec: DesignSystemSpec, brand: string): Promise<UxLintFinding[]> {
  const screen = ref.screens.find((s) => s.key === screenKey);
  const html = lintScreenHtml(content, ref.fidelity ?? "neutral", lintOptionsFor(ref, screen, spec));
  const framed = framedForRender(content, ref, screenKey, spec, brand);
  const rendered = await renderLint(framed.html, framed.sizes);
  const findings: Stamped = [...html, ...(rendered ?? [renderUnchecked()])];
  if (rendered) Object.defineProperty(findings, RENDER_STAMP, { value: framed.digest, enumerable: false });
  return findings;
}

/** What the platform frames every screen with: the project's name and the spec of the reference's fidelity. */
export async function shellOf(db: DbExecutor, projectId: string) {
  const project = await getProject(db, projectId);
  const ds = await approvedDesignSystem(db, projectId);
  return { brand: project.name, spec: (ref: UxReference, key?: string) => ref.fidelity === "styled"
    ? templateDesignSystem(ds?.spec ?? NEUTRAL_SPEC, effectiveLayout(ref, ref.screens.find(s => s.key === key) ?? {}))
    : NEUTRAL_SPEC };
}

/** The screen's current content pushed onto its undo history (newest first, capped). */
export function pushHistory(screen: UxScreen, note: string): UxScreenVersion[] {
  const history = screen.history ?? [];
  if (!screen.html) return history;
  return [{ content: screenContent(stripDesignSystem(screen.html)), at: new Date().toISOString(), note }, ...history].slice(0, UX_SCREEN_HISTORY);
}

/** The draft screen a person edits on the canvas, or a conflict. */
export function editableScreen(current: UxReference, key: string): UxScreen {
  const screen = current.screens.find((s) => s.key === key);
  if (!screen) throw errors.notFound("UI reference screen", key);
  if (!screen.html) throw errors.conflict("UX_SCREEN_NOT_DRAWN", "Draw this screen before editing it");
  return screen;
}
