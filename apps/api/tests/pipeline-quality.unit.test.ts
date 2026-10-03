import { expect, test } from "bun:test";
import { RequirementsArtifactSchema, DesignArtifactSchema, TaskPlanSchema, TaskContractSchema, qualityCriteria } from "@sdd/contracts";
import { analyzeDesignCoverage } from "../src/modules/planning/design.js";
import { designApprovalIssues, contradictsOutcome, productContext } from "../src/modules/planning/quality.js";
import { computeReadiness, discoveryAllowsRequirements } from "../src/modules/discovery/readiness.js";
import { convergenceCoverageIssues } from "../src/modules/convergence/service.js";
import { taskPlanIssues, appShellLine } from "../src/modules/task/generation.js";
import { planQualityIssues } from "../src/modules/task/plan-quality.js";
import { missingKeyElements } from "../src/modules/task/lint.js";
import { reviewApprovalIssues } from "../src/modules/review/automation.js";
import { lintOptionsFor, lintScreenHtml } from "../src/modules/ux/ux-lint.js";
import { screenReviewOf } from "../src/modules/task/screen-review.js";
import { odScreenRequest, odSeedOf } from "../src/modules/ux/ux-od-prompt.js";
import { NEUTRAL_SPEC } from "../src/modules/ux/ux-shell.js";

const req = { key: "FR-001", title: "Records", statement: "Members cannot delete records", acceptance_criteria: [{ key: "AC-001-1", statement: "Members cannot delete records", verification_type: "TEST" as const }] };
const product = { summary: "Records", actors: [{ name: "Member" }], workflows: [{ name: "Read", primary_actor: "Member", steps: ["Read (FR-001)"] }], functional_requirements: [req] };
const plan = () => TaskPlanSchema.parse({ features: [{ key: "records", title: "Records" }], tasks: [{ ref: "t1", title: "Record permissions", task_type: "backend", feature_hint: "records", objective: "Members cannot delete records", requirement_keys: [req.key], acceptance_criterion_keys: ["AC-001-1"], scope: { expected_paths: ["src/records.ts"] }, acceptance_criteria: [req.statement], verification: { required: [{ command: "npm test" }] }, deliverables: ["implementation"], stop_conditions: ["Source requirements change"] }] });

test("requirements validate workflow actors, references and globally unique ACs", () => {
  expect(RequirementsArtifactSchema.safeParse(product).success).toBe(true);
  expect(RequirementsArtifactSchema.safeParse({ ...product, workflows: [{ ...product.workflows[0], primary_actor: "Unknown" }] }).success).toBe(false);
  expect(RequirementsArtifactSchema.safeParse({ ...product, workflows: [{ ...product.workflows[0], steps: ["Read FR-999"] }] }).success).toBe(false);
  expect(RequirementsArtifactSchema.safeParse({ ...product, non_functional: [{ key: "NFR-001", statement: "P95 < 500ms", acceptance_criteria: req.acceptance_criteria }] }).success).toBe(false);
});

test("15 answers and one accepted assumption cannot waive remaining blocking decisions", () => {
  const session = { status: "ACTIVE", coverage: { roles_permissions: { status: "PARTIAL", blocking: true } } };
  const answers = Array.from({ length: 15 }, () => ({ question: { status: "ANSWERED", blocking: false }, answer: "yes" }));
  expect(computeReadiness(session as any, [], [], answers as any)).toBe("INCOMPLETE");
  expect(discoveryAllowsRequirements(session as any, "INCOMPLETE")).toBe(false);
});

test("legacy NFRs require evidence and structured NFRs preserve load parameters", () => {
  const nfr = { key: "NFR-001", statement: "P95 < 500ms at 50 users with 1000 records", acceptance_criteria: [] };
  const [ac] = qualityCriteria(nfr);
  expect(ac!.statement).toBe(nfr.statement);
  expect(convergenceCoverageIssues([nfr], [])).toContain(`Missing coverage ${nfr.key}/${ac!.key}`);
  expect(convergenceCoverageIssues([nfr], [{ requirement_key: nfr.key, acceptance_criterion_key: ac!.key, status: "COVERED", evidence: "Load report with all parameters" }])).toEqual([]);
});

test("empty or nonexistent design paths and blocking decisions cannot be approved", () => {
  const design = DesignArtifactSchema.parse({ overview: "", architecture: { summary: "" }, components: [], data_model: "", api_contracts: "", state_machines: "", security: "", testing_strategy: "", deployment: "", requirement_coverage: [{ requirement_key: req.key, design_section: "nonexistent", status: "PATH_DEFINED" }], unresolved_decisions: [{ description: "Permission decision", blocking: true }] });
  const checked = analyzeDesignCoverage(design, [req]);
  expect(checked.requirement_coverage[0]!.status).toBe("NO_PATH");
  expect(designApprovalIssues(checked).join(" ")).toContain("Blocking decision");
  expect(designApprovalIssues(checked).join(" ")).toContain("delivery checks");
});

test("direct permission reversal is rejected without requiring identical paraphrases", () => {
  expect(contradictsOutcome("Members cannot delete records", "Members can delete records")).toBe(true);
  expect(contradictsOutcome("Members cannot delete records", "Deletion requests from Members return 403")).toBe(false);
  expect(missingKeyElements([req.statement], ["Members can delete records"])).toEqual([req.statement]);
  const reversed = plan(); reversed.tasks[0]!.acceptance_criteria = ["Members can delete records"];
  expect(taskPlanIssues(reversed, [req], null).join(" ")).toContain("contradicts");
});

test("semantic plan review must assess every source outcome and assigned task", () => {
  const proposed = plan();
  expect(planQualityIssues(proposed, [req], { coverage: [], issues: [] }).join(" ")).toContain("No semantic assessment");
  const entry = { requirement_key: req.key, acceptance_criterion_key: "AC-001-1", task_refs: ["t1"], status: "CONSISTENT" as const, evidence: "Task explicitly rejects deletion" };
  expect(planQualityIssues(proposed, [req], { coverage: [entry], issues: [] })).toEqual([]);
  expect(planQualityIssues(proposed, [req], { coverage: [{ ...entry, status: "CONTRADICTED" }], issues: [] }).length).toBeGreaterThan(0);
  expect(planQualityIssues(proposed, [req], { coverage: [{ ...entry, task_refs: ["absent"] }], issues: [] }).length).toBeGreaterThan(0);
});

test("delivery commands and packaging output each need a task owner", () => {
  const design = { delivery_checks: [{ purpose: "build", command: "npm run build", expected_paths: ["Dockerfile"], outcome: "Production image builds" }] } as any;
  expect(taskPlanIssues(plan(), [req], null, design).join(" ")).toContain("No task owns delivery output Dockerfile");
  const proposed = plan(); proposed.tasks[0]!.scope.expected_paths.push("Dockerfile"); proposed.tasks[0]!.verification.required.push({ type: "command", command: "npm run build" });
  expect(taskPlanIssues(proposed, [req], null, design)).toEqual([]);
});

test("source consistency is required even when local criteria pass", () => {
  const c = TaskContractSchema.parse(plan().tasks[0]);
  const result = { acceptance_coverage: [{ criterion_index: 0, status: "COVERED", evidence: "test" }], findings: [] };
  expect(reviewApprovalIssues(c, result, [req.key]).join(" ")).toContain("Source outcome");
  expect(reviewApprovalIssues(c, { ...result, source_consistency: [{ requirement_key: req.key, status: "CONSISTENT", evidence: "Permission unchanged" }] }, [req.key])).toEqual([]);
});

test("product context carries workflows, exclusions and open decisions downstream", () => {
  const data = RequirementsArtifactSchema.parse({ ...product, exclusions: [{ description: "No payments" }], open_questions: [{ description: "Offline access unresolved" }] });
  const text = productContext(data).join(" ");
  expect(text).toContain("No payments"); expect(text).toContain("Offline access unresolved"); expect(text).toContain("primary_actor");
});

test("auth shell selection, drawing, lint and shell review use the same screen decision", () => {
  const auth = { key: "welcome", name: "Welcome", shell_mode: "auth" as const, purpose: "Sign in", requirement_keys: [req.key], key_elements: [], html: null };
  const app = { ...auth, key: "home", name: "Home", shell_mode: "app" as const };
  const ref = { generator: "od", applicable: true, fidelity: "neutral", screens: [auth, app], shell: { layout: "sidebar", account: true, search: false, notifications: false, reason: "Session" } } as any;
  const options = lintOptionsFor(ref, auth);
  expect(options.navExpected).toBe(false); expect(options.accountExpected).toBe(false);
  expect(odSeedOf(ref, auth, NEUTRAL_SPEC).structure).toBe("web-minimal");
  expect(odScreenRequest({ ref, screen: auth, spec: null, projectText: "Product" }, odSeedOf(ref, auth, NEUTRAL_SPEC))).toContain("outside the app");
  expect(appShellLine(ref)).toContain("outside the shell");
  expect(lintScreenHtml('<div data-sdd-app><main data-screen-content><h1>Home</h1></main></div>', "neutral", lintOptionsFor(ref, app)).some(f => f.rule === "shell-utility-missing")).toBe(true);
  const shell = TaskContractSchema.parse({ ...plan().tasks[0], title: "Application shell", ui_screen_keys: [] });
  expect(screenReviewOf(shell, ref)?.screens[0]?.name).toBe("Home");
});

test("a complex screen can preserve twelve elements plus overlays without truncating criteria", () => {
  const proposed = plan(); proposed.tasks[0]!.acceptance_criteria = Array.from({ length: 16 }, (_, i) => `Element ${i} is present`);
  expect(TaskPlanSchema.safeParse(proposed).success).toBe(true);
  expect(TaskContractSchema.safeParse(proposed.tasks[0]).success).toBe(true);
});
