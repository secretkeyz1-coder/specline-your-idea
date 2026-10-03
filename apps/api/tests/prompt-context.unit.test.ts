import { describe, expect, test } from "bun:test";
import type { DesignArtifact } from "@sdd/contracts";
import { acceptPlanRepair, acceptScreenRepair, lintRepairInstruction, lintScreenHtml, lintUxPlan, planRepairInstruction, uncoveredMustHaves } from "../src/modules/ux/ux-lint.js";
import { classify, finding, isBlocking, repairTargets } from "../src/modules/ux/ux-rules.js";
import { uxApprovalBlockers } from "../src/modules/ux/ux-approval.js";
import { designContextLines, screenConstraint } from "../src/modules/task/service.js";
import { evidenceRunOf, taskEvidenceLines } from "../src/modules/convergence/service.js";
import { projectRulesLines } from "../src/modules/project/service.js";
import { collapseIcons, expandIcons, navIcon, unknownIcons } from "../src/modules/ux/ux-icons.js";
import { historyAfterRestore, referenceFromPlan, sampleDataLines } from "../src/modules/ux/ux.js";
import { NEUTRAL_SPEC, extractFragment, findElement, tidyContent, tidySvg, trimPhoneCards, assembleScreen, ensureNodeIds, extractScreenContent, isFramed, reframeScreens, screenContent, withNodeIds, wrapTables } from "../src/modules/ux/ux-shell.js";

const HEADER = '<div class="ds-page-header"><div><h1>Projects</h1><p class="ds-page-desc">All active projects.</p></div><div class="ds-page-actions"><button class="ds-btn ds-btn-primary" type="button">Create project</button></div></div>';
const rules = (html: string, opts: Parameters<typeof lintScreenHtml>[2] = {}) => lintScreenHtml(html, "styled", opts).map((f) => f.rule);

describe("UI reference lint", () => {
  const LIST_BODY =
    '<div class="ds-toolbar"><div class="ds-field ds-field-grow"><label class="ds-label" for="q">Search</label><input class="ds-input" id="q"></div>' +
    '<div class="ds-field"><label class="ds-label" for="s">Status</label><select class="ds-select" id="s"></select></div>' +
    '<div class="ds-field"><label class="ds-label" for="o">Owner</label><select class="ds-select" id="o"></select></div>' +
    '<div class="ds-field"><label class="ds-label" for="d">Due</label><input class="ds-input" id="d" type="date"></div></div>' +
    '<div class="ds-card ds-card-flush"><table class="ds-table"><tr><td>Tower B</td><td><div class="ds-progress"><span style="width:62%"></span></div></td></tr></table></div>' +
    "<p>© 2026 · Next →</p>";
  const DIALOG =
    '<section class="ds-overlays"><h2>Overlays and states</h2><figure class="ds-frame"><figcaption>Dialog: Create project</figcaption><div class="ds-stage"><div class="ds-modal">' +
    '<div class="ds-modal-header"><h2>Create project</h2></div><div class="ds-form"><div class="ds-field"><label class="ds-label" for="n">Name</label><input class="ds-input" id="n"></div>' +
    '<div class="ds-field"><label class="ds-label" for="a">Start</label><input class="ds-input" id="a"></div><div class="ds-field"><label class="ds-label" for="b">End</label><input class="ds-input" id="b"></div>' +
    '<div class="ds-field"><label class="ds-label" for="c">Budget</label><input class="ds-input" id="c"></div></div>' +
    '<div class="ds-modal-footer"><button class="ds-btn">Cancel</button><button class="ds-btn ds-btn-primary">Create project</button></div></div></div></figure></section>';

  test("a clean list screen with its dialog passes", () => {
    expect(lintScreenHtml(HEADER + LIST_BODY + DIALOG, "styled", { screenType: "list", overlays: 1 })).toEqual([]);
  });

  test("aesthetic rules are warnings the repair turn fixes; they never block approval", () => {
    const html =
      '<aside class="ds-sidebar"><nav>…</nav></aside>' +
      '<style>.hero{background:linear-gradient(90deg,var(--ds-accent),var(--ds-info))}.grid{grid-template-columns:420px 1fr}</style>' +
      "<h1>🚀 Launch</h1><p>Lorem ipsum dolor sit amet</p>" +
      '<button class="ds-btn-primary">A</button><button class="ds-btn-primary">B</button><button class="ds-btn">🗑️</button>';
    const findings = lintScreenHtml(html, "styled");
    const byRule = Object.fromEntries(findings.map((f) => [f.rule, f]));
    for (const rule of ["drew-shell", "emoji-icon", "filler-copy", "fixed-width"]) {
      expect(byRule[rule]).toMatchObject({ category: "guidance", action: "warn", repair: true });
    }
    // A gradient is no finding for being there (aturan.md §5.2); the emoji counted is the one on an action, not the heading's.
    expect(byRule.gradient).toBeUndefined();
    expect(byRule["emoji-icon"]!.message).toContain("🗑");
    // Two primaries at the top level are two areas: advice with context, not something to repair away.
    expect(byRule["two-primaries"]).toMatchObject({ action: "warn", repair: false });
    expect(byRule["competing-primaries"]).toBeUndefined();
    expect(findings.filter(isBlocking)).toEqual([]);
    // A <style> is allowed (composition CSS); what the platform drops from it is reported.
    expect(byRule["style-dropped"]).toBeDefined();
  });

  test("two primaries in one area compete; aesthetic preferences are never repair targets", () => {
    const html = `${HEADER}<section class="ds-section"><button class="ds-btn ds-btn-primary">Save</button><button class="ds-btn ds-btn-primary">Send</button></section>`;
    const findings = lintScreenHtml(html, "neutral");
    expect(findings.map((f) => f.rule)).toContain("competing-primaries");
    expect(repairTargets(findings).map((f) => f.rule)).toContain("competing-primaries");
    // A nested card or a coloured left border is review input; the repair turn never "fixes" a composition back into a template.
    const styled = lintScreenHtml(`${HEADER}<style>.x-a{border-left:4px solid var(--ds-accent)}</style><div class="ds-card"><div class="ds-card">x</div></div>`, "neutral");
    expect(styled.map((f) => f.rule)).toEqual(expect.arrayContaining(["nested-card", "left-accent-card"]));
    expect(repairTargets(styled).map((f) => f.rule)).not.toEqual(expect.arrayContaining(["nested-card"]));
    expect(repairTargets(styled).map((f) => f.rule)).not.toContain("left-accent-card");
  });

  test("a page without a page header is fine when it has one clear main title", () => {
    expect(rules('<h1>Kasir</h1><section class="ds-section"><p>x</p></section>')).not.toContain("missing-page-header");
    expect(rules('<section class="ds-section"><p>x</p></section>')).toContain("missing-h1");
  });

  test("completeness, usability and integrity findings block approval", () => {
    const html =
      '<div class="ds-page-header"><h1>Orders</h1></div>' +
      '<div data-key-element="1" class="ds-card"><input id="q"></div>' +
      '<div class="ds-stat"><div class="ds-stat-value">Rp 12.500.000</div></div><div class="ds-stat"><div class="ds-stat-value">+18%</div></div>' +
      '<div class="ds-stat"><div class="ds-stat-value">3</div></div>' +
      '<p style="color:#ff0000">Hot</p>';
    const sample = { records: [{ kind: "Order", name: "PO-2026-014", facts: "Rp 12.500.000 · due 3 Oct" }], people: [], notes: "", statuses: [], aggregates: [] };
    const findings = lintScreenHtml(html, "styled", { overlays: 1, keyElements: 2, sample });
    const blocking = Object.fromEntries(findings.filter(isBlocking).map((f) => [f.rule, f]));
    expect(Object.keys(blocking).sort()).toEqual(["missing-key-element", "missing-overlay", "raw-colour", "unlabelled-field", "unsourced-metric"]);
    expect(blocking["missing-key-element"]!.message).toContain("Key element 2");
    expect(blocking["missing-key-element"]!.category).toBe("completeness");
    expect(blocking["unlabelled-field"]!.category).toBe("usability");
    // The amount is in the records and 3 is a count of rows; the growth figure has no source.
    expect(blocking["unsourced-metric"]!.message).toContain('"+18%"');
    expect(blocking["unsourced-metric"]!.message).not.toContain("12.500.000");
    // A declared aggregate is a source.
    const withAggregate = { ...sample, aggregates: [{ label: "Growth this month", value: "+18%", basis: "orders, Sep vs Aug" }] };
    expect(lintScreenHtml(html, "styled", { keyElements: 1, sample: withAggregate }).map((f) => f.rule)).not.toContain("unsourced-metric");
  });

  test("budgets are review signals: table columns, blocks and page actions warn; overlay tables do not count", () => {
    const row = (n: number, tag = "td") => `<tr>${Array.from({ length: n }, (_, i) => `<${tag}>c${i}</${tag}>`).join("")}</tr>`;
    const header =
      '<div class="ds-page-header"><div><h1>Tasks</h1></div><div class="ds-page-actions"><button class="ds-btn">A</button><button class="ds-btn">B</button><a class="ds-btn">C</a>' +
      '<button class="ds-btn ds-btn-primary">D</button><details class="ds-dropdown"><summary class="ds-btn">More</summary><div class="ds-menu"><button class="ds-menu-item">E</button></div></details></div></div>';
    const blocks = Array.from({ length: 6 }, () => '<section class="ds-section"><p>x</p></section>').join("");
    const wide = `<table class="ds-table"><thead>${row(6, "th").replace("<th>c0</th>", '<th colspan="3">c0</th>')}</thead><tbody>${row(8)}</tbody></table>`;
    const overlayTable = `<section class="ds-overlays"><figure class="ds-frame"><div class="ds-stage"><div class="ds-sheet"><h2>Detail</h2><table>${row(9)}</table></div></div></figure></section>`;
    const findings = lintScreenHtml(header + blocks + wide + overlayTable, "neutral");
    const byRule = Object.fromEntries(findings.map((f) => [f.rule, f]));
    // A comparison table may need more columns: a warning, not a repair target.
    expect(byRule["table-columns"]).toMatchObject({ action: "warn", repair: false });
    expect(byRule["table-columns"]?.message).toContain("table of 8 columns");
    expect(byRule["too-many-blocks"]?.message).toContain("Has 7 main blocks");
    expect(byRule["too-many-blocks"]?.message).toContain("not a target");
    expect(byRule["page-actions-overuse"]?.message).toContain("has 5 actions");
    expect(byRule["missing-page-header"]).toBeUndefined();
    expect(lintScreenHtml(`${header}<table>${row(7)}</table>`, "neutral").map((f) => f.rule)).not.toContain("table-columns");
  });

  test("a form inline in a list warns; in a form screen it is fine", () => {
    const form = '<form class="ds-form">' + [1, 2, 3, 4].map((i) => `<label class="ds-label" for="f${i}">F${i}</label><input class="ds-input" id="f${i}">`).join("") + "</form>";
    expect(lintScreenHtml(HEADER + form, "styled", { screenType: "list" }).find((f) => f.rule === "inline-form")).toMatchObject({ action: "warn" });
    expect(rules(HEADER + form, { screenType: "form" })).not.toContain("inline-form");
  });

  test("advice: nested cards, missing heading, overlay heading; labels and overlays block", () => {
    const html =
      '<div class="ds-card"><div class="ds-card">x</div></div><input id="q"><select></select>' +
      '<section class="ds-overlays"><figure class="ds-frame"><div class="ds-stage"><div class="ds-modal"><p>No title</p></div></div></figure></section>';
    const findings = lintScreenHtml(html, "neutral", { overlays: 2 });
    expect(findings.map((f) => f.rule).sort()).toEqual(["missing-h1", "missing-overlay", "nested-card", "overlay-no-heading", "unlabelled-field"]);
    expect(findings.filter(isBlocking).map((f) => f.rule).sort()).toEqual(["missing-overlay", "unlabelled-field"]);
  });

  test("a repair that fixes a drawn sidebar by deleting a planned overlay is refused", () => {
    const opts = { screenType: "list" as const, overlays: 1, keyElements: 1 };
    const page = (shell: string, overlays: string) => `${shell}${HEADER}<div data-key-element="1">${LIST_BODY}</div>${overlays}`;
    const first = page('<aside class="ds-sidebar"><nav>…</nav></aside>', DIALOG);
    const lintOf = (html: string) => lintScreenHtml(html, "neutral", opts);
    expect(lintOf(first).map((f) => f.rule)).toContain("drew-shell");
    const dropsDialog = page("", "");
    expect(acceptScreenRepair({ content: first, findings: lintOf(first) }, { content: dropsDialog, findings: lintOf(dropsDialog) })).toBe(false);
    const fixed = page("", DIALOG);
    expect(acceptScreenRepair({ content: first, findings: lintOf(first) }, { content: fixed, findings: lintOf(fixed) })).toBe(true);
    // Losing a key-element marker is refused even when the counts would allow it.
    const unmarked = fixed.replace(' data-key-element="1"', "");
    expect(acceptScreenRepair({ content: first, findings: lintOf(first) }, { content: unmarked, findings: lintScreenHtml(unmarked, "neutral", { ...opts, keyElements: 0 }) })).toBe(false);
  });

  test("plan lint: work-grouped screens are not split; a visible P0 without a screen blocks", () => {
    const screen = (name: string, reqs: string[], elements: number) => ({
      key: name.toLowerCase(),
      name,
      purpose: "",
      requirement_keys: reqs,
      key_elements: Array.from({ length: elements }, (_, i) => `element ${i}`),
      screen_type: "list" as const,
      overlays: [],
      states: [],
      layout_note: "",
    });
    // A list with search, filter, sort, pagination and detail: five requirements, one job, one screen.
    const list = screen("Orders", ["FR-001", "FR-002", "FR-003", "FR-004", "FR-005"], 5);
    const base = { applicable: true, reason: "", recommended_count: 1, count_rationale: "", uncovered_scope: [], no_ui_requirements: [] };
    const reqs = ["FR-001", "FR-002", "FR-003", "FR-004", "FR-005"].map((key) => ({ key, priority: "P0" }));
    expect(lintUxPlan({ ...base, screens: [list] }, { screenCount: null, requirements: reqs })).toEqual([]);

    const requirements = [...reqs, { key: "FR-009", priority: "P0" }, { key: "FR-010", priority: "P0" }, { key: "FR-011", priority: "P2" }, { key: "NFR-001", priority: "P0" }];
    const plan = { ...base, no_ui_requirements: [{ key: "FR-010", reason: "nightly export job" }], screens: [list, screen("Setup", [], 3)] };
    const found = lintUxPlan(plan, { screenCount: null, requirements });
    expect(found.map((f) => `${f.action}:${f.rule}`)).toEqual(["block:uncovered-requirements", "warn:uncovered-requirements-minor", "warn:untraced-screen"]);
    expect(found[0]!.message).toContain("FR-009");
    // Declared as having nothing to see, and qualities, are not uncovered.
    expect(found[0]!.message).not.toContain("FR-010");
    expect(found[0]!.message).not.toContain("NFR-001");
    expect(uncoveredMustHaves(plan, requirements)).toEqual(["FR-009"]);

    // A fixed count the plan cannot meet: a warning the repair turn fixes — unless the plan declares the conflict.
    const fixed = lintUxPlan({ ...base, screens: [list] }, { screenCount: 3, requirements: reqs });
    expect(fixed.map((f) => `${f.action}:${f.rule}`)).toEqual(["warn:wrong-count"]);
    expect(planRepairInstruction(fixed)).toContain("asked for 3 screens");
    const conflict = { uncovered: ["FR-009"], minimum_count: 2, note: "" };
    const declared = lintUxPlan({ ...plan, count_conflict: conflict, screens: [list] }, { screenCount: 1, requirements });
    expect(declared.find((f) => f.rule === "uncovered-requirements")).toMatchObject({ action: "block", repair: false });
    expect(declared.map((f) => f.rule)).not.toContain("wrong-count");
    expect(lintUxPlan({ ...plan, applicable: false }, { screenCount: null, requirements })).toEqual([]);
  });

  test("a plan repair that drops a screen serving a P0 requirement is refused", () => {
    const s = (key: string, reqs: string[]) => ({ key, name: key, purpose: "", requirement_keys: reqs, key_elements: [], screen_type: "list" as const, overlays: [], states: [], layout_note: "" });
    const base = { applicable: true, reason: "", recommended_count: 2, count_rationale: "", uncovered_scope: [], no_ui_requirements: [] };
    const requirements = [{ key: "FR-001", priority: "P0" }, { key: "FR-002", priority: "P0" }];
    const before = { ...base, screens: [s("a", ["FR-001"]), s("x", [])] };
    const lint = (p: typeof before) => lintUxPlan(p, { screenCount: 3, requirements });
    const worse = { ...base, screens: [s("b", ["FR-002"]), s("c", ["FR-002"]), s("d", ["FR-002"])] };
    expect(acceptPlanRepair({ plan: before, findings: lint(before) }, { plan: worse, findings: lint(worse) }, requirements)).toBe(false);
    const better = { ...base, screens: [s("a", ["FR-001"]), s("b", ["FR-002"]), s("c", ["FR-002"])] };
    expect(acceptPlanRepair({ plan: before, findings: lint(before) }, { plan: better, findings: lint(better) }, requirements)).toBe(true);
  });

  test("the repair instruction lists only what the repair turn fixes and asks for <main> only", () => {
    const text = lintRepairInstruction([
      finding("drew-shell", "Draws its own sidebar; return only the page content."),
      finding("too-many-blocks", "Has 7 blocks under the page header."),
    ]);
    expect(text).toContain("sidebar");
    expect(text).toContain('<main class="ds-main">');
    expect(text).toContain("data-key-element");
    expect(text).not.toContain("Has 7 blocks");
  });

  test("findings stored before categories are read by their rule", () => {
    expect(classify({ rule: "phone-overflow", message: "m" })).toMatchObject({ action: "warn" });
    expect(classify({ rule: "cut-off-action", message: "m" })).toMatchObject({ action: "block", category: "usability" });
    expect(classify({ rule: "no-such-rule", message: "m" })).toMatchObject({ action: "warn", repair: false });
  });
});

describe("UI reference approval", () => {
  const drawn = (content: string) => assembleScreen({ content, spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "orders", name: "Orders" }], currentKey: "orders" });
  const ref = (content: string, extra: Record<string, unknown> = {}) =>
    ({
      applicable: true,
      reason: "",
      rules_version: 2,
      fidelity: "neutral",
      screens: [{ key: "orders", name: "Orders", purpose: "", requirement_keys: ["FR-001"], key_elements: ["Orders table"], screen_type: "list", overlays: [], html: drawn(content) }],
      ...extra,
    }) as never;
  const ok = `${HEADER}<div data-key-element="1"><p>Orders</p></div>`;

  test("drawn screens are necessary, not enough: blocking findings are recomputed from the stored HTML", () => {
    expect(uxApprovalBlockers(ref(ok), [{ key: "FR-001", priority: "P0" }])).toEqual([]);
    // Stored lint said nothing; the recomputed check still finds the unlabelled field and the missing key element.
    const blockers = uxApprovalBlockers(ref(`${HEADER}<input id="x">`), [{ key: "FR-001", priority: "P0" }]);
    expect(blockers.map((b) => b.rule).sort()).toEqual(["missing-key-element", "unlabelled-field"]);
    // Render findings come from what was stored with the drawing.
    const stored = ref(ok);
    (stored as { screens: Array<{ lint: unknown }> }).screens[0]!.lint = [{ rule: "cut-off-action", severity: "P0", message: "Export cut off" }];
    expect(uxApprovalBlockers(stored, []).map((b) => b.rule)).toEqual(["cut-off-action"]);
  });

  test("left-out scope must be confirmed; a visible P0 with no screen blocks", () => {
    const reqs = [{ key: "FR-001", priority: "P0" }, { key: "FR-002", priority: "P0" }];
    expect(uxApprovalBlockers(ref(ok), reqs).map((b) => b.rule)).toEqual(["uncovered-requirements"]);
    const conflict = { count_conflict: { uncovered: ["FR-002"], minimum_count: 2, note: "" } };
    expect(uxApprovalBlockers(ref(ok, conflict), reqs).map((b) => b.rule).sort()).toEqual(["scope-unconfirmed", "uncovered-requirements"]);
    expect(uxApprovalBlockers(ref(ok, { ...conflict, scope_confirmed_at: "2026-09-30T00:00:00Z" }), reqs)).toEqual([]);
    // A reference planned before the new rules is not held to checks it could not know.
    expect(uxApprovalBlockers(ref(`${HEADER}<p>Orders</p>`, { rules_version: undefined }), reqs)).toEqual([]);
  });
});

describe("UI reference shell", () => {
  const screens = [
    { key: "dashboard", name: "Dashboard" },
    { key: "projects", name: "Projects" },
  ];

  test("reads the model's <main> content whatever it wrapped around it", () => {
    const raw = '<think>x</think>```html\n<!-- PLAN: header, table -->\n<main class="ds-main"><h1>Projects</h1></main>\n```\nDone.';
    expect(extractScreenContent(raw)).toBe("<h1>Projects</h1>");
    expect(extractScreenContent("<!doctype html><html><head><title>t</title></head><body><h1>B</h1></body></html>")).toBe("<h1>B</h1>");
    expect(extractScreenContent("<h1>Fragment</h1>")).toBe("<h1>Fragment</h1>");
  });

  test("every table gets a scroll wrapper, once", () => {
    const wrapped = wrapTables('<table class="ds-table"><tr><td>a</td></tr></table><div class="ds-table-wrap"><table><tr><td>b</td></tr></table></div>');
    expect(wrapped.match(/ds-table-wrap/g)?.length).toBe(2);
    expect(wrapped.startsWith('<div class="ds-table-wrap"><table')).toBe(true);
  });

  test("the platform builds one shell: brand, icon navigation with the current screen, header, mobile menu", () => {
    const html = assembleScreen({ content: "<h1>Projects</h1>", spec: NEUTRAL_SPEC, brand: "Aplikasi PM", screens, currentKey: "projects" });
    expect(html).toMatch(/<a href="\.\/projects\.html" aria-current="page"><svg class="ds-icon" data-icon="folder-kanban"[^>]*>.*?<\/svg><span>Projects<\/span><\/a>/);
    expect(html).toContain('data-icon="layout-dashboard"');
    expect(html).toContain("<span>Dashboard</span>");
    expect(html).toContain("ds-app-header");
    expect(html).toContain('<span aria-current="page">Projects</span>');
    expect(html).toContain("ds-mobile-menu");
    expect(html).toContain("data-design-system");
    expect(screenContent(html)).toBe("<h1>Projects</h1>");
    expect(isFramed(html)).toBe(true);
  });

  test("icons: placeholders become Lucide SVG, keep their id, and collapse back for the model", () => {
    const content = '<button class="ds-btn ds-btn-primary"><i data-icon="plus" data-nid="n4"></i>Create project</button><i class="ds-muted" data-icon="no-such-icon"></i>';
    const svg = expandIcons(content);
    expect(svg).toContain('<svg class="ds-icon" data-icon="plus" data-nid="n4" xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<path d="M5 12h14"/>');
    expect(svg).toContain('class="ds-icon ds-muted" data-icon="no-such-icon"');
    expect(expandIcons(svg)).toBe(svg);
    expect(collapseIcons(svg)).toBe('<button class="ds-btn ds-btn-primary"><i data-icon="plus" data-nid="n4"></i>Create project</button><i data-icon="no-such-icon" class="ds-muted"></i>');
    expect(unknownIcons(content)).toEqual(["no-such-icon"]);
    expect(lintScreenHtml(`<h1>X</h1>${content}`, "neutral").map((f) => f.rule)).toContain("unknown-icon");
  });

  test("kit variants get their base class, charts get a scroll wrapper, both once", () => {
    const html = '<button class="ds-btn-primary">Cetak</button><span class="ds-badge-success ds-badge-dot">OK</span><button class="ds-btn ds-btn-sm">x</button>'
      + '<svg viewBox="0 0 600 300"><path d="M0 0"/></svg><svg class="ds-icon" data-icon="plus" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
    const once = tidyContent(html);
    expect(once).toContain('<button class="ds-btn ds-btn-primary">');
    expect(once).toContain('<span class="ds-badge ds-badge-success ds-badge-dot">');
    expect(once).toContain('<button class="ds-btn ds-btn-sm">');
    expect(once).toContain('<div class="ds-chart"><svg viewBox="0 0 600 300">');
    expect(once.match(/ds-chart/g)?.length).toBe(1);
    expect(tidyContent(once)).toBe(once);
  });

  test("phone cards keep a title and 4 facts, status columns last to go; trimmed tables are left alone", () => {
    const head = '<tr><th class="ds-check"></th><th>Paket</th><th>Vendor</th><th>Volume</th><th>Progres</th><th>Bukti</th><th>Status</th><th class="ds-actions">Aksi</th></tr>';
    const row = '<tr><td class="ds-check"><input type="checkbox"></td><td data-label="Paket">WBS 2.1</td><td data-label="Vendor">PT A</td><td data-label="Volume">25</td><td data-label="Progres">85%</td><td data-label="Bukti">2 berkas</td><td data-label="Status"><span class="ds-badge ds-badge-warn">Pending</span></td><td class="ds-actions"><button class="ds-btn">Tinjau</button></td></tr>';
    const table = `<table class="ds-table ds-table-cards"><thead>${head}</thead><tbody>${row}${row}</tbody></table>`;
    const out = trimPhoneCards(table);
    expect(out.match(/ds-hide-sm/g)?.length).toBe(3);
    expect(out).toContain('<th class="ds-hide-sm">Bukti</th>');
    expect(out).toContain('<td class="ds-hide-sm" data-label="Bukti">');
    expect(out).toContain('<td data-label="Status">');
    expect(trimPhoneCards(out)).toBe(out);
    const short = '<table class="ds-table ds-table-cards"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    expect(trimPhoneCards(short)).toBe(short);
  });

  test("element edit: the part with a data-nid is found by matching tags, and only a fragment is accepted", () => {
    const html =
      '<div class="ds-card" data-nid="n1"><div class="ds-row" data-nid="n2"><div data-nid="n3">a</div><input data-nid="n4" /></div><div data-nid="n5">b</div></div><a data-nid="n6">x</a><abbr data-nid="n7">y</abbr>';
    const part = (nid: string) => {
      const f = findElement(html, nid);
      return f ? html.slice(f.start, f.end) : null;
    };
    expect(part("n2")).toBe('<div class="ds-row" data-nid="n2"><div data-nid="n3">a</div><input data-nid="n4" /></div>');
    expect(part("n1")).toBe(html.slice(0, html.indexOf("<a ")));
    expect(part("n4")).toBe('<input data-nid="n4" />');
    expect(part("n6")).toBe('<a data-nid="n6">x</a>');
    expect(part("n9")).toBeNull();
    expect(part('n1"] , [x')).toBeNull();

    expect(extractFragment('Here:\n```html\n<div class="ds-tabs">t</div>\n```')).toBe('<div class="ds-tabs">t</div>');
    expect(extractFragment('<main class="ds-main"><h1>All</h1></main>')).toBeNull();
    expect(extractFragment("no html")).toBeNull();
  });

  test("restoring a version keeps the current one in the history and drops the restored entry", () => {
    const v = (content: string, note: string) => ({ content, at: "2026-09-29T10:00:00.000Z", note });
    const history = [v("c3", "Swap columns"), v("c2", "AI change to table"), v("c1", "Redrawn by AI")];
    const next = historyAfterRestore(history, 1, "c4", "2026-09-29T11:00:00.000Z");
    expect(next.map((h) => h.content)).toEqual(["c4", "c3", "c1"]);
    expect(next[0]!.note).toBe('Restore to the version before "AI change to table"');
    // Restoring that entry again brings the version back: restore is its own redo.
    const back = historyAfterRestore(next, 0, "c2", "2026-09-29T12:00:00.000Z");
    expect(back.map((h) => h.content)).toEqual(["c2", "c3", "c1"]);
    expect(back[0]!.note).toBe('Restore to the version before "AI change to table"');
    // A cut note (no closing quote) and the first wording unwrap too.
    const cut = [v("x", `Restored the version before "Restored the version before "${"long ".repeat(40)}`)];
    expect(historyAfterRestore(cut, 0, "y", "t")[0]!.note).toBe(`Restore to the version before "${"long ".repeat(40)}`.slice(0, 160));
    const full = Array.from({ length: 5 }, (_, i) => v(`c${i}`, `n${i}`));
    expect(historyAfterRestore(full, 4, "now", "t")).toHaveLength(5);
  });

  test("shared example data: carried by the plan, given to prompts, and a screen showing none of it is flagged", () => {
    const sheet = {
      records: [
        { kind: "Proyek", name: "Pembangunan Gudang Logistik Cikarang", facts: "PRJ-2026-001 · progres 58,45% · baseline v2.0" },
        { kind: "Proyek", name: "Gedung Kantor Cabang Surabaya", facts: "" },
      ],
      people: [{ name: "Hendra Wijaya", role: "Project Director" }],
      notes: "Hari ini 29 Sep 2026",
    };
    const lines = sampleDataLines(sheet);
    expect(lines[0]).toStartWith("SHARED EXAMPLE DATA");
    expect(lines).toContain("- Proyek: Pembangunan Gudang Logistik Cikarang — PRJ-2026-001 · progres 58,45% · baseline v2.0");
    expect(lines).toContain("- People: Hendra Wijaya (Project Director)");
    expect(sampleDataLines(undefined)).toEqual([]);

    const plan = { applicable: true, reason: "", recommended_count: 1, count_rationale: "", screens: [], sample_data: sheet };
    expect(referenceFromPlan(plan as never, { screenCount: null, guidance: "" }).sample_data).toEqual(sheet);
    expect(referenceFromPlan({ ...plan, sample_data: undefined } as never, { screenCount: null, guidance: "" }).sample_data).toBeUndefined();

    const names = sheet.records.map((r) => r.name);
    const off = (html: string) => lintScreenHtml(html, "styled", { sampleNames: names }).map((f) => f.rule).includes("off-sheet-data");
    expect(off('<div class="ds-page-header"><h1>WBS</h1></div><p>Proyek Renovasi RSUD Sidoarjo</p>')).toBe(true);
    // The short form of a record's name counts.
    expect(off('<div class="ds-page-header"><h1>WBS</h1></div><p>Gudang Logistik Cikarang · Tahap 2</p>')).toBe(false);
    expect(lintScreenHtml("<h1>X</h1>", "styled", {}).map((f) => f.rule)).not.toContain("off-sheet-data");
  });

  test("svg sizes a browser rejects are dropped", () => {
    expect(tidySvg('<svg viewBox="0 0 10 10" width="100%" height="auto"><path d="M0 0"/></svg>')).toBe('<svg viewBox="0 0 10 10" width="100%"><path d="M0 0"/></svg>');
  });

  test("navigation icons follow the screen's words, English or Indonesian, then its type", () => {
    expect(navIcon({ key: "daftar-tugas", name: "Daftar Tugas" })).toBe("list-checks");
    expect(navIcon({ key: "laporan", name: "Laporan Proyek" })).toBe("chart-column");
    expect(navIcon({ key: "proyek", name: "Detail Proyek" })).toBe("folder-kanban");
    expect(navIcon({ key: "x", name: "Ringkasan" })).toBe("layout-dashboard");
    expect(navIcon({ key: "x", name: "Something", screen_type: "settings" })).toBe("settings");
    expect(navIcon({ key: "x", name: "Something" })).toBe("file");
  });

  test("settings screens sit apart at the foot of the sidebar", () => {
    const html = assembleScreen({
      content: "<h1>Pengaturan</h1><p>Simpan perubahan dan tambah anggota untuk proyek ini.</p>",
      spec: NEUTRAL_SPEC,
      brand: "PM",
      screens: [...screens, { key: "pengaturan", name: "Pengaturan", screen_type: "settings" }],
      currentKey: "pengaturan",
    });
    expect(html).toMatch(/ds-side-nav-secondary" aria-label="Settings">\s*<a href="\.\/pengaturan\.html" aria-current="page">/);
    expect(html).toContain("Cari…");
  });

  test("adding a screen re-frames the others so their navigation lists it", () => {
    const first = assembleScreen({ content: "<h1>Dashboard</h1>", spec: NEUTRAL_SPEC, brand: "PM", screens, currentKey: "dashboard" });
    const ref = {
      applicable: true,
      reason: "",
      screens: [
        { key: "dashboard", name: "Dashboard", purpose: "", requirement_keys: [], key_elements: [], html: first },
        { key: "projects", name: "Projects", purpose: "", requirement_keys: [], key_elements: [], html: null },
        { key: "reports", name: "Reports", purpose: "", requirement_keys: [], key_elements: [], html: "<!doctype html><html><body>legacy</body></html>" },
      ],
    };
    const next = reframeScreens(ref, NEUTRAL_SPEC, "PM");
    expect(next.screens[0]!.html).toContain('href="./reports.html"');
    expect(screenContent(next.screens[0]!.html!)).toBe("<h1>Dashboard</h1>");
    expect(next.screens[2]!.html).toBe("<!doctype html><html><body>legacy</body></html>");
  });
});

describe("task decomposition context", () => {
  const design = {
    overview: "Polls app.",
    architecture: { summary: "SvelteKit + Postgres.", diagram_text: "src/routes — pages\nsrc/lib/server — services" },
    components: [{ name: "PollService", responsibility: "Implements FR-001", interfaces: "createPoll(input)" }],
    data_model: "Poll(id uuid pk, title text)",
    api_contracts: "POST /api/polls → 201",
    state_machines: "Poll: OPEN → CLOSED",
    requirement_coverage: [],
    testing_strategy: "Vitest; run `bun run test`; tests in tests/*.test.ts",
    security: "Owner-only close.",
    deployment: "PORT=3000, DATABASE_URL",
    unresolved_decisions: [{ description: "Email provider", blocking: true }],
  } satisfies DesignArtifact;

  test("sends the sections verification commands depend on", () => {
    const text = designContextLines(design).join("\n");
    for (const part of ["bun run test", "PORT=3000", "src/lib/server", "createPoll(input)", "Poll(id uuid pk", "POST /api/polls", "OPEN → CLOSED", "[blocking] Email provider"]) {
      expect(text).toContain(part);
    }
  });

  test("tolerates revisions stored before a field existed", () => {
    const old = { overview: "Old design", architecture: { summary: "x" } } as unknown as DesignArtifact;
    const text = designContextLines(old).join("\n");
    expect(text).toContain("Old design");
    expect(text).not.toContain("UNRESOLVED");
    expect(designContextLines(null)[0]).toContain("no structured content");
  });

  test("the screen constraint follows what was approved", () => {
    expect(screenConstraint(false, false)).toContain("visual styling follows the stack");
    expect(screenConstraint(false, true)).toContain("docs/design-system/DESIGN.md");
    expect(screenConstraint(true, true)).toContain("look follow <file>");
  });

  test("project rules are a block only when there are rules", () => {
    expect(projectRulesLines([], "x")).toEqual([]);
    expect(projectRulesLines(["No external SaaS"], "every task must respect them").join("\n")).toContain("- No external SaaS");
  });
});

describe("convergence evidence", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, s));
  const run = (id: string, attempt: number, status: string, summary: string) =>
    ({ id, taskId: "t1", attempt, status, summary, commitSha: `sha-${id}`, filesChanged: [`src/${id}.ts`] }) as never;
  const review = (runId: string | null, decision: string, s: number) => ({ taskId: "t1", runId, decision, createdAt: at(s) }) as never;
  const result = (runId: string, command: string, status: string, s: number) => ({ runId, command, status, createdAt: at(s) }) as never;

  test("uses the run the approving review decided on, not an older attempt", () => {
    const runs = [run("r2", 2, "FINISHED", "second, approved"), run("r1", 1, "FAILED", "first, failed")];
    const chosen = evidenceRunOf("t1", runs, [review("r1", "CHANGES_REQUESTED", 1), review("r2", "APPROVED", 2)]);
    expect((chosen as unknown as { id: string }).id).toBe("r2");
  });

  test("falls back to the highest finished attempt without an approving review", () => {
    const runs = [run("r1", 1, "FINISHED", "a"), run("r3", 3, "FAILED", "c"), run("r2", 2, "FINISHED", "b")];
    expect((evidenceRunOf("t1", runs, []) as unknown as { id: string }).id).toBe("r2");
  });

  test("shows the latest result per verification command of that run only", () => {
    const r = run("r2", 2, "FINISHED", "done");
    const text = taskEvidenceLines({ key: "T-1", title: "Close poll", requirementKeys: ["FR-004"] }, r, [review("r2", "APPROVED", 5)], [
      result("r2", "bun  test", "FAILED", 1),
      result("r2", "bun test", "PASSED", 2),
      result("r1", "bun run lint", "PASSED", 3),
    ]);
    expect(text).toContain("`bun test` PASSED");
    expect(text).not.toContain("FAILED");
    expect(text).not.toContain("bun run lint");
    expect(text).toContain("src/r2.ts");
    expect(text).toContain("review: APPROVED");
  });
});

describe("UI reference element ids", () => {
  test("numbers elements in document order, skipping svg internals, and keeps existing ids", () => {
    const html = '<div class="ds-card"><h2>Title</h2><input class="ds-input" /><svg><path d="M0 0"/></svg></div>';
    const once = ensureNodeIds(html);
    expect(once).toBe('<div class="ds-card" data-nid="n1"><h2 data-nid="n2">Title</h2><input class="ds-input" data-nid="n3" /><svg data-nid="n4"><path d="M0 0"/></svg></div>');
    expect(ensureNodeIds(once)).toBe(once);
    expect(ensureNodeIds(once + "<p>new</p>")).toContain('<p data-nid="n5">new</p>');
  });

  test("screens stored without ids get the same ids on read as a later save gives them", () => {
    const framed = assembleScreen({ content: "<h1>Projects</h1><p>x</p>", spec: NEUTRAL_SPEC, brand: "PM", screens: [{ key: "a", name: "A" }], currentKey: "a" });
    const read = withNodeIds(framed);
    expect(screenContent(read)).toBe(ensureNodeIds("<h1>Projects</h1><p>x</p>"));
    expect(withNodeIds(read)).toBe(read);
  });
});
