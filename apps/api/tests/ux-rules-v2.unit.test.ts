import { describe, expect, test } from "bun:test";
import { contentFingerprint } from "../src/modules/artifact/service.js";
import { NEUTRAL_SPEC, assembleScreen, phoneTables, tidyContent } from "../src/modules/ux/ux-shell.js";
import { referenceFromPlan } from "../src/modules/ux/ux.js";
import { screenBehaviourLines } from "../src/modules/task/service.js";

/** The rules of aturan.md (2026-09-30) that are not lint: phone tables, the shell, lineage. */

const table = (attrs: string) =>
  `<table class="ds-table ds-table-cards"${attrs}><thead><tr><th>Item</th><th data-priority>Price</th><th>Stock</th><th>Supplier</th><th>Region</th><th class="ds-actions"></th></tr></thead>` +
  `<tbody><tr><td>Rice 5kg</td><td>Rp 75.000</td><td>120</td><td>PT Beras</td><td>Jawa</td><td class="ds-actions">…</td></tr></tbody></table>`;

describe("tables on a phone, chosen by the task", () => {
  test("scroll keeps a comparison table a table, its first column held", () => {
    const out = phoneTables(table(' data-phone="scroll"'));
    expect(out).toContain('class="ds-table ds-table-scroll"');
    expect(out).not.toContain("ds-table-cards");
    expect(out).not.toContain("ds-hide-sm");
  });

  test("priority shows the marked columns (and the first and the actions); the rest hide on a phone", () => {
    const out = phoneTables(table(' data-phone="priority"'));
    expect(out).toContain("ds-table-priority");
    expect(out.match(/ds-hide-sm/g)?.length).toBe(6); // Stock, Supplier, Region — header and row
    expect(out).toContain("<td>Rice 5kg</td>");
    expect(out).toContain("<td>Rp 75.000</td>");
  });

  test("card labels every cell from its header; the treatment is idempotent", () => {
    const out = phoneTables(table(' data-phone="card"'));
    expect(out).toContain('<td data-label="Price">Rp 75.000</td>');
    expect(phoneTables(out)).toBe(out);
    expect(tidyContent(tidyContent(table(' data-phone="expand"')))).toBe(tidyContent(table(' data-phone="expand"')));
  });

  test("without data-phone the table is left to the default", () => {
    expect(phoneTables(table(""))).toBe(table(""));
  });
});

describe("the shell shows only what the requirements ask for", () => {
  // The elements, not the stylesheet rules that name the same classes.
  const SEARCH = '<span class="ds-header-search">';
  const BELL = 'ds-header-bell" aria-label';
  const USER = '<div class="ds-sidebar-foot">';
  const frame = (shell?: { search: boolean; notifications: boolean; account: boolean; reason: string }) =>
    assembleScreen({ content: "<h1>Orders</h1>", spec: NEUTRAL_SPEC, brand: "Shop", screens: [{ key: "orders", name: "Orders" }], currentKey: "orders", shell });

  test("nothing asked for: no search, no bell, no user", () => {
    const html = frame({ search: false, notifications: false, account: false, reason: "" });
    expect(html).not.toContain(SEARCH);
    expect(html).not.toContain(BELL);
    expect(html).not.toContain(USER);
    expect(html).toContain("ds-side-nav");
  });

  test("each utility on its own; an older reference keeps its full shell", () => {
    const html = frame({ search: true, notifications: false, account: true, reason: "FR-004 search, FR-001 sign-in" });
    expect(html).toContain(SEARCH);
    expect(html).not.toContain(BELL);
    expect(html).toContain(USER);
    const legacy = frame();
    for (const part of [SEARCH, BELL, USER]) expect(legacy).toContain(part);
  });

  test("a new plan without a shell answer gets none, and carries the rule set", () => {
    const ref = referenceFromPlan(
      { applicable: true, reason: "", recommended_count: 1, count_rationale: "", uncovered_scope: [], no_ui_requirements: [], screens: [] } as never,
      { screenCount: null, guidance: "" },
    );
    expect(ref.shell).toEqual({ search: false, notifications: false, account: false, reason: "" });
    expect(ref.rules_version).toBe(2);
  });
});

describe("STALE follows content, not the act of approving", () => {
  const rev = (structured: unknown, content = "# UI reference") => ({ content, structuredContent: structured as never });

  test("the same content approved again has the same fingerprint, whatever the key order", () => {
    expect(contentFingerprint(rev({ a: 1, b: { c: 2, d: 3 } }))).toBe(contentFingerprint(rev({ b: { d: 3, c: 2 }, a: 1 })));
    expect(contentFingerprint(rev({ a: 1 }))).not.toBe(contentFingerprint(rev({ a: 2 })));
    expect(contentFingerprint(rev({ a: 1 }, "other"))).not.toBe(contentFingerprint(rev({ a: 1 })));
  });

  test("review records (findings, comments, history, the scope confirmation) are not content", () => {
    const screen = { key: "orders", html: "<main>x</main>" };
    const plain = rev({ applicable: true, screens: [screen] });
    const reviewed = rev({
      applicable: true,
      plan_lint: [{ rule: "busy-screen" }],
      scope_confirmed_at: "2026-09-30T00:00:00Z",
      screens: [{ ...screen, lint: [{ rule: "gradient" }], comments: [{ id: "c1" }], history: [{ content: "old" }], revision_note: "tweak" }],
    });
    expect(contentFingerprint(reviewed)).toBe(contentFingerprint(plain));
    expect(contentFingerprint(rev({ applicable: true, screens: [{ ...screen, html: "<main>y</main>" }] }))).not.toBe(contentFingerprint(plain));
  });
});

describe("a mockup shows how a screen looks, not that it works", () => {
  test("the behaviour to build and test comes with every screen", () => {
    const lines = screenBehaviourLines({
      primary_action: { label: "Create order", result: "the order opens in its sheet" },
      overlays: [{ kind: "dialog", name: "Create order", purpose: "", result: "toast \"Order created\"" }],
      states: [{ state: "Save failed", when: "the server refuses", response: "the form keeps its values and says why" }],
    });
    expect(lines).toEqual([
      'primary action "Create order" → the order opens in its sheet',
      'dialog "Create order" → toast "Order created"',
      'state "Save failed" (the server refuses): the form keeps its values and says why',
    ]);
  });
});
