import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { AIRole, ScopeType } from "@sdd/contracts";
import { DomainError } from "@sdd/shared";
import { assertCapabilities, resolveEffectiveBinding } from "../roles.js";
import type { ProfileRow } from "./providers.js";

/** Role bindings: which profile answers each AI role (workspace default or per project), what uses a connection or profile, and the effective routing. */

/* ── Role bindings (T031/T032) ── */

export async function putRoleBinding(
  db: DbExecutor,
  input: {
    scopeType: ScopeType;
    workspaceId: string | null;
    projectId: string | null;
    role: AIRole;
    aiProfileId: string;
    userId: string;
  },
) {
  const [profile] = await db.select().from(schema.aiProfiles).where(eq(schema.aiProfiles.id, input.aiProfileId)).limit(1);
  if (!profile || profile.status !== "ACTIVE") throw new DomainError("PROFILE_NOT_FOUND", "AI profile not found", 404);
  if (input.scopeType === "PROJECT" && !input.projectId) {
    throw new DomainError("VALIDATION_ERROR", "PROJECT bindings require a project");
  }
  // A binding may reference only a profile valid for that scope (docs/08 §25).
  if (input.scopeType === "SYSTEM") {
    if (profile.scopeType !== "SYSTEM") throw new DomainError("FORBIDDEN", "SYSTEM bindings require SYSTEM profiles", 403);
  } else if (profile.scopeType === "WORKSPACE" && profile.workspaceId !== input.workspaceId) {
    throw new DomainError("FORBIDDEN", "Profile belongs to another workspace", 403);
  }

  const [row] = await db
    .insert(schema.aiRoleBindings)
    .values({
      scopeType: input.scopeType,
      workspaceId: input.scopeType === "SYSTEM" ? null : input.workspaceId,
      projectId: input.scopeType === "PROJECT" ? input.projectId : null,
      role: input.role,
      aiProfileId: input.aiProfileId,
      createdBy: input.userId,
    })
    .onConflictDoUpdate({
      target: [schema.aiRoleBindings.scopeType, schema.aiRoleBindings.workspaceId, schema.aiRoleBindings.projectId, schema.aiRoleBindings.role],
      set: { aiProfileId: input.aiProfileId, updatedAt: new Date(), createdBy: input.userId },
    })
    .returning();
  return row!;
}

export async function listRoleBindings(db: DbExecutor, projectId: string | null, workspaceId: string) {
  // projectId=null lists workspace-scope bindings only (settings page).
  const rows = projectId
    ? await db
        .select({
          binding: schema.aiRoleBindings,
          profile: schema.aiProfiles,
          connection: schema.aiProviderConnections,
        })
        .from(schema.aiRoleBindings)
        .innerJoin(schema.aiProfiles, eq(schema.aiProfiles.id, schema.aiRoleBindings.aiProfileId))
        .innerJoin(schema.aiProviderConnections, eq(schema.aiProviderConnections.id, schema.aiProfiles.providerConnectionId))
        .where(eq(schema.aiRoleBindings.projectId, projectId))
    : [];
  const workspaceRows = await db
    .select({
      binding: schema.aiRoleBindings,
      profile: schema.aiProfiles,
      connection: schema.aiProviderConnections,
    })
    .from(schema.aiRoleBindings)
    .innerJoin(schema.aiProfiles, eq(schema.aiProfiles.id, schema.aiRoleBindings.aiProfileId))
    .innerJoin(schema.aiProviderConnections, eq(schema.aiProviderConnections.id, schema.aiProfiles.providerConnectionId))
    .where(and(eq(schema.aiRoleBindings.scopeType, "WORKSPACE"), eq(schema.aiRoleBindings.workspaceId, workspaceId)));

  return { project: rows, workspace: workspaceRows };
}

/**
 * Every project-level override in a workspace, with its project. A project
 * binding wins over the workspace default, so the settings page lists them:
 * otherwise a stale one (a removed model, an old connection) keeps a role on
 * the wrong model in that project with nothing in the UI to show why.
 */
export async function listProjectRoleBindings(db: DbExecutor, workspaceId: string) {
  return db
    .select({
      binding: schema.aiRoleBindings,
      profile: schema.aiProfiles,
      connection: schema.aiProviderConnections,
      project: { id: schema.projects.id, key: schema.projects.key, name: schema.projects.name },
    })
    .from(schema.aiRoleBindings)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.aiRoleBindings.projectId))
    .innerJoin(schema.aiProfiles, eq(schema.aiProfiles.id, schema.aiRoleBindings.aiProfileId))
    .innerJoin(schema.aiProviderConnections, eq(schema.aiProviderConnections.id, schema.aiProfiles.providerConnectionId))
    .where(and(eq(schema.aiRoleBindings.scopeType, "PROJECT"), eq(schema.projects.workspaceId, workspaceId)))
    .orderBy(asc(schema.projects.key), asc(schema.aiRoleBindings.role));
}

/* ── Editing and removal ──
 * Deleting a connection cascades to its profiles and their role bindings in
 * the database. A role that silently loses its binding falls back to another
 * scope or to manual mode, so removal is refused while ANY binding (workspace
 * or project, in any workspace) still uses it; profiles nobody binds go with
 * the connection, and generation history keeps its rows (FK set null). */

/** A role binding that uses a connection or profile, for "in use" answers. */
export interface BindingUse {
  role: AIRole;
  scope: ScopeType;
  workspace_id: string | null;
  project_id: string | null;
  profile_id: string;
  profile_name: string;
}

/** Profiles and role bindings behind each connection, keyed by connection id. */
export async function connectionUsages(
  db: DbExecutor,
  connectionIds: string[],
): Promise<Map<string, { profiles: number; bindings: BindingUse[] }>> {
  const usage = new Map(connectionIds.map((id) => [id, { profiles: 0, bindings: [] as BindingUse[] }]));
  if (connectionIds.length === 0) return usage;
  const profiles = await db
    .select({ id: schema.aiProfiles.id, connectionId: schema.aiProfiles.providerConnectionId })
    .from(schema.aiProfiles)
    .where(inArray(schema.aiProfiles.providerConnectionId, connectionIds));
  for (const p of profiles) usage.get(p.connectionId)!.profiles += 1;
  const bindings = await db
    .select({ binding: schema.aiRoleBindings, profile: schema.aiProfiles })
    .from(schema.aiRoleBindings)
    .innerJoin(schema.aiProfiles, eq(schema.aiProfiles.id, schema.aiRoleBindings.aiProfileId))
    .where(inArray(schema.aiProfiles.providerConnectionId, connectionIds));
  for (const b of bindings) usage.get(b.profile.providerConnectionId)!.bindings.push(bindingUse(b.binding, b.profile));
  return usage;
}

/** Role bindings that use each profile, keyed by profile id. */
export async function profileUsages(db: DbExecutor, profileIds: string[]): Promise<Map<string, BindingUse[]>> {
  const usage = new Map(profileIds.map((id) => [id, [] as BindingUse[]]));
  if (profileIds.length === 0) return usage;
  const rows = await db
    .select({ binding: schema.aiRoleBindings, profile: schema.aiProfiles })
    .from(schema.aiRoleBindings)
    .innerJoin(schema.aiProfiles, eq(schema.aiProfiles.id, schema.aiRoleBindings.aiProfileId))
    .where(inArray(schema.aiRoleBindings.aiProfileId, profileIds));
  for (const r of rows) usage.get(r.profile.id)!.push(bindingUse(r.binding, r.profile));
  return usage;
}

function bindingUse(binding: typeof schema.aiRoleBindings.$inferSelect, profile: ProfileRow): BindingUse {
  return {
    role: binding.role,
    scope: binding.scopeType,
    workspace_id: binding.workspaceId,
    project_id: binding.projectId,
    profile_id: profile.id,
    profile_name: profile.name,
  };
}

/** Fields of a connection that can change after it is saved; `provider_type` cannot. */
export async function deleteRoleBinding(
  db: DbExecutor,
  input: { scopeType: "WORKSPACE" | "PROJECT"; workspaceId: string; projectId: string | null; role: AIRole },
): Promise<boolean> {
  const where =
    input.scopeType === "PROJECT"
      ? and(eq(schema.aiRoleBindings.scopeType, "PROJECT"), eq(schema.aiRoleBindings.projectId, input.projectId!), eq(schema.aiRoleBindings.role, input.role))
      : and(
          eq(schema.aiRoleBindings.scopeType, "WORKSPACE"),
          eq(schema.aiRoleBindings.workspaceId, input.workspaceId),
          isNull(schema.aiRoleBindings.projectId),
          eq(schema.aiRoleBindings.role, input.role),
        );
  const deleted = await db.delete(schema.aiRoleBindings).where(where).returning({ id: schema.aiRoleBindings.id });
  return deleted.length > 0;
}

/**
 * Effective role routing visible to the UI without secrets (T033 DoD). Same
 * resolution as a generation, but nothing is decrypted: describing a route
 * needs no credential.
 */
export async function describeEffectiveRouting(db: DbExecutor, workspaceId: string, projectId: string, role: AIRole) {
  const found = await resolveEffectiveBinding(db, { workspaceId, projectId, role });
  if (!found) return { role, configured: false as const };
  assertCapabilities(found.profile, found.connection);
  return {
    role,
    configured: true as const,
    source: found.source,
    profile_id: found.profile.id,
    profile_name: found.profile.name,
    model_id: found.profile.modelId,
    provider_type: found.connection.providerType,
  };
}

/**
 * A connection as shown to someone who may not see its configuration: the
 * provider list hides SYSTEM connections from non-admins, so routing views
 * show only what identifies one (no URL, headers, capabilities or test state).
 */
