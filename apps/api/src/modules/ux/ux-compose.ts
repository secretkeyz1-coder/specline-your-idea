import { UX_BUDGETS } from "@sdd/contracts";

/**
 * Composition CSS in UI-reference screens. When the kit's layout classes cannot
 * express a layout, the model may add one <style> with rules for layout and
 * composition. The platform keeps only what cannot break the design system or
 * the page, and scopes the rest to the page content:
 *
 * - layout and box properties (grid, flex, gap, spacing, sizes, sticky
 *   position, alignment, overflow, text alignment and weight);
 * - colour, border, radius and shadow only through the design tokens
 *   (var(--ds-…), currentColor, transparent) — never a literal colour, a
 *   gradient or an image;
 * - no fixed widths a phone cannot hold (px ≥ 320 on width, min-width,
 *   flex-basis or grid columns), no font families, no oversized type, no
 *   animation, no generated content;
 * - `@media (min-width|max-width: …)` only; selectors are prefixed with
 *   `.ds-main`, and selectors reaching the document or the platform shell are
 *   dropped.
 *
 * Everything dropped is reported, so the lint can tell the model.
 */

const MAX_CSS_CHARS = 8000;
const MAX_RULES = 80;
/** Fixed sizes wider than a phone (375px minus page gutters) overflow it. */
const PHONE_PX = UX_BUDGETS.phoneWidthPx;

const LAYOUT = new Set([
  "display", "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-column", "grid-row", "grid-area",
  "grid-auto-flow", "grid-auto-columns", "grid-auto-rows", "gap", "row-gap", "column-gap",
  "flex", "flex-direction", "flex-wrap", "flex-flow", "flex-grow", "flex-shrink", "flex-basis", "order",
  "align-items", "align-content", "align-self", "justify-items", "justify-content", "justify-self", "place-items", "place-content", "place-self",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "margin-inline", "margin-block",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "padding-inline", "padding-block",
  "width", "min-width", "max-width", "height", "min-height", "max-height", "aspect-ratio",
  "overflow", "overflow-x", "overflow-y", "position", "top", "right", "bottom", "left", "z-index",
  "text-align", "vertical-align", "white-space", "text-wrap", "overflow-wrap", "word-break", "text-overflow",
  "font-weight", "font-size", "font-variant-numeric", "line-height", "letter-spacing", "list-style", "opacity",
  "table-layout", "border-collapse", "border-spacing", "cursor",
]);
/** Colour-bearing properties: tokens only. */
const PAINT = new Set([
  "color", "background", "background-color", "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-color", "border-width", "border-style", "border-radius", "border-top-left-radius", "border-top-right-radius",
  "border-bottom-left-radius", "border-bottom-right-radius", "outline", "outline-color", "outline-offset", "box-shadow", "fill", "stroke", "stroke-width",
]);
const SIZE_PX_LIMITED = new Set(["width", "min-width", "flex-basis", "flex", "grid-template-columns", "grid-auto-columns"]);
const DISPLAY = /^(?:block|inline|inline-block|flex|inline-flex|grid|inline-grid|contents|none|flow-root|table-cell)$/;
const POSITION = /^(?:static|relative|sticky)$/;
const FORBIDDEN_VALUE = /url\s*\(|expression\s*\(|gradient\s*\(|image-set\s*\(|element\s*\(|attr\s*\(|@|\\|<|>|javascript:/i;
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\s*\(/i;
/** What may remain in a paint value once its var(--ds-…) references are taken out. */
const PAINT_WORD = /^(?:-?\d*\.?\d+(?:px|rem|em|%)?|0|solid|dashed|dotted|double|none|transparent|currentcolor|inherit|inset|auto)$/i;
/** Selectors that reach the document or the platform's shell. */
const OUT_OF_SCOPE = /(?:^|[\s>+~(,])(?:html|body|:root|:host)\b|\.ds-(?:app|sidebar|inset|app-header|mobile-menu|mobile-sheet|team|side-nav)\b|^\*$/i;

export interface CleanedCss {
  css: string;
  dropped: string[];
}

function cleanValue(prop: string, raw: string): string | null {
  const value = raw.replace(/\s*!important\s*$/i, "").trim();
  if (!value || FORBIDDEN_VALUE.test(value)) return null;
  if (PAINT.has(prop)) {
    // A var() with a fallback could smuggle a literal colour in.
    if (/var\(\s*--ds-[a-z0-9-]+\s*,/i.test(value)) return null;
    const rest = value.replace(/var\(\s*--ds-[a-z0-9-]+\s*\)/gi, " ").replace(/calc\([^()]*\)/gi, " 0 ").trim();
    if (rest && !rest.split(/[\s,/]+/).filter(Boolean).every((w) => PAINT_WORD.test(w))) return null;
    return value;
  }
  if (!LAYOUT.has(prop)) return null;
  if (COLOUR_LITERAL.test(value)) return null;
  if (prop === "display" && !DISPLAY.test(value)) return null;
  if (prop === "position" && !POSITION.test(value)) return null;
  if (prop === "z-index" && !(/^\d{1,2}$/.test(value) && Number(value) <= 20)) return null;
  if (prop === "font-weight" && !/^(?:[4-7]00|normal|bold|var\(--ds-[a-z0-9-]+\))$/.test(value)) return null;
  if (prop === "font-size") {
    const m = /^(\d*\.?\d+)(em|rem)$/.exec(value);
    if (!(m && Number(m[1]) >= 0.75 && Number(m[1]) <= 1.25) && !/^var\(--ds-[a-z0-9-]+\)$/.test(value)) return null;
  }
  if (prop === "letter-spacing" && !/^(?:normal|-?0?\.0\d*em|0)$/.test(value)) return null;
  if (SIZE_PX_LIMITED.has(prop) && [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].some((n) => Number(n[1]) >= PHONE_PX)) return null;
  return value;
}

function cleanDeclarations(block: string, dropped: string[]): string {
  const out: string[] = [];
  for (const decl of block.split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) {
      if (decl.trim()) dropped.push(decl.trim().slice(0, 60));
      continue;
    }
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = cleanValue(prop, decl.slice(i + 1));
    if (value === null) dropped.push(`${prop}: ${decl.slice(i + 1).trim()}`.slice(0, 80));
    else out.push(`${prop}:${value}`);
  }
  return out.join(";");
}

function scopeSelectors(selectors: string, dropped: string[]): string | null {
  const kept: string[] = [];
  for (const raw of selectors.split(",")) {
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    if (OUT_OF_SCOPE.test(s) || /[{}@;]/.test(s)) {
      dropped.push(`selector ${s}`.slice(0, 80));
      continue;
    }
    kept.push(/^\.ds-main(?=$|[\s.:#[>+~])/.test(s) ? s : `.ds-main ${s}`);
  }
  return kept.length ? kept.join(",") : null;
}

/** The index of the brace closing the one opened just before `from`. */
function closing(css: string, from: number): number {
  let depth = 1;
  for (let i = from; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}" && --depth === 0) return i;
  }
  return css.length;
}

function cleanRules(css: string, dropped: string[], counter: { rules: number }, inMedia: boolean): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const head = css.slice(i, open).trim();
    const end = closing(css, open + 1);
    const body = css.slice(open + 1, end);
    i = end + 1;
    if (head.startsWith("@")) {
      const media = /^@media\s+(\((?:min|max)-width:\s*\d+(?:\.\d+)?(?:px|rem|em)\)(?:\s+and\s+\((?:min|max)-width:\s*\d+(?:\.\d+)?(?:px|rem|em)\))?)$/i.exec(head);
      if (!media || inMedia) {
        dropped.push(head.slice(0, 60));
        continue;
      }
      const inner = cleanRules(body, dropped, counter, true);
      if (inner) out.push(`@media ${media[1]}{${inner}}`);
      continue;
    }
    if (counter.rules >= MAX_RULES) {
      dropped.push(`rule ${head.slice(0, 40)} (more than ${MAX_RULES} rules)`);
      continue;
    }
    const selector = scopeSelectors(head, dropped);
    const decls = selector ? cleanDeclarations(body, dropped) : "";
    if (selector && decls) {
      counter.rules += 1;
      out.push(`${selector}{${decls}}`);
    }
  }
  return out.join("\n");
}

/** Composition CSS as the platform keeps it: scoped to the page, within the design system. */
export function cleanComposeCss(css: string): CleanedCss {
  const dropped: string[] = [];
  let source = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/<!--|-->/g, " ");
  if (source.length > MAX_CSS_CHARS) {
    dropped.push(`everything after ${MAX_CSS_CHARS} characters`);
    source = source.slice(0, MAX_CSS_CHARS);
  }
  return { css: cleanRules(source, dropped, { rules: 0 }, false), dropped };
}

/**
 * A <style> element. One left open runs to the end of the content, as a
 * browser reads it — matching only closed blocks let an unclosed one through
 * uncleaned (`<style>.ds-sidebar{display:none}` at the end of a drawing).
 */
export const STYLE_BLOCK = /<style\b([^>]*)>([\s\S]*?)(?:<\/style\s*>|$)/gi;

/**
 * Every <style> in the page content, cleaned and scoped, marked data-compose.
 * Idempotent: a cleaned block cleans to itself.
 */
export function scopeComposeStyles(html: string): string {
  return html.replace(STYLE_BLOCK, (_m, _attrs: string, css: string) => {
    const { css: clean } = cleanComposeCss(css);
    return clean ? `<style data-compose>\n${clean}\n</style>` : "";
  });
}

/** The page's composition CSS, for the document head (overlay artboards copy the head). */
export function composeStylesOf(html: string): string {
  return [...html.matchAll(STYLE_BLOCK)].map((m) => cleanComposeCss(m[2] ?? "").css).filter(Boolean).join("\n");
}

/** What the platform would drop from the model's own <style> blocks. */
export function droppedComposeCss(html: string): string[] {
  return [...html.matchAll(STYLE_BLOCK)].flatMap((m) => cleanComposeCss(m[2] ?? "").dropped);
}
