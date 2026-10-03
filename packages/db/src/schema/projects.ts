import { pgTable, text, timestamp, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core";
import type { FeatureStatus, Priority, ProjectLifecycle } from "@sdd/contracts";
import { workspaces, users } from "./identity.js";

/* docs/08_DATA_MODEL.md §4–5 — projects, features + per-project key counters. */

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    highLevelIdea: text("high_level_idea").notNull(),
    /** Optional initial constraints (FR-003), stored as jsonb string list. */
    constraints: text("constraints").array().notNull().default([]),
    lifecycleStatus: text("lifecycle_status").$type<ProjectLifecycle>().notNull().default("IDEA_DRAFT"),
    activeRequirementsRevisionId: uuid("active_requirements_revision_id"),
    activeStackRevisionId: uuid("active_stack_revision_id"),
    activeDesignRevisionId: uuid("active_design_revision_id"),
    /** Exported AGENTS.md project rules (docs/10 → AGENTS.md export). */
    projectRules: text("project_rules").array().notNull().default([]),
    deliveryLockToken: uuid("delivery_lock_token"),
    deliveryLockExpiresAt: timestamp("delivery_lock_expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Set when the user archives the project: hidden from Today, never deleted. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_workspace_key_unique").on(t.workspaceId, t.key)],
);

export const features = pgTable(
  "features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<FeatureStatus>().notNull().default("DRAFT"),
    priority: text("priority").$type<Priority>().notNull().default("P1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("features_project_key_unique").on(t.projectId, t.key)],
);

/** Atomic per-project sequence for display keys (TASK-001, BUG-002, …). */
export const projectCounters = pgTable(
  "project_counters",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: integer("value").notNull().default(0),
  },
  (t) => [uniqueIndex("project_counters_unique").on(t.projectId, t.kind)],
);
