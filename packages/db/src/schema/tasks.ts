import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  smallint,
  bigint,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  AttentionStatus,
  ExecutionResult,
  LeaseStatus,
  ReviewPolicy,
  RiskLevel,
  RunStatus,
  TaskEventType,
  TaskType,
  WorkflowStatus,
} from "@sdd/contracts";
import type { RiskFactors, TaskContract } from "@sdd/contracts";
import { projects, features, projectCounters } from "./projects.js";
import { requirements, acceptanceCriteria } from "./artifacts.js";
import { localMachines } from "./machines.js";
import { users } from "./identity.js";

/* docs/08_DATA_MODEL.md §10–16 — tasks, traceability, dependencies, leases,
 * runs, events, test results. */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id").references(() => features.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    taskType: text("task_type").$type<TaskType>().notNull().default("code"),
    workflowStatus: text("workflow_status").$type<WorkflowStatus>().notNull().default("DRAFT"),
    executionResult: text("execution_result").$type<ExecutionResult>().notNull().default("NONE"),
    attentionStatus: text("attention_status").$type<AttentionStatus>().notNull().default("NONE"),
    priority: text("priority").$type<import("@sdd/contracts").Priority>().notNull().default("P1"),
    /** Derived 1–5 (docs/11 §8). */
    hardness: smallint("hardness").notNull().default(1),
    riskLevel: text("risk_level").$type<RiskLevel>().notNull().default("LOW"),
    objective: text("objective").notNull().default(""),
    /** The full atomic task contract (docs/11 §4). */
    contract: jsonb("contract").$type<TaskContract>().notNull(),
    riskFactors: jsonb("risk_factors")
      .$type<RiskFactors>()
      .notNull()
      .default({
        ambiguity: 0,
        blast_radius: 0,
        cross_module: 0,
        concurrency: 0,
        database_impact: 0,
        security: 0,
        integration: 0,
        verification: 0,
        context_size: 0,
      }),
    parallelSafe: boolean("parallel_safe").notNull().default(false),
    /** Lineage to source artifact revisions: [{artifact_id, version}]. */
    createdFromRevisionIds: jsonb("created_from_revision_ids")
      .$type<Array<{ artifact_id: string; version: number }>>()
      .notNull()
      .default([]),
    readinessStatus: text("readiness_status").$type<"NOT_READY" | "READY">().notNull().default("NOT_READY"),
    readinessReport: jsonb("readiness_report")
      .$type<{
        ok: boolean;
        checks: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
        /** Keys of dependency tasks not yet DONE — informational; ordering is enforced at claim time. */
        pendingDependencies?: string[];
      }>()
      .notNull()
      .default({ ok: false, checks: [] }),
    reviewPolicy: text("review_policy").$type<ReviewPolicy>().notNull().default("HUMAN_OR_APPROVED_REVIEWER"),
    lintFindings: jsonb("lint_findings")
      .$type<Array<{ id: string; severity: "BLOCKING" | "HIGH" | "MEDIUM" | "LOW" | "INFO"; message: string }>>()
      .notNull()
      .default([]),
    /** Draft lineage when split/merge (T091/T092). */
    supersededById: uuid("superseded_by_id"),
    splitFromId: uuid("split_from_id"),
    mergedFromIds: text("merged_from_ids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_project_key_unique").on(t.projectId, t.key),
    index("tasks_project_status_idx").on(t.projectId, t.workflowStatus),
    index("tasks_feature_idx").on(t.featureId),
    check("tasks_no_self_supersede", sql`${t.supersededById} IS NULL OR ${t.supersededById} <> ${t.id}`),
  ],
);

export const taskRequirementLinks = pgTable(
  "task_requirement_links",
  {
    // Surrogate pk: a nullable column cannot join a PostgreSQL primary key —
    // requirement-only links (no acceptance criterion) must be storable (C1).
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    acceptanceCriterionId: uuid("acceptance_criterion_id").references(() => acceptanceCriteria.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    index("task_requirement_links_req_idx").on(t.requirementId),
    uniqueIndex("task_req_links_with_ac_unique")
      .on(t.taskId, t.requirementId, t.acceptanceCriterionId)
      .where(sql`${t.acceptanceCriterionId} IS NOT NULL`),
    uniqueIndex("task_req_links_without_ac_unique")
      .on(t.taskId, t.requirementId)
      .where(sql`${t.acceptanceCriterionId} IS NULL`),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type").$type<"FINISH_TO_START" | "OUTPUT">().notNull().default("FINISH_TO_START"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    check("task_dependencies_no_self", sql`${t.taskId} <> ${t.dependsOnTaskId}`),
    index("task_dependencies_dep_idx").on(t.dependsOnTaskId),
  ],
);

export const taskLeases = pgTable(
  "task_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    executorId: text("executor_id").notNull(),
    executorType: text("executor_type").$type<"LOCAL_AGENT" | "MCP_CLIENT" | "MANUAL">().notNull().default("LOCAL_AGENT"),
    status: text("status").$type<LeaseStatus>().notNull().default("ACTIVE"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("task_leases_task_idx").on(t.taskId),
    // At most ONE active lease per task (FR-071) — enforced by the database (C3).
    uniqueIndex("task_leases_one_active_unique")
      .on(t.taskId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    executorType: text("executor_type").$type<"LOCAL_AGENT" | "MCP_CLIENT" | "MANUAL">().notNull().default("LOCAL_AGENT"),
    executorId: text("executor_id").notNull(),
    executionAgentProfileId: uuid("execution_agent_profile_id"),
    machineId: uuid("machine_id").references(() => localMachines.id, { onDelete: "set null" }),
    status: text("status").$type<RunStatus>().notNull().default("CREATED"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    exitCode: integer("exit_code"),
    summary: text("summary"),
    commitSha: text("commit_sha"),
    filesChanged: text("files_changed").array().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("task_runs_attempt_unique").on(t.taskId, t.attempt)],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => taskRuns.id, { onDelete: "set null" }),
    clientSequence: bigint("client_sequence", { mode: "number" }),
    eventType: text("event_type").$type<TaskEventType>().notNull(),
    actorType: text("actor_type").$type<"USER" | "LOCAL_AGENT" | "MCP" | "DAEMON" | "AI" | "SYSTEM" | "CLI">().notNull(),
    actorId: text("actor_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_events_task_idx").on(t.taskId, t.id),
    index("task_events_run_idx").on(t.runId, t.id),
    uniqueIndex("task_events_idempotency_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    uniqueIndex("task_events_client_sequence_unique")
      .on(t.runId, t.clientSequence)
      .where(sql`${t.runId} IS NOT NULL AND ${t.clientSequence} IS NOT NULL`),
  ],
);

export const testResults = pgTable(
  "test_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => taskRuns.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    suite: text("suite"),
    status: text("status").$type<"PASSED" | "FAILED" | "ERROR" | "SKIPPED">().notNull(),
    exitCode: integer("exit_code"),
    durationMs: bigint("duration_ms", { mode: "number" }),
    summary: text("summary"),
    artifactRef: text("artifact_ref"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("test_results_run_idx").on(t.runId),
    uniqueIndex("test_results_idempotency_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

// Re-exported for convenience of api modules.
export { projectCounters };
export { users };
