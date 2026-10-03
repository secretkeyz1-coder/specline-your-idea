import { WorkflowStatus, type WorkflowStatus as TWorkflowStatus } from "./enums.js";

/**
 * docs/12_AGENT_STATE_MACHINE.md §3 — the task transition table.
 * All other transitions are rejected by default (server authority, C3).
 */
export const TASK_TRANSITIONS: Record<TWorkflowStatus, Partial<Record<string, TWorkflowStatus>>> = {
  DRAFT: {
    ready: "READY",
    cancel: "CANCELLED",
  },
  READY: {
    claim: "CLAIMED",
    cancel: "CANCELLED",
  },
  CLAIMED: {
    start: "IN_PROGRESS",
    release: "READY",
    cancel: "CANCELLED",
  },
  IN_PROGRESS: {
    begin_validation: "VALIDATING",
    block: "BLOCKED",
    requeue: "READY",
    release: "READY",
    cancel: "CANCELLED",
  },
  VALIDATING: {
    validation_failed: "IN_PROGRESS",
    submit: "NEEDS_REVIEW",
    block: "BLOCKED",
    requeue: "READY",
    release: "READY",
    cancel: "CANCELLED",
  },
  NEEDS_REVIEW: {
    approve: "DONE",
    request_changes: "CHANGES_REQUESTED",
    cancel: "CANCELLED",
  },
  CHANGES_REQUESTED: {
    requeue: "READY",
    cancel: "CANCELLED",
  },
  BLOCKED: {
    unblock_ready: "READY",
    unblock_resume: "IN_PROGRESS",
    cancel: "CANCELLED",
  },
  DONE: {},
  CANCELLED: {},
};

export type TaskAction = keyof (typeof TASK_TRANSITIONS)["DRAFT"] | string;

/** Returns the target status when the transition is legal, otherwise null. */
export function resolveTransition(from: TWorkflowStatus, action: string): TWorkflowStatus | null {
  return TASK_TRANSITIONS[from]?.[action] ?? null;
}

export function isLegalTransition(from: TWorkflowStatus, action: string): boolean {
  return resolveTransition(from, action) !== null;
}

export const TERMINAL_STATUSES: readonly TWorkflowStatus[] = ["DONE", "CANCELLED"];

export function isTerminal(status: TWorkflowStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Workflow-status → human label (docs/12 §11). */
export const WORKFLOW_STATUS_LABELS: Record<TWorkflowStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  CLAIMED: "Claimed",
  IN_PROGRESS: "Running",
  VALIDATING: "Testing",
  NEEDS_REVIEW: "Review",
  CHANGES_REQUESTED: "Rework",
  BLOCKED: "Blocked",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

/** Kanban columns (docs/14_UI_UX_SPEC.md §12). */
export const KANBAN_COLUMNS: readonly TWorkflowStatus[] = [
  "READY",
  "CLAIMED",
  "IN_PROGRESS",
  "VALIDATING",
  "NEEDS_REVIEW",
  "CHANGES_REQUESTED",
  "BLOCKED",
  "DONE",
];

/** Run lifecycle transitions (docs/12 §6). */
export const RUN_TRANSITIONS: Record<string, readonly string[]> = {
  CREATED: ["STARTING", "CANCELLED", "FAILED"],
  STARTING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["VALIDATING", "BLOCKED", "FAILED", "CANCELLED"],
  VALIDATING: ["SUBMITTED", "RUNNING", "BLOCKED", "FAILED", "CANCELLED"],
  SUBMITTED: ["FINISHED"],
  BLOCKED: ["RUNNING", "FAILED", "CANCELLED"],
  FAILED: [],
  CANCELLED: [],
  FINISHED: [],
};

export function isLegalRunTransition(from: string, to: string): boolean {
  return RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Bug lifecycle (docs/12 §8). */
export const BUG_TRANSITIONS: Record<string, readonly string[]> = {
  REPORTED: ["ASSESSING", "NOT_A_BUG", "DUPLICATE", "CONFIRMED", "WONT_FIX"],
  ASSESSING: ["CONFIRMED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"],
  CONFIRMED: ["PLANNED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"],
  PLANNED: ["IN_FIX", "WONT_FIX"],
  IN_FIX: ["VERIFYING", "PLANNED"],
  VERIFYING: ["VERIFIED", "IN_FIX", "WONT_FIX"],
  VERIFIED: ["CLOSED"],
  CLOSED: [],
  NOT_A_BUG: [],
  DUPLICATE: [],
  WONT_FIX: [],
};

export function isLegalBugTransition(from: string, to: string): boolean {
  return BUG_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isOpenBug(status: string): boolean {
  return !["VERIFIED", "CLOSED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"].includes(status);
}

export function isBlockingBug(status: string): boolean {
  // Blocking for feature-completion gate: confirmed/planned/in-fix/verifying and not resolved.
  return ["CONFIRMED", "PLANNED", "IN_FIX", "VERIFYING"].includes(status);
}

// Keep the zod schema referenced so tree-shaking tools don't drop the type source.
export const WORKFLOW_STATUS_SCHEMA = WorkflowStatus;
