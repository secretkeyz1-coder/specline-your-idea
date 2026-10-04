import { expect, test } from "bun:test";
import { parseDocument, DomUtils } from "htmlparser2";
import { cssEvidenceRules } from "../src/lib/server/template-parser.js";
import { UI_TEMPLATES, UI_TEMPLATE_CATEGORIES, isExcludedUiTemplatePath } from "../src/lib/ui-templates.js";
import { getUiTemplates, readUiTemplate, templateHtmlForAnalysis, templateHtmlForAdaptation } from "../src/lib/server/ui-templates.js";
import { mkdtemp, mkdir, writeFile, unlink, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { templateRoot } from "../src/lib/server/ui-templates.js";
import { sanitizeReferenceHtml, isReferenceAsset, REFERENCE_CSP } from "../src/lib/server/ui-reference-policy.js";
import { curateReferences } from "../scripts/curate-ui-references.js";

test("reference policy discards execution while retaining visual SVG/style evidence", () => {
  const html = sanitizeReferenceHtml('<html><head><script>bad()</script><style>.card{display:grid}</style><meta http-equiv="refresh" content="0;url=https://example.com"></head><body onload="bad()"><iframe srcdoc="bad"></iframe><a href="javascript:bad()">x</a><svg viewBox="0 0 24 24"><path d="M0 0" /></svg></body></html>');
  expect(html).not.toMatch(/<script|<iframe|onload|javascript:|http-equiv|srcdoc/i);
  expect(html).toContain('viewBox="0 0 24 24"');
  expect(html).toContain("display:grid");
  const svg = sanitizeReferenceHtml('<svg viewBox="0 0 10 10"><defs><linearGradient id="a"><stop offset="0%" /></linearGradient><radialGradient id="b"/><clipPath id="c"><rect width="10" /></clipPath></defs><rect fill="url(#a)" clip-path="url(#c)" /></svg>');
  expect(svg).toContain('<linearGradient id="a">');
  expect(svg).toContain('<radialGradient id="b">');
  expect(svg).toContain('<clipPath id="c">');
  expect(svg).toContain('fill="url(#a)"');
  const urls = sanitizeReferenceHtml('<a HREF="javascript:alert(1)">x</a><img SRC="java&#10;script:alert(1)"><svg><use XLink:href="vbscript:bad()"/></svg>');
  expect(urls).not.toMatch(/(?:java|vb)script|alert\(1\)|bad\(\)/i);
  expect(REFERENCE_CSP).toContain("script-src 'none'");
  for (const file of ["x.js", "x.json", "node_modules/a.css", ".git/a.html", "x.scss"]) expect(isReferenceAsset(file)).toBe(false);
});

test("attribution preservation cannot reintroduce markup through browser comment boundaries", () => {
  const reproduction = sanitizeReferenceHtml('<!-- MIT --!><script>alert(1)</script><!-- -->');
  expect(reproduction).toContain("MIT");
  expect(reproduction).not.toMatch(/<script|alert\(1\)|--!>/i);
  const nested = sanitizeReferenceHtml('<!-- Copyright MIT <img src=x onerror=bad()> <!-- nested --!><script>bad()</script>');
  const notice = /<!--([\s\S]*?)-->/.exec(nested)![1]!;
  expect(notice).toContain("Copyright MIT");
  expect(notice).toContain("&lt;img");
  expect(notice).not.toMatch(/[<>-]/);
  const doc = parseDocument(nested);
  expect(DomUtils.getElementsByTagName("script", doc, true)).toHaveLength(0);
  expect(DomUtils.getElementsByTagName("img", doc, true)).toHaveLength(0);
  expect(DomUtils.textContent(doc)).not.toContain("bad()");
});

test("published inventory is hash-valid, script-free, and keeps all catalogue roots", async () => {
  const root = templateRoot();
  const inventory = JSON.parse(await readFile(join(root, "asset-inventory.json"), "utf8"));
  expect(inventory.preservedArchiveFiles).toBe(6099);
  expect(inventory.files).toHaveLength(1506);
  for (const file of inventory.files) {
    const data = await readFile(join(root, file.path));
    expect(createHash("sha256").update(data).digest("hex")).toBe(file.sha256);
    expect(file.path).not.toMatch(/(?:package.*\.json|lock|\.(?:js|ts|scss|less|map))$/i);
    if (/\.html?$/i.test(file.path)) expect(data.toString()).not.toMatch(/<script\b|\son\w+\s*=|<iframe\b/i);
    if (/(?:^|\/)(?:license|notice)/i.test(file.path)) expect(file.sha256).toBe(file.sourceSha256);
  }
  expect((await getUiTemplates(root)).length).toBe(294);
  expect(new Set((await getUiTemplates(root)).map(t => t.file.split("/")[0])).size).toBe(15);
  const foundation = await readFile(join(root, "tailwindcss-templates/layouts/foundation.html"), "utf8");
  expect(foundation).toContain("Roboto Condensed");
  expect(foundation).toContain(".bg-black");
});

test("curation verifies source hashes and produces deterministic visual dependency closure", async () => {
  const temp = await mkdtemp(join(tmpdir(), "sdd-curation-"));
  try {
    const archive = join(temp, "archive"), root = join(archive, "Referensi UI");
    await mkdir(join(root, "assets"), { recursive: true });
    const sources: Record<string, string> = {
      "index.html": '<html><head><link rel="stylesheet" href="assets/theme.css"></head><body><img src="assets/image.svg"><script src="vendor.js"></script></body></html>',
      "assets/theme.css": '@import "extra.css";body{background:url(image.svg)}',
      "assets/extra.css": "body{display:grid}", "assets/image.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
      "vendor.js": "danger()", "package.json": '{"dependencies":{"legacy":"1"}}', "LICENSE": "Original notice",
    };
    const files = [];
    for (const [path, data] of Object.entries(sources)) {
      await writeFile(join(root, path), data);
      files.push({ path, bytes: Buffer.byteLength(data), sha256: createHash("sha256").update(data).digest("hex") });
    }
    await writeFile(join(archive, "inventory.sha256.json"), JSON.stringify({ publicationRevision: "fixture", files }));
    const a = await curateReferences(archive, join(temp, "a"));
    const b = await curateReferences(archive, join(temp, "b"));
    expect(a).toEqual(b);
    expect(a.files.map(f => f.path)).toEqual(["LICENSE", "assets/extra.css", "assets/image.svg", "assets/theme.css", "index.html"]);
    expect(a.missingLocalReferences).toEqual([]);
    await expect(curateReferences(archive, join(temp, "a"))).rejects.toThrow("Output already exists");
    await writeFile(join(root, "vendor.js"), "changed");
    await expect(curateReferences(archive, join(temp, "bad"))).rejects.toThrow("Archive verification failed");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("curated UI templates have unique IDs and real HTML; local previews are optional", async () => {
  expect(new Set(UI_TEMPLATES.map((t) => t.id)).size).toBe(UI_TEMPLATES.length);
  expect(UI_TEMPLATE_CATEGORIES).toEqual(["Dashboard", "Login", "Landing page", "Store"]); // Workspace pages remain discoverable dynamically.
  for (const template of UI_TEMPLATES) {
    const html = await readUiTemplate(template.id);
    expect(html.content.toString()).toMatch(/<html[\s>]/i);
    const compact = templateHtmlForAnalysis(html.content);
    expect(compact.length).toBeLessThanOrEqual(200_000);
    expect(compact).toMatch(/<\/body>/i);
    if (html.template.hasPreview) {
      const preview = await readUiTemplate(template.id, "preview");
      expect(preview.content.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  }
});

test("excluded local vendors cannot reappear through curated or dynamic catalog entries", async () => {
  expect(UI_TEMPLATES.every((t) => !isExcludedUiTemplatePath(t.file))).toBe(true);
  const root = await mkdtemp(join(tmpdir(), "sdd-public-catalog-"));
  try {
    for (const source of ["preline", "tabler", "tailadmin", "nested/Preline"]) {
      await mkdir(join(root, source), { recursive: true });
      await writeFile(join(root, source, "index.html"), "<html><body>Excluded</body></html>");
    }
    await writeFile(join(root, "index.html"), "<html><body>Included</body></html>");
    const entries = await getUiTemplates(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.file).toBe("index.html");
    await expect(readUiTemplate("preline-cms", "html", root)).rejects.toThrow("Unknown UI template");
    await expect(readUiTemplate("tabler-crm", "preview", root)).rejects.toThrow("Unknown UI template");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("adaptation does not read excluded vendor stylesheets through cross-source references", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdd-public-css-"));
  try {
    await mkdir(join(root, "preline"));
    await writeFile(join(root, "preline", "theme.css"), "body{font-family:ExcludedVendor}");
    await writeFile(join(root, "index.html"), '<html><head><link rel="stylesheet" href="preline/theme.css"></head><body>Included</body></html>');
    const entry = (await getUiTemplates(root))[0]!;
    expect(await templateHtmlForAdaptation(entry.id, root)).not.toContain("ExcludedVendor");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("analysis structurally removes malformed comments and scripts while retaining attributes", () => {
  const html = templateHtmlForAnalysis(Buffer.from('<html><body><main class="card" data-note="a > b">Data</main><svg viewBox="0 0 10 10"><path d="x"/></svg><!-- note --!><script>demo()</script></body></html>'));
  expect(html).not.toContain("demo()");
  expect(html).not.toContain("<script");
  expect(html).toContain('viewBox="0 0 10 10"');
  expect(html).toContain('data-note="a &gt; b"');
});

test("CSS evidence preserves valid declarations and cannot close its HTML style context", () => {
  const rules = cssEvidenceRules('/* note */.card{display:grid;content:"</style><img src=x>";background:url(https://example.invalid/a)}');
  expect(rules).toHaveLength(1);
  expect(rules[0]!.css).toContain("display:grid");
  expect(rules[0]!.css).not.toContain("<");
  expect(rules[0]!.css).not.toContain("url(");
  expect(rules[0]!.css).not.toContain("/*");
  expect(cssEvidenceRules('.card{display:grid}/* unclosed')).toEqual([]);
});

test("large icon and demo-script payloads do not cut off the actual page", () => {
  const source = Buffer.from(`<html><body><nav><svg class="icon">${"<path d='123'/>".repeat(20_000)}</svg></nav><main>Data grid</main><script>${"demo();".repeat(30_000)}</script></body></html>`);
  expect(templateHtmlForAnalysis(source)).toBe('<html><body><nav><svg class="icon"></svg></nav><main>Data grid</main></body></html>');
});

test("adaptation includes the template's local visual CSS without running scripts or loading URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdd-adaptation-css-"));
  try {
    await writeFile(join(root, "theme.css"), 'body{font-family:Georgia;background:#fef3c7}.card{background:url(https://example.com/image.png)}');
    await writeFile(join(root, "index.html"), '<html><head><link rel="stylesheet" href="theme.css"></head><body><main class="card">Example</main><script>demo()</script></body></html>');
    const entry = (await getUiTemplates(root))[0]!;
    const html = await templateHtmlForAdaptation(entry.id, root);
    expect(html).toContain("<main");
    expect(html).toContain("<style>");
    expect(html).toContain("font-family:Georgia");
    expect(html).toContain("#fef3c7");
    expect(html).not.toMatch(/<script\b|url\(https?:/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("UI template reader accepts catalog IDs only, not arbitrary paths", async () => {
  await expect(readUiTemplate("../../.env")).rejects.toThrow("Unknown UI template");
  await expect(readUiTemplate("sneat/html/index.html")).rejects.toThrow("Unknown UI template");
});

test("HTML-only templates retain embedded visual CSS for adaptation", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdd-inline-template-"));
  try {
    await writeFile(join(root, "index.html"), '<html><head><style>body{font-family:Georgia;background:#fef3c7}.card{border-radius:20px}</style></head><body><main class="card">Example</main></body></html>');
    const entry = (await getUiTemplates(root))[0]!;
    const html = await templateHtmlForAdaptation(entry.id, root);
    expect(html).toContain("font-family:Georgia");
    expect(html).toContain("border-radius:20px");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a running collection detects added, changed and removed HTML without code edits; previews are optional", async () => {
  const root = await mkdtemp(join(tmpdir(), "sdd-ui-catalog-"));
  try {
    await mkdir(join(root, "new-dashboard"));
    expect(await getUiTemplates(root)).toEqual([]);
    const file = join(root, "new-dashboard", "index.html");
    await writeFile(file, "<html><body><main>First version</main></body></html>");
    const first = await getUiTemplates(root);
    expect(first).toHaveLength(1);
    expect(first[0].category).toBe("Dashboard");
    expect(first[0].hasPreview).toBe(false);
    await mkdir(join(root, "previews"));
    await writeFile(join(root, "previews", `${first[0].id}.png`), "preview");
    expect((await getUiTemplates(root))[0].hasPreview).toBe(true);
    await writeFile(file, "<html><body><main>Updated version</main></body></html>");
    const later = new Date(Date.now() + 2000);
    await utimes(file, later, later);
    expect((await getUiTemplates(root))[0].hasPreview).toBe(false);
    expect((await getUiTemplates(root))[0].id).toBe(first[0].id);
    expect((await readUiTemplate(first[0].id, "html", root)).content.toString()).toContain("Updated version");
    await writeFile(join(root, "new-dashboard", "buttons.html"), "<html>component demo</html>");
    expect(await getUiTemplates(root)).toHaveLength(1);
    await unlink(file);
    expect(await getUiTemplates(root)).toEqual([]);
    await expect(readUiTemplate(first[0].id, "html", root)).rejects.toThrow("Unknown UI template");
  } finally { await rm(root, { recursive: true, force: true }); }
});
