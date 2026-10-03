import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Browser } from "playwright-core";
import { COMPONENT_LIBRARIES } from "../src/modules/design-system/libraries.js";
import { closeRenderBrowser, renderLint } from "../src/modules/ux/ux-render.js";
import { NEUTRAL_SPEC, assembleScreen, ensureNodeIds, wrapTables } from "../src/modules/ux/ux-shell.js";

/**
 * The kit gallery: one page using every kit component (and the combinations
 * that broke before — labelled fields in a table toolbar, a long name in a
 * table, badges in column layouts, three board columns beside a side panel),
 * framed with every library's skin and laid out at phone and desktop width.
 * The render check must find nothing but the page's length, and the layout
 * probes below must hold. Each probe is a bug found by eye on a real screen.
 * Without a browser the gallery is skipped.
 */

// Prepared as the pipeline prepares a drawing: tables wrapped (the render check measures the wrapper), elements numbered.
const gallery = ensureNodeIds(wrapTables(readFileSync(new URL("./fixtures/ux-kit-gallery.html", import.meta.url), "utf-8")));
const libraries = COMPONENT_LIBRARIES.map((l) => l.id);
let browser: Browser | null = null;

beforeAll(async () => {
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.launch({ executablePath: process.env.UX_RENDER_CHROMIUM || undefined });
  } catch {
    browser = null;
  }
  // Launching Chromium can take longer than the default 5s hook timeout on a busy machine.
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await closeRenderBrowser();
}, 60_000);

const frame = (library: string) =>
  assembleScreen({
    content: gallery,
    spec: { ...NEUTRAL_SPEC, component_library: library },
    brand: "Project Control",
    screens: [{ key: "gallery", name: "Kit gallery", screen_type: "detail" }, { key: "settings", name: "Settings", screen_type: "settings" }],
    currentKey: "gallery",
  });

/** Layout probes, measured inside the page; each returns the elements that break it. */
async function probe(html: string, width: number) {
  const page = await browser!.newPage({ viewport: { width, height: 900 } });
  try {
    await page.setContent(html.replace("</head>", "<style>.ds-overlays{display:none !important}</style></head>"), { waitUntil: "domcontentloaded" });
    return await page.evaluate(() => {
      const main = document.querySelector("main")!;
      const label = (el: Element) => `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/)[0]} "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;
      const out = { tallControls: [] as string[], wideBadges: [] as string[], touching: [] as string[], boardCut: [] as string[] };
      // A control stretched by a flex-basis meant for its width (the 14rem toolbar gap).
      for (const el of Array.from(main.querySelectorAll(".ds-input, .ds-select, .ds-btn, .ds-input-icon, .ds-chip"))) {
        const h = el.getBoundingClientRect().height;
        if (h > 64) out.tallControls.push(`${label(el)} ${Math.round(h)}px`);
      }
      // A badge stretched to its column's width.
      for (const el of Array.from(main.querySelectorAll(".ds-badge"))) {
        const w = el.getBoundingClientRect().width;
        if (w > 260) out.wideBadges.push(`${label(el)} ${Math.round(w)}px`);
      }
      // Blocks directly in the page with no gap between them.
      const blocks = Array.from(main.children).filter((el) => !el.matches("style, .ds-overlays") && el.getBoundingClientRect().height > 0);
      for (let i = 1; i < blocks.length; i++) {
        const gap = blocks[i]!.getBoundingClientRect().top - blocks[i - 1]!.getBoundingClientRect().bottom;
        if (gap < 6) out.touching.push(`${label(blocks[i - 1]!)} → ${label(blocks[i]!)} ${Math.round(gap)}px`);
      }
      // Three board columns must fit on a desktop.
      for (const el of Array.from(main.querySelectorAll(".ds-board"))) {
        if (window.innerWidth >= 1200 && el.scrollWidth - el.clientWidth > 1) out.boardCut.push(`${label(el)} ${el.scrollWidth - el.clientWidth}px`);
      }
      return out;
    });
  } finally {
    await page.close();
  }
}

describe("UI reference kit gallery", () => {
  for (const library of libraries) {
    test(`${library}: the render check finds nothing but the page's length`, async () => {
      if (!browser) return;
      const findings = (await renderLint(frame(library))) ?? [];
      expect(findings.filter((f) => f.rule !== "phone-too-long").map((f) => `${f.action}:${f.rule} ${f.message}`)).toEqual([]);
    }, 60_000);

    test(`${library}: layout probes hold at 390 and 1440`, async () => {
      if (!browser) return;
      for (const width of [390, 1440]) {
        const result = await probe(frame(library), width);
        expect({ width, ...result }).toEqual({ width, tallControls: [], wideBadges: [], touching: [], boardCut: [] });
      }
    }, 60_000);
  }
});
