import { pgTable, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import type { ReviewDecision } from "@sdd/contracts";
import { tasks, taskRuns } from "./tasks.js";

/* docs/08_DATA_MODEL.md §17 — reviews. Decisions: approved / changes_requested /
 * rejected / waived. Reviewer evidence pairing (FR-120) lives in the query layer. */

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => taskRuns.id, { onDelete: "set null" }),
    reviewerType: text("reviewer_type").$type<"USER" | "AI" | "SYSTEM">().notNull().default("USER"),
    reviewerId: text("reviewer_id").notNull(),
    decision: text("decision").$type<ReviewDecision>().notNull(),
    findings: jsonb("findings")
      .$type<Array<{ severity: "BLOCKING" | "HIGH" | "MEDIUM" | "LOW" | "INFO"; message: string }>>()
      .notNull()
      .default([]),
    summary: text("summary").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_task_idx").on(t.taskId)],
);
