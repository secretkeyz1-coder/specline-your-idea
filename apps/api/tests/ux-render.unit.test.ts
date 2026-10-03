import { afterAll, describe, expect, test } from "bun:test";
import { closeRenderBrowser, renderLint } from "../src/modules/ux/ux-render.js";
import { NEUTRAL_SPEC, assembleScreen } from "../src/modules/ux/ux-shell.js";

const frame = (content: string) => assembleScreen({ content, spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "a", name: "A" }], currentKey: "a" });
const rules = (f: Awaited<ReturnType<typeof renderLint>>) => (f ?? []).map((x) => `${x.action}:${x.rule}`);

// Closing Chromium can outlast the default 5s hook timeout on a busy machine.
afterAll(() => closeRenderBrowser(), 60_000);

describe("UI reference render check", () => {
  test("off means no check", async () => {
    process.env.UX_RENDER_LINT = "off";
    try {
      expect(await renderLint(frame("<h1>A</h1>"))).toBeNull();
    } finally {
      delete process.env.UX_RENDER_LINT;
    }
  });

  test("a clean screen passes; a broken one fails at phone and desktop width", async () => {
    const clean = await renderLint(frame('<div class="ds-page-header"><div><h1>Projects</h1><p class="ds-page-desc">Every active project.</p></div></div><div class="ds-card"><p>Nothing here yet.</p></div>'));
    // No Chromium on this machine: the check is skipped, which is itself the contract.
    if (clean === null) return;
    expect(rules(clean)).toEqual([]);

    const cols = Array.from({ length: 12 }, (_, i) => `<th>Long column name ${i + 1}</th>`).join("");
    const cells = Array.from({ length: 12 }, (_, i) => `<td>Cell value number ${i + 1}</td>`).join("");
    const broken = await renderLint(
      frame(`<h1>Broken</h1><div style="width:900px">fixed width</div><div class="ds-table-wrap"><table class="ds-table"><tr>${cols}</tr><tr>${cells}</tr></table></div><p style="font-size:9px">tiny</p>`),
    );
    // Overflow without a control cut off, a wide table and tiny text are warnings now.
    expect(rules(broken)).toEqual(expect.arrayContaining(["warn:phone-overflow", "warn:table-too-wide", "warn:tiny-text"]));
    expect(broken!.find((f) => f.rule === "phone-overflow")!.message).toContain('div "fixed width"');
  }, 60_000);

  test("a control pushed off the screen and text below the contrast minimum block approval", async () => {
    const found = await renderLint(
      frame(
        '<div class="ds-page-header"><div><h1>Orders</h1><p class="ds-page-desc">Every order.</p></div></div>' +
          '<div style="display:flex;gap:8px"><span style="flex:0 0 380px">Filters</span><button class="ds-btn">Export orders</button></div>' +
          '<p style="color:var(--ds-border)">Barely visible note</p>',
      ),
    );
    if (found === null) return;
    expect(rules(found)).toEqual(expect.arrayContaining(["block:cut-off-action", "block:low-contrast"]));
    // The cut-off control is named, and it is not reported twice as plain overflow.
    expect(found.find((f) => f.rule === "cut-off-action")!.message).toContain('Export orders');
    expect(rules(found)).not.toContain("warn:phone-overflow");
  }, 60_000);
});
