import { eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CreateProfileInput, ScopeType } from "@sdd/contracts";
import { DomainError } from "@sdd/shared";
import { isValidCliModel } from "@sdd/agent-cli";
import { profileUsages } from "./bindings.js";
import type { ConnectionRow, ProfileRow } from "./providers.js";

/** AI profiles: a model on a connection, with the scope rules for creating, editing and deleting them. */

/* ── AI profiles (T031/T032) ── */

export async function createProfile(
  db: DbExecutor,
  input: CreateProfileInput & { scopeType: Exclude<ScopeType, "PROJECT">; workspaceId: string | null },
): Promise<ProfileRow> {
  const [connection] = await db
    .select()
    .from(schema.aiProviderConnections)
    .where(eq(schema.aiProviderConnections.id, input.provider_connection_id))
    .limit(1);
  if (!connection) throw new DomainError("PROVIDER_NOT_FOUND", "Provider connection not found", 404);
  assertProfileScopeAllowed(connection, input.scopeType, input.workspaceId);
  assertModelIdFor(connection, input.model_id);

  const missing = input.required_capabilities.filter(
    (cap) => !(connection.capabilities as Record<string, boolean>)[cap as never],
  );
  if (missing.length > 0) {
    throw new DomainError(
      "AI_CAPABILITY_MISMATCH",
      `Connection does not declare required capabilities: ${missing.join(", ")}`,
      400,
    );
  }

  const [row] = await db
    .insert(schema.aiProfiles)
    .values({
      scopeType: input.scopeType,
      workspaceId: input.workspaceId,
      name: input.name,
      providerConnectionId: input.provider_connection_id,
      modelId: input.model_id,
      parameters: input.parameters,
      requiredCapabilities: input.required_capabilities,
    })
    .returning();
  return row!;
}

/** A CLI gets its model on the command line: only plain model ids (see isValidCliModel). */
function assertModelIdFor(connection: Pick<ConnectionRow, "providerType">, modelId: string): void {
  if (connection.providerType === "LOCAL_CLI" && !isValidCliModel(modelId.trim())) {
    throw new DomainError("VALIDATION_ERROR", "A CLI model name may only use letters, digits and . _ : / - (up to 100 characters), or \"default\"");
  }
}

function assertProfileScopeAllowed(
  connection: ConnectionRow,
  scopeType: Exclude<ScopeType, "PROJECT">,
  workspaceId: string | null,
) {
  if (scopeType === "SYSTEM") {
    if (connection.scopeType !== "SYSTEM") {
      throw new DomainError("FORBIDDEN", "SYSTEM profiles require a SYSTEM connection", 403);
    }
    return;
  }
  // WORKSPACE profiles may reference a workspace connection of the same
  // workspace, or an operator-managed SYSTEM connection.
  if (connection.scopeType === "WORKSPACE" && connection.workspaceId !== workspaceId) {
    throw new DomainError("FORBIDDEN", "Profile workspace does not match the provider connection", 403);
  }
}

export function toPublicProfile(row: ProfileRow) {
  return {
    id: row.id,
    scope_type: row.scopeType,
    workspace_id: row.workspaceId,
    name: row.name,
    provider_connection_id: row.providerConnectionId,
    model_id: row.modelId,
    parameters: row.parameters,
    required_capabilities: row.requiredCapabilities,
    status: row.status,
  };
}

export interface UpdateProfileInput {
  name?: string;
  model_id?: string;
  parameters?: Record<string, unknown>;
  status?: "ACTIVE" | "DISABLED";
}

/** Change a saved profile. Bindings keep pointing at it, so a new model takes effect for every bound role. */
export async function updateProfile(db: DbExecutor, profileId: string, patch: UpdateProfileInput): Promise<ProfileRow> {
  const set: Partial<typeof schema.aiProfiles.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new DomainError("VALIDATION_ERROR", "A profile needs a name");
    set.name = patch.name.trim();
  }
  if (patch.model_id !== undefined) {
    if (!patch.model_id.trim()) throw new DomainError("VALIDATION_ERROR", "A profile needs a model id");
    const [connection] = await db
      .select({ providerType: schema.aiProviderConnections.providerType })
      .from(schema.aiProfiles)
      .innerJoin(schema.aiProviderConnections, eq(schema.aiProviderConnections.id, schema.aiProfiles.providerConnectionId))
      .where(eq(schema.aiProfiles.id, profileId))
      .limit(1);
    if (connection) assertModelIdFor(connection, patch.model_id);
    set.modelId = patch.model_id.trim();
  }
  if (patch.parameters !== undefined) set.parameters = patch.parameters;
  if (patch.status !== undefined) set.status = patch.status;
  const [row] = await db.update(schema.aiProfiles).set(set).where(eq(schema.aiProfiles.id, profileId)).returning();
  if (!row) throw new DomainError("PROFILE_NOT_FOUND", "AI profile not found", 404);
  return row;
}

/** Delete a profile; refused while a role binding uses it. */
export async function deleteProfile(db: DbExecutor, profileId: string): Promise<void> {
  const bindings = (await profileUsages(db, [profileId])).get(profileId)!;
  if (bindings.length) {
    throw new DomainError(
      "PROFILE_IN_USE",
      `This profile is bound to ${bindings.length} role${bindings.length === 1 ? "" : "s"} — rebind or unbind them first`,
      409,
      { bindings },
    );
  }
  const deleted = await db.delete(schema.aiProfiles).where(eq(schema.aiProfiles.id, profileId)).returning({ id: schema.aiProfiles.id });
  if (!deleted.length) throw new DomainError("PROFILE_NOT_FOUND", "AI profile not found", 404);
}

/** Remove one role binding; the role then resolves from the next scope, or runs without AI. */
