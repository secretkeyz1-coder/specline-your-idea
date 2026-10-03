import { describe, expect, test } from "bun:test";
import { DesignSystemSpecSchema, type DesignSystemSpec } from "@sdd/contracts";
import { checkPalette, contrast, withAccent } from "../src/modules/design-system/color.js";
import { designSystemFiles, libraryThemeFiles } from "../src/modules/design-system/exports.js";
import { COMPONENT_LIBRARIES, suggestLibraries } from "../src/modules/design-system/libraries.js";
import { DESIGN_SYSTEM_PRESETS } from "../src/modules/design-system/presets.js";
import { injectDesignSystem, previewHtml } from "../src/modules/design-system/render.js";
import { validateSpec } from "../src/modules/design-system/service.js";
import { stripDesignSystem } from "../src/modules/ux/ux.js";

const specFrom = (presetId: string, library = "shadcn"): DesignSystemSpec => {
  const { id, tags: _tags, ...rest } = DESIGN_SYSTEM_PRESETS.find((p) => p.id === presetId)!;
  return DesignSystemSpecSchema.parse({ ...rest, preset_id: id, component_library: library });
};

describe("design-system presets", () => {
  test("every preset is readable in light and dark mode", () => {
    for (const preset of DESIGN_SYSTEM_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const failing = checkPalette(preset[mode], mode).filter((c) => !c.ok);
        expect({ preset: preset.id, mode, failing }).toEqual({ preset: preset.id, mode, failing: [] });
      }
    }
  });

  test("presets are distinct and valid specs", () => {
    const looks = new Set(DESIGN_SYSTEM_PRESETS.map((p) => `${p.light.bg}|${p.light.accent}|${p.radius}|${p.fonts.body}`));
    expect(looks.size).toBe(DESIGN_SYSTEM_PRESETS.length);
    for (const p of DESIGN_SYSTEM_PRESETS) expect(() => specFrom(p.id)).not.toThrow();
  });

  test("a custom accent is nudged until links and button text stay readable", () => {
    const light = DESIGN_SYSTEM_PRESETS[0]!.light;
    const repainted = withAccent(light, "#ffd400"); // bright yellow fails on white
    expect(contrast(repainted.accent, light.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(repainted.accentFg, repainted.accent)).toBeGreaterThanOrEqual(4.5);
  });

  test("saving refuses a palette people cannot read", () => {
    const spec = specFrom("minimal");
    expect(() => validateSpec({ ...spec, light: { ...spec.light, fgMuted: "#c8c8c8" } })).toThrow(/too hard to read/);
    expect(() => validateSpec({ ...spec, component_library: "nope" })).toThrow(/Unknown component library/);
    expect(validateSpec(spec).name).toBe("Minimal");
  });
});

describe("design-system rendering", () => {
  test("the preview is self-contained: no scripts or outside resources", () => {
    for (const lib of COMPONENT_LIBRARIES) {
      const html = previewHtml(specFrom("modern-saas", lib.id), "dark");
      expect(html).not.toMatch(/<script|<link|@import|https?:\/\/(?!www\.w3)/i);
      expect(html).toContain('data-theme="dark"');
      expect(html).toContain("--ds-accent");
    }
  });

  test("styled screens get the stylesheet injected once, and can be stripped for revision", () => {
    const spec = specFrom("brutalist", "daisyui");
    const drawn = "<!doctype html><html><head><title>x</title></head><body><button class=\"ds-btn ds-btn-primary\">Vote</button></body></html>";
    const injected = injectDesignSystem(drawn, spec);
    expect(injected).toContain('data-design-system="Brutalist"');
    expect(injected.indexOf("<style")).toBeLessThan(injected.indexOf("<title>"));
    const stripped = stripDesignSystem(injected);
    expect(stripped).not.toContain("data-design-system");
    expect(injectDesignSystem(stripped, spec).match(/data-design-system/g)).toHaveLength(1);
  });
});

describe("design-system exports", () => {
  test("every library gets a theme file in its own format", () => {
    const expectations: Record<string, RegExp> = {
      shadcn: /--primary: #[0-9a-f]{6};[\s\S]*\.dark \{/,
      daisyui: /@plugin "daisyui\/theme" \{[\s\S]*name: "app-dark";/,
      bootstrap: /\[data-bs-theme=dark\][\s\S]*--bs-primary-rgb: \d+, \d+, \d+;/,
      material: /createTheme\(\{[\s\S]*colorSchemes/,
      antd: /theme\.darkAlgorithm/,
      flowbite: /--color-brand: #[0-9a-f]{6};/,
      pico: /--pico-primary-inverse: #[0-9a-f]{6};/,
    };
    for (const [lib, pattern] of Object.entries(expectations)) {
      const files = libraryThemeFiles(specFrom("enterprise", lib));
      expect(files.length).toBeGreaterThan(0);
      expect(files.map((f) => f.content).join("\n")).toMatch(pattern);
    }
    expect(libraryThemeFiles(specFrom("enterprise", "none"))).toHaveLength(0);
  });

  test("the repository bundle has the guide, tokens, DTCG JSON, Tailwind theme and previews", () => {
    const files = designSystemFiles(specFrom("editorial", "bootstrap"), 3);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "docs/design-system/DESIGN.md",
        "docs/design-system/tokens.css",
        "docs/design-system/design-tokens.json",
        "docs/design-system/tailwind-theme.css",
        "docs/design-system/bootstrap-theme.css",
        "docs/design-system/preview-light.html",
        "docs/design-system/preview-dark.html",
      ]),
    );
    const md = files.find((f) => f.path.endsWith("DESIGN.md"))!.content;
    expect(md).toContain("# Design system — Editorial (v3)");
    expect(md).toContain("| button | `.ds-btn / .ds-btn-primary` | .btn .btn-primary |");
    const dtcg = JSON.parse(files.find((f) => f.path.endsWith(".json"))!.content);
    expect(dtcg.color.dark.accent.$type).toBe("color");
    expect(files.find((f) => f.path.endsWith("tailwind-theme.css"))!.content).toContain("--color-fg-muted: var(--ds-fg-muted);");
  });
});

describe("design-system hardening", () => {
  test("contrast passes or fails on the exact ratio, not the rounded one", () => {
    const light = { ...DESIGN_SYSTEM_PRESETS[0]!.light, bg: "#ffffff", fgMuted: "#647a86" };
    expect(contrast("#647a86", "#ffffff")).toBeCloseTo(4.4969, 3);
    const check = checkPalette(light, "light").find((c) => c.foreground === "fgMuted" && c.background === "bg")!;
    expect(check.ok).toBe(false); // 4.4969 would round to 4.5 and pass
    expect(check.ratio).toBeLessThan(4.5);
  });

  test("names and font lists that could leave their slot are refused", () => {
    const spec = specFrom("minimal");
    const ok = (patch: Partial<DesignSystemSpec>) => DesignSystemSpecSchema.safeParse({ ...spec, ...patch }).success;
    for (const name of ["x */ body{}", "a<b", "a\nb", "a;b", "a{b}", "tab\there", "ls\u2028ep"]) expect({ name, ok: ok({ name }) }).toEqual({ name, ok: false });
    expect(ok({ name: "Warm & friendly (v2) — ü" })).toBe(true);
    const fonts = (display: string) => ok({ fonts: { ...spec.fonts, display } });
    for (const bad of ['Inter; } * { color: red', '"Inter"</style><script>', "url(x)", '"a\\"b"', "Inter\nArial", "a/*b*/", "Inter,", ""]) {
      expect({ bad, ok: fonts(bad) }).toEqual({ bad, ok: false });
    }
    for (const good of ['"Noto Sans JP", "ヒラギノ角ゴ", sans-serif', "system-ui, -apple-system, Segoe UI, sans-serif", "'Fira Code', ui-monospace"]) {
      expect({ good, ok: fonts(good) }).toEqual({ good, ok: true });
    }
  });

  test("a hostile name or font read back unvalidated cannot break out of any exported file", () => {
    const payload = "</style><script>alert(1)</script>";
    for (const lib of COMPONENT_LIBRARIES) {
      // Built past the schema, as an old stored spec would be.
      const evil: DesignSystemSpec = {
        ...specFrom("minimal", lib.id),
        name: `X */ body{background:red} /* ${payload}\n// y\u2028z`,
        fonts: { display: `Inter; } * { color: red } ${payload}`, body: 'a"b\\', mono: "monospace" },
      };
      for (const file of designSystemFiles(evil, 1)) {
        if (file.path.endsWith(".css")) {
          const code = file.content.replace(/\/\*[\s\S]*?\*\//g, "");
          expect({ path: file.path, leak: /background:red|<\/style|<script|alert\(1\)|\{ color/.test(code) }).toEqual({ path: file.path, leak: false });
        } else if (file.path.endsWith(".ts")) {
          // Still valid TypeScript, and the payload only ever sits in comments or string literals.
          const js = new Bun.Transpiler({ loader: "ts" }).transformSync(file.content);
          expect(js).not.toContain("background:red");
          expect(js).not.toMatch(/^\s*y/m);
          for (const line of file.content.split("\n").filter((l) => l.includes("alert(1)"))) expect(line).toMatch(/^\/\/|"[^"]*alert\(1\)[^"]*"/);
        } else if (file.path.endsWith(".html")) {
          expect(file.content.match(/<\/style>/g)).toHaveLength(1);
          expect(file.content).not.toContain("<script");
        }
      }
      const injected = injectDesignSystem("<html><head></head><body></body></html>", evil);
      expect(injected.match(/<\/style>/g)).toHaveLength(1);
      expect(injected).not.toContain("<script");
    }
  });

  test("valid font stacks are exported exactly as written", () => {
    const spec = specFrom("modern-saas", "shadcn");
    const css = libraryThemeFiles(spec)[0]!.content;
    expect(css).toContain(`--font-sans: ${spec.fonts.body};`);
  });
});

describe("component library suggestions", () => {
  const ids = (stack: Array<[string, string]>) => suggestLibraries(stack.map(([category, technology]) => ({ category, technology }))).map((s) => s.library_id);

  test("follows the locked stack", () => {
    expect(ids([["Frontend", "SvelteKit"], ["Styling", "Tailwind CSS v4"]])[0]).toBe("shadcn");
    expect(ids([["Frontend", "Next.js (React)"]]).slice(0, 3)).toEqual(["shadcn", "material", "antd"]);
    expect(ids([["Frontend", "Jinja2 templates"], ["Backend / runtime", "Python + Flask"]]).slice(0, 2)).toEqual(["bootstrap", "pico"]);
    expect(ids([["Frontend", "Laravel Blade + Tailwind CSS"]])[0]).toBe("daisyui");
    expect(ids([["Frontend", "Angular 20"]])[0]).toBe("material");
    // A native stack gets Material 3 for its platform, never a web library ("React Native" says "react").
    expect(ids([["Mobile", "React Native (Expo)"]])).toEqual(["react-native-paper", "none"]);
    expect(ids([["Frontend", "Flutter"]])).toEqual(["material", "none"]);
    expect(ids([["Backend", "Rust + Axum"]]).slice(0, 2)).toEqual(["bootstrap", "pico"]);
  });

  test("always ends with building by hand, never repeats", () => {
    const list = ids([["Frontend", "Nuxt 4 (Vue)"], ["CSS", "Tailwind"]]);
    expect(list[list.length - 1]).toBe("none");
    expect(new Set(list).size).toBe(list.length);
  });
});
