import { describe, expect, test } from "bun:test";
import { linkRequirementKeys, sectionChanges } from "../src/lib/markdown.js";

describe("sectionChanges", () => {
  const v1 = "# Spec\n\nIntro.\n\n## Functional requirements\n\n### FR-001 — Sign in [P0]\n\nUsers sign in.\n\n### FR-002 — Sign out [P1]\n\nUsers sign out.\n\n## 3. Data\n\nTables.\n";
  test("reports requirements added, removed and changed by key", () => {
    const v2 = "# Spec v2\n\nIntro.\n\n## Functional requirements\n\n### FR-001 — Sign in [P1]\n\nUsers sign in.\n\n### FR-003 — Reset password [P0]\n\nBy email.\n\n## 4. Data\n\nTables.\n";
    const c = sectionChanges(v1, v2);
    expect(c.added).toEqual([{ key: "FR-003", title: "Reset password" }]);
    expect(c.removed).toEqual([{ key: "FR-002", title: "Sign out" }]);
    // Priority moved P0 → P1; the renumbered "Data" section and the retitled document are not changes.
    expect(c.changed).toEqual([{ key: "FR-001", title: "Sign in" }]);
  });
  test("ignores whitespace and headings inside code fences", () => {
    const a = "## Setup\n\nRun it.\n\n```\n## not a heading\n```\n";
    const b = "## Setup\n\nRun   it.\n\n```\n## not a heading\n```\n";
    expect(sectionChanges(a, b)).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe("linkRequirementKeys", () => {
  const href = (k: string) => `/r#req-${k}`;
  test("links known keys in text only", () => {
    const html = '<p>Covers FR-001 and NFR-002.</p><p><code>FR-001</code> <a href="/x">FR-001</a></p><h3>FR-001 — x</h3>';
    expect(linkRequirementKeys(html, ["FR-001"], href)).toBe(
      '<p>Covers <a href="/r#req-FR-001">FR-001</a> and NFR-002.</p><p><code>FR-001</code> <a href="/x">FR-001</a></p><h3>FR-001 — x</h3>',
    );
  });
});
