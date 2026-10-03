import type { UxGenerationRecord } from "@sdd/contracts";
import type { RunTextResult } from "@sdd/ai";
import { DomainError } from "@sdd/shared";

/**
 * What one AI drawing of a screen cost and how it ended (aturan.md §5.7):
 * model and profile, the effective output limit, token use over every call
 * the drawing made (first answer and the repair turn), whether an answer was
 * cut off, the time, and whether a repair turn ran. Budgets change on this
 * evidence, not on guesses. Nothing here changes how a screen is drawn.
 */
export interface GenerationTracker {
  /** Run one AI call, keeping its model, limit and usage; a cut-off answer is noted and rethrown. */
  call(run: () => Promise<RunTextResult>): Promise<RunTextResult>;
  /** The repair turn was attempted (kept or not). */
  repairRan(): void;
  /** The record to store with the screen. */
  record(at?: Date): UxGenerationRecord;
}

export function generationTracker(now: () => number = Date.now): GenerationTracker {
  const startedAt = now();
  let last: RunTextResult | null = null;
  let input: number | null = null;
  let output: number | null = null;
  let truncated = false;
  let repaired = false;
  const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b);
  return {
    async call(run) {
      try {
        const result = await run();
        last = result;
        input = add(input, result.usage.inputUnits);
        output = add(output, result.usage.outputUnits);
        return result;
      } catch (error) {
        if (error instanceof DomainError && error.code === "AI_OUTPUT_TRUNCATED") truncated = true;
        throw error;
      }
    },
    repairRan() {
      repaired = true;
    },
    record(at = new Date()) {
      return buildGenerationRecord({ last, inputTokens: input, outputTokens: output, truncated, repaired, ms: now() - startedAt, at });
    },
  };
}

/** The stored record from what the calls reported; fields a provider does not report stay null. */
export function buildGenerationRecord(input: {
  last: Pick<RunTextResult, "modelId" | "profileName" | "providerType" | "maxOutputTokens"> | null;
  inputTokens: number | null;
  outputTokens: number | null;
  truncated: boolean;
  repaired: boolean;
  ms: number;
  at: Date;
}): UxGenerationRecord {
  return {
    at: input.at.toISOString(),
    model: input.last?.modelId ?? null,
    profile: input.last?.profileName ?? null,
    provider: input.last?.providerType ?? null,
    max_output_tokens: input.last?.maxOutputTokens ?? null,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    truncated: input.truncated,
    ms: Math.max(0, Math.round(input.ms)),
    repaired: input.repaired,
  };
}
