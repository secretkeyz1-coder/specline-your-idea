import { describe, expect, test } from "bun:test";
import { extractScreenContent, partialScreenContent } from "../src/modules/ux/ux-shell.js";
import { sanitizeHtml } from "../src/modules/ux/ux-sanitize.js";

/** The live preview of a screen being drawn: what part of an unfinished answer is shown. */
describe("partialScreenContent", () => {
  test("nothing before the content starts", () => {
    expect(partialScreenContent("")).toBe("");
    expect(partialScreenContent("<!doctype html><html><head><title>T")).toBe("");
    expect(partialScreenContent("<think>planning the layout")).toBe("");
  });

  test("the inside of <main> so far, without a half-written tag", () => {
    expect(partialScreenContent('<main class="ds-main"><h1>Orders</h1><div cla')).toBe("<h1>Orders</h1>");
    expect(partialScreenContent("```html\n<main><h1>Orders</h1><p>Two")).toBe("<h1>Orders</h1><p>Two");
  });

  test("an unfinished plan comment is not shown", () => {
    expect(partialScreenContent("<!-- PLAN: a table of orders")).toBe("");
    expect(partialScreenContent("<!-- PLAN: x --><h1>Orders</h1><!-- note")).toBe("<h1>Orders</h1>");
  });

  test("a complete answer gives what the stored drawing starts from", () => {
    const answer = '```html\n<!doctype html><html><body><main class="ds-main"><h1>Orders</h1><p>Two open</p></main></body></html>\n```';
    expect(partialScreenContent(answer)).toBe(extractScreenContent(answer));
  });

  test("unclosed elements are closed by the sanitizer, scripts never pass", () => {
    const html = sanitizeHtml(partialScreenContent("<main><section><h1>Orders</h1><script>alert(1)</script><ul><li>One"));
    expect(html).not.toContain("script");
    expect(html).toContain("<li>One</li></ul></section>");
  });
});
