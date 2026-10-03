import { Elysia, t } from "elysia";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@sdd/db";
import { authorizeWorkspaceAccess, requireScope } from "../../context.js";
import { authPlugin, ensurePrincipal, rateLimit } from "../../plugins.js";
import type { Infra } from "../../infra.js";
import {
  connectionUsages,
  createProviderConnection,
  deleteProviderConnection,
  updateProviderConnection,
  listConnections,
  listProviderModels,
  listSystemConnections,
  MAX_PROVIDER_TIMEOUT_MS,
  previewProviderModels,
  testProviderConnection,
  toPublicConnection,
} from "@sdd/ai";
import { detectAllClis, isServerCliTool, parseCliTarget, type CliDetection } from "@sdd/agent-cli";
import { machineCliCapabilities } from "../agent/gateway.js";
import { errors } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";
import { authorizeConnection, type Principal } from "./access.js";

/** Provider connections: create, list, edit, delete, test, model lists, and the CLIs this server and the caller's machines can run. */

/** Kept under the ~300s header timeout of the web server's outbound fetch. */
const DEFAULT_PROVIDER_TIMEOUT_MS = 240_000;
/** A CLI answers only when done (no stream to watch), so its limit is the whole run. */
const DEFAULT_CLI_TIMEOUT_MS = 900_000;

/** Server-side CLI detection spawns processes: remember it for a minute. */
let serverCliCache: { at: number; clis: CliDetection[] } | null = null;
async function serverClis(): Promise<CliDetection[]> {
  if (serverCliCache && Date.now() - serverCliCache.at < 60_000) return serverCliCache.clis;
  const clis = await detectAllClis();
  serverCliCache = { at: Date.now(), clis };
  return clis;
}


/**
 * Who may point a LOCAL_CLI connection where — on create and on every later
 * change of the target:
 * - `cli://server/*` runs on the API host as the server: operators only, and
 *   only on a SYSTEM connection (the service refuses other scopes too);
 * - `cli://machine/<id>/*` runs with the machine owner's login: that owner only.
 */
async function assertCliTargetFor(infra: Infra, principal: Principal, baseUrl: string | null | undefined, scope: "SYSTEM" | "WORKSPACE") {
  const target = parseCliTarget(baseUrl);
  if (target?.where === "server") {
    if (!principal.isOperator) throw errors.forbidden("Only an operator can run a CLI on the server; connect your own machine with sdd-agent instead");
    if (scope !== "SYSTEM") throw errors.forbidden("A CLI on the server must be a SYSTEM connection");
    return;
  }
  await assertOwnMachineTarget(infra, principal.userId, baseUrl ?? undefined);
}

/**
 * A machine runs the CLI with its owner's login: only the owner may point a
 * connection at it — on create and on every later change of the target.
 */
async function assertOwnMachineTarget(infra: Infra, userId: string, baseUrl: string | undefined) {
  const target = parseCliTarget(baseUrl);
  if (target?.where !== "machine") return;
  const [machine] = await infra.db
    .select()
    .from(schema.localMachines)
    .where(and(eq(schema.localMachines.id, target.machineId), eq(schema.localMachines.userId, userId)))
    .limit(1);
  if (!machine || machine.status === "REVOKED") throw errors.forbidden("You can only use your own connected machines for a local CLI");
}


export function aiProviderRoutes(infra: Infra) {
  return new Elysia({ prefix: "/api/v1", tags: ["ai"] }).use(authPlugin(infra))

    .post(
      "/workspaces/:workspaceId/ai/providers",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId, { admin: true, scope: "ai:manage" });
        await rateLimit(ctx.infra, "AI", `provider-create:${principal.userId}`);
        // A server-run CLI is created from this form by an operator, but as an
        // operator-managed SYSTEM connection: it runs as the API server, so no
        // workspace may own (or later re-point) it.
        const serverCli = ctx.body.provider_type === "LOCAL_CLI" && parseCliTarget(ctx.body.base_url)?.where === "server";
        if (ctx.body.provider_type === "LOCAL_CLI") await assertCliTargetFor(ctx.infra, principal, ctx.body.base_url, serverCli ? "SYSTEM" : "WORKSPACE");
        const connection = await createProviderConnection(
          ctx.infra.db,
          ctx.infra.secretBox,
          { allowPrivateEgress: ctx.infra.config.ALLOW_PRIVATE_AI_EGRESS, maxResponseBytes: ctx.infra.config.AI_MAX_RESPONSE_BYTES },
          {
            name: ctx.body.name,
            provider_type: ctx.body.provider_type,
            base_url: ctx.body.base_url,
            credential: ctx.body.credential
              ? { type: ctx.body.credential.type, header_name: ctx.body.credential.header_name, value: ctx.body.credential.value }
              : undefined,
            public_headers: ctx.body.public_headers ?? {},
            secret_headers: ctx.body.secret_headers ?? {},
            // Whole documents (design, task plans) take minutes on slower models.
            timeout_ms: ctx.body.timeout_ms ?? (ctx.body.provider_type === "LOCAL_CLI" ? DEFAULT_CLI_TIMEOUT_MS : DEFAULT_PROVIDER_TIMEOUT_MS),
            capabilities: ctx.body.capabilities ?? { structured_output: true, tool_calling: false, vision: false, streaming: false },
            custom_http_mapping: ctx.body.custom_http_mapping as never,
            scopeType: serverCli ? "SYSTEM" : "WORKSPACE",
            workspaceId: serverCli ? null : ctx.params.workspaceId,
          },
        );
        return { connection: toPublicConnection(connection) };
      },
      {
        params: t.Object({ workspaceId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 120 }),
          provider_type: t.Union([
            t.Literal("OPENAI"),
            t.Literal("ANTHROPIC"),
            t.Literal("GEMINI"),
            t.Literal("OPENAI_COMPATIBLE"),
            t.Literal("CUSTOM_HTTP"),
            t.Literal("LOCAL_CLI"),
          ]),
          base_url: t.Optional(t.String()),
          credential: t.Optional(t.Object({ type: t.Union([t.Literal("BEARER"), t.Literal("HEADER")]), header_name: t.Optional(t.String()), value: t.String({ maxLength: 8000 }) })),
          public_headers: t.Optional(t.Record(t.String(), t.String())),
          secret_headers: t.Optional(t.Record(t.String(), t.String())),
          timeout_ms: t.Optional(t.Number({ minimum: 1000, maximum: MAX_PROVIDER_TIMEOUT_MS })),
          capabilities: t.Optional(
            t.Object({
              structured_output: t.Boolean(),
              tool_calling: t.Boolean(),
              vision: t.Boolean(),
              streaming: t.Boolean(),
            }),
          ),
          custom_http_mapping: t.Optional(
            t.Object({
              method: t.Union([t.Literal("POST"), t.Literal("GET")]),
              path: t.String(),
              request_json_template: t.Record(t.String(), t.String()),
              headers: t.Record(t.String(), t.String()),
              text_response_pointer: t.String(),
              structured_response_pointer: t.Optional(t.String()),
            }),
          ),
        }),
      },
    )

    /* Where a local CLI can run for this user: the server (if enabled, operators only) and their machines. */
    .get("/ai/cli", async (ctx) => {
      const principal = ensurePrincipal(ctx);
      const enabled = ctx.infra.config.SDD_ENABLE_LOCAL_CLI;
      // Only an operator may create a server-run CLI, and only for the tools
      // that can be locked out of the host (Claude Code — not Codex).
      const canUseServer = enabled && principal.isOperator;
      const machines = await ctx.infra.db
        .select()
        .from(schema.localMachines)
        .where(eq(schema.localMachines.userId, principal.userId))
        .orderBy(desc(schema.localMachines.lastSeenAt));
      return {
        server: {
          enabled,
          operator_only: true,
          can_create: canUseServer,
          clis: canUseServer ? (await serverClis()).filter((c) => isServerCliTool(c.id)) : [],
        },
        machines: machines
          .filter((m) => m.status !== "REVOKED")
          .map((m) => {
            const live = machineCliCapabilities(m.id);
            return { id: m.id, name: m.name, platform: m.platform, online: live !== null, clis: (live ?? []) as CliDetection[] };
          }),
      };
    })

    .get(
      "/workspaces/:workspaceId/ai/providers",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const access = await authorizeWorkspaceAccess(ctx.infra.db, principal, ctx.params.workspaceId);
        const own = await listConnections(ctx.infra.db, ctx.params.workspaceId);
        // SYSTEM connections expose operator base URLs/public headers: admins need
        // them to bind profiles, ordinary members do not.
        const system = principal.isOperator || access.canAdmin ? await listSystemConnections(ctx.infra.db) : [];
        const all = [...system, ...own];
        // What each connection carries, so the page can say what a delete would
        // touch before it is attempted. Bindings of other workspaces (on a
        // SYSTEM connection) are counted but not described.
        const usage = await connectionUsages(ctx.infra.db, all.map((c) => c.id));
        return {
          connections: all.map((c) => {
            const u = usage.get(c.id)!;
            return {
              ...toPublicConnection(c),
              usage: {
                profiles: u.profiles,
                bindings: u.bindings.length,
                roles: u.bindings.filter((b) => b.workspace_id === ctx.params.workspaceId).map((b) => ({ role: b.role, scope: b.scope, project_id: b.project_id })),
              },
            };
          }),
        };
      },
      { params: t.Object({ workspaceId: t.String({ format: "uuid" }) }) },
    )

    .patch(
      "/ai/providers/:providerId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const connection = await authorizeConnection(ctx.infra, principal, ctx.params.providerId);
        const body = ctx.body;
        if (connection.providerType === "LOCAL_CLI" && body.base_url !== undefined) {
          await assertCliTargetFor(ctx.infra, principal, body.base_url, connection.scopeType === "SYSTEM" ? "SYSTEM" : "WORKSPACE");
        }
        const { connection: updated, clearedSecrets } = await updateProviderConnection(
          ctx.infra.db,
          ctx.infra.secretBox,
          { allowPrivateEgress: ctx.infra.config.ALLOW_PRIVATE_AI_EGRESS, maxResponseBytes: ctx.infra.config.AI_MAX_RESPONSE_BYTES },
          connection.id,
          {
            name: body.name,
            base_url: body.base_url,
            credential: body.credential === undefined ? undefined : body.credential,
            public_headers: body.public_headers,
            secret_headers: body.secret_headers,
            timeout_ms: body.timeout_ms,
            capabilities: body.capabilities,
            custom_http_mapping: body.custom_http_mapping as never,
            status: body.status,
          },
        );
        if (connection.workspaceId) {
          await audit(ctx.infra.db, {
            workspaceId: connection.workspaceId,
            actorType: "USER",
            actorId: principal.userId,
            source: principal.source as AuditSource,
            action: body.status && Object.keys(body).length === 1 ? `ai.provider.${body.status === "DISABLED" ? "disabled" : "enabled"}` : "ai.provider.updated",
            entityType: "AI_PROVIDER_CONNECTION",
            entityId: connection.id,
            // Field names only: never a key, header value or URL secret.
            metadata: {
              name: updated.name,
              fields: Object.keys(body),
              credential: body.credential === undefined ? (clearedSecrets.includes("credential") ? "cleared_origin_changed" : "kept") : body.credential ? "replaced" : "removed",
              cleared_secrets: clearedSecrets,
            },
          });
        }
        // A new origin drops the stored key and secret headers unless this
        // request re-entered them: say so, so the form can ask for them again.
        return { connection: toPublicConnection(updated), cleared_secrets: clearedSecrets };
      },
      {
        params: t.Object({ providerId: t.String({ format: "uuid" }) }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
          base_url: t.Optional(t.Union([t.Null(), t.String({ maxLength: 500 })])),
          credential: t.Optional(
            t.Union([t.Null(), t.Object({ type: t.Union([t.Literal("BEARER"), t.Literal("HEADER")]), header_name: t.Optional(t.String()), value: t.String({ minLength: 1, maxLength: 8000 }) })]),
          ),
          public_headers: t.Optional(t.Record(t.String(), t.String())),
          secret_headers: t.Optional(t.Record(t.String(), t.String())),
          timeout_ms: t.Optional(t.Number({ minimum: 1000, maximum: MAX_PROVIDER_TIMEOUT_MS })),
          capabilities: t.Optional(t.Object({ structured_output: t.Boolean(), tool_calling: t.Boolean(), vision: t.Boolean(), streaming: t.Boolean() })),
          custom_http_mapping: t.Optional(
            t.Object({
              method: t.Union([t.Literal("POST"), t.Literal("GET")]),
              path: t.String(),
              request_json_template: t.Record(t.String(), t.String()),
              headers: t.Record(t.String(), t.String()),
              text_response_pointer: t.String(),
              structured_response_pointer: t.Optional(t.String()),
            }),
          ),
          status: t.Optional(t.Union([t.Literal("ACTIVE"), t.Literal("DISABLED")])),
        }),
      },
    )

    .delete(
      "/ai/providers/:providerId",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        const connection = await authorizeConnection(ctx.infra, principal, ctx.params.providerId);
        const result = await deleteProviderConnection(ctx.infra.db, connection.id);
        if (connection.workspaceId) {
          await audit(ctx.infra.db, {
            workspaceId: connection.workspaceId,
            actorType: "USER",
            actorId: principal.userId,
            source: principal.source as AuditSource,
            action: "ai.provider.deleted",
            entityType: "AI_PROVIDER_CONNECTION",
            entityId: connection.id,
            metadata: { name: connection.name, provider_type: connection.providerType, profiles_removed: result.profiles_removed },
          });
        }
        return { deleted: true, ...result };
      },
      { params: t.Object({ providerId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/ai/providers/:providerId/test",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await rateLimit(ctx.infra, "AI", `provider-test:${principal.userId}`);
        const [connection] = await ctx.infra.db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, ctx.params.providerId)).limit(1);
        if (!connection) throw errors.notFound("Provider connection");
        if (connection.workspaceId) await authorizeWorkspaceAccess(ctx.infra.db, principal, connection.workspaceId, { admin: true, scope: "ai:manage" });
        else if (!principal.isOperator) throw errors.forbidden("Operator access required for SYSTEM connections");
        return testProviderConnection(
          ctx.infra.db,
          ctx.infra.secretBox,
          { allowPrivateEgress: ctx.infra.config.ALLOW_PRIVATE_AI_EGRESS, maxResponseBytes: ctx.infra.config.AI_MAX_RESPONSE_BYTES, cli: ctx.infra.gateway().cli },
          connection.id,
          { modelId: ctx.body.model_id },
        );
      },
      {
        params: t.Object({ providerId: t.String({ format: "uuid" }) }),
        body: t.Object({ model_id: t.Optional(t.String({ maxLength: 200 })) }),
      },
    )

    .get(
      "/ai/providers/:providerId/models",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        await rateLimit(ctx.infra, "AI", `provider-models:${principal.userId}`);
        const [connection] = await ctx.infra.db.select().from(schema.aiProviderConnections).where(eq(schema.aiProviderConnections.id, ctx.params.providerId)).limit(1);
        if (!connection) throw errors.notFound("Provider connection");
        if (connection.workspaceId) await authorizeWorkspaceAccess(ctx.infra.db, principal, connection.workspaceId, { admin: true, scope: "ai:manage" });
        else if (!principal.isOperator) throw errors.forbidden("Operator access required for SYSTEM connections");
        const result = await listProviderModels(
          ctx.infra.db,
          ctx.infra.secretBox,
          { allowPrivateEgress: ctx.infra.config.ALLOW_PRIVATE_AI_EGRESS, maxResponseBytes: ctx.infra.config.AI_MAX_RESPONSE_BYTES },
          connection.id,
        );
        return result;
      },
      { params: t.Object({ providerId: t.String({ format: "uuid" }) }) },
    )

    .post(
      "/ai/providers/models-preview",
      async (ctx) => {
        const principal = ensurePrincipal(ctx);
        requireScope(principal, "ai:manage");
        // Probing an arbitrary URL is an admin action: it is the first step of
        // binding a provider, which only workspace admins (or operators) may do.
        if (!principal.isOperator) {
          const [adminMembership] = await ctx.infra.db
            .select({ workspaceId: schema.workspaceMembers.workspaceId })
            .from(schema.workspaceMembers)
            .where(and(eq(schema.workspaceMembers.userId, principal.userId), inArray(schema.workspaceMembers.role, ["OWNER", "ADMIN"])))
            .limit(1);
          if (!adminMembership) throw errors.forbidden("Workspace admin access required");
        }
        await rateLimit(ctx.infra, "AI", `provider-models-preview:${principal.userId}`);
        const base = ctx.body.base_url.trim();
        if (!base) throw errors.validation("base_url is required to fetch models");
        const result = await previewProviderModels(ctx.infra.secretBox, { allowPrivateEgress: ctx.infra.config.ALLOW_PRIVATE_AI_EGRESS, maxResponseBytes: ctx.infra.config.AI_MAX_RESPONSE_BYTES }, {
          provider_type: ctx.body.provider_type,
          base_url: base,
          credential: ctx.body.credential?.trim() || undefined,
        });
        return result;
      },
      {
        body: t.Object({
          provider_type: t.String({ minLength: 1 }),
          base_url: t.String({ maxLength: 500 }),
          credential: t.Optional(t.String({ maxLength: 500 })),
        }),
      },
    );
}
