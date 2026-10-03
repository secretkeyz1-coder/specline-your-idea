import type { DsPalette } from "./types.js";

/**
 * Just enough colour maths for the design-system editor to keep a person's
 * own accent readable as they pick it. The API re-checks every pair on save
 * (apps/api/src/modules/design-system/color.ts is the source of truth).
 */

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16)) as Rgb;
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex(x.map((v, i) => v + (y[i]! - v) * amount) as Rgb);
}

export const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);

function ensureContrast(color: string, against: string, minimum: number): string {
  if (contrast(color, against) >= minimum) return color;
  const target = luminance(against) > 0.4 ? "#000000" : "#ffffff";
  for (let step = 1; step <= 40; step++) {
    const next = mix(color, target, step / 40);
    if (contrast(next, against) >= minimum) return next;
  }
  return target;
}

const textOn = (fill: string) => (contrast(fill, "#111111") >= contrast(fill, "#ffffff") ? "#111111" : "#ffffff");

/**
 * Apply a brand accent to both modes. Light keeps the colour where it can
 * (darkened only as far as links need); dark starts from a lighter tint of it.
 */
export function applyAccent(light: DsPalette, dark: DsPalette, accent: string): { light: DsPalette; dark: DsPalette } {
  const l = ensureContrast(accent, light.bg, 4.5);
  const d = ensureContrast(mix(accent, "#ffffff", 0.25), dark.bg, 4.5);
  return {
    light: { ...light, accent: l, accentFg: textOn(l) },
    dark: { ...dark, accent: d, accentFg: textOn(d) },
  };
}

/** A typed hex as the spec stores it ("#abc", "ABCDEF" → "#aabbcc"), or null while it is incomplete. */
export function hexInput(value: string): string | null {
  const v = value.trim().replace(/^#?/, "");
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${[...v].map((c) => c + c).join("").toLowerCase()}`;
  return null;
}
