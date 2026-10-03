import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DesignArtifactSchema, designReadinessIssues, decodeDesignContent, type DesignArtifact } from "@sdd/contracts";
import { designEditorInitial, initialCoverage, designEditorPayload, approvalErrorIssues } from "../src/lib/design-editor.js";
import { analyzeDesignCoverage } from "../../api/src/modules/planning/design.js";
import { designApprovalIssues } from "../../api/src/modules/planning/quality.js";

const sections = {
  overview: "Records", architecture: { summary: "HTTP service and store", diagram_text: "HTTP → store" },
  components: [{ name: "store", responsibility: "Persist records", interfaces: "get and put" }],
  data_model: "Record(id, title)", api_contracts: "GET /records", state_machines: "Created → archived",
  testing_strategy: "Unit and journey tests", security: "Session authentication", deployment: "Container",
  unresolved_decisions: [],
};
const checks = [{ purpose: "build" as const, command: "npm run build", expected_paths: ["Dockerfile", "dist"], outcome: "Production build exits zero" }];
const requirements = [{ key: "FR-001", title: "Records", acceptance_criteria: [] }];

test("manual create sends explicitly authored coverage and complete delivery checks", () => {
  const coverage = initialCoverage({}, ["FR-001"]);
  expect(coverage[0]!.status).toBe("NO_PATH");
  coverage[0]!.design_section = "components: store";
  coverage[0]!.status = "PATH_DEFINED";
  const payload = designEditorPayload(sections, coverage, checks);
  expect(DesignArtifactSchema.parse(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  expect(payload.delivery_checks).toEqual(checks);
  expect(designReadinessIssues(payload, ["FR-001"])).toEqual([]);
  expect(designApprovalIssues(analyzeDesignCoverage(payload, requirements))).toEqual([]);
});

test("editing AI or legacy string designs preserves metadata and does not mutate source", () => {
  const original = designEditorPayload(sections, [{ requirement_key: "FR-001", design_section: "store", status: "PATH_DEFINED" }], checks);
  for (const content of [original, JSON.stringify(original)]) {
    const initial = designEditorInitial(content);
    const coverage = initialCoverage(initial, ["FR-001", "NFR-001"]);
    const edited = designEditorPayload({ ...sections, overview: "Updated records" }, coverage, initial.delivery_checks!);
    expect(edited.requirement_coverage[0]).toEqual(original.requirement_coverage[0]);
    expect(edited.delivery_checks).toEqual(original.delivery_checks);
    expect(edited.requirement_coverage[1]!.status).toBe("NO_PATH");
    expect(original.overview).toBe("Records");
  }
  expect(decodeDesignContent("not JSON")).toBe("not JSON");
});

test("readiness agrees with API gate for missing, partial, invalid paths and checks", () => {
  const valid = designEditorPayload(sections, [{ requirement_key: "FR-001", design_section: "store", status: "PATH_DEFINED" }], checks);
  const cases: DesignArtifact[] = [
    { ...valid, requirement_coverage: [] },
    { ...valid, requirement_coverage: [{ ...valid.requirement_coverage[0]!, status: "PARTIAL" }] },
    { ...valid, requirement_coverage: [{ ...valid.requirement_coverage[0]!, design_section: "missing" }] },
    { ...valid, security: "", delivery_checks: [] },
    { ...valid, delivery_checks: [{ ...checks[0]!, command: "npm test && npm run build" }] },
    { ...valid, unresolved_decisions: [{ description: "Choose auth", blocking: true }] },
  ];
  for (const design of cases) {
    const expected = designApprovalIssues(analyzeDesignCoverage(design, requirements));
    expect(expected.length).toBeGreaterThan(0);
    expect(designReadinessIssues(design, ["FR-001"])).toEqual(expected);
    expect(designReadinessIssues(JSON.stringify(design), ["FR-001"])).toEqual(expected);
  }
  expect(designReadinessIssues({}, ["FR-001"]).length).toBeGreaterThan(0);
});

test("qualified component paths resolve the actual named component, not another populated section", () => {
  const design = designEditorPayload(sections, [], checks);
  for (const reference of ["components: missing_authorizer", "component: missing_store", "components/missing", "components.missing", "components: security", "components:"]) {
    const candidate = { ...design, requirement_coverage: [{ requirement_key: "FR-001", design_section: reference, status: "PATH_DEFINED" as const }] };
    expect(analyzeDesignCoverage(candidate, requirements).requirement_coverage[0]!.status).toBe("NO_PATH");
    expect(designReadinessIssues(candidate, ["FR-001"])).toContain("Unproven design path: FR-001");
  }
  for (const reference of ["components", "architecture", "security", "store", "components: store", " Component: STORE "]) {
    const candidate = { ...design, requirement_coverage: [{ requirement_key: "FR-001", design_section: reference, status: "PATH_DEFINED" as const }] };
    expect(designReadinessIssues(candidate, ["FR-001"])).toEqual([]);
  }
  const emptyComponent = { ...design, components: [{ name: "authorizer", responsibility: "", interfaces: "" }, ...design.components], requirement_coverage: [{ requirement_key: "FR-001", design_section: "components: authorizer", status: "PATH_DEFINED" as const }] };
  expect(designReadinessIssues(emptyComponent, ["FR-001"])).toContain("Unproven design path: FR-001");
});

test("delivery purpose applicability remains a design decision, not an unconditional three-purpose gate", () => {
  // Planning prompt says build/startup/journey 'where applicable'; the schema
  // has no applicability/waiver field. Do not impose all three on every target.
  const design = designEditorPayload(sections, [{ requirement_key: "FR-001", design_section: "security", status: "PATH_DEFINED" }], checks);
  expect(designReadinessIssues(design, ["FR-001"])).toEqual([]);
  expect(designApprovalIssues(analyzeDesignCoverage(design, requirements))).toEqual([]);
});

test("delivery contract rejects incomplete or excessive entries, independently of approval", () => {
  const payload = designEditorPayload(sections, [], checks);
  expect(DesignArtifactSchema.safeParse({ ...payload, delivery_checks: [{ ...checks[0], outcome: "" }] }).success).toBe(false);
  expect(DesignArtifactSchema.safeParse({ ...payload, delivery_checks: Array(7).fill(checks[0]) }).success).toBe(false);
});

test("approval rejection keeps actionable issues and UI renders truthful readiness", () => {
  expect(approvalErrorIssues({ issues: ["Unproven design path: FR-001", "Blocking decision: Choose auth", 7] })).toEqual(["Unproven design path: FR-001", "Blocking decision: Choose auth"]);
  expect(approvalErrorIssues(null)).toEqual([]);
  const page = readFileSync(new URL("../src/routes/projects/[projectId]/docs/+page.svelte", import.meta.url), "utf8");
  expect(page).toContain('data.designIssues.length ? "needs changes" : "ready to approve"');
  expect(page).toContain("{#each form.issues as issue}");
  expect(page).toContain("{#each data.designIssues as issue}");
  const server = readFileSync(new URL("../src/routes/projects/[projectId]/docs/+page.server.ts", import.meta.url), "utf8");
  expect(server).toContain("issues: approvalErrorIssues(error.details)");
  expect(server).toContain("requirements.approved_requirements");
  const editor = readFileSync(new URL("../src/routes/projects/[projectId]/docs/design/edit/+page.svelte", import.meta.url), "utf8");
  expect(editor).toContain("}, coverage, checks)");
  expect(editor).not.toContain("requirement_coverage: []");
  const artifact = readFileSync(new URL("../../api/src/modules/artifact/service.ts", import.meta.url), "utf8");
  expect(artifact).toContain('artifact.artifactType === "design" && input.structuredContent != null');
  const transport = readFileSync(new URL("../../../packages/db/src/jsonb.ts", import.meta.url), "utf8");
  expect(transport).toContain('cast(cast(${encoded} as text) as jsonb)');
  expect(artifact).toContain('designReadinessIssues(fresh!.structuredContent, reqs.map(r => r.key))');
});
