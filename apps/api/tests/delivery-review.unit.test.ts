import { describe, expect, test } from "bun:test";
import { TaskContractSchema, TaskPlanSchema } from "@sdd/contracts";
import { runAutoReviewAllowed, autoReviewAllowed, reviewApprovalIssues } from "../src/modules/review/automation.js";
import { convergenceCoverageIssues } from "../src/modules/convergence/service.js";
import { taskPlanIssues, hasShellTask, screenConstraint } from "../src/modules/task/generation.js";
import { hasRenderCheck } from "../src/modules/task/lint.js";
import { notifyPendingReview, verifyEvidencePolicy } from "../src/modules/execution/evidence.js";
import type { DbExecutor } from "@sdd/db";
import type { TaskRow } from "../src/modules/task/repo.js";

const contract = TaskContractSchema.parse({ title: "Create stock lookup", task_type: "code", objective: "Return stock quantities", scope: { expected_paths: ["src/stock.ts"] }, acceptance_criteria: ["Returns quantity", "Rejects unknown warehouse"], verification: { required: [{ type: "command", command: "bun test" }], evidence: ["diff", "commit", "test_result"] }, deliverables: ["implementation"], stop_conditions: ["Approved scope changes"] });
const planned = { ...contract, ref: "stock", feature_hint: "stock", requirement_keys: ["FR-1"], acceptance_criterion_keys: ["AC-1", "AC-2"], depends_on_refs: [] };
const plan = () => TaskPlanSchema.parse({ features: [{ key: "stock", title: "Stock" }], tasks: [planned] });
const requirements = [{ key: "FR-1", acceptance_criteria: [{ key: "AC-1" }, { key: "AC-2" }] }];

describe("delivery correctness guards", () => {
  test("REST and MCP review cannot borrow paired-token AUTO_RUN for an unbound or other-machine run", async () => {
    const selection = { from: () => selection, innerJoin: () => selection, where: () => selection, limit: async () => [{ id: "auto-link" }] };
    const db = { select: () => selection } as unknown as DbExecutor;
    expect(await runAutoReviewAllowed(db, "project", "owner", { machineId: null }, "paired-machine")).toBe(false);
    expect(await runAutoReviewAllowed(db, "project", "owner", { machineId: "other" }, "paired-machine")).toBe(false);
    expect(await runAutoReviewAllowed(db, "project", "owner", { machineId: "paired-machine" }, "paired-machine")).toBe(true);
  });
  test("automatic review requires matching machine identity and live permission", async () => {
    let active = true;
    let reads = 0;
    const selection = { from: () => selection, innerJoin: () => selection, where: () => selection, limit: async () => { reads++; return active ? [{ id: "link" }] : []; } };
    const db = { select: () => selection } as unknown as DbExecutor;
    expect(await autoReviewAllowed(db, "project", "owner", null, "machine")).toBe(false);
    expect(await autoReviewAllowed(db, "project", "owner", "other", "machine")).toBe(false);
    expect(reads).toBe(0);
    expect(await autoReviewAllowed(db, "project", "owner", "machine", "machine")).toBe(true);
    active = false;
    expect(await autoReviewAllowed(db, "project", "owner", "machine", "machine")).toBe(false);
    expect(reads).toBe(2);
  });
  test("approved or requeued work does not emit a needs-review notification", async () => {
    const db = { select: () => { throw new Error("No human-review notification expected"); } } as unknown as DbExecutor;
    for (const workflowStatus of ["DONE", "READY", "CHANGES_REQUESTED"]) {
      await notifyPendingReview(db, { workflowStatus } as TaskRow, "run", "summary");
    }
  });

  test("plans reject duplicate refs, missing dependencies and cycles", () => {
    for (const tasks of [[planned, planned], [{ ...planned, depends_on_refs: ["absent"] }], [{ ...planned, depends_on_refs: ["stock"] }]]) expect(TaskPlanSchema.safeParse({ features: [{ key: "stock", title: "Stock" }], tasks }).success).toBe(false);
    const valid = plan();
    expect(taskPlanIssues(valid, requirements, null)).toEqual([]);
    valid.tasks[0]!.acceptance_criterion_keys = ["AC-1"];
    expect(taskPlanIssues(valid, requirements, null).join(" ")).toContain("AC-2");
  });

  test("every screen depends on the shell and render checks actually run tests", () => {
    const screen = (ref: string, deps: string[]) => ({ ref, title: `Screen ${ref}`, task_type: "frontend", constraints: [screenConstraint(false, false).replace("<file>", `docs/ui-reference/${ref}.html`)], depends_on_refs: deps });
    expect(hasShellTask({ tasks: [{ ref: "shell", title: "Application shell navigation", task_type: "frontend" }, screen("one", ["shell"]), screen("two", [])] })).toBe(false);
    for (const command of ["bunx playwright --version", "bunx playwright test --list", "bunx playwright test e2e/render/stock.spec.ts --ui"]) expect(hasRenderCheck({ verification: { required: [{ type: "command", command }] } })).toBe(false);
    expect(hasRenderCheck({ verification: { required: [{ type: "command", command: "bunx playwright test e2e/render/stock.spec.ts" }] } })).toBe(true);
  });

  test("AI approval needs unique complete criterion coverage and no high gaps", () => {
    const coverage = [0, 1].map(criterion_index => ({ criterion_index, status: "COVERED", evidence: "src/stock.ts and passing stock test" }));
    expect(reviewApprovalIssues(contract, { acceptance_coverage: coverage, findings: [] })).toEqual([]);
    for (const acceptance_coverage of [[], [coverage[0]!, coverage[0]!], [coverage[0]!, { ...coverage[1]!, status: "PARTIAL" }]]) expect(reviewApprovalIssues(contract, { acceptance_coverage, findings: [] }).length).toBeGreaterThan(0);
    expect(reviewApprovalIssues(contract, { acceptance_coverage: coverage, findings: [{ severity: "HIGH" }] }).length).toBeGreaterThan(0);
    expect(convergenceCoverageIssues(requirements, [])).toHaveLength(2);
    expect(convergenceCoverageIssues(requirements, requirements[0]!.acceptance_criteria.map(ac => ({ requirement_key: "FR-1", acceptance_criterion_key: ac.key, status: "COVERED", evidence: "implementation and regression tests" })))).toEqual([]);
  });

  test("passing labels with nonzero or unknown exit codes cannot satisfy evidence", async () => {
    const task = { contract } as TaskRow;
    const body = { summary: "implemented", commit_sha: "abc", evidence: { base_commit: null, diff: "patch", diff_truncated: false, artifacts: [] } };
    const fake = (exitCode: number | null) => ({ select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [{ command: "bun test", status: "PASSED", exitCode }] }) }) }) }) as unknown as DbExecutor;
    await verifyEvidencePolicy(fake(0), "run", task, body);
    for (const exit of [1, null]) await expect(verifyEvidencePolicy(fake(exit), "run", task, body)).rejects.toThrow("must pass");
    await expect(verifyEvidencePolicy(fake(0), "run", task, { ...body, evidence: undefined })).rejects.toThrow("diff");
    await expect(verifyEvidencePolicy(fake(0), "run", task, { ...body, commit_sha: null })).rejects.toThrow("commit");
  });
});
