import { describe, expect, test } from "bun:test";
import { UX_ELEMENT_SYSTEM_PROMPT, UX_PLAN_SYSTEM_PROMPT, UX_SCREEN_STYLED_SYSTEM_PROMPT, UX_SCREEN_SYSTEM_PROMPT } from "@sdd/ai";
import { UxPlanSchema, UxVisualBriefSchema, type UxPlan, type UxVisualBrief } from "@sdd/contracts";
import { briefBase, briefLines, renderUxMarkdown } from "../src/modules/ux/ux-draft.js";
import { mergeBrief, referenceFromPlan } from "../src/modules/ux/ux-plan.js";
import { classify, repairTargets, UX_RULES } from "../src/modules/ux/ux-rules.js";

const brief = (over: Partial<UxVisualBrief> = {}): UxVisualBrief =>
  UxVisualBriefSchema.parse({
    users: "Cashiers at a busy counter, many short sales an hour",
    devices: "Android tablet in landscape first; a phone must still work",
    direction: "Fast cashier: roomy touch targets, a menu that scans at a glance, the order always visible",
    hierarchy: "The menu catalogue with dish photos leads; the active order and Pay stay in view",
    references: "",
    assumptions: ["Photos of every dish are available"],
    ...over,
  });

describe("product brief (aturan.md §4 Lapis 1)", () => {
  test("the plan's draft is kept as written, marked as drafted from the requirements", () => {
    const drafted = brief();
    expect(mergeBrief(undefined, drafted)).toEqual({ ...drafted, source: "ai" });
    expect(mergeBrief(undefined, undefined)).toBeUndefined();
  });

  test("a brief the person wrote is kept; only its empty parts are filled from the plan's draft", () => {
    const person = brief({ direction: "Calm, for a family restaurant", hierarchy: "", assumptions: [], source: "user" });
    const merged = mergeBrief(person, brief({ hierarchy: "Menu photos lead", assumptions: ["Dish photos exist"] }))!;
    expect(merged.direction).toBe("Calm, for a family restaurant");
    expect(merged.hierarchy).toBe("Menu photos lead");
    expect(merged.assumptions).toEqual(["Dish photos exist"]);
    expect(merged.source).toBe("user");
  });

  test("prompt lines name every part, mark the assumptions, and say it adds no features", () => {
    const lines = briefLines(brief()).join("\n");
    expect(lines).toContain("PRODUCT BRIEF (drafted from the requirements");
    expect(lines).toContain("never adds features");
    expect(lines).toContain("- Visual direction: Fast cashier");
    expect(lines).toContain("Assumed, not stated in the requirements: Photos of every dish are available");
    // An empty part is left out, not printed blank.
    expect(lines).not.toContain("References and limits");
    expect(briefLines(brief({ source: "user" })).join("\n")).toContain("written by the person");
    expect(briefLines(undefined)).toEqual([]);
  });

  test("the base changes with the brief, so an edit made against an older one is caught", () => {
    expect(briefBase(undefined)).toBe("-");
    expect(briefBase(brief())).toBe(briefBase(brief()));
    expect(briefBase(brief({ direction: "Calm" }))).not.toBe(briefBase(brief()));
  });

  test("the plan carries the brief and a shell layout; layout_note is a composition plan", () => {
    const plan: UxPlan = UxPlanSchema.parse({
      applicable: true,
      shell: { layout: "minimal", reason: "One focused job: taking orders" },
      brief: brief(),
      screens: [
        {
          key: "cashier",
          name: "Cashier",
          purpose: "A cashier takes an order and charges it",
          requirement_keys: ["FR-001"],
          layout_note: "The menu grid leads with dish photos; the active order sits in a right column with the total and Pay always visible. ".repeat(3),
        },
      ],
    });
    const ref = referenceFromPlan(plan, { screenCount: null, guidance: "" });
    expect(ref.brief?.source).toBe("ai");
    expect(ref.shell?.layout).toBe("minimal");
    expect(ref.screens[0]!.layout_note!.length).toBeGreaterThan(300);
    const md = renderUxMarkdown(ref);
    expect(md).toContain("Product brief:");
    expect(md).toContain("Composition: The menu grid leads");
  });
});

describe("prompts follow the work, not a recipe (aturan.md §4, §5.7)", () => {
  test("the screen prompt goes goal → brief → composition → examples → output contract and hard limits", () => {
    const at = (needle: string) => {
      const i = UX_SCREEN_SYSTEM_PROMPT.indexOf(needle);
      expect(i).toBeGreaterThanOrEqual(0);
      return i;
    };
    const order = [at("1. The person's goal"), at("2. The brief"), at("3. The composition"), at("How products differ"), at("What you return"), at("Hard limits")];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("a restaurant cashier can put the menu catalogue and the active order");
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("examples, not templates");
  });

  test("no template quotas or mandatory frames are left in the screen prompt", () => {
    expect(UX_SCREEN_SYSTEM_PROMPT).not.toContain("Always start with ds-page-header");
    expect(UX_SCREEN_SYSTEM_PROMPT).not.toMatch(/about \d+ ds-stat cards/);
    expect(UX_SCREEN_SYSTEM_PROMPT).not.toContain("in each ds-stat-head");
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("one clear main title");
    // The kit offers the type roles and media placeholders the renderer styles; gradients stay out of composition CSS.
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("ds-text-display");
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain('class="ds-media-ph"');
    expect(UX_SCREEN_SYSTEM_PROMPT).toContain("drops anything else: literal colours, fonts, gradients");
  });

  test("styled screens apply the guidance to composition, type and media; status tones keep their meaning", () => {
    expect(UX_SCREEN_STYLED_SYSTEM_PROMPT).toContain("composition, typography (the type roles), density, media and colour");
    expect(UX_SCREEN_STYLED_SYSTEM_PROMPT).not.toContain("the kit's type scale is fixed");
    expect(UX_SCREEN_STYLED_SYSTEM_PROMPT).toContain("keep their status meaning");
  });

  test("the plan writes the brief with its assumptions and picks a shell by the work", () => {
    expect(UX_PLAN_SYSTEM_PROMPT).toContain("The product brief (brief) comes first");
    expect(UX_PLAN_SYSTEM_PROMPT).toContain("assumptions");
    expect(UX_PLAN_SYSTEM_PROMPT).toContain('layout "sidebar" for many work areas');
    expect(UX_PLAN_SYSTEM_PROMPT).toContain("not by industry");
    expect(UX_PLAN_SYSTEM_PROMPT).toContain("Never claim to\n  have seen an image");
  });

  test("an element edit gets the brief and keeps the rest of the composition", () => {
    expect(UX_ELEMENT_SYSTEM_PROMPT).toContain("You get the product brief");
    expect(UX_ELEMENT_SYSTEM_PROMPT).toContain("composition stays as it is unless the person asks");
  });
});

describe("rule catalogue after the 2026-10-01 revision (aturan.md §5.2)", () => {
  test("gone: gradient and missing-page-header; stored ones read as advice", () => {
    expect(UX_RULES.gradient).toBeUndefined();
    expect(UX_RULES["missing-page-header"]).toBeUndefined();
    expect(classify({ rule: "gradient", message: "old" })).toMatchObject({ action: "warn", repair: false });
  });

  test("nested and left-accent cards are review only; render-unchecked is never a repair target", () => {
    for (const rule of ["nested-card", "left-accent-card", "render-unchecked"]) expect(UX_RULES[rule]).toMatchObject({ action: "warn", repair: false });
    const findings = ["nested-card", "left-accent-card", "render-unchecked", "drew-shell"].map((rule) => classify({ rule, message: rule }));
    expect(repairTargets(findings).map((f) => f.rule)).toEqual(["drew-shell"]);
  });
});
