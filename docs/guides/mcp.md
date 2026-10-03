# MCP

[Back to README](../../README.md) · [CLI and agents](cli-and-agents.md)

MCP exposes control-plane project/task/execution services to compatible clients. It is not a separate coding agent and does not grant review approval authority.

## Remote transport

Use your API origin with path `/mcp` (for local development, `http://localhost:4000/mcp`). The adapter implements authenticated **POST-based Streamable HTTP**. GET server-initiated SSE is not enabled and returns 405; clients must support the implemented POST transport. Do not assume every MCP client or transport mode works.

Configure a revocable bearer token using your client's secure credential configuration, never a committed JSON file. Use the narrowest project/workspace binding and scopes required. Read-only tools need `project:read`/`task:read`; execution and evidence operations use `task:execute`, `run:write`, `run:submit`, and bug reports use `bug:write`. Server authorization still checks access to the target project/task.

Initialize the client, inspect `tools/list`, then test a read operation before mutation. Available tools include `project_get_context`, `task_list_ready`, `task_next`, `task_get`, `task_claim`, `task_start`, `task_heartbeat`, `task_report_progress`, `task_report_test`, `task_block`, `task_request_review`, and `bug_report`. Use the runtime tool schema as the contract; supplying evidence is not the same as proving it truthful.

## Local stdio bridge

After `sddctl login`, a client that launches stdio MCP servers can run:

```bash
sddctl mcp
```

For example, clients using this common configuration shape can adapt:

```json
{
  "mcpServers": {
    "specline": {
      "command": "sddctl",
      "args": ["mcp"]
    }
  }
}
```

This is an example, not a universal client format. Ensure the client process can find `sddctl` on PATH (use its absolute path otherwise) and can read the intended `SDDCTL_CONFIG`. It proxies newline-delimited JSON-RPC to the configured server using the saved identity. Do not put the saved token into client config or stdout logs.

Pass required project/task identifiers explicitly. Do not rely on implicit repository-context injection; verify the outgoing arguments and tool responses. A bridge process started by a GUI may have a different working directory or environment from your terminal.

## Debug safely

401: check login or token expiry/server origin. 403: inspect scope and project access rather than escalating to an all-powerful token. 405 on GET: choose POST Streamable HTTP or use the stdio bridge. Unknown tools or schema mismatches: inspect the live server's tool list and align client/server versions. Never attach bearer headers to a public issue.

See [protocol specification](../10_MCP_CLI_PROTOCOL.md) and [security policy](../../SECURITY.md). Specifications can include historical intent; current server behavior and schemas are the operational source of truth.
