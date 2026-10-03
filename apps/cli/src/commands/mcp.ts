import { findRepoRoot, readConfig, readRepoLink } from "../lib/config.js";
import { CliError, fail } from "../lib/api.js";
import type { Command } from "commander";
import { createInterface } from "node:readline";

/** sddctl mcp: a local stdio MCP bridge to the control-plane MCP server with the saved identity. */

/* ── mcp ── Local MCP bridge (business-workflow audit §Local MCP bridge) ── */

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Run a local stdio MCP bridge that proxies the control-plane MCP server with your saved identity")
    .action(async () => {
      const config = readConfig();
      if (!config.token) {
        fail(new CliError("NO_AUTH", "No saved credentials — run `sddctl login` first"));
        return;
      }
      const url = `${config.server_url.replace(/\/+$/, "")}/mcp`;
      const repoRoot = findRepoRoot();
      const link = repoRoot ? readRepoLink(repoRoot) : null;

      console.error(`[sddctl mcp] bridging stdio → ${url}${link ? ` (project ${link.project_key})` : ""}`);

      let sessionId: string | null = null;

      const forward = async (line: string): Promise<void> => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }

        // Auto-inject the project binding from .sdd/local.json so local agents
        // never need to know project ids, tokens, or server URLs (audit §bridge).
        if (
          message.method === "tools/call" &&
          link?.project_id &&
          (message.params as { arguments?: Record<string, unknown>; name?: string } | undefined)?.arguments &&
          !((message.params as { arguments: Record<string, unknown> }).arguments.project_id)
        ) {
          (message.params as { arguments: Record<string, unknown> }).arguments.project_id = link.project_id;
        }

        const headers: Record<string, string> = {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${config.token}`,
        };
        if (sessionId) headers["mcp-session-id"] = sessionId;

        try {
          const res = await fetch(url, { method: "POST", headers, body: line });
          const sid = res.headers.get("mcp-session-id");
          if (sid) sessionId = sid;
          if (res.status === 202) return;
          const text = await res.text();
          if (!text.trim()) return;
          if (res.headers.get("content-type")?.includes("text/event-stream")) {
            for (const chunk of text.split("\n")) {
              const l = chunk.trim();
              if (l.startsWith("data:")) process.stdout.write(l.slice(5).trim() + "\n");
            }
          } else {
            process.stdout.write(text.trim() + "\n");
          }
        } catch {
          const id = (message as { id?: unknown }).id ?? null;
          process.stdout.write(
            JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: "Bridge transport error" } }) + "\n",
          );
        }
      };

      const readline = createInterface({
        input: process.stdin,
        terminal: false,
      });
      for await (const line of readline) {
        const l = line.trim();
        if (l) await forward(l);
      }
    });
}
