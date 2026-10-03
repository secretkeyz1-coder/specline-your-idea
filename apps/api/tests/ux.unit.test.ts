import { describe, expect, test } from "bun:test";
import { UxPlanSchema } from "@sdd/contracts";
import { extractHtml, referenceFromPlan, sanitizeHtml } from "../src/modules/ux/ux.js";

describe("UI reference HTML handling", () => {
  test("keeps only the document when the model wraps it in prose, fences or thinking", () => {
    const raw = [
      "<think>plan the layout</think>",
      "Here is the screen:",
      "```html",
      "<!doctype html><html><head><title>x</title></head><body><h1>Create poll</h1></body></html>",
      "```",
      "Let me know if you want changes.",
    ].join("\n");
    const html = extractHtml(raw);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.endsWith("</html>")).toBe(true);
    expect(html).not.toContain("Let me know");
    expect(html).not.toContain("plan the layout");
  });

  test("strips everything active before the document is stored or written to a repo", () => {
    const dirty = [
      "<html><head>",
      '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
      "<style>@import url(https://evil.example/a.css); body{color:#111}</style>",
      "<script>fetch('https://evil.example')</script>",
      '<script src="https://evil.example/x.js"></script>',
      "</head><body>",
      '<button onclick="steal()" type="button">Vote</button>',
      '<a href="javascript:alert(1)">link</a>',
      '<iframe src="https://evil.example"></iframe>',
      "<object data='x'></object>",
      "</body></html>",
    ].join("");
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/<iframe/i);
    expect(clean).not.toMatch(/<object/i);
    expect(clean).not.toMatch(/cdn\.example\.com/);
    expect(clean).not.toMatch(/@import/i);
    // Inert content survives.
    expect(clean).toContain('<button type="button">Vote</button>');
    expect(clean).toContain("body{color:#111}");
  });
});

describe("UI reference screen count", () => {
  const plan = (n: number, recommended = n) =>
    UxPlanSchema.parse({
      applicable: true,
      recommended_count: recommended,
      count_rationale: "One screen per place people work.",
      screens: Array.from({ length: n }, (_, i) => ({ key: "screen", name: `Screen ${i + 1}`, purpose: "p" })),
    });

  test("keeps the AI's own number when the person set none", () => {
    const ref = referenceFromPlan(plan(4), { screenCount: null, guidance: "" });
    expect(ref.screens).toHaveLength(4);
    expect(ref.recommended_count).toBe(4);
    expect(ref.requested_count).toBeNull();
    // Duplicate keys from the model are made unique.
    expect(new Set(ref.screens.map((s) => s.key)).size).toBe(4);
  });

  test("never keeps more screens than the person asked for", () => {
    const ref = referenceFromPlan(plan(6, 5), { screenCount: 3, guidance: "Leave out settings" });
    expect(ref.screens.map((s) => s.name)).toEqual(["Screen 1", "Screen 2", "Screen 3"]);
    expect(ref.recommended_count).toBe(5);
    expect(ref.requested_count).toBe(3);
    expect(ref.guidance).toBe("Leave out settings");
  });

  test("falls back to the planned count when the model leaves recommended_count out", () => {
    const parsed = UxPlanSchema.parse({ applicable: true, screens: [{ key: "a", name: "A", purpose: "p" }, { key: "b", name: "B", purpose: "p" }] });
    expect(referenceFromPlan(parsed, { screenCount: null, guidance: "" }).recommended_count).toBe(2);
  });

  test("a product with no interface has no screens and no count", () => {
    const parsed = UxPlanSchema.parse({ applicable: false, reason: "A CLI", recommended_count: 3, screens: [{ key: "a", name: "A", purpose: "p" }] });
    const ref = referenceFromPlan(parsed, { screenCount: 2, guidance: "" });
    expect(ref.applicable).toBe(false);
    expect(ref.screens).toHaveLength(0);
    expect(ref.recommended_count).toBe(0);
  });
});
