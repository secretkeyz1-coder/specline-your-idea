import { expect, test } from "bun:test";
import { stripDesignSystem } from "../src/modules/ux/ux-draft.js";
import { phoneTables } from "../src/modules/ux/ux-shell.js";
import { cleanComposeCss } from "../src/modules/ux/ux-compose.js";
import { parseDocument, DomUtils } from "htmlparser2";
import { separateStyles } from "../src/modules/ux/ux-html-parser.js";

test("design stylesheet removal uses attributes, not quoted text", () => {
  const html = stripDesignSystem('<style title="data-design-system >">.keep{display:grid}</style><style data-design-system="yes > no">.drop{display:none}</style><p data-note="a > b">Keep</p>');
  expect(html).toContain(".keep{display:grid}");
  expect(html).not.toContain(".drop");
  expect(DomUtils.getElementsByTagName("p", parseDocument(html), true)[0]?.attribs["data-note"]).toBe("a > b");
});
test("phone table class serialization preserves quoted and entity values", () => {
  const html = phoneTables(`<table data-phone="scroll" class='card odd"quote amp&amp; ds-table-cards' data-note="kept"><tr><td>Cell</td></tr></table>`);
  const table = DomUtils.getElementsByTagName("table", parseDocument(html), true)[0]!;
  expect(table.attribs.class).toContain('odd"quote');
  expect(table.attribs.class).toContain("amp&");
  expect(table.attribs.class).toContain("ds-table-scroll");
  expect(table.attribs.class).not.toContain("ds-table-cards");
  expect(table.attribs["data-note"]).toBe("kept");
  expect(Object.keys(table.attribs)).toEqual(["data-phone", "class", "data-note"]);
});
test("style separation handles quoted angle brackets and preserves other styles", () => {
  const separated = separateStyles('<STYLE title="a > b">.card{display:grid}</STYLE><p>Keep</p><style>.other{gap:1rem}</style>');
  expect(separated.css).toContain(".card{display:grid}");
  expect(separated.css).toContain(".other{gap:1rem}");
  expect(separated.html).toBe("<p>Keep</p>");
});
test("phone table parsing preserves greater-than characters inside attributes", () => {
  const html = phoneTables('<table data-phone="scroll" class="a>b" data-note="c>d"><tr><td>Cell</td></tr></table>');
  const table = DomUtils.getElementsByTagName("table", parseDocument(html), true)[0]!;
  expect(table.attribs.class).toBe("a>b ds-table-scroll");
  expect(table.attribs["data-note"]).toBe("c>d");
});
test("composition CSS ignores malformed inline sourcemap metadata without warnings", () => {
  const clean = cleanComposeCss('.x-card{display:grid;gap:1rem}/*# sourceMappingURL=data:application/json,not-json */');
  expect(clean.css).toBe(cleanComposeCss('.x-card{display:grid;gap:1rem}').css);
  expect(clean.css).toContain("display:grid");
  expect(clean.dropped).toEqual([]);
});
test("composition CSS rejects HTML delimiters without damaging ordinary CSS", () => {
  expect(cleanComposeCss('.x-card{display:grid;gap:1rem}/* harmless */').css).toContain("display:grid");
  expect(cleanComposeCss('.x-card{display:grid}<!-- .x-hidden{display:none} -->').css).toBe("");
  expect(cleanComposeCss('.x-card{display:grid}/* unfinished').css).toBe("");
});
