/**
 * Baseline of a UI reference as it is drawn today (aturan.md §8.1 step 1):
 * a repeatable "before" to compare a change against. No AI call is made —
 * it records what is already stored.
 *
 *   DATABASE_URL=postgres://… bun apps/api/scripts/ux-baseline.ts \
 *     --project <project id> --screens kasir,orders,kds --out baseline/before [--version draft|approved]
 *
 * For each screen it writes <out>/<screen key>/:
 *   inputs.json      the screen's plan (name, type, purpose, requirements, key
 *                    elements, primary action, overlays, states, layout note,
 *                    layout reference) plus the reference's brief, platform,
 *                    fidelity, shell and the sample records it can use
 *   generation.json  the last AI drawing's model, profile, output limit,
 *                    tokens, cut-off, time and repair (null before §5.7)
 *   lint.json        the findings stored with the drawing
 *   <device>.png     the main view at each device size (overlays hidden), full page
 *   overlays.png     the overlay and state frames, at the primary size
 *   review.md        the five §5.6 aspects, every one "belum diperiksa", to fill in
 * and <out>/baseline.json with the project, version, time and screens.
 *
 * Screenshots need a Chromium for playwright-core (UX_RENDER_CHROMIUM, or the
 * Playwright browser cache). Pages render with JavaScript off and every
 * network request aborted, as the render check does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "@sdd/db";
import { UX_DEVICES, type UxReference } from "@sdd/contracts";
import { getUxState } from "../src/modules/ux/ux-state.js";
import { platformOf } from "../src/modules/ux/ux-platform.js";
import { REVIEW_ASPECT_LABELS } from "../src/modules/ux/ux-review.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectId = arg("project");
const out = arg("out");
const wanted = (arg("screens") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const which = arg("version") === "approved" ? "approved" : "draft";
if (!projectId || !out || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=… bun apps/api/scripts/ux-baseline.ts --project <id> --screens a,b,c --out <dir> [--version draft|approved]");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);
try {
  const state = await getUxState(db, projectId);
  const view = (which === "approved" ? state.approved : state.draft) ?? state.draft ?? state.approved;
  const ref = view?.reference as UxReference | null | undefined;
  if (!view || !ref) throw new Error("This project has no UI reference to record.");
  const screens = wanted.length ? ref.screens.filter((s) => wanted.includes(s.key)) : ref.screens.slice(0, 3);
  const missing = wanted.filter((k) => !ref.screens.some((s) => s.key === k));
  if (missing.length) console.warn(`Not in this reference: ${missing.join(", ")}`);

  const platform = platformOf(ref);
  // Web: the phone and desktop the render check uses; native: every target device.
  const sizes =
    platform.kind === "native-mobile"
      ? platform.devices.map((d) => ({ name: d, width: UX_DEVICES[d].w, height: UX_DEVICES[d].h }))
      : [
          { name: "desktop", width: 1440, height: 900 },
          { name: "phone", width: 390, height: 844 },
        ];

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: process.env.UX_RENDER_CHROMIUM || undefined, args: ["--disable-gpu"] });
  const shot = async (html: string, size: { width: number; height: number }, path: string, hideOverlays: boolean) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, javaScriptEnabled: false, deviceScaleFactor: 1 });
    try {
      await ctx.route("**/*", (route) => route.abort());
      const page = await ctx.newPage();
      const style = hideOverlays
        ? "<style>.ds-overlays{display:none !important}</style>"
        : "<style>.ds-app,.ds-native{display:block !important}.ds-app>:not(.ds-inset),.ds-app-header,.ds-main>:not(.ds-overlays),.ds-status-bar,.ds-bottom-nav,.ds-nav-rail,.ds-top-app-bar{display:none !important}</style>";
      await page.setContent(html.replace(/<\/head>/i, `${style}</head>`), { waitUntil: "domcontentloaded", timeout: 15_000 });
      await page.screenshot({ path, fullPage: true });
    } finally {
      await ctx.close().catch(() => {});
    }
  };

  mkdirSync(out, { recursive: true });
  for (const s of screens) {
    const dir = join(out, s.key);
    mkdirSync(dir, { recursive: true });
    const inputs = {
      screen: {
        key: s.key,
        name: s.name,
        screen_type: s.screen_type ?? null,
        purpose: s.purpose,
        requirement_keys: s.requirement_keys,
        key_elements: s.key_elements,
        primary_action: s.primary_action ?? null,
        overlays: s.overlays ?? [],
        states: s.states ?? [],
        layout_note: s.layout_note ?? null,
        layout_reference: (s.layout_reference ?? ref.layout_reference)?.name ?? null,
      },
      brief: ref.brief ?? null,
      platform,
      fidelity: ref.fidelity ?? "neutral",
      design_system_version: ref.design_system_version ?? null,
      shell: ref.shell ?? null,
      sample_records: (ref.sample_data?.records ?? []).map((r) => `${r.kind}: ${r.name}`),
    };
    writeFileSync(join(dir, "inputs.json"), JSON.stringify(inputs, null, 2));
    writeFileSync(join(dir, "generation.json"), JSON.stringify(s.generation ?? null, null, 2));
    writeFileSync(join(dir, "lint.json"), JSON.stringify(s.lint ?? [], null, 2));
    if (s.html) {
      for (const size of sizes) await shot(s.html, size, join(dir, `${size.name}.png`), true);
      if ((s.overlays ?? []).length || (s.states ?? []).length) await shot(s.html, sizes[0]!, join(dir, "overlays.png"), false);
    }
    writeFileSync(join(dir, "review.md"), reviewTemplate(s.name, s.key, sizes.map((x) => x.name)));
    console.log(`recorded ${s.key}${s.html ? "" : " (not drawn: no screenshots)"}`);
  }
  await browser.close();
  writeFileSync(
    join(out, "baseline.json"),
    JSON.stringify({ project: projectId, version: view.version, which, captured_at: new Date().toISOString(), platform, screens: screens.map((s) => s.key) }, null, 2),
  );
} finally {
  await db.close();
}

/** A §5.6 review sheet for one screen, every aspect not checked yet. */
function reviewTemplate(name: string, key: string, devices: string[]): string {
  const rows = Object.entries(REVIEW_ASPECT_LABELS)
    .map(([, label]) => `| ${label.aspect} | ${label.question} | belum diperiksa | | |`)
    .join("\n");
  return `# Review visual — ${name} (\`${key}\`)

Screenshot: ${devices.map((d) => `\`${d}.png\``).join(", ")}. Nilai dari hasil render, bukan dari kelas CSS (aturan.md §5.6).
Status: **sesuai**, **perlu revisi**, atau **belum diperiksa**. Tanpa skor.

| Aspek | Pertanyaan | Status | Elemen bermasalah | Perubahan konkret |
|---|---|---|---|---|
${rows}
`;
}
