import { describe, expect, test } from "bun:test";
import { UX_ELEMENT_SYSTEM_PROMPT, UX_PLAN_SYSTEM_PROMPT, UX_SAMPLE_DATA_SYSTEM_PROMPT, UX_SCREEN_SYSTEM_PROMPT } from "@sdd/ai";
import { MAX_UX_SCREENS, UX_BUDGETS as B, UxPlanSchema } from "@sdd/contracts";
import { cleanComposeCss } from "../src/modules/ux/ux-compose.js";
import { lintScreenHtml, lintUxPlan } from "../src/modules/ux/ux-lint.js";
import { applyStatusTones, draftStatusTones, inferStatusTones } from "../src/modules/ux/ux-status.js";
import { sampleDataLines } from "../src/modules/ux/ux.js";

describe("UI reference budgets: one source for the prompts and the checks", () => {
  test("the prompts state the budgets' numbers", () => {
    expect(UX_PLAN_SYSTEM_PROMPT).toContain(`key_elements: up to ${B.keyElements} is the recommendation (at most ${B.keyElementsPerScreen})`);
    expect(UX_PLAN_SYSTEM_PROMPT).toContain(`at most\n  ${B.overlaysPerScreen} per screen`);
    expect(UX_PLAN_SYSTEM_PROMPT).toContain(`up to ${MAX_UX_SCREENS} for a larger`);
    // Requirements are grouped by job: no requirements-per-screen budget any more.
    expect(UX_PLAN_SYSTEM_PROMPT).not.toMatch(/more than \d+\s+requirements/);
    expect(UX_PLAN_SYSTEM_PROMPT).toContain("ONE screen,\n  even when it serves five requirements");
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`At most ${B.tableColumns} table columns`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`About ${B.blocksUnderHeader} main blocks is a signal`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`at most ${B.pageActions} actions in a page header`);
    // No stat-card quota (aturan.md §4): KPIs only when they help and the data has them.
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("there is no number of stat cards to fill");
    expect(UX_SCREEN_SYSTEM_PROMPT).not.toMatch(/about \d+ ds-stat cards/);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`more than ${B.fullWidthTableColumns} columns spans the\n  full width`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`a table of more than ${B.phoneCardsFromColumns} columns reads on a phone by the task`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`most ${B.phoneCardFacts} facts per card`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`widths of ${B.phoneWidthPx}px or more`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain(`at most ${B.stateFrames} state frames`);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("data-key-element");
    expect(UX_ELEMENT_SYSTEM_PROMPT).toContain(`widths of ${B.phoneWidthPx}px or more`);
    // No template placeholder left unfilled.
    for (const prompt of [UX_PLAN_SYSTEM_PROMPT, UX_SCREEN_SYSTEM_PROMPT, UX_ELEMENT_SYSTEM_PROMPT, UX_SAMPLE_DATA_SYSTEM_PROMPT]) expect(prompt).not.toMatch(/\$\{|undefined/);
  });

  test("the checks hold the same numbers", () => {
    const row = (n: number) => `<tr>${Array.from({ length: n }, (_, i) => `<td>c${i}</td>`).join("")}</tr>`;
    const rules = (html: string) => lintScreenHtml(`<div class="ds-page-header"><h1>T</h1></div>${html}`, "styled").map((f) => f.rule);
    expect(rules(`<table>${row(B.tableColumns)}</table>`)).not.toContain("table-columns");
    expect(rules(`<table>${row(B.tableColumns + 1)}</table>`)).toContain("table-columns");
    const primaries = (n: number) => `<section>${Array.from({ length: n }, () => '<button class="ds-btn ds-btn-primary">x</button>').join("")}</section>`;
    expect(rules(primaries(B.primaryPerArea))).not.toContain("competing-primaries");
    expect(rules(primaries(B.primaryPerArea + 1))).toContain("competing-primaries");
    expect(rules(`<div style="width:${B.phoneWidthPx - 1}px"></div>`)).not.toContain("fixed-width");
    expect(rules(`<div style="width:${B.phoneWidthPx}px"></div>`)).toContain("fixed-width");
    expect(cleanComposeCss(`.x{min-width:${B.phoneWidthPx}px}`).dropped).toHaveLength(1);
    expect(cleanComposeCss(`.x{min-width:${B.phoneWidthPx - 1}px}`).dropped).toHaveLength(0);
    const screen = (elements: number, reqs: number) => ({
      key: "s", name: "S", purpose: "", screen_type: "list" as const, overlays: [], states: [], layout_note: "",
      key_elements: Array.from({ length: elements }, (_, i) => `e${i}`),
      requirement_keys: Array.from({ length: reqs }, (_, i) => `FR-${i}`),
    });
    const plan = (elements: number, reqs: number) => ({ applicable: true, reason: "", recommended_count: 1, count_rationale: "", uncovered_scope: [], no_ui_requirements: [], screens: [screen(elements, reqs)] });
    const lint = (p: ReturnType<typeof plan>) => lintUxPlan(p, { screenCount: null, requirements: [] });
    expect(lint(plan(B.keyElements, 5))).toEqual([]);
    // Many elements are a review signal (a warning), many requirements nothing at all.
    expect(lint(plan(B.keyElements + 1, 9)).map((f) => `${f.action}:${f.rule}`)).toEqual(["warn:busy-screen"]);
    // The plan schema refuses more overlays than the hard limit.
    const overlays = Array.from({ length: B.overlaysPerScreen + 1 }, (_, i) => ({ kind: "dialog", name: `o${i}`, purpose: "" }));
    expect(UxPlanSchema.safeParse({ ...plan(1, 1), screens: [{ ...screen(1, 1), overlays }] }).success).toBe(false);
  });
});

describe("one status, one tone", () => {
  const badge = (tone: string | null, text: string) => `<span class="ds-badge${tone ? ` ds-badge-${tone}` : ""} ds-badge-dot">${text}</span>`;

  test("listed tones are set on every badge showing the status, whole or as one part", () => {
    const html = badge("info", "Pending Approval") + badge("danger", "−7,15% · Terlambat") + badge("warn", "Draft") + badge(null, "3 proyek");
    const { html: out, changed } = applyStatusTones(html, [
      { label: "Pending Approval", tone: "warn" },
      { label: "Terlambat", tone: "danger" },
      { label: "Draft", tone: "neutral" },
    ]);
    expect(changed).toBe(2);
    expect(out).toContain('<span class="ds-badge ds-badge-dot ds-badge-warn">Pending Approval</span>');
    expect(out).toContain('<span class="ds-badge ds-badge-danger ds-badge-dot">−7,15% · Terlambat</span>');
    expect(out).toContain('<span class="ds-badge ds-badge-dot">Draft</span>');
    expect(out).toContain('<span class="ds-badge ds-badge-dot">3 proyek</span>');
    expect(applyStatusTones(out, [{ label: "Pending Approval", tone: "warn" }]).changed).toBe(0);
  });

  test("without a list, the tone most badges use wins; ties, single sightings and numbers are left alone", () => {
    const screens = [
      badge("warn", "Pending Approval") + badge("success", "Approved") + badge("info", "Draft") + badge("warn", "Late"),
      badge("warn", "Pending Approval") + badge("success", "Approved") + badge("warn", "Draft") + badge("danger", "Late"),
      badge("warn", "Pending Approval") + badge(null, "12") + badge("danger", "Rejected") + badge("warn", "Late"),
      badge("info", "Pending Approval") + badge("danger", "Late"),
    ];
    // 3 of 4 is a clear majority; 2-2 (Draft) and 2-2 (Late: maybe a severity split) are left alone.
    const tones = inferStatusTones(screens);
    expect(tones).toEqual([{ label: "Pending Approval", tone: "warn" }]);
    // Badges that already agree need nothing; Late at 2 of 3 is not a clear majority.
    expect(inferStatusTones([screens[0]!, screens[1]!, screens[2]!])).toEqual([]);
    expect(applyStatusTones(screens[3]!, tones).html).toContain('<span class="ds-badge ds-badge-dot ds-badge-warn">Pending Approval</span>');
    expect(draftStatusTones([{ label: "Draft", tone: "neutral" }], screens)).toEqual([{ label: "Draft", tone: "neutral" }]);
  });

  test("the sheet's statuses reach the prompts", () => {
    const lines = sampleDataLines({ records: [], people: [], notes: "", statuses: [{ label: "Pending Approval", tone: "warn" }, { label: "Draft", tone: "neutral" }] });
    expect(lines).toContain("- Status badges (tone class): Pending Approval = ds-badge-warn, Draft = ds-badge");
  });
});
