import type { z } from "zod";
import type { AIRole, ProviderType } from "@sdd/contracts";
import type { ProviderCapabilities } from "@sdd/db";

/** docs/06_SYSTEM_DESIGN.md §6 — provider-neutral planning model interface.
 * Domain code never imports a vendor SDK; adapters implement this contract. */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export interface GenerationUsage {
  inputUnits: number | null;
  outputUnits: number | null;
}

export interface TextRequest {
  system: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * The caller wants one JSON object back (structured generation). Adapters
   * with a native JSON mode may switch it on; the answer is validated against
   * the application schema either way.
   */
  jsonMode?: boolean;
  /**
   * The answer so far, called as it streams in (for a live preview). Only
   * adapters that stream call it; the others return the whole answer once.
   * It must not throw: a preview is never worth failing the call.
   */
  onDelta?: (textSoFar: string) => void;
}

export interface TextResponse {
  text: string;
  usage: GenerationUsage;
  raw?: Record<string, unknown>;
}

export interface StructuredRequest<T> extends TextRequest {
  /** zod schema the output must satisfy — invalid model output is rejected (T038). */
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface StructuredResponse<T> {
  data: T;
  usage: GenerationUsage;
  raw?: Record<string, unknown>;
}

/** One CLI run handed to a connected machine's sdd-agent. */
export interface CliMachineJob {
  tool: import("@sdd/agent-cli").CliToolId;
  system: string;
  prompt: string;
  model: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

/** Where LOCAL_CLI connections may run on this deployment. */
export interface CliPolicy {
  /** The operator allows running CLIs on the API host (SDD_ENABLE_LOCAL_CLI). */
  serverEnabled: boolean;
  /** Runs a job on a connected machine and waits for its answer. */
  runOnMachine?: (machineId: string, job: CliMachineJob) => Promise<import("@sdd/agent-cli").CliRunResult>;
}

export const CLI_DISABLED: CliPolicy = { serverEnabled: false };

/** Resolved, credential-decrypted connection snapshot handed to an adapter. */
export interface ResolvedConnection {
  id: string;
  providerType: ProviderType;
  baseUrl: string | null;
  /** Decrypted bearer/header values — never logged, never persisted. */
  headers: Record<string, string>;
  timeoutMs: number;
  capabilities: ProviderCapabilities;
  customHttpMapping: import("@sdd/db").CustomHttpMapping | null;
  /** Egress policy guard callback (self-host opt-in allows LAN). */
  allowPrivateEgress: boolean;
  maxResponseBytes: number;
  /** LOCAL_CLI only: where CLIs may run. */
  cli: CliPolicy;
}

export interface ResolvedProfile {
  profileId: string;
  profileName: string;
  modelId: string;
  parameters: Record<string, unknown>;
  connection: ResolvedConnection;
}

export interface ProviderAdapter {
  readonly providerTypes: ProviderType[];
  generateText(conn: ResolvedConnection, modelId: string, parameters: Record<string, unknown>, request: TextRequest): Promise<TextResponse>;
}

export type PlanningRole = AIRole;
