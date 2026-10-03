import { eq } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeWorkspaceAccess } from "../../context.js";
import { ensurePrincipal } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { errors } from "@sdd/shared";

/** Which provider connections and profiles a request may change: SYSTEM rows by operators, WORKSPACE rows by that workspace's admins. */

export type Principal = ReturnType<typeof ensurePrincipal>;

/**
 * The connection a request may change: a workspace admin with ai:manage for a
 * workspace connection, an operator for a SYSTEM one.
 */
export async function authorizeConnection(infra: Infra, principal: Principal, connectionId: string) {
  const [connection] = await infra.db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, connectionId)).limit(1);
  if (!connection) throw errors.notFound("Provider connection");
  if (connection.workspaceId) await authorizeWorkspaceAccess(infra.db, principal, connection.workspaceId, { admin: true, scope: "ai:manage" });
  else if (!principal.isOperator) throw errors.forbidden("Operator access required for SYSTEM connections");
  return connection;
}

/** The profile a request may change, under the same rule as its connection. */
export async function authorizeProfile(infra: Infra, principal: Principal, profileId: string) {
  const [profile] = await infra.db.select().from(schema.aiProfiles).where(eq(schema.aiProfiles.id, profileId)).limit(1);
  if (!profile) throw errors.notFound("AI profile");
  if (profile.workspaceId) await authorizeWorkspaceAccess(infra.db, principal, profile.workspaceId, { admin: true, scope: "ai:manage" });
  else if (!principal.isOperator) throw errors.forbidden("Operator access required for SYSTEM profiles");
  return profile;
}
