import { and, asc, eq, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { errors } from "@sdd/shared";
import type { TokenScope } from "@sdd/contracts";
import { hasScope, memberRole, roleCanAdmin, roleCanWrite } from "@sdd/auth";
import type { AuditSource } from "./modules/audit/service.js";

/** Request principal shared by WEB (cookie), CLI (PAT) and MCP (scoped token). */

export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  isOperator: boolean;
  source: AuditSource;
  /** PAT scopes when source is CLI/MCP; browser sessions have full user power. */
  scopes: TokenScope[] | null;
  /** PAT narrowing. */
  tokenWorkspaceId: string | null;
  tokenProjectId: string | null;
  tokenId: string | null;
  /** Machine the token is bound to (pairing tokens), if any. */
  tokenMachineId: string | null;
}

export function principalCan(principal: Principal, scope: TokenScope): boolean {
  // Browser sessions act with the user's full authority; tokens are scoped.
  return principal.scopes === null || hasScope(principal.scopes, scope);
}

export function requireScope(principal: Principal, scope: TokenScope): void {
  if (!principalCan(principal, scope)) {
    throw errors.forbidden(`Missing required scope: ${scope}`, { scope });
  }
}

/** Project/workspace authorization in one place (T016, NFR-002). */
export interface ProjectAccess {
  project: typeof schema.projects.$inferSelect;
  workspaceId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  canWrite: boolean;
  canAdmin: boolean;
}

export async function authorizeProjectAccess(
  db: DbExecutor,
  principal: Principal,
  projectId: string,
  options: { write?: boolean; admin?: boolean; scope?: TokenScope } = {},
): Promise<ProjectAccess> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  if (!project) throw errors.notFound("Project", projectId);
  if (principal.tokenWorkspaceId && principal.tokenWorkspaceId !== project.workspaceId) {
    throw errors.forbidden("Token is not valid for this workspace");
  }
  if (principal.tokenProjectId && principal.tokenProjectId !== project.id) {
    throw errors.forbidden("Token is not valid for this project");
  }
  const role = await memberRole(db, project.workspaceId, principal.userId);
  if (!role) throw errors.forbidden("You do not have access to this project");
  const access: ProjectAccess = {
    project,
    workspaceId: project.workspaceId,
    role,
    canWrite: roleCanWrite(role),
    canAdmin: roleCanAdmin(role),
  };
  if (options.write && !access.canWrite) throw errors.forbidden("Write access required");
  if (options.admin && !access.canAdmin) throw errors.forbidden("Admin access required");
  if (options.scope) requireScope(principal, options.scope);
  return access;
}

export async function authorizeWorkspaceAccess(
  db: DbExecutor,
  principal: Principal,
  workspaceId: string,
  options: { write?: boolean; admin?: boolean; scope?: TokenScope; wholeWorkspace?: boolean } = {},
) {
  if (principal.tokenWorkspaceId && principal.tokenWorkspaceId !== workspaceId) {
    throw errors.forbidden("Token is not valid for this workspace");
  }
  // A project-narrowed token must never act on the whole workspace: that would
  // let a token issued for project A administer (or pair machines into) project B.
  // `wholeWorkspace` extends that to reads of workspace-wide data (the member list).
  if ((options.admin || options.write || options.wholeWorkspace) && principal.tokenProjectId) {
    throw errors.forbidden("Project-scoped tokens cannot act on the whole workspace");
  }
  const role = await memberRole(db, workspaceId, principal.userId);
  if (!role) throw errors.forbidden("You do not have access to this workspace");
  const access = {
    workspaceId,
    role,
    canWrite: roleCanWrite(role),
    canAdmin: roleCanAdmin(role),
  };
  if (options.write && !access.canWrite) throw errors.forbidden("Write access required");
  if (options.admin && !access.canAdmin) throw errors.forbidden("Admin access required");
  if (options.scope) requireScope(principal, options.scope);
  return access;
}

/** Browser-session-only operations (minting credentials, pairing machines). */
export function requireBrowserSession(principal: Principal, action: string): void {
  if (principal.scopes !== null) {
    throw errors.forbidden(`${action} requires a signed-in browser session, not an API token`);
  }
}

/**
 * The workspace a request means when it names none. Deterministic: a token's
 * own workspace (or its project's) first; otherwise the user's oldest
 * membership where they may write, then the oldest of any role — so listing
 * and creating projects without `workspace_id` agree on the same workspace.
 */
export async function primaryWorkspaceId(db: DbExecutor, principal: Principal): Promise<string> {
  if (principal.tokenWorkspaceId) return principal.tokenWorkspaceId;
  if (principal.tokenProjectId) {
    const [project] = await db
      .select({ workspaceId: schema.projects.workspaceId })
      .from(schema.projects)
      .where(eq(schema.projects.id, principal.tokenProjectId))
      .limit(1);
    if (project) return project.workspaceId;
  }
  const [row] = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, principal.userId))
    .orderBy(
      sql`(${schema.workspaceMembers.role} IN ('OWNER', 'ADMIN', 'MEMBER')) DESC`,
      asc(schema.workspaceMembers.createdAt),
      asc(schema.workspaceMembers.workspaceId),
    )
    .limit(1);
  if (!row) throw errors.forbidden("No workspace membership");
  return row.workspaceId;
}

export { and };
