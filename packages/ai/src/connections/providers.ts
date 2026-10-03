import { and, desc, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CreateProviderConnectionInput, ScopeType } from "@sdd/contracts";
import { DomainError, SecretBox, newTraceId } from "@sdd/shared";
import { checkEgress } from "../ssrf.js";
import { effectiveOrigin } from "../endpoints.js";
import { adapterFor } from "../registry.js";
import { assertCliTargetAllowed, buildAuthHeaders } from "../roles.js";
import { CLI_DISABLED, type CliPolicy, type ResolvedConnection } from "../types.js";
import { connectionUsages } from "./bindings.js";

/** Provider connections: create, test, edit (a new host needs a new key), delete, and their public (secret-free) shape. SYSTEM rows are operator-managed; workspace users change only their workspace's rows (FR-154). */

export type ConnectionRow = typeof schema.aiProviderConnections.$inferSelect;
export type ProfileRow = typeof schema.aiProfiles.$inferSelect;

export interface ProviderGatewayConfig {
  allowPrivateEgress: boolean;
  maxResponseBytes: number;
  cli?: CliPolicy;
}

export async function createProviderConnection(
  db: DbExecutor,
  secretBox: SecretBox,
  config: ProviderGatewayConfig,
  input: CreateProviderConnectionInput & { scopeType: Exclude<ScopeType, "PROJECT">; workspaceId: string | null },
): Promise<ConnectionRow> {
  if (input.scopeType === "SYSTEM" && input.workspaceId !== null) {
    throw new DomainError("VALIDATION_ERROR", "SYSTEM-scope connections must not carry a workspace");
  }
  if (input.scopeType === "WORKSPACE" && !input.workspaceId) {
    throw new DomainError("VALIDATION_ERROR", "WORKSPACE-scope connections require a workspace");
  }

  // Egress preflight for custom endpoints (FR-161).
  if (input.provider_type === "LOCAL_CLI") {
    // Not a URL: cli://server/<tool> or cli://machine/<id>/<tool>. Nothing is fetched.
    assertCliTargetAllowed(input.base_url, input.scopeType);
  } else if (input.base_url) {
    const decision = await checkEgress(input.base_url, config.allowPrivateEgress);
    if (!decision.allowed) throw new DomainError("EGRESS_BLOCKED", decision.reason ?? "blocked", 400);
  }
  if (input.provider_type === "CUSTOM_HTTP" && !input.custom_http_mapping) {
    throw new DomainError("VALIDATION_ERROR", "CUSTOM_HTTP providers require custom_http_mapping");
  }
  if (input.provider_type === "CUSTOM_HTTP" && !input.base_url) {
    throw new DomainError("VALIDATION_ERROR", "CUSTOM_HTTP providers require base_url");
  }

  const encryptedCredentialRef = input.credential ? await secretBox.encrypt(input.credential.value) : null;
  const credentialMeta = input.credential
    ? { type: input.credential.type, header_name: input.credential.header_name ?? null }
    : {};
  const secretHeaderEntries = Object.entries(input.secret_headers ?? {});
  const encryptedSecretHeadersRef =
    secretHeaderEntries.length > 0 ? await secretBox.encrypt(JSON.stringify(input.secret_headers)) : null;

  const [row] = await db
    .insert(schema.aiProviderConnections)
    .values({
      scopeType: input.scopeType,
      workspaceId: input.workspaceId,
      name: input.name,
      providerType: input.provider_type,
      baseUrl: input.base_url ?? null,
      encryptedCredentialRef,
      credentialMeta,
      publicHeaders: input.public_headers ?? {},
      encryptedSecretHeadersRef,
      timeoutMs: input.timeout_ms,
      capabilities: input.capabilities,
      customHttpMapping: (input.custom_http_mapping ?? null) as ConnectionRow["customHttpMapping"],
    })
    .returning();
  return row!;
}

/** Credential-bearing fields are write-only: reads never include them (FR-154). */
export function toPublicConnection(row: ConnectionRow) {
  return {
    id: row.id,
    scope_type: row.scopeType,
    workspace_id: row.workspaceId,
    name: row.name,
    provider_type: row.providerType,
    base_url: row.baseUrl,
    has_credential: Boolean(row.encryptedCredentialRef),
    has_secret_headers: Boolean(row.encryptedSecretHeadersRef),
    public_headers: row.publicHeaders,
    timeout_ms: row.timeoutMs,
    capabilities: row.capabilities,
    custom_http_mapping: row.customHttpMapping,
    status: row.status,
    last_test_status: row.lastTestStatus,
    last_tested_at: row.lastTestedAt,
    created_at: row.createdAt,
  };
}

export async function listConnections(
  db: DbExecutor,
  workspaceId: string,
): Promise<ConnectionRow[]> {
  return db
    .select()
    .from(schema.aiProviderConnections)
    .where(eq(schema.aiProviderConnections.workspaceId, workspaceId))
    .orderBy(desc(schema.aiProviderConnections.createdAt));
}

export async function listSystemConnections(db: DbExecutor): Promise<ConnectionRow[]> {
  return db
    .select()
    .from(schema.aiProviderConnections)
    .where(and(eq(schema.aiProviderConnections.scopeType, "SYSTEM")));
}

export async function testProviderConnection(
  db: DbExecutor,
  secretBox: SecretBox,
  config: ProviderGatewayConfig,
  connectionId: string,
  options: { modelId?: string } = {},
): Promise<{ ok: boolean; latencyMs: number; error?: string; errorCode?: string; modelProbe?: string }> {
  const [row] = await db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, connectionId)).limit(1);
  if (!row) throw new DomainError("PROVIDER_NOT_FOUND", "Provider connection not found", 404);
  const startedAt = Date.now();
  try {
    if (row.providerType === "LOCAL_CLI") assertCliTargetAllowed(row.baseUrl, row.scopeType);
    const headers = await buildAuthHeaders(secretBox, row);
    const conn: ResolvedConnection = {
      id: row.id,
      providerType: row.providerType,
      baseUrl: row.baseUrl,
      headers,
      timeoutMs: row.timeoutMs,
      capabilities: row.capabilities,
      customHttpMapping: row.customHttpMapping,
      allowPrivateEgress: config.allowPrivateEgress,
      maxResponseBytes: config.maxResponseBytes,
      cli: config.cli ?? CLI_DISABLED,
    };
    const adapter = adapterFor(row.providerType);
    const modelProbe = options.modelId?.trim() || (row.providerType === "LOCAL_CLI" ? "default" : "probe-model");
    await adapter.generateText(conn, modelProbe, {}, {
      system: "You are a connection probe. Reply with exactly: OK",
      messages: [{ role: "user", content: "Reply with OK" }],
      maxTokens: 512,
    });
    const latencyMs = Date.now() - startedAt;
    await db.update(schema.aiProviderConnections).set({ lastTestStatus: "OK", lastTestedAt: new Date() }).where(eq(schema.aiProviderConnections.id, row.id));
    return { ok: true, latencyMs, modelProbe };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    await db.update(schema.aiProviderConnections).set({ lastTestStatus: "FAILED", lastTestedAt: new Date() }).where(eq(schema.aiProviderConnections.id, row.id));
    const failure = testFailureSummary(error);
    return { ok: false, latencyMs, error: failure.message, errorCode: failure.code };
  }
}

/** Errors whose message the control plane wrote itself (no provider text in it). */
const OWN_MESSAGE_CODES = new Set([
  "EGRESS_BLOCKED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RESPONSE_TOO_LARGE",
  "PROVIDER_MISCONFIGURED",
  "AI_OUTPUT_TRUNCATED",
  "LOCAL_CLI_DISABLED",
  "LOCAL_CLI_UNAVAILABLE",
  "LOCAL_CLI_NOT_ALLOWED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
]);

/**
 * What a failed connection test tells the caller: the status and error
 * code/class, never text from the far end. A test can be pointed at any URL
 * the egress policy allows, so echoing the provider's body (or a transport
 * error naming internal addresses) would make it a way to read those.
 */
export function testFailureSummary(error: unknown): { code: string; message: string } {
  if (!(error instanceof DomainError)) return { code: "PROVIDER_ERROR", message: "The test request failed" };
  const details = (error.details ?? {}) as { status?: unknown; code?: unknown };
  switch (error.code) {
    case "PROVIDER_ERROR": {
      const status = typeof details.status === "number" ? details.status : null;
      const providerCode = typeof details.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(details.code) ? details.code : null;
      return {
        code: error.code,
        message: `${status ? `Provider answered HTTP ${status}` : "Provider reported an error"}${providerCode ? ` (${providerCode})` : ""}`,
      };
    }
    case "PROVIDER_UNREACHABLE":
      return { code: error.code, message: "Could not connect to the provider" };
    case "PROVIDER_BAD_RESPONSE":
    case "AI_OUTPUT_INVALID":
      return { code: error.code, message: "The provider answered, but not in the expected format" };
    default:
      // CLI_* messages come from the CLI on the operator's server or the
      // person's own machine, which the caller controls anyway.
      if (OWN_MESSAGE_CODES.has(error.code) || error.code.startsWith("CLI_")) return { code: error.code, message: error.message };
      return { code: error.code, message: "The test request failed" };
  }
}

export interface UpdateProviderConnectionInput {
  name?: string;
  base_url?: string | null;
  /** A new key replaces the stored one; `null` removes it; absent keeps it. */
  credential?: { type: "BEARER" | "HEADER"; header_name?: string; value: string } | null;
  public_headers?: Record<string, string>;
  /** Replaces the whole set; `{}` removes every secret header. */
  secret_headers?: Record<string, string>;
  timeout_ms?: number;
  capabilities?: ConnectionRow["capabilities"];
  custom_http_mapping?: ConnectionRow["customHttpMapping"];
  status?: "ACTIVE" | "DISABLED";
}

/**
 * Stored secrets were entered for one origin. Moving the connection to another
 * scheme+host+port must not carry them along — the next request (or /test)
 * would hand the old key to the new host. A path change on the same origin
 * keeps them.
 */
export function originChanged(providerType: string, before: string | null | undefined, after: string | null | undefined): boolean {
  if (providerType === "LOCAL_CLI") return false; // a CLI holds no secret
  const a = effectiveOrigin(providerType, before);
  const b = effectiveOrigin(providerType, after);
  return a === null || b === null ? (before?.trim() || null) !== (after?.trim() || null) : a !== b;
}

/** What an update did beyond the fields sent: secrets dropped by an origin change. */
export interface UpdateProviderConnectionResult {
  connection: ConnectionRow;
  /** "credential" and/or "secret_headers" — cleared because the origin changed and they were not re-entered. */
  clearedSecrets: Array<"credential" | "secret_headers">;
}

/**
 * Change a saved connection. The same checks as creation apply to what
 * changes (egress for a new URL, a CLI target for LOCAL_CLI). Secrets stay
 * write-only. A new endpoint or credential clears the last test result, which
 * described the old one. A new origin clears the stored credential and secret
 * headers unless the same request supplies them again.
 */
export async function updateProviderConnection(
  db: DbExecutor,
  secretBox: SecretBox,
  config: ProviderGatewayConfig,
  connectionId: string,
  patch: UpdateProviderConnectionInput,
): Promise<UpdateProviderConnectionResult> {
  const [current] = await db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, connectionId)).limit(1);
  if (!current) throw new DomainError("PROVIDER_NOT_FOUND", "Provider connection not found", 404);
  const isCli = current.providerType === "LOCAL_CLI";
  const set: Partial<typeof schema.aiProviderConnections.$inferInsert> = { updatedAt: new Date() };
  const clearedSecrets: UpdateProviderConnectionResult["clearedSecrets"] = [];
  let endpointChanged = false;

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new DomainError("VALIDATION_ERROR", "A connection needs a name");
    set.name = name;
  }
  if (patch.base_url !== undefined) {
    const baseUrl = patch.base_url?.trim() || null;
    if (isCli) {
      assertCliTargetAllowed(baseUrl, current.scopeType);
    } else if (baseUrl) {
      const decision = await checkEgress(baseUrl, config.allowPrivateEgress);
      if (!decision.allowed) throw new DomainError("EGRESS_BLOCKED", decision.reason ?? "blocked", 400);
    } else if (current.providerType === "CUSTOM_HTTP") {
      throw new DomainError("VALIDATION_ERROR", "CUSTOM_HTTP providers require base_url");
    }
    if (baseUrl !== current.baseUrl) endpointChanged = true;
    if (originChanged(current.providerType, current.baseUrl, baseUrl)) {
      if (patch.credential === undefined && current.encryptedCredentialRef) {
        set.encryptedCredentialRef = null;
        set.credentialMeta = {};
        clearedSecrets.push("credential");
      }
      if (patch.secret_headers === undefined && current.encryptedSecretHeadersRef) {
        set.encryptedSecretHeadersRef = null;
        clearedSecrets.push("secret_headers");
      }
    }
    set.baseUrl = baseUrl;
  }
  if (patch.credential !== undefined) {
    if (isCli && patch.credential) throw new DomainError("VALIDATION_ERROR", "A local CLI uses its own sign-in; it takes no key");
    set.encryptedCredentialRef = patch.credential ? await secretBox.encrypt(patch.credential.value) : null;
    set.credentialMeta = patch.credential ? { type: patch.credential.type, header_name: patch.credential.header_name ?? null } : {};
    endpointChanged = true;
  }
  if (patch.public_headers !== undefined) set.publicHeaders = patch.public_headers;
  if (patch.secret_headers !== undefined) {
    set.encryptedSecretHeadersRef = Object.keys(patch.secret_headers).length ? await secretBox.encrypt(JSON.stringify(patch.secret_headers)) : null;
    endpointChanged = true;
  }
  if (patch.timeout_ms !== undefined) set.timeoutMs = patch.timeout_ms;
  if (patch.custom_http_mapping !== undefined) {
    if (current.providerType === "CUSTOM_HTTP" && !patch.custom_http_mapping) {
      throw new DomainError("VALIDATION_ERROR", "CUSTOM_HTTP providers require custom_http_mapping");
    }
    set.customHttpMapping = patch.custom_http_mapping;
    endpointChanged = true;
  }
  if (patch.capabilities !== undefined) {
    // A profile that requires a capability the connection stops declaring
    // would keep resolving to a provider that cannot serve it.
    const profiles = await db.select().from(schema.aiProfiles).where(eq(schema.aiProfiles.providerConnectionId, connectionId));
    const lost = profiles.flatMap((p) =>
      p.requiredCapabilities.filter((cap) => !(patch.capabilities as Record<string, boolean>)[cap]).map((cap) => `${p.name} needs ${cap}`),
    );
    if (lost.length) throw new DomainError("AI_CAPABILITY_MISMATCH", `Profiles still need these capabilities: ${lost.join("; ")}`, 409);
    set.capabilities = patch.capabilities;
  }
  if (patch.status !== undefined) set.status = patch.status;
  if (endpointChanged) {
    set.lastTestStatus = null;
    set.lastTestedAt = null;
  }

  const [row] = await db.update(schema.aiProviderConnections).set(set).where(eq(schema.aiProviderConnections.id, connectionId)).returning();
  return { connection: row!, clearedSecrets };
}

/** Delete a connection and its unbound profiles; refused while a role binding uses it. */
export async function deleteProviderConnection(db: DbExecutor, connectionId: string): Promise<{ profiles_removed: number }> {
  const usage = (await connectionUsages(db, [connectionId])).get(connectionId)!;
  if (usage.bindings.length) {
    throw new DomainError(
      "PROVIDER_IN_USE",
      `This connection is used by ${usage.bindings.length} role binding${usage.bindings.length === 1 ? "" : "s"} — rebind or unbind those roles, or disable the connection instead`,
      409,
      { bindings: usage.bindings },
    );
  }
  const deleted = await db.delete(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, connectionId)).returning({ id: schema.aiProviderConnections.id });
  if (!deleted.length) throw new DomainError("PROVIDER_NOT_FOUND", "Provider connection not found", 404);
  return { profiles_removed: usage.profiles };
}

/** Fields of a profile that can change; its connection cannot (make a new profile). */
export function toRedactedConnection(row: ConnectionRow) {
  return { id: row.id, scope_type: row.scopeType, name: row.name, provider_type: row.providerType, status: row.status };
}

export { newTraceId };
