import { createHash } from "node:crypto";
import { UX_BUDGETS, type UxLintFinding } from "@sdd/contracts";
import type { Browser } from "playwright-core";
import { createLogger } from "@sdd/shared";
import { finding } from "./ux-rules.js";
import { renderSizes, WEB_PLATFORM, type RenderSize } from "./ux-platform.js";

/**
 * Checks on a UI-reference screen as a browser lays it out, at a phone (390)
 * and a desktop (1440) width — what the HTML lint cannot see: a page wider
 * than the phone, a table whose columns hide behind a scroll on a desktop, a
 * main view many phone screens tall, text squeezed into a sliver, buttons too
 * small to tap, text whose rendered colours miss the contrast minimum. What
 * each finding blocks or repairs is set by the rule catalogue (ux-rules.ts).
 *
 * The screen renders in a headless Chromium with page JavaScript disabled and
 * every network request aborted; the measuring code runs from the outside.
 * Without a browser (none installed, or UX_RENDER_LINT=off) the check is
 * skipped; callers record that as `render-unchecked` (aturan.md §5.4): a
 * render that did not run is "not checked", never a pass. Text whose
 * backdrop cannot be measured (an image or gradient behind it) is reported
 * the same way instead of being counted as passing contrast.
 */

/** A main view taller than this many phone screens is flagged. */
const PHONE_SCREENS = UX_BUDGETS.phoneScreens;
const IDLE_CLOSE_MS = 60_000;
/** The overlays section: the kit's class, or the od marker (UX_OD_MARKERS.overlays). */
const HIDE_OVERLAYS = "<style>.ds-overlays,[data-sdd-overlays]{display:none !important}</style>";
const logger = createLogger({ level: (process.env.LOG_LEVEL as never) ?? "info", base: { service: "sdd-api", module: "ux-render" } });

let browser: Promise<Browser | null> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;
let warned = false;

function enabled(): boolean {
  return (process.env.UX_RENDER_LINT ?? "auto").toLowerCase() !== "off";
}

/** Forget the shared browser if it is still this one, so the next check launches a new one. */
function forget(which: Promise<Browser | null> | null) {
  if (which && browser === which) browser = null;
}

/**
 * One shared browser, launched on first use and closed after a minute idle.
 * A browser that crashed or was killed is forgotten (its `disconnected`
 * event, or a failed check on it): kept, every later check failed on it until
 * the process restarted.
 */
async function getBrowser(): Promise<Browser | null> {
  if (!browser) {
    // Imported on first use: an image without playwright-core (or a browser) still starts.
    const launching: Promise<Browser | null> = import("playwright-core")
      .then(({ chromium }) => chromium.launch({ executablePath: process.env.UX_RENDER_CHROMIUM || undefined, args: ["--disable-gpu"] }))
      .then((b) => {
        b.on("disconnected", () => forget(launching));
        return b;
      })
      .catch((e: Error) => {
        if (!warned) {
          warned = true;
          logger.warn("ui reference render check skipped: no browser", { error: e.message.slice(0, 200) });
        }
        forget(launching);
        return null;
      });
    browser = launching;
  }
  const b = await browser;
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    const closing = browser;
    browser = null;
    void closing?.then((x) => x?.close()).catch(() => {});
  }, IDLE_CLOSE_MS);
  idle.unref?.();
  return b;
}

/** What one viewport measured; computed inside the page. */
interface Measure {
  overflow: number;
  wide: string[];
  height: number;
  tables: Array<{ name: string; hidden: number; columns: number }>;
  smallTargets: string[];
  squeezed: string[];
  tiny: string[];
  /** Controls (buttons, links, fields) pushed past the edge of the viewport, outside any scroll container. */
  cut: string[];
  /** Text whose rendered colour on its rendered background misses the minimum. */
  lowText: string[];
  /** Field borders, focus rings and status indicators under 3:1. */
  lowControl: string[];
  /** Elements painting an image or gradient that text sits on: its contrast could not be measured. */
  unmeasured: string[];
}

async function measureAt(b: Browser, html: string, size: RenderSize, minTarget: number): Promise<Measure> {
  const ctx = await b.newContext({ viewport: { width: size.width, height: size.height }, javaScriptEnabled: false, deviceScaleFactor: 1 });
  try {
    await ctx.route("**/*", (route) => route.abort());
    const page = await ctx.newPage();
    // The main view only: overlays are drawn as frames after it and judged as
    // dialogs. The style goes into the document itself — addStyleTag waits for
    // a load event that never fires with page JavaScript off.
    await page.setContent(html.replace(/<\/head>/i, `${HIDE_OVERLAYS}</head>`), { waitUntil: "domcontentloaded", timeout: 10_000 });
    return await page.evaluate((minTarget: number) => {
      const vw = document.documentElement.clientWidth;
      // od screens: the app root (shell and content, found by its marker); kit screens: <main>.
      const od = document.body.hasAttribute("data-sdd-generator");
      const main = (od ? document.querySelector("[data-sdd-app]") : null) ?? document.querySelector("main") ?? document.body;
      const name = (el: Element) => {
        const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
        const cls = classes.find((c) => c.startsWith("ds-")) ?? (od ? classes[0] : undefined);
        return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${text ? ` "${text}"` : ""}`;
      };
      const scrolls = ".ds-table-wrap, .ds-chart, .ds-tabs, .tabs, .chips, .side-nav, .top-nav";
      const out = {
        overflow: document.documentElement.scrollWidth - vw,
        wide: [] as string[],
        height: Math.ceil(main.getBoundingClientRect().bottom),
        tables: [] as Array<{ name: string; hidden: number; columns: number }>,
        smallTargets: [] as string[],
        squeezed: [] as string[],
        tiny: [] as string[],
        cut: [] as string[],
        lowText: [] as string[],
        lowControl: [] as string[],
        unmeasured: [] as string[],
      };
      /* Colours as the browser computed them: rgb()/rgba(), or color(srgb …) from color-mix. */
      type Rgba = [number, number, number, number];
      const parse = (c: string): Rgba | null => {
        const rgb = /rgba?\(([^)]+)\)/.exec(c);
        if (rgb) {
          const p = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map((v) => (v.endsWith("%") ? parseFloat(v) / 100 : Number(v)));
          return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
        }
        const srgb = /color\(srgb\s+([^)]+)\)/.exec(c);
        if (srgb) {
          const p = srgb[1]!.split(/[\s/]+/).filter(Boolean).map(Number);
          return [p[0]! * 255, p[1]! * 255, p[2]! * 255, p[3] ?? 1];
        }
        return null;
      };
      const over = (top: Rgba, under: [number, number, number]): [number, number, number] =>
        [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as [number, number, number];
      /*
       * Images the kit paints for its own chrome, not behind text: a table
       * wrap's scroll shadows sit at its edges, so the colour behind them is
       * the backdrop. Any other image or gradient makes the backdrop unknown.
       */
      const SEE_THROUGH = ".ds-table-wrap";
      /** The background an element is painted on: every ancestor's fill, composited; the element painting an image or gradient when it can't be measured. */
      const backdrop = (el: Element): { bg: [number, number, number] } | { blocker: Element } => {
        const chain: Element[] = [];
        for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
        let bg: [number, number, number] = [255, 255, 255];
        for (const e of chain) {
          const cs = getComputedStyle(e);
          if (cs.backgroundImage && cs.backgroundImage !== "none" && !e.matches(SEE_THROUGH)) return { blocker: e };
          const fill = parse(cs.backgroundColor);
          if (fill && fill[3] > 0) bg = over(fill, bg);
        }
        return { bg };
      };
      const unmeasured = new Set<Element>();
      const lum = ([r, g, b]: [number, number, number]) => {
        const ch = (v: number) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
      };
      const ratio = (a: [number, number, number], b: [number, number, number]) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x! + 0.05) / (y! + 0.05);
      };
      /* Status indicators follow the palette's 3:1 rule for indicators; disabled controls are exempt (WCAG 1.4.3). */
      const INDICATOR = ".ds-badge, .ds-trend, .ds-timeline-dot, .ds-dot, .ds-progress, .badge, .delta, .tag, .progress";
      const EXEMPT = "[disabled], [aria-disabled=true], .ds-skeleton, .ds-placeholder, .skeleton, svg";
      for (const el of Array.from(main.querySelectorAll("*"))) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        // The outermost element that sticks out, not all its children.
        if (r.right > vw + 1 && !el.closest(scrolls) && (el.parentElement?.getBoundingClientRect().right ?? 0) <= vw + 1) out.wide.push(name(el));
        const cs = getComputedStyle(el);
        const interactive = el.matches("button, a.ds-btn, a.btn, a.icon-btn, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), summary.ds-btn");
        // A control past the edge that no scroll container holds cannot be reached without scrolling the whole page sideways.
        if (el.matches("button, a, select, input:not([type=hidden]), textarea, summary") && r.right > vw + 1 && !el.closest(scrolls) && cs.visibility !== "hidden") {
          out.cut.push(name(el));
        }
        if (!el.closest(EXEMPT) && cs.visibility !== "hidden") {
          const text = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
          const fg = parse(cs.color);
          if (text && fg && fg[3] > 0) {
            const found = backdrop(el);
            if ("blocker" in found) unmeasured.add(found.blocker);
            else {
              const bg = found.bg;
              const value = ratio(over(fg, bg), bg);
              const size = parseFloat(cs.fontSize);
              const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
              const indicator = Boolean(el.closest(INDICATOR));
              const minimum = indicator || large ? 3 : 4.5;
              if (value < minimum) (indicator ? out.lowControl : out.lowText).push(`${name(el)} ${value.toFixed(2)}:1`);
            }
          }
          // Field borders are the kit's (its library skin), not the screen's: the design system answers for them.
        }
        if (interactive && (r.height < minTarget || r.width < minTarget) && !el.closest(".ds-table, .ds-breadcrumb, .ds-pagination, .table")) out.smallTargets.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
        const leaf = el.children.length === 0 && (el.textContent ?? "").trim().length > 0;
        if (leaf && !el.closest("svg")) {
          const text = (el.textContent ?? "").trim();
          const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
          if (text.length > 12 && r.width < 72 && r.height > line * 3.2) out.squeezed.push(`${name(el)} ${Math.round(r.width)}px wide`);
          if (parseFloat(cs.fontSize) < 11 && !el.closest(".ds-avatar, .avatar")) out.tiny.push(`${name(el)} ${cs.fontSize}`);
        }
      }
      out.unmeasured = Array.from(unmeasured).map(name);
      for (const wrap of Array.from(main.querySelectorAll(".ds-table-wrap"))) {
        const hidden = wrap.scrollWidth - wrap.clientWidth;
        const table = wrap.querySelector("table");
        if (!table || getComputedStyle(table).display !== "table") continue;
        const columns = table.querySelector("tr")?.children.length ?? 0;
        const head = Array.from(table.querySelectorAll("th")).map((th) => (th.textContent ?? "").trim()).filter(Boolean).slice(0, 2).join(", ");
        out.tables.push({ name: head || "table", hidden, columns });
      }
      return out;
    }, minTarget);
  } finally {
    await ctx.close().catch(() => {});
  }
}

const list = (items: string[], n = 3) => items.slice(0, n).join("; ") + (items.length > n ? ` (+${items.length - n} more)` : "");

/**
 * Findings from rendering the framed screen; null when no browser is
 * available. Measured at the narrowest and widest target device of the
 * reference's platform (web: a 390 phone and a 1440 desktop).
 */
export async function renderLint(html: string, sizes = renderSizes(WEB_PLATFORM)): Promise<UxLintFinding[] | null> {
  const { narrow: PHONE, wide: DESKTOP, minTarget } = sizes;
  if (!enabled()) return null;
  const b = await getBrowser();
  if (!b) return null;
  const shared = browser;
  let phone: Measure;
  let desktop: Measure;
  try {
    [phone, desktop] = await Promise.all([measureAt(b, html, PHONE, minTarget), measureAt(b, html, DESKTOP, minTarget)]);
  } catch (e) {
    logger.warn("ui reference render check failed", { error: (e as Error).message.slice(0, 200) });
    // A browser that can no longer open a context is gone: the next check
    // launches another. One still connected failed on this page only (a
    // timeout) and stays shared.
    if (!b.isConnected()) {
      forget(shared);
      void b.close().catch(() => {});
    }
    return null;
  }
  const findings: UxLintFinding[] = [];
  const add = (rule: string, message: string) => findings.push(finding(rule, message));

  // A control past the edge is out of reach: that blocks approval. Other overflow is a warning.
  const cut = [...new Set([...phone.cut.map((c) => `${PHONE.label}: ${c}`), ...desktop.cut.map((c) => `${DESKTOP.label}: ${c}`)])];
  if (cut.length) add("cut-off-action", `Controls pushed past the edge of the screen, outside any scroll container: ${list(cut)}. Let rows wrap or move the actions into a ds-dropdown.`);
  if (phone.overflow > 1 && !phone.cut.length) {
    add("phone-overflow", `On a ${PHONE.label} (${PHONE.width}px) the page is ${phone.overflow}px wider than the screen: ${list(phone.wide)}. Let rows wrap, use kit layout classes, no fixed widths.`);
  }
  if (desktop.overflow > 1 && !desktop.cut.length) {
    add("desktop-overflow", `On a ${DESKTOP.label} (${DESKTOP.width}px) the page is ${desktop.overflow}px wider than the window: ${list(desktop.wide)}.`);
  }
  const hiddenCols = desktop.tables.filter((t) => t.hidden > 24);
  if (hiddenCols.length) {
    add(
      "table-too-wide",
      `On a ${DESKTOP.label} (${DESKTOP.width}px) ${hiddenCols.map((t) => `the table (${t.name}, ${t.columns} columns) hides ${t.hidden}px behind a sideways scroll`).join("; ")}. Put the table at full width; unless the columns are compared side by side, move detail into the row's sheet.`,
    );
  }
  const lowText = [...new Set([...phone.lowText, ...desktop.lowText])];
  if (lowText.length) add("low-contrast", `Text below the contrast minimum (4.5:1, large text 3:1) as rendered: ${list(lowText)}. Use the tokens' text colours on their surfaces.`);
  const lowControl = [...new Set([...phone.lowControl, ...desktop.lowControl])];
  if (lowControl.length) add("low-contrast-control", `Control edges or status indicators below 3:1 as rendered: ${list(lowControl)}.`);
  const screens = phone.height / PHONE.height;
  if (screens > PHONE_SCREENS) {
    add("phone-too-long", `On a ${PHONE.label} the main view is ${screens.toFixed(1)} screens tall (${phone.height}px). Show fewer rows or facts per card (ds-hide-sm), and move secondary sections into tabs or a detail screen.`);
  }
  if (phone.smallTargets.length) add("small-target", `Controls smaller than ${minTarget}px on a ${PHONE.label}: ${list(phone.smallTargets)}.`);
  const squeezed = [...new Set([...phone.squeezed, ...desktop.squeezed])];
  if (squeezed.length) add("squeezed-text", `Text squeezed into a narrow column (more than three lines): ${list(squeezed)}.`);
  const tiny = [...new Set([...phone.tiny, ...desktop.tiny])];
  if (tiny.length) add("tiny-text", `Text smaller than 11px: ${list(tiny)}.`);
  const unmeasured = [...new Set([...phone.unmeasured, ...desktop.unmeasured])];
  if (unmeasured.length) {
    add("render-unchecked", `Contrast not measured: text sits on an image or gradient (${list(unmeasured)}). Check it by eye — it is not counted as passing.`);
  }
  return findings;
}

/** The finding for a render check that did not run: shown as not checked, never as a pass (aturan.md §5.4). */
export function renderUnchecked(reason = "the render check did not run (no browser, or UX_RENDER_LINT=off)"): UxLintFinding {
  return finding("render-unchecked", `Not checked as rendered: ${reason}. Overflow, contrast and touch targets are unknown until it runs.`);
}

/**
 * What a render check measured: the framed document and the sizes it was laid
 * out at. Stored with the findings, it tells approval whether they still
 * describe the screen (same HTML, tokens, shell and sizes) or need a new render.
 */
export function renderDigest(framedHtml: string, sizes: { narrow: { width: number; height: number }; wide: { width: number; height: number }; minTarget: number }): string {
  const measure = `${sizes.narrow.width}x${sizes.narrow.height}|${sizes.wide.width}x${sizes.wide.height}|${sizes.minTarget}`;
  // Node ids are numbered after a check and never change layout: left out, a stored drawing matches what was measured.
  return createHash("sha256").update(measure).update("\n").update(framedHtml.replace(/\sdata-nid="[^"]*"/g, "")).digest("hex");
}

/** Close the shared browser (tests, shutdown). */
export async function closeRenderBrowser(): Promise<void> {
  if (idle) clearTimeout(idle);
  const closing = browser;
  browser = null;
  await closing?.then((b) => b?.close()).catch(() => {});
}
