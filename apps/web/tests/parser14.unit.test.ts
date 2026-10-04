import { expect, test } from "bun:test";
import { foldRequirementSections, renderMarkdown } from "../src/lib/markdown.js";
import { cssEvidenceRules } from "../src/lib/server/template-parser.js";

test("CSS evidence ignores malformed inline sourcemap metadata and retains valid rules", () => {
  const rules = cssEvidenceRules('.card{display:grid}/*# sourceMappingURL=data:application/json,not-json */');
  expect(rules).toEqual(cssEvidenceRules('.card{display:grid}'));
  expect(rules).toEqual([{ selector: ".card", css: ".card{display:grid}" }]);
});

test("requirement folding extracts keys from parsed heading text, retaining inline markup", () => {
  const html = foldRequirementSections('<h4 class="doc-h3">FR-001 <em title="a > b"> — Details</em> [P0]</h4><p>Body</p><h2>Next</h2>');
  expect(html).toContain('id="req-FR-001"');
  expect(html).toContain('<em title="a > b"> — Details</em>');
  expect(html).toContain('<span class="doc-prio">P0</span>');
  expect(html).toContain('</details><h2>Next</h2>');
});
test("folded sanitized Markdown cannot restore script markup", () => {
  const html = foldRequirementSections(renderMarkdown('### FR-002 — Safe [P1]\n\n<script>demo()</script><p>Body</p>', { nested: true }));
  expect(html).toContain('id="req-FR-002"');
  expect(html).not.toContain("<script");
  expect(html).not.toContain("demo()");
});
