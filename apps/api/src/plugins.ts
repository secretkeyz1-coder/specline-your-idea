import { Elysia, t } from "elysia";
import { sql } from "drizzle-orm";
import { DomainError, errors, newTraceId, type Logger } from "@sdd/shared";
import { ZodError } from "@sdd/contracts";
import type { TokenScope } from "@sdd/contracts";
import { resolveApiToken, resolveSession } from "@sdd/auth";
import type { Principal } from "./context.js";
import { principalCan } from "./context.js";
import type { Infra } from "./infra.js";

/* Cross-cutting HTTP plumbing: trace ids, error envelope, principal resolution,
 * simple rate limits (T190/T197/T199, docs/09 §1). */

export interface RequestCtx {
  traceId: string;
  principal: Principal | null;
  logger: Logger;
}


function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

interface IpCtx { request: Request; server?: { requestIP(req: Request): { address: string } | null } | null; params?: Record<string, string | undefined> }

/** Client IP for rate-limit keys. The socket peer is authoritative; the LAST
 * x-forwarded-for hop (appended by the closest trusted proxy) is used only
 * when SDD_TRUST_PROXY=true — the first hop is client-controlled and must
 * never be trusted (spoofable rate-limit keys). */
export function clientIp(ctx: IpCtx, trustProxy = false): string {
  if (trustProxy) {
    const last = ctx.request.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
    if (last) return last;
  }
  return ctx.server?.requestIP(ctx.request)?.address ?? "unknown";
}

/**
 * Origins allowed to make credentialed cross-origin calls: the configured web
 * app, plus — outside production — the same port on loopback hosts (the dev
 * server is reached as localhost, 127.0.0.1 or [::1]). Reflecting ANY origin
 * with credentials let every page the developer visited drive the API as them.
 */
export function corsOriginAllowed(origin: string, config: { WEB_PUBLIC_URL: string; NODE_ENV: string }): boolean {
  let web: URL;
  let from: URL;
  try {
    web = new URL(config.WEB_PUBLIC_URL);
    from = new URL(origin);
  } catch {
    return false;
  }
  if (from.origin === web.origin) return true;
  if (config.NODE_ENV === "production") return false;
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const port = (u: URL) => u.port || (u.protocol === "https:" ? "443" : "80");
  return (from.protocol === "http:" || from.protocol === "https:") && loopback.has(from.hostname) && port(from) === port(web);
}

/**
 * Routes that obtain a credential. A stale or foreign bearer sent to them is
 * ignored (anonymous) instead of failing the request with 401 — otherwise an
 * expired saved token would lock the CLI out of logging in again.
 */
const CREDENTIAL_BOOTSTRAP_PATHS = new Set(["/api/v1/auth/cli/start", "/api/v1/auth/cli/exchange", "/api/v1/agents/pairing/claim"]);

/** Resolve the principal from session cookie (browser) or bearer PAT (CLI/MCP). */
async function resolvePrincipal(infra: Infra, ctx: { request: Request }): Promise<Principal | null> {
  const bearer = ctx.request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    const raw = bearer.slice(7).trim();
    const row = await resolveApiToken(infra.db, raw);
    if (!row) {
      if (CREDENTIAL_BOOTSTRAP_PATHS.has(new URL(ctx.request.url).pathname.replace(/\/+$/, ""))) return null;
      throw errors.unauthorized("Invalid or expired token");
    }
    return {
      userId: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      isOperator: row.user.isOperator,
      source: "CLI",
      scopes: row.token.scopes as TokenScope[],
      tokenWorkspaceId: row.token.workspaceId,
      tokenProjectId: row.token.projectId,
      tokenId: row.token.id,
      tokenMachineId: row.token.machineId,
    };
  }
  const sessionToken = parseCookie(ctx.request.headers.get("cookie"), "sdd_session");
  if (sessionToken) {
    const row = await resolveSession(infra.db, sessionToken);
    if (!row) return null;
    return {
      userId: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      isOperator: row.user.isOperator,
      source: "WEB",
      scopes: null,
      tokenWorkspaceId: null,
      tokenProjectId: null,
      tokenId: null,
      tokenMachineId: null,
    };
  }
  return null;
}

export function authPlugin(infra: Infra) {
  return new Elysia({ name: "auth" }).derive({ as: "global" }, async (ctx) => {
    const traceId = ctx.request.headers.get("x-trace-id") ?? newTraceId();
    const principal = await resolvePrincipal(infra, ctx);
    return {
      traceId,
      principal,
      logger: infra.logger.child({ traceId, userId: principal?.userId, source: principal?.source }),
      infra,
    };
  });
}

export function errorPlugin(infra: Infra) {
  return new Elysia({ name: "errors" })
    .onError({ as: "global" }, async (ctx) => {
      const { code, error, set, request } = ctx;
      // Derived trace id (authPlugin) when present; otherwise the client
      // header; a server-generated id keeps every envelope traceable.
      const derivedTrace = "traceId" in ctx && typeof ctx.traceId === "string" ? ctx.traceId : undefined;
      const id = derivedTrace ?? request.headers.get("x-trace-id") ?? crypto.randomUUID();
      if (error instanceof DomainError) {
        set.status = error.status;
        return { error: { code: error.code, message: error.message, details: error.details ?? null, trace_id: id } };
      }
      // Zod parse failures raised inside handlers (e.g. parsing a stored or
      // user-supplied structured artifact) are CLIENT errors, not crashes.
      // Without this, a malformed payload surfaces as an opaque 500 INTERNAL.
      if (error instanceof ZodError) {
        set.status = 422;
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: {
              issues: error.issues.slice(0, 10).map((i) => ({
                path: i.path.join("."),
                message: i.message,
              })),
            },
            trace_id: id,
          },
        };
      }
      // Elysia validation errors
      if (code === "VALIDATION") {
        set.status = 422;
        const err = error as { type?: string; all?: Array<{ path?: string; message?: string }> };
        return {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request validation failed",
            details: {
              issues: (err.all ?? []).slice(0, 10).map((i) => ({ path: i.path, message: i.message })),
            },
            trace_id: id,
          },
        };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: { code: "ROUTE_NOT_FOUND", message: "No such route", details: null, trace_id: id } };
      }
      // A malformed body (bad JSON, wrong content type) is the client's error,
      // not a 500 logged as a server crash.
      if (code === "PARSE") {
        set.status = 400;
        return { error: { code: "INVALID_BODY", message: "The request body could not be parsed", details: null, trace_id: id } };
      }
      if (code === "INVALID_COOKIE_SIGNATURE" || code === "INVALID_FILE_TYPE") {
        set.status = 400;
        return { error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Bad request", details: null, trace_id: id } };
      }
      // `status(n, …)` responses carry their own HTTP status.
      if (typeof code === "number") {
        set.status = code;
        const response = (error as { response?: unknown }).response;
        const message = typeof response === "string" ? response : `HTTP ${code}`;
        return { error: { code: code >= 500 ? "INTERNAL" : "HTTP_ERROR", message, details: null, trace_id: id } };
      }
      const message = error instanceof Error ? error.message : "Internal error";
      infra.logger.error("unhandled request error", { message, stack: error instanceof Error ? error.stack : undefined });
      set.status = 500;
      return { error: { code: "INTERNAL", message: "Internal error", details: null, trace_id: id } };
    });
}

export function ensurePrincipal(ctx: { principal: Principal | null }): Principal {
  if (!ctx.principal) throw errors.unauthorized();
  return ctx.principal;
}

/* ── Rate limiting (T199): fixed-window buckets in PostgreSQL. ──
 *
 * The window state must be shared across replicas. An in-process Map only
 * throttles the instance that served the request, so behind a load balancer the
 * effective budget for `login:email:*` is multiplied by the replica count —
 * which is exactly the brute-force protection this control exists to provide.
 * A single conditional upsert keeps the increment atomic under concurrency. */

export async function rateLimit(
  infra: Infra,
  scope: "AUTH" | "AI" | "MCP",
  key: string,
): Promise<void> {
  const max =
    scope === "AUTH"
      ? infra.config.RATE_LIMIT_AUTH_MAX
      : scope === "AI"
        ? infra.config.RATE_LIMIT_AI_MAX
        : infra.config.RATE_LIMIT_MCP_MAX;
  const windowMs = infra.config.RATE_LIMIT_WINDOW_MS;
  const id = `${scope}:${key}`;
  const resetAt = new Date(Date.now() + windowMs);

  const rows = await infra.db.execute(sql`
    INSERT INTO rate_limit_buckets ("key", "count", "reset_at", "updated_at")
    VALUES (${id}, 1, ${resetAt}, now())
    ON CONFLICT ("key") DO UPDATE SET
      -- A bucket past its reset starts a fresh window; otherwise increment.
      "count" = CASE
        WHEN rate_limit_buckets."reset_at" <= now() THEN 1
        ELSE rate_limit_buckets."count" + 1
      END,
      "reset_at" = CASE
        WHEN rate_limit_buckets."reset_at" <= now() THEN ${resetAt}
        ELSE rate_limit_buckets."reset_at"
      END,
      "updated_at" = now()
    RETURNING "count" AS count
  `);

  const count = Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 1);
  if (count > max) {
    infra.logger.warn("rate limit exceeded", { scope, key });
    throw errors.rateLimited(scope);
  }
}

/** Drop expired buckets so the table cannot grow without bound. */
export async function sweepRateLimitBuckets(infra: Infra): Promise<number> {
  const rows = await infra.db.execute(sql`
    DELETE FROM rate_limit_buckets WHERE "reset_at" <= now() RETURNING "key"
  `);
  return (rows as unknown as Array<unknown>).length ?? 0;
}

// Re-export for handler use
export { t };
export function requireScopeOrThrow(principal: Principal, scope: TokenScope): void {
  if (!principalCan(principal, scope)) throw errors.forbidden(`Missing required scope: ${scope}`);
}
