import { afterAll, describe, expect, test } from "bun:test";
import { DomainError } from "@sdd/shared";
import { effectiveMaxOutputTokens, type RunTextResult } from "@sdd/ai";
import type { DesignSystemSpec, UxReference } from "@sdd/contracts";
import { NEUTRAL_SPEC, assembleScreen } from "../src/modules/ux/ux-shell.js";
import { kitCss } from "../src/modules/design-system/render.js";
import { closeRenderBrowser, renderDigest, renderUnchecked } from "../src/modules/ux/ux-render.js";
import { RENDER_STAMP, renderStampOf, screenLint } from "../src/modules/ux/ux-draft.js";
import { storedRenderCurrent } from "../src/modules/ux/ux-approval.js";
import { buildGenerationRecord, generationTracker } from "../src/modules/ux/ux-generation.js";
import { buildReview, drawingDigest, reviewOutdated } from "../src/modules/ux/ux-review.js";
import { fontNote } from "../src/modules/ux/ux-state.js";

afterAll(() => closeRenderBrowser());

const screens = [
  { key: "menu", name: "Menu", screen_type: "list" },
  { key: "orders", name: "Orders", screen_type: "list" },
  { key: "settings", name: "Settings", screen_type: "settings" },
];
/** The page body only: the kit stylesheet in the head names every class. */
const frame = (layout?: "sidebar" | "topnav" | "minimal") => {
  const html = assembleScreen({
    content: '<div class="ds-page-header"><h1>Menu</h1></div><p>Rows</p>',
    spec: NEUTRAL_SPEC,
    brand: "Hokky POS",
    screens,
    currentKey: "menu",
    shell: { search: false, notifications: false, account: false, reason: "", ...(layout ? { layout } : {}) },
  });
  return html.slice(html.indexOf("<body>"));
};

describe("shell layouts (aturan.md §4)", () => {
  test("no layout (older plans) and sidebar draw the side navigation", () => {
    for (const html of [frame(), frame("sidebar")]) {
      expect(html).toContain('class="ds-sidebar"');
      expect(html).not.toContain("ds-top-nav");
    }
  });
  test("topnav draws the destinations across the header, with the menu sheet below 768px, and no sidebar", () => {
    const html = frame("topnav");
    expect(html).toContain("ds-app-top");
    expect(html).toContain('class="ds-top-nav"');
    expect(html).toContain("ds-mobile-menu");
    expect(html).not.toContain('class="ds-sidebar"');
    expect(html).toContain('href="./orders.html"');
    expect(html).toContain('aria-current="page"');
  });
  test("minimal keeps the brand and the screen's name, without persistent navigation", () => {
    const html = frame("minimal");
    expect(html).toContain("ds-app-minimal");
    expect(html).toContain('class="ds-header-title" aria-current="page">Menu<');
    expect(html).not.toContain("ds-side-nav");
    expect(html).not.toContain("ds-top-nav");
    expect(html).not.toContain("ds-mobile-menu");
  });
  test("every layout keeps the same content slot", () => {
    for (const layout of ["sidebar", "topnav", "minimal"] as const) expect(frame(layout)).toContain("<p>Rows</p>");
  });
});

describe("kit: type roles and media placeholders", () => {
  const css = kitCss(NEUTRAL_SPEC);
  test("every type role and the placeholder are styled", () => {
    for (const cls of ["ds-text-display", "ds-text-title", "ds-text-body", "ds-text-label", "ds-text-figure", "ds-media-ph", "ds-top-nav", "ds-header-title"]) {
      expect(css).toContain(`.${cls}`);
    }
    expect(css).toMatch(/\.ds-text-display\{[^}]*clamp\(/);
    expect(css).toContain('.ds-media-ph[data-ratio="16:9"]{aspect-ratio:16/9}');
  });
  test("the placeholder paints no gradient (gradients stay off until their backdrop can be checked)", () => {
    const rules = css.split("\n").join("").match(/\.ds-media-ph[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/gradient/);
  });
});

describe("render checks that did not run are 'not checked', never a pass (§5.4)", () => {
  const ref: UxReference = {
    applicable: true,
    reason: "",
    fidelity: "neutral",
    screens: [{ key: "menu", name: "Menu", purpose: "", requirement_keys: [], key_elements: [], html: null }],
  } as UxReference;

  test("renderUnchecked is a warning, not a blocker", () => {
    const f = renderUnchecked();
    expect(f.rule).toBe("render-unchecked");
    expect(f.action).toBe("warn");
  });
  test("screenLint records render-unchecked and no render digest when the render check is off", async () => {
    const before = process.env.UX_RENDER_LINT;
    process.env.UX_RENDER_LINT = "off";
    try {
      const lint = await screenLint('<div class="ds-page-header"><h1>Menu</h1></div>', ref, "menu", NEUTRAL_SPEC, "Hokky POS");
      expect(lint.some((f) => f.rule === "render-unchecked")).toBe(true);
      expect(renderStampOf(lint)).toBeNull();
    } finally {
      if (before === undefined) delete process.env.UX_RENDER_LINT;
      else process.env.UX_RENDER_LINT = before;
    }
  });
  test("the stamp rides on the array but is never serialised", () => {
    const lint = Object.defineProperty([] as never[], RENDER_STAMP, { value: "abc", enumerable: false });
    expect(renderStampOf(lint)).toBe("abc");
    expect(JSON.stringify(lint)).toBe("[]");
  });
});

describe("render digest: reuse stored findings only for what they measured", () => {
  const sizes = { narrow: { width: 390, height: 844 }, wide: { width: 1440, height: 900 }, minTarget: 32 };
  test("node ids do not count; content and sizes do", () => {
    const a = renderDigest('<main><p data-nid="n1">Hi</p></main>', sizes);
    expect(renderDigest('<main><p data-nid="n9">Hi</p></main>', sizes)).toBe(a);
    expect(renderDigest('<main><p data-nid="n1">Hello</p></main>', sizes)).not.toBe(a);
    expect(renderDigest('<main><p data-nid="n1">Hi</p></main>', { ...sizes, narrow: { width: 412, height: 915 } })).not.toBe(a);
  });
  test("approval reuses only a matching digest; a missing one means render again", () => {
    expect(storedRenderCurrent("x", "x")).toBe(true);
    expect(storedRenderCurrent("x", "y")).toBe(false);
    expect(storedRenderCurrent(null, "y")).toBe(false);
    expect(storedRenderCurrent(undefined, "y")).toBe(false);
  });
});

describe("generation record (§5.7)", () => {
  const result = (input: number | null, output: number | null): RunTextResult => ({
    text: "<main></main>",
    generationRunId: "r",
    modelId: "claude-x",
    profileName: "Design",
    providerType: "ANTHROPIC",
    maxOutputTokens: 4096,
    usage: { inputUnits: input, outputUnits: output },
    latencyMs: 10,
  });
  test("adds up every call, keeps the last model, and notes the repair", async () => {
    let t = 1000;
    const tracker = generationTracker(() => t);
    await tracker.call(async () => result(100, 2000));
    tracker.repairRan();
    await tracker.call(async () => result(150, 1800));
    t = 4500;
    const record = tracker.record(new Date("2026-10-01T00:00:00Z"));
    expect(record).toMatchObject({ model: "claude-x", profile: "Design", provider: "ANTHROPIC", max_output_tokens: 4096, input_tokens: 250, output_tokens: 3800, truncated: false, repaired: true, ms: 3500 });
  });
  test("a cut-off answer is noted and still thrown", async () => {
    const tracker = generationTracker();
    const cut = new DomainError("AI_OUTPUT_TRUNCATED", "limit", 502);
    await expect(tracker.call(async () => Promise.reject(cut))).rejects.toBe(cut);
    expect(tracker.record().truncated).toBe(true);
  });
  test("what the provider does not report stays null", () => {
    const r = buildGenerationRecord({ last: null, inputTokens: null, outputTokens: null, truncated: false, repaired: false, ms: -3, at: new Date(0) });
    expect(r).toMatchObject({ model: null, profile: null, provider: null, max_output_tokens: null, input_tokens: null, output_tokens: null, ms: 0 });
  });
  test("the effective output limit mirrors the adapters", () => {
    expect(effectiveMaxOutputTokens("ANTHROPIC", {})).toBe(4096);
    expect(effectiveMaxOutputTokens("ANTHROPIC", { max_tokens: 16000 })).toBe(16000);
    expect(effectiveMaxOutputTokens("GEMINI", {})).toBe(8192);
    expect(effectiveMaxOutputTokens("OPENAI_COMPATIBLE", {})).toBeNull();
    expect(effectiveMaxOutputTokens("OPENAI", { max_tokens: 9000 })).toBe(9000);
    expect(effectiveMaxOutputTokens("LOCAL_CLI", { max_tokens: 9000 })).toBeNull();
    expect(effectiveMaxOutputTokens("ANTHROPIC", { max_tokens: 9000 }, 2000)).toBe(2000);
  });
});

describe("visual review (§5.6)", () => {
  const stored = (body: string) => `<!doctype html><html><head></head><body><main class="ds-main" data-screen-content>\n${body}\n</main></body></html>`;
  test("one entry per aspect, in order, missing ones not checked", () => {
    const review = buildReview([{ aspect: "hierarchy", status: "revise", element: " stat row ", change: "make the queue lead" }], stored("<p>A</p>"), new Date("2026-10-01T00:00:00Z"));
    expect(review.aspects.map((a) => a.aspect)).toEqual(["focus", "composition", "hierarchy", "product_fit", "devices"]);
    expect(review.aspects[2]).toEqual({ aspect: "hierarchy", status: "revise", element: "stat row", change: "make the queue lead" });
    expect(review.aspects.filter((a) => a.status === "unchecked")).toHaveLength(4);
    expect(review.reviewed_at).toBe("2026-10-01T00:00:00.000Z");
  });
  test("a new drawing makes the review outdated; renumbered node ids do not", () => {
    const review = buildReview([], stored('<p data-nid="n1">A</p>'));
    expect(review.html_digest).toBe(drawingDigest(stored('<p data-nid="n1">A</p>')));
    expect(reviewOutdated(review, stored('<p data-nid="n7">A</p>'))).toBe(false);
    expect(reviewOutdated(review, stored('<p data-nid="n1">B</p>'))).toBe(true);
    expect(reviewOutdated(review, null)).toBe(true);
    expect(reviewOutdated(undefined, stored("<p>A</p>"))).toBe(false);
  });
});

describe("fonts: what a styled mockup asks for and what it shows", () => {
  test("named families are requested; the stack's system family is shown", () => {
    const spec = { ...NEUTRAL_SPEC, fonts: { display: '"Manrope", system-ui, sans-serif', body: "Inter, system-ui, sans-serif", mono: '"JetBrains Mono", ui-monospace, monospace' } } as DesignSystemSpec;
    expect(fontNote(spec)).toEqual({ requested: ["Manrope", "Inter", "JetBrains Mono"], shown: "system-ui", fallback: true });
  });
  test("system stacks only: nothing substituted", () => {
    expect(fontNote(NEUTRAL_SPEC)?.fallback).toBe(false);
    expect(fontNote(null)).toBeNull();
  });
});
