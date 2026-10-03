import { describe, expect, test } from "bun:test";
import { cleanComposeCss, composeStylesOf, droppedComposeCss, scopeComposeStyles } from "../src/modules/ux/ux-compose.js";
import { lintScreenHtml } from "../src/modules/ux/ux-lint.js";
import { NEUTRAL_SPEC, assembleScreen, screenContent } from "../src/modules/ux/ux-shell.js";

describe("composition CSS", () => {
  test("layout and token paint are kept and scoped to the page", () => {
    const { css, dropped } = cleanComposeCss(`
      .x-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--ds-gap) }
      .x-grid > * { min-width: 0 }
      .x-aside { position: sticky; top: 1rem; background: var(--ds-surface-2); border: 1px solid var(--ds-border); border-radius: var(--ds-radius-card); box-shadow: var(--ds-shadow) }
      @media (min-width: 1024px) { .x-grid { grid-template-columns: 2fr 1fr } }
    `);
    expect(dropped).toEqual([]);
    expect(css).toContain(".ds-main .x-grid{display:grid;grid-template-columns:repeat(auto-fit, minmax(14rem, 1fr));gap:var(--ds-gap)}");
    expect(css).toContain(".ds-main .x-grid > *{min-width:0}");
    expect(css).toContain("position:sticky");
    expect(css).toContain("@media (min-width: 1024px){.ds-main .x-grid{grid-template-columns:2fr 1fr}}");
  });

  test("literal colours, gradients, fonts, fixed widths, animation and the shell are dropped", () => {
    const { css, dropped } = cleanComposeCss(`
      body { margin: 0 }
      .ds-sidebar { display: none }
      .x-a { color: #ff0000; background: linear-gradient(red, blue); font-family: Inter; width: 480px; animation: spin 1s; font-size: 2.5rem }
      .x-b { border: 1px solid red; background: var(--ds-surface, #fff); position: fixed; z-index: 999 }
      .x-c { content: "hi"; background: url(https://evil.test/x.png) }
      @keyframes spin { from { opacity: 0 } }
      @supports (display:grid) { .x-d { display: grid } }
    `);
    expect(css).toBe("");
    const text = dropped.join(" | ");
    for (const bit of ["selector body", "selector .ds-sidebar", "color: #ff0000", "linear-gradient", "font-family", "width: 480px", "animation", "font-size: 2.5rem", "border: 1px solid red", "var(--ds-surface, #fff)", "position: fixed", "z-index: 999", "content", "url(", "@keyframes", "@supports"]) {
      expect(text).toContain(bit);
    }
  });

  test("scoping is idempotent; the shell copies it into the head; the lint reports what was dropped", () => {
    const content = '<style>.x-row{display:flex;gap:1rem;color:#333}</style><div class="ds-page-header"><div><h1>Tasks</h1></div></div><div class="x-row">a</div>';
    const once = scopeComposeStyles(content);
    expect(once).toBe('<style data-compose>\n.ds-main .x-row{display:flex;gap:1rem}\n</style><div class="ds-page-header"><div><h1>Tasks</h1></div></div><div class="x-row">a</div>');
    expect(scopeComposeStyles(once)).toBe(once);
    const html = assembleScreen({ content, spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "a", name: "A" }], currentKey: "a" });
    expect(html).toMatch(/<style data-compose-head>\n\.ds-main \.x-row\{display:flex;gap:1rem\}\n<\/style>\n<\/head>/);
    expect(screenContent(html)).toContain("<style data-compose>");
    expect(composeStylesOf(content)).toBe(".ds-main .x-row{display:flex;gap:1rem}");
    expect(droppedComposeCss(content)).toEqual(["color: #333"]);
    const rules = lintScreenHtml(content, "styled").map((f) => `${f.action}:${f.rule}`);
    // A literal colour blocks approval (tokens are strict), and the drop is reported as a warning.
    expect(rules).toContain("block:raw-colour");
    expect(rules).toContain("warn:style-dropped");
    expect(rules).not.toContain("warn:style-block");
  });
});
