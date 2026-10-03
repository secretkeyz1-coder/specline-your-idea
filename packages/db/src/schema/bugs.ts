import { jsonbArray } from "../jsonb.js";
import { pgTable, text, timestamp, uuid, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import type { BugStatus } from "@sdd/contracts";
import { projects, features } from "./projects.js";

/* docs/08_DATA_MODEL.md §18 — bugs are entities, not statuses (C4).
 * A bug stores the behavior triplet and links to task/run/feature/criterion. */

export const bugs = pgTable(
  "bugs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id").references(() => features.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<BugStatus>().notNull().default("REPORTED"),
    severity: text("severity").$type<"BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "TRIVIAL">().notNull().default("MAJOR"),
    currentBehavior: text("current_behavior").notNull(),
    expectedBehavior: text("expected_behavior").notNull(),
    unchangedBehavior: text("unchanged_behavior").notNull().default(""),
    reproduction: text("reproduction").notNull(),
    /** Fix-work linkage once a fix task/run exists (T158). */
    fixTaskId: uuid("fix_task_id"),
    blockedConvergence: text("blocked_convergence").array().notNull().default([]),
    notes: jsonbArray("notes")
      .$type<Array<{ status: string; note: string; actor_id: string; occurred_at: string }>>()
      .notNull()
      .default([]),
    createdByActorType: text("created_by_actor_type").$type<"USER" | "LOCAL_AGENT" | "MCP" | "DAEMON" | "AI" | "SYSTEM" | "CLI">().notNull().default("USER"),
    createdByActorId: text("created_by_actor_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bugs_project_key_unique").on(t.projectId, t.key),
    index("bugs_project_status_idx").on(t.projectId, t.status),
  ],
);

export const bugLinks = pgTable(
  "bug_links",
  {
    bugId: uuid("bug_id")
      .notNull()
      .references(() => bugs.id, { onDelete: "cascade" }),
    entityType: text("entity_type").$type<"TASK" | "RUN" | "FEATURE" | "ACCEPTANCE_CRITERION" | "REQUIREMENT">().notNull(),
    entityId: uuid("entity_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bugId, t.entityType, t.entityId] }), index("bug_links_entity_idx").on(t.entityType, t.entityId)],
);
