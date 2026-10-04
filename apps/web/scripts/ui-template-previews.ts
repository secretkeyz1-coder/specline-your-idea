/** Run from the repo or apps/web: bun apps/web/scripts/ui-template-previews.ts */
import { mkdir, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { chromium } from "playwright";
import { getUiTemplates, templateRoot } from "../src/lib/server/ui-templates.js";
import { isExcludedUiTemplatePath } from "../src/lib/ui-templates.js";
import { isReferenceAsset, REFERENCE_CSP, sanitizeReferenceHtml } from "../src/lib/server/ui-reference-policy.js";

const root = await realpath(templateRoot());
await mkdir(resolve(root, "previews"), { recursive: true });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  try {
    const path = await realpath(resolve(root, `.${decodeURIComponent(new URL(request.url).pathname)}`));
    const within = relative(root, path);
    if (within.startsWith("..") || isAbsolute(within) || isExcludedUiTemplatePath(within) || !isReferenceAsset(within)) return new Response(null, { status: 404 });
    const headers = { "Content-Security-Policy": REFERENCE_CSP, "X-Content-Type-Options": "nosniff" };
    if (/\.html?$/i.test(path)) return new Response(sanitizeReferenceHtml(await Bun.file(path).text()), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    return new Response(Bun.file(path), { headers });
  } catch { return new Response(null, { status: 404 }); }
} });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", javaScriptEnabled: false });
  await page.route("**/*", route => ["script", "xhr", "fetch", "websocket"].includes(route.request().resourceType()) ? route.abort() : route.continue());
  for (const template of (await getUiTemplates(root)).filter((t) => process.argv.length <= 2 ? !t.hasPreview : process.argv.slice(2).includes(t.id))) {
    await page.goto(`http://127.0.0.1:${server.port}/${template.file}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(1800);
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]));
    await page.screenshot({ path: resolve(root, `previews/${template.id}.png`), animations: "disabled", timeout: 10_000 });
    const proof = await page.evaluate(() => ({ sheets: document.styleSheets.length, font: getComputedStyle(document.body).fontFamily }));
    console.log(`${template.id}: ${JSON.stringify(proof)}`);
    if (!proof.sheets) throw new Error(`${template.id}: no stylesheets loaded`);
  }
} finally {
  await browser.close();
  server.stop();
}
