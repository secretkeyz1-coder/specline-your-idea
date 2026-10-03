import { expect, test } from "bun:test";
import { needsScreenLinks } from "../src/modules/task/readiness.js";

test("shared design-system setup does not require owning a screen", () => {
  expect(needsScreenLinks({ taskType: "frontend", title: "Configure design system tokens, root layout, and Playwright Chromium test runner" })).toBe(false);
  expect(needsScreenLinks({ taskType: "frontend", title: "Build Ticket Queue" })).toBe(true);
  expect(needsScreenLinks({ taskType: "frontend", title: "Build Ticket Queue screen using design system tokens" })).toBe(true);
  expect(needsScreenLinks({ taskType: "backend", title: "Implement ticket APIs" })).toBe(false);
});
