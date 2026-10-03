import { CRAFT_TEXTS } from "./craft-texts.js";

/**
 * Craft references adopted from open-design (craft/*.md, Apache-2.0): rules
 * with numbers — type scale and measure, colour shares and accent budget,
 * anti-slop patterns, contrast and targets, state coverage, forms, UX laws,
 * motion — applied on top of a design system. The brand wins for token
 * values; craft rules hold for everything it does not override.
 */

export type CraftSlug = keyof typeof CRAFT_TEXTS;
export const CRAFT_SLUGS = Object.keys(CRAFT_TEXTS) as CraftSlug[];

/** What every design-system package carries; the UI-reference surface adds its own (phase 2). */
export const DEFAULT_CRAFT: CraftSlug[] = ["color", "typography", "accessibility-baseline", "anti-ai-slop"];

const isCraft = (slug: string): slug is CraftSlug => slug in CRAFT_TEXTS;

/** The craft files for these slugs, in the given order; unknown slugs and repeats are skipped. */
export function craftFor(slugs: readonly string[]): Array<{ slug: CraftSlug; content: string }> {
  const seen = new Set<string>();
  return slugs.filter((s) => isCraft(s) && !seen.has(s) && seen.add(s)).map((slug) => ({ slug: slug as CraftSlug, content: CRAFT_TEXTS[slug as CraftSlug] }));
}

/** The prompt block for these craft references (open-design's "Active craft references"). */
export function craftBlock(slugs: readonly string[]): string {
  const files = craftFor(slugs);
  if (!files.length) return "";
  return [
    `## Active craft references — ${files.map((f) => f.slug).join(", ")}`,
    "",
    "Universal rules applied on top of the design system. Where they conflict, the design system wins for token values; the craft rules still apply to everything it does not override.",
    "",
    files.map((f) => `### ${f.slug}\n\n${f.content.trim()}`).join("\n\n---\n\n"),
  ].join("\n");
}
