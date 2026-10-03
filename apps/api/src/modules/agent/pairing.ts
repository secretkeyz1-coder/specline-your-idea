import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { schema, type Database, type DbExecutor } from "@sdd/db";
import { issueApiToken } from "@sdd/auth";
import { DomainError, errors } from "@sdd/shared";
import { authorizeProjectAccess, authorizeWorkspaceAccess, requireBrowserSession, type Principal } from "../../context.js";
import { authPlugin, clientIp, ensurePrincipal, rateLimit } from "../../plugins.js";
import { audit } from "../audit/service.js";
import type { Infra } from "../../infra.js";

/**
 * Pairing flow (business-workflow audit §Connect Repository):
 *   Web CTA → POST /projects/:id/pairing-code   → one signed code
 *   Laptop  → sddctl connect <code>             → POST /agents/pairing/claim
 *
 * The code is a HMAC-signed, expiring, project-bound token carrying a random
 * nonce. The signature proves authenticity; `pairing_code_uses` (keyed by the
 * nonce) makes it single-use. Claiming it registers the machine, issues a
 * machine-bound CLI token, and creates the repository link in one transaction. Scope of trust is
 * exactly the device-flow grant list + machine:register.
 *
 * The code carries the ADMIN's decision (project + permission ceiling), not an
 * identity: the claim is made by the signed-in person running `sddctl connect`
 * (device-flow login first), and the machine, link and token belong to THEM.
 * Before, the laptop silently received the code creator's identity.
 *
 * Exception — self-connect codes (`s: 1`), embedded in the execution prompt a
 * signed-in user copies for their OWN coding agent: the code is the login.
 * Claiming one acts as the code's creator (no device flow), so it is only
 * minted from a browser session, stays single-use, and is short-lived.
 */

export type PairingPermissionMode = "MANUAL" | "ASSISTED" | "AUTO_RUN";

const MODE_RANK: Record<PairingPermissionMode, number> = { MANUAL: 0, ASSISTED: 1, AUTO_RUN: 2 };

/** The pairing code sets the ceiling; the laptop may only ask for less autonomy. */
export function effectivePermissionMode(granted: PairingPermissionMode, requested?: PairingPermissionMode | null): PairingPermissionMode {
  if (!requested) return granted;
  return MODE_RANK[requested] < MODE_RANK[granted] ? requested : granted;
}

export interface PairingPayload {
  p: string; // projectId
  w: string; // workspaceId
  u: string; // createdBy userId
  m: PairingPermissionMode;
  e: number; // expiry epoch ms
  n: string; // single-use nonce
  s?: 1; // self-connect: the claim acts as `u`, no separate login
}

const b64u = (buf: Buffer | string) =>
  Buffer.from(buf).toString("base64url");

export function createPairingCode(
  secret: string,
  input: {
    projectId: string;
    workspaceId: string;
    userId: string;
    permissionMode: PairingPermissionMode;
    ttlMinutes?: number;
    selfConnect?: boolean;
  },
): { code: string; expiresAt: Date } {
  const expiresAt = Date.now() + (input.ttlMinutes ?? 15) * 60_000;
  const payload: PairingPayload = {
    p: input.projectId,
    w: input.workspaceId,
    u: input.userId,
    m: input.permissionMode,
    e: expiresAt,
    n: b64u(randomBytes(16)),
    ...(input.selfConnect ? { s: 1 as const } : {}),
  };
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac("sha256", secret).update(body).digest().subarray(0, 20));
  return { code: `SDDP1.${body}.${sig}`, expiresAt: new Date(expiresAt) };
}

export function verifyPairingCode(
  secret: string,
  code: string,
): { ok: true; payload: PairingPayload } | { ok: false; reason: string } {
  const parts = code.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "SDDP1") return { ok: false, reason: "Malformed pairing code" };
  const [, body, sig] = parts;
  const expected = createHmac("sha256", secret).update(body).digest().subarray(0, 20);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "Invalid pairing code signature" };
  }
  let payload: PairingPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PairingPayload;
  } catch {
    return { ok: false, reason: "Malformed pairing payload" };
  }
  if (!payload.p || !payload.u || !payload.w || !payload.e || !payload.n) return { ok: false, reason: "Malformed pairing payload" };
  if (payload.e <= Date.now()) return { ok: false, reason: "Pairing code expired — generate a new one" };
  return { ok: true, payload };
}

/** The device-flow grant list (incl. artifact:read for `sddctl ui pull`) + machine:register. */
const PAIRING_TOKEN_SCOPES = ["project:read", "artifact:read", "task:read", "task:execute", "run:write", "run:submit", "bug:write", "machine:register"] as const;

/** A self-connect code acts as its creator: an active user, narrowed like the token it will mint. */
async function selfConnectClaimer(db: DbExecutor, payload: PairingPayload): Promise<Principal> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, payload.u)).limit(1);
  if (!user || user.status !== "ACTIVE") throw new DomainError("PAIRING_INVALID", "The account that copied this prompt is no longer active", 403);
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isOperator: user.isOperator,
    source: "CLI",
    scopes: [...PAIRING_TOKEN_SCOPES],
    tokenWorkspaceId: payload.w,
    tokenProjectId: payload.p,
    tokenId: null,
    tokenMachineId: null,
  };
}

/** Machine upsert + scoped token + repository link, in one transaction.
 *  `claimer` is the caller's own login; a self-connect code needs none. */
export async function claimPairing(
  db: Database,
  secret: string,
  input: {
    code: string;
    claimer: Principal | null;
    requestedMode?: PairingPermissionMode | null;
    machine: { name: string; fingerprint: string; platform: string };
    repository: { fingerprint: string; display_path: string; default_branch?: string | null };
  },
) {
  const verdict = verifyPairingCode(secret, input.code);
  if (!verdict.ok) throw new DomainError("PAIRING_INVALID", verdict.reason, 403);
  const payload = verdict.payload;
  return db.transaction(async (tx) => {
    // A self-connect code IS the login — whoever holds it acts as its creator,
    // even when the laptop has another saved sign-in.
    const claimer = payload.s ? await selfConnectClaimer(tx, payload) : input.claimer;
    if (!claimer) {
      throw new DomainError("PAIRING_LOGIN_REQUIRED", "Sign in first: run `sddctl login`, then `sddctl connect <code>` again", 401);
    }
    return claimVerifiedPairing(tx, payload, { ...input, claimer });
  });
}

async function claimVerifiedPairing(
  db: DbExecutor,
  payload: PairingPayload,
  input: {
    claimer: Principal;
    requestedMode?: PairingPermissionMode | null;
    machine: { name: string; fingerprint: string; platform: string };
    repository: { fingerprint: string; display_path: string; default_branch?: string | null };
  },
) {
  const permissionMode = effectivePermissionMode(payload.m, input.requestedMode);
  // The claimer is who the machine will act as: they must be able to work on
  // the project (write access, token narrowing respected, machine:register).
  const claimerAccess = await authorizeProjectAccess(db, input.claimer, payload.p, { write: true, scope: "machine:register" });
  const claimerId = input.claimer.userId;
  // Burn the nonce first: a second claim of the same code conflicts here and
  // the whole transaction (machine, link, token) is never written.
  const burned = await db
    .insert(schema.pairingCodeUses)
    .values({ nonce: payload.n, projectId: payload.p, expiresAt: new Date(payload.e) })
    .onConflictDoNothing()
    .returning({ nonce: schema.pairingCodeUses.nonce });
  if (burned.length === 0) throw new DomainError("PAIRING_ALREADY_USED", "This pairing code has already been used — generate a new one", 409);

  const project = claimerAccess.project;
  if (project.workspaceId !== payload.w) throw new DomainError("PAIRING_INVALID", "The paired project moved to another workspace — generate a new code", 403);
  // The code's creator must still be an admin of the workspace at claim time:
  // they chose the project and the permission ceiling. A self-connect code
  // without auto-approve only needs the write access checked above.
  if (!payload.s || payload.m === "AUTO_RUN") {
    const [membership] = await db
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(and(eq(schema.workspaceMembers.workspaceId, project.workspaceId), eq(schema.workspaceMembers.userId, payload.u)))
      .limit(1);
    if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
      throw new DomainError("PAIRING_INVALID", "The user who created this pairing code no longer administers the workspace", 403);
    }
  }

  // Machine upsert by (claimer, fingerprint) — mirrors POST /agents/machines/register.
  const [existing] = await db
    .select()
    .from(schema.localMachines)
    .where(and(eq(schema.localMachines.userId, claimerId), eq(schema.localMachines.fingerprint, input.machine.fingerprint)))
    .limit(1);
  if (existing?.status === "REVOKED") {
    throw new DomainError("MACHINE_REVOKED", "This machine was revoked; remove it before pairing it again", 403);
  }
  let machine;
  if (existing) {
    const [updated] = await db
      .update(schema.localMachines)
      .set({ name: input.machine.name, platform: input.machine.platform, lastSeenAt: new Date() })
      .where(and(eq(schema.localMachines.id, existing.id), ne(schema.localMachines.status, "REVOKED")))
      .returning();
    machine = updated!;
  } else {
    const [created] = await db
      .insert(schema.localMachines)
      .values({
        userId: claimerId,
        name: input.machine.name,
        fingerprint: input.machine.fingerprint,
        platform: input.machine.platform,
        status: "OFFLINE",
        lastSeenAt: new Date(),
      })
      .returning();
    machine = created!;
  }

  // Repository link: the business bridge between the cloud project and the
  // local source tree (audit §Repository Link). permission_mode comes from the
  // pairing code so the web CTA decides how autonomous the machine may be.
  const repoFingerprint = `${input.machine.fingerprint}:${payload.p}`;
  const [existingLink] = await db
    .select()
    .from(schema.repositoryLinks)
    .where(and(eq(schema.repositoryLinks.projectId, payload.p), eq(schema.repositoryLinks.machineId, machine.id)))
    .limit(1);
  let link;
  if (existingLink) {
    const [updated] = await db
      .update(schema.repositoryLinks)
      .set({ repoFingerprint, displayPath: input.repository.display_path, defaultBranch: input.repository.default_branch ?? null, permissionMode, status: "ACTIVE" })
      .where(eq(schema.repositoryLinks.id, existingLink.id))
      .returning();
    link = updated!;
  } else {
    const [created] = await db
      .insert(schema.repositoryLinks)
      .values({
        projectId: payload.p,
        machineId: machine.id,
        repoFingerprint,
        displayPath: input.repository.display_path,
        defaultBranch: input.repository.default_branch ?? null,
        permissionMode,
        status: "ACTIVE",
      })
      .returning();
    link = created!;
  }

  // Scoped CLI token for the claimer, narrowed to this project and machine.
  const { token, record } = await issueApiToken(db, {
    userId: claimerId,
    name: `pairing:${machine.name}`,
    scopes: [...PAIRING_TOKEN_SCOPES],
    workspaceId: payload.w,
    projectId: payload.p,
    machineId: machine.id,
    expiresAt: new Date(Date.now() + 90 * 24 * 3600_000),
  });
  await db.update(schema.pairingCodeUses).set({ machineId: machine.id }).where(eq(schema.pairingCodeUses.nonce, payload.n));

  await db.insert(schema.auditEvents).values({
    workspaceId: payload.w,
    projectId: payload.p,
    actorType: "USER",
    actorId: claimerId,
    source: input.claimer.source,
    action: "pairing.claimed",
    entityType: "REPOSITORY_LINK",
    entityId: link.id,
    metadata: {
      machine_id: machine.id,
      machine_name: machine.name,
      permission_mode: permissionMode,
      granted_mode: payload.m,
      code_created_by: payload.u,
      claimer_role: claimerAccess.role,
      self_connect: payload.s === 1,
    },
  });

  return {
    user: { email: input.claimer.email },
    token,
    token_prefix: record.tokenPrefix,
    machine_id: machine.id,
    machine_name: machine.name,
    repository_link_id: link.id,
    permission_mode: link.permissionMode,
    project: { id: project.id, key: project.key, name: project.name },
  };
}

/** Who may get a self-connect code in their execution prompt, and with auto-approve. */
export async function selfConnectOptions(db: DbExecutor, principal: Principal, projectId: string) {
  // The code is a login, so only a person in the browser gets one — never an API token.
  if (principal.scopes !== null) return { self_connect: false, auto_approve: false };
  const access = await authorizeProjectAccess(db, principal, projectId);
  return { self_connect: access.canWrite, auto_approve: access.canWrite && access.canAdmin };
}

/**
 * The single-use code the execution prompt embeds (`sddctl connect <code>`):
 * it connects the agent's machine as the person who copied the prompt. null
 * when they may not have one (API token, read-only role) — the prompt then
 * falls back to `sddctl login`. Auto-approve is the admin's browser choice.
 */
export async function mintSelfConnectCode(
  infra: Infra,
  principal: Principal,
  project: { id: string; workspaceId: string },
  autoApprove: boolean,
): Promise<{ code: string; expiresAt: Date; autoApprove: boolean } | null> {
  const options = await selfConnectOptions(infra.db, principal, project.id);
  if (autoApprove && !options.auto_approve) {
    throw errors.forbidden("Only a project admin in the web app can connect a machine with auto-approve");
  }
  if (!options.self_connect) return null;
  await rateLimit(infra, "AI", `pairing-code:${principal.userId}`);
  const permissionMode: PairingPermissionMode = autoApprove ? "AUTO_RUN" : "MANUAL";
  // An hour: the prompt is usually pasted right away, but not always.
  const { code, expiresAt } = createPairingCode(infra.config.SDD_SESSION_SECRET, {
    projectId: project.id,
    workspaceId: project.workspaceId,
    userId: principal.userId,
    permissionMode,
    ttlMinutes: 60,
    selfConnect: true,
  });
  await audit(infra.db, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    actorType: "USER",
    actorId: principal.userId,
    source: "WEB",
    action: "pairing.code_created",
    entityType: "PROJECT",
    entityId: project.id,
    metadata: { permission_mode: permissionMode, expires_at: expiresAt.toISOString(), self_connect: true },
  });
  return { code, expiresAt, autoApprove };
}

/** Pairing routes: code creation (browser session, admin) + claim (the
 *  signed-in person running `sddctl connect`, presenting the code). */
export function pairingRoutes(infra: Infra) {
  const codeRoutes = new Elysia({ prefix: "/api/v1" })
    .use(authPlugin(infra))
    .post(
      "/projects/:projectId/pairing-code",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        // A pairing code mints a new machine token, so only a human in the
        // browser may create one — never an existing (narrower) API token.
        requireBrowserSession(principal, "Creating a pairing code");
        const [project] = await infra.db.select().from(schema.projects).where(eq(schema.projects.id, ctx.params.projectId)).limit(1);
        if (!project) throw errors.notFound("Project");
        await authorizeWorkspaceAccess(infra.db, principal, project.workspaceId, { admin: true });
        await rateLimit(infra, "AI", `pairing-code:${principal.userId}`);
        const permissionMode = (ctx.body.permission_mode ?? "MANUAL") as PairingPermissionMode;
        const { code, expiresAt } = createPairingCode(infra.config.SDD_SESSION_SECRET, {
          projectId: project.id,
          workspaceId: project.workspaceId,
          userId: principal.userId,
          permissionMode,
          ttlMinutes: 15,
        });
        await audit(infra.db, {
          workspaceId: project.workspaceId,
          projectId: project.id,
          actorType: "USER",
          actorId: principal.userId,
          source: "WEB",
          action: "pairing.code_created",
          entityType: "PROJECT",
          entityId: project.id,
          metadata: { permission_mode: permissionMode, expires_at: expiresAt.toISOString() },
        });
        return {
          code,
          expires_at: expiresAt.toISOString(),
          command: `sddctl connect ${code}`,
          permission_mode: permissionMode,
        };
      },
      {
        params: t.Object({ projectId: t.String({ format: "uuid" }) }),
        body: t.Object({ permission_mode: t.Optional(t.Union([t.Literal("MANUAL"), t.Literal("ASSISTED"), t.Literal("AUTO_RUN")])) }),
      },
      )

    // The code (HMAC-verified, expiring, single-use, project-bound) says WHICH
    // project and how much autonomy; the caller's own login says WHO — or, for
    // a self-connect code, the code's creator does. Without either the CLI runs
    // the device flow first (`sddctl connect` does this).
    .post(
      "/agents/pairing/claim",
      async (ctx) => {
        await rateLimit(infra, "AUTH", `pairing-claim:${clientIp(ctx, infra.config.SDD_TRUST_PROXY)}`);
        const result = await claimPairing(infra.db, infra.config.SDD_SESSION_SECRET, {
          code: ctx.body.code,
          claimer: ctx.principal ?? null,
          requestedMode: ctx.body.permission_mode ?? null,
          machine: {
            name: ctx.body.machine.name,
            fingerprint: ctx.body.machine.fingerprint,
            platform: ctx.body.machine.platform,
          },
          repository: {
            fingerprint: ctx.body.repository.repo_fingerprint,
            display_path: ctx.body.repository.display_path,
            default_branch: ctx.body.repository.default_branch ?? null,
          },
        });
        return result;
      },
      {
        body: t.Object({
          code: t.String({ minLength: 10, maxLength: 600 }),
          permission_mode: t.Optional(t.Union([t.Literal("MANUAL"), t.Literal("ASSISTED"), t.Literal("AUTO_RUN")])),
          machine: t.Object({
            name: t.String({ minLength: 1, maxLength: 120 }),
            fingerprint: t.String({ minLength: 8, maxLength: 200 }),
            platform: t.String({ maxLength: 60 }),
          }),
          repository: t.Object({
            repo_fingerprint: t.String({ minLength: 8, maxLength: 300 }),
            display_path: t.String({ minLength: 1, maxLength: 300 }),
            default_branch: t.Optional(t.String({ maxLength: 120 })),
          }),
        }),
      },
    );

  return codeRoutes;
}
