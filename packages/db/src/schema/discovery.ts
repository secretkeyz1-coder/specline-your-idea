import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  AnswerType,
  CoverageStatus,
  DiscoveryReadiness,
  DiscoverySessionStatus,
} from "@sdd/contracts";
import { projects } from "./projects.js";
import { users } from "./identity.js";

/* docs/08_DATA_MODEL.md §6 — discovery sessions, questions, answers, facts, assumptions. */

export const discoverySessions = pgTable(
  "discovery_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").$type<DiscoverySessionStatus>().notNull().default("ACTIVE"),
    readiness: text("readiness").$type<DiscoveryReadiness>().notNull().default("INCOMPLETE"),
    /** Coverage topic → {status, blocking} map (docs/04 §4.1). */
    coverage: jsonb("coverage")
      .$type<Record<string, { status: CoverageStatus; blocking: boolean }>>()
      .notNull()
      .default({}),
    understanding: text("understanding").notNull().default(""),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("discovery_sessions_project_idx").on(t.projectId),
    // One ACTIVE session per project, enforced by the database as well as by
    // the project row lock in startDiscovery.
    uniqueIndex("discovery_sessions_one_active").on(t.projectId).where(sql`${t.status} = 'ACTIVE'`),
  ],
);

export const discoveryQuestions = pgTable(
  "discovery_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => discoverySessions.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    topic: text("topic").notNull(),
    questionText: text("question_text").notNull(),
    reason: text("reason").notNull().default(""),
    answerType: text("answer_type").$type<AnswerType>().notNull().default("TEXT"),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    impact: text("impact").$type<"high" | "medium" | "low">().notNull().default("high"),
    blocking: boolean("blocking").notNull().default(false),
    status: text("status").$type<"PENDING" | "ANSWERED" | "SKIPPED">().notNull().default("PENDING"),
    sequence: integer("sequence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("discovery_questions_session_idx").on(t.sessionId),
    uniqueIndex("discovery_questions_session_key_unique").on(t.sessionId, t.questionKey),
  ],
);

export const discoveryAnswers = pgTable(
  "discovery_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => discoveryQuestions.id, { onDelete: "cascade" }),
    answeredBy: uuid("answered_by").references(() => users.id, { onDelete: "set null" }),
    /** { text, selected_options } — answer_type determines shape (FR-013). */
    answer: jsonb("answer").$type<{ text: string; selected_options?: string[] }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One final answer per question (answers are replaced, never appended).
  (t) => [uniqueIndex("discovery_answers_question_unique").on(t.questionId)],
);

export const discoveryFacts = pgTable(
  "discovery_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => discoverySessions.id, { onDelete: "cascade" }),
    factKey: text("fact_key").notNull(),
    value: text("value").notNull(),
    /** USER_STATED facts are separate from AI assumptions (FR-014). */
    sourceType: text("source_type").$type<"USER_STATED" | "DERIVED" | "AI">().notNull().default("DERIVED"),
    sourceRef: uuid("source_ref"),
    confidence: text("confidence").$type<"HIGH" | "MEDIUM" | "LOW">().notNull().default("HIGH"),
    status: text("status").$type<"ACTIVE" | "CORRECTED" | "RETRACTED">().notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("discovery_facts_session_idx").on(t.sessionId),
    uniqueIndex("discovery_facts_session_key_unique").on(t.sessionId, t.factKey),
  ],
);

export const discoveryAssumptions = pgTable(
  "discovery_assumptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => discoverySessions.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    impact: text("impact").notNull().default(""),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    status: text("status").$type<"PROPOSED" | "ACCEPTED" | "REJECTED">().notNull().default("PROPOSED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("discovery_assumptions_session_idx").on(t.sessionId)],
);

export const discoveryContradictions = pgTable(
  "discovery_contradictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => discoverySessions.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    relatedKeys: text("related_keys").array().notNull().default([]),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("discovery_contradictions_session_idx").on(t.sessionId)],
);
