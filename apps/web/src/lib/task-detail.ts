/** Shapes of the task detail page (projects/[projectId]/tasks/[taskId]) and its panels. */

export type RunRow = {
  run: {
    id: string;
    attempt: number;
    status: string;
    executorType: string;
    startedAt: string | null;
    endedAt: string | null;
    summary: string | null;
    commitSha: string | null;
    filesChanged: string[];
    metadata?: { ai_review?: { summary: string; recommended_decision: string; acceptance_coverage: Array<{ criterion_index: number; status: string; evidence: string }>; findings: Array<{ severity: string; message: string }> } };
  };
  tests: Array<{
    id: string;
    command: string;
    status: string;
    durationMs: number | null;
    summary: string | null;
  }>;
};

export type TaskDetail = {
  id: string;
  key: string;
  title: string;
  objective: string;
  workflowStatus: string;
  taskType: string;
  priority: string;
  hardness: number;
  riskLevel: string;
  reviewPolicy: string;
  parallelSafe: boolean;
  contract: {
    scope: { expected_paths: string[]; forbidden_paths: string[] };
    constraints: string[];
    acceptance_criteria: string[];
    verification: { required: Array<{ type: string; command: string }>; evidence: string[] };
    deliverables: string[];
    stop_conditions: string[];
  };
};

/** What a reviewer checks on a task that builds a UI-reference screen (API `screen_review`); null for other tasks. */
export type ScreenReview = {
  screens: Array<{ file: string; name: string; key_elements: string[]; inside_shell: boolean }>;
  render_check: { required: boolean; command: string | null };
  screenshots_dir: string | null;
};

export type TaskEventRow = { id: number; eventType: string; actorType: string; payload: Record<string, unknown>; occurredAt: string };
export type ReviewRow = { id: string; decision: string; reviewerId: string; summary: string; findings: Array<{ severity: string; message: string }>; createdAt: string };
export type TaskLinkRow = { key: string; title: string; status: string };
export type TraceLink = { requirement_key: string; requirement_title: string; ac_key: string | null };

/** A run's status in the task board's words. */
export function mapRunStatus(status: string): string {
  const map: Record<string, string> = {
    CREATED: "CLAIMED",
    STARTING: "CLAIMED",
    RUNNING: "IN_PROGRESS",
    VALIDATING: "VALIDATING",
    SUBMITTED: "NEEDS_REVIEW",
    BLOCKED: "BLOCKED",
    FAILED: "BLOCKED",
    CANCELLED: "CANCELLED",
    FINISHED: "DONE",
  };
  return map[status] ?? "DRAFT";
}
