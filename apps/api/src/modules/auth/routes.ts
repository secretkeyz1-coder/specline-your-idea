import { Elysia, t } from "elysia";
import { eq, sql } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authenticateWithPassword, countUsers, createSession, createUser, createWorkspaceWithOwner, destroySession, startDeviceAuthorization, authorizeDeviceCode, denyDeviceCode, passwordIssues } from "@sdd/auth";
import { errors, isUniqueViolation } from "@sdd/shared";
import { authPlugin, clientIp, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import { audit } from "../audit/service.js";
import { requireBrowserSession } from "../../context.js";
import { loadConfig, mayRegister } from "@sdd/config";

/**
 * Browser auth + CLI device flow (T015, T119; docs/09 §20).
 * Application-owned credentials (OD-003 fallback): email + password with
 * server-side sessions. First account bootstraps as operator with a workspace.
 */

const SESSION_COOKIE = "sdd_session";

type SetLike = { set: { headers: Record<string, unknown> } };

function sessionCookie(ctx: SetLike, token: string, maxAge: number) {
  const secure = loadConfig().isProduction ? " Secure;" : "";
  ctx.set.headers["set-cookie"] =
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax;${secure} Max-Age=${maxAge}`;
}

function clearSessionCookie(ctx: SetLike) {
  ctx.set.headers["set-cookie"] = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function authRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1/auth", tags: ["auth"] }).use(authPlugin(infra))
    .get(
      "/status",
      async (ctx) => {
        const userCount = await countUsers(ctx.infra.db);
        return {
          needs_bootstrap: userCount === 0,
          authenticated: ctx.principal !== null,
          user: ctx.principal
            ? { id: ctx.principal.userId, email: ctx.principal.email, display_name: ctx.principal.displayName, is_operator: ctx.principal.isOperator }
            : null,
        };
      },
      { detail: { summary: "Auth/bootstrap status" } },
    )

    .post(
      "/bootstrap",
      async (ctx) => {
        await rateLimit(ctx.infra, "AUTH", `bootstrap:${clientIp(ctx, ctx.infra.config.SDD_TRUST_PROXY)}`);
        // Fast path: a bootstrapped server answers 409 before judging the password.
        if ((await countUsers(ctx.infra.db)) > 0) {
          throw errors.conflict("ALREADY_BOOTSTRAPPED", "An operator account already exists");
        }
        const email = ctx.body.email.trim().toLowerCase();
        const issues = passwordIssues(ctx.body.password);
        if (issues.length) throw errors.validation(`Password needs ${issues.join(", ")}`);
        // Count, operator, workspace and audit row commit in ONE transaction
        // that holds the advisory lock until commit: releasing it after the
        // count let two concurrent bootstraps both see zero users and create
        // two operators. A half-done bootstrap (user without workspace) can no
        // longer be left behind either.
        const user = await ctx.infra.db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(9401)`);
          if ((await countUsers(tx)) > 0) {
            throw errors.conflict("ALREADY_BOOTSTRAPPED", "An operator account already exists");
          }
          const created = await createUser(tx, {
            email,
            displayName: ctx.body.display_name?.trim() || email.split("@")[0]!,
            password: ctx.body.password,
            isOperator: true,
          });
          const workspace = await createWorkspaceWithOwner(tx, {
            name: ctx.body.workspace_name?.trim() || loadConfig().BOOTSTRAP_WORKSPACE,
            ownerUserId: created.id,
          });
          await audit(tx, {
            workspaceId: workspace.id,
            actorType: "USER",
            actorId: created.id,
            source: "WEB",
            action: "auth.bootstrapped",
            entityType: "USER",
            entityId: created.id,
          });
          return created;
        });
        ctx.set.status = 201;
        return { user: { id: user.id, email: user.email, display_name: user.displayName, is_operator: true } };
      },
      {
        body: t.Object({
          email: t.String({ format: "email" }),
          password: t.String({ minLength: 8 }),
          display_name: t.Optional(t.String()),
          workspace_name: t.Optional(t.String()),
        }),
      },
    )

    .post(
      "/login",
      async (ctx) => {
        // Two server-derived buckets: per-IP stops floods from one source,
        // per-email stops distributed attacks on one account. Neither key is
        // fully attacker-controlled (the IP comes from the socket peer unless
        // a trusted proxy is configured).
        const ip = clientIp(ctx, ctx.infra.config.SDD_TRUST_PROXY);
        await rateLimit(ctx.infra, "AUTH", `login:ip:${ip}`);
        await rateLimit(ctx.infra, "AUTH", `login:email:${ctx.body.email.trim().toLowerCase()}`);

        const user = await authenticateWithPassword(ctx.infra.db, ctx.body.email, ctx.body.password);
        if (!user) throw errors.unauthorized("Invalid email or password");

        const { token, expiresAt } = await createSession(ctx.infra.db, user.id, ctx.request.headers.get("user-agent") ?? "");
        sessionCookie(ctx, token, 30 * 86_400);
        // audit_events.workspace_id is a real FK: a user with no workspace yet has
        // nowhere to record the login, and a placeholder id would fail the insert
        // after the session was already issued (500 on a successful login).
        const [membership] = await ctx.infra.db.select({ id: schema.workspaceMembers.workspaceId }).from(schema.workspaceMembers).where(eq(schema.workspaceMembers.userId, user.id)).limit(1);
        if (membership) {
          await audit(ctx.infra.db, {
            workspaceId: membership.id,
            actorType: "USER",
            actorId: user.id,
            source: "WEB",
            action: "auth.login",
            entityType: "USER",
            entityId: user.id,
          });
        }
        return {
          user: { id: user.id, email: user.email, display_name: user.displayName, is_operator: user.isOperator },
          expires_at: expiresAt.toISOString(),
        };
      },
      { body: t.Object({ email: t.String({ format: "email" }), password: t.String({ minLength: 1 }) }) },
    )

    .post(
      "/register",
      async (ctx) => {
        await rateLimit(ctx.infra, "AUTH", `register:${clientIp(ctx, ctx.infra.config.SDD_TRUST_PROXY)}`);
        // Self-registration stays closed until an operator exists: otherwise
        // the first stranger to hit a fresh instance permanently blocks
        // bootstrap (countUsers()>0 → ALREADY_BOOTSTRAPPED forever).
        const [operator] = await ctx.infra.db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.isOperator, true))
          .limit(1);
        if (!operator) throw errors.forbidden("Bootstrap the operator account before self-registration (NOT_BOOTSTRAPPED)");
        // Checked before the email lookup, so a closed server does not reveal
        // which addresses already have an account.
        if (!mayRegister(ctx.infra.config, ctx.body.email)) {
          throw errors.forbidden("Sign-up is closed on this server — ask the administrator to add your email (REGISTRATION_CLOSED)");
        }
        const existing = await ctx.infra.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, ctx.body.email.trim().toLowerCase())).limit(1);
        if (existing.length > 0) throw errors.conflict("EMAIL_TAKEN", "That email is already registered");
        const issues = passwordIssues(ctx.body.password);
        if (issues.length) throw errors.validation(`Password needs ${issues.join(", ")}`);
        // User and workspace commit together (no account without a workspace),
        // and a concurrent sign-up with the same email that slips past the
        // check above is a 409, not a unique-index 500.
        const user = await ctx.infra.db
          .transaction(async (tx) => {
            const created = await createUser(tx, {
              email: ctx.body.email,
              displayName: ctx.body.display_name?.trim() || ctx.body.email.split("@")[0]!,
              password: ctx.body.password,
            });
            await createWorkspaceWithOwner(tx, { name: ctx.body.workspace_name?.trim() || "Workspace", ownerUserId: created.id });
            return created;
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error, "users_email_unique")) throw errors.conflict("EMAIL_TAKEN", "That email is already registered");
            throw error;
          });
        ctx.set.status = 201;
        return { user: { id: user.id, email: user.email, display_name: user.displayName } };
      },
      {
        body: t.Object({
          email: t.String({ format: "email" }),
          password: t.String({ minLength: 8 }),
          display_name: t.Optional(t.String()),
          workspace_name: t.Optional(t.String()),
        }),
      },
    )

    .post("/logout", async (ctx) => {
      const cookie = ctx.request.headers.get("cookie");
      const match = cookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
      if (match?.[1]) {
        
        await destroySession(ctx.infra.db, decodeURIComponent(match[1]));
      }
      clearSessionCookie(ctx);
      return { ok: true };
    })

    .get("/me", async (ctx) => {
      const principal = ensurePrincipal(ctx);
      const workspaces = await ctx.infra.db
        .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
        .from(schema.workspaceMembers)
        .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
        .where(eq(schema.workspaceMembers.userId, principal.userId));
      return {
        user: { id: principal.userId, email: principal.email, display_name: principal.displayName, is_operator: principal.isOperator, source: principal.source, token_id: principal.tokenId },
        workspaces: workspaces.map((w) => ({ id: w.workspace.id, slug: w.workspace.slug, name: w.workspace.name, role: w.role })),
      };
    })

    /* ── CLI device flow ── */
    .post(
      "/cli/start",
      async (ctx) => {
        await rateLimit(ctx.infra, "AUTH", `cli-start:${clientIp(ctx, ctx.infra.config.SDD_TRUST_PROXY)}`);
        const { deviceCode, userCode, expiresAt } = await startDeviceAuthorization(ctx.infra.db, ctx.body.client_name ?? "sddctl");
        return {
          device_code: deviceCode,
          user_code: userCode,
          verification_url: `${ctx.infra.config.WEB_PUBLIC_URL}/cli/authorize?code=${userCode}`,
          expires_at: expiresAt.toISOString(),
          // 5s polling = 12 req/min, safely inside the 20/min AUTH rate limit
          // for approvals that take longer than one burst window.
          interval: 5,
        };
      },
      { body: t.Object({ client_name: t.Optional(t.String({ maxLength: 120 })) }) },
    )

    .post(
      "/cli/exchange",
      async (ctx) => {
        await rateLimit(ctx.infra, "AUTH", `cli-exchange:${clientIp(ctx, ctx.infra.config.SDD_TRUST_PROXY)}`);
        const { exchangeDeviceCode } = await import("@sdd/auth");
        const result = await exchangeDeviceCode(ctx.infra.db, ctx.body.device_code);
        if (result.status === "AUTHORIZED") {
          return { status: "AUTHORIZED", access_token: result.token, token_type: "bearer" };
        }
        return { status: result.status };
      },
      { body: t.Object({ device_code: t.String({ minLength: 8 }) }) },
    )

    .post(
      "/cli/approve",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        // Approving mints a fresh broadly-scoped token, so it must be a human in
        // a browser — never an existing (possibly narrower) API token.
        requireBrowserSession(principal, "Approving a CLI login");
        const result = await authorizeDeviceCode(ctx.infra.db, ctx.body.user_code, principal.userId, [
          "project:read",
          // Read-only access to approved specs: `sddctl ui pull` writes the
          // approved UI reference into the repository the agent builds in.
          "artifact:read",
          "task:read",
          "task:execute",
          "run:write",
          "run:submit",
          "bug:write",
          // Required by `sddctl project link`, which registers the calling
          // machine via POST /machines/register. Without it the device-flow
          // token could never link a repository and the CLI was dead on arrival.
          "machine:register",
        ]);
        if (!result.ok) throw errors.validation(`Could not authorize: ${result.reason}`);
        return { ok: true };
      },
      { body: t.Object({ user_code: t.String({ minLength: 4, maxLength: 20 }) }) },
    )

    .post(
      "/cli/deny",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        requireBrowserSession(principal, "Denying a CLI login");
        await denyDeviceCode(ctx.infra.db, ctx.body.user_code, principal.userId);
        return { ok: true };
      },
      { body: t.Object({ user_code: t.String({ minLength: 4, maxLength: 20 }) }) },
    );
}
