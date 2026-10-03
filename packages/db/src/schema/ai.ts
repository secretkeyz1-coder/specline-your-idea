import { jsonbArray, jsonbObject } from "../jsonb.js";
import { pgTable, text, timestamp, uuid, integer, bigint, index, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  AiRunStatus,
  AIRole,
  ProviderType,
  ScopeType,
} from "@sdd/contracts";
import { users } from "./identity.js";
import { workspaces } from "./identity.js";
import { projects } from "./projects.js";

/* docs/08_DATA_MODEL.md §23–26 — AI provider connections, profiles, role bindings,
 * generation runs. Connection ≠ profile ≠ role binding (C22). SYSTEM scope rows
 * are operator-managed (workspace_id NULL). */

export type ProviderCapabilities = {
  structured_output: boolean;
  tool_calling: boolean;
  vision: boolean;
  streaming: boolean;
};

export type CustomHttpMapping = {
  method: "POST" | "GET";
  path: string;
  request_json_template: Record<string, string>;
  headers: Record<string, string>;
  text_response_pointer: string;
  structured_response_pointer?: string;
};

export const aiProviderConnections = pgTable(
  "ai_provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeType: text("scope_type").$type<ScopeType>().notNull().default("WORKSPACE"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerType: text("provider_type").$type<ProviderType>().notNull(),
    baseUrl: text("base_url"),
    /** Encrypted envelope from @sdd/shared SecretBox — never a plaintext secret. */
    encryptedCredentialRef: text("encrypted_credential_ref"),
    /** {type: BEARER|HEADER, header_name?, key_version} metadata only. */
    credentialMeta: jsonbObject("credential_meta").$type<Record<string, unknown>>().notNull().default({}),
    publicHeaders: jsonbObject("public_headers").$type<Record<string, string>>().notNull().default({}),
    encryptedSecretHeadersRef: text("encrypted_secret_headers_ref"),
    timeoutMs: integer("timeout_ms").notNull().default(120_000),
    capabilities: jsonbObject("capabilities").$type<ProviderCapabilities>().notNull().default({
      structured_output: true,
      tool_calling: false,
      vision: false,
      streaming: false,
    }),
    customHttpMapping: jsonbObject("custom_http_mapping").$type<CustomHttpMapping | null>(),
    status: text("status").$type<"ACTIVE" | "DISABLED">().notNull().default("ACTIVE"),
    lastTestStatus: text("last_test_status").$type<"OK" | "FAILED" | null>(),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_provider_connections_workspace_idx").on(t.workspaceId),
    check(
      "ai_provider_connections_scope_workspace",
      sql`${t.scopeType} <> 'WORKSPACE' OR ${t.workspaceId} IS NOT NULL`,
    ),
  ],
);

export const aiProfiles = pgTable(
  "ai_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeType: text("scope_type").$type<ScopeType>().notNull().default("WORKSPACE"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerConnectionId: uuid("provider_connection_id")
      .notNull()
      .references(() => aiProviderConnections.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    parameters: jsonbObject("parameters").$type<Record<string, unknown>>().notNull().default({}),
    requiredCapabilities: jsonbArray("required_capabilities").$type<string[]>().notNull().default([]),
    status: text("status").$type<"ACTIVE" | "DISABLED">().notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_profiles_workspace_idx").on(t.workspaceId)],
);

export const aiRoleBindings = pgTable(
  "ai_role_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeType: text("scope_type").$type<ScopeType>().notNull().default("WORKSPACE"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<AIRole>().notNull(),
    aiProfileId: uuid("ai_profile_id")
      .notNull()
      .references(() => aiProfiles.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One active binding per scope + role (docs/08 §25). NULLS NOT DISTINCT is
    // required: SYSTEM/WORKSPACE rows carry NULL project/workspace ids and a
    // NULLS DISTINCT index would never collide, so putRoleBinding's
    // onConflictDoUpdate would duplicate instead of update.
    unique("ai_role_bindings_scope_role_unique").on(t.scopeType, t.workspaceId, t.projectId, t.role).nullsNotDistinct(),
    index("ai_role_bindings_project_idx").on(t.projectId),
  ],
);

export const aiGenerationRuns = pgTable(
  "ai_generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    artifactId: uuid("artifact_id"),
    role: text("role").$type<AIRole>().notNull(),
    aiProfileId: uuid("ai_profile_id").references(() => aiProfiles.id, { onDelete: "set null" }),
    providerConnectionId: uuid("provider_connection_id").references(() => aiProviderConnections.id, {
      onDelete: "set null",
    }),
    modelId: text("model_id").notNull(),
    status: text("status").$type<AiRunStatus>().notNull().default("RUNNING"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    latencyMs: bigint("latency_ms", { mode: "number" }),
    inputUnits: bigint("input_units", { mode: "number" }),
    outputUnits: bigint("output_units", { mode: "number" }),
    errorCode: text("error_code"),
    traceId: text("trace_id"),
    requestMetadata: jsonbObject("request_metadata").$type<Record<string, unknown>>().notNull().default({}),
    responseMetadata: jsonbObject("response_metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("ai_generation_runs_workspace_idx").on(t.workspaceId), index("ai_generation_runs_project_idx").on(t.projectId)],
);
