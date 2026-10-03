/**
 * Human labels for every system value the UI shows. Raw enum strings
 * ("TASK_GENERATION", "local_agent", "roles_permissions") are for machines;
 * pages call these instead of `.toLowerCase().replaceAll("_", " ")`.
 * Unknown values fall back to a readable form, so a new enum never renders blank.
 */

function fallback(value: string): string {
  const s = value.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LIFECYCLE: Record<string, string> = {
  IDEA_DRAFT: "Idea",
  DISCOVERY_ACTIVE: "In discovery",
  DISCOVERY_READY: "Discovery done",
  REQUIREMENTS_DRAFT: "Requirements drafted",
  REQUIREMENTS_APPROVED: "Requirements approved",
  STACK_SELECTION: "Choosing stack",
  STACK_APPROVED: "Stack locked",
  DESIGN_DRAFT: "Design drafted",
  DESIGN_APPROVED: "Design approved",
  TASK_GENERATION: "Tasks generated",
  TASK_REVIEW: "Reviewing tasks",
  EXECUTION_READY: "Ready to build",
  NEEDS_USER_INPUT: "Needs your input",
  STALE: "Specs changed",
  CANCELLED: "Cancelled",
};
export const lifecycleLabel = (v: string) => LIFECYCLE[v] ?? fallback(v);

export interface ProjectProgress {
  tasks_total: number;
  tasks_done: number;
  /** Tasks past READY (including done); absent from older API responses. */
  tasks_started?: number;
  /** Tasks submitted and waiting for review. */
  tasks_review?: number;
  features_total: number;
  features_complete: number;
}

/**
 * Where a project really is. The lifecycle enum stops at "Tasks generated",
 * so past that point the task and feature counts tell the story.
 */
export function projectStage(lifecycle: string, progress?: ProjectProgress | null): string {
  if (progress) {
    if (progress.features_total > 0 && progress.features_complete === progress.features_total) return "Complete";
    if (progress.tasks_total > 0 && progress.tasks_done === progress.tasks_total) {
      // No features to verify means nothing for a release check to count.
      return progress.features_total > 0 ? `Release check · ${progress.features_complete}/${progress.features_total} verified` : "Built";
    }
    if (progress.tasks_done > 0 || (progress.tasks_started ?? 0) > 0) return `Building · ${progress.tasks_done}/${progress.tasks_total} tasks`;
    if (progress.tasks_total > 0) return "Ready to build";
  }
  return lifecycleLabel(lifecycle);
}

const ACTOR: Record<string, string> = {
  USER: "you or a teammate",
  LOCAL_AGENT: "local agent",
  MCP: "MCP agent",
  DAEMON: "background agent",
  AI: "AI",
  SYSTEM: "system",
  CLI: "CLI",
  MANUAL: "recorded by hand",
  MCP_CLIENT: "MCP agent",
};
export const actorLabel = (v: string) => ACTOR[v.toUpperCase()] ?? fallback(v).toLowerCase();

const REVIEW_POLICY: Record<string, string> = {
  HUMAN_OR_APPROVED_REVIEWER: "Needs a reviewer",
  HUMAN_REQUIRED: "Needs a human reviewer",
  AUTO_APPROVE_ALLOWED: "Can be approved automatically when all checks pass",
};
export const reviewPolicyLabel = (v: string) => REVIEW_POLICY[v] ?? fallback(v);

const EVENT: Record<string, string> = {
  task_created: "Task created",
  task_transitioned: "Status changed",
  task_claimed: "Claimed",
  task_released: "Released",
  run_started: "Run started",
  progress_reported: "Progress reported",
  file_change_reported: "Files changed",
  validation_started: "Checks started",
  test_reported: "Test result reported",
  validation_completed: "Checks finished",
  run_blocked: "Run blocked",
  run_failed: "Run failed",
  run_cancelled: "Run cancelled",
  review_requested: "Submitted for review",
  review_approved: "Approved",
  changes_requested: "Changes requested",
  task_completed: "Completed",
  task_reopened: "Reopened",
  lease_expired: "Claim expired",
  bug_linked: "Bug linked",
};
export const eventLabel = (v: string) => EVENT[v] ?? fallback(v);

const COVERAGE: Record<string, string> = {
  problem: "Problem",
  primary_users: "Users",
  core_workflows: "Core workflows",
  mvp_scope: "First-release scope",
  roles_permissions: "Roles & permissions",
  data: "Data",
  integrations: "Integrations",
  platform: "Platform",
  nonfunctional: "Quality needs",
  deployment_constraints: "Deployment",
};
export const coverageTopicLabel = (v: string) => COVERAGE[v] ?? fallback(v);

const COVERAGE_STATUS: Record<string, string> = { KNOWN: "known", PARTIAL: "partly known", UNKNOWN: "not yet", ASSUMED: "assumed" };
export const coverageStatusLabel = (v: string) => COVERAGE_STATUS[v] ?? fallback(v).toLowerCase();

const FINDING: Record<string, string> = {
  COVERED: "Covered",
  PARTIAL: "Partly covered",
  MISSING: "Missing",
  CONTRADICTED: "Contradicts the spec",
  NOT_APPLICABLE: "Not applicable",
};
export const findingLabel = (v: string) => FINDING[v] ?? fallback(v);

const BUG_STATUS: Record<string, string> = {
  REPORTED: "Reported",
  ASSESSING: "Assessing",
  CONFIRMED: "Confirmed",
  PLANNED: "Fix planned",
  IN_FIX: "Being fixed",
  VERIFYING: "Verifying fix",
  VERIFIED: "Fixed",
  CLOSED: "Closed",
  NOT_A_BUG: "Not a bug",
  DUPLICATE: "Duplicate",
  WONT_FIX: "Won't fix",
};
export const bugStatusLabel = (v: string) => BUG_STATUS[v] ?? fallback(v);

/** A status change reads "Ready → Claimed" when the event carries both ends. */
export function eventDescription(type: string, payload: Record<string, unknown>, statusLabel: (s: string) => string): string {
  if (type === "task_transitioned" && typeof payload["from"] === "string" && typeof payload["to"] === "string") {
    return `${statusLabel(payload["from"])} → ${statusLabel(payload["to"])}`;
  }
  return eventLabel(type);
}

const FEATURE_STATUS: Record<string, string> = {
  DRAFT: "Draft",
  PLANNING: "Planning",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  CONVERGENCE: "In release check",
  COMPLETE: "Complete",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled",
};
export const featureStatusLabel = (v: string) => FEATURE_STATUS[v] ?? fallback(v);

/**
 * Hardness is a 1–5 score the planner derives from a task's weighted risk
 * factors (deriveHardness in @sdd/contracts): how hard the work order is for
 * a coding agent to get right. Every place that shows it says so the same way.
 */
const HARDNESS_WORD = ["", "trivial", "easy", "moderate", "hard", "very hard"];
export const hardnessWord = (h: number) => HARDNESS_WORD[Math.min(5, Math.max(1, Math.round(h)))] ?? "";
export const HARDNESS_HINT =
  "Hardness: how hard this work order is for an agent to get right, 1–5, scored from its risk factors — ambiguity, blast radius, cross-module reach, concurrency, database impact, security, integrations, verification and context size.";
export const hardnessTitle = (h: number) => `Hardness ${h}/5 (${hardnessWord(h)}). ${HARDNESS_HINT.replace(/^Hardness: /, "")}`;

