import { jsonbArray, jsonbObject } from "../jsonb.js";
import { pgTable, text, timestamp, uuid, index, jsonb } from "drizzle-orm/pg-core";
import type { FindingType, Severity } from "@sdd/contracts";
import type { ConvergenceOutput } from "@sdd/contracts";
import { features } from "./projects.js";
import { artifactRevisions } from "./artifacts.js";
import { tasks } from "./tasks.js";

/* docs/08_DATA_MODEL.md §19 — convergence runs and findings (FR-140..144). */

export const convergenceRuns = pgTable(
  "convergence_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    featureId: uuid("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    requirementsRevisionId: uuid("requirements_revision_id")
      .notNull()
      .references(() => artifactRevisions.id),
    designRevisionId: uuid("design_revision_id").references(() => artifactRevisions.id),
    status: text("status").$type<"RUNNING" | "COMPLETED" | "FAILED">().notNull().default("RUNNING"),
    summary: text("summary").notNull().default(""),
    completionRecommended: text("completion_recommended").$type<"YES" | "NO">().notNull().default("NO"),
    coverage: jsonbArray("coverage").$type<ConvergenceOutput["coverage"]>().notNull().default([]),
    aiGenerationRunId: uuid("ai_generation_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("convergence_runs_feature_idx").on(t.featureId)],
);

export const convergenceFindings = pgTable(
  "convergence_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    convergenceRunId: uuid("convergence_run_id")
      .notNull()
      .references(() => convergenceRuns.id, { onDelete: "cascade" }),
    findingType: text("finding_type").$type<FindingType>().notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    sourceRef: text("source_ref").notNull().default(""),
    description: text("description").notNull(),
    evidence: text("evidence").notNull().default(""),
    suggestedTask: jsonbObject("suggested_task").$type<NonNullable<ConvergenceOutput["findings"][number]["suggested_task"]> | null>(),
    requirementKey: text("requirement_key"),
    acceptanceCriterionKey: text("acceptance_criterion_key"),
    resolutionStatus: text("resolution_status")
      .$type<"OPEN" | "TASK_GENERATED" | "WAIVED" | "RESOLVED">()
      .notNull()
      .default("OPEN"),
    generatedTaskId: uuid("generated_task_id").references(() => tasks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("convergence_findings_run_idx").on(t.convergenceRunId)],
);
