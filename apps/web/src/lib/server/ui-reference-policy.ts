import sanitizeHtml from "sanitize-html";
import { extname } from "node:path";

/** Reference assets are data, never a runnable vendor application. */
export const REFERENCE_CSP = "default-src 'none'; script-src 'none'; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export const REFERENCE_ASSET_EXTENSIONS = new Set([".html", ".htm", ".css", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".otf", ".eot"]);
export function isReferenceAsset(file: string): boolean {
  return REFERENCE_ASSET_EXTENSIONS.has(extname(file).toLowerCase()) && !file.replace(/\\/g, "/").split("/").some(p => p === "node_modules" || p.startsWith("."));
}

/** Defence in depth for newly mounted HTML as well as curated files.
 * Keep visual markup/styles, but discard active elements, handlers and URLs. */
export function sanitizeReferenceHtml(html: string): string {
  // Preserve notice text, never raw comment markup: browsers also recognize --!>.
  // Encode all markup and hyphens so even malformed/nested input cannot terminate
  // our newly constructed comment. Original standalone license files are unchanged.
  const encodeNotice = (text: string) => text.replace(/[&<>-]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "-": "&#45;" })[char]!);
  const notices = [...html.matchAll(/<!--([\s\S]*?)(?:--!?>|$)/g)]
    .map(m => m[1]!)
    .filter(text => /copyright|licen[sc]e|\bMIT\b|creative tim|themeselection/i.test(text))
    .map(text => `<!--${encodeNotice(text)}-->`).join("\n");
  return notices + (notices ? "\n" : "") + sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "html", "head", "body", "title", "meta", "link", "style", "img", "input", "button", "select", "option", "textarea", "form", "label", "canvas", "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "clippath", "clipPath", "lineargradient", "linearGradient", "radialgradient", "radialGradient", "stop", "use", "symbol", "text", "tspan", "picture", "source"],
    allowedAttributes: false,
    parser: { lowerCaseAttributeNames: false, lowerCaseTags: false }, // Preserve SVG viewBox geometry.
    allowVulnerableTags: true, // style is visual evidence; script is NOT allowed.
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesByTag: { a: ["http", "https", "mailto", "tel"], form: [] },
    allowedSchemesAppliedToAttributes: ["href", "src", "action", "xlink:href", "formaction"],
    transformTags: {
      "*": (tagName, attribs) => ({ tagName, attribs: Object.fromEntries(Object.entries(attribs).filter(([name, value]) => !/^on/i.test(name) && !["srcdoc", "action", "formaction", "http-equiv"].includes(name.toLowerCase()) && (!/^(?:href|src|xlink:href)$/i.test(name) || !/^[\s\u0000-\u0020]*(?:javascript|vbscript)\s*:/i.test(value.replace(/[\u0000-\u0020]/g, "")))).map(([name, value]) => [/^(?:href|src|xlink:href)$/i.test(name) ? name.toLowerCase() : name, value])) }),
    },
    exclusiveFilter: frame => frame.tag === "link" && !/^(?:stylesheet|icon)$/i.test(frame.attribs.rel ?? ""),
  }).replace(/[\t ]+$/gm, "");
}
