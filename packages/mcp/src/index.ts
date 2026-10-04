import { RunEvidenceSchema } from "@sdd/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { silentLogger, type Logger } from "@sdd/shared";

/**
 * Remote MCP adapter (Phase 12, T131–T140, docs/10 §7–10).
 *
 * MCP is an adapter over the SAME domain command/query services used by REST
 * and the CLI (FR-104) — no MCP-only business rules live here. The API process
 * injects authenticated service functions; this package only frames tools.
 *
 * Transport: Streamable HTTP, stateless per-request (sessionIdGenerator:
 * undefined) so the endpoint scales without session affinity. Authentication
 * is injected via `resolvePrincipal` — tokens never ride in prompts (FR-103).
 */

export interface McpPrincipal {
  userId: string;
  email: string;
  displayName: string;
  scopes: string[];
  tokenId: string | null;
  /** PAT narrowing — MCP calls must respect it (docs/13 §5–6, C12). */
  tokenWorkspaceId: string | null;
  tokenProjectId: string | null;
  tokenMachineId?: string | null;
}

export interface SddMcpServices {
  projectContext(principal: McpPrincipal, projectId: string): Promise<unknown>;
  listReadyTasks(principal: McpPrincipal, projectId: string, limit: number): Promise<unknown>;
  nextTask(principal: McpPrincipal, projectId: string, limit: number): Promise<unknown>;
  taskContext(principal: McpPrincipal, taskIdOrKey: string): Promise<unknown>;
  claimTask(principal: McpPrincipal, taskIdOrKey: string, executorId: string): Promise<unknown>;
  startTask(principal: McpPrincipal, taskIdOrKey: string): Promise<unknown>;
  heartbeat(principal: McpPrincipal, taskIdOrKey: string, leaseSeconds: number): Promise<unknown>;
  reportProgress(principal: McpPrincipal, taskIdOrKey: string, body: { message: string; progress?: { completed_steps: number; total_steps: number } }): Promise<unknown>;
  reportTest(principal: McpPrincipal, taskIdOrKey: string, body: { command: string; status: string; exit_code?: number | null; duration_ms?: number | null; summary?: string | null }): Promise<unknown>;
  blockTask(principal: McpPrincipal, taskIdOrKey: string, body: { reason_code: string; message: string }): Promise<unknown>;
  requestReview(principal: McpPrincipal, taskIdOrKey: string, body: { summary: string; commit_sha?: string | null; files_changed?: string[]; evidence?: import("@sdd/contracts").RunEvidence }): Promise<unknown>;
  reportBug(principal: McpPrincipal, projectId: string, body: { title: string; current_behavior: string; expected_behavior: string; unchanged_behavior?: string; reproduction: string; task_key?: string | null }): Promise<unknown>;
}

export interface SddMcpDeps {
  resolvePrincipal(bearer: string): Promise<McpPrincipal | null>;
  services: SddMcpServices;
  serverName?: string;
  serverVersion?: string;
  logger?: Logger;
}

/** A service's failed result. Tools return it (instead of throwing) so the
 * error envelope stays structured; the adapter marks it `isError: true`. */
export interface McpToolFailure {
  readonly __mcpToolFailure: true;
  error: { code: string; message: string; details?: unknown };
}

export function mcpFailure(error: { code: string; message: string; details?: unknown }): McpToolFailure {
  return { __mcpToolFailure: true, error };
}

function isToolFailure(data: unknown): data is McpToolFailure {
  return typeof data === "object" && data !== null && (data as { __mcpToolFailure?: unknown }).__mcpToolFailure === true;
}

export function textContent(data: unknown): { content: Array<{ type: "text"; text: string }>; isError?: true } {
  // MCP spec: a tool that fails reports isError, so the agent does not treat
  // "claim rejected" as a successful call.
  if (isToolFailure(data)) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ error: data.error }, null, 2) }], isError: true };
  }
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

export function createSddMcpHandler(deps: SddMcpDeps) {
  const logger = deps.logger ?? silentLogger;

  const buildServer = (principal: McpPrincipal): McpServer => {
    const server = new McpServer(
      { name: deps.serverName ?? "sdd-control-plane", version: deps.serverVersion ?? "0.1.0" },
      { instructions: "Vendor-neutral tools for the Agentic SDD Control Plane: fetch project/task context, claim and execute tasks, report evidence, submit for review, report bugs. The server validates every transition." },
    );

    server.registerTool(
      "project_get_context",
      {
        description: "Return minimal project context: identity, lifecycle, active planning revisions, ready-task count.",
        inputSchema: z.object({ project_id: z.string().min(1).describe("Project key (e.g. PRJ-1) or UUID") }),
      },
      async ({ project_id }) => textContent(await deps.services.projectContext(principal, project_id)),
    );

    server.registerTool(
      "task_list_ready",
      {
        description: "List tasks that are READY to claim in a project (only projects the caller is authorized for).",
        inputSchema: z.object({
          project_id: z.string().min(1),
          limit: z.number().int().min(1).max(50).default(10),
        }),
      },
      async ({ project_id, limit }) => textContent(await deps.services.listReadyTasks(principal, project_id, limit)),
    );

    server.registerTool(
      "task_next",
      {
        description: "Scheduler: return the next CLAIMABLE tasks in execution order — dependencies satisfied, no active lease, priority-ordered. Claim the first one, then call task_next again after finishing.",
        inputSchema: z.object({
          project_id: z.string().min(1),
          limit: z.number().int().min(1).max(20).default(5),
        }),
      },
      async ({ project_id, limit }) => textContent(await deps.services.nextTask(principal, project_id, limit)),
    );

    server.registerTool(
      "task_get",
      {
        description: "Return the full task contract and minimal context pack for one task (dependencies, requirements, design excerpts, the approved stack, design system and UI-reference screens, spec status notes, verification).",
        inputSchema: z.object({ task_id: z.string().min(1).describe("Task key (TASK-001) or UUID") }),
      },
      async ({ task_id }) => textContent(await deps.services.taskContext(principal, task_id)),
    );

    server.registerTool(
      "task_claim",
      {
        description: "Atomically claim a READY task. Exactly one active executor can hold a task; a second claim is rejected.",
        inputSchema: z.object({ task_id: z.string().min(1), executor_id: z.string().min(1).max(200) }),
      },
      async ({ task_id, executor_id }) => textContent(await deps.services.claimTask(principal, task_id, executor_id)),
    );

    server.registerTool(
      "task_start",
      {
        description: "Start the claimed run for a task (CLAIMED → IN_PROGRESS) after task_claim.",
        inputSchema: z.object({ task_id: z.string().min(1) }),
      },
      async ({ task_id }) => textContent(await deps.services.startTask(principal, task_id)),
    );

    server.registerTool(
      "task_heartbeat",
      {
        description:
          "Keep your claim alive during long work: renews the lease on your active run (default 900 s). Progress and test reports renew it too; call this when you go quiet for more than a few minutes.",
        inputSchema: z.object({
          task_id: z.string().min(1),
          lease_seconds: z.number().int().min(60).max(3600).default(900),
        }),
      },
      async ({ task_id, lease_seconds }) => textContent(await deps.services.heartbeat(principal, task_id, lease_seconds)),
    );

    server.registerTool(
      "task_report_progress",
      {
        description: "Report meaningful execution progress on the active run of a task.",
        inputSchema: z.object({
          task_id: z.string().min(1),
          message: z.string().min(1).max(2000),
          progress: z.object({ completed_steps: z.number().int().min(0), total_steps: z.number().int().min(0) }).optional(),
        }),
      },
      async ({ task_id, message, progress }) =>
        textContent(await deps.services.reportProgress(principal, task_id, { message, progress })),
    );

    server.registerTool(
      "task_report_test",
      {
        description: "Report a validation/test result as evidence for the active run. Required before review submission.",
        inputSchema: z.object({
          task_id: z.string().min(1),
          command: z.string().min(1).max(600),
          status: z.enum(["PASSED", "FAILED", "ERROR", "SKIPPED"]),
          exit_code: z.number().int().optional(),
          duration_ms: z.number().int().min(0).optional(),
          summary: z.string().max(4000).optional(),
        }),
      },
      async ({ task_id, command, status, exit_code, duration_ms, summary }) =>
        textContent(
          await deps.services.reportTest(principal, task_id, {
            command,
            status,
            exit_code: exit_code ?? null,
            duration_ms: duration_ms ?? null,
            summary: summary ?? null,
          }),
        ),
    );

    server.registerTool(
      "task_block",
      {
        description: "Block the task with a clear reason (ambiguous spec, missing dependency, out-of-scope request) and stop unsafe implementation.",
        inputSchema: z.object({
          task_id: z.string().min(1),
          reason_code: z.string().min(1).max(80),
          message: z.string().min(1).max(2000),
        }),
      },
      async ({ task_id, reason_code, message }) =>
        textContent(await deps.services.blockTask(principal, task_id, { reason_code, message })),
    );

    server.registerTool(
      "task_request_review",
      {
        description: "Submit the completed implementation for review. Requires reported test evidence; the implementer cannot self-approve.",
        inputSchema: z.object({
          task_id: z.string().min(1),
          summary: z.string().min(1).max(8000),
          commit_sha: z.string().max(80).optional(),
          files_changed: z.array(z.string().max(300)).max(200).optional(),
          evidence: RunEvidenceSchema.optional(),
        }),
      },
      async ({ task_id, summary, commit_sha, files_changed, evidence }) =>
        textContent(await deps.services.requestReview(principal, task_id, { summary, commit_sha: commit_sha ?? null, files_changed, evidence })),
    );

    server.registerTool(
      "bug_report",
      {
        description: "Report a scoped bug (behavior triplet + reproduction required). Bugs are entities, not task states.",
        inputSchema: z.object({
          project_id: z.string().min(1),
          title: z.string().min(1).max(200),
          current_behavior: z.string().min(1).max(4000),
          expected_behavior: z.string().min(1).max(4000),
          unchanged_behavior: z.string().max(4000).optional(),
          reproduction: z.string().min(1).max(4000),
          task_key: z.string().max(40).optional(),
        }),
      },
      async (args) =>
        textContent(
          await deps.services.reportBug(principal, args.project_id, {
            title: args.title,
            current_behavior: args.current_behavior,
            expected_behavior: args.expected_behavior,
            unchanged_behavior: args.unchanged_behavior,
            reproduction: args.reproduction,
            task_key: args.task_key ?? null,
          }),
        ),
    );

    return server;
  };

  /** Stateless streamable-HTTP handler: one server+transport per request. */
  return async function handleMcpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET") {
      return new Response("SSE server-initiated streams are not enabled on this stateless endpoint; use POST.", {
        status: 405,
        headers: { allow: "POST" },
      });
    }
    void url;
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!bearer) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Authentication required: pass a scoped bearer token" }, id: null },
        { status: 401 },
      );
    }
    let principal: McpPrincipal | null = null;
    try {
      principal = await deps.resolvePrincipal(bearer);
    } catch (error) {
      logger.warn("mcp auth resolution failed", { message: error instanceof Error ? error.message : "unknown" });
      principal = null;
    }
    if (!principal) {
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32001, message: "Invalid or expired token" }, id: null },
        { status: 401 },
      );
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    const server = buildServer(principal);
    try {
      await server.connect(transport);
      // JSON-response mode: the promise settles with the complete response, so
      // nothing is left streaming when the per-request pair is closed below.
      return await transport.handleRequest(request);
    } finally {
      // Stateless: one server+transport per request. Close both, or every
      // call leaks a connected server with its handlers.
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  };
}
