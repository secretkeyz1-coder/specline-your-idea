import { describe, expect, test } from "bun:test";
import { buildJourney, type JourneyInput } from "../src/lib/journey.js";

/** A project whose technical design is approved and whose tasks are not cut yet. */
const designed = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  projectId: "p1",
  lifecycle: "DESIGN",
  requirements: { approved: true, hasDraft: false },
  stackApproved: true,
  design: { approved: true, hasDraft: false },
  ux: { approved: false, hasDraft: false, notApplicable: false },
  designSystem: { approved: false, hasDraft: false },
  tasks: [],
  features: [],
  ...over,
});

test("a READY task cannot make Tasks done while another contract is DRAFT", () => {
  const j = buildJourney(designed({ tasks: [{ id: "1", key: "T1", title: "First", workflowStatus: "READY" }, { id: "2", key: "T2", title: "Second", workflowStatus: "DRAFT" }] }));
  expect(j.milestones.find(m => m.id === "tasks")?.state).not.toBe("done");
});

test("unavailable chapter data is not shown as completed or ready to generate", () => {
  const j = buildJourney(designed({ unavailable: ["requirements"] }));
  expect(j.next.title).toBe("Reload project status");
  expect(j.milestones.find(m => m.id === "requirements")?.summary).toContain("unavailable");
  expect(j.milestones.find(m => m.id === "requirements")?.state).not.toBe("done");
  expect(j.finished).toBe(false);
});

test("a COMPLETE feature with stale or missing release proof is not shown as released", () => {
  const j = buildJourney(designed({ tasks: [{ id: "1", key: "T1", title: "Done", workflowStatus: "DONE" }], features: [{ status: "COMPLETE", checked: true, canComplete: false }] }));
  expect(j.milestones.find(m => m.id === "release")?.state).not.toBe("done");
  expect(j.finished).toBe(false);
});

describe("after the technical design the path runs design system → UI reference → tasks", () => {
  test("the design system is the next step, and skipping it goes to the screens", () => {
    const j = buildJourney(designed());
    expect(j.next.milestone).toBe("system");
    expect(j.next.href).toBe("/projects/p1/design-system");
    expect(j.next.secondary).toEqual({ label: "Skip — sketch the screens", href: "/projects/p1/ux" });
    expect(j.milestones.find((m) => m.id === "system")!.state).toBe("current");
  });

  test("with the design system approved, the screens come next; skipping them generates the tasks", () => {
    const j = buildJourney(designed({ designSystem: { approved: true, hasDraft: false } }));
    expect(j.next.milestone).toBe("screens");
    expect(j.next.href).toBe("/projects/p1/ux");
    expect(j.next.secondary).toEqual({ label: "Skip — generate tasks", action: "?/generateTasks" });
  });

  test("screens started without a design system count it as skipped", () => {
    const j = buildJourney(designed({ ux: { approved: false, hasDraft: true, notApplicable: false } }));
    expect(j.next.milestone).toBe("screens");
    expect(j.milestones.find((m) => m.id === "system")!.state).toBe("skipped");
  });

  test("with both settled (or no UI at all), the next step generates the tasks", () => {
    const both = buildJourney(designed({ designSystem: { approved: true, hasDraft: false }, ux: { approved: true, hasDraft: false, notApplicable: false } }));
    expect(both.next.action).toBe("?/generateTasks");
    expect(both.next.secondary).toBeUndefined();
    const noUi = buildJourney(designed({ ux: { approved: false, hasDraft: false, notApplicable: true } }));
    expect(noUi.next.action).toBe("?/generateTasks");
  });

  test("a design system draft waits first; its skip goes to the screens unless they are done", () => {
    const draft = { approved: false, hasDraft: true };
    expect(buildJourney(designed({ designSystem: draft })).next.secondary?.href).toBe("/projects/p1/ux");
    expect(buildJourney(designed({ designSystem: draft, ux: { approved: true, hasDraft: false, notApplicable: false } })).next.secondary?.action).toBe("?/generateTasks");
  });

  test("without design-system data the old path stands: screens, then tasks", () => {
    const j = buildJourney(designed({ designSystem: undefined }));
    expect(j.next.milestone).toBe("screens");
  });
});
