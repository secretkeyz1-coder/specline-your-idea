import { describe, expect, test } from "bun:test";
import { splitPartsFromForm } from "../src/lib/server/split-parts.js";
import { formUuid, isAiRole, isSafeApiPath, isUuid } from "../src/lib/server/ids.js";
import { baseUrlOriginChanged } from "../src/lib/origin.js";
import { throttle } from "../src/lib/throttle.js";
import { foldRequirementSections, renderMarkdown } from "../src/lib/markdown.js";
import { hardnessTitle, hardnessWord } from "../src/lib/labels.js";

function splitForm(rows: Array<{ title: string; objective?: string; ac?: string }>): FormData {
  const form = new FormData();
  rows.forEach((row, i) => {
    form.append("part_title", row.title);
    form.append("part_objective", row.objective ?? "");
    form.set(`part_ac_${i}`, row.ac ?? "");
  });
  return form;
}

describe("splitPartsFromForm", () => {
  test("a blank title drops only its own row; later rows keep their objective and criterion", () => {
    const parts = splitPartsFromForm(
      splitForm([
        { title: "", objective: "orphan objective", ac: "orphan ac" },
        { title: "Schema", objective: "Create the tables", ac: "Migrations run" },
        { title: "API", objective: "Expose the endpoints", ac: "Endpoints answer" },
      ]),
    );
    expect(parts).toEqual([
      { title: "Schema", objective: "Create the tables", acceptance_criteria: ["Migrations run"] },
      { title: "API", objective: "Expose the endpoints", acceptance_criteria: ["Endpoints answer"] },
    ]);
  });

  test("a blank middle row does not shift the last row's criterion", () => {
    const parts = splitPartsFromForm(
      splitForm([
        { title: "One", ac: "ac one" },
        { title: "   ", ac: "ac two" },
        { title: "Three", ac: "ac three" },
      ]),
    );
    expect(parts.map((p) => [p.title, p.acceptance_criteria[0]])).toEqual([
      ["One", "ac one"],
      ["Three", "ac three"],
    ]);
  });

  test("missing objective and criterion fall back to the title", () => {
    const [part] = splitPartsFromForm(splitForm([{ title: " Docs " }]));
    expect(part).toEqual({ title: "Docs", objective: "Docs", acceptance_criteria: ['"Docs" is complete and verified.'] });
  });
});

describe("ids", () => {
  const id = "3f2b8c1e-9a4d-4e7f-8b2a-1c3d5e7f9a0b";

  test("isUuid accepts UUIDs only", () => {
    expect(isUuid(id)).toBe(true);
    expect(isUuid(id.toUpperCase())).toBe(true);
    expect(isUuid("../../workspaces/x")).toBe(false);
    expect(isUuid(`${id}/approve`)).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  test("formUuid reads a checked id or null", () => {
    const form = new FormData();
    form.set("good", id);
    form.set("bad", "../x");
    expect(formUuid(form, "good")).toBe(id);
    expect(formUuid(form, "bad")).toBeNull();
    expect(formUuid(form, "missing")).toBeNull();
  });

  test("isAiRole accepts the enum only", () => {
    expect(isAiRole("ARCHITECTURE")).toBe(true);
    expect(isAiRole("architecture")).toBe(false);
    expect(isAiRole("ARCHITECTURE/../x")).toBe(false);
  });

  test("isSafeApiPath refuses dot-segments, encoded dots and backslashes", () => {
    expect(isSafeApiPath(`/api/v1/tasks/${id}/ready`)).toBe(true);
    expect(isSafeApiPath("/api/v1/projects/p/ux/screens/a.b/generate")).toBe(true);
    expect(isSafeApiPath("/api/v1/projects/p/tasks?q=../x")).toBe(true);
    expect(isSafeApiPath("/api/v1/projects/../../workspaces/w/ai/providers")).toBe(false);
    expect(isSafeApiPath("/api/v1/projects/%2e%2e/x")).toBe(false);
    expect(isSafeApiPath("/api/v1/projects/..")).toBe(false);
    expect(isSafeApiPath("/api/v1/projects/a\\..\\b")).toBe(false);
    expect(isSafeApiPath("/api/v1/projects/a\nb")).toBe(false);
  });
});

describe("baseUrlOriginChanged", () => {
  test("same origin, other path: the stored key may stay", () => {
    expect(baseUrlOriginChanged("https://openrouter.ai/api/v1", "https://openrouter.ai/api/v2")).toBe(false);
    expect(baseUrlOriginChanged("https://openrouter.ai/api/v1", " https://openrouter.ai/api/v1 ")).toBe(false);
  });

  test("another host, scheme or port needs a new key", () => {
    expect(baseUrlOriginChanged("https://openrouter.ai/api/v1", "https://evil.example/api/v1")).toBe(true);
    expect(baseUrlOriginChanged("https://api.example.com", "http://api.example.com")).toBe(true);
    expect(baseUrlOriginChanged("https://api.example.com", "https://api.example.com:8443")).toBe(true);
  });

  test("to or from the provider default (empty) counts as a move", () => {
    expect(baseUrlOriginChanged("", "https://api.example.com")).toBe(true);
    expect(baseUrlOriginChanged("https://api.example.com", "")).toBe(true);
    expect(baseUrlOriginChanged("", "")).toBe(false);
    expect(baseUrlOriginChanged(null, undefined)).toBe(false);
  });
});

describe("throttle", () => {
  function fakeClock() {
    const clock = {
      t: 0,
      timers: [] as Array<{ at: number; fn: () => void; live: boolean }>,
      now: () => clock.t,
      set: (fn: () => void, ms: number) => {
        const timer = { at: clock.t + ms, fn, live: true };
        clock.timers.push(timer);
        return timer;
      },
      clear: (handle: unknown) => {
        (handle as { live: boolean }).live = false;
      },
      advance(to: number) {
        clock.t = to;
        for (const timer of clock.timers) {
          if (timer.live && timer.at <= to) {
            timer.live = false;
            timer.fn();
          }
        }
      },
    };
    return clock;
  }

  test("first call runs at once; a burst inside the window becomes one trailing run", () => {
    const clock = fakeClock();
    const runs: number[] = [];
    const throttled = throttle(() => runs.push(clock.t), 5000, clock);
    throttled();
    clock.advance(1000);
    throttled();
    clock.advance(3000);
    throttled();
    expect(runs).toEqual([0]);
    clock.advance(5000);
    expect(runs).toEqual([0, 5000]);
    // Quiet afterwards: nothing more runs.
    clock.advance(20000);
    expect(runs).toEqual([0, 5000]);
  });

  test("a call after a quiet window runs immediately; cancel drops a pending run", () => {
    const clock = fakeClock();
    const runs: number[] = [];
    const throttled = throttle(() => runs.push(clock.t), 5000, clock);
    throttled();
    clock.advance(12000);
    throttled();
    expect(runs).toEqual([0, 12000]);
    clock.advance(13000);
    throttled();
    throttled.cancel();
    clock.advance(30000);
    expect(runs).toEqual([0, 12000]);
  });
});

describe("foldRequirementSections", () => {
  const doc = [
    "## Functional requirements",
    "### FR-001 — Dashboard [P0]",
    "The dashboard shows every project.",
    "- **AC-001-1**: Given a PM, when the list loads, then all projects show.",
    "### FR-002 — Baseline freeze [P1]",
    "Freezing locks the schedule.",
    "## Non-functional requirements",
    "- **NFR-001**: Responsive.",
  ].join("\n");
  const html = foldRequirementSections(renderMarkdown(doc, { nested: true }));

  test("each requirement becomes a closed fold with a key id and a mono priority badge", () => {
    expect(html).toContain('<details class="doc-fold" id="req-FR-001"><summary><h4 class="doc-h3">FR-001 — Dashboard <span class="doc-prio">P0</span></h4></summary>');
    expect(html).toContain('id="req-FR-002"');
    expect(html).not.toContain("<details open");
  });

  test("a fold ends at the next requirement or section; later sections stay outside", () => {
    const first = html.slice(html.indexOf('id="req-FR-001"'), html.indexOf('id="req-FR-002"'));
    expect(first).toContain("AC-001-1");
    expect(first).toContain("</details>");
    const second = html.slice(html.indexOf('id="req-FR-002"'));
    expect(second.indexOf("</details>")).toBeLessThan(second.indexOf("Non-functional requirements"));
    expect(html.match(/<details/g)?.length).toBe(2);
  });

  test("a document without requirement headings is left as it is", () => {
    const plain = renderMarkdown("## Summary\nJust prose.", { nested: true });
    expect(foldRequirementSections(plain)).toBe(plain);
  });
});

describe("hardness labels", () => {
  test("each score has one word, out-of-range scores clamp", () => {
    expect([1, 2, 3, 4, 5].map(hardnessWord)).toEqual(["trivial", "easy", "moderate", "hard", "very hard"]);
    expect(hardnessWord(0)).toBe("trivial");
    expect(hardnessWord(9)).toBe("very hard");
  });
  test("the title says the score, its word and what it is made of", () => {
    const t = hardnessTitle(4);
    expect(t.startsWith("Hardness 4/5 (hard).")).toBe(true);
    expect(t).toContain("blast radius");
  });
});
