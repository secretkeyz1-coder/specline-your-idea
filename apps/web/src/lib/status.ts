
import {
  Circle,
  CircleDashed,
  CircleCheck,
  Lock,
  Play,
  FlaskConical,
  Eye,
  RefreshCcw,
  OctagonAlert,
  Ban,
} from "lucide-svelte";

/** docs/12 §11 — status label mapping + visual treatment (text/icon authoritative). */

export type WorkflowStatus =
  | "DRAFT" | "READY" | "CLAIMED" | "IN_PROGRESS" | "VALIDATING"
  | "NEEDS_REVIEW" | "CHANGES_REQUESTED" | "BLOCKED" | "DONE" | "CANCELLED";

type IconCmp = typeof CircleDashed;

export const STATUS_META: Record<WorkflowStatus, { label: string; icon: IconCmp; cls: string }> = {
  DRAFT: { label: "Draft", icon: CircleDashed, cls: "text-base-content/80 border-base-300 bg-base-200" },
  // Ready = waiting for an agent, nothing done yet: neutral and hollow. Mint and the
  // check mark mean finished (Done) only, so the two never read alike.
  READY: { label: "Ready", icon: Circle, cls: "text-base-content border-line-control bg-base-100" },
  CLAIMED: { label: "Claimed", icon: Lock, cls: "text-sky border-sky/40 bg-sky-soft" },
  IN_PROGRESS: { label: "Running", icon: Play, cls: "text-sky border-sky/40 bg-sky-soft" },
  VALIDATING: { label: "Testing", icon: FlaskConical, cls: "text-violet border-violet/40 bg-violet-soft" },
  NEEDS_REVIEW: { label: "Review", icon: Eye, cls: "text-warn border-warn/40 bg-warn-soft" },
  CHANGES_REQUESTED: { label: "Rework", icon: RefreshCcw, cls: "text-warn border-warn/40 bg-warn-soft" },
  BLOCKED: { label: "Blocked", icon: OctagonAlert, cls: "text-danger border-danger/40 bg-danger-soft" },
  DONE: { label: "Done", icon: CircleCheck, cls: "text-mint border-mint/40 bg-mint-soft" },
  CANCELLED: { label: "Cancelled", icon: Ban, cls: "text-base-content/75 border-base-300 bg-base-200" },
};

export const KANBAN_COLUMNS: WorkflowStatus[] = [
  "READY", "CLAIMED", "IN_PROGRESS", "VALIDATING", "NEEDS_REVIEW", "CHANGES_REQUESTED", "BLOCKED", "DONE",
];

/**
 * Bug status groups — mirror packages/contracts (BugStatus, isOpenBug,
 * isBlockingBug). Hand-typed "RESOLVED"/"REJECTED" never existed, which made
 * the open/resolved filters and the blocking badge count the wrong bugs.
 */
export const BUG_TRIAGE_STATUSES = ["REPORTED", "ASSESSING"] as const;
export const BUG_BLOCKING_STATUSES = ["CONFIRMED", "PLANNED", "IN_FIX", "VERIFYING"] as const;
export const BUG_RESOLVED_STATUSES = ["VERIFIED", "CLOSED", "NOT_A_BUG", "DUPLICATE", "WONT_FIX"] as const;
export const isOpenBug = (status: string) => !(BUG_RESOLVED_STATUSES as readonly string[]).includes(status);
export const isBlockingBug = (status: string) => (BUG_BLOCKING_STATUSES as readonly string[]).includes(status);

export const BUG_STATUS_COLORS: Record<string, string> = {
  REPORTED: "text-warn border-warn/40",
  ASSESSING: "text-warn border-warn/40",
  CONFIRMED: "text-danger border-danger/40",
  PLANNED: "text-sky border-sky/40",
  IN_FIX: "text-sky border-sky/40",
  VERIFYING: "text-violet border-violet/40",
  VERIFIED: "text-mint border-mint/40",
  CLOSED: "text-mint border-mint/40",
  NOT_A_BUG: "text-base-content/75",
  DUPLICATE: "text-base-content/75",
  WONT_FIX: "text-base-content/75",
};

