import {
  UX_BUDGETS,
  UX_RULES_VERSION,
  type DesignSystemSpec,
  type UxFidelity,
  type UxGenerator,
  type UxLintFinding,
  type UxPlan,
  type UxReference,
  type UxSampleData,
  type UxScreen,
  type UxScreenType,
} from "@sdd/contracts";
import { STYLE_BLOCK, droppedComposeCss } from "./ux-compose.js";
import { unknownIcons } from "./ux-icons.js";
import { finding, isBlocking, repairTargets } from "./ux-rules.js";
import { lintOdScreen, odRequiredContent } from "./ux-od-lint.js";
import { structureOf, isAuthScreen } from "./ux-od-seeds.js";

/**
 * Deterministic checks on a generated UI-reference screen (after open-design's
 * lint-artifact, impeccable's detector and kill-ai-slop). The input is the
 * model's page content — the inside of <main>, before the platform adds the
 * shell and the stylesheet (those are ours and legitimately hold colours).
 *
 * What each finding does — block approval, or warn — and whether the one
 * repair turn is asked to fix it is set by the rule catalogue (ux-rules.ts).
 */

export interface LintOptions {
  /** The screen's type (a category of function); list-like screens should not hold inline forms. */
  screenType?: UxScreenType;
  /** How many overlays the plan lists for the screen. */
  overlays?: number;
  /** The shared example data's record names; a screen showing none of them drifted from the other screens. */
  sampleNames?: string[];
  /**
   * How many key elements the plan lists; each must be marked
   * data-key-element="1"…"n" (references planned under rules version 2).
   */
  keyElements?: number;
  /** The shared example data; stat-card numbers must come from it (rules version 2). */
  sample?: UxSampleData;
  /** A native mobile reference with a phone among its devices: its tables must turn into cards there. */
  nativePhone?: boolean;
  /** How the screen was drawn: the kit (absent) or open-design style, checked by ux-od-lint.ts. */
  generator?: UxGenerator;
  /** od: the reference's screen keys, so links between screens can be checked. */
  screenKeys?: string[];
  /** od: whether the screen's seed has a navigation slot (every structure but the minimal web shell). */
  navExpected?: boolean;
  authScreen?: boolean;
  accountExpected?: boolean;
  searchExpected?: boolean;
  notificationsExpected?: boolean;
  /** od: the design system's accent (light), so an indigo brand is not reported as the AI default. */
  accent?: string | null;
}

/** CSS the model wrote: the bodies of <style> blocks and style="" attributes. */
export function authoredCss(html: string): string {
  const blocks = [...html.matchAll(STYLE_BLOCK)].map((m) => m[2] ?? "");
  const attrs = [...html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2] ?? "");
  return [...blocks, ...attrs].join("\n");
}

/** Declaration values only, so id selectors such as `#add-form` never read as colours. */
export function cssDeclarations(css: string): Array<{ prop: string; value: string }> {
  return [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)].map((m) => ({ prop: (m[1] ?? "").toLowerCase(), value: m[2] ?? "" }));
}

/** The first emoji on an action (a button or link) — where it replaces an icon whose meaning is unclear. */
export function actionEmoji(html: string): string | null {
  for (const m of html.matchAll(ACTION_ELEMENT)) {
    const hit = visibleText(m[2] ?? "").match(EMOJI);
    if (hit) return hit[0];
  }
  return null;
}

/** The text a person sees: styles, comments and tags removed. */
export function visibleText(html: string): string {
  return html
    .replace(STYLE_BLOCK, " ")
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
}

// Emoji_Presentation leaves out ©, ®, ™, arrows and ✓, which UI copy uses legitimately.
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
const FILLER = /\blorem ipsum\b|\bdolor sit amet\b/i;
/** Buttons and links (menu items are buttons): where an emoji can stand in for an action's icon. */
const ACTION_ELEMENT = /<(button|a)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;
const LEFT_ACCENT = /^\s*(?:[^;]*\s)?(?:[2-9]|[1-9]\d)(?:\.\d+)?px\b/i;
/** Fixed sizes wider than a phone (375px minus page gutters) overflow it. */
const FIXED_WIDTH_PX = UX_BUDGETS.phoneWidthPx;
// Exact class names: `ds-modal-header` is part of a dialog, not a dialog of its own.
const SHELL_CLASSES = ["ds-sidebar", "ds-app", "ds-app-header", "ds-inset", "ds-mobilebar", "ds-topbar", "ds-shell", "ds-native", "ds-status-bar", "ds-top-app-bar", "ds-bottom-nav", "ds-nav-rail"];
const OVERLAY_CLASSES = ["ds-modal", "ds-sheet", "ds-alert-dialog", "ds-dialog"];
const LIST_LIKE: ReadonlySet<UxScreenType> = new Set(["dashboard", "list", "board", "analytics"]);
/** Budgets the screen prompt states. */
const MAX_TABLE_COLUMNS = UX_BUDGETS.tableColumns;
const MAX_BLOCKS = UX_BUDGETS.blocksUnderHeader;
const MAX_PAGE_ACTIONS = UX_BUDGETS.pageActions;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

interface Structure {
  primaryMain: number;
  /** Primary buttons in each area of the main view (each top-level block — the page header, a section — is one area). */
  primaryByArea: number[];
  /** The numbers of the data-key-element markers found. */
  keyMarkers: Set<number>;
  h1Main: number;
  nestedCards: number;
  inlineFields: number;
  overlayFrames: number;
  overlaysWithoutHeading: number;
  drewShell: boolean;
  unlabelled: number;
  /** Column count of each table in the main view (colspans summed), from its first row. */
  tableColumns: number[];
  /** Top-level blocks of the main view besides the page header and the overlays. */
  blocks: number;
  hasPageHeader: boolean;
  /** Buttons in the page header's actions. */
  pageActions: number;
}

/**
 * One pass over the tags, tracking where each element sits: in the overlays
 * section, in a filter toolbar, inside a card or an overlay surface.
 */
function scan(html: string): Structure {
  const out: Structure = {
    primaryMain: 0,
    primaryByArea: [],
    keyMarkers: new Set(),
    h1Main: 0,
    nestedCards: 0,
    inlineFields: 0,
    overlayFrames: 0,
    overlaysWithoutHeading: 0,
    drewShell: false,
    unlabelled: 0,
    tableColumns: [],
    blocks: 0,
    hasPageHeader: false,
    pageActions: 0,
  };
  type Frame = {
    tag: string;
    overlays: boolean;
    toolbar: boolean;
    cards: number;
    surface: { heading: boolean } | null;
    label: boolean;
    /** The table this element is in, and whether its first row is still being read. */
    table: { columns: number; rowsSeen: number } | null;
    actions: boolean;
    /** The top-level block this element belongs to (-1 for the root). */
    area: number;
  };
  const root: Frame = { tag: "#root", overlays: false, toolbar: false, cards: 0, surface: null, label: false, table: null, actions: false, area: -1 };
  let areas = 0;
  const stack: Frame[] = [root];
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]!));

  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const closing = m[1] === "/";
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? "";
    if (closing) {
      const at = stack.map((f) => f.tag).lastIndexOf(tag);
      if (at > 0) {
        for (let i = stack.length - 1; i >= at; i--) {
          const f = stack[i]!;
          if (f.surface && (i === 0 || stack[i - 1]!.surface !== f.surface) && !f.surface.heading) out.overlaysWithoutHeading += 1;
          if (f.tag === "table" && f.table && !f.overlays) out.tableColumns.push(f.table.columns);
        }
        stack.length = at;
      }
      continue;
    }
    const parent = stack[stack.length - 1]!;
    const cls = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
    const classes = cls.split(/\s+/);
    const has = (name: string) => classes.includes(name);
    const area = parent === root ? areas++ : parent.area;
    // A marker anywhere counts: a key element can sit in a card or a section.
    const marker = /\bdata-key-element\s*=\s*["']?(\d+)/i.exec(attrs)?.[1];
    if (marker) out.keyMarkers.add(Number(marker));

    if (SHELL_CLASSES.some(has) || (tag === "aside" && /\bnav\b/i.test(attrs + cls))) out.drewShell = true;
    // Blocks directly in the main view (the content is the inside of <main>).
    if (parent === root && tag !== "script" && tag !== "style") {
      if (has("ds-page-header")) out.hasPageHeader = true;
      else if (!has("ds-overlays")) out.blocks += 1;
    }
    if (parent.actions && (tag === "button" || has("ds-btn") || has("ds-dropdown"))) out.pageActions += 1;
    if (tag === "tr" && parent.table) parent.table.rowsSeen += 1;
    // The row-selection gutter (ds-check) is not a data column.
    if ((tag === "th" || tag === "td") && parent.table && parent.table.rowsSeen === 1 && !has("ds-check")) {
      parent.table.columns += Math.max(1, Number(/\bcolspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1] ?? 1));
    }
    if (!parent.overlays) {
      if (has("ds-btn-primary")) {
        out.primaryMain += 1;
        out.primaryByArea[area] = (out.primaryByArea[area] ?? 0) + 1;
      }
      if (tag === "h1") out.h1Main += 1;
      const field = tag === "select" || tag === "textarea" || (tag === "input" && !/\btype\s*=\s*["']?(?:hidden|checkbox|radio|button|submit|search)\b/i.test(attrs));
      if (field && !parent.toolbar) out.inlineFields += 1;
    }
    if (has("ds-card") && parent.cards > 0 && !parent.surface) out.nestedCards += 1;
    if (has("ds-frame") && parent.overlays) out.overlayFrames += 1;
    if (/^h[1-4]$/.test(tag) && parent.surface) parent.surface.heading = true;
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const hidden = /\btype\s*=\s*["']?(?:hidden|button|submit|reset|image)\b/i.test(attrs);
      const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
      const named = /\baria-label(?:ledby)?\s*=/i.test(attrs) || (id !== undefined && labelled.has(id)) || stack.some((f) => f.label);
      if (!hidden && !named) out.unlabelled += 1;
    }

    if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
    stack.push({
      tag,
      overlays: parent.overlays || has("ds-overlays"),
      toolbar: parent.toolbar || has("ds-toolbar"),
      cards: parent.cards + (has("ds-card") ? 1 : 0),
      surface: OVERLAY_CLASSES.some(has) ? { heading: false } : parent.surface,
      label: parent.label || tag === "label",
      table: tag === "table" ? { columns: 0, rowsSeen: 0 } : parent.table,
      // Buttons directly in the page actions (a dropdown counts once, its items do not).
      actions: has("ds-page-actions"),
      area,
    });
  }
  return out;
}

/** Whether the text names a record: its full name, or its last two words ("Gudang Logistik Cikarang" → "Logistik Cikarang"). */
export function mentions(text: string, name: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const n = name.toLowerCase().replace(/\s+/g, " ");
  if (t.includes(n)) return true;
  const words = n.split(" ");
  return words.length > 2 && t.includes(words.slice(-2).join(" "));
}

/**
 * What a screen's HTML is checked against — the same on generate, redraw,
 * edit, undo, restore and approval. The checks of rules version 2 (key-element
 * markers, stat numbers from the example data) apply only to references
 * planned under it: an older drawing never had the markers to check.
 */
export function lintOptionsFor(ref: UxReference, screen: UxScreen | undefined, spec?: DesignSystemSpec | null): LintOptions {
  const current = (ref.rules_version ?? 1) >= UX_RULES_VERSION;
  const od = ref.generator === "od"
    ? {
        generator: "od" as const,
        screenKeys: ref.screens.map((s) => s.key),
        navExpected: !Boolean(screen && isAuthScreen(screen)) && structureOf(ref.platform, ref.shell?.layout) !== "web-minimal",
        authScreen: Boolean(screen && isAuthScreen(screen)),
        accountExpected: !Boolean(screen && isAuthScreen(screen)) && Boolean(ref.shell?.account),
        searchExpected: !Boolean(screen && isAuthScreen(screen)) && Boolean(ref.shell?.search),
        notificationsExpected: !Boolean(screen && isAuthScreen(screen)) && Boolean(ref.shell?.notifications),
        ...(ref.fidelity === "styled" && spec ? { accent: spec.light.accent } : {}),
      }
    : {};
  return {
    ...od,
    screenType: screen?.screen_type,
    overlays: screen?.overlays?.length ?? 0,
    sampleNames: ref.sample_data?.records.map((r) => r.name),
    ...(current && screen?.key_elements.length ? { keyElements: screen.key_elements.length } : {}),
    ...(current && ref.sample_data ? { sample: ref.sample_data } : {}),
    ...(ref.platform?.kind === "native-mobile" && ref.platform.devices.includes("phone") ? { nativePhone: true } : {}),
  };
}

/** The text of every stat card's value (ds-stat-value), tags removed. */
export function statValues(html: string): string[] {
  return [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bds-stat-value\b[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/gi)].map((m) =>
    (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
  );
}

/**
 * A number as written, reduced to its digits (and a percent sign): "Rp
 * 12.500.000", "12,500,000" and "12500000" are the same number, whichever
 * separators the language uses.
 */
export function numberKeys(text: string): string[] {
  return [...text.matchAll(/\d[\d.,]*(?:\s*%)?/g)].map((m) => {
    const digits = m[0].replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
    return m[0].includes("%") ? `${digits}%` : digits;
  });
}

/** Counts up to this read as counts of the rows a screen shows ("3 overdue"), not as KPIs that need a source. */
const SMALL_COUNT = 20;

/**
 * Stat numbers the example data does not hold: every number in a stat card
 * must appear in the records, the notes or the declared aggregates, or be a
 * small count of the rows shown. Percentages and large figures are never
 * assumed — they are exactly the made-up KPIs the rules forbid.
 */
export function unsourcedMetrics(html: string, sample: UxSampleData): string[] {
  return unsourcedValues(statValues(html), sample);
}

/** The stat values (their text) the example data does not hold — see unsourcedMetrics. */
export function unsourcedValues(values: string[], sample: UxSampleData): string[] {
  const source = [
    ...sample.records.flatMap((r) => [r.name, r.facts]),
    sample.notes,
    ...(sample.aggregates ?? []).flatMap((a) => [a.label, a.value, a.basis]),
  ].join(" \n ");
  const known = new Set(numberKeys(source));
  for (const n of [sample.records.length, sample.people.length]) known.add(String(n));
  for (const kind of new Set(sample.records.map((r) => r.kind))) known.add(String(sample.records.filter((r) => r.kind === kind).length));
  return values.filter((value) =>
    numberKeys(value).some((k) => !known.has(k) && !(!k.endsWith("%") && Number(k) <= SMALL_COUNT)),
  );
}

/** Every finding on one screen's content; an empty list means it passed. */
export function lintScreenHtml(html: string, _fidelity: UxFidelity, opts: LintOptions = {}): UxLintFinding[] {
  if (opts.generator === "od") return lintOdScreen(html, opts);
  const findings: UxLintFinding[] = [];
  const css = authoredCss(html);
  // Media conditions ((min-width: 1100px)) are not declarations.
  const decls = cssDeclarations(css.replace(/@media[^{]*/gi, ""));
  const text = visibleText(html);
  const s = scan(html);
  const add = (rule: string, message: string) => findings.push(finding(rule, message));

  // Completeness: what the plan says the screen holds.
  if (opts.overlays && s.overlayFrames < opts.overlays) {
    add("missing-overlay", `The plan lists ${opts.overlays} overlay${opts.overlays === 1 ? "" : "s"} but ${s.overlayFrames} ${s.overlayFrames === 1 ? "is" : "are"} drawn in ds-overlays — draw every planned overlay.`);
  }
  if (opts.keyElements) {
    const missing = Array.from({ length: opts.keyElements }, (_, i) => i + 1).filter((n) => !s.keyMarkers.has(n));
    if (missing.length) {
      add("missing-key-element", `Key element${missing.length === 1 ? "" : "s"} ${missing.join(", ")} of the plan ${missing.length === 1 ? "is" : "are"} not on the page — draw each and mark its wrapper data-key-element="<its number>".`);
    }
  }
  // Usability.
  if (s.unlabelled > 0) add("unlabelled-field", `${s.unlabelled} form field${s.unlabelled === 1 ? " has" : "s have"} no visible label — give each a <label for=…>.`);
  // Integrity: tokens and data.
  const literal = decls.map((d) => COLOUR_LITERAL.exec(d.value)?.[0]).find(Boolean);
  if (literal) add("raw-colour", `Writes a colour itself (${literal}); colours come only from the ds-* classes and var(--ds-…) values.`);
  if (opts.sample) {
    const unsourced = unsourcedMetrics(html, opts.sample);
    if (unsourced.length) {
      add("unsourced-metric", `Stat numbers not in the shared example data: ${unsourced.slice(0, 4).map((v) => `"${v}"`).join(", ")} — show a number from the records or the declared aggregates, or leave the stat out.`);
    }
  }

  // Design guidance: warnings with their context.
  if (s.drewShell) add("drew-shell", "Draws its own sidebar or navigation bar; the platform adds the shell — return only the page content inside <main>.");
  const emoji = actionEmoji(html);
  if (emoji) add("emoji-icon", `Uses an emoji ("${emoji}") as an action's icon; its meaning is unclear and it renders differently everywhere — use a Lucide icon (<i data-icon="…"></i>) or the label alone.`);
  if (FILLER.test(text)) add("filler-copy", "Contains lorem ipsum; use realistic content in the requirements' wording.");
  const fixed = decls.find(
    (d) => /^(?:min-)?width$|^flex-basis$|^grid-template-columns$/.test(d.prop) && [...d.value.matchAll(/(\d+(?:\.\d+)?)px/g)].some((n) => Number(n[1]) >= FIXED_WIDTH_PX),
  );
  if (fixed) add("fixed-width", `Sets ${fixed.prop}: ${fixed.value.trim()} — wider than a phone; use the kit's layout classes instead of px widths.`);
  const crowded = s.primaryByArea.filter((n) => (n ?? 0) > UX_BUDGETS.primaryPerArea).length;
  if (crowded) add("competing-primaries", `${crowded === 1 ? "One area has" : `${crowded} areas have`} more than one primary button; keep one primary per area and make the others secondary or put them in a ds-dropdown.`);
  const areasWithPrimary = s.primaryByArea.filter((n) => (n ?? 0) > 0).length;
  if (areasWithPrimary > 1) add("two-primaries", `${areasWithPrimary} areas of the main view each have a primary button; fine when they are parallel jobs, otherwise keep one.`);
  if (opts.nativePhone) {
    // The main view only: an overlay is judged as its own frame.
    const main = html.split(/<section\b[^>]*\bds-overlays\b/i)[0] ?? html;
    const tables = [...main.matchAll(/<table\b[^>]*>/gi)].filter((m) => !/\bdata-phone\s*=\s*["']?card\b/i.test(m[0]));
    if (tables.length) {
      add("web-table-on-phone", `Has ${tables.length === 1 ? "a table" : `${tables.length} tables`} an Android phone shows as a web table; use a ds-list or cards, or give the table data-phone="card".`);
    }
  }
  const wide = s.tableColumns.filter((n) => n > MAX_TABLE_COLUMNS);
  if (wide.length) {
    add("table-columns", `Has a table of ${wide.join(" and ")} columns (recommended at most ${MAX_TABLE_COLUMNS}); fine for a comparison table (data-phone="scroll"), otherwise move detail into the row's sheet.`);
  }
  if (opts.screenType && LIST_LIKE.has(opts.screenType) && s.inlineFields > 3) {
    add("inline-form", `Draws a form of ${s.inlineFields} fields inline in a ${opts.screenType} view; a short form belongs in a dialog, a long one on its own form screen.`);
  }
  // Composition CSS is allowed; what the platform had to drop is reported.
  const dropped = droppedComposeCss(html);
  if (dropped.length) {
    add("style-dropped", `The platform dropped from your <style>: ${dropped.slice(0, 6).join("; ")}${dropped.length > 6 ? ` (+${dropped.length - 6} more)` : ""}. Composition CSS may set layout and spacing, and colour, border, radius or shadow only through var(--ds-…).`);
  }
  if (decls.some((d) => /^border-left(?:-width)?$/.test(d.prop) && LEFT_ACCENT.test(d.value))) {
    add("left-accent-card", "A thick left border marks a card or alert; check that what it means (a status, a selection) is also said in words.");
  }
  if (s.h1Main === 0) add("missing-h1", "The main view has no <h1>; give the screen one clear main title.");
  if (s.blocks > MAX_BLOCKS) add("too-many-blocks", `Has ${s.blocks} main blocks (about ${MAX_BLOCKS} is a review signal, not a target); check that the main job leads — tabs, a detail screen or a sheet may read better.`);
  if (s.pageActions > MAX_PAGE_ACTIONS) {
    add("page-actions-overuse", `The page header has ${s.pageActions} actions; keep the primary and one or two secondary ones and put the rest in a ds-dropdown.`);
  }
  if (s.h1Main > 1) add("multiple-h1", `Has ${s.h1Main} <h1> headings in the main view; a screen has one.`);
  if (s.nestedCards > 0) add("nested-card", `Puts a card inside a card ${s.nestedCards} time${s.nestedCards === 1 ? "" : "s"}; check that the grouping is real — a section, a divider or space may say it more clearly.`);
  if (s.overlaysWithoutHeading > 0) add("overlay-no-heading", "A dialog, sheet or confirmation has no heading.");
  const names = (opts.sampleNames ?? []).map((n) => n.trim()).filter(Boolean);
  if (names.length && !names.some((n) => mentions(text, n))) {
    add("off-sheet-data", `Shows none of the shared example records (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}); use the same records as the other screens.`);
  }
  const unknown = unknownIcons(html);
  if (unknown.length) add("unknown-icon", `Icon name${unknown.length === 1 ? "" : "s"} not in Lucide: ${unknown.slice(0, 5).join(", ")} — drawn as a placeholder.`);
  return findings;
}

/** The follow-up instruction for the one repair turn: the findings it is asked to fix. */
export function lintRepairInstruction(findings: UxLintFinding[], generator?: UxGenerator): string {
  return [
    generator === "od"
      ? "Your draft of this screen breaks these rules. Fix every item and return the corrected inner HTML of <body> only (your <style data-screen>, the app root, the overlays section). Change nothing else — keep every marker, every key element (and its data-key-element), every overlay frame, the navigation markup, the example data and the composition."
      : "Your draft of this screen breaks these rules. Fix every item and return the corrected <main class=\"ds-main\"> element only. Change nothing else — keep every key element (and its data-key-element marker), every overlay, the example data and the composition.",
    ...repairTargets(findings).map((f) => `- ${f.message}`),
  ].join("\n");
}

/** The required content of a drawing: its key-element markers, its overlay frames, the example records it names. */
function requiredContent(html: string, sampleNames: string[]) {
  const text = visibleText(html);
  const records = sampleNames.filter((n) => n.trim() && mentions(text, n));
  // An od body: its frames are figures in the overlays section, whatever their classes.
  if (/\sdata-sdd-(?:app|overlays)\b/.test(html)) return { ...odRequiredContent(html), records };
  const s = scan(html);
  return { markers: s.keyMarkers, overlays: s.overlayFrames, records };
}

const blockingRules = (findings: UxLintFinding[]) => new Set(findings.filter(isBlocking).map((f) => f.rule));

/**
 * Whether the repair turn's drawing replaces the first one (aturan.md §5.3):
 * the findings it was asked to fix went down, it breaks no approval rule the
 * first drawing kept, and it lost none of the required content — a repair
 * that fixes a drawn sidebar by deleting a planned dialog is refused.
 */
export function acceptScreenRepair(
  before: { content: string; findings: UxLintFinding[] },
  after: { content: string; findings: UxLintFinding[] },
  opts: { sampleNames?: string[] } = {},
): boolean {
  if (after.content.length < 200) return false;
  if (repairTargets(after.findings).length >= repairTargets(before.findings).length) return false;
  const was = blockingRules(before.findings);
  if ([...blockingRules(after.findings)].some((r) => !was.has(r))) return false;
  if (after.findings.filter(isBlocking).length > before.findings.filter(isBlocking).length) return false;
  const names = opts.sampleNames ?? [];
  const a = requiredContent(before.content, names);
  const b = requiredContent(after.content, names);
  if ([...a.markers].some((m) => !b.markers.has(m))) return false;
  if (b.overlays < a.overlays) return false;
  return a.records.every((r) => b.records.includes(r));
}

/** Plan budgets the plan prompt states. */
const MAX_KEY_ELEMENTS = UX_BUDGETS.keyElements;

export interface PlanLintOptions {
  /** The count the person set, or null. */
  screenCount: number | null;
  /** The approved requirements with their priority. */
  requirements: Array<{ key: string; priority: string }>;
}

/** Non-functional requirements (NFR-…) are qualities of every screen, not screens of their own. */
const isQuality = (key: string) => /^NFR-/i.test(key);

/** The requirement keys a plan serves (upper-cased). */
export function servedRequirements(plan: { screens: Array<{ requirement_keys: string[] }> }): Set<string> {
  return new Set(plan.screens.flatMap((s) => s.requirement_keys.map((k) => k.trim().toUpperCase())));
}

/** P0 requirements a person can see that no screen serves: not qualities, not declared as having nothing to see. */
export function uncoveredMustHaves(
  plan: { screens: Array<{ requirement_keys: string[] }>; no_ui_requirements?: Array<{ key: string }> },
  requirements: PlanLintOptions["requirements"],
): string[] {
  const served = servedRequirements(plan);
  const noUi = new Set((plan.no_ui_requirements ?? []).map((r) => r.key.trim().toUpperCase()));
  return requirements
    .filter((r) => r.priority === "P0" && !isQuality(r.key) && !noUi.has(r.key.toUpperCase()) && !served.has(r.key.toUpperCase()))
    .map((r) => r.key);
}

/**
 * Checks on the screen plan before any screen is drawn (aturan.md §4, Lapis
 * 2). A visible P0 requirement no screen serves blocks approval; the rest is
 * advice: screens are grouped by the person's work, so many elements or many
 * requirements on one screen are a review signal, not a reason to split it.
 */
export function lintUxPlan(plan: UxPlan, opts: PlanLintOptions): UxLintFinding[] {
  if (!plan.applicable) return [];
  const findings: UxLintFinding[] = [];
  const list = (keys: string[]) => `${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ` (+${keys.length - 8} more)` : ""}`;

  const uncovered = uncoveredMustHaves(plan, opts.requirements);
  if (uncovered.length && plan.screens.length) {
    const declared = new Set([...(plan.count_conflict?.uncovered ?? [])].map((k) => k.toUpperCase()));
    const allDeclared = uncovered.every((k) => declared.has(k.toUpperCase())) || (plan.uncovered_scope?.length ?? 0) > 0;
    findings.push({
      ...finding(
        "uncovered-requirements",
        allDeclared
          ? `No screen serves the P0 requirement${uncovered.length === 1 ? "" : "s"} ${list(uncovered)}; the plan says why — confirm the left-out scope before approval.`
          : `No screen serves the P0 requirement${uncovered.length === 1 ? "" : "s"} ${list(uncovered)}: serve each on a screen, or list it in no_ui_requirements if a person never sees it.`,
      ),
      // A conflict the plan declares is the person's call, not something a repair can fix.
      repair: !allDeclared,
    });
  }
  const served = servedRequirements(plan);
  const noUi = new Set((plan.no_ui_requirements ?? []).map((r) => r.key.trim().toUpperCase()));
  const minor = opts.requirements
    .filter((r) => r.priority !== "P0" && !isQuality(r.key) && !noUi.has(r.key.toUpperCase()) && !served.has(r.key.toUpperCase()))
    .map((r) => r.key);
  if (minor.length && plan.screens.length) findings.push(finding("uncovered-requirements-minor", `No screen serves ${list(minor)}.`));
  if (opts.screenCount && plan.screens.length !== opts.screenCount && !plan.count_conflict) {
    findings.push(finding("wrong-count", `The person asked for ${opts.screenCount} screens and the plan has ${plan.screens.length}; plan exactly ${opts.screenCount}, or explain in count_conflict why that count cannot serve every P0 requirement.`));
  }
  const busy = plan.screens.filter((s) => s.key_elements.length > MAX_KEY_ELEMENTS);
  if (busy.length) {
    findings.push(
      finding("busy-screen", `Screens with more than ${MAX_KEY_ELEMENTS} key elements: ${busy.map((s) => `"${s.name}" (${s.key_elements.length})`).join(", ")} — check the hierarchy and how the elements relate; split only if they serve different jobs.`),
    );
  }
  const untraced = plan.screens.filter((s) => s.requirement_keys.length === 0);
  if (untraced.length) {
    findings.push(finding("untraced-screen", `${untraced.map((s) => `"${s.name}"`).join(", ")} serve${untraced.length === 1 ? "s" : ""} no requirement — link each to the requirement that needs it, or remove it.`));
  }
  return findings;
}

/**
 * Whether the repaired plan replaces the first: same answer on whether there
 * is a UI, fewer findings to fix, no new approval blocker, and no P0
 * requirement the first plan served left unserved.
 */
export function acceptPlanRepair(
  before: { plan: UxPlan; findings: UxLintFinding[] },
  after: { plan: UxPlan; findings: UxLintFinding[] },
  requirements: PlanLintOptions["requirements"],
): boolean {
  if (after.plan.applicable !== before.plan.applicable) return false;
  if (repairTargets(after.findings).length >= repairTargets(before.findings).length) return false;
  const was = blockingRules(before.findings);
  if ([...blockingRules(after.findings)].some((r) => !was.has(r))) return false;
  const servedAfter = servedRequirements(after.plan);
  const mustHaves = new Set(requirements.filter((r) => r.priority === "P0").map((r) => r.key.toUpperCase()));
  return [...servedRequirements(before.plan)].every((k) => !mustHaves.has(k) || servedAfter.has(k));
}

/** The follow-up instruction for the plan's one repair turn. */
export function planRepairInstruction(findings: UxLintFinding[]): string {
  return [
    "Your plan breaks these rules. Fix every item and return the whole corrected plan in the same schema. Keep everything else — no screen that serves a P0 requirement may disappear.",
    ...repairTargets(findings).map((f) => `- ${f.message}`),
  ].join("\n");
}
