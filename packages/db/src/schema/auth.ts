import { pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./identity.js";
import { workspaces } from "./identity.js";
import { localMachines } from "./machines.js";

/* Browser sessions, CLI/API tokens, device authorization codes. */

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** sha256 of the raw token; raw token is shown once at creation only. */
    tokenHash: text("token_hash").notNull(),
    /** Display prefix, e.g. `sdd_ab12cd34`. */
    tokenPrefix: text("token_prefix").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    /** Optional narrowing: token only valid for this workspace/project. */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    /** Set for machine-bound tokens (pairing): revoking the machine revokes them. */
    machineId: uuid("machine_id").references(() => localMachines.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_unique").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
    index("api_tokens_machine_idx").on(t.machineId),
  ],
);

/** Single-use ledger for stateless pairing codes: the HMAC proves a code is
 * genuine, this row proves it has not been claimed before. */
export const pairingCodeUses = pgTable("pairing_code_uses", {
  nonce: text("nonce").primaryKey(),
  projectId: uuid("project_id").notNull(),
  machineId: uuid("machine_id").references(() => localMachines.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cliAuthCodes = pgTable(
  "cli_auth_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceCodeHash: text("device_code_hash").notNull(),
    /** Short human code displayed in the browser approval UI. */
    userCode: text("user_code").notNull(),
    status: text("status").$type<"PENDING" | "AUTHORIZED" | "EXCHANGED" | "EXPIRED" | "DENIED">().notNull().default("PENDING"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    apiTokenId: uuid("api_token_id").references(() => apiTokens.id, { onDelete: "set null" }),
    /** Raw token held only until the single exchange (device flow, short TTL). */
    pendingToken: text("pending_token"),
    clientName: text("client_name").notNull().default("sddctl"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cli_auth_codes_device_hash_unique").on(t.deviceCodeHash),
    uniqueIndex("cli_auth_codes_user_code_unique").on(t.userCode),
  ],
);
