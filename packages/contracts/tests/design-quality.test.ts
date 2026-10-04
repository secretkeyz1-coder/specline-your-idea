import { expect, test } from "bun:test";
import { designPathExists } from "../src/design-quality.js";
import type { DesignArtifact } from "../src/ai.js";

const design = { components: [{ name: "Store", responsibility: "Persistence" }], overview: "Overview", architecture: { summary: "Architecture" } } as DesignArtifact;

test("qualified component references preserve delimiters, whitespace and resolution", () => {
  for (const label of ["component: Store", "components/STORE", "components . Store", "components:\n Store"]) {
    expect(designPathExists(design, label)).toBe(true);
  }
  expect(designPathExists(design, "components: Missing")).toBe(false);
  expect(designPathExists(design, "components: ")).toBe(false);
  expect(designPathExists(design, `components${" ".repeat(8192)}: Store`)).toBe(true);
  expect(designPathExists(design, "overview")).toBe(true);
});
