/** bun apps/web/scripts/curate-ui-references.ts <verified-archive> <new-output-directory>
 * Never overwrites an existing tree. Vendor tools are never installed or executed. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import postcss, { type AcceptedPlugin } from "postcss";
import tailwindcss from "tailwindcss-reference";
import { resolve, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isExcludedUiTemplatePath } from "../src/lib/ui-templates.js";
import { isReferenceAsset, sanitizeReferenceHtml } from "../src/lib/server/ui-reference-policy.js";

const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
export async function curateReferences(archive: string, output: string) {
  const root = resolve(archive, "Referensi UI");
  const destination = resolve(output);
  if (existsSync(destination)) throw new Error("Output already exists; refusing overwrite.");
  const inventoryBytes = await readFile(resolve(archive, "inventory.sha256.json"));
  const inventory = JSON.parse(inventoryBytes.toString()) as { publicationRevision: string; files: Array<{ path: string; bytes: number; sha256: string }> };
  // Verify the entire archive before writing any output, not only selected assets.
  for (const entry of inventory.files) {
    const path = resolve(root, entry.path);
    if (relative(root, path).startsWith("..") || hash(await readFile(path)) !== entry.sha256) throw new Error(`Archive verification failed: ${entry.path}`);
  }
  const files = inventory.files.map(f => f.path).sort();
  const originalEntries = new Map(inventory.files.map(f => [f.path, f]));
  const available = new Set(files);
  const selected = new Set(files.filter(f => !isExcludedUiTemplatePath(f) && (/\.html?$/i.test(f) || /(?:^|\/)(?:licen[sc]e[^/]*|notice[^/]*|copying[^/]*)$/i.test(f) || f.startsWith("LICENSES/")) && !f.includes("node_modules/")));
  const contents = new Map<string, Buffer>();
  const missing = new Set<string>();
  const external = new Set<string>();
  const queue = [...selected];
  function link(from: string, raw: string) {
    const value = raw.trim().replace(/&amp;/g, "&");
    if (!value || value.startsWith("#") || /^(?:data:|mailto:|tel:)/i.test(value)) return;
    if (/^(?:[a-z]+:|\/\/)/i.test(value)) { external.add(value); return; }
    let decoded: string;
    try { decoded = decodeURIComponent(value.split(/[?#]/)[0]!); } catch { return; }
    const path = resolve(value.startsWith("/") ? root : dirname(resolve(root, from)), value.startsWith("/") ? `.${decoded}` : decoded);
    const local = relative(root, path).replace(/\\/g, "/");
    if (local.startsWith("..") || isExcludedUiTemplatePath(local) || !isReferenceAsset(local)) return;
    if (!available.has(local)) { missing.add(`${from} -> ${value}`); return; }
    if (!selected.has(local)) { selected.add(local); queue.push(local); }
  }
  while (queue.length) {
    const file = queue.shift()!;
    let bytes = await readFile(resolve(root, file));
    if (/\.html?$/i.test(file)) {
      const original = bytes.toString();
      let html = sanitizeReferenceHtml(original);
      if (/cdn\.tailwindcss\.com/.test(original)) {
        // Compile data-only class evidence; never evaluate vendor tailwind.config.
        // These six local CDN pages only extend fontFamily.sans.
        const font = /'sans'\s*:\s*\[([^\]]+)\]/.exec(original)?.[1];
        const families = font ? [...font.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]!) : undefined;
        const css = await postcss([tailwindcss({ content: [{ raw: original, extension: "html" }], theme: { extend: families ? { fontFamily: { sans: families } } : {} } }) as unknown as AcceptedPlugin]).process("@tailwind base; @tailwind components; @tailwind utilities;", { from: undefined });
        html = html.replace("</head>", `<style>${css.css}</style></head>`);
      }
      bytes = Buffer.from(html);
    }
    contents.set(file, bytes);
    if (/\.(?:html?|css|svg)$/i.test(file)) {
      const text = bytes.toString();
      for (const match of text.matchAll(/(?:href|src|poster|xlink:href)\s*=\s*["']([^"']+)["']/gi)) link(file, match[1]!);
      for (const match of text.matchAll(/srcset\s*=\s*["']([^"']+)["']/gi)) for (const item of match[1]!.split(",")) link(file, item.trim().split(/\s+/)[0]!);
      for (const match of text.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) link(file, match[1] ?? match[2]!);
    }
  }
  const entries = [];
  for (const file of [...selected].sort()) {
    const bytes = contents.get(file)!;
    await mkdir(dirname(resolve(destination, file)), { recursive: true });
    await writeFile(resolve(destination, file), bytes);
    const original = originalEntries.get(file)!;
    entries.push({ path: file, bytes: bytes.length, sha256: hash(bytes), sourceSha256: original.sha256 });
  }
  const manifest = { schema: 1, policy: "script-free reference data; linked visual assets and original license notices only", publicationRevision: inventory.publicationRevision, archiveInventorySha256: hash(inventoryBytes), preservedArchiveFiles: inventory.files.length, removedFiles: inventory.files.length - entries.length, files: entries, missingLocalReferences: [...missing].sort(), externalReferences: [...external].sort() };
  await writeFile(resolve(destination, "asset-inventory.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}
if (import.meta.main) {
  const [archive, output] = process.argv.slice(2);
  if (!archive || !output) throw new Error("Usage: curate-ui-references.ts <verified-archive> <new-output-directory>");
  const result = await curateReferences(archive, output);
  console.log(JSON.stringify({ preserved: result.preservedArchiveFiles, retained: result.files.length, removed: result.removedFiles, missing: result.missingLocalReferences.length, external: result.externalReferences.length }));
}
