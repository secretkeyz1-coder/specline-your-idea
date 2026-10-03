import type { UxFindingCategory, UxLintFinding } from "@sdd/contracts";

/**
 * Every UI-reference check and what the platform does about it (aturan.md
 * §5). The impact of a finding (its category) is kept apart from the action
 * the platform takes: completeness, usability and integrity findings refuse
 * approval; design guidance is a warning with its context. `repair` marks
 * what the one automatic repair turn is asked to fix: completeness, integrity
 * and concrete usability problems (a missing heading, a drawn shell, filler
 * copy). Aesthetic preferences — a nested card, a coloured left border — are
 * review input, never repair targets, so a sound composition is not "fixed"
 * back into a template (aturan.md §5.2).
 *
 * Security has no finding of its own: unsafe markup and links are always
 * removed by the sanitizer (ux-sanitize.ts), and what is left is checked here.
 */
interface RuleSpec {
  category: UxFindingCategory;
  action: "block" | "warn";
  repair: boolean;
}

const block = (category: UxFindingCategory): RuleSpec => ({ category, action: "block", repair: true });
const warn = (category: UxFindingCategory, repair: boolean): RuleSpec => ({ category, action: "warn", repair });

export const UX_RULES: Record<string, RuleSpec> = {
  /* ── screen: HTML lint ── */
  "missing-overlay": block("completeness"),
  "missing-key-element": block("completeness"),
  "unlabelled-field": block("usability"),
  "raw-colour": block("integrity"),
  "unsourced-metric": block("integrity"),
  "drew-shell": warn("guidance", true),
  // A gradient is not a finding for being there (aturan.md §5.2); a literal colour in it still is (raw-colour).
  "emoji-icon": warn("guidance", true),
  "filler-copy": warn("guidance", true),
  "fixed-width": warn("guidance", true),
  "competing-primaries": warn("guidance", true),
  "two-primaries": warn("guidance", false),
  // Review only: judged by whether the grouping or the status meaning is clear, never removed for its shape.
  "nested-card": warn("guidance", false),
  "left-accent-card": warn("guidance", false),
  "overlay-no-heading": warn("guidance", true),
  "missing-h1": warn("guidance", true),
  "multiple-h1": warn("guidance", true),
  // No `missing-page-header`: a clear main title is enough; the page header is one way to give it.
  "table-columns": warn("guidance", false),
  "inline-form": warn("guidance", false),
  "too-many-blocks": warn("guidance", false),
  "page-actions-overuse": warn("guidance", false),
  "off-sheet-data": warn("guidance", false),
  "unknown-icon": warn("guidance", false),
  "style-dropped": warn("guidance", false),
  "web-table-on-phone": warn("guidance", true),

  /* ── screen: od (open-design style) structure and lint ── */
  // What the canvas and the platform read: the seed's markers, the shared navigation, links between screens.
  "missing-marker": warn("guidance", true),
  "nav-missing": warn("guidance", true),
  "auth-navigation": block("integrity"),
  "shell-utility-missing": block("completeness"),
  "leftover-placeholder": warn("guidance", true),
  "broken-link": warn("guidance", true),
  // open-design's lint-artifact / anti-ai-slop rules: review input, never repair targets.
  "purple-gradient": warn("guidance", false),
  "trust-gradient": warn("guidance", false),
  "ai-default-indigo": warn("guidance", false),
  "sans-display": warn("guidance", false),
  "invented-metric": warn("guidance", false),
  "all-caps-no-tracking": warn("guidance", false),
  "external-image": warn("guidance", false),
  "raw-hex": warn("guidance", false),
  "accent-overuse": warn("guidance", false),
  "missing-section-anchor": warn("guidance", false),

  /* ── screen: render check ── */
  "cut-off-action": block("usability"),
  "low-contrast": block("usability"),
  "phone-overflow": warn("guidance", true),
  "desktop-overflow": warn("guidance", true),
  "table-too-wide": warn("guidance", true),
  "low-contrast-control": warn("guidance", true),
  "phone-too-long": warn("guidance", false),
  "small-target": warn("guidance", false),
  "squeezed-text": warn("guidance", false),
  "tiny-text": warn("guidance", false),
  /** The render check was skipped or could not measure part of the screen: shown as not checked, never as passed. */
  "render-unchecked": warn("guidance", false),

  /* ── plan ── */
  "uncovered-requirements": block("completeness"),
  "uncovered-requirements-minor": warn("guidance", false),
  "wrong-count": warn("instruction", true),
  "busy-screen": warn("guidance", false),
  "untraced-screen": warn("guidance", false),
};

/** Findings the render check produces: stored with the drawing, not recomputed from its HTML. */
export const RENDER_RULES: ReadonlySet<string> = new Set([
  "cut-off-action",
  "low-contrast",
  "low-contrast-control",
  "phone-overflow",
  "desktop-overflow",
  "table-too-wide",
  "phone-too-long",
  "small-target",
  "squeezed-text",
  "tiny-text",
  "render-unchecked",
]);

/** A finding of a catalogued rule, classified the way the catalogue says. */
export function finding(rule: string, message: string): UxLintFinding {
  const spec = UX_RULES[rule];
  if (!spec) throw new Error(`Unknown UI-reference rule: ${rule}`);
  return { rule, category: spec.category, action: spec.action, repair: spec.repair, message };
}

/**
 * A stored finding as the catalogue classifies it now — findings stored
 * before categories existed (severity P0/P1) or under an older catalogue are
 * read by their rule. Unknown rules are advice.
 */
export function classify(f: Pick<UxLintFinding, "rule" | "message">): UxLintFinding {
  const spec = UX_RULES[f.rule];
  return spec ? { rule: f.rule, message: f.message, ...spec } : { rule: f.rule, message: f.message, category: "guidance", action: "warn", repair: false };
}

export const isBlocking = (f: Pick<UxLintFinding, "action">) => f.action === "block";

/**
 * What the repair turn is asked to fix: the catalogue's repairable findings.
 * A layout_note helps a reviewer judge a composition; it never cancels a
 * safety, accessibility or completeness finding, and aesthetic preferences
 * are not repair targets in the first place (aturan.md §5.2).
 */
export function repairTargets(findings: UxLintFinding[]): UxLintFinding[] {
  return findings.filter((f) => f.repair);
}
