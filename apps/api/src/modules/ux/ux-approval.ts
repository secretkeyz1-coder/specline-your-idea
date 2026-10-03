import { UX_RULES_VERSION, type DesignSystemSpec, type UxLintFinding, type UxReference } from "@sdd/contracts";
import type { DbExecutor } from "@sdd/db";
import { errors } from "@sdd/shared";
import { lintOptionsFor, lintScreenHtml, uncoveredMustHaves } from "./ux-lint.js";
import { classify, isBlocking, RENDER_RULES } from "./ux-rules.js";
import { isFramed, screenContent } from "./ux-shell.js";

/**
 * Whether a UI reference may be approved (aturan.md §5.4). Every screen drawn
 * is necessary but not enough: no finding that blocks approval may remain, on
 * the plan or on any screen, and scope the plan leaves out must have been
 * accepted by the person.
 *
 * The HTML checks are run again on the stored screens — never taken from what
 * was stored with them — so an edit, undo or restore cannot slip past. The
 * render check's stored findings are reused only while they still describe
 * the screen: the digest of the framed HTML (content, tokens, shell) and the
 * sizes it was measured at must match what would be rendered now. Otherwise
 * the screen is rendered again; when that cannot run, the screen counts as
 * "not checked as rendered" (`render-unchecked`), never as passing.
 */

export interface UxApprovalBlocker {
  /** The screen, or null for the plan. */
  screen: string | null;
  rule: string;
  message: string;
}

/**
 * Whether a screen's stored render findings may stand for it now (aturan.md
 * §5.4): only when they were measured on exactly the framed document and sizes
 * that would be rendered today.
 */
export function storedRenderCurrent(storedDigest: string | null | undefined, digestNow: string): boolean {
  return Boolean(storedDigest) && storedDigest === digestNow;
}

export function uxApprovalBlockers(
  ref: UxReference,
  requirements: Array<{ key: string; priority: string }>,
  /** Fresh render findings per screen key, used instead of the stored ones (a screen that was rendered again at approval). */
  rendered: ReadonlyMap<string, UxLintFinding[]> = new Map(),
): UxApprovalBlocker[] {
  if (!ref.applicable) return [];
  const out: UxApprovalBlocker[] = [];
  const current = (ref.rules_version ?? 1) >= UX_RULES_VERSION;

  if (current) {
    const confirmed = Boolean(ref.scope_confirmed_at);
    const leftOut = Boolean(ref.count_conflict?.uncovered.length || ref.uncovered_scope?.length);
    if (leftOut && !confirmed) {
      out.push({
        screen: null,
        rule: "scope-unconfirmed",
        message: "The plan leaves scope out (the requested screen count, or the screen limit) — confirm it, or plan again with more screens.",
      });
    }
    const declared = new Set((ref.count_conflict?.uncovered ?? []).map((k) => k.toUpperCase()));
    const excused = (key: string) => confirmed && (declared.has(key.toUpperCase()) || Boolean(ref.uncovered_scope?.length));
    const uncovered = uncoveredMustHaves({ screens: ref.screens, no_ui_requirements: ref.no_ui_requirements }, requirements).filter((k) => !excused(k));
    if (uncovered.length) {
      out.push({
        screen: null,
        rule: "uncovered-requirements",
        message: `No screen serves the P0 requirement${uncovered.length === 1 ? "" : "s"} ${uncovered.join(", ")} — add a screen for ${uncovered.length === 1 ? "it" : "them"}, or plan again.`,
      });
    }
  }

  for (const screen of ref.screens) {
    if (!screen.html) continue;
    const html = isFramed(screen.html) ? lintScreenHtml(screenContent(screen.html), ref.fidelity ?? "neutral", lintOptionsFor(ref, screen)) : [];
    const render = (rendered.get(screen.key) ?? screen.lint ?? []).filter((f) => RENDER_RULES.has(f.rule)).map(classify);
    for (const f of [...html, ...render].filter(isBlocking)) out.push({ screen: screen.key, rule: f.rule, message: f.message });
  }
  return out;
}

/** Refuse approval of a UI reference draft that is incomplete or still has blocking findings. */
export async function assertUxApprovable(db: DbExecutor, projectId: string, structured: unknown): Promise<void> {
  const ref = structured as UxReference | null;
  if (!ref?.applicable) return;
  // A reference with a missing screen would hand the agent a gap.
  const missing = (ref.screens ?? []).filter((s) => !s.html).map((s) => s.key);
  if (missing.length) {
    throw errors.conflict("UX_INCOMPLETE", `Generate every screen before approving — missing: ${missing.join(", ")}`, { missing });
  }
  // Loaded here: the requirement and artifact modules import each other through this one.
  const { getApprovedRevision } = await import("../artifact/service.js");
  const { listRequirementsForRevision } = await import("../planning/requirements.js");
  const approvedReq = await getApprovedRevision(db, projectId, "requirements");
  const requirements = approvedReq ? (await listRequirementsForRevision(db, approvedReq.revision.id)).map((r) => ({ key: r.key, priority: r.priority })) : [];
  const blockers = uxApprovalBlockers(ref, requirements, await currentRenders(db, projectId, ref));
  if (blockers.length) {
    const first = blockers[0]!;
    throw errors.conflict(
      "UX_NOT_APPROVABLE",
      `${blockers.length} finding${blockers.length === 1 ? "" : "s"} must be fixed before approval — ${first.screen ? `${first.screen}: ` : ""}${first.message}`,
      { blockers },
    );
  }
}

/**
 * Render findings for the screens whose stored ones no longer describe them
 * (a different HTML, token set, shell or size since they were measured): each
 * is rendered again; without a browser it gets `render-unchecked` instead.
 */
async function currentRenders(db: DbExecutor, projectId: string, ref: UxReference): Promise<Map<string, UxLintFinding[]>> {
  const { framedForRender, shellOf } = await import("./ux-draft.js");
  const { renderLint, renderUnchecked } = await import("./ux-render.js");
  const shell = await shellOf(db, projectId);
  const out = new Map<string, UxLintFinding[]>();
  for (const screen of ref.screens) {
    if (!screen.html || !isFramed(screen.html)) continue;
    const framed = framedForRender(screenContent(screen.html), ref, screen.key, shell.spec(ref, screen.key), shell.brand);
    if (storedRenderCurrent(screen.render_digest, framed.digest)) continue;
    const fresh = await renderLint(framed.html, framed.sizes);
    out.set(screen.key, fresh ?? [renderUnchecked("not rendered again after the screen, its tokens, shell or sizes changed (no browser)")]);
  }
  return out;
}
