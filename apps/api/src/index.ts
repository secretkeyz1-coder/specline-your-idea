import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { initInfra } from "./infra.js";
import { authPlugin, corsOriginAllowed, errorPlugin, sweepRateLimitBuckets } from "./plugins.js";
import { authRoutes } from "./modules/auth/routes.js";
import { workspaceRoutes } from "./modules/workspace/routes.js";
import { projectRoutes } from "./modules/project/routes.js";
import { discoveryRoutes } from "./modules/discovery/routes.js";
import { planningRoutes } from "./modules/planning/routes.js";
import { uxRoutes } from "./modules/ux/routes.js";
import { designSystemRoutes } from "./modules/design-system/routes.js";
import { taskRoutes } from "./modules/task/routes.js";
import { executionRoutes, sseRoutes } from "./modules/execution/routes.js";
import { bugRoutes } from "./modules/bug/routes.js";
import { convergenceRoutes, featureRoutes } from "./modules/convergence/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { apiTokenRoutes, machineRoutes, repositoryLinkRoutes } from "./modules/agent/routes.js";
import { pairingRoutes } from "./modules/agent/pairing.js";
import { agentGateway } from "./modules/agent/gateway.js";
import { mcpRoutes } from "./modules/mcp/mount.js";
import { cliRoutes } from "./modules/cli/routes.js";
import { exportRoutes, activityRoutes } from "./modules/export/routes.js";
import { startLeaseSweeper } from "./modules/execution/service.js";
import { setEgressLogger, sweepInterruptedRuns } from "@sdd/ai";

/** Control Plane API — Bun + Elysia modular monolith (docs/06). */

const infra = initInfra();
// Refused AI egress is logged with the resolved address; clients only see the host.
setEgressLogger(infra.logger.child({ module: "egress" }));

const AI_GENERATION_PATH =
  /\/(discovery\/next|discovery-sessions|artifacts\/[a-z_]+\/(generate|refine)|design\/generate|design\/[^/]+\/refine|stack\/(recommend|validate)|tasks\/generate|convergence-runs|generate-fix-tasks|ux\/plan|design-system\/import|ux\/layout-reference\/analyse|ux\/screens\/[^/]+\/generate(?:-stream)?)$/;

const app = new Elysia({ name: "sdd-api" })
  .use(errorPlugin(infra))
  .use(authPlugin(infra))
  .use(openapi({ documentation: { info: { title: "Agentic SDD Control Plane API", version: "0.1.0", description: "Specification-to-execution control plane. Errors use {error:{code,message,details,trace_id}}." } }, path: "/openapi" }))

  // Security headers + CORS for the web app (production sits behind a reverse proxy).
  .onRequest(({ set, request, server }) => {
    // AI generation answers in one synchronous response that can take minutes
    // on slower models; the server-wide idle timeout (255s, Bun's maximum)
    // would cut the connection while the model is still writing. Only these
    // endpoints lift it — the provider's own idle and total limits still bound the call.
    if (request.method === "POST" && AI_GENERATION_PATH.test(new URL(request.url).pathname)) server?.timeout(request, 0);
    set.headers["x-content-type-options"] = "nosniff";
    set.headers["referrer-policy"] = "no-referrer";
    set.headers["x-frame-options"] = "DENY";
    const origin = request.headers.get("origin");
    if (origin && corsOriginAllowed(origin, infra.config)) {
      set.headers["access-control-allow-origin"] = origin;
      set.headers["access-control-allow-credentials"] = "true";
      set.headers["access-control-allow-headers"] = "content-type, authorization, idempotency-key, x-trace-id";
      set.headers["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
    }
  })

  // Liveness + readiness (T207): process liveness is distinct from DB readiness.
  .get("/healthz", () => ({ status: "ok" }))
  .get("/readyz", async () => {
    if (!(await infra.db.ping())) {
      infra.logger.error("readiness: database unreachable");
      throw new Error("database unreachable");
    }
    // Migrations applied? (a live connection alone is not "ready", T210)
    if (!(await infra.db.schemaReady())) {
      infra.logger.error("readiness: schema missing — run migrations");
      throw new Error("schema not migrated");
    }
    return { status: "ready", database: "ok", schema: "ok" };
  })

  .use(authRoutes(infra))
  .use(workspaceRoutes(infra))
  .use(projectRoutes(infra))
  .use(discoveryRoutes(infra))
  .use(planningRoutes(infra))
  .use(uxRoutes(infra))
  .use(designSystemRoutes(infra))
  .use(taskRoutes(infra))
  .use(executionRoutes(infra))
  .use(sseRoutes(infra))
  .use(bugRoutes(infra))
  .use(featureRoutes(infra))
  .use(convergenceRoutes(infra))
  .use(aiRoutes(infra))
  .use(machineRoutes(infra))
  .use(apiTokenRoutes(infra))
  .use(pairingRoutes(infra))
  .use(repositoryLinkRoutes(infra))
  .use(agentGateway(infra))
  .use(mcpRoutes(infra))
  .use(cliRoutes(infra))
  .use(exportRoutes(infra))
  .use(activityRoutes(infra))

  .onStop(() => {
    infra.logger.info("api shutting down");
  });

const server = app.listen({ hostname: infra.config.apiHost, port: infra.config.API_PORT, idleTimeout: 255 }, () => {
  infra.logger.info("control plane api listening", {
    host: infra.config.apiHost,
    port: infra.config.API_PORT,
    selfRegistration: infra.config.selfRegistration ? "open" : `closed (${infra.config.registrationAllowlist.length} allowlisted)`,
    mcp: "/mcp",
    openapi: "/openapi",
  });
});

// Background workers: lease expiry sweep (T112) — DB-backed, restart-safe.
const stopSweeper = startLeaseSweeper(infra.db, 30_000);

// Rate-limit buckets are persisted (T199); clear expired windows periodically
// so the table stays bounded. Safe to run on every replica — the DELETE is
// idempotent and conditional on expiry.
// AI generation runs orphaned by a restart would otherwise show as running forever.
const sweepAiRuns = () =>
  void sweepInterruptedRuns(infra.db)
    .then((n) => n && infra.logger.warn("marked interrupted AI generation runs as failed", { count: n }))
    .catch((error: unknown) => {
      infra.logger.warn("AI run sweep failed", { message: error instanceof Error ? error.message : String(error) });
    });
sweepAiRuns();
const rateLimitSweep = setInterval(() => {
  void sweepRateLimitBuckets(infra).catch((error: unknown) => {
    infra.logger.warn("rate-limit bucket sweep failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  sweepAiRuns();
}, 300_000);
rateLimitSweep.unref?.();

process.on("SIGINT", async () => {
  stopSweeper();
  clearInterval(rateLimitSweep);
  await infra.db.close().catch(() => undefined);
  process.exit(0);
});
process.on("SIGTERM", async () => {
  stopSweeper();
  clearInterval(rateLimitSweep);
  await infra.db.close().catch(() => undefined);
  process.exit(0);
});

export { server };
