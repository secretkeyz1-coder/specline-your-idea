import { UX_BUDGETS, type DesignSystemSpec, type LayoutReference, type UxReference, type UxSampleData, type UxScreen } from "@sdd/contracts";
import { UX_OD_CHARTER, UX_OD_ELEMENT_SYSTEM_PROMPT } from "@sdd/ai";
import { DEFAULT_CRAFT, craftBlock } from "../design-system/craft.js";
import { designSystemPromptBlocks } from "../design-system/exports.js";
import { briefLines, sampleDataLines } from "./ux-draft.js";
import { layoutReferenceLines } from "./ux-layout.js";
import { deviceList, platformOf } from "./ux-platform.js";
import { navMarkup, isAuthScreen, type OdSeed } from "./ux-od-seeds.js";
import { seedFor } from "./ux-od.js";
import { NEUTRAL_SPEC } from "./ux-shell.js";

/**
 * The prompts of the od generator, in open-design's layer order: the charter
 * (security, role, quality bar, output contract), the active design system
 * (or the wireframe note), the craft references, the seed template — all in
 * the system prompt, stable for every screen of a reference — then, in the
 * user message, the product brief and platform, the project, the other
 * screens with the exact navigation markup, the shared example data, this
 * screen's plan and the output contract again.
 */

/** open-design asks the model to paste the tokens; here the platform injects them. */
const PASTE = /\*\*Paste the unscoped `:root \{ \.\.\. \}` block verbatim into the artifact's first `<style>`\*\*[^\n]*/;
const BIND = /When you copy the active seed template, bind these tokens into its `:root` block before generating any layout\./;
const INJECTED =
  "**The platform injects this block into every screen as `<style data-tokens>` — do not paste, copy or redefine it.** Use the tokens through var(--…) only; never write raw colours. The DESIGN.md above is prose; this is the binding contract.";

/** The design system blocks with open-design's "paste the tokens" step replaced by the platform's injection. */
export function odDesignSystemBlocks(spec: DesignSystemSpec, craft: readonly string[]): string {
  return designSystemPromptBlocks(spec, craft)
    .replace(PASTE, INJECTED)
    .replace(BIND, "The platform injects these tokens and the seed's CSS into every screen; your markup only uses them.");
}

/** The craft a screen's prompt carries: the design system's defaults and the seed's own (wireframes: the seed's and anti-slop). */
export function odCraft(seed: OdSeed, styled: boolean): string[] {
  return [...new Set(styled ? [...DEFAULT_CRAFT, ...seed.craft] : [...seed.craft, "anti-ai-slop"])];
}

const WIREFRAME_NOTE = `## Fidelity — neutral wireframe

No design system applies: these screens are a mid-fidelity greybox (open-design's wireframe-greybox). The platform injects a greyscale token set with the same names (var(--bg), var(--fg), var(--accent), …) and a dark variant; use only those. Judge layout, hierarchy, copy and flow — not brand.`;

/** The seed's section of the system prompt. */
function seedBlock(seed: OdSeed): string {
  return [
    `## Active seed template — ${seed.id}`,
    "",
    "P0 rules of this seed:",
    ...seed.p0.map((r) => `- ${r}`),
    "",
    "Skeleton (keep its structure and markers; [REPLACE] marks what you write — the brand and navigation slots are filled by the platform):",
    "```html",
    seed.skeleton,
    "```",
    "",
    seed.classDoc,
  ].join("\n");
}

/** The system prompt of a screen drawing: charter → design system (or wireframe note) → craft → seed. */
export function odSystemPrompt(seed: OdSeed, spec: DesignSystemSpec | null): string {
  const craft = odCraft(seed, Boolean(spec));
  return [UX_OD_CHARTER, "", spec ? odDesignSystemBlocks(spec, craft) : [WIREFRAME_NOTE, "", craftBlock(craft)].join("\n"), "", seedBlock(seed)].join("\n");
}

/** Lines that speak of the kit's ds-* classes, in the od seed's names. */
const odClasses = (lines: string[]) => lines.map((l) => l.replace(/\bds-badge\b/g, "badge"));

const OUTPUT_CONTRACT =
  "OUTPUT: only the inner HTML of <body> — optionally one <style data-screen> first, then the app root from the seed skeleton (data-sdd-app) with <main data-screen-content>, then <section data-sdd-overlays>. No <html>, <head>, <body>, scripts, links or code fences.";

export interface OdScreenPromptInput {
  ref: UxReference;
  screen: UxScreen;
  /** The approved design system's spec for a styled reference; null for neutral. */
  spec: DesignSystemSpec | null;
  /** The planning context (project, stack, requirements, design). */
  projectText: string;
  sample?: UxSampleData;
  layout?: LayoutReference | null;
  /** The screen's current body (icons as placeholders), when a change is requested. */
  current?: string | null;
  instruction?: string;
}

/** The seed of a screen as the prompt and the assembly both choose it. */
export function odSeedOf(ref: UxReference, screen: Pick<UxScreen, "key">, spec: DesignSystemSpec): OdSeed {
  return seedFor({ spec, screens: ref.screens, currentKey: screen.key, shell: ref.shell, platform: ref.platform });
}

/** The platform line of an od request (the seed carries the platform's rules). */
function odPlatformLines(ref: UxReference): string[] {
  const platform = platformOf(ref);
  return platform.kind === "native-mobile"
    ? [`PLATFORM: an Android app (Material 3), not a web page. Target devices, primary first: ${deviceList(platform)}. The android-app seed holds its chrome and rules.`]
    : ["PLATFORM: a responsive web app — one HTML for phone and desktop; the seed's shell and grids collapse on a phone."];
}

/** The user message of a screen drawing (and of a redraw with a requested change). */
export function odScreenRequest(input: OdScreenPromptInput, seed: OdSeed): string {
  const { ref, screen } = input;
  const overlays = screen.overlays ?? [];
  const others = ref.screens.filter((s) => s.key !== screen.key).map((s) => `- ${s.name} (./${s.key}.html): ${s.purpose}`);
  const nav = navMarkup(seed.structure, ref.screens, screen.key);
  const layout = input.layout ? layoutReferenceLines({ ...input.layout, brief: { ...input.layout.brief, kit_mapping: [] } }, "draw") : [];
  return [
    ...briefLines(ref.brief),
    ...odPlatformLines(ref),
    "",
    input.projectText,
    isAuthScreen(screen)
      ? "SCREEN SHELL: outside the app. No sidebar, persistent navigation, signed-in account or logout. A project template is layout inspiration only; use a focused auth/standalone composition. On sign-in, shared dummy people do not imply an account picker or staff directory: show only the requested authentication fields/actions and error feedback. Do not add security explainer panels, session/debug badges or remember-me controls unless an approved authentication requirement asks for them."
      : `APP SHELL UTILITIES: ${JSON.stringify(ref.shell ?? {})}. Render only requested utilities: account requires visible signed-in identity (data-sdd-account) and sign-out (data-sdd-logout); search uses data-sdd-search; notifications uses data-sdd-notifications. These utilities belong outside main content in the seed's header or sidebar footer, and use shared dummy people.`,
    "",
    ...(layout.length ? [...layout, ""] : []),
    "OTHER SCREENS IN THIS REFERENCE (keep names, people and data consistent with them; link to them as ./<key>.html):",
    ...(others.length ? others : ["(none)"]),
    "",
    ...(nav
      ? ["NAVIGATION — copy this markup exactly into the skeleton's navigation slot (the platform refreshes it on every save):", nav, ""]
      : ["NAVIGATION: this screen has no persistent navigation (a focused job); links in the content still lead to the other screens.", ""]),
    ...(input.sample ? [...odClasses(sampleDataLines(input.sample)), ""] : []),
    `SCREEN TO PRODUCE: ${screen.name} (${screen.key})`,
    `PURPOSE (the person's goal on this screen): ${screen.purpose}`,
    `SCREEN TYPE (a category of function, not a layout recipe): ${screen.screen_type ?? "choose the closest"}`,
    `SERVES REQUIREMENTS: ${screen.requirement_keys.join(", ") || "(none listed)"}`,
    'KEY ELEMENTS OF THE MAIN VIEW (all must appear; mark each wrapper data-key-element="<its number>"):',
    ...screen.key_elements.map((e, i) => `${i + 1}. ${e}`),
    ...(screen.primary_action?.label ? [`PRIMARY ACTION: ${screen.primary_action.label}${screen.primary_action.result ? ` — afterwards: ${screen.primary_action.result}` : ""}`] : []),
    'OVERLAYS (each one a <figure data-sdd-frame data-kind="dialog|sheet|confirm"> in <section data-sdd-overlays>, its <figcaption> starting with its kind; the main view shows only what opens it):',
    ...(overlays.length
      ? overlays.map((o) => `- ${o.kind}: ${o.name}${o.purpose ? ` — ${o.purpose}` : ""}${o.result ? ` (afterwards: ${o.result})` : ""}`)
      : ["(none planned — add one only for a create/edit form or a destructive confirmation the key elements imply)"]),
    ...(screen.states?.length
      ? [
          `STATES (draw at most ${UX_BUDGETS.stateFrames} as <figure data-sdd-frame data-kind="state"> frames, captioned "State: …" — the ones a builder would most likely get wrong; the rest are described in the plan):`,
          ...screen.states.map((st) => `- ${st.state}${st.when ? ` (${st.when})` : ""}${st.response ? `: ${st.response}` : ""}`),
        ]
      : []),
    ...(screen.layout_note ? [`COMPOSITION PLAN (${input.layout?.mode === "adapt" ? "functional planning hint; the selected template replaces older visual recipes" : "from the plan — follow it unless the key elements need otherwise"}): ${screen.layout_note}`] : []),
    ...(input.current
      ? ["", "CURRENT VERSION OF THIS SCREEN (the inner HTML of its <body>):", input.current, "", `CHANGE REQUESTED BY THE PERSON: ${input.instruction}`, "Apply the change and keep everything else."]
      : input.instruction
        ? ["", `ALSO REQUESTED BY THE PERSON: ${input.instruction}`]
        : []),
    "",
    OUTPUT_CONTRACT,
  ].join("\n");
}

/** The whole od drawing prompt for a screen: its seed, system prompt and user message. */
export function odScreenPrompt(input: OdScreenPromptInput): { seed: OdSeed; system: string; user: string } {
  const seed = odSeedOf(input.ref, input.screen, input.spec ?? NEUTRAL_SPEC);
  return { seed, system: odSystemPrompt(seed, input.spec), user: odScreenRequest(input, seed) };
}

/** The repair turn's draft framing for an od screen. */
export function odRepairDraft(content: string): string {
  return `YOUR DRAFT OF THIS SCREEN (the inner HTML of <body>):\n${content}`;
}

/**
 * The element-edit prompt of an od screen: the element system prompt, the
 * seed's class vocabulary and the design system (or the wireframe note), so a
 * local change stays inside the same class system and tokens.
 */
export function odElementSystemPrompt(seed: OdSeed, spec: DesignSystemSpec | null): string {
  return [
    UX_OD_ELEMENT_SYSTEM_PROMPT,
    "",
    spec ? odDesignSystemBlocks(spec, []) : WIREFRAME_NOTE,
    "",
    `## Active seed template — ${seed.id}`,
    "",
    seed.classDoc,
  ].join("\n");
}
