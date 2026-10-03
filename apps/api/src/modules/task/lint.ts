import type { TaskRow } from "./repo.js";
import type { TaskContract, RiskFactors } from "@sdd/contracts";
import { deriveHardness, deriveReviewPolicy, deriveRiskLevel } from "@sdd/contracts";
import { parseVerificationCommand } from "@sdd/contracts";
import { contradictsOutcome } from "../planning/quality.js";

/**
 * Atomic task linter (T087, docs/11 §6–7) + hardness/risk model (T088, docs/11 §8).
 * A task cannot become READY until every BLOCKING lint check passes (C9).
 */

export interface LintFinding {
  id: string;
  severity: "BLOCKING" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  message: string;
}

export interface LintResult {
  ok: boolean;
  findings: LintFinding[];
}

const AMBIGUOUS_WORDS = ["appropriate", "user-friendly", "secure", "optimize", "handle everything", "modern", "fast"];

/** A title that names the shared application shell (or its navigation). */
export const SHELL_TITLE = /\b(app(?:lication)? shell|shell|app(?:lication)? layout|navigation|navigasi|sidebar|side ?bar|app ?bar|kerangka aplikasi|layout aplikasi)\b/i;

const MOCKUP_FILE = /docs\/ui-reference\/[\w.-]+\.html/g;

/**
 * The UI-reference screen files a task builds. The screen constraint sentence
 * ("Layout, elements … follow docs/ui-reference/<key>.html …") names them; a
 * model that rewords it ("follows the mockup at docs/ui-reference/…") still
 * names the file, so any mockup file in a constraint counts — except in the
 * shell task, which cites the mockups for their navigation, not to build them.
 */
export function screenFilesOf(task: { title?: string; constraints?: string[]; ui_screen_keys?: string[] } | null | undefined): string[] {
  if (task?.ui_screen_keys?.length) return task.ui_screen_keys.map(k => `docs/ui-reference/${k}.html`);
  const constraints = task?.constraints ?? [];
  const strict = new Set<string>();
  for (const c of constraints) {
    for (const m of c.matchAll(/\bfollows? [`"']?(docs\/ui-reference\/[\w.-]+\.html)/g)) strict.add(m[1]!);
  }
  if (strict.size || (task?.title && SHELL_TITLE.test(task.title))) return [...strict];
  return [...new Set(constraints.flatMap((c) => c.match(MOCKUP_FILE) ?? []))];
}

type Checked = { verification?: { required?: Array<{ type?: string; command: string }> } } | null | undefined;

/** The task's required browser render check (a Playwright command), if it has one. A jsdom or unit test is not one. */
export function renderCheckCommand(contract: Checked): string | null {
  return (contract?.verification?.required ?? []).find((r) => r.type !== "manual" && /\bplaywright\s+test\b/i.test(r.command) && /\be2e\/render\/[\w.-]+\.spec\.[jt]sx?\b/.test(r.command) && !/--(?:version|list|help|ui|debug)\b/.test(r.command))?.command ?? null;
}

export function hasRenderCheck(contract: Checked): boolean {
  return renderCheckCommand(contract) !== null;
}

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];

/**
 * The key elements no acceptance criterion carries: fewer than 60% of an
 * element's words appear anywhere in the criteria. Loose on purpose — it
 * catches an element that was dropped, not one that was reworded.
 */
export function missingKeyElements(elements: string[], criteria: string[]): string[] {
  const words = new Set(wordsOf(criteria.join(" ")));
  return elements.filter((e) => {
    const own = wordsOf(e);
    return criteria.some(c => contradictsOutcome(e, c)) || (own.length > 0 && own.filter((w) => words.has(w)).length / own.length < 0.6);
  });
}

export function lintTask(
  task: Pick<TaskRow, "title" | "objective" | "key" | "contract" | "workflowStatus">,
  context: {
    hasTraceability: boolean;
    dependenciesExist: boolean;
    graphAcyclic: boolean;
    artifactsCurrent: boolean;
    duplicateTitles: number;
    reviewPolicyResolved: boolean;
    /** The approved UI reference: whether screens need a render check (web) and each screen file's key elements. */
    ui?: { renderChecks: boolean; keyElements: Record<string, string[]> } | null;
  },
): LintResult {
  const findings: LintFinding[] = [];
  const contract = task.contract as TaskContract;

  // 1–2: stable ID + title
  if (!task.key || task.key.length < 3) findings.push({ id: "missing_id", severity: "BLOCKING", message: "Task has no stable ID" });
  if (!task.title?.trim()) findings.push({ id: "missing_title", severity: "BLOCKING", message: "Task has no title" });

  // 3: bounded objective
  if (!task.objective || task.objective.trim().length < 20) {
    findings.push({ id: "objective_thin", severity: "BLOCKING", message: "Objective is missing or too thin to bound the outcome (min 20 chars)" });
  }
  // 4: source traceability (C1)
  if (!context.hasTraceability) {
    findings.push({ id: "no_traceability", severity: "BLOCKING", message: "Feature tasks require at least one linked requirement or acceptance criterion (C1)" });
  }
  // 5: acceptance criteria
  if (!contract.acceptance_criteria?.length) {
    findings.push({ id: "no_acceptance", severity: "BLOCKING", message: "No explicit acceptance criteria" });
  }
  // 6: verification
  if (!contract.verification?.required?.length) {
    findings.push({ id: "no_verification", severity: "BLOCKING", message: "No required verification commands" });
  }
  for (const check of contract.verification?.required ?? []) if (check.type !== "manual") {
    const parsed = parseVerificationCommand(check.command);
    if (!parsed.ok) findings.push({ id: "verification_unsupported", severity: "BLOCKING", message: `Verification cannot run: ${parsed.reason}` });
  }
  // 7: scope
  if (!contract.scope?.expected_paths?.length) {
    findings.push({ id: "no_scope", severity: "BLOCKING", message: "No expected scope paths declared" });
  }
  // 8: deliverables
  if (!contract.deliverables?.length) {
    findings.push({ id: "no_deliverables", severity: "BLOCKING", message: "No expected deliverables" });
  }
  // 9: stop conditions
  if (!contract.stop_conditions?.length) {
    findings.push({ id: "no_stop_conditions", severity: "BLOCKING", message: "No stop/block conditions" });
  }
  // 10–11: dependencies
  if (!context.dependenciesExist) {
    findings.push({ id: "deps_missing", severity: "BLOCKING", message: "One or more declared dependencies do not exist" });
  }
  if (!context.graphAcyclic) {
    findings.push({ id: "dependency_cycle", severity: "BLOCKING", message: "Dependency graph contains a cycle" });
  }
  // 12: blocking placeholders
  if (/\b(TBD|TODO|FIXME|XXX|\?\?\?)\b/.test(`${task.title} ${task.objective} ${contract.acceptance_criteria.join(" ")}`)) {
    findings.push({ id: "placeholder", severity: "BLOCKING", message: "Unresolved blocking placeholder (TBD/TODO) remains" });
  }
  // 13: artifact freshness
  if (!context.artifactsCurrent) {
    findings.push({ id: "artifacts_stale", severity: "BLOCKING", message: "Parent artifact revisions are stale or not approved" });
  }
  // 14: duplication
  if (context.duplicateTitles > 1) {
    findings.push({ id: "duplicate", severity: "HIGH", message: "Another task shares this exact title — possible duplicate" });
  }
  // 15: risk/hardness
  const hardness = deriveHardness(contract.risk_factors);
  if (!hardness || hardness < 1) {
    findings.push({ id: "no_risk", severity: "MEDIUM", message: "Risk/hardness factors missing" });
  }
  // 16: review policy
  if (!context.reviewPolicyResolved) {
    findings.push({ id: "no_review_policy", severity: "HIGH", message: "Review policy unresolved" });
  }

  // 17: screen tasks — a jsdom test passing says nothing about what the browser
  // shows, so a screen needs a render check; and its key elements must reach
  // the criteria, or they drop out of the build silently (docs/28 R1).
  const screenFiles = screenFilesOf(contract);
  if (context.ui?.renderChecks && SHELL_TITLE.test(task.title) && !hasRenderCheck(contract)) findings.push({ id: "no_shell_check", severity: "BLOCKING", message: "Application shell requires a bounded browser utility test on an in-app route" });
  if (screenFiles.length && context.ui) {
    if (screenFiles.some(f => !(f in context.ui!.keyElements))) findings.push({ id: "screen_unknown", severity: "BLOCKING", message: "Task references a screen outside the approved UI reference" });
    if (context.ui.renderChecks && !hasRenderCheck(contract)) {
      findings.push({ id: "no_render_check", severity: "BLOCKING", message: "Screen task has no render check: a required Playwright test that opens the screen at 1280 and 360 px" });
    }
    const missing = screenFiles.flatMap((f) => missingKeyElements(context.ui!.keyElements[f] ?? [], contract.acceptance_criteria ?? []));
    if (missing.length) {
      const shown = missing.slice(0, 5).join("; ");
      findings.push({
        id: "key_elements_missing",
        severity: "BLOCKING",
        message: `Acceptance criteria leave out key elements of the screen: ${shown}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}`,
      });
    }
  }

  // Quality: ambiguity words (docs/11 §7)
  const text = `${task.title} ${task.objective}`.toLowerCase();
  const flagged = AMBIGUOUS_WORDS.filter((w) => text.includes(w));
  if (flagged.length) {
    findings.push({ id: "ambiguity", severity: "MEDIUM", message: `Ambiguous wording without operational definition: ${flagged.join(", ")}` });
  }
  // Quality: size — many unrelated acceptance criteria
  if (contract.acceptance_criteria.length > 6) {
    findings.push({ id: "too_large", severity: "MEDIUM", message: "Many acceptance criteria — consider splitting into smaller bounded tasks" });
  }

  return { ok: !findings.some((f) => f.severity === "BLOCKING"), findings };
}

/** Recompute derived fields from risk factors (T088). */
export function deriveTaskRisk(contract: TaskContract): { hardness: number; riskLevel: TaskRow["riskLevel"]; reviewPolicy: TaskRow["reviewPolicy"] } {
  const factors: RiskFactors = contract.risk_factors;
  return {
    hardness: deriveHardness(factors),
    riskLevel: deriveRiskLevel(factors),
    reviewPolicy: deriveReviewPolicy(factors, contract.task_type),
  };
}
