import { CliRunError, isServerCliTool, isValidCliModel, parseCliTarget, runCli } from "@sdd/agent-cli";
import { DomainError } from "@sdd/shared";
import type { ChatMessage, ProviderAdapter, TextResponse } from "../types.js";

/**
 * LOCAL_CLI: a coding-agent CLI (Claude Code, Codex) used as the model.
 * The connection's base URL says where it runs (see @sdd/agent-cli):
 * on the API server itself — only when the operator enabled it — or on a
 * connected machine through its sdd-agent daemon. The CLI signs in with its
 * own login there; the control plane holds no credential for it.
 */

const ERROR_STATUS: Record<string, number> = { TIMEOUT: 504, NOT_INSTALLED: 400, NOT_SIGNED_IN: 400, INVALID_MODEL: 400, UNSUPPORTED_VERSION: 400 };

/** The conversation as one prompt: CLIs take a single message. */
function toPrompt(messages: ChatMessage[]): string {
  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length === 1 && turns[0]!.role === "user") return turns[0]!.content;
  return turns.map((m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}:\n${m.content}`).join("\n\n");
}

export const cliAdapter: ProviderAdapter = {
  providerTypes: ["LOCAL_CLI"],
  async generateText(conn, modelId, _parameters, request): Promise<TextResponse> {
    if (request.messages.some(m => m.images?.length)) throw new DomainError("VISION_UNSUPPORTED", "This text-only CLI reviewer cannot inspect screenshots. Use a vision-capable REVIEW profile or a human reviewer.", 409);
    const target = parseCliTarget(conn.baseUrl);
    if (!target) throw new DomainError("PROVIDER_MISCONFIGURED", "This local CLI connection has no valid target", 400);
    const model = modelId && modelId !== "default" ? modelId : "";
    // Checked here too (not only when the profile is saved): older rows and
    // the machine path never reach runCli's own check on this side.
    if (model && !isValidCliModel(model)) {
      throw new DomainError("CLI_INVALID_MODEL", "The profile's model name may only use letters, digits and . _ : / - (up to 100 characters)", 400);
    }
    const system = [request.system, ...request.messages.filter((m) => m.role === "system").map((m) => m.content)].join("\n\n");
    const job = {
      tool: target.tool,
      system,
      prompt: toPrompt(request.messages),
      // "default" (or empty) leaves the choice to the CLI's own configuration.
      model,
      timeoutMs: conn.timeoutMs,
      maxOutputBytes: conn.maxResponseBytes,
    };

    const result = await (async () => {
      if (target.where === "server") {
        if (!conn.cli.serverEnabled) {
          throw new DomainError(
            "LOCAL_CLI_DISABLED",
            "Running CLIs on the server is turned off. Set SDD_ENABLE_LOCAL_CLI=true on the API, or run the CLI on your machine with sdd-agent.",
            400,
          );
        }
        if (!isServerCliTool(target.tool)) {
          // Rows saved before the rule: see SERVER_CLI_TOOLS in @sdd/agent-cli.
          throw new DomainError("LOCAL_CLI_NOT_ALLOWED", "Only Claude Code may run on the server. Run Codex on your own machine with sdd-agent.", 400);
        }
        try {
          return await runCli(job.tool, job);
        } catch (error) {
          if (error instanceof CliRunError) throw new DomainError(`CLI_${error.code}`, error.message, ERROR_STATUS[error.code] ?? 502);
          throw error;
        }
      }
      if (!conn.cli.runOnMachine) throw new DomainError("LOCAL_CLI_UNAVAILABLE", "Machine-run CLIs are not available on this server", 400);
      return conn.cli.runOnMachine(target.machineId, job);
    })();

    return {
      text: result.text,
      usage: { inputUnits: result.inputTokens, outputUnits: result.outputTokens },
      raw: { cli: target.tool, where: target.where, duration_ms: result.durationMs, cost_usd: result.costUsd },
    };
  },
};
