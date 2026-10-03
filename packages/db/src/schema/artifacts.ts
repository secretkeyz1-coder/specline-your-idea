import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ArtifactStatus,
  ArtifactType,
  Priority,
} from "@sdd/contracts";
import { projects, features } from "./projects.js";
import { users } from "./identity.js";

/* docs/08_DATA_MODEL.md §7–9 — versioned artifacts, revisions, requirements,
 * acceptance criteria, stack components. Approved revisions are immutable (C6). */

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id").references(() => features.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type").$type<ArtifactType>().notNull(),
    title: text("title").notNull(),
    currentDraftRevisionId: uuid("current_draft_revision_id"),
    approvedRevisionId: uuid("approved_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("artifacts_project_idx").on(t.projectId),
    uniqueIndex("artifacts_project_type_unique").on(t.projectId, t.artifactType),
  ],
);

export const artifactRevisions = pgTable(
  "artifact_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifacts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentFormat: text("content_format").$type<"markdown" | "json">().notNull().default("json"),
    /** Rendered markdown for human review/edit. */
    content: text("content").notNull().default(""),
    /** AI structured payload validated against @sdd/contracts schemas. */
    structuredContent: jsonb("structured_content"),
    status: text("status").$type<ArtifactStatus>().notNull().default("DRAFT"),
    /** Lineage: [{artifact_id, version}] (T050). */
    derivedFrom: jsonb("derived_from").$type<Array<{ artifact_id: string; version: number }>>().notNull().default([]),
    aiGenerationRunId: uuid("ai_generation_run_id"),
    checksum: text("checksum").notNull(),
    createdByActorType: text("created_by_actor_type").$type<"USER" | "AI" | "SYSTEM">().notNull().default("AI"),
    createdByActorId: text("created_by_actor_id").notNull().default("system"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalNote: text("approval_note").notNull().default(""),
  },
  (t) => [
    uniqueIndex("artifact_revisions_version_unique").on(t.artifactId, t.version),
    index("artifact_revisions_artifact_idx").on(t.artifactId),
    // Integrity: an APPROVED revision must record its approval actor/time.
    check(
      "artifact_revisions_approved_has_actor",
      sql`${t.status} <> 'APPROVED' OR ${t.approvedAt} IS NOT NULL`,
    ),
  ],
);

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: uuid("feature_id").references(() => features.id, { onDelete: "set null" }),
    artifactRevisionId: uuid("artifact_revision_id")
      .notNull()
      .references(() => artifactRevisions.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    type: text("type").$type<"FUNCTIONAL" | "NON_FUNCTIONAL">().notNull().default("FUNCTIONAL"),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    priority: text("priority").$type<Priority>().notNull().default("P1"),
    status: text("status").$type<"ACTIVE" | "SUPERSEDED" | "REMOVED">().notNull().default("ACTIVE"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("requirements_revision_key_unique").on(t.artifactRevisionId, t.key)],
);

export const acceptanceCriteria = pgTable(
  "acceptance_criteria",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    statement: text("statement").notNull(),
    verificationType: text("verification_type").$type<"TEST" | "MANUAL" | "REVIEW" | "METRIC">().notNull().default("TEST"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("acceptance_criteria_requirement_key_unique").on(t.requirementId, t.key)],
);

export const stackComponents = pgTable(
  "stack_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stackRevisionId: uuid("stack_revision_id")
      .notNull()
      .references(() => artifactRevisions.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    technology: text("technology").notNull(),
    versionConstraint: text("version_constraint"),
    selectionSource: text("selection_source")
      .$type<"AI_RECOMMENDED" | "USER_SELECTED" | "AI_ASSISTED">()
      .notNull()
      .default("USER_SELECTED"),
    lockedByUser: boolean("locked_by_user").notNull().default(false),
    rationale: text("rationale").notNull().default(""),
  },
  (t) => [uniqueIndex("stack_components_revision_category_unique").on(t.stackRevisionId, t.category)],
);
