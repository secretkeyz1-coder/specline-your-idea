import { jsonbObject } from "../jsonb.js";
import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import type { ActorType } from "@sdd/contracts";
import { workspaces, users } from "./identity.js";
import { projects } from "./projects.js";

/* docs/08_DATA_MODEL.md §27 — append-only audit log (C14). */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id").notNull(),
    /** WEB | CLI | MCP | DAEMON | AI | SYSTEM (FR-172). */
    source: text("source").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonbObject("metadata").$type<Record<string, unknown>>().notNull().default({}),
    traceId: text("trace_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_workspace_time_idx").on(t.workspaceId, t.occurredAt),
    index("audit_events_project_idx").on(t.projectId),
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** Suppression key for duplicate notifications (T192). */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientUserId, t.createdAt),
    index("notifications_dedupe_idx").on(t.dedupeKey),
  ],
);
