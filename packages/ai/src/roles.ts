import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { AIRole } from "@sdd/contracts";
import { DomainError, SecretBox } from "@sdd/shared";
import { CLI_DISABLED, type CliPolicy, type ResolvedProfile } from "./types.js";
import { defaultAuthHeaders } from "./endpoints.js";
import { isServerCliTool, parseCliTarget } from "@sdd/agent-cli";

/**
 * Role resolution (T032, FR-159): project override → workspace default →
 * operator-managed system default. Credentials are decrypted only here and
 * never included in any returned record.
 */
export async function resolveEffectiveBinding(
  db: DbExecutor,
  input: { workspaceId: string; projectId?: string | null; role: AIRole },
): Promise<{
  binding: typeof schema.aiRoleBindings.$inferSelect;
  profile: typeof schema.aiProfiles.$inferSelect;
  connection: typeof schema.aiProviderConnections.$inferSelect;
  source: "PROJECT" | "WORKSPACE" | "SYSTEM";
} | null> {
  const attempts: Array<{ scope: "PROJECT" | "WORKSPACE" | "SYSTEM"; where: ReturnType<typeof and> }> = [];
  if (input.projectId) {
    attempts.push({
      scope: "PROJECT",
      where: and(
        eq(schema.aiRoleBindings.scopeType, "PROJECT"),
        eq(schema.aiRoleBindings.projectId, input.projectId),
        eq(schema.aiRoleBindings.role, input.role),
      ),
    });
  }
  attempts.push({
    scope: "WORKSPACE",
    where: and(
      eq(schema.aiRoleBindings.scopeType, "WORKSPACE"),
      eq(schema.aiRoleBindings.workspaceId, input.workspaceId),
      eq(schema.aiRoleBindings.role, input.role),
    ),
  });
  attempts.push({
    scope: "SYSTEM",
    where: and(eq(schema.aiRoleBindings.scopeType, "SYSTEM"), isNull(schema.aiRoleBindings.workspaceId), eq(schema.aiRoleBindings.role, input.role)),
  });

  for (const attempt of attempts) {
    // Deterministic resolution: newest binding wins, id as final tiebreaker.
    // The unique key covers (scope, workspace, project, role), but an attempt
    // can still match several rows (e.g. WORKSPACE-scope rows carrying a
    // stray non-null project_id), so limit(1) alone would be arbitrary.
    const [binding] = await db
      .select()
      .from(schema.aiRoleBindings)
      .where(attempt.where)
      .orderBy(desc(schema.aiRoleBindings.createdAt), asc(schema.aiRoleBindings.id))
      .limit(1);
    if (!binding) continue;
    const [profile] = await db
      .select()
      .from(schema.aiProfiles)
      .where(and(eq(schema.aiProfiles.id, binding.aiProfileId), eq(schema.aiProfiles.status, "ACTIVE")))
      .limit(1);
    if (!profile) continue;
    const [connection] = await db
      .select()
      .from(schema.aiProviderConnections)
      .where(and(eq(schema.aiProviderConnections.id, profile.providerConnectionId), eq(schema.aiProviderConnections.status, "ACTIVE")))
      .limit(1);
    if (!connection) continue;
    return { binding, profile, connection, source: attempt.scope };
  }
  return null;
}

/**
 * Where a LOCAL_CLI connection may point. A CLI on the API host runs as the
 * server, so `cli://server/*` belongs to operator-managed SYSTEM connections
 * only, and only for tools that can be locked out of the host (Claude Code;
 * see SERVER_CLI_TOOLS). Machine targets (a person's own laptop) keep their
 * ownership check at the API layer.
 */
export function assertCliTargetAllowed(baseUrl: string | null | undefined, scopeType: string): void {
  const target = parseCliTarget(baseUrl);
  if (!target) {
    throw new DomainError("VALIDATION_ERROR", "A local CLI connection needs a target: cli://server/claude or cli://machine/<machine-id>/<claude|codex>");
  }
  if (target.where !== "server") return;
  if (!isServerCliTool(target.tool)) {
    throw new DomainError(
      "LOCAL_CLI_NOT_ALLOWED",
      "Only Claude Code may run on the server: Codex's sandbox does not stop it reading server files. Run Codex on your own machine with sdd-agent.",
      400,
    );
  }
  if (scopeType !== "SYSTEM") {
    // Usually a connection saved as a workspace connection before this rule:
    // say how to get out of it, not only that it is refused.
    throw new DomainError(
      "FORBIDDEN",
      "A CLI on the server must be an operator-managed SYSTEM connection. This one was saved for a workspace (before that rule): an operator adds it again in Settings → AI (it is then created as SYSTEM) and points the roles at it, or connects their own machine with sdd-agent instead.",
      403,
    );
  }
}

/** Decrypt connection auth headers at the last responsible moment. */
export async function buildAuthHeaders(secretBox: SecretBox, connection: typeof schema.aiProviderConnections.$inferSelect): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...connection.publicHeaders };
  const meta = connection.credentialMeta as { type?: string; header_name?: string };
  if (connection.encryptedCredentialRef) {
    const secret = await secretBox.decrypt(connection.encryptedCredentialRef);
    if (meta?.type === "HEADER" && meta.header_name) {
      headers[meta.header_name] = secret;
    } else {
      // "BEARER" is what the UI sends for every provider; translate it to the
      // header each native API actually accepts (Anthropic/Gemini reject Bearer).
      Object.assign(headers, defaultAuthHeaders(connection.providerType, secret));
    }
  }
  if (connection.encryptedSecretHeadersRef) {
    const parsed = JSON.parse(await secretBox.decrypt(connection.encryptedSecretHeadersRef)) as Record<string, string>;
    Object.assign(headers, parsed);
  }
  return headers;
}

/** A profile may only run on a connection that declares what it requires. */
export function assertCapabilities(
  profile: typeof schema.aiProfiles.$inferSelect,
  connection: typeof schema.aiProviderConnections.$inferSelect,
): void {
  const required = profile.requiredCapabilities ?? [];
  const missing = required.filter((cap) => !(connection.capabilities as Record<string, boolean>)[cap as never]);
  if (missing.length > 0) {
    throw new DomainError(
      "AI_CAPABILITY_MISMATCH",
      `Profile "${profile.name}" requires capabilities the provider connection lacks: ${missing.join(", ")}`,
      400,
      { missing },
    );
  }
}

export async function resolveEffectiveProfile(
  db: DbExecutor,
  secretBox: SecretBox,
  input: { workspaceId: string; projectId?: string | null; role: AIRole },
  policy: { allowPrivateEgress: boolean; maxResponseBytes: number; cli?: CliPolicy },
): Promise<{ resolved: ResolvedProfile; source: "PROJECT" | "WORKSPACE" | "SYSTEM" } | null> {
  const found = await resolveEffectiveBinding(db, input);
  if (!found) return null;
  const { profile, connection, source } = found;

  assertCapabilities(profile, connection);
  // Rows saved before the server-CLI rule still resolve here: refuse them.
  if (connection.providerType === "LOCAL_CLI") assertCliTargetAllowed(connection.baseUrl, connection.scopeType);

  const headers = await buildAuthHeaders(secretBox, connection);
  return {
    source,
    resolved: {
      profileId: profile.id,
      profileName: profile.name,
      modelId: profile.modelId,
      parameters: profile.parameters,
      connection: {
        id: connection.id,
        providerType: connection.providerType,
        baseUrl: connection.baseUrl,
        headers,
        timeoutMs: connection.timeoutMs,
        capabilities: connection.capabilities,
        customHttpMapping: connection.customHttpMapping,
        allowPrivateEgress: policy.allowPrivateEgress,
        maxResponseBytes: policy.maxResponseBytes,
        cli: policy.cli ?? CLI_DISABLED,
      },
    },
  };
}
