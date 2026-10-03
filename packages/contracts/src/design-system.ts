import { z } from "zod";

/**
 * Design system (the "design_system" artifact): the look a project is built
 * with — semantic colour tokens for light and dark, type, shape and density —
 * plus the component library the coding agent builds it from.
 *
 * Presets are starting points; every value can be adjusted, and the approved
 * spec is exported into the repository as tokens and library theme files.
 */

/** Semantic colour roles. Every surface and component is drawn from these. */
export const DS_COLOR_TOKENS = [
  "bg", // page background
  "surface", // cards, panels, popovers
  "surface2", // subtle fills: table headers, hover, muted areas
  "fg", // body text
  "fgMuted", // secondary text
  "border", // dividers and card edges
  "borderStrong", // form-control edges (must stay visible: 3:1)
  "accent", // primary actions, links, focus
  "accentFg", // text on the accent
  "success",
  "warn",
  "danger",
  "info",
] as const;
export type DsColorToken = (typeof DS_COLOR_TOKENS)[number];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours are 6-digit hex values, e.g. #1f6feb");
export const DsPaletteSchema = z.object(Object.fromEntries(DS_COLOR_TOKENS.map((k) => [k, hex])) as Record<DsColorToken, typeof hex>);
export type DsPalette = z.infer<typeof DsPaletteSchema>;

export const DsDensity = z.enum(["compact", "comfortable", "spacious"]);
export type DsDensity = z.infer<typeof DsDensity>;

/** How surfaces separate: nothing, a hairline, a soft shadow, or a hard offset shadow. */
export const DsDepth = z.enum(["flat", "hairline", "soft", "hard"]);
export type DsDepth = z.infer<typeof DsDepth>;

/**
 * A CSS font-family list, and nothing else: comma-separated families, each a
 * quoted name ("Segoe UI", 'Inter') or unquoted identifiers (system-ui,
 * -apple-system, Segoe UI). The value is written into CSS, TS and HTML
 * exports, so no `;` `{` `}` `<` `>` `/` `\` or line break can get in.
 */
const FONT_NAME = String.raw`[\p{L}\p{N} _.&+-]{1,80}`;
const FONT_FAMILY = String.raw`(?:"${FONT_NAME}"|'${FONT_NAME}'|-?[\p{L}_][\p{L}\p{N}_-]*(?: [\p{L}\p{N}_-]+)*)`;
export const FONT_STACK_PATTERN = new RegExp(String.raw`^\s*${FONT_FAMILY}(?:\s*,\s*${FONT_FAMILY})*\s*$`, "u");
const fontStack = z
  .string()
  .min(1)
  .max(200)
  .regex(FONT_STACK_PATTERN, 'A font list is family names separated by commas, e.g. "Inter", system-ui, sans-serif');

export const DsFontsSchema = z.object({
  /** Font family names in order of preference, ending with a generic family. */
  display: fontStack,
  body: fontStack,
  mono: fontStack,
});
export type DsFonts = z.infer<typeof DsFontsSchema>;

/**
 * Display names end up in CSS and JS comments and HTML: no control
 * characters or line breaks, nothing that closes a comment (`*\/`) or opens
 * markup or a CSS block (`<` `>` `{` `}` `;`).
 */
export const DS_NAME_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029<>{};]+$/;
const dsName = z
  .string()
  .min(1)
  .max(80)
  .regex(DS_NAME_PATTERN, "A name cannot contain line breaks or any of < > { } ;")
  .refine((v) => !v.includes("*/"), "A name cannot contain */");

/**
 * The five visual directions adopted from open-design (Apache-2.0,
 * packages/contracts/src/prompts/directions.ts): a starting palette, font
 * stacks and posture rules. A spec may name the one it follows; its posture
 * then travels with the design system into the prompts.
 */
export const DsDirectionId = z.enum(["editorial-monocle", "modern-minimal", "human-approachable", "tech-utility", "brutalist-experimental"]);
export type DsDirectionId = z.infer<typeof DsDirectionId>;

const px = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * The structural scale behind open-design's token contract (text sizes,
 * leading, display tracking, section spacing, container, motion). Every
 * field is optional: what is left out is derived from density, radius and
 * the direction, so older specs keep working unchanged.
 */
export const DsScaleSchema = z
  .object({
    /** Type scale in px: xs ≈ caption, base = body, xl = H2, 3xl = H1, 4xl = display. */
    text: z
      .object({ xs: px(10, 16), sm: px(11, 18), base: px(13, 22), lg: px(15, 30), xl: px(17, 44), "2xl": px(20, 64), "3xl": px(24, 96), "4xl": px(28, 200) })
      .partial(),
    leading_body: z.number().min(1.2).max(2),
    leading_tight: z.number().min(0.9).max(1.5),
    /** Display letter-spacing in em (negative tightens). */
    tracking_display: z.number().min(-0.08).max(0.05),
    /** Vertical padding between sections, px. */
    section_y: z.object({ desktop: px(16, 200), tablet: px(12, 160), phone: px(8, 120) }).partial(),
    container_max: px(640, 2000),
    gutter: z.object({ desktop: px(8, 96), tablet: px(8, 64), phone: px(8, 48) }).partial(),
    /** Durations in ms. */
    motion: z.object({ fast: px(0, 1000), base: px(0, 1000) }).partial(),
  })
  .partial();
export type DsScale = z.infer<typeof DsScaleSchema>;

export const DesignSystemSpecSchema = z.object({
  /** The preset it started from ("custom" when built from scratch). */
  preset_id: z.string().min(1).max(60),
  name: dsName,
  summary: z.string().max(300).default(""),
  light: DsPaletteSchema,
  dark: DsPaletteSchema,
  fonts: DsFontsSchema,
  /** Base corner radius of controls, in px; cards use 1.5x, pills are full. */
  radius: z.number().int().min(0).max(24),
  density: DsDensity,
  depth: DsDepth,
  /** Stroke width of borders, in px (brutalist styles use 2–3). */
  border_width: z.number().int().min(1).max(3),
  /** Component library the app is built with (see the library catalog). */
  component_library: z.string().min(1).max(40),
  /** Style guidance for agents: character, do, avoid (markdown). */
  guidance: z.string().max(6000).default(""),
  /** The visual direction it follows, if any (its posture rules go to the agent). */
  direction: DsDirectionId.optional(),
  /** Structural scale overrides; derived from density, radius and direction when absent. */
  scale: DsScaleSchema.optional(),
});
export type DesignSystemSpec = z.infer<typeof DesignSystemSpecSchema>;

/** One contrast check between two roles of a palette. */
export interface DsContrastCheck {
  mode: "light" | "dark";
  pair: string;
  foreground: DsColorToken;
  background: DsColorToken;
  ratio: number;
  /** WCAG minimum for this use: 4.5 for text, 3 for large text and UI edges. */
  minimum: number;
  ok: boolean;
}

/** A catalog preset (spec minus the project-specific choice of library). */
export type DesignSystemPreset = Omit<DesignSystemSpec, "component_library" | "preset_id"> & {
  id: string;
  tags: string[];
};

/** A component library an app can be built with, as shown in the picker. */
export interface ComponentLibraryInfo {
  id: string;
  name: string;
  summary: string;
  frameworks: string[];
  license: string;
  url: string;
  /** UI role (button, dialog, sheet, …) → the library's own component name. */
  components: Record<string, string>;
}

/** Why a library fits the project's locked stack, best first. */
export interface ComponentLibrarySuggestion {
  library_id: string;
  reason: string;
}

/** A file written into the repository under docs/design-system/. */
export interface DesignSystemFile {
  path: string;
  content: string;
  description: string;
}

/* ── open-design package (adopted, Apache-2.0) ── */

/** Layers of open-design's 56-token contract, plus our own extensions (info, border-strong, …). */
export type DsTokenLayer = "A1-identity" | "A1-structure" | "A2" | "B-slot" | "extension";

/** How an imported token was bound (open-design importer): by exact name, by role, as an alias, a fallback default, or a low-confidence default. */
export interface DsTokenConfidence {
  token: string;
  layer: DsTokenLayer;
  confidence: "high" | "medium" | "alias" | "fallback" | "low";
  /** The source variable or value it came from, when any. */
  from?: string;
}

/** The import's token report: per-token confidence, a 0–100 score and its grade. */
export interface DsImportConfidence {
  tokens: DsTokenConfidence[];
  score: number;
  grade: "excellent" | "usable" | "needs-review" | "needs-rebuild";
  recommend_rebuild: boolean;
}

/** One of the five visual directions, ready to start a spec from (light and dark palettes in hex). */
export interface DsDirection {
  id: DsDirectionId;
  label: string;
  mood: string;
  references: string[];
  posture: string[];
  fonts: DsFonts;
  light: DsPalette;
  dark: DsPalette;
}

/** The design-system package the agent gets (USAGE.md, DESIGN.md, tokens.css, design-tokens.json, craft). */
export interface DsPackage {
  files: Array<{ path: string; role: "usage" | "design" | "tokens" | "design-tokens" | "craft" | "other"; content: string }>;
}
