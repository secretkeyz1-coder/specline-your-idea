import { and, eq, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { DesignSystemSpec, UxReference } from "@sdd/contracts";
import { getApprovedRevision, structuredOf } from "../artifact/service.js";
import { approvedDesignSystem } from "../design-system/service.js";
import { sanitizeHtml } from "./ux-sanitize.js";
import { NEUTRAL_SPEC, assembleScreen, ensureNodeIds, isFramed, screenContent, withNodeIds } from "./ux-shell.js";
import { applyStatusTones, draftStatusTones } from "./ux-status.js";
import { drawnHtml, framedForRender, shellOf } from "./ux-draft.js";
import { reviewOutdated } from "./ux-review.js";
import { restyleSource } from "./ux-plan.js";
import { detectedPlatform } from "./ux-platform.js";

/** Reading the UI reference: the approved and draft versions framed with the current shell and kit, and the approved screens for tasks and the release check. */

/**
 * A reference as the current shell and kit draw it. Stored screens keep their
 * content; the frame (stylesheet, sidebar, header, icons) is rebuilt on read,
 * so shell and kit improvements reach screens drawn before them. Elements get
 * ids the same way a save numbers them. A styled screen whose design system is
 * no longer approved, and a legacy whole-document screen, are shown as stored.
 */
async function currentFrame(db: DbExecutor, projectId: string, ref: UxReference): Promise<UxReference> {
  const shell = await shellOf(db, projectId);
  const ds = ref.fidelity === "styled" ? await approvedDesignSystem(db, projectId) : null;
  const spec = ref.fidelity === "styled" ? (ds?.spec ?? null) : NEUTRAL_SPEC;
  // Screens drawn before their status tones were held get them now, as a save would.
  const badges = ref.generator === "od" ? "od" : "kit";
  const tones = draftStatusTones(ref.sample_data?.statuses, drawnHtml(ref, null), badges);
  return {
    ...ref,
    screens: ref.screens.map((s) => {
      if (!s.html) return s;
      const activeSpec = shell.spec(ref, s.key);
      if ((!spec && !s.layout_reference?.design_system && !ref.layout_reference?.design_system) || !isFramed(s.html)) return { ...s, html: withNodeIds(s.html) };
      // Sanitized again on the way out: screens stored before the parser-based
      // sanitizer were cleaned by a weaker one. Ids are numbered first, as a
      // comment numbers a stored screen, and the sanitizer keeps them.
      const content = sanitizeHtml(applyStatusTones(ensureNodeIds(screenContent(s.html)), tones, badges).html);
      // Whether the stored render findings still describe this drawing as framed now (aturan.md §5.4).
      const render_checked = Boolean(s.render_digest) && framedForRender(screenContent(s.html), ref, s.key, activeSpec, shell.brand).digest === s.render_digest;
      return {
        ...s,
        render_checked,
        ...(s.visual_review ? { visual_review: { ...s.visual_review, outdated: reviewOutdated(s.visual_review, s.html) } } : {}),
        html: assembleScreen({ content, spec: activeSpec, brand: shell.brand, screens: ref.screens, currentKey: s.key, shell: ref.shell, platform: ref.platform, generator: ref.generator }),
      };
    }),
  };
}

/** CSS generic families and system stacks: what a mockup falls back to. */
const GENERIC = /^(system-ui|ui-sans-serif|ui-serif|ui-monospace|ui-rounded|sans-serif|serif|monospace|cursive|fantasy|-apple-system|BlinkMacSystemFont)$/i;

/**
 * The fonts a styled reference asks for and what its mockups really show
 * (aturan.md §4): the platform embeds no font files yet, so a named family
 * renders only where it happens to be installed — the mockup is judged in
 * the stack's system fallback. Null for neutral references (system fonts by design).
 */
export function fontNote(spec: DesignSystemSpec | null): { requested: string[]; shown: string; fallback: boolean } | null {
  if (!spec) return null;
  const families = (stack: string) => stack.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const stacks = [spec.fonts.display, spec.fonts.body, spec.fonts.mono];
  // A stack asks for a font when it leads with a named family; one led by system-ui is a system stack.
  const requested = [...new Set(stacks.map((st) => families(st)[0]).filter((f): f is string => Boolean(f) && !GENERIC.test(f!)))];
  const shown = families(spec.fonts.body).find((f) => GENERIC.test(f)) ?? "the browser's default font";
  return { requested, shown, fallback: requested.length > 0 };
}

/** Approved reference, current draft, and whether the reference went stale. */
export async function getUxState(db: DbExecutor, projectId: string) {
  const [artifact] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), eq(schema.artifacts.artifactType, "ux")))
    .limit(1);
  const designApproved = Boolean(await getApprovedRevision(db, projectId, "design"));
  // What the current stack and requirements suggest: offered when planning, and against a reference drawn as another platform.
  const detected_platform = await detectedPlatform(db, projectId);
  if (!artifact) return { design_approved: designApproved, approved: null, draft: null, stale: false, stale_plan: null, detected_platform, fonts: null };
  const revisions = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.artifactId, artifact.id));
  const approved = revisions.find((r) => r.id === artifact.approvedRevisionId && r.status === "APPROVED") ?? null;
  const draft = revisions.find((r) => r.id === artifact.currentDraftRevisionId && r.status === "DRAFT") ?? null;
  const latest = [...revisions].sort((a, b) => b.version - a.version)[0];
  const withIds = async (ref: UxReference | null) => (ref ? await currentFrame(db, projectId, ref) : null);
  const view = async (r: typeof approved) =>
    r ? { revision_id: r.id, version: r.version, approved_at: r.approvedAt, reference: await withIds(structuredOf<UxReference>(r)) } : null;
  const stale = !approved && latest?.status === "STALE";
  // Stale only because its design system changed: the screens can be kept and drawn again.
  const [approvedView, draftView, keep] = await Promise.all([view(approved), view(draft), stale ? restyleSource(db, projectId) : null]);
  // Styled screens name the fonts they ask for and the fallback they are shown in.
  const styled = [draftView, approvedView].some((v) => v?.reference?.fidelity === "styled");
  const fonts = styled ? fontNote((await approvedDesignSystem(db, projectId))?.spec ?? null) : null;
  return {
    design_approved: designApproved,
    approved: approvedView,
    draft: draftView,
    stale,
    stale_plan: keep ? { version: keep.revision.version, screens: keep.reference.screens.length, fidelity: keep.reference.fidelity ?? "neutral" } : null,
    detected_platform,
    fonts,
  };
}

/**
 * What the project journey needs: the approved version, whether it applies,
 * its screen count, and whether a draft is open. Counted in the database, so
 * no screen drawing is read, framed or sent.
 */
export async function getUxSummary(db: DbExecutor, projectId: string) {
  const [artifact] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), eq(schema.artifacts.artifactType, "ux")))
    .limit(1);
  if (!artifact) return { approved: null, has_draft: false };
  // The driver stores structured content as a JSON *string* (jsonb scalar) —
  // unwrap it before reading fields, or applicable/screens read as null/0 and
  // the journey calls an approved reference "skipped".
  const sc = sql`(case jsonb_typeof(${schema.artifactRevisions.structuredContent}) when 'string' then (${schema.artifactRevisions.structuredContent} #>> '{}')::jsonb else ${schema.artifactRevisions.structuredContent} end)`;
  const revisions = await db
    .select({
      id: schema.artifactRevisions.id,
      status: schema.artifactRevisions.status,
      version: schema.artifactRevisions.version,
      applicable: sql<boolean | null>`(${sc} ->> 'applicable')::boolean`,
      screens: sql<number | null>`jsonb_array_length(coalesce(${sc} -> 'screens', '[]'::jsonb))`,
    })
    .from(schema.artifactRevisions)
    .where(eq(schema.artifactRevisions.artifactId, artifact.id));
  const approved = revisions.find((r) => r.id === artifact.approvedRevisionId && r.status === "APPROVED");
  return {
    approved: approved ? { version: approved.version, applicable: approved.applicable, screens: Number(approved.screens ?? 0) } : null,
    has_draft: revisions.some((r) => r.id === artifact.currentDraftRevisionId && r.status === "DRAFT"),
  };
}

/** The approved screens, for task generation, the master prompt and the release check. */
export async function approvedUxReference(db: DbExecutor, projectId: string): Promise<UxReference | null> {
  const approved = await getApprovedRevision(db, projectId, "ux");
  const ref = approved ? structuredOf<UxReference>(approved.revision) : null;
  return ref?.applicable ? ref : null;
}
