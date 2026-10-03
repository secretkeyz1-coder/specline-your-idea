import { Parser } from "htmlparser2";

/**
 * The sanitizer for UI-reference page content (model output, canvas saves and
 * element edits). Screens are shown in a sandboxed, CSP-locked iframe and
 * later written into developers' repositories by `sddctl ui pull`, so what is
 * stored must be inert wherever it is opened.
 *
 * A regex pass could be walked around (`<svg/onload=…>`, `<scr<script>ipt>`,
 * `&#106;avascript:`, a tag rebuilt from the pieces left after one pass). This
 * one parses the HTML and writes it out again from an allowlist: only the tags
 * and attributes a mockup needs survive, every text and attribute value is
 * escaped on the way out, so nothing the model wrote can turn back into markup
 * when a browser reads the result.
 *
 * The one raw-text element kept is <style> (composition CSS, cleaned and
 * scoped later by ux-compose.ts) — outside SVG only, and with every `<`
 * removed, so it can never close itself or open a tag in any parsing context.
 */

/** HTML elements a mockup may use; forms and controls are kept as inert drawings. */
const HTML_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "button", "caption", "cite", "code", "col", "colgroup",
  "data", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt", "em", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "input", "ins", "kbd", "label", "legend", "li", "main", "mark",
  "menu", "meter", "nav", "ol", "optgroup", "option", "output", "p", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "search",
  "section", "select", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "textarea", "tfoot", "th", "thead",
  "time", "tr", "u", "ul", "var", "wbr",
]);

/** SVG elements charts and icons need. No gradients, patterns, <use>, images, links or animation. */
const SVG_TAGS = new Set(["svg", "g", "path", "line", "polyline", "polygon", "circle", "ellipse", "rect", "text", "tspan", "title", "desc"]);

/**
 * Dropped together with everything inside them: active or embedding
 * elements, the document's own head parts, and elements a browser parses as
 * raw text (their content would read differently there than here).
 */
const DROP_WITH_CONTENT = new Set([
  "script", "noscript", "iframe", "frame", "frameset", "object", "embed", "applet", "param", "template", "xmp", "plaintext", "noembed",
  "noframes", "math", "base", "link", "meta", "title", "audio", "video", "source", "track", "canvas", "picture", "portal", "slot",
]);

const VOID = new Set(["br", "col", "hr", "img", "input", "wbr"]);
const BOOLEAN = new Set(["checked", "disabled", "readonly", "required", "selected", "multiple", "hidden", "open", "reversed", "novalidate"]);

const GLOBAL_ATTRS = new Set(["class", "id", "role", "title", "lang", "dir", "hidden", "tabindex", "style"]);
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href"],
  img: ["src", "alt", "width", "height"],
  input: ["type", "name", "value", "placeholder", "checked", "disabled", "readonly", "required", "min", "max", "step", "maxlength", "minlength", "size", "multiple", "autocomplete", "inputmode", "list", "pattern"],
  button: ["type", "name", "value", "disabled"],
  select: ["name", "disabled", "multiple", "size", "required"],
  option: ["value", "selected", "disabled", "label"],
  optgroup: ["label", "disabled"],
  textarea: ["name", "rows", "cols", "placeholder", "disabled", "readonly", "required", "maxlength", "wrap"],
  label: ["for"],
  output: ["for", "name"],
  // No action, method or target: a mockup form never submits anywhere.
  form: ["name", "novalidate", "autocomplete"],
  fieldset: ["disabled", "name"],
  td: ["colspan", "rowspan", "headers"],
  th: ["colspan", "rowspan", "headers", "scope", "abbr"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  details: ["open"],
  dialog: ["open"],
  time: ["datetime"],
  data: ["value"],
  del: ["datetime"],
  ins: ["datetime"],
  progress: ["value", "max"],
  meter: ["value", "min", "max", "low", "high", "optimum"],
};
const SVG_ATTRS = new Set([
  "viewbox", "preserveaspectratio", "xmlns", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
  "dx", "dy", "rotate", "textlength", "lengthadjust", "pathlength", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "stroke-miterlimit", "opacity", "clip-rule",
  "vector-effect", "shape-rendering", "text-anchor", "dominant-baseline", "alignment-baseline", "font-size", "font-weight", "letter-spacing", "focusable",
]);
/** The parser lowercases attribute names; SVG needs these in their own case. */
const SVG_CASE: Record<string, string> = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  textlength: "textLength",
  lengthadjust: "lengthAdjust",
  pathlength: "pathLength",
};

/** Internal links only: an anchor on the page, or another screen of the reference. */
const SAFE_HREF = /^(?:#[\w-]*|\.\/[a-z0-9][a-z0-9-]*\.html(?:#[\w-]*)?)$/i;
const SAFE_IMG = /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;
/** CSS that can fetch, run code or hide either behind an escape. */
const ACTIVE_CSS = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding|\\/i;
const MAX_DEPTH = 200;

type El = { tag: string; attrs: Record<string, string>; children: Array<El | string> };

/** The parsed tree, as htmlparser2 builds it (optional end tags closed, raw-text elements kept as text). */
function parse(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  // Elements nested past MAX_DEPTH are unwrapped into their parent, so the
  // serializer's recursion stays shallow whatever the input.
  const stack: Array<{ el: El; real: boolean }> = [{ el: root, real: true }];
  const current = () => stack[stack.length - 1]!.el;
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        if (stack.length > MAX_DEPTH) {
          stack.push({ el: current(), real: false });
          return;
        }
        const el: El = { tag, attrs, children: [] };
        current().children.push(el);
        stack.push({ el, real: true });
      },
      onclosetag() {
        if (stack.length > 1) stack.pop();
      },
      ontext(text) {
        const children = current().children;
        const last = children[children.length - 1];
        if (typeof last === "string") children[children.length - 1] = last + text;
        else children.push(text);
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.end(html);
  return root;
}

const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
/** A URL as a browser reads it: entities are already decoded; controls and whitespace are ignored inside a scheme. */
const bareUrl = (v: string) => v.replace(/[\u0000- \u007f-\u009f]+/g, "");

/** An inline style without the declarations that could fetch or run anything; null when nothing is left. */
export function cleanStyleAttr(value: string): string | null {
  const source = value.replace(/\/\*[\s\S]*?\*\//g, "");
  const decls = source.split(";");
  const kept = decls.filter((d) => !ACTIVE_CSS.test(d));
  if (kept.length === decls.length && source === value) return value.trim() || null;
  const out = kept.map((d) => d.trim()).filter(Boolean).join("; ");
  return out || null;
}

/** Composition CSS kept as text: no `<` (it could end the element) and no imports. */
function cleanStyleText(css: string): string {
  return css.replace(/</g, " ").replace(/@import\b[^;]*;?/gi, "");
}

function cleanAttrs(tag: string, attrs: Record<string, string>, svg: boolean): string {
  let out = "";
  for (const [rawName, rawValue] of Object.entries(attrs)) {
    const name = rawName.toLowerCase();
    let value: string | null = rawValue;
    const allowed = svg
      ? SVG_ATTRS.has(name) || GLOBAL_ATTRS.has(name) || /^(?:data|aria)-[a-z0-9._-]+$/.test(name)
      : GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.includes(name) || /^(?:data|aria)-[a-z0-9._-]+$/.test(name);
    if (!allowed) continue;
    if (name === "style") value = cleanStyleAttr(value);
    else if (name === "href") value = SAFE_HREF.test(bareUrl(value)) ? bareUrl(value) : "#";
    else if (name === "src") value = SAFE_IMG.test(value.trim()) ? value.trim() : null;
    else if (name === "xmlns") value = value.trim() === "http://www.w3.org/2000/svg" ? value.trim() : null;
    else if (svg && SVG_ATTRS.has(name) && ACTIVE_CSS.test(value)) value = null;
    if (value === null) continue;
    const outName = svg ? (SVG_CASE[name] ?? name) : name;
    out += value === "" && BOOLEAN.has(name) ? ` ${outName}` : ` ${outName}="${escAttr(value)}"`;
  }
  return out;
}

function serialize(nodes: Array<El | string>, svg: boolean, out: string[]): void {
  for (const node of nodes) {
    if (typeof node === "string") {
      out.push(escText(node));
      continue;
    }
    const { tag } = node;
    if (svg) {
      // Inside a drawing only drawing elements; anything else goes with its content.
      if (!SVG_TAGS.has(tag)) continue;
      const attrs = cleanAttrs(tag, node.attrs, true);
      if (!node.children.length && tag !== "svg") {
        out.push(`<${tag}${attrs}/>`);
        continue;
      }
      out.push(`<${tag}${attrs}>`);
      serialize(node.children, true, out);
      out.push(`</${tag}>`);
      continue;
    }
    if (tag === "svg") {
      out.push(`<svg${cleanAttrs(tag, node.attrs, true)}>`);
      serialize(node.children, true, out);
      out.push("</svg>");
    } else if (tag === "style") {
      const css = node.children.map((c) => (typeof c === "string" ? c : "")).join("");
      const attrs = Object.keys(node.attrs).filter((n) => /^data-[a-z0-9._-]+$/.test(n));
      out.push(`<style${attrs.map((n) => (node.attrs[n] ? ` ${n}="${escAttr(node.attrs[n]!)}"` : ` ${n}`)).join("")}>${cleanStyleText(css)}</style>`);
    } else if (DROP_WITH_CONTENT.has(tag)) {
      continue;
    } else if (HTML_TAGS.has(tag)) {
      out.push(`<${tag}${cleanAttrs(tag, node.attrs, false)}>`);
      if (VOID.has(tag)) continue;
      serialize(node.children, false, out);
      out.push(`</${tag}>`);
    } else {
      // Unknown or structural (html, head, body, custom elements): keep what is inside.
      serialize(node.children, false, out);
    }
  }
}

/**
 * Page content as the platform stores it: parsed, filtered through the
 * allowlist and written out again. Idempotent — clean content cleans to itself.
 */
export function sanitizeHtml(html: string): string {
  const out: string[] = [];
  serialize(parse(html).children, false, out);
  return out.join("");
}
