import { describe, expect, test } from "bun:test";
import type { UxComment } from "@sdd/contracts";
import { scopeComposeStyles } from "../src/modules/ux/ux-compose.js";
import { lintScreenHtml } from "../src/modules/ux/ux-lint.js";
import { historyIndex, reanchorComments, sanitizeHtml, screenBase } from "../src/modules/ux/ux.js";
import {
  MOCKUP_CSP,
  NEUTRAL_SPEC,
  assembleScreen,
  ensureNodeIds,
  extractFragment,
  extractScreenContent,
  findElement,
  nodeTexts,
  screenContent,
  withNodeIds,
} from "../src/modules/ux/ux-shell.js";

/**
 * Nothing a browser could run or load: no script, no handler, no active URL,
 * no embedding or head element. Checked in the markup (inside tags): what is
 * left of an attack as text is escaped (`&gt;`) and only ever reads as text.
 */
function expectInert(html: string) {
  expect(html).not.toMatch(/<script|<iframe|<object|<embed|<frame|<base|<link|<meta|<animate|<set\b|<foreignobject|<use\b/i);
  const tags = html.match(/<[a-z][^<>]*>/gi) ?? [];
  for (const tag of tags) {
    expect(tag).not.toMatch(/\son[a-z]+\s*=/i);
    expect(tag).not.toMatch(/javascript:|vbscript:/i);
    expect(tag).not.toMatch(/\s(?:action|formaction|srcdoc|xlink:href)\s*=/i);
    expect(tag).not.toMatch(/url\s*\(/i);
  }
}

describe("UI reference sanitizer: parser-based allowlist", () => {
  const attacks: Array<[string, string]> = [
    ["svg onload without a space", "<svg/onload=alert(1)>"],
    ["img onerror after a slash", '<img src="x"/onerror="alert(1)">'],
    ["javascript: link", `<a href="javascript:alert('x')">x</a>`],
    ["entity-encoded javascript:", '<a href="&#106;avascript:alert(1)">x</a>'],
    ["javascript: split by a tab", '<a href=" java\tscript:alert(1)">x</a>'],
    ["script rebuilt from a nested tag", "<scr<script>ipt>alert(1)</script x>"],
    ["iframe rebuilt from a nested tag", '<ifr<iframe>ame srcdoc="<script>alert(1)</script>">'],
    ["SVG animate setting href", '<svg><animate attributeName="href" values="javascript:alert(1)"/><a href="javascript:x"><text>t</text></a></svg>'],
    ["SVG set and use", '<svg><set attributeName="onmouseover" to="alert(1)"/><use href="https://evil.test/s.svg#x"/></svg>'],
    ["foreignObject", "<svg><foreignObject><iframe src=https://evil.test></iframe></foreignObject></svg>"],
    ["base", '<base href="https://evil.test/">'],
    ["link to a remote stylesheet", '<link href="//evil.test/x.css" rel="stylesheet">'],
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.test">'],
    ["form action and formaction", '<form action="https://evil.test" method="post"><button formaction="https://evil.test">Go</button></form>'],
    ["inline style fetching an image", '<div style="background:url(https://evil.test/x.png); width: 10rem">x</div>'],
    ["style in SVG parsed as markup by a browser", "<svg><style><img src=x onerror=alert(1)></style></svg>"],
    ["noscript whose attribute closes it", '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>'],
    ["object and embed", "<object data=x></object><embed src=x>"],
  ];
  for (const [name, dirty] of attacks) {
    test(`${name} is made inert`, () => {
      const clean = sanitizeHtml(dirty);
      expectInert(clean);
      // Written out canonically: cleaning again changes nothing.
      expect(sanitizeHtml(clean)).toBe(clean);
    });
  }

  test("links stay internal; forms and styles keep what a mockup needs", () => {
    expect(sanitizeHtml('<a href="./dashboard.html">D</a><a href="#top">T</a><a href="https://example.com">E</a>')).toBe(
      '<a href="./dashboard.html">D</a><a href="#top">T</a><a href="#">E</a>',
    );
    expect(sanitizeHtml('<form action="https://evil.test"><button type="submit" formaction="x">Go</button></form>')).toBe('<form><button type="submit">Go</button></form>');
    expect(sanitizeHtml('<div style="background:url(https://evil.test/x.png); width: 10rem">x</div>')).toBe('<div style="width: 10rem">x</div>');
  });

  test("visible text is kept as written (an old regex ate ` once = $5`)", () => {
    expect(sanitizeHtml("<p>Pay once = $5 today</p>")).toBe("<p>Pay once = $5 today</p>");
    expect(sanitizeHtml("<p>US$&amp;nbsp;5 &nbsp; a&lt;b &amp; c</p>")).toBe("<p>US$&amp;nbsp;5 &nbsp; a&lt;b &amp; c</p>");
  });

  test("the kit's markup survives unchanged: icons, details, figures, lists, tables, controls", () => {
    const kit = [
      '<i data-icon="plus" class="x"></i>',
      '<svg class="ds-icon" data-icon="plus" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><circle cx="12" cy="12" r="3"/></svg>',
      '<details class="ds-dropdown" open><summary class="ds-btn">Menu</summary><ol class="ds-steps"><li aria-current="step" data-nid="n4">One</li></ol></details>',
      '<figure class="ds-frame"><figcaption>Dialog: Create project</figcaption><div class="ds-stage" role="dialog" aria-label="Create"></div></figure>',
      '<dl class="ds-dl"><dt>Owner</dt><dd>Alex</dd></dl>',
      '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td colspan="2" data-label="Name">A</td></tr></tbody></table></div>',
      '<label for="q">Search</label><input id="q" class="ds-input" type="search" placeholder="Search…" value="x"><input type="checkbox" checked disabled><select class="ds-select"><option value="a" selected>A</option></select><textarea rows="3">Note</textarea>',
      '<style data-compose>\n.ds-main .x-row{display:flex;gap:1rem}\n</style><div class="x-row">a</div>',
    ].join("");
    expect(sanitizeHtml(kit)).toBe(kit);
  });

  test("an SVG chart keeps its <title>; the document's <title> goes", () => {
    const chart = '<svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img"><title>Revenue by month</title><polyline points="0,40 50,10 100,20" fill="none" stroke="currentColor"/></svg>';
    expect(sanitizeHtml(chart)).toBe(chart);
    const content = sanitizeHtml(extractScreenContent(`<html><head><title>Dashboard</title><meta charset="utf-8"></head><body><h1>Hi</h1>${chart}</body></html>`));
    expect(content).toBe(`<h1>Hi</h1>${chart}`);
  });

  test("a <meta> rebuilt from the pieces of one strip pass is removed, in whole screens and in fragments", () => {
    const rebuilt = '<me<meta>ta http-equiv="refresh" content="0;url=https://evil.test"><p>Hi</p>';
    // What is left is text (`ta http-equiv=… &gt;`), never an element.
    expect(sanitizeHtml(extractScreenContent(`<main>${rebuilt}</main>`))).toBe('ta http-equiv="refresh" content="0;url=https://evil.test"&gt;<p>Hi</p>');
    expect(sanitizeHtml(extractFragment(`<div>${rebuilt}</div>`)!)).not.toMatch(/<meta/i);
    expect(sanitizeHtml(extractFragment('<div><meta http-equiv="refresh" content="0;url=x">ok</div>')!)).toBe("<div>ok</div>");
  });

  test("composition CSS stays text: no `<`, no @import; ux-compose cleans the rest", () => {
    const out = sanitizeHtml("<style>@import url(https://evil.test/a.css); .x-a{display:grid} </style><p>x</p>");
    expect(out).toBe("<style> .x-a{display:grid} </style><p>x</p>");
  });
});

describe("unclosed <style> in page content", () => {
  test("runs to the end of the content and is cleaned like a closed one", () => {
    const content = "<p>x</p><style>.ds-sidebar{display:none} body{background:url(https://evil.test)} .x-a{display:flex}";
    const scoped = scopeComposeStyles(content);
    expect(scoped).toBe("<p>x</p><style data-compose>\n.ds-main .x-a{display:flex}\n</style>");
    // Through the sanitizer (which closes it) and the shell, nothing of it reaches the page.
    const html = assembleScreen({ content: sanitizeHtml(content), spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "a", name: "A" }], currentKey: "a" });
    expect(html).not.toContain("evil.test");
    expect(screenContent(html)).not.toContain(".ds-sidebar{display:none}");
    // The lint sees the block too.
    expect(lintScreenHtml(content, "styled").map((f) => f.rule)).toContain("style-dropped");
  });
});

describe("stored screens carry the mockup CSP", () => {
  test("assembleScreen writes the policy first in the head", () => {
    const html = assembleScreen({ content: "<h1>A</h1>", spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "a", name: "A" }], currentKey: "a" });
    expect(MOCKUP_CSP).toContain("default-src 'none'");
    expect(html).toContain(`<meta charset="utf-8">\n${MOCKUP_CSP}`);
    expect(html.indexOf(MOCKUP_CSP)).toBeLessThan(html.indexOf("<style"));
  });
});

describe("element ids with a real tokenizer", () => {
  test("`>` inside an attribute, optional end tags and comments holding tags do not corrupt the page", () => {
    const content = '<a title="Settings > Billing" href="#">Billing</a><ul><li>One<li>Two</ul><!-- </div><p> --><p>End</p>';
    const out = ensureNodeIds(content);
    expect(out).toBe(
      '<a title="Settings > Billing" href="#" data-nid="n1">Billing</a><ul data-nid="n2"><li data-nid="n3">One<li data-nid="n4">Two</ul><!-- </div><p> --><p data-nid="n5">End</p>',
    );
    // Deterministic and idempotent.
    expect(ensureNodeIds(content)).toBe(out);
    expect(ensureNodeIds(out)).toBe(out);
    // Elements end where a browser ends them.
    const at = (nid: string) => {
      const f = findElement(out, nid)!;
      return out.slice(f.start, f.end);
    };
    expect(at("n1")).toBe('<a title="Settings > Billing" href="#" data-nid="n1">Billing</a>');
    expect(at("n3")).toBe('<li data-nid="n3">One');
    expect(at("n4")).toBe('<li data-nid="n4">Two');
    expect(at("n2")).toBe('<ul data-nid="n2"><li data-nid="n3">One<li data-nid="n4">Two</ul>');
    expect(findElement(out, "n9")).toBeNull();
  });

  test("a duplicated id stays on its first element; later copies are renumbered", () => {
    const out = ensureNodeIds('<div data-nid="n7"><p data-nid="n2">A</p><p data-nid="n2">B</p><p data-nid="bad">C</p></div><input type="text"/>');
    expect(out).toBe('<div data-nid="n7"><p data-nid="n2">A</p><p data-nid="n8">B</p><p data-nid="n9">C</p></div><input type="text" data-nid="n10" />');
    expect(findElement(out, "n2")!.tag).toBe("p");
  });

  test("void, self-closed and nested elements", () => {
    const out = ensureNodeIds('<div><img alt="x"><div><span>a</span></div></div><div>b</div>');
    const f = findElement(out, "n1")!;
    expect(out.slice(f.start, f.end)).toBe('<div data-nid="n1"><img alt="x" data-nid="n2"><div data-nid="n3"><span data-nid="n4">a</span></div></div>');
    const img = findElement(out, "n2")!;
    expect(out.slice(img.start, img.end)).toBe('<img alt="x" data-nid="n2">');
  });

  test("withNodeIds splices by position: `$&` and `$'` in the content are text, not replacement patterns", () => {
    const stored = assembleScreen({ content: "<p>US$&amp;nbsp;5 and $' and $&</p>", spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "a", name: "A" }], currentKey: "a" });
    const numbered = withNodeIds(stored);
    expect(screenContent(numbered)).toBe('<p data-nid="n1">US$&amp;nbsp;5 and $\' and $&</p>');
    expect(numbered.startsWith(stored.slice(0, stored.indexOf("<p>")))).toBe(true);
  });

  test("nodeTexts reads an element as the canvas does", () => {
    expect(nodeTexts('<div data-nid="n1"><style>.x{}</style><h2 data-nid="n2">Open  tasks</h2><span data-nid="n3">3 &amp; more</span></div>')).toEqual([
      { nid: "n1", text: "Open tasks3 & more" },
      { nid: "n2", text: "Open tasks" },
      { nid: "n3", text: "3 & more" },
    ]);
  });
});

describe("comments follow their element after a redraw", () => {
  const comment = (nid: string | null, anchor: string): UxComment => ({ id: nid ?? "x", nid, anchor, text: "t", author_id: "u", created_at: "", resolved_at: null });

  test("kept, moved by anchor text, or detached", () => {
    // The redraw numbered the page from n1 again; "Export" moved from n4 to n2.
    const content = '<div data-nid="n1"><h1 data-nid="n2">Export</h1><button data-nid="n3">Save changes</button></div><p data-nid="n4">Other</p>';
    const [kept, moved, gone, roleOnly, clipped] = reanchorComments(
      [
        comment("n3", "Button: Save changes"),
        comment("n4", "Heading 1: Export"),
        comment("n9", "Button: Delete project"),
        comment("n1", "Card"),
        comment("n7", `Text: ${"Save changes".slice(0, 8)}…`),
      ],
      content,
    )!;
    expect(kept!.nid).toBe("n3");
    expect(moved!.nid).toBe("n2");
    expect(gone!.nid).toBeNull();
    expect(roleOnly!.nid).toBe("n1");
    expect(clipped!.nid).toBe("n3");
  });
});

describe("edits name the version they were made against", () => {
  const history = [
    { content: "b", at: "2026-09-30T10:00:02.000Z", note: "2" },
    { content: "a", at: "2026-09-30T10:00:01.000Z", note: "1" },
  ];

  test("screenBase changes with every history push and pop", () => {
    expect(screenBase({})).toBe("-#0");
    expect(screenBase({ history })).toBe("2026-09-30T10:00:02.000Z#2");
    expect(screenBase({ history: history.slice(1) })).not.toBe(screenBase({ history }));
  });

  test("a restore names its version by time; a stale index is refused", () => {
    expect(historyIndex(history, { at: history[1]!.at })).toBe(1);
    expect(historyIndex(history, { index: 0 })).toBe(0);
    expect(historyIndex(history, { at: history[1]!.at, index: 1 })).toBe(1);
    expect(() => historyIndex(history, { at: history[1]!.at, index: 0 })).toThrow();
    expect(() => historyIndex(history, { at: "2020-01-01T00:00:00.000Z" })).toThrow();
    expect(() => historyIndex(history, { index: 5 })).toThrow();
  });
});
