import type { DsColorToken, DsContrastCheck, DsPalette } from "@sdd/contracts";

/** Colour arithmetic for design tokens: WCAG contrast, mixing and fixing. */

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `a` toward `b` by `amount` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex(x.map((v, i) => v + (y[i]! - v) * amount) as Rgb);
}

/** "rgb" triple for frameworks that want channels (e.g. Bootstrap's --bs-*-rgb). */
export function rgbTriple(hex: string): string {
  return hexToRgb(hex).join(", ");
}

/** The readable text colour on a fill: near-black or white, whichever contrasts more. */
export function textOn(fill: string, dark = "#111111", light = "#ffffff"): string {
  return contrast(fill, dark) >= contrast(fill, light) ? dark : light;
}

/**
 * Move `color` toward black or white (away from `against`) until it reaches
 * `minimum` contrast with `against`. Returns the original when it already does.
 */
export function ensureContrast(color: string, against: string, minimum: number): string {
  if (contrast(color, against) >= minimum) return color;
  const target = luminance(against) > 0.4 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 40; step++) {
    const next = mix(color, target, step / 40);
    if (contrast(next, against) >= minimum) return next;
  }
  return target;
}

/** The pairs every palette must satisfy, with the WCAG minimum for each use. */
export const CONTRAST_PAIRS: Array<{ pair: string; foreground: DsColorToken; background: DsColorToken; minimum: number }> = [
  { pair: "Body text on the page", foreground: "fg", background: "bg", minimum: 4.5 },
  { pair: "Body text on cards", foreground: "fg", background: "surface", minimum: 4.5 },
  { pair: "Secondary text on the page", foreground: "fgMuted", background: "bg", minimum: 4.5 },
  { pair: "Secondary text on cards", foreground: "fgMuted", background: "surface", minimum: 4.5 },
  { pair: "Secondary text on subtle fills", foreground: "fgMuted", background: "surface2", minimum: 4.5 },
  { pair: "Text on the accent (buttons)", foreground: "accentFg", background: "accent", minimum: 4.5 },
  { pair: "Accent links on the page", foreground: "accent", background: "bg", minimum: 4.5 },
  { pair: "Form-control edges", foreground: "borderStrong", background: "surface", minimum: 3 },
  { pair: "Error text", foreground: "danger", background: "bg", minimum: 4.5 },
  { pair: "Success indicators", foreground: "success", background: "bg", minimum: 3 },
  { pair: "Warning indicators", foreground: "warn", background: "bg", minimum: 3 },
  { pair: "Info indicators", foreground: "info", background: "bg", minimum: 3 },
];

export function checkPalette(palette: DsPalette, mode: "light" | "dark"): DsContrastCheck[] {
  return CONTRAST_PAIRS.map((p) => {
    const exact = contrast(palette[p.foreground], palette[p.background]);
    // Pass/fail on the exact ratio: WCAG has no rounding, so 4.497:1 fails
    // 4.5:1 even though it displays as 4.5. Rounded for display only.
    return { mode, ...p, ratio: Math.floor(exact * 100) / 100, ok: exact >= p.minimum };
  });
}

/**
 * Repaint a palette around a new accent: the button text is chosen for
 * contrast, and the accent itself is nudged until links stay readable on the
 * page. Used when a person picks their own brand colour.
 */
export function withAccent(palette: DsPalette, accent: string): DsPalette {
  const readable = ensureContrast(accent, palette.bg, 4.5);
  return { ...palette, accent: readable, accentFg: textOn(readable) };
}
