import { describe, expect, test } from "bun:test";
import { DesignSystemSpecSchema, type DesignSystemSpec } from "@sdd/contracts";
import { checkPalette } from "../src/modules/design-system/color.js";
import { craftBlock, craftFor, CRAFT_SLUGS, DEFAULT_CRAFT } from "../src/modules/design-system/craft.js";
import { DS_DIRECTIONS } from "../src/modules/design-system/directions.js";
import { designSystemFiles, designSystemPackage, designSystemPromptBlocks } from "../src/modules/design-system/exports.js";
import { importDesignSystem } from "../src/modules/design-system/import.js";
import { OD_EXTENSIONS, OD_TOKEN_SCHEMA, odTokensCss, odTokenValues, typeScale } from "../src/modules/design-system/od-tokens.js";
import { DESIGN_SYSTEM_PRESETS } from "../src/modules/design-system/presets.js";
import { catalog, renderPackage } from "../src/modules/design-system/service.js";

function specFrom(id: string, library = "shadcn"): DesignSystemSpec {
  const { id: _id, tags: _tags, ...preset } = DESIGN_SYSTEM_PRESETS.find((p) => p.id === id)!;
  return DesignSystemSpecSchema.parse({ ...preset, preset_id: id, component_library: library });
}

/** Declarations of the first unscoped `:root { … }` block — how open-design's guard reads tokens.css. */
function rootTokens(css: string): Map<string, string> {
  const body = /:root(?!\[)\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

describe("open-design token contract", () => {
  test("tokens.css declares all 56 contract tokens in :root, and only contract, extension or legacy names", () => {
    expect(OD_TOKEN_SCHEMA).toHaveLength(56);
    for (const preset of DESIGN_SYSTEM_PRESETS) {
      const tokens = rootTokens(odTokensCss(specFrom(preset.id)));
      for (const t of OD_TOKEN_SCHEMA) expect({ preset: preset.id, token: t.name, present: tokens.has(t.name) }).toEqual({ preset: preset.id, token: t.name, present: true });
      const known = new Set([...OD_TOKEN_SCHEMA, ...OD_EXTENSIONS].map((t) => t.name));
      const unknown = [...tokens.keys()].filter((n) => !known.has(n) && !n.startsWith("--ds-"));
      expect(unknown).toEqual([]);
    }
  });

  test("dark mode overrides the colours under [data-theme=dark] and the system setting; reduced motion zeroes durations", () => {
    const spec = specFrom("modern-saas");
    const css = odTokensCss(spec);
    const dark = /\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)![1]!;
    expect(dark).toContain(`--bg: ${spec.dark.bg};`);
    expect(dark).toContain(`--accent: ${spec.dark.accent};`);
    expect(dark).toContain("color-scheme: dark;");
    expect(css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  :root \{\n    --motion-fast: 0ms;\n    --motion-base: 0ms;/);
  });

  test("B-slots alias their siblings, A2 colour states mix from the accent, and the legacy --ds-* names alias the contract", () => {
    const tokens = rootTokens(odTokensCss(specFrom("minimal")));
    expect(tokens.get("--fg-2")).toBe("var(--fg)");
    expect(tokens.get("--meta")).toBe("var(--muted)");
    expect(tokens.get("--border-soft")).toBe("var(--border)");
    expect(tokens.get("--accent-hover")).toBe("color-mix(in oklab, var(--accent), black 8%)");
    expect(tokens.get("--ds-bg")).toBe("var(--bg)");
    expect(tokens.get("--ds-fg-muted")).toBe("var(--muted)");
    expect(tokens.get("--ds-radius-card")).toBe("var(--radius-md)");
    // Derived legacy values the kit needs stay present.
    expect(tokens.has("--ds-accent-soft")).toBe(true);
    expect(tokens.has("--ds-control-h")).toBe(true);
  });

  test("the type scale grows strictly and honours spec overrides", () => {
    const spec = specFrom("minimal");
    const scale = typeScale(spec);
    const steps = Object.values(scale);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    const custom = typeScale({ ...spec, scale: { text: { base: 18, "4xl": 72 } } });
    expect(custom.base).toBe(18);
    expect(custom["4xl"]).toBe(72);
    expect(odTokenValues({ ...spec, direction: "brutalist-experimental" }).light["--text-4xl"]).toBe("120px");
  });
});

describe("DESIGN.md and USAGE.md (open-design shape)", () => {
  const spec = { ...specFrom("editorial", "bootstrap"), direction: "editorial-monocle" as const };
  const files = designSystemFiles(spec, 3);
  const design = files.find((f) => f.path.endsWith("DESIGN.md"))!.content;
  const usage = files.find((f) => f.path.endsWith("USAGE.md"))!.content;
  const tokens = rootTokens(files.find((f) => f.path.endsWith("tokens.css"))!.content);

  test("DESIGN.md has the numbered sections, at least seven H2s, and ends in an Agent Prompt Guide", () => {
    const h2 = design.match(/^## /gm) ?? [];
    expect(h2.length).toBeGreaterThanOrEqual(7);
    for (const heading of ["## 1. Visual Theme & Atmosphere", "## 2. Color Palette & Roles", "## 3. Typography Rules", "## 4. Component Stylings", "## 5. Layout Principles", "## 6. Depth & Elevation", "## 7. Do's and Don'ts", "## 8. Responsive Behavior", "## 9. Agent Prompt Guide"]) {
      expect(design).toContain(heading);
    }
    // The direction's posture travels into Do.
    expect(design).toContain("serif display, sans body, mono for metadata only");
  });

  test("every token value DESIGN.md states is the value tokens.css declares (parity by construction)", () => {
    const rows = [...design.matchAll(/^\| `(--[a-z0-9-]+)` \| [^|\n]*\| `([^`]+)` \|/gm)];
    expect(rows.length).toBeGreaterThan(10);
    for (const [, token, value] of rows) expect({ token, value }).toEqual({ token: token!, value: tokens.get(token!)! });
    const type = [...design.matchAll(/^\| [^|]+ \| `(--text-[a-z0-9]+)` \| (\d+px) \|/gm)];
    expect(type).toHaveLength(8);
    for (const [, token, size] of type) expect({ token, size }).toEqual({ token: token!, size: tokens.get(token!)! });
    const spacing = [...design.matchAll(/^\| `(--(?:space|container|section|radius)-[a-z0-9-]+)` \| (\d+px) \|/gm)];
    expect(spacing.length).toBeGreaterThan(10);
    for (const [, token, v] of spacing) expect({ token, v }).toEqual({ token: token!, v: tokens.get(token!)! });
  });

  test("markdown table values escape existing backslashes before pipes and line boundaries", () => {
    const hostile = { ...spec, component_library: "unknown\\|cell\r\nnext\rrow\u2028line" } as unknown as DesignSystemSpec;
    const document = designSystemFiles(hostile, 3).find(f => f.path.endsWith("DESIGN.md"))!.content;
    expect(document).toContain("unknown\\\\\\|cell next row line");
    expect(document).not.toContain("cell\r");
  });

  test("USAGE.md carries open-design's four headings verbatim", () => {
    for (const heading of ["## Read Order", "## Design Highlights", "## Do", "## Avoid"]) expect(usage).toContain(heading);
    expect(usage).toContain("Paste the `:root { ... }` block of `tokens.css`");
    expect(usage).toContain(`Accent ${spec.light.accent}`);
  });
});

describe("directions", () => {
  test("the five directions are complete palettes that pass every contrast pair in both modes", () => {
    expect(DS_DIRECTIONS.map((d) => d.id)).toEqual(["editorial-monocle", "modern-minimal", "human-approachable", "tech-utility", "brutalist-experimental"]);
    for (const d of DS_DIRECTIONS) {
      const failing = [...checkPalette(d.light, "light"), ...checkPalette(d.dark, "dark")].filter((c) => !c.ok);
      expect({ id: d.id, failing }).toEqual({ id: d.id, failing: [] });
      expect(d.posture.length).toBeGreaterThan(2);
      // A spec built from a direction is valid (fonts pass the font-list pattern).
      const spec = { ...specFrom("minimal"), light: d.light, dark: d.dark, fonts: d.fonts, direction: d.id };
      expect({ id: d.id, ok: DesignSystemSpecSchema.safeParse(spec).success }).toEqual({ id: d.id, ok: true });
    }
    expect(catalog().directions).toHaveLength(5);
  });
});

describe("package and craft", () => {
  test("the package endpoint returns USAGE, DESIGN, tokens, design-tokens and the default craft — the same contents as the export", () => {
    const spec = specFrom("modern-saas");
    const pkg = renderPackage(spec);
    expect(pkg.files.map((f) => f.role)).toEqual(["usage", "design", "tokens", "design-tokens", ...DEFAULT_CRAFT.map(() => "craft")]);
    expect(pkg.files.filter((f) => f.role === "craft").map((f) => f.path)).toEqual(DEFAULT_CRAFT.map((s) => `docs/design-system/craft/${s}.md`));
    const exported = new Map(designSystemFiles(spec).map((f) => [f.path, f.content]));
    for (const f of designSystemPackage(spec).files) expect({ path: f.path, same: exported.get(f.path) === f.content }).toEqual({ path: f.path, same: true });
    expect(() => renderPackage({ name: "x" })).toThrow();
  });

  test("craft is bundled with attribution and composes into one prompt block", () => {
    expect(CRAFT_SLUGS).toContain("anti-ai-slop");
    expect(craftFor(["color", "nope", "color"]).map((c) => c.slug)).toEqual(["color"]);
    const block = craftBlock(DEFAULT_CRAFT);
    expect(block).toStartWith("## Active craft references — color, typography, accessibility-baseline, anti-ai-slop");
    expect(block).toContain("### anti-ai-slop");
  });

  test("the prompt blocks follow open-design's order and tell the model to paste the tokens verbatim", () => {
    const text = designSystemPromptBlocks(specFrom("minimal"));
    const order = ["## How to use this design system", "## Active design system —", "## Active design system tokens", "## Active craft references"].map((h) => text.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("Paste the unscoped `:root { ... }` block verbatim");
  });
});

describe("import confidence", () => {
  test("a shadcn theme binds colours by role (medium) and is graded usable or better", async () => {
    const shadcn = `:root { --background: 0 0% 100%; --foreground: 222 47% 11%; --card: 0 0% 100%; --muted: 210 40% 96%; --muted-foreground: 215 16% 40%; --border: 214 32% 91%; --input: 214 32% 70%; --primary: 221 83% 45%; --primary-foreground: 210 40% 98%; --card-foreground: 222 47% 11%; --destructive: 0 72% 45%; --radius: 0.5rem; }`;
    const { confidence } = await importDesignSystem({ text: shadcn });
    const accent = confidence.tokens.find((t) => t.token === "--accent")!;
    expect(accent).toMatchObject({ confidence: "medium", from: "--primary" });
    expect(confidence.tokens.find((t) => t.token === "--fg-2")!.confidence).toBe("alias");
    expect(confidence.tokens.find((t) => t.token === "--space-4")!.confidence).toBe("fallback");
    expect(confidence.tokens).toHaveLength(56);
    expect(["excellent", "usable"]).toContain(confidence.grade);
  });

  test("an exported open-design tokens.css re-imports with exact names (high) and keeps its type scale", async () => {
    const spec = { ...specFrom("modern-saas"), scale: { text: { base: 17, "3xl": 44 } } };
    const { spec: back, confidence } = await importDesignSystem({ text: odTokensCss(spec) });
    expect(confidence.tokens.find((t) => t.token === "--bg")!.confidence).toBe("high");
    expect(confidence.tokens.find((t) => t.token === "--muted")).toMatchObject({ confidence: "high", from: "--muted" });
    expect(confidence.tokens.find((t) => t.token === "--text-base")!.confidence).toBe("high");
    expect(back.light.fgMuted).toBe(spec.light.fgMuted);
    expect(back.light.surface2).toBe(spec.light.surface2);
    expect(back.scale?.text?.base).toBe(17);
    expect(confidence.grade).toBe("excellent");
  });

  test("a near-empty paste grades low and recommends a rebuild", async () => {
    const { confidence } = await importDesignSystem({ text: ":root { --brand: #1d4ed8; }" });
    expect(confidence.recommend_rebuild).toBe(true);
    expect(confidence.tokens.find((t) => t.token === "--bg")!.confidence).toBe("low");
  });
});
