import type { DsDirection, DsDirectionId, DsFonts, DsPalette } from "@sdd/contracts";
import { mix, textOn } from "./color.js";
import { parseColor } from "./css-color.js";
import { darkFrom, repairContrast } from "./import.js";

/**
 * The five visual directions of open-design (packages/contracts/src/prompts/
 * directions.ts, Apache-2.0): a mood, real-world references, font stacks, a
 * six-colour OKLch palette and concrete posture rules. Here each becomes a
 * full 13-role palette in hex for light and dark (derived roles filled in,
 * every WCAG pair checked), so a person can start a design system from one
 * and its posture travels to DESIGN.md and USAGE.md.
 */

interface Source {
  id: DsDirectionId;
  label: string;
  mood: string;
  references: string[];
  display: string;
  body: string;
  mono?: string;
  /** bg, surface, fg, muted, border, accent — OKLch, as open-design binds them. */
  palette: [string, string, string, string, string, string];
  posture: string[];
}

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const SOURCES: Source[] = [
  {
    id: "editorial-monocle",
    label: "Editorial — Monocle / FT magazine",
    mood: "Print-magazine feel for explicitly editorial or publishing briefs. Generous whitespace, large serif headlines, restrained palette of neutral paper + ink + a single brand-justified accent. Do not use this as the default for commerce, SaaS, dashboards, or product utilities.",
    references: ["Monocle", "The Financial Times Weekend", "NYT Magazine", "It's Nice That"],
    display: "'Iowan Old Style', 'Charter', Georgia, serif",
    body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    palette: ["oklch(98% 0.004 95)", "oklch(100% 0.002 95)", "oklch(20% 0.018 70)", "oklch(48% 0.012 70)", "oklch(90% 0.006 95)", "oklch(52% 0.10 28)"],
    posture: [
      "serif display, sans body, mono for metadata only",
      "no shadows, no rounded cards — borders + whitespace do the work",
      "one decisive image, cropped only at the bottom",
      "kicker / eyebrow in mono uppercase, one accent color, used at most twice; never create peach/pink/orange-beige page washes unless the brand/reference requires them",
    ],
  },
  {
    id: "modern-minimal",
    label: "Modern minimal — Linear / Vercel",
    mood: "Quiet, precise, software-native. System fonts, crisp neutral foundations, and a small but visible product palette (primary + secondary + status/accent) so the interface feels shipped rather than greyscale. The chrome stays restrained while interaction states, illustrations, charts, and product moments carry color.",
    references: ["Linear", "Vercel", "Notion 2024", "Stripe docs"],
    display: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    palette: ["oklch(99% 0.002 240)", "oklch(100% 0 0)", "oklch(18% 0.012 250)", "oklch(54% 0.012 250)", "oklch(92% 0.005 250)", "oklch(58% 0.18 255)"],
    posture: [
      "tight letter-spacing on display sizes (-0.02em)",
      "hairline borders only, no shadows except dropdowns/modals",
      "mono numerics with `font-variant-numeric: tabular-nums`",
      "sticky frosted nav, content-led layouts with one product illustration, device mockup, or data visualization when it clarifies the product",
      "controlled color system: primary action color + one secondary signal + status colors; avoid monochrome/unstyled outputs, but never flood every card with gradients",
    ],
  },
  {
    id: "human-approachable",
    label: "Human / approachable — Airbnb / Duolingo systems",
    mood: "Friendly and tactile without the generic cozy canvas. Uses a clean neutral background, product-led color system, generous radii, and clear hierarchy. Good for consumer tools, marketplaces, wellness, education, translation, AI assistants, and indie SaaS when the brand has not supplied a palette.",
    references: ["Airbnb", "Duolingo product surfaces", "Miro", "Mercury"],
    display: "'Söhne', 'Avenir Next', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    palette: ["oklch(98% 0.004 240)", "oklch(100% 0 0)", "oklch(20% 0.02 240)", "oklch(50% 0.018 240)", "oklch(90% 0.006 240)", "oklch(56% 0.12 170)"],
    posture: [
      "sans display with strong weight contrast, system body for readability",
      "comfortable radii (12–18px) paired with crisp grid alignment",
      "primary action color plus a secondary/domain accent and clear status colors; use color to separate panels, states, and product moments",
      "subtle elevation only on interactive cards; tasteful gradients/glows are allowed for hero/device/product moments, never as a full-page beige/pastel wash",
      "avoid generic pastel/beige gradients; use real product screenshots, data, or labelled placeholders",
    ],
  },
  {
    id: "tech-utility",
    label: "Tech / utility — Datadog / GitHub",
    mood: "Data-dense, monospace-friendly, dark or light + grid. Made for engineers and operators who want information per square inch, not vibes.",
    references: ["Datadog", "GitHub", "Cloudflare dashboard", "Sentry"],
    display: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif",
    body: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif",
    mono: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace",
    palette: ["oklch(98% 0.005 250)", "oklch(100% 0 0)", "oklch(22% 0.02 240)", "oklch(50% 0.018 240)", "oklch(90% 0.008 240)", "oklch(58% 0.16 145)"],
    posture: [
      "sans display + sans body (one family) is OK here — utility trumps editorial",
      "tabular numerics everywhere, mono for code / IDs / hashes",
      "dense tables with hairline borders, no row striping",
      "inline status pills (success / warn / danger) with restrained tinted backgrounds",
      "avoid: hero images, oversized headlines, marketing copy — show the product instead",
    ],
  },
  {
    id: "brutalist-experimental",
    label: "Brutalist / experimental — Are.na / Yale",
    mood: "Loud type. Visible grid. System sans + a single oversized serif. Deliberate ugliness as confidence. Great for art, indie, agency, manifesto pages.",
    references: ["Are.na", "Yale Center for British Art", "mschf", "Read.cv"],
    display: "'Times New Roman', 'Iowan Old Style', Georgia, serif",
    body: "ui-monospace, 'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace",
    palette: ["oklch(98% 0.004 240)", "oklch(100% 0 0)", "oklch(15% 0.02 100)", "oklch(40% 0.02 100)", "oklch(15% 0.02 100)", "oklch(60% 0.22 25)"],
    posture: [
      "display = serif at extreme sizes (clamp(80px, 12vw, 200px))",
      "body = monospace — yes, monospace as body, deliberately",
      "borders are full-strength fg (1.5–2px), not muted greys",
      "asymmetric layouts: one column 70%, the other 30%",
      "almost no border-radius (0–2px). No shadows. No gradients.",
      "underline links, no hover decoration — let the typography carry it",
    ],
  },
];

const hex = (oklch: string) => parseColor(oklch)?.hex ?? "#000000";

/** The full light palette: open-design's six colours, the other roles derived, every pair made readable. */
function lightPalette(s: Source): DsPalette {
  const [bg, surface, fg, muted, border, accent] = s.palette.map(hex) as [string, string, string, string, string, string];
  return repairContrast(
    {
      bg,
      surface,
      surface2: mix(bg, fg, 0.05),
      fg,
      fgMuted: muted,
      border,
      borderStrong: mix(border, fg, 0.45),
      accent,
      accentFg: textOn(accent),
      success: "#15803d",
      warn: "#b45309",
      danger: "#b91c1c",
      info: "#1d4ed8",
    },
    "light",
    [],
  );
}

function build(s: Source): DsDirection {
  const light = lightPalette(s);
  const dark = repairContrast(darkFrom(light), "dark", []);
  // Brutalist borders stay full-strength ink in both modes.
  if (s.id === "brutalist-experimental") dark.border = dark.fg;
  const fonts: DsFonts = { display: s.display, body: s.body, mono: s.mono ?? MONO };
  return { id: s.id, label: s.label, mood: s.mood, references: s.references, posture: s.posture, fonts, light, dark };
}

export const DS_DIRECTIONS: DsDirection[] = SOURCES.map(build);

export function findDirection(id: string | undefined): DsDirection | undefined {
  return id ? DS_DIRECTIONS.find((d) => d.id === id) : undefined;
}
