import { z } from "zod";

/** docs/12_AGENT_STATE_MACHINE.md — three separate status dimensions. */
export const WorkflowStatus = z.enum([
  "DRAFT",
  "READY",
  "CLAIMED",
  "IN_PROGRESS",
  "VALIDATING",
  "NEEDS_REVIEW",
  "CHANGES_REQUESTED",
  "BLOCKED",
  "DONE",
  "CANCELLED",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;

export const ExecutionResult = z.enum(["NONE", "PASS", "FAIL", "PARTIAL", "ABORTED"]);
export type ExecutionResult = z.infer<typeof ExecutionResult>;

export const AttentionStatus = z.enum([
  "NONE",
  "NEEDS_INPUT",
  "BUG_FOUND",
  "LEASE_EXPIRED",
  "AGENT_DISCONNECTED",
  "POLICY_VIOLATION",
]);
export type AttentionStatus = z.infer<typeof AttentionStatus>;

export const RunStatus = z.enum([
  "CREATED",
  "STARTING",
  "RUNNING",
  "VALIDATING",
  "SUBMITTED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "FINISHED",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const LeaseStatus = z.enum(["ACTIVE", "RELEASED", "EXPIRED"]);
export type LeaseStatus = z.infer<typeof LeaseStatus>;

export const ReviewDecision = z.enum(["APPROVED", "CHANGES_REQUESTED", "REJECTED", "WAIVED"]);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const BugStatus = z.enum([
  "REPORTED",
  "ASSESSING",
  "CONFIRMED",
  "PLANNED",
  "IN_FIX",
  "VERIFYING",
  "VERIFIED",
  "CLOSED",
  "NOT_A_BUG",
  "DUPLICATE",
  "WONT_FIX",
]);
export type BugStatus = z.infer<typeof BugStatus>;

export const FeatureStatus = z.enum([
  "DRAFT",
  "PLANNING",
  "READY",
  "IN_PROGRESS",
  "CONVERGENCE",
  "COMPLETE",
  "BLOCKED",
  "CANCELLED",
]);
export type FeatureStatus = z.infer<typeof FeatureStatus>;

/** docs/08_DATA_MODEL.md §7 artifact types. */
export const ArtifactType = z.enum([
  "discovery",
  "requirements",
  "stack",
  "design",
  "data_model",
  "api_contract",
  "ux",
  "design_system",
  "uat",
  "task_plan",
  "convergence",
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const ArtifactStatus = z.enum([
  "DRAFT",
  "GENERATING",
  "READY_FOR_REVIEW",
  "APPROVED",
  "STALE",
  "SUPERSEDED",
  "FAILED",
]);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const DiscoveryReadiness = z.enum(["INCOMPLETE", "READY_WITH_ASSUMPTIONS", "READY"]);
export type DiscoveryReadiness = z.infer<typeof DiscoveryReadiness>;

export const DiscoverySessionStatus = z.enum(["ACTIVE", "COMPLETED", "ABANDONED"]);
export type DiscoverySessionStatus = z.infer<typeof DiscoverySessionStatus>;

export const AnswerType = z.enum(["TEXT", "SINGLE_CHOICE", "MULTI_CHOICE", "NUMBER", "DATE", "CONSTRAINT"]);
export type AnswerType = z.infer<typeof AnswerType>;

export const CoverageStatus = z.enum(["KNOWN", "PARTIAL", "MISSING", "UNKNOWN"]);
export type CoverageStatus = z.infer<typeof CoverageStatus>;

export const TaskType = z.enum([
  "code",
  "test",
  "database",
  "frontend",
  "backend",
  "integration",
  "documentation",
  "infrastructure",
  "security",
  "research",
  "bugfix",
  "refactor",
]);
export type TaskType = z.infer<typeof TaskType>;

export const Priority = z.enum(["P0", "P1", "P2", "P3"]);
export type Priority = z.infer<typeof Priority>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ReviewPolicy = z.enum(["HUMAN_OR_APPROVED_REVIEWER", "HUMAN_REQUIRED", "AUTO_APPROVE_ALLOWED"]);
export type ReviewPolicy = z.infer<typeof ReviewPolicy>;

export const StackMode = z.enum(["RECOMMENDED", "MANUAL"]);
export type StackMode = z.infer<typeof StackMode>;

/** LOCAL_CLI: a coding-agent CLI (Claude Code, Codex) on the server or a connected machine. */
export const ProviderType = z.enum(["OPENAI", "ANTHROPIC", "GEMINI", "OPENAI_COMPATIBLE", "CUSTOM_HTTP", "LOCAL_CLI"]);
export type ProviderType = z.infer<typeof ProviderType>;

export const AIRole = z.enum([
  "DISCOVERY",
  "SPECIFICATION",
  "ARCHITECTURE",
  "TASK_DECOMPOSITION",
  "REVIEW",
  "CONVERGENCE",
]);
export type AIRole = z.infer<typeof AIRole>;

export const ScopeType = z.enum(["SYSTEM", "WORKSPACE", "PROJECT"]);
export type ScopeType = z.infer<typeof ScopeType>;

export const ActorType = z.enum(["USER", "LOCAL_AGENT", "MCP", "DAEMON", "AI", "SYSTEM", "CLI"]);
export type ActorType = z.infer<typeof ActorType>;

/** docs/06_SYSTEM_DESIGN.md §11 event model + transition lifecycle events. */
export const TaskEventType = z.enum([
  "task_created",
  "task_transitioned",
  "task_claimed",
  "task_released",
  "run_started",
  "progress_reported",
  "file_change_reported",
  "validation_started",
  "test_reported",
  "validation_completed",
  "run_blocked",
  "run_failed",
  "run_cancelled",
  "review_requested",
  "review_approved",
  "changes_requested",
  "task_completed",
  "task_reopened",
  "lease_expired",
  "bug_linked",
]);
export type TaskEventType = z.infer<typeof TaskEventType>;

export const PromptMode = z.enum(["STANDALONE", "CONNECTED_CLI", "CONNECTED_MCP"]);
export type PromptMode = z.infer<typeof PromptMode>;

export const TestStatus = z.enum(["PASSED", "FAILED", "ERROR", "SKIPPED"]);
export type TestStatus = z.infer<typeof TestStatus>;

export const ProjectLifecycle = z.enum([
  "IDEA_DRAFT",
  "DISCOVERY_ACTIVE",
  "DISCOVERY_READY",
  "REQUIREMENTS_DRAFT",
  "REQUIREMENTS_APPROVED",
  "STACK_SELECTION",
  "STACK_APPROVED",
  "DESIGN_DRAFT",
  "DESIGN_APPROVED",
  "TASK_GENERATION",
  "TASK_REVIEW",
  "EXECUTION_READY",
  "NEEDS_USER_INPUT",
  "STALE",
  "CANCELLED",
]);
export type ProjectLifecycle = z.infer<typeof ProjectLifecycle>;

export const MachineStatus = z.enum(["ONLINE", "OFFLINE", "REVOKED"]);
export type MachineStatus = z.infer<typeof MachineStatus>;

export const AiRunStatus = z.enum(["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);
export type AiRunStatus = z.infer<typeof AiRunStatus>;

export const Severity = z.enum(["BLOCKING", "HIGH", "MEDIUM", "LOW", "INFO"]);
export type Severity = z.infer<typeof Severity>;

export const FindingType = z.enum(["COVERED", "PARTIAL", "MISSING", "CONTRADICTED", "NOT_APPLICABLE"]);
export type FindingType = z.infer<typeof FindingType>;

/** docs/09_API_CONTRACT.md §24 permission scopes. */
export const TokenScope = z.enum([
  "project:read",
  "task:read",
  "task:execute",
  "run:write",
  "run:submit",
  "review:approve",
  "bug:write",
  "artifact:read",
  "artifact:write",
  "ai:manage",
  "workspace:admin",
  "machine:register",
]);
export type TokenScope = z.infer<typeof TokenScope>;

export const MemberRole = z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
export type MemberRole = z.infer<typeof MemberRole>;

export const WorkspaceRole = MemberRole;
