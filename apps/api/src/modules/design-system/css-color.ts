import { rgbToHex } from "./color.js";

/**
 * Reading a colour written any way CSS (or a design tool) writes it — hex of
 * 3/4/6/8 digits, rgb(a), hsl(a), shadcn's bare "H S% L%" triple, oklch,
 * oklab, named colours — as the 6-digit hex the spec stores. Alpha is dropped
 * (the spec has no translucent colours) and reported, so the importer can say so.
 */

export interface ParsedColor {
  hex: string;
  /** The value had transparency (below 1) that the hex cannot keep. */
  alphaDropped: boolean;
  /** An oklch/oklab value lay outside sRGB and was clipped. */
  clipped: boolean;
}

const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  maroon: "#800000", navy: "#000080", teal: "#008080", olive: "#808000", lime: "#00ff00", aqua: "#00ffff",
  cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", indigo: "#4b0082", violet: "#ee82ee", brown: "#a52a2a",
  gold: "#ffd700", coral: "#ff7f50", crimson: "#dc143c", tomato: "#ff6347", salmon: "#fa8072", khaki: "#f0e68c",
  beige: "#f5f5dc", ivory: "#fffff0", lavender: "#e6e6fa", plum: "#dda0dd", orchid: "#da70d6", tan: "#d2b48c",
  chocolate: "#d2691e", sienna: "#a0522d", peru: "#cd853f", turquoise: "#40e0d0", skyblue: "#87ceeb",
  steelblue: "#4682b4", royalblue: "#4169e1", dodgerblue: "#1e90ff", slategray: "#708090", slategrey: "#708090",
  darkslategray: "#2f4f4f", darkgray: "#a9a9a9", darkgrey: "#a9a9a9", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
  gainsboro: "#dcdcdc", whitesmoke: "#f5f5f5", snow: "#fffafa", ghostwhite: "#f8f8ff", aliceblue: "#f0f8ff",
  mintcream: "#f5fffa", honeydew: "#f0fff0", seashell: "#fff5ee", linen: "#faf0e6", firebrick: "#b22222",
  darkred: "#8b0000", darkgreen: "#006400", forestgreen: "#228b22", seagreen: "#2e8b57", darkblue: "#00008b",
  midnightblue: "#191970", darkorange: "#ff8c00", goldenrod: "#daa520", rebeccapurple: "#663399",
  dimgray: "#696969", dimgrey: "#696969", lightslategray: "#778899",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A number, a percentage (of `percentOf`) or `none` (0). */
function num(token: string | undefined, percentOf = 1): number | null {
  if (token === undefined) return null;
  const t = token.trim().toLowerCase();
  if (t === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  return m[2] ? (v / 100) * percentOf : v;
}

/** A hue in degrees from deg / turn / rad / grad or a bare number. */
function hue(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.trim().toLowerCase();
  if (t === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case "turn":
      return v * 360;
    case "rad":
      return (v * 180) / Math.PI;
    case "grad":
      return v * 0.9;
    default:
      return v;
  }
}

/** The arguments of a colour function: commas or spaces, with an optional "/ alpha". */
function args(inner: string): { parts: string[]; alpha: string | undefined } {
  const [main, alpha] = inner.split("/").map((s) => s.trim());
  const parts = main!.includes(",") ? main!.split(",").map((s) => s.trim()) : main!.split(/\s+/).filter(Boolean);
  // Legacy rgba(r, g, b, a) / hsla(h, s, l, a): a fourth comma part is the alpha.
  if (alpha === undefined && parts.length === 4) return { parts: parts.slice(0, 3), alpha: parts[3] };
  return { parts, alpha };
}

function alphaOf(token: string | undefined): number {
  const a = num(token, 1);
  return a === null ? 1 : clamp01(a);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}

/** OKLab → sRGB (Björn Ottosson's matrices), clipped to the gamut. */
function oklabToRgb(L: number, a: number, b: number): { rgb: [number, number, number]; clipped: boolean } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const clipped = linear.some((v) => v < -0.002 || v > 1.002);
  const gamma = (v: number) => {
    const c = clamp01(v);
    return (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255;
  };
  return { rgb: linear.map(gamma) as [number, number, number], clipped };
}

/**
 * Parse one colour value, or null when it isn't one. `var()` references are
 * resolved by the caller before this is called.
 */
export function parseColor(input: string): ParsedColor | null {
  const v = input.trim().replace(/\s*!important$/i, "").trim();
  if (!v) return null;
  const lower = v.toLowerCase();

  if (lower === "transparent") return null;
  if (NAMED[lower]) return { hex: NAMED[lower]!, alphaDropped: false, clipped: false };

  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hexMatch) {
    const h = hexMatch[1]!;
    if (![3, 4, 6, 8].includes(h.length)) return null;
    const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
    const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return { hex: `#${full.slice(0, 6).toLowerCase()}`, alphaDropped: alpha < 1, clipped: false };
  }

  const fn = /^(rgba?|hsla?|oklch|oklab)\(\s*(.*?)\s*\)$/i.exec(v);
  if (fn) {
    const name = fn[1]!.toLowerCase();
    const { parts, alpha } = args(fn[2]!);
    if (parts.length !== 3) return null;
    const a = alphaOf(alpha);
    if (name.startsWith("rgb")) {
      const rgb = parts.map((p) => num(p, 255));
      if (rgb.some((c) => c === null)) return null;
      return { hex: rgbToHex(rgb as [number, number, number]), alphaDropped: a < 1, clipped: false };
    }
    if (name.startsWith("hsl")) {
      const h = hue(parts[0]);
      const s = num(parts[1], 1);
      const l = num(parts[2], 1);
      if (h === null || s === null || l === null) return null;
      // hsl() without % (CSS Color 4 allows bare numbers 0–100).
      const [ss, ll] = [s > 1 ? s / 100 : s, l > 1 ? l / 100 : l];
      return { hex: rgbToHex(hslToRgb(h, clamp01(ss), clamp01(ll))), alphaDropped: a < 1, clipped: false };
    }
    // oklch(L C H) / oklab(L a b): L is 0–1 or a percentage; C up to ~0.4 (100% = 0.4).
    const L = num(parts[0], 1);
    if (L === null) return null;
    const light = L > 1.5 ? L / 100 : L;
    if (name === "oklch") {
      const C = num(parts[1], 0.4);
      const H = hue(parts[2]);
      if (C === null || H === null) return null;
      const rad = (H * Math.PI) / 180;
      const { rgb, clipped } = oklabToRgb(light, C * Math.cos(rad), C * Math.sin(rad));
      return { hex: rgbToHex(rgb), alphaDropped: a < 1, clipped };
    }
    const A = num(parts[1], 0.4);
    const B = num(parts[2], 0.4);
    if (A === null || B === null) return null;
    const { rgb, clipped } = oklabToRgb(light, A, B);
    return { hex: rgbToHex(rgb), alphaDropped: a < 1, clipped };
  }

  // shadcn/ui's bare HSL channels: "222.2 84% 4.9%" (optionally "/ 0.5").
  const bare = /^([+-]?\d*\.?\d+(?:deg)?)\s+(\d*\.?\d+)%\s+(\d*\.?\d+)%(?:\s*\/\s*(\S+))?$/.exec(v);
  if (bare) {
    const h = hue(bare[1]);
    if (h === null) return null;
    const a = alphaOf(bare[4]);
    return { hex: rgbToHex(hslToRgb(h, clamp01(Number(bare[2]) / 100), clamp01(Number(bare[3]) / 100))), alphaDropped: a < 1, clipped: false };
  }
  return null;
}

/** Every colour literal in a line of prose or code, in order. */
export function colorLiterals(text: string): Array<{ raw: string; index: number }> {
  const out: Array<{ raw: string; index: number }> = [];
  const re = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/g;
  for (const m of text.matchAll(re)) out.push({ raw: m[0], index: m.index ?? 0 });
  return out;
}
