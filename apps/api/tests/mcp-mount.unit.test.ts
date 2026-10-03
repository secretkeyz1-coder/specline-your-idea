import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { mcpRoutes } from "../src/modules/mcp/mount.js";
import type { Infra } from "../src/infra.js";

// Fake only persistence; exercise the real Elysia mount, auth resolver and MCP SDK.
function fixture() {
  const row = {
    user: { id: "smoke-user", email: "smoke@example.com", displayName: "Smoke", status: "ACTIVE" },
    token: { id: "smoke-token", scopes: ["project:read"], workspaceId: null, projectId: null, revokedAt: null, expiresAt: null },
  };
  const selection = { from: () => selection, innerJoin: () => selection, where: () => selection, limit: async () => [row] };
  const update = { set: () => update, where: async () => [] };
  return {
    db: { execute: async () => [{ count: 1 }], select: () => selection, update: () => update },
    config: { RATE_LIMIT_MCP_MAX: 100, RATE_LIMIT_WINDOW_MS: 60_000, SDD_TRUST_PROXY: false },
    logger: { warn: () => {} },
  } as unknown as Infra;
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "regression", version: "1" } } };

describe("MCP HTTP mount preserves the request body", () => {
  test("authenticated initialize reaches the SDK with valid JSON", async () => {
    const app = new Elysia().use(mcpRoutes(fixture()));
    const response = await app.handle(new Request("http://localhost/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer fixture" }, body: JSON.stringify(initialize),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).result.protocolVersion).toBe("2025-03-26");
  });

  test("anonymous initialize remains unauthorized", async () => {
    const app = new Elysia().use(mcpRoutes(fixture()));
    const response = await app.handle(new Request("http://localhost/mcp", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(initialize),
    }));
    expect(response.status).toBe(401);
  });
});
