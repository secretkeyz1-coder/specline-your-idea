import { expect, test } from "bun:test";
import { UI_TEMPLATES, UI_TEMPLATE_CATEGORIES, isExcludedUiTemplatePath } from "../src/lib/ui-templates.js";
import { getUiTemplates, readUiTemplate, templateHtmlForAnalysis, templateHtmlForAdaptation } from "../src/lib/server/ui-templates.js";
import { mkdtemp, mkdir, writeFile, unlink, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
