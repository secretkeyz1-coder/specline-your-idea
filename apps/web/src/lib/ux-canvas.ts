/**
 * DOM helpers for the UI-reference canvas. Screens are rendered in iframes with
 * sandbox="allow-same-origin" (no allow-scripts): nothing inside a mockup can
 * run, but the page can read the mockup's DOM to outline, select and edit its
 * elements. Every helper here works on a mockup's document or element.
 */

/** Classes and attributes the canvas adds to a mockup; stripped before saving. */
export const CANVAS_CLASSES = ["sdd-hover", "sdd-selected", "sdd-linked"] as const;

/**
 * Markers every open-design ("od") screen carries (mirrors UX_OD_MARKERS in
 * @sdd/contracts): the canvas finds the app root, the content, the overlay
 * frames and the shared navigation by these, never by a seed's class names.
 */
export const UX_OD_MARKERS = {
  app: "data-sdd-app",
  content: "data-screen-content",
  overlays: "data-sdd-overlays",
  frame: "data-sdd-frame",
  nav: "data-sdd-nav",
} as const;

/** Whether a reference's screens are open-design documents (absent generator = the kit). */
export const isOd = (ref: { generator?: string } | null | undefined): boolean => ref?.generator === "od";

/** Selectors matching a part in either kind of screen: kit classes or od markers. */
export const PART = {
  app: `.ds-app, [${UX_OD_MARKERS.app}]`,
  overlays: `.ds-overlays, [${UX_OD_MARKERS.overlays}]`,
  frame: `.ds-frame, [${UX_OD_MARKERS.frame}]`,
  frames: `.ds-overlays .ds-frame, [${UX_OD_MARKERS.overlays}] [${UX_OD_MARKERS.frame}]`,
  /** The page content: kit <main data-screen-content>, or the od content region. */
  content: `[${UX_OD_MARKERS.content}]`,
  /** Navigation drawn by the platform (kit shell) or copied from the platform's markup (od): not the screen's own design. */
  shell: `.ds-sidebar, .ds-app-header, .ds-mobilebar, [${UX_OD_MARKERS.nav}]`,
} as const;

/** Injected into every mockup: selection outlines, pins, and hiding the overlays section. */
export function canvasStyle(opts: { hideOverlays: boolean }): string {
  return [
    `.sdd-hover{outline:2px solid #3b82f6 !important;outline-offset:-2px !important}`,
    `.sdd-selected{outline:2px solid #2563eb !important;outline-offset:-2px !important;box-shadow:0 0 0 4px rgba(37,99,235,.18) !important}`,
    `[contenteditable="true"]{outline:2px dashed #2563eb !important;outline-offset:2px !important;cursor:text !important}`,
    `.sdd-pin{position:absolute;z-index:2147483000;display:flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px 11px 11px 2px;background:#f59e0b;color:#111;font:600 12px/1 system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none}`,
    `.sdd-pin-resolved{background:#a3a3a3}`,
    opts.hideOverlays ? `.ds-overlays,[${UX_OD_MARKERS.overlays}]{display:none !important}` : "",
    // The artboard is the viewport: pin what the page sizes by the viewport
    // (100dvh) to the frame height, so the page can be measured as it is.
    `.ds-app,[${UX_OD_MARKERS.app}]{min-height:var(--sdd-frame-h,100dvh) !important}`,
    `.ds-sidebar{height:auto !important}`,
    `[data-overlay]>.ds-stage{min-height:var(--sdd-frame-h,100vh) !important}`,
    // Links and summaries must not navigate or toggle inside the canvas.
    `a,summary{cursor:default}`,
  ].join("\n");
}

// Preview-only inline overrides. Saving restores the author's viewport units.
const viewportStyles = new WeakMap<Element, Map<string, { value: string; pinned: string; priority: string }>>();

/** Keep viewport lengths tied to the device preset, even as the artboard grows.
 * CSSOM edits leave <style> source text intact; no layout constraints are added.
 */
export function pinViewportHeight(doc: Document, height: number): void {
  doc.documentElement.style.setProperty("--sdd-frame-h", `${height}px`);
  const pin = (style: CSSStyleDeclaration, el?: Element) => {
    for (const property of Array.from(style)) {
      const value = style.getPropertyValue(property);
      // Skip strings, comments and URLs: e.g. content:"100vh" is not a length.
      const pinned = value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|url\([^)]*\)|(?<![\w.-])(-?(?:\d*\.\d+|\d+))(?:d|s|l)?vh\b/gi,
        (token, amount: string | undefined) => amount === undefined ? token : `calc(var(--sdd-frame-h) * ${Number(amount) / 100})`);
      if (pinned === value) continue;
      const priority = style.getPropertyPriority(property);
      style.setProperty(property, pinned, priority);
      if (el) {
        let originals = viewportStyles.get(el);
        if (!originals) viewportStyles.set(el, originals = new Map());
        originals.set(property, { value, pinned: style.getPropertyValue(property), priority });
      }
    }
  };
  const rules = (list: CSSRuleList) => {
    for (const rule of Array.from(list)) {
      if ("style" in rule) pin((rule as CSSStyleRule).style);
      if ("cssRules" in rule) rules((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    // Only local styles are readable; remote styles remain governed by the CSP.
    if (!sheet.href) rules(sheet.cssRules);
  }
  for (const el of doc.querySelectorAll<HTMLElement | SVGElement>("[style]")) pin(el.style, el);
}

/** What a UI role is called, and which library component it maps to. */
const ROLES: Array<{ cls: string; name: string; component?: string }> = [
  { cls: "ds-page-header", name: "Page header" },
  { cls: "ds-page-actions", name: "Page actions" },
  { cls: "ds-page-desc", name: "Description" },
  { cls: "ds-toolbar-end", name: "Filter actions" },
  { cls: "ds-stat-label", name: "Stat label" },
  { cls: "ds-stat-value", name: "Stat value" },
  { cls: "ds-stat-meta", name: "Stat note" },
  { cls: "ds-card-title", name: "Card title" },
  { cls: "ds-card-desc", name: "Card description" },
  { cls: "ds-modal-desc", name: "Dialog description" },
  { cls: "ds-label", name: "Label" },
  { cls: "ds-help", name: "Help text" },
  { cls: "ds-error", name: "Error text" },
  { cls: "ds-breadcrumb", name: "Breadcrumb", component: "breadcrumb" },
  { cls: "ds-toolbar", name: "Filter bar" },
  { cls: "ds-overlays", name: "Overlays and states" },
  { cls: "ds-frame", name: "Overlay frame" },
  { cls: "ds-stage", name: "Backdrop" },
  { cls: "ds-modal", name: "Dialog", component: "dialog" },
  { cls: "ds-alert-dialog", name: "Confirm dialog", component: "alert_dialog" },
  { cls: "ds-sheet", name: "Sheet", component: "sheet" },
  { cls: "ds-dialog", name: "Dialog", component: "dialog" },
  { cls: "ds-modal-header", name: "Dialog header" },
  { cls: "ds-modal-footer", name: "Dialog footer" },
  { cls: "ds-spark", name: "Sparkline", component: "stat" },
  { cls: "ds-trend", name: "Trend" },
  { cls: "ds-stat", name: "Stat card", component: "stat" },
  { cls: "ds-dl", name: "Details", component: "description_list" },
  { cls: "ds-timeline-dot", name: "Timeline marker" },
  { cls: "ds-timeline", name: "Timeline", component: "timeline" },
  { cls: "ds-steps", name: "Steps", component: "stepper" },
  { cls: "ds-tree-row", name: "Tree row" },
  { cls: "ds-tree-toggle", name: "Expand toggle" },
  { cls: "ds-tree", name: "Tree", component: "tree" },
  { cls: "ds-board-card", name: "Board card" },
  { cls: "ds-board-col", name: "Board column" },
  { cls: "ds-board", name: "Board", component: "board" },
  { cls: "ds-bulkbar", name: "Bulk actions", component: "bulk_actions" },
  { cls: "ds-table-toolbar", name: "Table toolbar", component: "bulk_actions" },
  { cls: "ds-chips", name: "Filter chips", component: "chip" },
  { cls: "ds-chip", name: "Chip", component: "chip" },
  { cls: "ds-master-item", name: "List item (master)" },
  { cls: "ds-master-list", name: "Master list" },
  { cls: "ds-master-detail", name: "Master-detail", component: "master_detail" },
  { cls: "ds-card-header", name: "Card header" },
  { cls: "ds-card-footer", name: "Card footer" },
  { cls: "ds-card", name: "Card", component: "card" },
  { cls: "ds-table-wrap", name: "Table", component: "table" },
  { cls: "ds-dropdown", name: "Menu", component: "menu" },
  { cls: "ds-menu", name: "Menu items", component: "menu" },
  { cls: "ds-menu-item", name: "Menu item" },
  { cls: "ds-btn-primary", name: "Primary button", component: "button" },
  { cls: "ds-btn-danger", name: "Danger button", component: "button" },
  { cls: "ds-btn-ghost", name: "Ghost button", component: "button" },
  { cls: "ds-btn", name: "Button", component: "button" },
  { cls: "ds-field", name: "Field" },
  { cls: "ds-input", name: "Input", component: "input" },
  { cls: "ds-select", name: "Select", component: "select" },
  { cls: "ds-textarea", name: "Text area", component: "input" },
  { cls: "ds-checkbox", name: "Checkbox", component: "checkbox" },
  { cls: "ds-dropzone", name: "File upload" },
  { cls: "ds-badge", name: "Badge", component: "badge" },
  { cls: "ds-alert", name: "Alert", component: "alert" },
  { cls: "ds-tabs", name: "Tabs", component: "tabs" },
  { cls: "ds-tab", name: "Tab", component: "tabs" },
  { cls: "ds-pagination", name: "Pagination", component: "pagination" },
  { cls: "ds-progress", name: "Progress", component: "progress" },
  { cls: "ds-empty", name: "Empty state", component: "empty_state" },
  { cls: "ds-skeleton", name: "Skeleton", component: "skeleton" },
  { cls: "ds-toast", name: "Toast", component: "toast" },
  { cls: "ds-section", name: "Section" },
  { cls: "ds-section-head", name: "Section header" },
  { cls: "ds-split", name: "Split layout" },
  { cls: "ds-grid-4", name: "Grid (4 columns)" },
  { cls: "ds-grid-3", name: "Grid (3 columns)" },
  { cls: "ds-grid-2", name: "Grid (2 columns)" },
  { cls: "ds-grid", name: "Grid" },
  { cls: "ds-form-row", name: "Form row" },
  { cls: "ds-form", name: "Form" },
  { cls: "ds-list", name: "List" },
  { cls: "ds-placeholder", name: "Placeholder" },
  { cls: "ds-avatar", name: "Avatar" },
  { cls: "ds-stack", name: "Stack" },
  { cls: "ds-row", name: "Row" },
];

/**
 * Roles of the open-design seed vocabulary (web-prototype, mobile-app,
 * dashboard seeds): matched after the kit's, so an od screen still names its
 * buttons, cards and fields. Anything else falls back to its tag and class.
 */
const OD_ROLES: Array<{ cls: string; name: string; component?: string }> = [
  { cls: "btn-primary", name: "Primary button", component: "button" },
  { cls: "btn-secondary", name: "Secondary button", component: "button" },
  { cls: "btn-ghost", name: "Ghost button", component: "button" },
  { cls: "btn", name: "Button", component: "button" },
  { cls: "card", name: "Card", component: "card" },
  { cls: "stat", name: "Stat card", component: "stat" },
  { cls: "field", name: "Field" },
  { cls: "input", name: "Input", component: "input" },
  { cls: "textarea", name: "Text area", component: "input" },
  { cls: "pill", name: "Badge", component: "badge" },
  { cls: "tag", name: "Badge", component: "badge" },
  { cls: "topnav", name: "Navigation" },
  { cls: "tabbar", name: "Tab bar", component: "tabs" },
  { cls: "tab", name: "Tab", component: "tabs" },
  { cls: "list-row", name: "List row" },
  { cls: "ph-img", name: "Image placeholder" },
  { cls: "content-img", name: "Image" },
  { cls: "section", name: "Section" },
];

const TAG_NAMES: Record<string, string> = {
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", p: "Text", span: "Text", a: "Link", label: "Label",
  table: "Table", thead: "Table header", tbody: "Table body", tr: "Row", th: "Column header", td: "Cell", ul: "List", ol: "List",
  li: "List item", svg: "Graphic", dl: "Details", dt: "Term", dd: "Value", img: "Image", button: "Button", input: "Input", select: "Select", textarea: "Text area",
  figure: "Frame", figcaption: "Caption", nav: "Navigation", section: "Section", form: "Form", strong: "Bold text", em: "Emphasis",
};

export interface ElementInfo {
  nid: string | null;
  tag: string;
  role: string;
  /** Library-neutral role key (button, dialog, sheet…), when the element is a component. */
  component: string | null;
  text: string;
  classes: string[];
  /** Inside the overlays section: a dialog, sheet or state, not the main view. */
  inOverlay: boolean;
  /** The screen key this element links to (data-link, or a link to "./<key>.html"). */
  linksTo: string | null;
  /** Whether the element holds only text, so it can be edited in place. */
  textEditable: boolean;
}

const dsClasses = (el: Element) => [...el.classList].filter((c) => c.startsWith("ds-"));
/** The element's own design classes: canvas marks and composition (x-) classes left out. */
const ownClasses = (el: Element) => [...el.classList].filter((c) => !(CANVAS_CLASSES as readonly string[]).includes(c) && !c.startsWith("x-"));
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function roleOf(el: Element): { name: string; component: string | null } {
  for (const r of ROLES) if (el.classList.contains(r.cls)) return { name: r.name, component: r.component ?? null };
  if (el.hasAttribute(UX_OD_MARKERS.frame)) return { name: "Overlay frame", component: null };
  if (el.hasAttribute(UX_OD_MARKERS.overlays)) return { name: "Overlays and states", component: null };
  if (el.hasAttribute(UX_OD_MARKERS.nav)) return { name: "Navigation", component: null };
  for (const r of OD_ROLES) if (el.classList.contains(r.cls)) return { name: r.name, component: r.component ?? null };
  const tag = el.tagName.toLowerCase();
  const named = TAG_NAMES[tag];
  if (named) return { name: named, component: null };
  // An unknown element of a seed's own vocabulary: its tag and first class.
  const first = ownClasses(el)[0];
  return { name: first ? `${tag}.${first}` : tag, component: null };
}

/** The screen an element points at, from data-link or a link to another screen's file. */
export function linkTarget(el: Element): string | null {
  const own = el.getAttribute("data-link");
  if (own) return own;
  const href = el.getAttribute("href");
  const m = href ? /^\.\/([a-z0-9-]+)\.html$/i.exec(href) : null;
  return m ? m[1]! : null;
}

const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "p", "span", "a", "label", "button", "th", "td", "li", "strong", "em", "figcaption", "summary", "option"]);

export function describe(el: Element): ElementInfo {
  const { name, component } = roleOf(el);
  const onlyText = [...el.childNodes].every((n) => n.nodeType === 3 || (n.nodeType === 1 && ["br", "strong", "em", "span"].includes((n as Element).tagName.toLowerCase()) && (n as Element).children.length === 0));
  return {
    nid: el.getAttribute("data-nid"),
    tag: el.tagName.toLowerCase(),
    role: name,
    component,
    text: clip(textOf(el), 200),
    classes: dsClasses(el).length ? dsClasses(el) : ownClasses(el),
    inOverlay: Boolean(el.closest(PART.overlays)),
    linksTo: linkTarget(el),
    textEditable:
      onlyText &&
      textOf(el).length > 0 &&
      (TEXT_TAGS.has(el.tagName.toLowerCase()) || dsClasses(el).some((c) => c.startsWith("ds-btn") || c === "ds-badge") || ["btn", "pill", "tag"].some((c) => el.classList.contains(c))),
  };
}

/** A short label for the layers panel: role plus what it says. */
export function layerLabel(el: Element): string {
  const { name } = roleOf(el);
  if (el.classList.contains("ds-table-wrap") || el.tagName.toLowerCase() === "table") {
    const cols = el.querySelector("thead tr, tr")?.children.length ?? 0;
    return `${name} · ${cols} columns`;
  }
  if (el.matches(PART.frame)) return clip(textOf(el.querySelector("figcaption") ?? el) || name);
  const heading = el.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope .ds-card-title, :scope > .ds-modal-header h2, :scope > .ds-modal-header h3");
  const text = heading ? textOf(heading) : el.children.length <= 2 ? textOf(el) : "";
  return text ? `${name} · ${clip(text, 40)}` : name;
}

export interface LayerNode {
  el: Element;
  label: string;
  children: LayerNode[];
}

/**
 * The layers of a screen's page content: elements that carry a kit class or a
 * meaningful tag. Wrappers without either are flattened into their parent, so
 * the tree reads like the design, not like the markup.
 */
export function layerTree(root: Element, depth = 0): LayerNode[] {
  const out: LayerNode[] = [];
  for (const child of [...root.children]) {
    if (["script", "style", "template"].includes(child.tagName.toLowerCase())) continue;
    // Kit classes, a meaningful tag, or (od) a class from the seed's vocabulary or an od anchor.
    const meaningful =
      dsClasses(child).length > 0 ||
      /^(h[1-4]|table|form|figure|nav|section|img|svg|button|a|input|select|textarea)$/i.test(child.tagName) ||
      child.hasAttribute("data-od-id") ||
      OD_ROLES.some((r) => child.classList.contains(r.cls));
    // Leaves under a table row or a menu are not worth a layer each.
    const leaf = depth > 7 || ["tr", "thead", "tbody", "option", "svg"].includes(child.tagName.toLowerCase());
    if (meaningful) {
      out.push({ el: child, label: layerLabel(child), children: leaf || child.tagName.toLowerCase() === "table" ? [] : layerTree(child, depth + 1) });
    } else if (!leaf) {
      out.push(...layerTree(child, depth + 1));
    }
  }
  return out;
}

export interface OverlayDoc {
  index: number;
  caption: string;
  kind: "dialog" | "sheet" | "confirm" | "state";
  /** The overlay alone: the screen's stylesheet and the stage, full size. */
  html: string;
}

/**
 * Every frame of a screen's overlays section as its own small document, so the
 * canvas can show each dialog, sheet or state as a separate artboard.
 */
export function overlayDocs(screenHtml: string): OverlayDoc[] {
  const doc = new DOMParser().parseFromString(screenHtml, "text/html");
  // The head keeps the screen's stylesheets (kit: the design system and kit;
  // od: the tokens, the seed's base CSS and the screen's own rules).
  const head = doc.head.innerHTML;
  const od = Boolean(doc.querySelector(`[${UX_OD_MARKERS.overlays}], [${UX_OD_MARKERS.app}]`));
  const htmlAttrs = [...doc.documentElement.attributes].map((a) => ` ${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join("");
  return [...doc.querySelectorAll(PART.frames)].map((frame, index) => {
    const caption = textOf(frame.querySelector("figcaption") ?? frame) || `Overlay ${index + 1}`;
    const body = frame.cloneNode(true) as Element;
    body.querySelector("figcaption")?.remove();
    const kind = overlayKind(body, caption);
    const stage = body.querySelector(".ds-stage, [data-sdd-stage]");
    if (stage) stage.setAttribute("style", "min-height:100vh;border:0;border-radius:0;margin:0");
    const wrap = od
      ? `<div data-overlay="${index}" style="padding:${stage ? "0" : "24px"}">${body.innerHTML}</div>`
      : `<div class="ds-main" style="max-width:none;padding:${stage ? "0" : "24px"}" data-overlay="${index}">${body.innerHTML}</div>`;
    return { index, caption, kind, html: `<!doctype html><html${htmlAttrs}><head>${head}</head><body>${wrap}</body></html>` };
  });
}

/**
 * What an overlay frame shows: the kit's own classes first; an od frame names
 * itself by data-kind or by its caption ("Dialog: …", "Sheet: …", "Confirm: …").
 */
export function overlayKind(frame: Element, caption: string): OverlayDoc["kind"] {
  if (frame.querySelector(".ds-sheet")) return "sheet";
  if (frame.querySelector(".ds-alert-dialog")) return "confirm";
  if (frame.querySelector(".ds-modal, .ds-dialog")) return "dialog";
  const own = (frame.getAttribute("data-kind") ?? "").toLowerCase();
  if (own === "sheet" || own === "confirm" || own === "dialog" || own === "state") return own;
  const lead = caption.split(":")[0]!.trim().toLowerCase();
  if (/sheet|drawer|bottom sheet/.test(lead)) return "sheet";
  if (/confirm/.test(lead)) return "confirm";
  if (/dialog|modal/.test(lead)) return "dialog";
  return "state";
}

/** The words an overlay caption names it by: "Dialog: Create project" → "create project". */
export function overlayName(caption: string): string {
  return caption.replace(/^[^:]{0,24}:\s*/, "").trim().toLowerCase();
}

/**
 * The element in the main view that opens an overlay: a button or link whose
 * text matches the overlay's name (exactly, or one containing the other).
 */
export function triggerFor(doc: Document, caption: string): Element | null {
  const name = overlayName(caption);
  if (!name) return null;
  const scope = contentRoot(doc);
  const candidates = scope
    ? [...scope.querySelectorAll("button, a, .ds-btn, .btn, summary")].filter((el) => !el.closest(PART.overlays) && !el.closest(PART.shell))
    : [];
  const exact = candidates.find((el) => textOf(el).toLowerCase() === name);
  if (exact) return exact;
  return candidates.find((el) => {
    const t = textOf(el).toLowerCase();
    return t.length > 2 && (name.includes(t) || t.includes(name));
  }) ?? null;
}

/** Links from a screen's page content to other screens. */
export function contentLinks(doc: Document): Array<{ el: Element; target: string }> {
  const scope = contentRoot(doc);
  return [...(scope?.querySelectorAll("[data-link], a[href]") ?? [])]
    .filter((el) => !el.closest(PART.overlays) && !el.closest(PART.shell))
    .map((el) => ({ el, target: linkTarget(el) }))
    .filter((l): l is { el: Element; target: string } => Boolean(l.target));
}

/** An od screen's saved content: its own stylesheet (when it has one) first, then the whole body. */
export function odSaveContent(screenStyle: string | null, bodyHtml: string): string {
  const body = bodyHtml.trim();
  return screenStyle ? `${screenStyle}\n${body}` : body;
}

/** The screen's page content: the marked content region (kit and od), else the first <main>. */
export function contentRoot(doc: Document): Element | null {
  return doc.querySelector(PART.content) ?? doc.querySelector("main");
}

/** A copy of an element with the canvas's marks (outlines, pins, editing) removed. */
function cleanCopy(el: Element): Element {
  const copy = el.cloneNode(true) as Element;
  const sources = [el, ...el.querySelectorAll("*")];
  const copies = [copy, ...copy.querySelectorAll("*")];
  sources.forEach((source, i) => {
    const originals = viewportStyles.get(source);
    if (!originals) return;
    const style = (copies[i] as HTMLElement | SVGElement).style;
    for (const [property, original] of originals) {
      if (style.getPropertyValue(property) === original.pinned && style.getPropertyPriority(property) === original.priority) {
        style.setProperty(property, original.value, original.priority);
      }
    }
  });
  copy.querySelectorAll(".sdd-pin").forEach((pin) => pin.remove());
  for (const node of [copy, ...copy.querySelectorAll("*")]) {
    for (const c of CANVAS_CLASSES) node.classList.remove(c);
    if (node.getAttribute("class") === "") node.removeAttribute("class");
    node.removeAttribute("contenteditable");
    node.removeAttribute("spellcheck");
    node.removeAttribute("data-sdd-hot");
  }
  return copy;
}

/**
 * A mockup's content as the edit API takes it back, canvas marks removed.
 * Kit: the inner HTML of <main data-screen-content> (the platform re-frames
 * it). Od: the whole body — the model wrote the shell too — with the screen's
 * own stylesheet (<style data-screen> in the head) carried first, so a save
 * never drops the screen's rules; the tokens and seed CSS are the platform's.
 */
export function contentForSave(doc: Document, opts: { od?: boolean } = {}): string {
  if (opts.od) {
    if (!doc.body) return "";
    return odSaveContent(doc.head?.querySelector("style[data-screen]")?.outerHTML ?? null, cleanCopy(doc.body).innerHTML);
  }
  const main = doc.querySelector("main[data-screen-content]") ?? doc.querySelector("main");
  if (!main) return "";
  return cleanCopy(main).innerHTML.trim();
}
