import { z } from "zod";
import { Priority, ReviewPolicy, RiskLevel, TaskType } from "./enums.js";

/**
 * Atomic task contract (docs/11_TASK_SPECIFICATION.md §4).
 * This is the execution-unit schema shared by REST, CLI, MCP and prompt export.
 */
export const TaskScopeSchema = z.object({
  expected_paths: z.array(z.string().max(200)).max(20).default([]),
  forbidden_paths: z.array(z.string().max(200)).max(20).default([]),
});
export type TaskScope = z.infer<typeof TaskScopeSchema>;

export const TaskVerificationSchema = z.object({
  required: z
    .array(z.object({ type: z.enum(["command", "manual"]).default("command"), command: z.string().max(400) }))
    .max(6)
    .default([]),
  evidence: z
    .array(z.enum(["test_result", "summary", "commit", "diff", "manual_note"]))
    .max(5)
    .default(["test_result"]),
});
export type TaskVerification = z.infer<typeof TaskVerificationSchema>;

export const RiskFactorsSchema = z.object({
  ambiguity: z.number().int().min(0).max(5).default(0),
  blast_radius: z.number().int().min(0).max(5).default(0),
  cross_module: z.number().int().min(0).max(5).default(0),
  concurrency: z.number().int().min(0).max(5).default(0),
  database_impact: z.number().int().min(0).max(5).default(0),
  security: z.number().int().min(0).max(5).default(0),
  integration: z.number().int().min(0).max(5).default(0),
  verification: z.number().int().min(0).max(5).default(0),
  context_size: z.number().int().min(0).max(5).default(0),
});
export type RiskFactors = z.infer<typeof RiskFactorsSchema>;

export const TaskContractSchema = z.object({
  title: z.string().max(200).min(1),
  task_type: TaskType.default("code"),
  objective: z.string().max(4000).min(1),
  scope: TaskScopeSchema,
  constraints: z.array(z.string().max(400)).max(10).default([]),
  ui_screen_keys: z.array(z.string().regex(/^[\w.-]+$/).max(100)).max(20).optional(),
  /** Task-level acceptance criteria (statements). Traceability links are separate. */
  acceptance_criteria: z.array(z.string().max(600)).max(20).min(1),
  verification: TaskVerificationSchema,
  deliverables: z
    .array(z.enum(["implementation", "automated_tests", "execution_summary", "documentation", "migration", "configuration"]))
    .max(6)
    .min(1),
  stop_conditions: z.array(z.string().max(400)).max(6).min(1),
  risk_factors: RiskFactorsSchema.default({
    ambiguity: 0,
    blast_radius: 0,
    cross_module: 0,
    concurrency: 0,
    database_impact: 0,
    security: 0,
    integration: 0,
    verification: 0,
    context_size: 0,
  }),
  parallel_safe: z.boolean().default(false),
  priority: Priority.default("P1"),
  dependency_outputs: z.record(z.string(), z.array(z.string().max(120)).max(10)).default({}),
});
export type TaskContract = z.infer<typeof TaskContractSchema>;

/** Task update payload — mutable only while DRAFT (docs/11 §12). */
export const TaskUpdateSchema = TaskContractSchema.partial().extend({
  title: z.string().max(200).min(1).optional(),
});
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

/** Hardness factor model (docs/11 §8): derived 1–5 score. */
export function deriveHardness(factors: RiskFactors): number {
  const weights: Record<keyof RiskFactors, number> = {
    ambiguity: 1.2,
    blast_radius: 1.1,
    cross_module: 1.0,
    concurrency: 1.2,
    database_impact: 1.0,
    security: 1.3,
    integration: 1.0,
    verification: 0.8,
    context_size: 0.6,
  };
  let weighted = 0;
  let totalWeight = 0;
  for (const k of Object.keys(weights) as (keyof RiskFactors)[]) {
    weighted += (factors[k] ?? 0) * weights[k]!;
    totalWeight += weights[k]!;
  }
  const normalized = (weighted / totalWeight / 5) * 4; // 0..4
  return Math.min(5, Math.max(1, Math.round(normalized) + 1));
}

export function deriveRiskLevel(factors: RiskFactors): (typeof RiskLevel)["options"][number] {
  const security = factors.security ?? 0;
  const blast = factors.blast_radius ?? 0;
  const db = factors.database_impact ?? 0;
  if (security >= 4 || blast >= 5 || (security >= 3 && blast >= 3)) return "CRITICAL";
  if (security >= 2 || blast >= 3 || db >= 4) return "HIGH";
  if (blast >= 2 || db >= 2 || (factors.concurrency ?? 0) >= 3) return "MEDIUM";
  return "LOW";
}

/** High-risk classification → stricter review policy (docs/13 §20). */
export function deriveReviewPolicy(factors: RiskFactors, taskType: TaskType): ReviewPolicy {
  const level = deriveRiskLevel(factors);
  const sensitiveType = ["security", "database", "infrastructure"].includes(taskType);
  if (level === "CRITICAL" || sensitiveType) return "HUMAN_REQUIRED";
  if (level === "HIGH") return "HUMAN_OR_APPROVED_REVIEWER";
  if (level === "LOW" && ["documentation", "research"].includes(taskType)) return "AUTO_APPROVE_ALLOWED";
  return "HUMAN_OR_APPROVED_REVIEWER";
}

/* ── Agent context pack (docs/09 §8) — CLI `task context` / MCP `task_get` ── */

export const AgentContextPackSchema = z.object({
  schema_version: z.literal(1),
  task: z.object({
    id: z.string(),
    key: z.string(),
    title: z.string(),
    objective: z.string(),
    status: z.string(),
    task_type: z.string(),
    contract: TaskContractSchema.nullable(),
    dependencies: z.array(z.object({ key: z.string(), title: z.string(), status: z.string() })),
  }),
  project: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  requirements: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      statement: z.string(),
      acceptance_criteria: z.array(z.object({ key: z.string(), statement: z.string() })),
    }),
  ),
  design_sections: z.array(z.object({ title: z.string(), content: z.string() })),
  project_rules: z.array(z.string()),
  repository_instructions: z.string().nullable().default(null),
  dependency_outputs: z.record(z.string(), z.array(z.string())),
  // Approved artifacts only; optional so packs from older servers still parse.
  /** The approved tech stack; null when none is approved (see spec_notes). */
  stack: z
    .object({
      version: z.number().int(),
      layers: z.array(z.object({ category: z.string(), technology: z.string(), version: z.string().nullable() })),
    })
    .nullable()
    .optional(),
  /** The approved design system as a prompt brief; null when skipped or not approved. */
  design_system: z.object({ version: z.number().int(), name: z.string(), brief: z.string() }).nullable().optional(),
  /** The approved UI-reference screens this task builds; null when skipped, not applicable or not approved. */
  ui_reference: z
    .object({
      version: z.number().int(),
      fidelity: z.enum(["neutral", "styled"]),
      screens: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          file: z.string(),
          purpose: z.string(),
          requirement_keys: z.array(z.string()),
          key_elements: z.array(z.string()),
          behaviour: z.array(z.string()),
        }),
      ),
      /** How a screen task proves its screen renders (web references); null for native ones. */
      render_check: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /** The application shell every in-app screen renders inside; null without an approved UI reference. */
  app_shell: z.string().nullable().optional(),
  /** Plain statements about specs that are skipped, stale, not approved, or newer than this task. */
  spec_notes: z.array(z.string()).optional(),
});
export type AgentContextPack = z.infer<typeof AgentContextPackSchema>;
