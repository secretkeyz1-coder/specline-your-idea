/**
 * Task engine (Phase 8, T083–T092, FR-050..059), split by job:
 * - generation.ts   — approved spec → task plan (generateTasks, persistTaskPlan, context lines)
 * - readiness.ts    — READY is derived, never assumed (computeTaskReadiness, readyTask, rebase)
 * - drafts.ts       — edits of DRAFT tasks: fields, links, split, merge, parallel candidates
 * - fix-context.ts  — links, scope and checks for server-generated fix tasks
 * - work-order.ts   — the master execution prompt for a local agent
 * - screen-review.ts — what a person checks before approving a screen task; when the policy may not approve it
 * Storage and the dependency graph are repo.ts; the contract lint is lint.ts.
 * This file only re-exports, so importers keep one entry point.
 */
export * from "./generation.js";
export * from "./readiness.js";
export * from "./drafts.js";
export * from "./fix-context.js";
export * from "./work-order.js";
export * from "./screen-review.js";
