import { and, eq, lt } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { z } from "zod";
import type { AIRole, ProviderType } from "@sdd/contracts";
import { DomainError, newTraceId, silentLogger, type Logger } from "@sdd/shared";
import type { SecretBox } from "@sdd/shared";
import type { ChatMessage, CliPolicy, GenerationUsage } from "./types.js";
import { adapterFor } from "./registry.js";
import { resolveEffectiveProfile } from "./roles.js";
import { toJsonSchema } from "@sdd/contracts";
import { parseJsonLoose, toNumber } from "./adapters/openai.js";
import { TOTAL_TIMEOUT_FACTOR } from "./ssrf.js";

/** The AI gateway: role resolution → generation-run attribution → adapter call
 * → deterministic validation (T034, FR-160, docs/06 §6). AI output is untrusted
 * input: every structured result is validated against the application schema. */

export interface GatewayDeps {
  db: DbExecutor;
  secretBox: SecretBox;
  allowPrivateEgress: boolean;
  maxResponseBytes: number;
  logger?: Logger;
  /** Where LOCAL_CLI connections may run; absent = nowhere. */
  cli?: CliPolicy;
}

export interface RunStructuredInput<T> {
  workspaceId: string;
  projectId?: string | null;
  artifactId?: string | null;
  role: AIRole;
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  traceId?: string;
}

export interface RunStructuredResult<T> {
  data: T;
  generationRunId: string;
  modelId: string;
  profileId: string;
  providerConnectionId: string;
  source: "PROJECT" | "WORKSPACE" | "SYSTEM";
}

/**
 * The output limit a call really ran with: the caller's, else the profile's
 * `max_tokens`, else the adapter's default (Anthropic and custom HTTP 4096,
 * Gemini 8192). Null where the provider decides (OpenAI-compatible without a
 * profile setting) or ignores it (local CLIs). Mirrors the adapters.
 */
export function effectiveMaxOutputTokens(providerType: ProviderType, parameters: Record<string, unknown>, requested?: number): number | null {
  if (providerType === "LOCAL_CLI") return null;
  const set = requested ?? toNumber(parameters["max_tokens"]);
  if (set !== null && set !== undefined) return set;
  if (providerType === "ANTHROPIC" || providerType === "CUSTOM_HTTP") return 4096;
  if (providerType === "GEMINI") return 8192;
  return null;
}

/** What a text call ran on and used, for callers that record it (aturan.md §5.7). */
export interface RunTextResult {
  text: string;
  generationRunId: string;
  modelId: string;
  profileName: string;
  providerType: ProviderType;
  /** The effective output limit (see effectiveMaxOutputTokens). */
  maxOutputTokens: number | null;
  usage: GenerationUsage;
  latencyMs: number;
}

export class NoProviderConfiguredError extends DomainError {
  constructor(role: AIRole) {
    super(
      "AI_PROVIDER_NOT_CONFIGURED",
      `No AI provider/profile is bound for role ${role}. Configure one in Settings → AI.`,
      409,
      { role },
    );
    this.name = "NoProviderConfiguredError";
  }
}

export async function runStructured<T>(
  deps: GatewayDeps,
  input: RunStructuredInput<T>,
): Promise<RunStructuredResult<T>> {
  const logger = deps.logger ?? silentLogger;
  const traceId = input.traceId ?? newTraceId();
  const found = await resolveEffectiveProfile(
    deps.db,
    deps.secretBox,
    { workspaceId: input.workspaceId, projectId: input.projectId, role: input.role },
    { allowPrivateEgress: deps.allowPrivateEgress, maxResponseBytes: deps.maxResponseBytes, cli: deps.cli },
  );
  if (!found) throw new NoProviderConfiguredError(input.role);
  const { resolved, source } = found;
  const adapter = adapterFor(resolved.connection.providerType);

  const [run] = await deps.db
    .insert(schema.aiGenerationRuns)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      artifactId: input.artifactId ?? null,
      role: input.role,
      aiProfileId: resolved.profileId,
      providerConnectionId: resolved.connection.id,
      modelId: resolved.modelId,
      status: "RUNNING",
      traceId,
      requestMetadata: { schemaName: input.schemaName, messages: input.messages.length },
    })
    .returning();
  const runId = run!.id;
  const startedAt = Date.now();

  const jsonSchema = toJsonSchema(input.schema);
  const system = `${input.system}

You MUST reply with a single JSON object (no prose, no code fences) that validates against this JSON Schema:
${JSON.stringify(jsonSchema)}`;

  // Usage is accumulated as calls complete, so a failed run still records the
  // tokens that were actually billed (first call and/or repair retry).
  const usage = { inputUnits: null as number | null, outputUnits: null as number | null };
  const addUsage = (u: { inputUnits: number | null; outputUnits: number | null }) => {
    if (u.inputUnits !== null) usage.inputUnits = (usage.inputUnits ?? 0) + u.inputUnits;
    if (u.outputUnits !== null) usage.outputUnits = (usage.outputUnits ?? 0) + u.outputUnits;
  };

  try {
    const response = await adapter.generateText(resolved.connection, resolved.modelId, resolved.parameters, {
      system,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      jsonMode: true,
    });
    addUsage(response.usage);

    // Deterministic validation with one repair attempt for near-miss JSON.
    // (Truncated output never reaches here — the adapter raises
    // AI_OUTPUT_TRUNCATED, and a same-budget retry would just truncate again.)
    let parsed: unknown;
    try {
      parsed = parseJsonLoose(response.text);
    } catch {
      parsed = undefined;
    }
    let validated = input.schema.safeParse(parsed);
    if (!validated.success) {
      logger.warn("ai structured output rejected; retrying once", {
        runId,
        traceId,
        schemaName: input.schemaName,
        issues: validated.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      const retry = await adapter.generateText(resolved.connection, resolved.modelId, resolved.parameters, {
        system,
        messages: [
          ...input.messages,
          {
            role: "assistant" as const,
            content: response.text,
          },
          {
            role: "user" as const,
            content: `Your previous reply did not validate. Issues: ${validated.success ? "" : validated.error.issues
              .slice(0, 8)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}. Reply again with ONLY the corrected JSON object.`,
          },
        ],
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        jsonMode: true,
      });
      addUsage(retry.usage);
      try {
        parsed = parseJsonLoose(retry.text);
      } catch {
        parsed = undefined;
      }
      validated = input.schema.safeParse(parsed);
      if (!validated.success) {
        throw new DomainError(
          "AI_OUTPUT_INVALID",
          `Model output failed schema validation for ${input.schemaName}`,
          502,
          {
            issues: validated.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        );
      }
    }

    const latencyMs = Date.now() - startedAt;
    await deps.db
      .update(schema.aiGenerationRuns)
      .set({
        status: "SUCCEEDED",
        endedAt: new Date(),
        latencyMs,
        inputUnits: usage.inputUnits,
        outputUnits: usage.outputUnits,
        responseMetadata: { finish: "validated" },
      })
      // A run the startup sweep already closed keeps that verdict.
      .where(and(eq(schema.aiGenerationRuns.id, runId), eq(schema.aiGenerationRuns.status, "RUNNING")));

    return {
      data: validated.data,
      generationRunId: runId,
      modelId: resolved.modelId,
      profileId: resolved.profileId,
      providerConnectionId: resolved.connection.id,
      source,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const code = error instanceof DomainError ? error.code : "PROVIDER_ERROR";
    await deps.db
      .update(schema.aiGenerationRuns)
      .set({
        status: "FAILED",
        endedAt: new Date(),
        latencyMs,
        errorCode: code,
        inputUnits: usage.inputUnits,
        outputUnits: usage.outputUnits,
        // Error text can echo request material from misbehaving gateways;
        // strip anything that looks like a credential before persisting it.
        responseMetadata: { message: error instanceof Error ? redactSecrets(error.message).slice(0, 300) : "unknown" },
      })
      .where(and(eq(schema.aiGenerationRuns.id, runId), eq(schema.aiGenerationRuns.status, "RUNNING")));
    throw error;
  }
}

/** Upper bound of a connection's `timeout_ms` (the API refuses larger values). */
export const MAX_PROVIDER_TIMEOUT_MS = 1_800_000;

/**
 * How old a RUNNING row must be before no live call can still own it: a
 * structured run makes up to two provider calls (answer + one repair), each
 * bounded by the connection timeout times the streaming cap. With the
 * largest allowed timeout that is 2 × 30 min × 4 = 4 hours.
 */
export const INTERRUPTED_RUN_AGE_MS = 2 * MAX_PROVIDER_TIMEOUT_MS * TOTAL_TIMEOUT_FACTOR;

/**
 * A run is finalised by runStructured's own try/catch, so one left RUNNING means
 * the process died mid-call (restart, crash, deploy). Mark those as FAILED with
 * INTERRUPTED once they are older than any live call could be; the age guard
 * keeps another replica's in-flight run untouched, and a run's own final
 * update only applies while it is still RUNNING, so a verdict is never
 * overwritten either way. Returns the number swept.
 */
export async function sweepInterruptedRuns(db: DbExecutor, olderThanMs = INTERRUPTED_RUN_AGE_MS): Promise<number> {
  const rows = await db
    .update(schema.aiGenerationRuns)
    .set({ status: "FAILED", endedAt: new Date(), errorCode: "INTERRUPTED", responseMetadata: { message: "The API stopped before this generation finished." } })
    .where(and(eq(schema.aiGenerationRuns.status, "RUNNING"), lt(schema.aiGenerationRuns.startedAt, new Date(Date.now() - olderThanMs))))
    .returning({ id: schema.aiGenerationRuns.id });
  return rows.length;
}

/** Best-effort credential scrubbing for provider error text. */
function redactSecrets(message: string): string {
  return message
    .replace(/\b(sk|pk|rk|xai|gsk|AIza)[-_A-Za-z0-9]{12,}/g, "[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._\-]{12,}/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|x-api-key|authorization|token)["'\s:=]+)[^\s"',}]{8,}/gi, "$1[redacted]");
}

export async function runText(
  deps: GatewayDeps,
  input: Omit<RunStructuredInput<unknown>, "schema" | "schemaName"> & {
    /** The answer so far, as it streams in (providers that stream only). */
    onDelta?: (textSoFar: string) => void;
  },
): Promise<RunTextResult> {
  const traceId = input.traceId ?? newTraceId();
  const found = await resolveEffectiveProfile(
    deps.db,
    deps.secretBox,
    { workspaceId: input.workspaceId, projectId: input.projectId, role: input.role },
    { allowPrivateEgress: deps.allowPrivateEgress, maxResponseBytes: deps.maxResponseBytes, cli: deps.cli },
  );
  if (!found) throw new NoProviderConfiguredError(input.role);
  const { resolved } = found;
  const adapter = adapterFor(resolved.connection.providerType);

  const [run] = await deps.db
    .insert(schema.aiGenerationRuns)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      artifactId: input.artifactId ?? null,
      role: input.role,
      aiProfileId: resolved.profileId,
      providerConnectionId: resolved.connection.id,
      modelId: resolved.modelId,
      status: "RUNNING",
      traceId,
      requestMetadata: { messages: input.messages.length },
    })
    .returning();
  const runId = run!.id;
  const startedAt = Date.now();
  try {
    const response = await adapter.generateText(resolved.connection, resolved.modelId, resolved.parameters, {
      system: input.system,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      onDelta: input.onDelta,
    });
    await deps.db
      .update(schema.aiGenerationRuns)
      .set({
        status: "SUCCEEDED",
        endedAt: new Date(),
        latencyMs: Date.now() - startedAt,
        inputUnits: response.usage.inputUnits,
        outputUnits: response.usage.outputUnits,
      })
      .where(and(eq(schema.aiGenerationRuns.id, runId), eq(schema.aiGenerationRuns.status, "RUNNING")));
    return {
      text: response.text,
      generationRunId: runId,
      modelId: resolved.modelId,
      profileName: resolved.profileName,
      providerType: resolved.connection.providerType,
      maxOutputTokens: effectiveMaxOutputTokens(resolved.connection.providerType, resolved.parameters, input.maxTokens),
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    await deps.db
      .update(schema.aiGenerationRuns)
      .set({
        status: "FAILED",
        endedAt: new Date(),
        latencyMs: Date.now() - startedAt,
        errorCode: error instanceof DomainError ? error.code : "PROVIDER_ERROR",
      })
      .where(and(eq(schema.aiGenerationRuns.id, runId), eq(schema.aiGenerationRuns.status, "RUNNING")));
    throw error;
  }
}
