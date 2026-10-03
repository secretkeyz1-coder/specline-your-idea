import { pgTable, text, timestamp, uuid, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import type { MachineStatus } from "@sdd/contracts";
import { users } from "./identity.js";
import { projects } from "./projects.js";

/* docs/08_DATA_MODEL.md §20–22 — local machines, repository links,
 * execution-agent profiles (distinct from planning AI Profiles). */

export const localMachines = pgTable(
  "local_machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fingerprint: text("fingerprint").notNull(),
    platform: text("platform").notNull().default(""),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<MachineStatus>().notNull().default("OFFLINE"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("local_machines_user_fingerprint_unique").on(t.userId, t.fingerprint),
    index("local_machines_user_idx").on(t.userId),
  ],
);

export const repositoryLinks = pgTable(
  "repository_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => localMachines.id, { onDelete: "cascade" }),
    repoFingerprint: text("repo_fingerprint").notNull(),
    displayPath: text("display_path").notNull(),
    defaultBranch: text("default_branch"),
    /** MANUAL | ASSISTED | AUTO_RUN (docs/13 §10). Default never auto-dispatches. */
    permissionMode: text("permission_mode").$type<"MANUAL" | "ASSISTED" | "AUTO_RUN">().notNull().default("MANUAL"),
    status: text("status").$type<"ACTIVE" | "REVOKED">().notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("repository_links_project_machine_unique").on(t.projectId, t.machineId),
    index("repository_links_machine_idx").on(t.machineId),
  ],
);

export const executionAgentProfiles = pgTable(
  "execution_agent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    adapterType: text("adapter_type")
      .$type<"generic_shell" | "claude" | "codex" | "kiro" | "gemini" | "custom">()
      .notNull()
      .default("generic_shell"),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
    defaultConfig: jsonb("default_config").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"ACTIVE" | "DISABLED">().notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("execution_agent_profiles_owner_idx").on(t.ownerUserId)],
);
