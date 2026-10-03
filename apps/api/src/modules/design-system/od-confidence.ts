import type { DsColorToken, DsFonts, DsImportConfidence, DsTokenConfidence } from "@sdd/contracts";
import type { TokenReading } from "./import.js";
import { OD_TOKEN_SCHEMA } from "./od-tokens.js";

/**
 * open-design's importer report (apps/daemon/src/design-systems/
 * token-contract.ts, Apache-2.0), applied to our import: for each of the 56
 * contract tokens, how it was bound —
 *   high      the paste names it exactly (`--accent`, `--text-base`)
 *   medium    matched by role (`--primary` → accent) or read by the AI
 *   alias     a B-slot pointing at its sibling (no richer source)
 *   fallback  an A2 token at the contract's default
 *   low       an A1 token the paste did not give (from the base preset, or derived)
 * Score = round((a1Coverage·0.7 + (1 − (fallback+low)/N)·0.2 + (1 − alias/N)·0.1)·100).
 *
 * One deliberate difference: a1Coverage counts the A1-identity tokens (colours
 * and fonts) only. Our structure tokens are derived from the spec's density
 * and radius on purpose, so counting them as missing would grade almost every
 * real paste "needs rebuild"; they still weigh in through the fallback/low term.
 */

const COLOUR_ROLE: Record<string, DsColorToken> = {
  "--bg": "bg",
  "--surface": "surface",
  "--surface-warm": "surface2",
  "--fg": "fg",
  "--muted": "fgMuted",
  "--border": "border",
  "--accent": "accent",
  "--accent-on": "accentFg",
  "--success": "success",
  "--warn": "warn",
  "--danger": "danger",
};
const FONT_ROLE: Record<string, keyof DsFonts> = { "--font-display": "display", "--font-body": "body", "--font-mono": "mono" };
const RADIUS = new Set(["--radius-sm", "--radius-md", "--radius-lg"]);

type Reading = Pick<TokenReading, "light" | "dark" | "fonts" | "sources" | "names" | "scaleNames">;

export function importConfidence(r: Reading, aiRead: boolean): DsImportConfidence {
  const pasted = new Set(r.names);
  const tokens: DsTokenConfidence[] = OD_TOKEN_SCHEMA.map((t) => {
    const bare = t.name.slice(2);
    const base = { token: t.name, layer: t.layer };
    const colour = COLOUR_ROLE[t.name];
    const font = FONT_ROLE[t.name];
    const src = colour ? (r.sources.light[colour] ?? r.sources.dark[colour]) : font ? r.sources.fonts[font] : RADIUS.has(t.name) ? r.sources.radius : undefined;
    if (src) return { ...base, confidence: src === bare ? "high" : "medium", from: `--${src}` };
    if (r.scaleNames.includes(t.name) || (!colour && !font && pasted.has(bare) && /^(text|leading|tracking|section|container|motion)-/.test(bare))) {
      return { ...base, confidence: "high", from: t.name };
    }
    if (aiRead && (colour || font)) return { ...base, confidence: "medium", from: "AI reading of the text" };
    if (t.layer === "B-slot") return { ...base, confidence: "alias", from: t.aliasTo };
    if (t.layer === "A2") return { ...base, confidence: "fallback" };
    return { ...base, confidence: "low" };
  });
  const n = tokens.length;
  const a1 = tokens.filter((t) => t.layer === "A1-identity");
  const a1Coverage = a1.filter((t) => t.confidence === "high" || t.confidence === "medium").length / a1.length;
  const weak = tokens.filter((t) => t.confidence === "fallback" || t.confidence === "low").length;
  const alias = tokens.filter((t) => t.confidence === "alias").length;
  const score = Math.round((a1Coverage * 0.7 + (1 - weak / n) * 0.2 + (1 - alias / n) * 0.1) * 100);
  const grade = score >= 80 ? "excellent" : score >= 60 ? "usable" : score >= 40 ? "needs-review" : "needs-rebuild";
  return { tokens, score, grade, recommend_rebuild: grade === "needs-review" || grade === "needs-rebuild" };
}
