import type { DesignSystemSpec, UxGenerator, UxPlatform, UxScreenType, UxShell } from "@sdd/contracts";
import { Parser } from "htmlparser2";
import { OD_EXTENSIONS, OD_TOKEN_NAMES, odTokensCss } from "../design-system/od-tokens.js";
import { collapseIcons, expandIcons } from "./ux-icons.js";
import { MOCKUP_CSP, NEUTRAL_SPEC, ensureNodeIds, tidySvg } from "./ux-shell.js";
import { isAuthScreen, navItems, selectSeed, type OdSeed } from "./ux-od-seeds.js";

/**
 * UI-reference screens in open-design style (generator "od"): the model writes
 * a screen's whole <body> from a seed template; the platform owns everything
 * around it. A stored screen is
 *
 *   <!doctype html><html><head>
 *     <meta charset> + the mockup CSP + viewport + <title>
 *     <style data-tokens>  the design system's tokens.css (or the wireframe tokens)
 *     <style data-seed="…"> the seed's base CSS
 *   </head>
 *   <body data-sdd-generator="od" data-sdd-seed="…">the model's body</body></html>
 *
 * The body keeps the model's own <style data-screen> (cleaned), the markers of
 * UX_OD_MARKERS and the navigation the platform refreshes. Tokens and seed CSS
 * are never taken from the model or the canvas: they are stripped from what
 * comes in and injected again on every assembly.
 *
 * Kept free of top-level use of ux-shell's bindings: ux-shell imports this
 * module to dispatch od screens.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "A";

/** Whether the generator of a reference is open-design style (absent = the kit). */
export const isOdGenerator = (generator: UxGenerator | null | undefined) => generator === "od";

/** Whether a stored screen document was assembled by the od generator. */
export function isOdDocument(storedHtml: string): boolean {
  return /<body\b[^>]*\sdata-sdd-generator\s*=\s*["']?od\b/i.test(storedHtml);
}

/** Whether a spec is the neutral wireframe one (the wireframe seed and tokens). */
export const isNeutralSpec = (spec: DesignSystemSpec) => spec.preset_id === NEUTRAL_SPEC.preset_id;

/** The body of a stored od document (the model's part, as the platform keeps it). */
export function odBody(storedHtml: string): string {
  const open = /<body\b[^>]*>/i.exec(storedHtml);
  if (!open) return storedHtml;
  const from = open.index + open[0].length;
  const close = storedHtml.toLowerCase().lastIndexOf("</body");
  return storedHtml.slice(from, close > from ? close : storedHtml.length).trim();
}

/** The platform's own stylesheets, wherever a client or the model copied them. */
const PLATFORM_STYLE = /<style\b[^>]*\bdata-(?:tokens|seed|design-system)\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi;

/** Drop the tokens and seed stylesheets from incoming HTML: the platform injects its own. */
export function stripPlatformStyles(html: string): string {
  return html.replace(PLATFORM_STYLE, "");
}

/**
 * The model's screen body, whatever it wrapped around it: the inside of
 * <body>, or the text itself without a document's doctype, <html> and <head>.
 * A tokens or seed stylesheet it pasted anyway is dropped. Same for a canvas
 * save of an od screen (the whole body inner HTML, optionally led by its
 * <style data-screen>).
 */
export function extractOdBody(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(t);
  if (body) t = body[1]!;
  return stripPlatformStyles(
    t
      .replace(/<head\b[\s\S]*?<\/head\s*>/gi, "")
      .replace(/<!--\s*PLAN[\s\S]*?-->/gi, "")
      .replace(/<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, ""),
  ).trim();
}

/**
 * The body of an answer still arriving, for the live preview: what has come
 * of the body so far, without a trailing half-written tag or comment; empty
 * while the model is still in a document head.
 */
export function partialOdBody(text: string): string {
  let t = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
  const fence = /```(?:html)?[^\n]*\n?([\s\S]*?)(?:```|$)/i.exec(t);
  if (fence) t = fence[1]!;
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(t);
  if (body) t = body[1]!;
  else if (/^\s*<(?:!doctype|html|head)\b/i.test(t)) return "";
  return stripPlatformStyles(
    t
      .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
      .replace(/<[^>]*$/, "")
      .replace(/<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, ""),
  ).trim();
}

/** CSS that fetches, runs code or hides either behind an escape. */
const ACTIVE_CSS = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|\\/i;
/** Tokens the screen may read but never redefine: the contract, our extensions and the legacy aliases. */
const PROTECTED = (prop: string) => OD_TOKEN_NAMES.has(prop) || OD_EXTENSIONS.some((t) => t.name === prop) || prop.startsWith("--ds-");

/**
 * A screen's own CSS as the platform keeps it: no imports, font faces or
 * other at-rules that load something, no declaration that fetches or runs
 * anything (url(), image-set(), expression()), no redefinition of a design
 * token, no `<` (it could end the element). Raw colours stay — the lint
 * reports them (raw-colour blocks approval) and the repair turn fixes them.
 */
export function cleanOdCss(css: string): string {
  return css
    .replace(/</g, " ")
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "")
    .replace(/@(?:import|charset|namespace)\b[^;{}]*;?/gi, "")
    .replace(/@font-face\s*\{[^}]*\}?/gi, "")
    .replace(/([{;]\s*)([^{};]*)(?=[;}]|$)/g, (whole, lead: string, decl: string) => {
      const colon = decl.indexOf(":");
      if (colon === -1) return whole;
      const prop = decl.slice(0, colon).trim().toLowerCase();
      return ACTIVE_CSS.test(decl) || PROTECTED(prop) ? lead : whole;
    })
    .replace(/;(?:\s*;)+/g, ";")
    .trim();
}

const STYLE_EL = /<style\b([^>]*)>([\s\S]*?)(?:<\/style\s*>|$)/gi;

/**
 * Every <style> of a (sanitized) body, cleaned and merged into one
 * <style data-screen> at the top — the one place the model's own CSS lives.
 */
export function cleanOdStyles(body: string): string {
  const css: string[] = [];
  const rest = stripPlatformStyles(body).replace(STYLE_EL, (_m, _attrs: string, text: string) => {
    const cleaned = cleanOdCss(text);
    if (cleaned) css.push(cleaned);
    return "";
  });
  return css.length ? `<style data-screen>\n${css.join("\n")}\n</style>\n${rest.trim()}` : rest.trim();
}

/** The model's own screen CSS (the body's <style data-screen>), for lint and the canvas. */
export function screenCss(body: string): string {
  return [...body.matchAll(STYLE_EL)].map((m) => m[2] ?? "").join("\n");
}

/** An element carrying an attribute: its start tag, its inner HTML's span and the attribute's value. */
interface Marked {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  value: string;
  tag: string;
}

/** Every element carrying `attr` whose end tag is written (outermost first, nested ones skipped). */
function markedElements(html: string, attr: string): Marked[] {
  const out: Marked[] = [];
  const stack: Array<{ tag: string; start: number; openEnd: number; value: string | null }> = [];
  const parser = new Parser(
    {
      onopentag(tag, attrs, implied) {
        stack.push({ tag, start: parser.startIndex, openEnd: implied ? parser.startIndex : parser.endIndex + 1, value: attr in attrs ? (attrs[attr] ?? "") : null });
      },
      onclosetag(_tag, implied) {
        const el = stack.pop();
        if (!el || el.value === null || implied) return;
        if (out.some((o) => o.start < el.start && o.end > el.start)) return;
        out.push({ start: el.start, openEnd: el.openEnd, closeStart: parser.startIndex, end: parser.endIndex + 1, value: el.value, tag: el.tag });
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.end(html);
  // Inner elements close first: keep only the outermost, in document order.
  return out
    .filter((o) => !out.some((p) => p !== o && p.start < o.start && p.end >= o.end))
    .sort((a, b) => a.start - b.start);
}

/** Markup compared without the platform's element ids and with icons as placeholders. */
const comparable = (html: string) => collapseIcons(html).replace(/\sdata-nid="[^"]*"/g, "").replace(/\s+/g, " ").trim();

/** Replace the inner HTML of every element marked `attr`, from the last one back (offsets stay valid). */
function refill(html: string, attr: string, inner: (el: Marked) => string | null, openTag?: (el: Marked, open: string) => string): string {
  let out = html;
  for (const el of markedElements(html, attr).reverse()) {
    const next = inner(el);
    const open = out.slice(el.start, el.openEnd);
    const nextOpen = openTag ? openTag(el, open) : open;
    const current = out.slice(el.openEnd, el.closeStart);
    const body = next === null || comparable(current) === comparable(next) ? current : next;
    if (body === current && nextOpen === open) continue;
    out = out.slice(0, el.start) + nextOpen + body + out.slice(el.closeStart);
  }
  return out;
}

type NavScreen = { key: string; name: string; screen_type?: string | null; shell_mode?: "app" | "auth" | "standalone" };

/**
 * Every navigation slot (`data-sdd-nav="side|top|rail|bottom"`) gets the
 * platform's items for the reference's current screen list, with this screen
 * current — so screens added or removed later, a name changed, or a link the
 * model got wrong never leave two screens with different navigation. A slot
 * whose items are already right keeps its element ids.
 */
export function refreshNav(body: string, screens: NavScreen[], currentKey: string): string {
  if (screens.some(s => s.key === currentKey && isAuthScreen(s))) return refill(body, "data-sdd-nav", () => "");
  const tabs = Math.min(5, Math.max(1, screens.length));
  return refill(
    body,
    "data-sdd-nav",
    (el) => navItems(el.value || "side", screens, currentKey),
    (el, open) => {
      if (el.value !== "bottom") return open;
      if (/--tabs\s*:/i.test(open)) return open.replace(/--tabs\s*:\s*\d+/i, `--tabs:${tabs}`);
      return /\sstyle\s*=/i.test(open) ? open : open.replace(/\s*\/?>$/, ` style="--tabs:${tabs}">`);
    },
  );
}

/** The brand slot (`data-sdd-brand`): the project's initials and name, as the platform writes them. */
export function refreshBrand(body: string, brand: string): string {
  return refill(body, "data-sdd-brand", () => `<span class="brand-mark" aria-hidden="true">${esc(initials(brand))}</span><span class="brand-name">${esc(brand)}</span>`);
}

export interface OdAssembleInput {
  content: string;
  spec: DesignSystemSpec;
  brand: string;
  screens: NavScreen[];
  currentKey: string;
  shell?: UxShell | null;
  platform?: UxPlatform | null;
}

/** The seed a reference's screen is drawn from (by platform, shell layout, screen type and fidelity). */
export function seedFor(input: { spec: DesignSystemSpec; screens: NavScreen[]; currentKey: string; shell?: UxShell | null; platform?: UxPlatform | null }): OdSeed {
  const current = input.screens.find((s) => s.key === input.currentKey);
  // A sign-in screen sits outside the app: on the web it gets the minimal shell (no navigation).
  const auth = current ? isAuthScreen(current) : false;
  return selectSeed({
    platform: input.platform,
    layout: auth && input.platform?.kind !== "native-mobile" ? "minimal" : input.shell?.layout,
    screenType: (current?.screen_type ?? null) as UxScreenType | null,
    neutral: isNeutralSpec(input.spec),
  });
}

/**
 * A complete, self-contained od screen: the CSP, the design system's tokens
 * (dark mode included — the canvas sets data-theme on <html>), the seed's base
 * CSS, then the body with its navigation and brand refreshed, its own CSS
 * cleaned and its icons drawn. Content without element ids (the live preview's
 * frame) stays unnumbered; numbered content keeps its ids and new parts (a
 * refreshed navigation) are numbered after them.
 */
export function assembleOdScreen(input: OdAssembleInput): string {
  const seed = seedFor(input);
  const current = input.screens.find((s) => s.key === input.currentKey);
  let body = cleanOdStyles(input.content);
  body = refreshBrand(refreshNav(body, input.screens, input.currentKey), input.brand);
  // A title slot the model left as written gets the screen name, like the brand and nav (other slots are lint findings).
  if (current) body = body.replaceAll("[REPLACE screen title]", esc(current.name));
  body = tidySvg(expandIcons(body));
  if (body.includes("data-nid=")) body = ensureNodeIds(body);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${MOCKUP_CSP}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(current?.name ?? "Screen")} — ${esc(input.brand)}</title>
<style data-tokens>
${odTokensCss(input.spec)}
</style>
<style data-seed="${seed.id}">
${seed.css}
</style>
</head>
<body data-sdd-generator="od" data-sdd-seed="${seed.id}">
${body}
</body>
</html>`;
}
