import { UX_BUDGETS, type UxLintFinding, type UxScreenType } from "@sdd/contracts";
import { Parser } from "htmlparser2";
import { unknownIcons } from "./ux-icons.js";
import { actionEmoji, authoredCss, cssDeclarations, mentions, numberKeys, unsourcedValues, visibleText, type LintOptions } from "./ux-lint.js";
import { finding } from "./ux-rules.js";

/**
 * The checks of an od screen (the model's whole body, before the platform
 * adds the tokens and the seed CSS). The approval rules are the kit's —
 * planned key elements and overlays drawn, labelled fields, no raw colours,
 * stat numbers from the example data — read through the od markers instead of
 * the kit's classes. On top come open-design's lint rules (its
 * lint-artifact / anti-ai-slop checks) as warnings: AI-default palettes and
 * gradients, emoji icons, decorative left borders, display type in a body
 * sans, invented metrics, filler copy, untracked capitals, external images,
 * many raw hex values, an overused accent, unanchored sections.
 */

const COLOUR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const LEFT_ACCENT = /^\s*(?:[^;]*\s)?(?:[2-9]|[1-9]\d)(?:\.\d+)?px\b/i;
const FILLER = /\blorem ipsum\b|\bdolor sit amet\b|\bfeature (?:one|two|three)\b|\bsample (?:content|text)\b|\byour (?:text|content) here\b|\bplaceholder text\b/i;
/** Claims a product mockup has no data for: uptime, multipliers, growth percentages. */
const CLAIM = /\b\d{1,3}(?:[.,]\d+)?\s*%\s*(?:uptime|faster|growth|increase|more|better|satisfaction|accuracy|of (?:users|customers|teams))\b|\b\d+(?:[.,]\d+)?\s*[x×]\s*(?:faster|more|better|growth|roi)\b|\b99[.,]9+\s*%/i;
/** Tailwind's indigo and violet: the colour every AI-made UI defaults to (open-design's ai-default-indigo). */
const INDIGO = new Set(["#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#818cf8", "#a5b4fc", "#8b5cf6", "#7c3aed", "#6d28d9", "#a78bfa", "#5b21b6"]);
const INDIGO_CLASS = /\b(?:bg|text|from|to|via|border)-(?:indigo|violet)-\d{2,3}\b/;
const SANS_DISPLAY = /\b(?:inter|roboto|arial|helvetica|open sans|poppins|montserrat|system-ui|sans-serif|segoe ui)\b/i;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const LIST_LIKE: ReadonlySet<UxScreenType> = new Set(["dashboard", "list", "board", "analytics"]);
/** The accent used in more places than this reads as decoration, not emphasis. */
const ACCENT_BUDGET = 6;
/** More raw hex values than this is a palette of its own. */
const HEX_BUDGET = 12;

/** A hex colour's hue (0–360) and saturation (0–1), or null. */
function hueOf(hex: string): { h: number; s: number } | null {
  let v = hex.replace("#", "");
  if (v.length === 3 || v.length === 4) v = v.slice(0, 3).split("").map((c) => c + c).join("");
  if (v.length !== 6 && v.length !== 8) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s };
}

const NAMED_PURPLE = /\b(?:purple|violet|indigo|magenta|fuchsia|orchid|plum|rebeccapurple|blueviolet|mediumpurple)\b/i;
const NAMED_BLUE = /\b(?:blue|navy|royalblue|dodgerblue|deepskyblue|steelblue|cornflowerblue|skyblue|cyan)\b/i;
const isPurple = (stop: string) => NAMED_PURPLE.test(stop) || [...stop.matchAll(HEX)].some((m) => { const c = hueOf(m[0]); return Boolean(c && c.s > 0.25 && c.h >= 245 && c.h <= 320); });
const isBlue = (stop: string) => NAMED_BLUE.test(stop) || [...stop.matchAll(HEX)].some((m) => { const c = hueOf(m[0]); return Boolean(c && c.s > 0.25 && c.h >= 190 && c.h < 245); });

/** The gradients of the authored CSS (their argument lists). */
function gradients(css: string): string[] {
  return [...css.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(([^;{}]*)\)/gi)].map((m) => m[1] ?? "");
}

/** The rule blocks of authored CSS: selector and declarations. */
function ruleBlocks(css: string): Array<{ selector: string; body: string }> {
  return [...css.replace(/@media[^{]*\{/gi, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" }));
}

interface OdStructure {
  app: boolean;
  content: boolean;
  overlaysSection: boolean;
  nav: number;
  keyMarkers: Set<number>;
  /** Overlay frames (dialog, sheet, confirm) and state frames in the overlays section. */
  overlayFrames: number;
  stateFrames: number;
  framesWithoutHeading: number;
  h1: number;
  primaryByArea: number[];
  nestedCards: number;
  inlineFields: number;
  unlabelled: number;
  tableColumns: number[];
  /** Tables of the main view a phone shows as a web table (no table-cards / data-phone="card"). */
  webTables: number;
  /** Top-level sections of the main view without a data-od-id. */
  unanchored: number;
  /** Links to screens, outside the navigation: their targets. */
  links: string[];
  images: number;
  stats: string[];
  accentMarkup: number;
}

/** One pass over the body with a real parser, tracking where each element sits. */
function scanOd(html: string): OdStructure {
  const out: OdStructure = {
    app: false,
    content: false,
    overlaysSection: false,
    nav: 0,
    keyMarkers: new Set(),
    overlayFrames: 0,
    stateFrames: 0,
    framesWithoutHeading: 0,
    h1: 0,
    primaryByArea: [],
    nestedCards: 0,
    inlineFields: 0,
    unlabelled: 0,
    tableColumns: [],
    webTables: 0,
    unanchored: 0,
    links: [],
    images: 0,
    stats: [],
    accentMarkup: 0,
  };
  type Frame = {
    tag: string;
    overlays: boolean;
    main: boolean;
    /** This element is <main data-screen-content> itself. */
    isMain: boolean;
    nav: boolean;
    toolbar: boolean;
    cards: number;
    label: boolean;
    frame: { heading: boolean } | null;
    table: { columns: number; rows: number } | null;
    area: number;
    stat: { text: string[] } | null;
  };
  const root: Frame = { tag: "#root", overlays: false, main: false, isMain: false, nav: false, toolbar: false, cards: 0, label: false, frame: null, table: null, area: -1, stat: null };
  const stack: Frame[] = [root];
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]!));
  let areas = 0;
  const close = (f: Frame) => {
    if (f.tag === "table" && f.table && f.main && !f.overlays) out.tableColumns.push(f.table.columns);
    if (f.frame && !stack.some((p) => p !== f && p.frame === f.frame) && !f.frame.heading) out.framesWithoutHeading += 1;
    if (f.stat && !stack.some((p) => p !== f && p.stat === f.stat)) out.stats.push(f.stat.text.join(" ").replace(/\s+/g, " ").trim());
  };
  const parser = new Parser(
    {
      onopentag(tag, attrs) {
        const parent = stack[stack.length - 1]!;
        const classes = (attrs.class ?? "").split(/\s+/).filter(Boolean);
        const has = (c: string) => classes.includes(c);
        if ("data-sdd-app" in attrs) out.app = true;
        const isMain = "data-screen-content" in attrs;
        if (isMain) out.content = true;
        const overlaysHere = "data-sdd-overlays" in attrs;
        if (overlaysHere) out.overlaysSection = true;
        if ("data-sdd-nav" in attrs) out.nav += 1;
        const marker = /^\d+$/.test(attrs["data-key-element"] ?? "") ? Number(attrs["data-key-element"]) : null;
        if (marker !== null) out.keyMarkers.add(marker);
        const inOverlays = parent.overlays || overlaysHere;
        const isFrame = "data-sdd-frame" in attrs && inOverlays;
        // A state frame shows a state of the page; dialogs, sheets and confirmations need their own heading.
        const isState = isFrame && (attrs["data-kind"] ?? "").toLowerCase() === "state";
        if (isFrame) {
          if (isState) out.stateFrames += 1;
          else out.overlayFrames += 1;
        }
        const inMain = parent.main || isMain;
        // Each direct child of the main view is one area (a page header, a section).
        const area = parent.isMain ? areas++ : parent.area;
        if (parent.isMain && tag === "section" && !("data-od-id" in attrs)) out.unanchored += 1;
        if (!inOverlays) {
          if (tag === "h1") out.h1 += 1;
          if (inMain && has("btn-primary")) out.primaryByArea[area] = (out.primaryByArea[area] ?? 0) + 1;
          const field = tag === "select" || tag === "textarea" || (tag === "input" && !/^(?:hidden|checkbox|radio|button|submit|search)$/i.test(attrs.type ?? ""));
          if (inMain && field && !parent.toolbar) out.inlineFields += 1;
          if (inMain && tag === "table" && !has("table-cards") && !/^card$/i.test(attrs["data-phone"] ?? "")) out.webTables += 1;
        }
        if (has("card") && parent.cards > 0 && !parent.frame) out.nestedCards += 1;
        if (/^h[1-4]$/.test(tag) && parent.frame) parent.frame.heading = true;
        if (tag === "input" || tag === "select" || tag === "textarea") {
          const hidden = /^(?:hidden|button|submit|reset|image)$/i.test(attrs.type ?? "");
          const named = "aria-label" in attrs || "aria-labelledby" in attrs || (attrs.id !== undefined && labelled.has(attrs.id)) || stack.some((f) => f.label);
          if (!hidden && !named) out.unlabelled += 1;
        }
        if (tag === "a" && !parent.nav && !("data-sdd-nav" in attrs)) {
          const target = /^\.\/([a-z0-9][a-z0-9-]*)\.html/i.exec(attrs.href ?? "")?.[1];
          if (target) out.links.push(target);
        }
        if (tag === "img") out.images += 1;
        if (!inOverlays && (has("btn-primary") || has("badge-accent") || has("fab"))) out.accentMarkup += 1;
        if (tag === "tr" && parent.table) parent.table.rows += 1;
        if ((tag === "th" || tag === "td") && parent.table && parent.table.rows === 1) parent.table.columns += Math.max(1, Number(attrs.colspan ?? 1) || 1);
        const isStat = has("stat-num") || has("kpi-num") || has("figure") || has("ds-stat-value");
        const frame: Frame = {
          tag,
          overlays: inOverlays,
          main: inMain,
          isMain,
          nav: parent.nav || "data-sdd-nav" in attrs,
          toolbar: parent.toolbar || has("toolbar"),
          cards: parent.cards + (has("card") ? 1 : 0),
          label: parent.label || tag === "label",
          frame: isFrame && !isState ? { heading: false } : parent.frame,
          table: tag === "table" ? { columns: 0, rows: 0 } : parent.table,
          area,
          stat: isStat && !inOverlays ? { text: [] } : parent.stat,
        };
        stack.push(frame);
        if (VOID.has(tag)) {
          stack.pop();
          close(frame);
        }
      },
      ontext(text) {
        const top = stack[stack.length - 1]!;
        if (top.stat && top.tag !== "style") top.stat.text.push(text);
      },
      onclosetag(tag) {
        if (VOID.has(tag)) return;
        if (stack.length <= 1) return;
        close(stack.pop()!);
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.end(html);
  return out;
}

/** Every finding on an od screen's body; an empty list means it passed. */
/** A seed skeleton's fill-in slot, left as written. */
const SKELETON_SLOT = /\[(?:REPLACE[^\]]*|icon buttons|optional actions|NAVIGATION[^\]]*|INITIALS|BRAND|slug|id|Verb \+ object)\]/g;

export function lintOdScreen(html: string, opts: LintOptions = {}): UxLintFinding[] {
  const findings: UxLintFinding[] = [];
  const add = (rule: string, message: string) => findings.push(finding(rule, message));
  const css = authoredCss(html);
  const decls = cssDeclarations(css.replace(/@media[^{]*/gi, ""));
  const text = visibleText(html);
  const s = scanOd(html);

  // Completeness.
  if (opts.overlays && s.overlayFrames < opts.overlays) {
    add("missing-overlay", `The plan lists ${opts.overlays} overlay${opts.overlays === 1 ? "" : "s"} but ${s.overlayFrames} ${s.overlayFrames === 1 ? "is" : "are"} drawn — draw each as a <figure data-sdd-frame data-kind="dialog|sheet|confirm"> in <section data-sdd-overlays>.`);
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
  if (literal) add("raw-colour", `Writes a colour itself (${literal}); colours come only from the design tokens — var(--accent), var(--fg), var(--success), …`);
  if (opts.sample) {
    const unsourced = unsourcedValues(s.stats, opts.sample);
    if (unsourced.length) {
      add("unsourced-metric", `Stat numbers not in the shared example data: ${unsourced.slice(0, 4).map((v) => `"${v}"`).join(", ")} — show a number from the records or the declared aggregates, or leave the stat out.`);
    }
  }

  // Structure the platform and the canvas read.
  const missingMarkers = [!s.app && "data-sdd-app on the app root", !s.content && "<main data-screen-content>", opts.overlays && !s.overlaysSection && "<section data-sdd-overlays>"].filter(Boolean);
  if (missingMarkers.length) add("missing-marker", `Missing the seed's markers: ${missingMarkers.join(", ")} — keep the skeleton's structure.`);
  // Skeleton slots the model never filled ("[REPLACE screen title]", "[icon buttons]") read as broken UI.
  const leftovers = [...new Set([...text.matchAll(SKELETON_SLOT)].map((m) => m[0]))];
  if (leftovers.length) add("leftover-placeholder", `Skeleton slots left unfilled: ${leftovers.slice(0, 4).join(", ")} — replace each with real content from the plan, or remove it.`);
  if (opts.navExpected && s.nav === 0) add("nav-missing", "Has no navigation slot — copy the NAVIGATION markup you were given (the element with data-sdd-nav) into the skeleton.");
  if (opts.authScreen && s.nav > 0) add("auth-navigation", "This screen is outside the application shell; remove persistent navigation and use the focused seed.");
  if (opts.accountExpected && (!/\bdata-sdd-account\b/i.test(html) || !/\bdata-sdd-logout\b/i.test(html))) add("shell-utility-missing", "The approved shell requires the signed-in account and sign-out action; include data-sdd-account and data-sdd-logout on visible controls.");
  if (opts.searchExpected && !/\bdata-sdd-search\b/i.test(html)) add("shell-utility-missing", "The approved shell requires global search; include a visible labelled data-sdd-search control.");
  if (opts.notificationsExpected && !/\bdata-sdd-notifications\b/i.test(html)) add("shell-utility-missing", "The approved shell requires notifications; include a visible labelled data-sdd-notifications control.");
  if (opts.screenKeys?.length) {
    const known = new Set(opts.screenKeys);
    const broken = [...new Set(s.links.filter((k) => !known.has(k)))];
    if (broken.length) add("broken-link", `Links to screens that do not exist: ${broken.slice(0, 4).map((k) => `./${k}.html`).join(", ")} — link only to the screens of this reference.`);
  }

  // Design guidance (the kit's, read through the seed's classes).
  const emoji = actionEmoji(html);
  if (emoji) add("emoji-icon", `Uses an emoji ("${emoji}") as an action's icon; its meaning is unclear and it renders differently everywhere — use a Lucide icon (<i data-icon="…"></i>) or the label alone.`);
  if (FILLER.test(text)) add("filler-copy", "Contains filler copy (lorem ipsum, \"feature one\", \"sample content\"); use realistic content in the requirements' wording.");
  const fixed = decls.find(
    (d) => /^(?:min-)?width$|^flex-basis$|^grid-template-columns$/.test(d.prop) && [...d.value.matchAll(/(\d+(?:\.\d+)?)px/g)].some((n) => Number(n[1]) >= UX_BUDGETS.phoneWidthPx),
  );
  if (fixed) add("fixed-width", `Sets ${fixed.prop}: ${fixed.value.trim()} — wider than a phone; use the seed's layout classes (.grid, .split) instead of px widths.`);
  const crowded = s.primaryByArea.filter((n) => (n ?? 0) > UX_BUDGETS.primaryPerArea).length;
  if (crowded) add("competing-primaries", `${crowded === 1 ? "One area has" : `${crowded} areas have`} more than one .btn-primary; keep one primary per area and make the others .btn or .btn-ghost.`);
  const areasWithPrimary = s.primaryByArea.filter((n) => (n ?? 0) > 0).length;
  if (areasWithPrimary > 1) add("two-primaries", `${areasWithPrimary} areas of the main view each have a primary button; fine when they are parallel jobs, otherwise keep one.`);
  if (opts.nativePhone && s.webTables) {
    add("web-table-on-phone", `Has ${s.webTables === 1 ? "a table" : `${s.webTables} tables`} an Android phone shows as a web table; use a .list or cards, or give the table class "table-cards".`);
  }
  const wide = s.tableColumns.filter((n) => n > UX_BUDGETS.tableColumns);
  if (wide.length) add("table-columns", `Has a table of ${wide.join(" and ")} columns (recommended at most ${UX_BUDGETS.tableColumns}); move detail into the row's sheet.`);
  if (opts.screenType && LIST_LIKE.has(opts.screenType) && s.inlineFields > 3) {
    add("inline-form", `Draws a form of ${s.inlineFields} fields inline in a ${opts.screenType} view; a short form belongs in a dialog, a long one on its own form screen.`);
  }
  if (decls.some((d) => /^border-left(?:-width)?$/.test(d.prop) && LEFT_ACCENT.test(d.value))) {
    add("left-accent-card", "A thick left border marks a card or alert; check that what it means (a status, a selection) is also said in words.");
  }
  if (s.h1 === 0) add("missing-h1", "The screen has no <h1>; give it one clear main title.");
  if (s.h1 > 1) add("multiple-h1", `Has ${s.h1} <h1> headings outside the overlays; a screen has one.`);
  if (s.nestedCards > 0) add("nested-card", `Puts a .card inside a .card ${s.nestedCards} time${s.nestedCards === 1 ? "" : "s"}; check that the grouping is real — a section, a divider or space may say it more clearly.`);
  if (s.framesWithoutHeading > 0) add("overlay-no-heading", "An overlay or state frame has no heading or caption.");
  const names = (opts.sampleNames ?? []).map((n) => n.trim()).filter(Boolean);
  if (names.length && !names.some((n) => mentions(text, n))) {
    add("off-sheet-data", `Shows none of the shared example records (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}); use the same records as the other screens.`);
  }
  const unknown = unknownIcons(html);
  if (unknown.length) add("unknown-icon", `Icon name${unknown.length === 1 ? "" : "s"} not in Lucide: ${unknown.slice(0, 5).join(", ")} — drawn as a placeholder.`);

  // open-design's lint rules (warnings).
  const grads = gradients(css);
  if (grads.some((g) => isBlue(g) && isPurple(g))) add("trust-gradient", "A blue-to-purple gradient — the default \"trust\" look of AI-made UIs; use the design system's accent and surfaces.");
  else if (grads.some(isPurple)) add("purple-gradient", "A purple or violet gradient — an AI-default decoration; use the design system's accent and surfaces.");
  const accent = opts.accent?.toLowerCase() ?? null;
  const hexes = [...css.matchAll(HEX), ...[...html.matchAll(/\s(?:fill|stroke|stop-color)\s*=\s*"([^"]*)"/gi)].flatMap((m) => [...(m[1] ?? "").matchAll(HEX)])].map((m) => m[0].toLowerCase());
  const indigo = hexes.find((h) => INDIGO.has(h) && h !== accent);
  if (indigo || INDIGO_CLASS.test(html)) add("ai-default-indigo", `Uses ${indigo ?? "an indigo/violet utility class"} — the AI-default indigo, not this design system's accent; use var(--accent).`);
  const font = decls.find((d) => d.prop === "font-family" && !/var\(--font-/.test(d.value) && SANS_DISPLAY.test(d.value));
  if (font) add("sans-display", `Sets font-family: ${font.value.trim()} itself; type comes from the design system (var(--font-display) for headings, var(--font-body) for text).`);
  const known = opts.sample ? new Set(numberKeys([...opts.sample.records.map((r) => r.facts), opts.sample.notes, ...(opts.sample.aggregates ?? []).map((a) => a.value)].join(" "))) : new Set<string>();
  const claim = CLAIM.exec(text);
  if (claim && !numberKeys(claim[0]).every((k) => known.has(k))) add("invented-metric", `Claims "${claim[0].trim()}" — a figure the example data does not hold; say what the product does instead.`);
  const shouting = ruleBlocks(css).find((r) => /text-transform\s*:\s*uppercase/i.test(r.body) && !/letter-spacing\s*:/i.test(r.body));
  const inlineShouting = [...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].some((m) => /text-transform\s*:\s*uppercase/i.test(m[1] ?? "") && !/letter-spacing/i.test(m[1] ?? ""));
  if (shouting || inlineShouting) add("all-caps-no-tracking", `Sets text in capitals without letter-spacing${shouting ? ` (${shouting.selector})` : ""}; capitals need tracking (use .label, or letter-spacing: .06em).`);
  if (s.images > 0) add("external-image", `Has ${s.images === 1 ? "an image" : `${s.images} images`} the mockup cannot show (no remote images); draw a .ph-img placeholder naming the subject and ratio.`);
  if (hexes.length > HEX_BUDGET) add("raw-hex", `Writes ${hexes.length} raw hex colours (more than ${HEX_BUDGET}) — a palette of its own; colours come from the tokens.`);
  const accentUses = (css.match(/var\(\s*--accent\b/g) ?? []).length + s.accentMarkup;
  if (accentUses > ACCENT_BUDGET) add("accent-overuse", `Uses the accent ${accentUses} times (more than ${ACCENT_BUDGET}); keep it for the primary action and the one thing to notice.`);
  if (s.unanchored > 0) add("missing-section-anchor", `${s.unanchored} top-level section${s.unanchored === 1 ? " has" : "s have"} no data-od-id; give each section of the main view a short slug.`);
  return findings;
}

/** The required content of an od drawing, for the repair decision: key markers and frames. */
export function odRequiredContent(html: string): { markers: Set<number>; overlays: number } {
  const s = scanOd(html);
  return { markers: s.keyMarkers, overlays: s.overlayFrames + s.stateFrames };
}
