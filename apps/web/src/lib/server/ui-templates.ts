import { readFile, realpath, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { UI_TEMPLATES, isExcludedUiTemplatePath, type UiTemplate, type UiTemplateCategory } from "../ui-templates.js";
import { sanitizeReferenceHtml } from "./ui-reference-policy.js";

export function templateRoot(): string {
  const candidates = [
    ...(process.env.UI_TEMPLATE_DIR ? [resolve(process.env.UI_TEMPLATE_DIR)] : []),
    resolve(process.cwd(), "Referensi UI"), resolve(process.cwd(), "../../Referensi UI"),
  ];
  const root = candidates.find(existsSync);
  if (!root) throw new Error("The built-in UI template collection is not installed.");
  return root;
}

const ASSET_DIRS = new Set(["assets", "vendor", "vendors", "node_modules", ".git", "previews", "licenses", "docs", "documentation", "css", "js", "fonts", "img", "images", "libs"]);
const COMPONENT_PAGE = /^(?:blank|starter|404|500|alert|avatar|badge|button|card|chart|color|icon|typography|utility|utilities|extended-ui|ui-|form-elements|basic_elements|documentation)/i;

function categoryOf(file: string): UiTemplateCategory {
  if (/(?:login|sign[\s_-]?in|register|signup|sign-up|forgot-password|reset-password)/i.test(file)) return "Login";
  if (/(?:kanban|chat|tasks|table|inbox|calendar|billing|profile)/i.test(file)) return "Workspace";
  if (/(?:store|shop|ecommerce|products|nordic)/i.test(file)) return "Store";
  if (/(?:landing|landwind|agency|portfolio|presentation|tailgrids|tailwindcss-templates)/i.test(file)) return "Landing page";
  if (/(?:dashboard|admin|coreui|tabler|sneat|materio)/i.test(file)) return "Dashboard";
  return "Other";
}

/** Read on demand: scraping can add/remove pages without rebuilding the app.
 * Curated names stay first; new content pages get deterministic IDs from paths. */
export async function getUiTemplates(root = templateRoot()): Promise<UiTemplate[]> {
  const templates: UiTemplate[] = UI_TEMPLATES.filter((t) => !isExcludedUiTemplatePath(t.file) && existsSync(resolve(root, t.file))).map((t) => ({ ...t }));
  const known = new Set(templates.map((t) => t.file));
  async function walk(folder: string) {
    const entries = await readdir(resolve(root, folder), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = folder ? `${folder}/${entry.name}` : entry.name;
      if (isExcludedUiTemplatePath(file)) continue;
      if (entry.isDirectory() && !ASSET_DIRS.has(entry.name.toLowerCase()) && !entry.name.startsWith(".")) await walk(file);
      if (!entry.isFile() || !/\.html?$/i.test(entry.name) || known.has(file) || COMPONENT_PAGE.test(entry.name)) continue;
      const stem = file.replace(/\.html?$/i, "").replace(/\/index$/i, "");
      templates.push({
        id: `page-${createHash("sha256").update(file).digest("hex").slice(0, 16)}`,
        name: stem.replace(/[\/_-]+/g, " · ").slice(0, 80),
        category: categoryOf(file), file,
        description: "Added from the reference collection. Check the preview or analysed layout before use.",
      });
    }
  }
  await walk("");
  return templates.map((t) => {
    const preview = resolve(root, `previews/${t.id}.png`);
    // ponytail: mtime freshness; use source hashes if a scraper preserves old timestamps.
    let hasPreview = false;
    let previewVersion = 0;
    try {
      previewVersion = statSync(preview).mtimeMs;
      hasPreview = previewVersion >= statSync(resolve(root, t.file)).mtimeMs;
    } catch { /* Scraping may replace a page while the gallery reads it. */ }
    return { ...t, hasPreview, previewVersion };
  });
}

/** Trusted built-in pages can be large because of icon paths and demo scripts.
 * Remove those before the API's input bound so the actual page is retained.
 * The API still performs its normal untrusted-layout sanitization. */
export function templateHtmlForAnalysis(content: Buffer): string {
  const html = content.toString("utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/(<svg\b[^>]*>)[\s\S]*?<\/svg\s*>/gi, "$1</svg>")
    .replace(/>\s+</g, "><");
  if (html.length > 200_000) throw new Error("This template needs a smaller layout sample.");
  return html;
}

/** Only catalog IDs are accepted; clients never supply a filesystem path. */
export async function readUiTemplate(id: string, kind: "html" | "preview" = "html", collectionRoot = templateRoot()) {
  const template = (await getUiTemplates(collectionRoot)).find((t) => t.id === id);
  if (!template) throw new Error("Unknown UI template.");
  const root = await realpath(collectionRoot);
  const file = await realpath(resolve(root, kind === "preview" ? `previews/${template.id}.png` : template.file));
  const within = relative(root, file);
  if (within.startsWith("..") || isAbsolute(within) || isExcludedUiTemplatePath(within)) throw new Error("Template file is outside the public collection.");
  const content = await readFile(file);
  return { template, content: kind === "html" ? Buffer.from(sanitizeReferenceHtml(content.toString())) : content };
}

/** Include local stylesheet evidence for adaptation; never fetch template URLs or execute its scripts. */
export async function templateHtmlForAdaptation(id: string, collectionRoot = templateRoot()): Promise<string> {
  const selected = await readUiTemplate(id, "html", collectionRoot);
  const root = await realpath(collectionRoot);
  let html = templateHtmlForAnalysis(selected.content);
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(m => m[1]!).join("\n");
  // Scraped plugin CSS can precede the theme and consume the evidence budget.
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
  const classes = new Set([...html.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)].flatMap(m => m[1]!.split(/\s+/).filter(Boolean)));
  let css = "";
  for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(link[0])) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(link[0])?.[1];
    if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) continue;
    try {
      const path = await realpath(resolve(dirname(resolve(root, selected.template.file)), href.split(/[?#]/)[0]!));
      const within = relative(root, path);
      if (within.startsWith("..") || isAbsolute(within) || isExcludedUiTemplatePath(within) || !path.endsWith(".css") || statSync(path).size > 2_000_000) continue;
      const content = (await readFile(path, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
      // ponytail: bounded CSS evidence, not a CSS bundler; complex selectors can be approximated by the model.
      const rules = [...content.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      const global = (r: RegExpMatchArray) => /:root|:host|--(?:color|font|radius|spacing)[\w-]*\s*:/.test(r[0]) || /(?:^|,)\s*(?:body|html|h[1-6])(?:\s|,|$)/.test(r[1]!);
      for (const rule of [...rules.filter(global), ...rules.filter(r => !global(r))]) {
        const selectors = rule[1]!.replace(/\\/g, "");
        if (!global(rule) && ![...classes].some(c => selectors.includes(`.${c}`))) continue;
        const safe = rule[0].replace(/url\([^)]*\)/gi, "none").replace(/<\/?style/gi, "");
        if (css.length + safe.length > 20_000) break;
        css += safe;
      }
      html = html.replace(link[0], "");
    } catch { /* Missing/external stylesheet stays visible as an adaptation limitation. */ }
  }
  // Embedded styles are essential for HTML-only templates. Keep them after
  // linked theme evidence so their source cascade wins in the visual import.
  const remaining = Math.max(0, 20_000 - css.length);
  const inlineRules = [...inlineCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => m[0]);
  let embedded = "";
  for (const rule of inlineRules) {
    if (embedded.length + rule.length > remaining) break;
    embedded += rule.replace(/url\([^)]*\)/gi, "none").replace(/<\/?style/gi, "");
  }
  return `${html}\n<style>${css}${embedded}</style>`;
}
