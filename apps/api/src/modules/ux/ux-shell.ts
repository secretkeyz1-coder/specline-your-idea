import { UX_BUDGETS, type DesignSystemSpec, type UxGenerator, type UxPlatform, type UxReference, type UxShell } from "@sdd/contracts";
import { Parser } from "htmlparser2";
import { screenStyleBlock } from "../design-system/render.js";
import { composeStylesOf, scopeComposeStyles } from "./ux-compose.js";
import { expandIcons, iconSvg, navIcon } from "./ux-icons.js";
import { assembleOdScreen, isOdDocument, odBody } from "./ux-od.js";

/**
 * The frame every UI-reference screen is drawn in. The platform builds the app
 * shell (brand, sidebar navigation, mobile menu) and adds the stylesheet; the
 * model writes only the page content inside <main>. When each screen drew its
 * own shell, brand names, navigation and user menus differed from screen to
 * screen, and none of them collapsed on a phone.
 */

/** Neutral screens use the same kit with a greyscale wireframe look. */
export const NEUTRAL_SPEC: DesignSystemSpec = {
  preset_id: "neutral-wireframe",
  name: "Neutral wireframe",
  summary: "Greyscale mid-fidelity wireframe: layout, elements, copy and flow — not a visual brand.",
  light: { bg: "#f7f7f7", surface: "#ffffff", surface2: "#f0f0f0", fg: "#1f1f1f", fgMuted: "#5c5c5c", border: "#d9d9d9", borderStrong: "#8c8c8c", accent: "#2b2b2b", accentFg: "#ffffff", success: "#4d4d4d", warn: "#4d4d4d", danger: "#3a3a3a", info: "#4d4d4d" },
  dark: { bg: "#121212", surface: "#1c1c1c", surface2: "#262626", fg: "#f2f2f2", fgMuted: "#a8a8a8", border: "#333333", borderStrong: "#707070", accent: "#e6e6e6", accentFg: "#121212", success: "#bdbdbd", warn: "#bdbdbd", danger: "#d6d6d6", info: "#bdbdbd" },
  fonts: {
    display: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  },
  radius: 6,
  density: "comfortable",
  depth: "hairline",
  border_width: 1,
  component_library: "none",
  guidance: "",
};

/** Marks the model's part of a stored screen, so it can be read back and re-framed. */
const CONTENT_ATTR = "data-screen-content";

/**
 * The mockup policy (the same one the canvas frames every mockup with, in
 * apps/web/src/lib/ux.ts): no scripts, no network. It is written into every
 * stored screen as well, so a file `sddctl ui pull` puts in a repository stays
 * inert when someone opens it in a browser.
 */
export const MOCKUP_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "A";

/**
 * The model's page content, whatever it wrapped around it: the inner HTML of
 * its <main>, or of <body>, or the text itself. A leading plan comment and any
 * sidebar it drew anyway are dropped; the shell is ours.
 */
export function extractScreenContent(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  const main = /<main\b[^>]*>([\s\S]*)<\/main\s*>/i.exec(t);
  if (main) t = main[1]!;
  else {
    const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(t);
    if (body) t = body[1]!;
  }
  // Only the tags of a whole document go here; <meta>, the document's <title>
  // and everything else not allowed are removed by the sanitizer, which reads
  // the HTML the way a browser does (an SVG chart keeps its <title>).
  return t
    .replace(/<!--\s*PLAN[\s\S]*?-->/gi, "")
    .replace(/<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, "")
    .trim();
}

/**
 * The page content of an answer that is still arriving, for the live preview:
 * what is inside <main> (or <body>, or the fence) so far, without a trailing
 * half-written tag or comment. Before the content starts it is empty. The
 * result still goes through the sanitizer like any drawing.
 */
export function partialScreenContent(text: string): string {
  let t = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
  const fence = /```(?:html)?[^\n]*\n?([\s\S]*?)(?:```|$)/i.exec(t);
  if (fence) t = fence[1]!;
  const main = /<main\b[^>]*>([\s\S]*?)(?:<\/main\s*>|$)/i.exec(t);
  if (main) t = main[1]!;
  else {
    const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(t);
    if (body) t = body[1]!;
    // A document whose body has not started yet: nothing to show.
    else if (/^\s*<(?:!doctype|html|head)\b/i.test(t)) return "";
  }
  return t
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<[^>]*$/, "")
    .replace(/<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, "")
    .trim();
}

/** SVG primitives stay unnumbered: the drawing is selected as a whole. */
const UNNUMBERED = new Set([
  "br", "wbr", "path", "line", "polyline", "polygon", "circle", "ellipse", "rect", "g", "text", "tspan", "defs",
  "lineargradient", "radialgradient", "stop", "marker", "use", "clippath", "mask", "title", "desc", "option", "style",
]);

const NID = /^n(\d+)$/;

/** One element of page content as the tokenizer found it: where its start tag sits, and its data-nid attribute. */
interface Tag {
  name: string;
  /** Start tag: [start, end) in the source. */
  start: number;
  end: number;
  nid: string | null;
  /** The data-nid attribute's own span, when it has one. */
  nidAttr: { start: number; end: number } | null;
}

/**
 * Walk the start tags and elements of page content with a real HTML
 * tokenizer, so `>` inside an attribute, an optional end tag (`<li>One<li>Two`)
 * or a comment holding `</div>` cannot shift anything. `onElement` gets each
 * element with the end of its content (explicit end tag included).
 */
function walkTags(html: string, on: { tag?: (t: Tag) => void; element?: (t: Tag, end: number) => void }): void {
  const stack: Tag[] = [];
  let nidAttr: Tag["nidAttr"] = null;
  const parser = new Parser(
    {
      onattribute(name) {
        if (name === "data-nid") nidAttr = { start: parser.startIndex, end: parser.endIndex };
      },
      onopentag(name, attrs, implied) {
        // An implied start tag (a stray </p>) has no text of its own to number.
        const tag: Tag = implied
          ? { name, start: parser.startIndex, end: parser.startIndex, nid: null, nidAttr: null }
          : { name, start: parser.startIndex, end: parser.endIndex + 1, nid: attrs["data-nid"] ?? null, nidAttr };
        nidAttr = null;
        stack.push(tag);
        if (!implied) on.tag?.(tag);
      },
      onclosetag(_name, implied) {
        const tag = stack.pop();
        if (!tag || !on.element) return;
        // An explicit end tag ends the element after it; an implied one ends it
        // where the tag that closed it starts — or, for a void or self-closed
        // element, right after its own start tag.
        const end = !implied ? parser.endIndex + 1 : parser.startIndex === tag.start ? tag.end : parser.startIndex;
        on.element(tag, end);
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.end(html);
}

/**
 * Give every element of the page content a stable `data-nid` ("n1", "n2", …)
 * so the canvas can select it, comments can pin to it and edits can find it
 * again. Deterministic: content without ids is numbered in document order, so
 * numbering the same content twice gives the same ids; existing ids are kept
 * and new elements continue after the highest one. A duplicated id (a part
 * copied by the model) stays on its first element; later ones get new ids.
 * The source text is kept as it is apart from the inserted attributes.
 */
export function ensureNodeIds(content: string): string {
  const tags: Tag[] = [];
  walkTags(content, { tag: (t) => tags.push(t) });
  let next = Math.max(0, ...tags.map((t) => Number(NID.exec(t.nid ?? "")?.[1] ?? 0))) + 1;
  const seen = new Set<string>();
  let out = "";
  let at = 0;
  for (const t of tags) {
    if (UNNUMBERED.has(t.name)) continue;
    if (t.nid && NID.test(t.nid) && !seen.has(t.nid)) {
      seen.add(t.nid);
      continue;
    }
    const id = `n${next++}`;
    seen.add(id);
    if (t.nidAttr) {
      // A duplicate or malformed id: replace the attribute in place.
      out += content.slice(at, t.nidAttr.start) + `data-nid="${id}"`;
      at = t.nidAttr.end;
      continue;
    }
    const source = content.slice(t.start, t.end);
    const selfClose = /\/\s*>$/.test(source);
    const cut = t.start + (selfClose ? source.lastIndexOf("/") : source.length - 1);
    out += content.slice(at, cut).replace(/\s+$/, "") + ` data-nid="${id}"${selfClose ? " /" : ""}>`;
    at = t.end;
  }
  return out + content.slice(at);
}

/**
 * The text of every numbered element of page content, in document order —
 * the way the canvas reads an element (textContent, whitespace collapsed), so
 * a comment's anchor text can find its element again after a redraw.
 */
export function nodeTexts(content: string): Array<{ nid: string; text: string }> {
  const out: Array<{ nid: string; text: string }> = [];
  const texts: string[] = [];
  // Open elements: their slot in `out` (document order) and where their text starts.
  const open: Array<{ slot: number; from: number; raw: boolean }> = [];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const nid = attrs["data-nid"];
        const slot = nid && NID.test(nid) ? out.push({ nid, text: "" }) - 1 : -1;
        open.push({ slot, from: texts.length, raw: name === "style" || name === "script" });
      },
      ontext(text) {
        // Style text is not what a person reads on the element.
        if (!open.some((o) => o.raw)) texts.push(text);
      },
      onclosetag() {
        const el = open.pop();
        if (el && el.slot >= 0) out[el.slot]!.text = texts.slice(el.from).join("").replace(/\s+/g, " ").trim();
      },
    },
    { decodeEntities: true, recognizeSelfClosing: true },
  );
  parser.end(content);
  return out;
}

/** Put every table in a horizontal scroll wrapper unless the model already did. */
export function wrapTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table\s*>/gi, (table, offset: number) => {
    const before = html.slice(Math.max(0, offset - 120), offset);
    return /class="[^"]*\bds-table-wrap\b[^"]*"[^<]*>\s*$/.test(before) ? table : `<div class="ds-table-wrap">${table}</div>`;
  });
}

/**
 * The model's content of a stored screen: the inside of <main> for a kit
 * screen, the whole body for an od screen; a legacy whole-document screen is
 * returned as it is.
 */
export function screenContent(storedHtml: string): string {
  if (isOdDocument(storedHtml)) return odBody(storedHtml);
  const marked = new RegExp(`<main\\b[^>]*${CONTENT_ATTR}[^>]*>([\\s\\S]*)</main\\s*>`, "i").exec(storedHtml);
  return marked ? marked[1]!.trim() : storedHtml;
}

/**
 * A framed screen with element ids, for reading: screens stored before ids
 * existed are numbered on the fly, the same way a later save will number them.
 */
export function withNodeIds(storedHtml: string): string {
  if (!isFramed(storedHtml) || storedHtml.includes("data-nid=")) return storedHtml;
  const content = screenContent(storedHtml);
  // Spliced by position: a string replacement would read `$&` or `$'` in the
  // content (a price written "US$&amp;nbsp;5") as a replacement pattern.
  const at = storedHtml.indexOf(content);
  if (at === -1) return storedHtml;
  return storedHtml.slice(0, at) + ensureNodeIds(content) + storedHtml.slice(at + content.length);
}

/** Whether a stored screen was framed by the platform (and can be re-framed). */
export function isFramed(storedHtml: string): boolean {
  return storedHtml.includes(CONTENT_ATTR) || isOdDocument(storedHtml);
}

/**
 * SVG sizes a browser rejects: models write width/height="auto" on inline
 * charts. CSS already sizes them (max-width:100%, height:auto), so drop them.
 */
export function tidySvg(html: string): string {
  return html.replace(/<svg\b[^>]*>/gi, (tag) => tag.replace(/\s(?:width|height)\s*=\s*["']?auto["']?/gi, ""));
}

/**
 * A variant class without its base ("ds-btn-primary" alone) renders as a bare
 * element — the base is added. The model does this often enough to matter.
 */
const BASES: Array<[string, RegExp]> = [
  ["ds-btn", /^ds-btn-(?:primary|ghost|danger|sm|icon)$/],
  ["ds-badge", /^ds-badge-(?:success|warn|danger|info|accent|outline|dot)$/],
  ["ds-alert", /^ds-alert-(?:success|warn|danger|info)$/],
];
export function completeKitClasses(html: string): string {
  return html.replace(/(\sclass\s*=\s*")([^"]*)(")/gi, (m, pre: string, value: string, post: string) => {
    const tokens = value.split(/\s+/).filter(Boolean);
    const add = BASES.filter(([base, variant]) => !tokens.includes(base) && tokens.some((t) => variant.test(t))).map(([base]) => base);
    return add.length ? `${pre}${[...add, ...tokens].join(" ")}${post}` : m;
  });
}

/**
 * Put every inline chart (an SVG that is not an icon) in a ds-chart wrapper:
 * on a phone it scrolls sideways instead of shrinking its labels to nothing.
 */
export function wrapCharts(html: string): string {
  // Icons and sparklines are sized by the kit; only charts get the wrapper.
  return html.replace(/<svg\b(?![^>]*\b(?:ds-icon|ds-spark)\b)[^>]*>[\s\S]*?<\/svg\s*>/gi, (svg, offset: number) => {
    const before = html.slice(Math.max(0, offset - 160), offset);
    return /class="[^"]*\bds-chart\b[^"]*"[^<]*>\s*$/.test(before) ? svg : `<div class="ds-chart">${svg}</div>`;
  });
}

/** Facts a phone card shows under its title; the rest of a row's columns are hidden there. */
const PHONE_CARD_FACTS = UX_BUDGETS.phoneCardFacts;

const CELL_START = /<(t[hd])\b([^>]*)>/gi;
const hasClass = (attrs: string, cls: string) => new RegExp(`\\sclass\\s*=\\s*"[^"]*\\b${cls}\\b`, "i").test(` ${attrs}`);
const addClass = (tag: string, cls: string) =>
  /\sclass\s*=\s*"/i.test(tag) ? tag.replace(/(\sclass\s*=\s*")/i, `$1${cls} `) : tag.replace(/^<(t[hd])\b/i, `<$1 class="${cls}"`);

/**
 * A ds-table-cards table whose rows carry more than PHONE_CARD_FACTS facts
 * (besides the title column, the row checkbox and the actions) and that the
 * model did not trim with ds-hide-sm: the platform hides the extra columns on
 * phones — from the last one back, keeping status columns (those with a
 * badge). The prompt asks for this; models rarely do it, and a phone card of
 * seven facts made a 12-row table several screens long.
 */
export function trimPhoneCards(html: string): string {
  return html.replace(/<table\b[^>]*\bds-table-cards\b[^>]*>[\s\S]*?<\/table\s*>/gi, (table) => {
    if (table.includes("ds-hide-sm")) return table;
    const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)].map((m) => m[0]);
    const cellsOf = (row: string) => [...row.matchAll(CELL_START)].map((m) => ({ tag: m[0], attrs: m[2] ?? "", index: m.index! }));
    const header = rows[0] ? cellsOf(rows[0]) : [];
    const firstBody = rows.find((r) => /<td\b/i.test(r));
    if (!header.length || !firstBody) return table;
    const bodyCells = cellsOf(firstBody);
    const width = header.length;
    const content = (row: string, i: number, cells: Array<{ index: number }>) => row.slice(cells[i]!.index, cells[i + 1]?.index ?? row.length);
    // Columns that are facts: not the checkbox, not the actions, not the title (the first remaining one).
    const facts: number[] = [];
    for (let i = 0; i < width; i++) {
      const skip = [header[i]!.attrs, bodyCells[i]?.attrs ?? ""].some((a) => hasClass(a, "ds-check") || hasClass(a, "ds-actions"));
      if (!skip) facts.push(i);
    }
    facts.shift();
    if (facts.length <= PHONE_CARD_FACTS) return table;
    const isStatus = (i: number) => bodyCells.length === width && /\bds-badge\b/.test(content(firstBody, i, bodyCells));
    const hide = new Set<number>();
    for (const i of [...facts].reverse().filter((i) => !isStatus(i)).concat([...facts].reverse().filter(isStatus))) {
      if (facts.length - hide.size <= PHONE_CARD_FACTS) break;
      hide.add(i);
    }
    return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, (row) => {
      const cells = cellsOf(row);
      if (cells.length !== width) return row;
      let out = "";
      let at = 0;
      cells.forEach((c, i) => {
        out += row.slice(at, c.index) + (hide.has(i) ? addClass(c.tag, "ds-hide-sm") : c.tag);
        at = c.index + c.tag.length;
      });
      return out + row.slice(at);
    });
  });
}

const PHONE_MODES = ["priority", "expand", "card", "scroll"] as const;
type PhoneMode = (typeof PHONE_MODES)[number];
const cellText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The table's start tag with the classes of its phone treatment, and no other treatment's. */
function phoneTableTag(open: string, mode: PhoneMode): string {
  const want = mode === "card" ? "ds-table-cards" : `ds-table-${mode}`;
  const drop = ["ds-table-cards", "ds-table-priority", "ds-table-expand", "ds-table-scroll"].filter((c) => c !== want);
  const m = /\sclass\s*=\s*"([^"]*)"/i.exec(open);
  const classes = (m?.[1] ?? "").split(/\s+/).filter((c) => c && !drop.includes(c));
  if (!classes.includes(want)) classes.push(want);
  return m ? open.replace(m[0], ` class="${classes.join(" ")}"`) : open.replace(/^<table\b/i, `<table class="${classes.join(" ")}"`);
}

/**
 * The phone treatment the screen chose for a table (aturan.md §4, Lapis 3),
 * by its task — data-phone on the <table>:
 * - priority: only the columns whose <th> carries data-priority show on a
 *   phone (the first column and the row actions always do);
 * - expand: the same, and the row reads as one that opens for the rest;
 * - card: every row becomes a card (the kit's ds-table-cards), labelled from
 *   the header when the cells carry no data-label;
 * - scroll: the table stays a table and scrolls sideways in its wrapper, the
 *   first column held in place — for comparing numbers across columns.
 * A table without data-phone keeps the default (ds-table-cards when the model
 * asked for it, trimmed by trimPhoneCards).
 */
export function phoneTables(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi, (table) => {
    const open = /^<table\b[^>]*>/i.exec(table)![0];
    const mode = /\sdata-phone\s*=\s*["']?([a-z]+)/i.exec(open)?.[1]?.toLowerCase() as PhoneMode | undefined;
    if (!mode || !PHONE_MODES.includes(mode)) return table;
    let out = phoneTableTag(open, mode) + table.slice(open.length);
    if (mode === "scroll") return out;
    const rows = [...out.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)].map((m) => m[0]);
    const cellsOf = (row: string) => [...row.matchAll(CELL_START)].map((m) => ({ tag: m[0], attrs: m[2] ?? "", index: m.index! }));
    const header = rows[0] ? cellsOf(rows[0]) : [];
    if (!header.length) return out;
    const width = header.length;
    const headerRow = rows[0]!;
    const labels = header.map((_, i) => cellText(headerRow.slice(header[i]!.index, header[i + 1]?.index ?? headerRow.length)));
    const keep = new Set<number>();
    if (mode === "priority" || mode === "expand") {
      const marked = header.map((h, i) => (/\sdata-priority\b/i.test(h.tag) ? i : -1)).filter((i) => i >= 0);
      // Unmarked: the first three data columns stay.
      for (const i of marked.length ? marked : [0, 1, 2]) keep.add(i);
      const firstData = header.findIndex((h) => !hasClass(h.attrs, "ds-check"));
      keep.add(firstData);
    }
    out = out.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, (row) => {
      const cells = cellsOf(row);
      if (cells.length !== width) return row;
      let next = "";
      let at = 0;
      cells.forEach((c, i) => {
        let tag = c.tag;
        if (mode === "card") {
          if (/^<td\b/i.test(tag) && !/\sdata-label\s*=/i.test(tag) && labels[i]) tag = tag.replace(/^<td\b/i, `<td data-label="${escAttr(labels[i]!)}"`);
        } else if (!keep.has(i) && !hasClass(c.attrs, "ds-check") && !hasClass(c.attrs, "ds-actions") && !hasClass(c.attrs, "ds-hide-sm")) {
          tag = addClass(tag, "ds-hide-sm");
        }
        next += row.slice(at, c.index) + tag;
        at = c.index + c.tag.length;
      });
      return next + row.slice(at);
    });
    return out;
  });
}

/** Everything the platform tidies in page content before framing it (idempotent). */
export function tidyContent(html: string): string {
  return trimPhoneCards(phoneTables(wrapCharts(tidySvg(completeKitClasses(scopeComposeStyles(html))))));
}

/** The shell's few words, in the language the screen is written in (English unless it reads as Indonesian). */
const SHELL_WORDS = {
  en: { workspace: "Workspace", search: "Search…", notifications: "Notifications", menu: "Open navigation", toggle: "Toggle sidebar", more: "More", account: "Account" },
  id: { workspace: "Ruang kerja", search: "Cari…", notifications: "Notifikasi", menu: "Buka navigasi", toggle: "Buka/tutup sidebar", more: "Lainnya", account: "Akun" },
};

function shellWords(content: string) {
  const text = content.replace(/<[^>]*>/g, " ").toLowerCase();
  const count = (words: string[]) => words.reduce((n, w) => n + (text.match(new RegExp(`\\b${w}\\b`, "g"))?.length ?? 0), 0);
  return count(["dan", "yang", "untuk", "dengan", "tidak", "ini", "belum", "sudah", "tambah", "simpan"]) >
    count(["the", "and", "for", "with", "not", "this", "your", "add", "save", "of"])
    ? SHELL_WORDS.id
    : SHELL_WORDS.en;
}

type ShellScreen = { key: string; name: string; screen_type?: string | null };

/**
 * A complete, self-contained screen: stylesheet, shell with this screen
 * current, and the content (icons drawn). The shell follows the shadcn/ui
 * application pattern — sidebar with workspace switcher and icon navigation, a
 * header with the sidebar trigger and breadcrumb — whatever the library, so
 * every screen has the same frame.
 *
 * The utilities around it (search, notifications, the signed-in user) are
 * drawn only when the plan says the requirements ask for them (`shell`); a
 * reference planned before the plan said so keeps the full shell it was drawn with.
 *
 * How it navigates follows the plan's `shell.layout` (aturan.md §4): the side
 * navigation (the default, and every older plan), a top navigation for a few
 * main destinations, or a minimal bar for one focused job. All three keep the
 * same content slot, node ids and ./<key>.html links.
 */
export function assembleScreen(input: {
  content: string;
  spec: DesignSystemSpec;
  brand: string;
  screens: ShellScreen[];
  currentKey: string;
  shell?: UxShell | null;
  /** Web (the default, and every reference made before platforms) or a native mobile app. */
  platform?: UxPlatform | null;
  /** How the reference's screens are drawn: the kit (absent) or open-design style (ux-od.ts). */
  generator?: UxGenerator | null;
}): string {
  if (input.generator === "od") return assembleOdScreen(input);
  if (input.platform?.kind === "native-mobile") return assembleNativeScreen(input);
  const words = shellWords(input.content);
  const utilities = input.shell ?? { search: true, notifications: true, account: true };
  const current = input.screens.find((s) => s.key === input.currentKey);
  const link = (s: ShellScreen) =>
    `<a href="./${esc(s.key)}.html"${s.key === input.currentKey ? ' aria-current="page"' : ""}>${iconSvg(navIcon(s))}<span>${esc(s.name)}</span></a>`;
  // Settings sit apart, at the foot of the sidebar, as in most product UIs.
  const main = input.screens.filter((s) => s.screen_type !== "settings").map(link).join("\n        ");
  const secondary = input.screens.filter((s) => s.screen_type === "settings").map(link).join("\n        ");
  const home = `./${esc(input.screens[0]?.key ?? input.currentKey)}.html`;
  const team = `<a class="ds-team" href="${home}"><span class="ds-brand-mark" aria-hidden="true">${esc(initials(input.brand))}</span>`
    + `<span class="ds-team-text"><span class="ds-brand">${esc(input.brand)}</span><span class="ds-team-sub">${words.workspace}</span></span>`
    + `${iconSvg("chevrons-up-down", { class: "ds-team-caret" })}</a>`;
  const nav = `<nav class="ds-side-nav" aria-label="Screens">
        ${main}
      </nav>${secondary ? `\n      <nav class="ds-side-nav ds-side-nav-secondary" aria-label="Settings">\n        ${secondary}\n      </nav>` : ""}`;
  // Tidied here, so screens stored before a tidy rule existed get it on read; new wrappers get ids.
  const tidy = tidyContent(expandIcons(input.content));
  const content = tidy.includes("data-nid=") ? ensureNodeIds(tidy) : tidy;
  // The page's composition CSS also goes in the head: overlay artboards are built from the head and one frame.
  const compose = composeStylesOf(content);
  const head = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${MOCKUP_CSP}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(current?.name ?? "Screen")} — ${esc(input.brand)}</title>
${screenStyleBlock(input.spec)}${compose ? `\n<style data-compose-head>\n${compose}\n</style>` : ""}
</head>
<body>`;
  const slot = `    <main class="ds-main" ${CONTENT_ATTR}>
${content}
    </main>`;
  const search = utilities.search ? `      <span class="ds-header-search">${iconSvg("search")}<span>${words.search}</span><kbd>⌘K</kbd></span>\n` : "";
  const bell = utilities.notifications
    ? `      <span class="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm ds-header-bell" aria-label="${words.notifications}">${iconSvg("bell")}<span class="ds-dot" aria-hidden="true"></span></span>\n`
    : "";
  const avatar = utilities.account ? `      <span class="ds-avatar ds-avatar-sm ds-header-avatar" aria-label="${words.account}">AM</span>\n` : "";
  const mobileMenu = `      <details class="ds-mobile-menu">
        <summary class="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm" aria-label="${words.menu}">${iconSvg("menu")}</summary>
        <div class="ds-mobile-sheet">
          <div class="ds-sidebar-head">${team}</div>
          ${nav}
        </div>
      </details>`;
  const layout = input.shell?.layout ?? "sidebar";

  // A few main destinations: brand and the destinations across the top; below 768px the same menu sheet.
  if (layout === "topnav") {
    const across = input.screens.map(link).join("\n        ");
    return `${head}
<div class="ds-app ds-app-top">
  <div class="ds-inset">
    <header class="ds-app-header">
${mobileMenu}
      ${team}
      <nav class="ds-top-nav" aria-label="Screens">
        ${across}
      </nav>
      <span class="ds-spacer"></span>
${search}${bell}${avatar}    </header>
${slot}
  </div>
</div>
</body>
</html>`;
  }

  // One focused job: the brand and where you are, no persistent navigation (content links still lead on).
  if (layout === "minimal") {
    return `${head}
<div class="ds-app ds-app-minimal">
  <div class="ds-inset">
    <header class="ds-app-header">
      ${team}
      <span class="ds-header-sep" aria-hidden="true"></span>
      <span class="ds-header-title" aria-current="page">${esc(current?.name ?? "")}</span>
      <span class="ds-spacer"></span>
${search}${bell}${avatar}    </header>
${slot}
  </div>
</div>
</body>
</html>`;
  }

  return `${head}
<div class="ds-app">
  <aside class="ds-sidebar" aria-label="Main navigation">
    <div class="ds-sidebar-head">${team}</div>
    <div class="ds-sidebar-body">
      ${nav}
    </div>
${utilities.account ? `    <div class="ds-sidebar-foot"><span class="ds-avatar ds-avatar-sm" aria-hidden="true">AM</span><span class="ds-user"><span class="ds-user-name">Alex Morgan</span><span class="ds-user-sub">alex@example.com</span></span>${iconSvg("chevrons-up-down", { class: "ds-team-caret" })}</div>
` : ""}  </aside>
  <div class="ds-inset">
    <header class="ds-app-header">
${mobileMenu}
      <span class="ds-btn ds-btn-ghost ds-btn-icon ds-btn-sm ds-header-trigger" aria-label="${words.toggle}">${iconSvg("panel-left")}</span>
      <span class="ds-header-sep" aria-hidden="true"></span>
      <nav class="ds-header-crumb" aria-label="Breadcrumb"><span class="ds-header-brand">${esc(input.brand)}</span>${iconSvg("chevron-right")}<span aria-current="page">${esc(current?.name ?? "")}</span></nav>
      <span class="ds-spacer"></span>
${search}${bell}    </header>
${slot}
  </div>
</div>
</body>
</html>`;
}

/** Material 3 destinations a bottom navigation bar shows; more screens put the rest under "More". */
const BOTTOM_NAV_MAX = 5;

/**
 * A native mobile (Android, Material 3) screen: a status bar, a top app bar
 * with the screen's name, and the navigation between the plan's screens — a
 * bottom navigation bar below 600px, a navigation rail from 600px — around
 * the same <main> content slot as the web shell. One HTML serves phone and
 * tablet (the kit switches them with a media query); links between screens
 * stay ./<key>.html, so the prototype player works as on the web.
 */
function assembleNativeScreen(input: {
  content: string;
  spec: DesignSystemSpec;
  brand: string;
  screens: ShellScreen[];
  currentKey: string;
  shell?: UxShell | null;
}): string {
  const words = shellWords(input.content);
  const utilities = input.shell ?? { search: false, notifications: false, account: false };
  const current = input.screens.find((s) => s.key === input.currentKey);
  const destination = (s: ShellScreen) =>
    `<a href="./${esc(s.key)}.html"${s.key === input.currentKey ? ' aria-current="page"' : ""}><span class="ds-nav-pill">${iconSvg(navIcon(s))}</span><span>${esc(s.name)}</span></a>`;
  // Settings go last, as in most apps.
  const ordered = [...input.screens.filter((s) => s.screen_type !== "settings"), ...input.screens.filter((s) => s.screen_type === "settings")];
  // A bottom bar holds five: four and "More" when there are more (the current screen always shows).
  let bottom = ordered;
  if (ordered.length > BOTTOM_NAV_MAX) {
    const firstFour = ordered.slice(0, BOTTOM_NAV_MAX - 1);
    bottom = firstFour.some((s) => s.key === input.currentKey) || !current ? firstFour : [...ordered.slice(0, BOTTOM_NAV_MAX - 2), current];
  }
  const more = ordered.length > BOTTOM_NAV_MAX ? `<span class="ds-nav-more"><span class="ds-nav-pill">${iconSvg("ellipsis")}</span><span>${words.more}</span></span>` : "";
  const actions = [
    utilities.search ? `<span class="ds-btn ds-btn-ghost ds-btn-icon" aria-label="${words.search}">${iconSvg("search")}</span>` : "",
    utilities.notifications ? `<span class="ds-btn ds-btn-ghost ds-btn-icon" aria-label="${words.notifications}">${iconSvg("bell")}</span>` : "",
    utilities.account ? `<span class="ds-btn ds-btn-ghost ds-btn-icon" aria-label="${words.account}">${iconSvg("circle-user")}</span>` : "",
  ].filter(Boolean).join("\n        ");
  const tidy = tidyContent(expandIcons(input.content));
  const content = tidy.includes("data-nid=") ? ensureNodeIds(tidy) : tidy;
  const compose = composeStylesOf(content);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${MOCKUP_CSP}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(current?.name ?? "Screen")} — ${esc(input.brand)}</title>
${screenStyleBlock(input.spec)}${compose ? `
<style data-compose-head>
${compose}
</style>` : ""}
</head>
<body>
<div class="ds-app ds-native" data-platform="android">
  <div class="ds-status-bar" aria-hidden="true"><span>9:41</span><span class="ds-status-icons">${iconSvg("signal")}${iconSvg("wifi")}${iconSvg("battery-full")}</span></div>
  <nav class="ds-nav-rail" aria-label="Screens">
    ${ordered.map(destination).join("\n    ")}
  </nav>
  <div class="ds-inset">
    <header class="ds-top-app-bar">
      <span class="ds-btn ds-btn-ghost ds-btn-icon" aria-label="${words.menu}">${iconSvg("menu")}</span>
      <span class="ds-top-app-bar-title">${esc(current?.name ?? "")}</span>
${actions ? `      ${actions}
` : ""}    </header>
    <main class="ds-main" ${CONTENT_ATTR}>
${content}
    </main>
  </div>
  <nav class="ds-bottom-nav" aria-label="Screens">
    ${bottom.map(destination).join("\n    ")}${more ? `
    ${more}` : ""}
  </nav>
</div>
</body>
</html>`;
}

/**
 * Re-frame every platform-framed screen of a reference: after a screen is
 * added or removed, the navigation of the others must list the new set.
 * Legacy whole-document screens are left alone.
 */
export function reframeScreens(reference: UxReference, spec: DesignSystemSpec | ((key: string) => DesignSystemSpec), brand: string): UxReference {
  const screens = reference.screens.map((s) => ({ key: s.key, name: s.name, screen_type: s.screen_type }));
  return {
    ...reference,
    screens: reference.screens.map((s) =>
      s.html && isFramed(s.html)
        ? { ...s, html: assembleScreen({ content: screenContent(s.html), spec: typeof spec === "function" ? spec(s.key) : spec, brand, screens, currentKey: s.key, shell: reference.shell, platform: reference.platform, generator: reference.generator }) }
        : s,
    ),
  };
}

/**
 * Where the element with this data-nid sits in the page content: from its
 * start tag to the end of the element as a browser reads it (its end tag, or
 * where an optional end tag is implied), or null. The first element with the
 * id wins, as in ensureNodeIds.
 */
export function findElement(html: string, nid: string): { start: number; end: number; tag: string } | null {
  if (!NID.test(nid)) return null;
  let found: { start: number; end: number; tag: string } | null = null;
  walkTags(html, {
    element: (t, end) => {
      if (t.nid === nid && (!found || t.start < found.start)) found = { start: t.start, end, tag: t.name };
    },
  });
  return found;
}

/** The model's replacement for one part: its HTML only; null when it returned a whole page instead. */
export function extractFragment(text: string): string | null {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:html)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1]!.trim();
  if (/<(?:main|html|body|head)\b|data-screen-content|<!doctype/i.test(t)) return null;
  const first = t.indexOf("<");
  return first === -1 ? null : t.slice(first).trim();
}
