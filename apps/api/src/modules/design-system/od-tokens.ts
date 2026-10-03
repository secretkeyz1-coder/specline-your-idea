import type { DesignSystemSpec, DsDirectionId, DsPalette, DsTokenLayer } from "@sdd/contracts";
import { cssComment, cssFontStack } from "./escape.js";
import { DENSITY, paletteVars, scaleVars } from "./render.js";

/**
 * open-design's design-token contract (packages/contracts/src/design-systems/
 * token-schema.ts, Apache-2.0): 56 named tokens in four layers that every
 * `tokens.css` declares in full, because an artifact pastes one `:root` block
 * into one `<style>` and nothing else defines them. We generate them from a
 * DesignSystemSpec — colours from its palettes, structure from its scale
 * (or derived from density, radius, depth and direction) — so DESIGN.md and
 * tokens.css always agree. Dark mode overrides the semantic tokens under
 * `[data-theme="dark"]` (and the system setting), which open-design leaves
 * to each package.
 */

export interface OdTokenDef {
  name: string;
  layer: DsTokenLayer;
  description: string;
  /** A2: the contract's fallback value. */
  fallback?: string;
  /** B-slot: the sibling it aliases when a brand gives it no value. */
  aliasTo?: string;
}

const A1I = "A1-identity" as const;
const A1S = "A1-structure" as const;

/** The 56 contract tokens, in open-design's schema order. */
export const OD_TOKEN_SCHEMA: OdTokenDef[] = [
  { name: "--bg", layer: A1I, description: "Page background — the brand canvas." },
  { name: "--surface", layer: A1I, description: "Card / lifted container background." },
  { name: "--surface-warm", layer: "B-slot", description: "Tertiary surface tier (wells, table heads, quiet panels).", aliasTo: "var(--surface)" },
  { name: "--fg", layer: A1I, description: "Primary text colour." },
  { name: "--fg-2", layer: "B-slot", description: "Secondary text tier.", aliasTo: "var(--fg)" },
  { name: "--muted", layer: A1I, description: "Subtext / captions." },
  { name: "--meta", layer: "B-slot", description: "Tertiary text / metadata tier.", aliasTo: "var(--muted)" },
  { name: "--border", layer: A1I, description: "Default border / card edge." },
  { name: "--border-soft", layer: "B-slot", description: "Inner row separator that should not visually compete.", aliasTo: "var(--border)" },
  { name: "--accent", layer: A1I, description: "Brand accent — at most two visible uses per screen." },
  { name: "--accent-on", layer: "A2", description: "Text on an --accent background.", fallback: "#ffffff" },
  { name: "--accent-hover", layer: "A2", description: "Hover state for elements with an --accent background.", fallback: "color-mix(in oklab, var(--accent), black 8%)" },
  { name: "--accent-active", layer: "A2", description: "Active state for elements with an --accent background.", fallback: "color-mix(in oklab, var(--accent), black 14%)" },
  { name: "--success", layer: "A2", description: "Success state.", fallback: "#16a34a" },
  { name: "--warn", layer: "A2", description: "Warning state.", fallback: "#eab308" },
  { name: "--danger", layer: "A2", description: "Danger state.", fallback: "#dc2626" },
  { name: "--font-display", layer: A1I, description: "Display / heading font stack." },
  { name: "--font-body", layer: A1I, description: "Body font stack." },
  { name: "--font-mono", layer: "A2", description: "Monospace stack — code, kbd, tabular metrics.", fallback: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace' },
  { name: "--text-xs", layer: A1S, description: "Type step — caption (≈11–12px)." },
  { name: "--text-sm", layer: A1S, description: "Type step — small (≈12–14px)." },
  { name: "--text-base", layer: A1S, description: "Type step — body." },
  { name: "--text-lg", layer: A1S, description: "Type step — H3 / featured body." },
  { name: "--text-xl", layer: A1S, description: "Type step — H2." },
  { name: "--text-2xl", layer: A1S, description: "Type step — section title." },
  { name: "--text-3xl", layer: A1S, description: "Type step — H1." },
  { name: "--text-4xl", layer: A1S, description: "Type step — display / hero." },
  { name: "--leading-body", layer: A1S, description: "Line height for body text." },
  { name: "--leading-tight", layer: A1S, description: "Line height for headings." },
  { name: "--tracking-display", layer: A1S, description: "Letter spacing on display sizes." },
  { name: "--space-1", layer: "A2", description: "Spacing — 4px tier.", fallback: "4px" },
  { name: "--space-2", layer: "A2", description: "Spacing — 8px tier.", fallback: "8px" },
  { name: "--space-3", layer: "A2", description: "Spacing — 12px tier.", fallback: "12px" },
  { name: "--space-4", layer: "A2", description: "Spacing — 16px tier.", fallback: "16px" },
  { name: "--space-5", layer: "A2", description: "Spacing — 20px tier.", fallback: "20px" },
  { name: "--space-6", layer: "A2", description: "Spacing — 24px tier.", fallback: "24px" },
  { name: "--space-8", layer: "A2", description: "Spacing — 32px tier.", fallback: "32px" },
  { name: "--space-12", layer: "A2", description: "Spacing — 48px tier.", fallback: "48px" },
  { name: "--section-y-desktop", layer: A1S, description: "Vertical padding between sections — desktop." },
  { name: "--section-y-tablet", layer: A1S, description: "Vertical padding between sections — tablet." },
  { name: "--section-y-phone", layer: A1S, description: "Vertical padding between sections — phone." },
  { name: "--radius-sm", layer: "A2", description: "Small radius — buttons, inputs, chips.", fallback: "8px" },
  { name: "--radius-md", layer: "A2", description: "Medium radius — cards, modals.", fallback: "12px" },
  { name: "--radius-lg", layer: "A2", description: "Large radius — featured containers.", fallback: "16px" },
  { name: "--radius-pill", layer: "A2", description: "Pill radius — avatars, badges.", fallback: "9999px" },
  { name: "--elev-flat", layer: "A2", description: "No elevation.", fallback: "none" },
  { name: "--elev-ring", layer: "A2", description: "Hairline ring (a box-shadow border).", fallback: "0 0 0 1px var(--border)" },
  { name: "--elev-raised", layer: "A2", description: "Raised surface — menus, dialogs.", fallback: "0 2px 8px color-mix(in oklab, var(--fg), transparent 92%)" },
  { name: "--focus-ring", layer: "A2", description: "Keyboard focus indicator (box-shadow, no layout shift).", fallback: "0 0 0 3px color-mix(in oklab, var(--accent), transparent 70%)" },
  { name: "--motion-fast", layer: "A2", description: "Hover / micro-state duration.", fallback: "150ms" },
  { name: "--motion-base", layer: "A2", description: "General state-change duration.", fallback: "200ms" },
  { name: "--ease-standard", layer: "A2", description: "Standard easing curve.", fallback: "cubic-bezier(0.2, 0, 0, 1)" },
  { name: "--container-max", layer: A1S, description: "Max content container width." },
  { name: "--container-gutter-desktop", layer: A1S, description: "Container side gutter — desktop." },
  { name: "--container-gutter-tablet", layer: A1S, description: "Container side gutter — tablet." },
  { name: "--container-gutter-phone", layer: A1S, description: "Container side gutter — phone." },
];

/** Our own extensions beyond the contract: the info status, the control-edge border and the border width. */
export const OD_EXTENSIONS: OdTokenDef[] = [
  { name: "--info", layer: "extension", description: "Informational status." },
  { name: "--border-strong", layer: "extension", description: "Edge of a control that has no other boundary (3:1 against the page)." },
  { name: "--border-width", layer: "extension", description: "Stroke width of borders." },
];

export const OD_TOKEN_NAMES = new Set(OD_TOKEN_SCHEMA.map((t) => t.name));

/** Colour tokens that change with the mode (and the vars built on them). */
const MODE_TOKENS = [
  "--bg", "--surface", "--surface-warm", "--fg", "--fg-2", "--muted", "--meta", "--border", "--border-soft",
  "--accent", "--accent-on", "--accent-hover", "--accent-active", "--success", "--warn", "--danger",
  "--elev-ring", "--elev-raised", "--focus-ring", "--info", "--border-strong",
] as const;

/* ── Structure derived from the spec ───────────────────────────────── */

/** Per direction: type-scale ratio, display size, display tracking and heading leading. */
const DIRECTION_TYPE: Record<DsDirectionId, { ratio: number; display: number; tracking: number; tight: number }> = {
  "editorial-monocle": { ratio: 1.333, display: 64, tracking: -0.02, tight: 1.08 },
  "modern-minimal": { ratio: 1.25, display: 56, tracking: -0.02, tight: 1.12 },
  "human-approachable": { ratio: 1.25, display: 52, tracking: -0.01, tight: 1.15 },
  "tech-utility": { ratio: 1.2, display: 40, tracking: 0, tight: 1.2 },
  "brutalist-experimental": { ratio: 1.5, display: 120, tracking: -0.03, tight: 1 },
};
const DEFAULT_TYPE = { ratio: 1.25, display: 48, tracking: -0.01, tight: 1.15 };

const SPACE = { compact: [64, 48, 32], comfortable: [96, 68, 48], spacious: [128, 88, 56] } as const;
const CONTAINER = { compact: 1280, comfortable: 1200, spacious: 1120 } as const;
const LEADING = { compact: 1.45, comfortable: 1.5, spacious: 1.6 } as const;

export const TEXT_STEPS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"] as const;
export type TextStep = (typeof TEXT_STEPS)[number];

/** The type scale in px: from spec.scale.text, else a modular scale on the density's body size. */
export function typeScale(spec: DesignSystemSpec): Record<TextStep, number> {
  const t = spec.direction ? DIRECTION_TYPE[spec.direction] : DEFAULT_TYPE;
  const base = spec.scale?.text?.base ?? DENSITY[spec.density].text;
  const step = (n: number) => Math.round(base * t.ratio ** n);
  const derived: Record<TextStep, number> = {
    xs: Math.max(11, step(-2)),
    sm: Math.max(12, step(-1)),
    base,
    lg: step(1),
    xl: step(2),
    "2xl": step(3),
    "3xl": Math.max(28, step(4)),
    "4xl": Math.max(t.display, step(5)),
  };
  const out = { ...derived, ...(spec.scale?.text ?? {}) } as Record<TextStep, number>;
  // Keep the steps strictly growing even when only some were overridden.
  for (let i = 1; i < TEXT_STEPS.length; i++) {
    const prev = out[TEXT_STEPS[i - 1]!];
    if (out[TEXT_STEPS[i]!] <= prev) out[TEXT_STEPS[i]!] = prev + 1;
  }
  return out;
}

/** Leading, tracking, section spacing, container, gutters and motion, resolved. */
export function structure(spec: DesignSystemSpec) {
  const t = spec.direction ? DIRECTION_TYPE[spec.direction] : DEFAULT_TYPE;
  const s = spec.scale ?? {};
  const [desk, tab, phone] = SPACE[spec.density];
  return {
    leadingBody: s.leading_body ?? Math.round((LEADING[spec.density] + (spec.direction === "editorial-monocle" ? 0.05 : 0)) * 100) / 100,
    leadingTight: s.leading_tight ?? t.tight,
    trackingDisplay: s.tracking_display ?? t.tracking,
    sectionY: { desktop: s.section_y?.desktop ?? desk, tablet: s.section_y?.tablet ?? tab, phone: s.section_y?.phone ?? phone },
    containerMax: s.container_max ?? CONTAINER[spec.density],
    gutter: { desktop: s.gutter?.desktop ?? 32, tablet: s.gutter?.tablet ?? 24, phone: s.gutter?.phone ?? 16 },
    motion: { fast: s.motion?.fast ?? 150, base: s.motion?.base ?? 200 },
  };
}

/** Radius scale: sm = the spec's control radius, md = cards (1.5×, as the mockup kit), lg = featured (2×). */
export function radii(spec: DesignSystemSpec) {
  return { sm: spec.radius, md: Math.round(spec.radius * 1.5), lg: Math.round(spec.radius * 2), pill: 9999 };
}

/** The raised elevation for the spec's depth, matching the mockup kit's raised shadow. */
function raised(spec: DesignSystemSpec): string {
  switch (spec.depth) {
    case "flat":
      return "0 0 0 1px var(--border)";
    case "hairline":
      return "0 8px 24px rgba(0, 0, 0, 0.12)";
    case "soft":
      return "0 12px 32px rgba(0, 0, 0, 0.14)";
    case "hard":
      return "6px 6px 0 var(--fg)";
  }
}

const em = (n: number) => `${n === 0 ? 0 : n}em`;

/** The colour tokens for one palette. B-slots: surface-warm carries surface2; fg-2, meta and border-soft alias their siblings. */
function colourTokens(spec: DesignSystemSpec, p: DsPalette): Record<string, string> {
  return {
    "--bg": p.bg,
    "--surface": p.surface,
    "--surface-warm": p.surface2,
    "--fg": p.fg,
    "--fg-2": "var(--fg)",
    "--muted": p.fgMuted,
    "--meta": "var(--muted)",
    "--border": p.border,
    "--border-soft": "var(--border)",
    "--accent": p.accent,
    "--accent-on": p.accentFg,
    "--accent-hover": "color-mix(in oklab, var(--accent), black 8%)",
    "--accent-active": "color-mix(in oklab, var(--accent), black 14%)",
    "--success": p.success,
    "--warn": p.warn,
    "--danger": p.danger,
    "--elev-ring": `0 0 0 ${spec.border_width}px var(--border)`,
    "--elev-raised": raised(spec),
    "--focus-ring": "0 0 0 3px color-mix(in oklab, var(--accent), transparent 70%)",
    "--info": p.info,
    "--border-strong": p.borderStrong,
  };
}

/**
 * Every contract token (and our extensions) with its value: `light` holds the
 * full set, `dark` only what changes with the mode. DESIGN.md and tokens.css
 * both read this one object, so their numbers cannot disagree.
 */
export function odTokenValues(spec: DesignSystemSpec): { light: Record<string, string>; dark: Record<string, string> } {
  const text = typeScale(spec);
  const st = structure(spec);
  const r = radii(spec);
  const light: Record<string, string> = {
    ...colourTokens(spec, spec.light),
    "--font-display": cssFontStack(spec.fonts.display),
    "--font-body": cssFontStack(spec.fonts.body),
    "--font-mono": cssFontStack(spec.fonts.mono),
    ...Object.fromEntries(TEXT_STEPS.map((s) => [`--text-${s}`, `${text[s]}px`])),
    "--leading-body": String(st.leadingBody),
    "--leading-tight": String(st.leadingTight),
    "--tracking-display": em(st.trackingDisplay),
    "--space-1": "4px",
    "--space-2": "8px",
    "--space-3": "12px",
    "--space-4": "16px",
    "--space-5": "20px",
    "--space-6": "24px",
    "--space-8": "32px",
    "--space-12": "48px",
    "--section-y-desktop": `${st.sectionY.desktop}px`,
    "--section-y-tablet": `${st.sectionY.tablet}px`,
    "--section-y-phone": `${st.sectionY.phone}px`,
    "--radius-sm": `${r.sm}px`,
    "--radius-md": `${r.md}px`,
    "--radius-lg": `${r.lg}px`,
    "--radius-pill": `${r.pill}px`,
    "--elev-flat": "none",
    "--motion-fast": `${st.motion.fast}ms`,
    "--motion-base": `${st.motion.base}ms`,
    "--ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
    "--container-max": `${st.containerMax}px`,
    "--container-gutter-desktop": `${st.gutter.desktop}px`,
    "--container-gutter-tablet": `${st.gutter.tablet}px`,
    "--container-gutter-phone": `${st.gutter.phone}px`,
    "--border-width": `${spec.border_width}px`,
  };
  const darkAll = colourTokens(spec, spec.dark);
  const dark = Object.fromEntries(MODE_TOKENS.map((n) => [n, darkAll[n]!]));
  return { light, dark };
}

/* ── Legacy aliases ──────────────────────────────────────────────────── */

/** `--ds-*` names the mockup kit, the Tailwind mapping and older agents use, pointed at the contract tokens. */
const LEGACY_ALIAS: Record<string, string> = {
  "--ds-bg": "--bg",
  "--ds-surface": "--surface",
  "--ds-surface-2": "--surface-warm",
  "--ds-fg": "--fg",
  "--ds-fg-muted": "--muted",
  "--ds-border": "--border",
  "--ds-border-strong": "--border-strong",
  "--ds-accent": "--accent",
  "--ds-accent-fg": "--accent-on",
  "--ds-success": "--success",
  "--ds-warn": "--warn",
  "--ds-danger": "--danger",
  "--ds-info": "--info",
  "--ds-font-display": "--font-display",
  "--ds-font-body": "--font-body",
  "--ds-font-mono": "--font-mono",
  "--ds-radius": "--radius-sm",
  "--ds-radius-card": "--radius-md",
  "--ds-border-width": "--border-width",
};

/** Legacy declarations: aliases where a contract token holds the same value, the derived ones (tints, contrast text, shadows, control sizes) as values. */
function legacyLines(lines: string[]): string[] {
  return lines.map((line) => {
    const m = /^(--ds-[a-z0-9-]+):/.exec(line);
    const target = m ? LEGACY_ALIAS[m[1]!] : undefined;
    return target ? `${m![1]}: var(${target});` : line;
  });
}

/* ── tokens.css ─────────────────────────────────────────────────────── */

const block = (selector: string, decls: string[], pad = "") => `${pad}${selector} {\n${decls.map((d) => `${pad}  ${d}`).join("\n")}\n${pad}}`;
const decls = (values: Record<string, string>) => Object.entries(values).map(([n, v]) => `${n}: ${v};`);

/**
 * tokens.css in open-design's contract: one unscoped `:root` with all 56
 * tokens (paste it verbatim into an artifact's first `<style>`), our
 * extensions, then the legacy `--ds-*` aliases; dark under
 * `[data-theme="dark"]` and the system setting; motion off for reduced motion.
 */
export function odTokensCss(spec: DesignSystemSpec): string {
  const { light, dark } = odTokenValues(spec);
  const ordered = [...OD_TOKEN_SCHEMA, ...OD_EXTENSIONS].map((t) => [t.name, light[t.name]!] as const);
  const rootDecls = [
    ...ordered.map(([n, v]) => `${n}: ${v};`),
    "color-scheme: light;",
    "/* Legacy names (mockup kit, Tailwind mapping) — aliases of the tokens above. */",
    ...legacyLines([...scaleVars(spec), ...paletteVars(spec, spec.light)]),
  ];
  const darkDecls = [...decls(dark), "color-scheme: dark;", ...legacyLines(paletteVars(spec, spec.dark))];
  const header = [
    `/* ${cssComment(spec.name)} — design tokens (open-design token contract, 56 tokens + extensions).`,
    ` * ${cssComment(spec.summary || "Generated from the approved design system.")}`,
    ` * Paste the :root block verbatim into the first <style>; never write raw colours outside it.`,
    ` * Light on :root; dark on [data-theme="dark"] or the system setting. */`,
  ].join("\n");
  return [
    header,
    block(":root", rootDecls),
    block('[data-theme="dark"]', darkDecls),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', darkDecls, "  ")}\n}`,
    `@media (prefers-reduced-motion: reduce) {\n${block(":root", ["--motion-fast: 0ms;", "--motion-base: 0ms;"], "  ")}\n}`,
  ].join("\n\n");
}
