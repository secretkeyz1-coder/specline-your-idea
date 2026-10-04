import type { DesignSystemFile, DesignSystemSpec } from "@sdd/contracts";
import { checkPalette } from "./color.js";
import { craftBlock } from "./craft.js";
import { findDirection } from "./directions.js";
import { cssFontStack, firstFamily } from "./escape.js";
import { COMPONENT_ROLES, findLibrary, MOCKUP_CLASS } from "./libraries.js";
import { odTokenValues, OD_EXTENSIONS, OD_TOKEN_SCHEMA, TEXT_STEPS, typeScale } from "./od-tokens.js";
import { DENSITY } from "./render.js";

/**
 * The design-system package in open-design's shape (Apache-2.0): DESIGN.md
 * with numbered sections ending in an Agent Prompt Guide, USAGE.md as the
 * agent's router (Read Order, Design Highlights, Do, Avoid), tokens.css in the
 * 56-token contract, and craft references. Every number here is read from
 * `odTokenValues`, the same object tokens.css is written from — open-design's
 * own packages drift between prose and tokens; these cannot.
 */

/** The anti-slop rules every package carries (open-design craft/anti-ai-slop.md, P0). */
const ANTI_SLOP = [
  "Raw hex colours outside the `:root` token block — use the tokens.",
  "Tailwind's default indigo/violet (#6366f1, #4f46e5, #8b5cf6, #7c3aed…) as an accent the design system did not choose.",
  "Two-stop hero gradients (purple to blue, blue to cyan) and full-page gradient washes.",
  "Emoji as icons — use a monoline SVG icon set.",
  "Rounded cards with a coloured left border.",
  "Invented metrics (\"10× faster\", \"99.99% uptime\") and filler copy (lorem ipsum, \"feature one\").",
  "More than two visible uses of the accent on one screen.",
];

const md = (v: string) => v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|[\r\n\u2028\u2029]/g, " ");
const code = (v: string) => `\`${md(v)}\``;

/** Weight per role (open-design's three-weight ladder: 400 body, ~510–550 labels, ~590–650 headings). */
const WEIGHT = { display: 600, heading: 600, label: 500, body: 400 } as const;

export interface DesignMarkdownOptions {
  version?: number;
  /** Library theme files shipped next to DESIGN.md (path + description). */
  themeFiles: DesignSystemFile[];
}

/** DESIGN.md: the guide the coding agent (and the UI-reference generator) reads before any screen. */
export function designMarkdownOd(spec: DesignSystemSpec, opts: DesignMarkdownOptions): string {
  const { light, dark } = odTokenValues(spec);
  const lib = findLibrary(spec.component_library);
  const direction = findDirection(spec.direction);
  const d = DENSITY[spec.density];
  const failing = [...checkPalette(spec.light, "light"), ...checkPalette(spec.dark, "dark")].filter((c) => !c.ok);
  const v = (name: string) => light[name]!;
  const colourRows = [...OD_TOKEN_SCHEMA, ...OD_EXTENSIONS]
    .filter((t) => t.name in dark)
    .map((t) => `| ${code(t.name)} | ${md(t.description)} | ${code(light[t.name]!)} | ${code(dark[t.name]!)} |`);
  const typeRows: Array<[string, string, number, string, string]> = [
    ["Display / hero", "--text-4xl", WEIGHT.display, "--leading-tight", "--tracking-display"],
    ["H1", "--text-3xl", WEIGHT.heading, "--leading-tight", "--tracking-display"],
    ["Section title", "--text-2xl", WEIGHT.heading, "--leading-tight", "0"],
    ["H2", "--text-xl", WEIGHT.heading, "--leading-tight", "0"],
    ["H3 / featured", "--text-lg", WEIGHT.heading, "--leading-tight", "0"],
    ["Body", "--text-base", WEIGHT.body, "--leading-body", "0"],
    ["Small / label", "--text-sm", WEIGHT.label, "--leading-body", "0"],
    ["Caption / meta", "--text-xs", WEIGHT.label, "--leading-body", "0"],
  ];
  const sameFamily = firstFamily(spec.fonts.display) === firstFamily(spec.fonts.body);
  const depthWords = { flat: "flat — borders and space separate regions, no shadows", hairline: "hairline borders; shadows only on raised overlays", soft: "soft shadows on cards and overlays", hard: "hard offset shadows in the ink colour" }[spec.depth];

  return [
    `# Design system — ${spec.name}${opts.version ? ` (v${opts.version})` : ""}`,
    ``,
    `> Category: ${direction ? md(direction.label) : "Custom"} · Component library: ${md(lib?.name ?? spec.component_library)}`,
    ``,
    spec.summary,
    ``,
    `Approved in the SDD control plane. Build every screen with these tokens and the component library below;`,
    `never hard-code colours, fonts, radii or shadows that are defined here. Read \`USAGE.md\` first.`,
    ``,
    `## 1. Visual Theme & Atmosphere`,
    ``,
    ...(direction ? [direction.mood, ``, `References: ${direction.references.join(", ")}.`, ``] : []),
    `- Density: ${spec.density} — controls ${d.control}px tall, body text ${v("--text-base")}.`,
    `- Depth: ${depthWords}.`,
    `- Shape: control radius ${v("--radius-sm")}, cards ${v("--radius-md")}, borders ${v("--border-width")}.`,
    ``,
    `## 2. Color Palette & Roles`,
    ``,
    `Neutrals carry 70–90% of every screen; one accent 5–10%, used at most twice per screen; status colours only for status.`,
    ``,
    `| Token | Role | Light | Dark |`,
    `|---|---|---|---|`,
    ...colourRows,
    ``,
    `Contrast: text 4.5:1 and control edges 3:1 in both modes${failing.length ? ` — except ${failing.map((f) => `${f.mode} ${f.pair} (${f.ratio}:1)`).join(", ")}` : ""}. Keep it that way when adding colours.`,
    ``,
    `## 3. Typography Rules`,
    ``,
    `### Font Family`,
    ``,
    `- Display: ${cssFontStack(spec.fonts.display)} (${code("--font-display")})`,
    `- Body: ${cssFontStack(spec.fonts.body)} (${code("--font-body")})`,
    `- Mono: ${cssFontStack(spec.fonts.mono)} (${code("--font-mono")}) — code, IDs, tabular figures`,
    `- Load the named web fonts (for example from Fontsource) or keep the system fallbacks listed; never add a third typeface.`,
    ``,
    `### Hierarchy`,
    ``,
    `| Role | Token | Size | Weight | Line height | Tracking |`,
    `|---|---|---|---|---|---|`,
    ...typeRows.map(([role, size, weight, lh, tr]) => `| ${role} | ${code(size)} | ${v(size)} | ${weight} | ${v(lh)} | ${tr === "0" ? "0" : v(tr)} |`),
    ``,
    `### Principles`,
    ``,
    `- One dominant element per screen; at most three type sizes above the fold.`,
    `- Body lines 50–75 characters (\`max-width: 65ch\`); headings use \`text-wrap: balance\`, paragraphs \`text-wrap: pretty\`.`,
    `- ALL CAPS only for short labels, with 0.06–0.1em letter spacing.`,
    `- Numbers that are compared use \`font-variant-numeric: tabular-nums\`.`,
    sameFamily ? `- Display and body share one family: hierarchy comes from size and weight.` : `- Display font for headings only; body font for everything else.`,
    ``,
    `## 4. Component Stylings`,
    ``,
    `Component library: **${md(lib?.name ?? spec.component_library)}**. ${lib?.summary ?? ""}`,
    ``,
    ...(lib?.install.length ? ["Setup:", "", ...lib.install.map((i) => `- ${i.when}: \`${i.command}\``), ""] : []),
    ...(opts.themeFiles.length ? ["Theme file(s) in this folder:", "", ...opts.themeFiles.map((f) => `- \`${f.path.split("/").pop()}\` — ${f.description}`), ""] : []),
    `| UI role | In the UI reference mockups | Build it with |`,
    `|---|---|---|`,
    ...COMPONENT_ROLES.map((role) => `| ${role} | \`${MOCKUP_CLASS[role]}\` | ${lib?.components[role] ?? role} |`),
    ``,
    `### Buttons`,
    ``,
    `Height ${d.control}px, horizontal padding ${d.padX}px, radius ${code("--radius-sm")} (${v("--radius-sm")}), text ${code("--text-sm")} weight ${WEIGHT.label}. Primary: ${code("--accent")} background, ${code("--accent-on")} text, ${code("--accent-hover")} on hover, ${code("--accent-active")} when pressed. Secondary: ${code("--surface")} with a ${v("--border-width")} ${code("--border-strong")} edge. Focus: ${code("--focus-ring")}.`,
    ``,
    `### Cards & Containers`,
    ``,
    `Background ${code("--surface")}, ${v("--border-width")} ${code("--border")} edge, radius ${code("--radius-md")} (${v("--radius-md")}), padding ${d.cardPad}px. Cards group real content; do not nest cards.`,
    ``,
    `### Inputs & Forms`,
    ``,
    `Height ${d.control}px, ${v("--border-width")} ${code("--border-strong")} edge (3:1 against the surface), radius ${code("--radius-sm")}, label above in ${code("--text-sm")}. Errors in ${code("--danger")} under the field; focus ${code("--focus-ring")}.`,
    ``,
    `### Badges & Pills`,
    ``,
    `Radius ${code("--radius-pill")}, text ${code("--text-xs")} weight 600, a status colour tint behind status text.`,
    ``,
    `## 5. Layout Principles`,
    ``,
    `### Spacing System`,
    ``,
    `| Token | Value |`,
    `|---|---|`,
    ...["--space-1", "--space-2", "--space-3", "--space-4", "--space-5", "--space-6", "--space-8", "--space-12"].map((n) => `| ${code(n)} | ${v(n)} |`),
    ``,
    `8–12px between items in a group, 32–48px between groups.`,
    ``,
    `### Grid & Container`,
    ``,
    `| Token | Value |`,
    `|---|---|`,
    ...["--container-max", "--container-gutter-desktop", "--container-gutter-tablet", "--container-gutter-phone", "--section-y-desktop", "--section-y-tablet", "--section-y-phone"].map((n) => `| ${code(n)} | ${v(n)} |`),
    ``,
    `### Border Radius Scale`,
    ``,
    `| Token | Value | Used for |`,
    `|---|---|---|`,
    `| ${code("--radius-sm")} | ${v("--radius-sm")} | buttons, inputs, chips |`,
    `| ${code("--radius-md")} | ${v("--radius-md")} | cards, dialogs |`,
    `| ${code("--radius-lg")} | ${v("--radius-lg")} | featured containers |`,
    `| ${code("--radius-pill")} | ${v("--radius-pill")} | avatars, badges |`,
    ``,
    `## 6. Depth & Elevation`,
    ``,
    `Three levels, no fourth.`,
    ``,
    `| Token | Value | Used for |`,
    `|---|---|---|`,
    `| ${code("--elev-flat")} | ${code(v("--elev-flat"))} | the page and most surfaces |`,
    `| ${code("--elev-ring")} | ${code(v("--elev-ring"))} | a card or control edge drawn as a shadow |`,
    `| ${code("--elev-raised")} | ${code(v("--elev-raised"))} | menus, popovers, dialogs |`,
    `| ${code("--focus-ring")} | ${code(v("--focus-ring"))} | keyboard focus (no layout shift) |`,
    ``,
    `## 7. Do's and Don'ts`,
    ``,
    `### Do`,
    ``,
    ...(direction ? direction.posture.map((p) => `- ${p}`) : []),
    `- Use ${code("--accent")} for the primary action, links, focus and one focal element — nothing decorative.`,
    `- One primary action per area of a view; destructive actions use ${code("--danger")} and ask for confirmation.`,
    `- Support light and dark mode from the start; switch with \`data-theme\` on the root element.`,
    `- Give every interactive element a visible focus state and a hover state that never lowers contrast.`,
    ``,
    `### Don't`,
    ``,
    ...ANTI_SLOP.map((rule) => `- ${rule}`),
    ``,
    `## 8. Responsive Behavior`,
    ``,
    `### Breakpoints`,
    ``,
    `| Name | Width | Gutter | Section spacing |`,
    `|---|---|---|---|`,
    `| Phone | < 640px | ${v("--container-gutter-phone")} | ${v("--section-y-phone")} |`,
    `| Tablet | 640–1023px | ${v("--container-gutter-tablet")} | ${v("--section-y-tablet")} |`,
    `| Desktop | ≥ 1024px | ${v("--container-gutter-desktop")} | ${v("--section-y-desktop")} |`,
    ``,
    `### Touch Targets`,
    ``,
    `At least 44×44px on touch screens (24×24px is the WCAG AA floor); controls keep ${d.control}px height everywhere.`,
    ``,
    `### Collapsing Strategy`,
    ``,
    `Phones get a redesign, not a squeeze: multi-column areas stack, tables become lists or keep a horizontal scroll with the first column fixed, and the primary action stays in thumb reach. No horizontal page scroll at any width.`,
    ``,
    `### Image Behavior`,
    ``,
    `Images keep their intrinsic ratio (set width and height or \`aspect-ratio\`); \`object-fit: cover\` only for decorative fills.`,
    ``,
    `## 9. Agent Prompt Guide`,
    ``,
    `### Quick Color Reference`,
    ``,
    `| Role | Token | Light | Dark |`,
    `|---|---|---|---|`,
    ...([["Page", "--bg"], ["Card", "--surface"], ["Text", "--fg"], ["Secondary text", "--muted"], ["Border", "--border"], ["Accent", "--accent"], ["Text on accent", "--accent-on"], ["Danger", "--danger"]] as const).map(
      ([role, n]) => `| ${role} | ${code(n)} | ${code(light[n]!)} | ${code(dark[n]!)} |`,
    ),
    ``,
    `### Example Component Prompts`,
    ``,
    `- "A primary button: ${d.control}px tall, ${d.padX}px side padding, background ${v("--accent")} (\`var(--accent)\`), text ${v("--accent-on")}, ${v("--text-sm")} ${firstFamily(spec.fonts.body)} weight ${WEIGHT.label}, radius ${v("--radius-sm")}, hover \`var(--accent-hover)\`, focus \`var(--focus-ring)\`."`,
    `- "A card: background \`var(--surface)\`, ${v("--border-width")} solid \`var(--border)\`, radius ${v("--radius-md")}, padding ${d.cardPad}px, title ${v("--text-lg")} weight ${WEIGHT.heading}, body ${v("--text-base")} at line height ${v("--leading-body")}."`,
    `- "A page title: ${firstFamily(spec.fonts.display)} ${v("--text-3xl")} weight ${WEIGHT.heading}, line height ${v("--leading-tight")}, letter spacing ${v("--tracking-display")}, colour \`var(--fg)\`; one line of ${v("--text-base")} \`var(--muted)\` under it only when it adds information."`,
    `- "A text input: ${d.control}px tall, ${v("--border-width")} solid \`var(--border-strong)\`, radius ${v("--radius-sm")}, label ${v("--text-sm")} weight ${WEIGHT.label} above, error ${v("--text-sm")} \`var(--danger)\` below."`,
    `- "A status badge: radius ${v("--radius-pill")}, ${v("--text-xs")} weight 600, text in the status colour on a light tint of it."`,
    ``,
    `### Iteration Guide`,
    ``,
    `1. Paste the \`:root\` block of \`tokens.css\` first; every colour, size and radius is a \`var(--…)\` from it.`,
    `2. Never invent a token, and never redefine a token's value in component CSS.`,
    `3. Type sizes come only from \`--text-*\`; spacing only from \`--space-*\` and the section and gutter tokens.`,
    `4. The accent appears at most twice per screen.`,
    `5. Check both modes and a 390px-wide phone before calling a screen done.`,
    `6. Text contrast 4.5:1, control edges 3:1, targets 44px on touch.`,
    `7. Fix the screen in place; do not add decoration to make it feel finished.`,
    ``,
    `## 10. Component Behaviour`,
    ``,
    `The components own how they behave; each screen owns its content and flow. The UI reference mockups are static:`,
    `they show how a screen looks, not that it works — build and test the behaviour below.`,
    ``,
    `| Owner | Responsible for |`,
    `|---|---|`,
    `| Components (this library + tokens) | Dialog and sheet: focus moves in, stays in (trap), Esc closes, focus returns to the control that opened it. Tabs, menus and selects work with the keyboard. A visible focus ring on every interactive element. Every field's label is tied to it. Validation errors show under the field (with \`aria-invalid\`) and as a summary above a long form. A toast (\`role="status"\`) answers each action. |`,
    `| Screens | Which fields, their validation rules and messages, the order of steps, and what happens after each action (the result named in the UI reference: a toast, a redirect, the row updated) — for every state the screen lists (empty, loading, save failed, permission denied…). |`,
    ``,
    // The guidance's own headings sit one level under this section.
    ...(spec.guidance.trim() ? [`## 11. Style Guidance`, ``, spec.guidance.trim().replace(/^(#{1,5}) /gm, "#$1 "), ``] : []),
    `Files: \`tokens.css\` (the token contract), \`USAGE.md\`, \`craft/\` (typography, colour, accessibility and anti-slop rules), \`design-tokens.json\`, the theme file(s) above, \`preview-light.html\` and \`preview-dark.html\`.`,
    ``,
  ].join("\n");
}

/** USAGE.md: the agent's router through the package (open-design's four headings, verbatim). */
export function usageMarkdown(spec: DesignSystemSpec, opts: { themeFiles: DesignSystemFile[]; craft: string[] }): string {
  const { light } = odTokenValues(spec);
  const direction = findDirection(spec.direction);
  const text = typeScale(spec);
  const posture = direction?.posture ?? [];
  const avoids = posture.filter((p) => /^(avoid|no |never|almost no)/i.test(p) || /\bno shadows\b|\bno gradients\b/i.test(p));
  return [
    `# Using ${spec.name}`,
    ``,
    `## Read Order`,
    ``,
    `1. This file.`,
    `2. \`DESIGN.md\` — the visual principles, component values and the Agent Prompt Guide.`,
    `3. Paste the \`:root { ... }\` block of \`tokens.css\` into the first \`<style>\` (or the global stylesheet) before writing component CSS; keep its \`[data-theme="dark"]\` and reduced-motion blocks.`,
    ...(opts.craft.length ? [`4. \`craft/\` — ${opts.craft.join(", ")}: rules with numbers that apply on top of the tokens.`] : []),
    ...(opts.themeFiles.length ? [`${opts.craft.length ? 5 : 4}. ${opts.themeFiles.map((f) => `\`${f.path.split("/").pop()}\``).join(", ")} — the component library's theme, already bound to the tokens.`] : []),
    `${4 + (opts.craft.length ? 1 : 0) + (opts.themeFiles.length ? 1 : 0)}. \`preview-light.html\` and \`preview-dark.html\` when exact component states matter.`,
    ``,
    `## Design Highlights`,
    ``,
    ...(direction ? [`- ${direction.label}: ${direction.mood.split(". ")[0]}.`] : [`- ${spec.summary || spec.name}`]),
    `- Accent ${light["--accent"]} on ${light["--bg"]}: the primary action, links, focus and one focal element — at most twice per screen.`,
    `- Type: ${firstFamily(spec.fonts.display)} for display, ${firstFamily(spec.fonts.body)} for body; ${text["4xl"]}px display down to ${text.base}px body.`,
    `- Shape: ${light["--radius-sm"]} controls, ${light["--radius-md"]} cards, ${spec.depth} depth, ${spec.density} density.`,
    ``,
    `## Do`,
    ``,
    `- Preserve the schema token names exactly; reference them as \`var(--…)\`.`,
    `- Use \`--accent\` for primary actions, links, focus states, and one clear focal element.`,
    `- Build controls with the component library and its theme file; keep the component groups DESIGN.md describes.`,
    ...posture.filter((p) => !avoids.includes(p)).map((p) => `- ${p}`),
    ``,
    `## Avoid`,
    ``,
    `- Raw hex values outside the copied \`:root\` token block.`,
    `- Redefining token values in component CSS, or inventing new tokens.`,
    `- Recipes that DESIGN.md does not describe; decoration that pulls attention from the work.`,
    ...avoids.map((p) => `- ${p}`),
    ``,
  ].join("\n");
}

/**
 * The design system as open-design injects it into a generation prompt:
 * "How to use" (USAGE.md), "Active design system" (DESIGN.md), "Active design
 * system tokens" (tokens.css, to paste verbatim), then the craft references.
 * For the UI-reference generator (phase 2).
 */
export function odPromptBlocks(spec: DesignSystemSpec, files: { usage: string; design: string; tokens: string }, craft: string[]): string {
  return [
    `## How to use this design system — ${spec.name}`,
    ``,
    files.usage.trim(),
    ``,
    `## Active design system — ${spec.name}`,
    ``,
    `Treat the following DESIGN.md as authoritative for color, typography, spacing, and component rules. Do not invent tokens outside this palette. When you copy the active seed template, bind these tokens into its \`:root\` block before generating any layout.`,
    ``,
    files.design.trim(),
    ``,
    `## Active design system tokens`,
    ``,
    `**Paste the unscoped \`:root { ... }\` block verbatim into the artifact's first \`<style>\`** (keep the \`[data-theme="dark"]\` and reduced-motion blocks after it). Do not invent new tokens. Do not redefine these values. Do not write raw hex outside this :root block. The DESIGN.md above is prose; this is the binding contract.`,
    ``,
    "```css",
    files.tokens.trim(),
    "```",
    ...(craft.length ? [``, craftBlock(craft)] : []),
  ].join("\n");
}

/** For tests: the token values in DESIGN.md's tables must be the ones in tokens.css. */
export const PARITY_TOKENS = [...TEXT_STEPS.map((s) => `--text-${s}`), "--leading-body", "--leading-tight", "--tracking-display", "--radius-sm", "--radius-md", "--radius-lg", "--container-max"];
