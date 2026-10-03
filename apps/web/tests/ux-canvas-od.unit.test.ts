import { describe, expect, test } from "bun:test";
import { PART, UX_OD_MARKERS, canvasStyle, isOd, odSaveContent, overlayKind } from "../src/lib/ux-canvas.js";

/** The little of an Element overlayKind reads: kit class lookups and the frame's own data-kind. */
function frame(opts: { kitClass?: string; kind?: string } = {}): Element {
  return {
    querySelector: (sel: string) => (opts.kitClass && sel.split(",").map((s) => s.trim()).includes(`.${opts.kitClass}`) ? ({} as Element) : null),
    getAttribute: (name: string) => (name === "data-kind" ? (opts.kind ?? null) : null),
  } as unknown as Element;
}

describe("open-design screens on the canvas", () => {
  test("isOd: only an explicit od generator; an absent generator is the kit", () => {
    expect(isOd({ generator: "od" })).toBe(true);
    expect(isOd({ generator: "kit" })).toBe(false);
    expect(isOd({})).toBe(false);
    expect(isOd(null)).toBe(false);
  });

  test("part selectors match kit classes and od markers alike", () => {
    expect(PART.overlays).toContain(".ds-overlays");
    expect(PART.overlays).toContain(`[${UX_OD_MARKERS.overlays}]`);
    expect(PART.frames).toContain(`[${UX_OD_MARKERS.overlays}] [${UX_OD_MARKERS.frame}]`);
    expect(PART.app).toContain(`[${UX_OD_MARKERS.app}]`);
    expect(PART.shell).toContain(`[${UX_OD_MARKERS.nav}]`);
    expect(PART.content).toBe("[data-screen-content]");
  });

  test("the canvas stylesheet hides od overlays and pins the od app root like the kit's", () => {
    const css = canvasStyle({ hideOverlays: true });
    expect(css).toContain(`[${UX_OD_MARKERS.overlays}]{display:none !important}`);
    expect(css).toContain(`[${UX_OD_MARKERS.app}]{min-height:var(--sdd-frame-h,100dvh) !important}`);
    expect(canvasStyle({ hideOverlays: false })).not.toContain("display:none");
  });

  test("overlay kind: kit classes first, then the od frame's data-kind, then its caption", () => {
    expect(overlayKind(frame({ kitClass: "ds-sheet" }), "State: empty")).toBe("sheet");
    expect(overlayKind(frame({ kitClass: "ds-alert-dialog" }), "")).toBe("confirm");
    expect(overlayKind(frame({ kind: "dialog" }), "Whatever")).toBe("dialog");
    expect(overlayKind(frame(), "Sheet: Order details")).toBe("sheet");
    expect(overlayKind(frame(), "Bottom sheet: Pay")).toBe("sheet");
    expect(overlayKind(frame(), "Confirm: Void the order")).toBe("confirm");
    expect(overlayKind(frame(), "Dialog: Add item")).toBe("dialog");
    expect(overlayKind(frame(), "State: No orders yet")).toBe("state");
  });

  test("od save content: the screen's own stylesheet first, then the whole body", () => {
    const style = `<style data-screen>.x-menu{display:grid}</style>`;
    const body = `\n  <div data-sdd-app><nav data-sdd-nav></nav><main data-screen-content><h1>Kasir</h1></main></div>\n`;
    expect(odSaveContent(style, body)).toBe(`${style}\n<div data-sdd-app><nav data-sdd-nav></nav><main data-screen-content><h1>Kasir</h1></main></div>`);
    expect(odSaveContent(null, body)).toBe(`<div data-sdd-app><nav data-sdd-nav></nav><main data-screen-content><h1>Kasir</h1></main></div>`);
  });
});
