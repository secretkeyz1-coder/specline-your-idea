import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { errors, sha256Hex, timingSafeEqual, nowIso } from "@sdd/shared";
import type { MemberRole, TokenScope } from "@sdd/contracts";
import { createSessionToken, createApiToken, hashDeviceCode, createUserCode, newDeviceCode } from "./tokens.js";
import { hashPassword, verifyPassword } from "./password.js";

const SESSION_TTL_DAYS = 30;
const DEVICE_CODE_TTL_MINUTES = 15;

/* User repository (T013) */

export async function findUserByEmail(db: DbExecutor, email: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()))
    .limit(1);
  return user ?? null;
}

export async function findUserById(db: DbExecutor, id: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return user ?? null;
}

export async function countUsers(db: DbExecutor): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
  return row?.count ?? 0;
}

export async function createUser(
  db: DbExecutor,
  input: { email: string; displayName: string; password?: string; isOperator?: boolean },
) {
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      passwordHash,
      isOperator: input.isOperator ?? false,
    })
    .returning();
  return user!;
}

export async function authenticateWithPassword(db: DbExecutor, email: string, password: string) {
  const user = await findUserByEmail(db, email);
  if (!user) {
    // Constant-ish work for unknown accounts — no fast-path user enumeration.
    await verifyPassword(password, DUMMY_BCRYPT_HASH);
    return null;
  }
  if (!user.passwordHash || user.status !== "ACTIVE") {
    await verifyPassword(password, user.passwordHash ?? DUMMY_BCRYPT_HASH);
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}

/** Same algorithm/cost as production hashes; never matches a real password. */
const DUMMY_BCRYPT_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

/* Workspace repository (T014) */

export async function createWorkspaceWithOwner(
  db: DbExecutor,
  input: { name: string; ownerUserId: string; role?: MemberRole },
) {
  return db.transaction(async (tx) => {
    const normalized = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    let start = 0;
    let end = normalized.length;
    while (start < end && normalized[start] === "-") start++;
    while (end > start && normalized[end - 1] === "-") end--;
    const baseSlug = normalized.slice(start, Math.min(end, start + 40)) || "workspace";
    // ON CONFLICT instead of check-then-insert: two creates with the same name
    // at once used to hit workspaces_slug_unique and fail with a 500.
    let workspace: typeof schema.workspaces.$inferSelect | undefined;
    for (let i = 0; i < 5 && !workspace; i++) {
      const slug = i === 0 ? baseSlug : `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      [workspace] = await tx
        .insert(schema.workspaces)
        .values({ name: input.name, slug })
        .onConflictDoNothing({ target: schema.workspaces.slug })
        .returning();
    }
    if (!workspace) throw errors.conflict("WORKSPACE_SLUG_TAKEN", "Could not find a free address for this workspace name — try another name");
    await tx.insert(schema.workspaceMembers).values({
      workspaceId: workspace!.id,
      userId: input.ownerUserId,
      role: input.role ?? "OWNER",
    });
    return workspace!;
  });
}

export async function listWorkspacesForUser(db: DbExecutor, userId: string) {
  const rows = await db
    .select({
      workspace: schema.workspaces,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId));
  return rows;
}

/** Authorization foundation (T016): resolve the caller's role in a workspace. */
export async function memberRole(db: DbExecutor, workspaceId: string, userId: string): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

export function roleCanWrite(role: MemberRole | null): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

export function roleCanAdmin(role: MemberRole | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/* Browser sessions (T015) */

export async function createSession(db: DbExecutor, userId: string, userAgent: string) {
  const { token, tokenHash } = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({ userId, tokenHash, expiresAt, userAgent });
  return { token, expiresAt };
}

export async function resolveSession(db: DbExecutor, token: string) {
  if (!token) return null;
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256Hex(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  // Same rule as API tokens: a suspended/disabled user loses browser access
  // immediately instead of keeping a 30-day session.
  if (row.user.status !== "ACTIVE") return null;
  await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, row.session.id));
  return row;
}

export async function destroySession(db: DbExecutor, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256Hex(token)));
}

/* API tokens — CLI/MCP (scoped, revocable, expiring; docs/13 §4) */

export async function issueApiToken(
  db: DbExecutor,
  input: {
    userId: string;
    name: string;
    scopes: TokenScope[];
    workspaceId?: string | null;
    projectId?: string | null;
    machineId?: string | null;
    expiresAt?: Date | null;
  },
) {
  const { token, tokenHash, prefix } = createApiToken();
  const [row] = await db
    .insert(schema.apiTokens)
    .values({
      userId: input.userId,
      name: input.name,
      tokenHash,
      tokenPrefix: prefix,
      scopes: input.scopes,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      machineId: input.machineId ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  return { token, record: row! };
}

export async function resolveApiToken(db: DbExecutor, token: string) {
  if (!token) return null;
  const [row] = await db
    .select({ token: schema.apiTokens, user: schema.users })
    .from(schema.apiTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
    .where(eq(schema.apiTokens.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) return null;
  if (row.token.revokedAt) return null;
  if (row.token.expiresAt && row.token.expiresAt.getTime() <= Date.now()) return null;
  if (row.user.status !== "ACTIVE") return null;
  // best-effort lastUsedAt (fire and forget semantics not needed for correctness)
  await db.update(schema.apiTokens).set({ lastUsedAt: new Date() }).where(eq(schema.apiTokens.id, row.token.id));
  return row;
}

export async function revokeApiToken(db: DbExecutor, tokenId: string, userId: string): Promise<boolean> {
  const rows = await db
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.id, tokenId), eq(schema.apiTokens.userId, userId), isNull(schema.apiTokens.revokedAt)))
    .returning({ id: schema.apiTokens.id });
  return rows.length > 0;
}

/** Revoke every live token bound to a machine (machine revocation). */
export async function revokeMachineTokens(db: DbExecutor, machineId: string): Promise<number> {
  const rows = await db
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiTokens.machineId, machineId), isNull(schema.apiTokens.revokedAt)))
    .returning({ id: schema.apiTokens.id });
  return rows.length;
}

/** The caller's tokens, newest first — never includes hashes or raw values. */
export async function listApiTokens(db: DbExecutor, userId: string) {
  return db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      tokenPrefix: schema.apiTokens.tokenPrefix,
      scopes: schema.apiTokens.scopes,
      workspaceId: schema.apiTokens.workspaceId,
      projectId: schema.apiTokens.projectId,
      machineId: schema.apiTokens.machineId,
      expiresAt: schema.apiTokens.expiresAt,
      revokedAt: schema.apiTokens.revokedAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      createdAt: schema.apiTokens.createdAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .orderBy(desc(schema.apiTokens.createdAt));
}

/* CLI device authorization flow (docs/09 §20, docs/10 §11) */

export async function startDeviceAuthorization(db: DbExecutor, clientName: string) {
  const deviceCode = newDeviceCode();
  const userCode = createUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MINUTES * 60_000);
  await db.insert(schema.cliAuthCodes).values({
    deviceCodeHash: hashDeviceCode(deviceCode),
    userCode,
    clientName,
    expiresAt,
  });
  return { deviceCode, userCode, expiresAt };
}

/** Called by the browser approval endpoint when the user confirms the code. */
export async function authorizeDeviceCode(db: DbExecutor, userCode: string, userId: string, scopes: TokenScope[]) {
  const [row] = await db
    .select()
    .from(schema.cliAuthCodes)
    .where(and(eq(schema.cliAuthCodes.userCode, userCode.toUpperCase()), eq(schema.cliAuthCodes.status, "PENDING")))
    .limit(1);
  if (!row) return { ok: false as const, reason: "UNKNOWN_CODE" };
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.update(schema.cliAuthCodes).set({ status: "EXPIRED" }).where(eq(schema.cliAuthCodes.id, row.id));
    return { ok: false as const, reason: "EXPIRED" };
  }
  const { token, record } = await issueApiToken(db, {
    userId,
    name: `CLI ${row.clientName}`,
    scopes,
    expiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
  });
  // The CLI exchanges exactly once; the raw token is held only until then.
  // Conditional on PENDING so two concurrent approvals cannot both attach a token.
  const updated = await db
    .update(schema.cliAuthCodes)
    .set({ status: "AUTHORIZED", userId, apiTokenId: record.id, pendingToken: token })
    .where(and(eq(schema.cliAuthCodes.id, row.id), eq(schema.cliAuthCodes.status, "PENDING")))
    .returning({ id: schema.cliAuthCodes.id });
  if (updated.length === 0) {
    await db.update(schema.apiTokens).set({ revokedAt: new Date() }).where(eq(schema.apiTokens.id, record.id));
    return { ok: false as const, reason: "UNKNOWN_CODE" };
  }
  return { ok: true as const };
}

export async function denyDeviceCode(db: DbExecutor, userCode: string, userId: string) {
  await db
    .update(schema.cliAuthCodes)
    .set({ status: "DENIED", userId })
    .where(and(eq(schema.cliAuthCodes.userCode, userCode.toUpperCase()), eq(schema.cliAuthCodes.status, "PENDING")));
}

/**
 * Poll/exchange: CLI polls with device_code; when status is AUTHORIZED the raw
 * token is returned exactly once and the code transitions to EXCHANGED.
 */
export async function exchangeDeviceCode(db: DbExecutor, deviceCode: string) {
  const [row] = await db
    .select()
    .from(schema.cliAuthCodes)
    .where(eq(schema.cliAuthCodes.deviceCodeHash, hashDeviceCode(deviceCode)))
    .limit(1);
  if (!row) return { status: "EXPIRED" as const };
  if (row.status === "EXCHANGED") return { status: "EXPIRED" as const };
  if (row.expiresAt.getTime() <= Date.now()) {
    // Never leave a raw token at rest: an approved-but-never-exchanged code
    // would otherwise keep a live 30-day credential in cli_auth_codes.
    await db.update(schema.cliAuthCodes).set({ status: "EXPIRED", pendingToken: null }).where(eq(schema.cliAuthCodes.id, row.id));
    if (row.apiTokenId) {
      await db.update(schema.apiTokens).set({ revokedAt: new Date() }).where(eq(schema.apiTokens.id, row.apiTokenId));
    }
    return { status: "EXPIRED" as const };
  }
  if (row.status === "PENDING") return { status: "PENDING" as const };
  if (row.status === "DENIED") return { status: "DENIED" as const };
  // AUTHORIZED — hand over the token exactly once, then burn it. The
  // conditional UPDATE … RETURNING makes concurrent polls race-free: only one
  // of them can observe the row still AUTHORIZED.
  const [claimed] = await db
    .update(schema.cliAuthCodes)
    .set({ status: "EXCHANGED", pendingToken: null })
    .where(and(eq(schema.cliAuthCodes.id, row.id), eq(schema.cliAuthCodes.status, "AUTHORIZED"), isNotNull(schema.cliAuthCodes.pendingToken)))
    .returning({ id: schema.cliAuthCodes.id });
  if (!claimed || !row.pendingToken) return { status: "EXPIRED" as const };
  return { status: "AUTHORIZED" as const, token: row.pendingToken, scopes: [] as TokenScope[] };
}

export { timingSafeEqual, nowIso };
