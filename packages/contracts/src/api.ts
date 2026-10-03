import { z } from "zod";
import {
  ActorType,
  ExecutionResult,
  Priority,
  ProviderType,
  PromptMode,
  ReviewDecision,
  StackMode,
  TaskEventType,
  TestStatus,
  TokenScope,
} from "./enums.js";
import { StackPackageSchema } from "./ai.js";

/** zod v4 records have no `.max()` — bound entry count with a refinement. */
function boundedRecord<V extends z.ZodType>(
  value: V,
  maxEntries: number,
  maxKeyLength = 80,
  key: z.ZodType<string> = z.string().max(maxKeyLength),
) {
  return z
    .record(key, value)
    .refine((obj) => Object.keys(obj).length <= maxEntries, {
      message: `too many entries (max ${maxEntries})`,
    });
}

/** Dotted template paths (`messages.0.content`): identifier segments only, never
 * a reserved prototype target. Prevents prototype pollution at validation time. */
const RESERVED_PATH_SEGMENTS: Record<string, boolean> = {
  "__proto__": true,
  prototype: true,
  constructor: true,
};
function safeTemplatePath() {
  return z
    .string()
    .max(80)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/, "must be a dotted identifier path")
    .refine((k) => k.split(".").every((s) => !RESERVED_PATH_SEGMENTS[s]), {
      message: "reserved path segment",
    });
}

/* ── Error envelope (docs/09 §1) ── */

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).nullish(),
    trace_id: z.string().nullish(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ── Projects ── */

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(160),
  high_level_idea: z.string().min(1).max(20_000),
  constraints: z.array(z.string().max(300)).max(10).default([]),
  key: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9-]{1,20}$/)
    .optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/* ── Discovery ── */

export const AnswerQuestionSchema = z.object({
  answer: z.string().max(5000),
  selected_options: z.array(z.string().max(200)).max(8).optional(),
});
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionSchema>;

/* ── Stack ── */

export const StackRecommendSchema = z.object({
  mode: StackMode,
  preferences: z.record(z.string(), z.string()).default({}),
  /** MANUAL mode: current user-locked components the AI must preserve. */
  manual_components: z
    .array(
      z.object({
        category: z.string().max(64),
        technology: z.string().max(120),
        version_constraint: z.string().max(60).nullable().default(null),
        locked: z.boolean().default(false),
        package: StackPackageSchema.nullable().optional(),
      }),
    )
    .max(20)
    .default([]),
  /** MANUAL mode: request a suggestion for one unresolved layer only (FR-035). */
  suggest_category: z.string().max(64).nullish(),
});
export type StackRecommendInput = z.infer<typeof StackRecommendSchema>;

export const StackApproveSchema = z.object({
  /** Chosen components for the approved baseline (normalized stack_components rows). */
  components: z.array(
    z.object({
      category: z.string().max(64),
      technology: z.string().max(120),
      version_constraint: z.string().max(60).nullable().default(null),
      selection_source: z.enum(["AI_RECOMMENDED", "USER_SELECTED", "AI_ASSISTED"]).default("USER_SELECTED"),
      locked_by_user: z.boolean().default(false),
      rationale: z.string().max(500).default(""),
      package: StackPackageSchema.nullable().optional(),
    }),
  ).min(1).max(20),
  rationale: z.string().max(2000).default(""),
});

/* ── Execution (docs/09 §9–15) ── */

export const ClaimTaskSchema = z.object({
  executor: z.object({
    type: z.enum(["LOCAL_AGENT", "MCP_CLIENT", "MANUAL"]),
    id: z.string().min(1).max(200),
  }),
  lease_seconds: z.number().int().min(60).max(3600).default(900),
});
export type ClaimTaskInput = z.infer<typeof ClaimTaskSchema>;

export const ClaimResponseSchema = z.object({
  task_id: z.string(),
  run_id: z.string(),
  lease_id: z.string(),
  lease_expires_at: z.string(),
  attempt: z.number().int(),
});
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

export const RunEventInputSchema = z.object({
  type: z.enum(["progress_reported", "file_change_reported", "validation_started", "validation_completed"]),
  client_sequence: z.number().int().min(0).optional(),
  message: z.string().max(2000).optional(),
  progress: z
    .object({ completed_steps: z.number().int().min(0), total_steps: z.number().int().min(0) })
    .optional(),
  files_changed: z.array(z.string().max(300)).max(100).optional(),
  idempotency_key: z.string().max(120).optional(),
});
export type RunEventInput = z.infer<typeof RunEventInputSchema>;

export const TestReportSchema = z.object({
  command: z.string().max(600).min(1),
  suite: z.string().max(200).nullish(),
  status: TestStatus,
  exit_code: z.number().int().nullish(),
  duration_ms: z.number().int().min(0).nullish(),
  summary: z.string().max(4000).nullish(),
  artifact_ref: z.string().max(600).nullish(),
  idempotency_key: z.string().max(120).optional(),
});
export type TestReportInput = z.infer<typeof TestReportSchema>;

export const BlockRunSchema = z.object({
  reason_code: z.string().max(80).min(1),
  message: z.string().max(2000).min(1),
});
export type BlockRunInput = z.infer<typeof BlockRunSchema>;

export const RunEvidenceSchema = z.object({
  base_commit: z.string().max(80).nullable(),
  diff: z.string().max(120000),
  diff_truncated: z.boolean().default(false),
  artifacts: z.array(z.object({ path: z.string().max(300), sha256: z.string().regex(/^[a-f0-9]{64}$/), content: z.string().max(16000).optional(), image: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/).max(700000).optional() })).max(40).default([]),
});
export type RunEvidence = z.infer<typeof RunEvidenceSchema>;

export const SubmitRunSchema = z.object({
  summary: z.string().max(8000).min(1),
  commit_sha: z.string().max(80).nullish(),
  files_changed: z.array(z.string().max(300)).max(200).default([]),
  exit_code: z.number().int().nullish(),
  evidence: RunEvidenceSchema.optional(),
});
export type SubmitRunInput = z.infer<typeof SubmitRunSchema>;

export const HeartbeatSchema = z.object({
  note: z.string().max(300).optional(),
});

/* ── Review (docs/09 §16) ── */

export const CreateReviewSchema = z.object({
  task_id: z.uuid(),
  run_id: z.uuid().nullish(),
  decision: ReviewDecision,
  summary: z.string().max(4000).default(""),
  findings: z
    .array(z.object({ severity: z.enum(["BLOCKING", "HIGH", "MEDIUM", "LOW", "INFO"]), message: z.string().max(1000) }))
    .max(30)
    .default([]),
});
export type CreateReviewInput = z.infer<typeof CreateReviewSchema>;

/* ── Bugs (docs/09 §17) ── */

export const CreateBugSchema = z.object({
  title: z.string().min(1).max(200),
  severity: z.enum(["BLOCKER", "CRITICAL", "MAJOR", "MINOR", "TRIVIAL"]).default("MAJOR"),
  current_behavior: z.string().min(1).max(4000),
  expected_behavior: z.string().min(1).max(4000),
  unchanged_behavior: z.string().max(4000).default(""),
  reproduction: z.string().min(1).max(4000),
  feature_id: z.uuid().nullish(),
  task_id: z.uuid().nullish(),
  run_id: z.uuid().nullish(),
});
export type CreateBugInput = z.infer<typeof CreateBugSchema>;

export const BugTransitionSchema = z.object({
  status: z.enum([
    "ASSESSING",
    "CONFIRMED",
    "PLANNED",
    "IN_FIX",
    "VERIFYING",
    "VERIFIED",
    "CLOSED",
    "NOT_A_BUG",
    "DUPLICATE",
    "WONT_FIX",
  ]),
  note: z.string().max(1000).default(""),
});

/* ── AI providers / profiles / bindings (docs/09 §19) ── */

export const CredentialSchema = z.object({
  type: z.enum(["BEARER", "HEADER"]),
  header_name: z.string().max(80).optional(),
  value: z.string().max(8000),
});

export const CustomHttpMappingSchema = z
  .object({
    method: z.enum(["POST", "GET"]).default("POST"),
    path: z.string().max(300).default("/"),
    /** Fixed allowlist of template variables — never evaluated as code (FR-162).
     * Keys are safe dotted paths: identifier segments only, and never the
     * prototype-pollution trinity (`__proto__`, `prototype`, `constructor`). */
    request_json_template: boundedRecord(z.string().max(4000), 30, 80, safeTemplatePath()),
    headers: boundedRecord(z.string().max(300), 20).default({}),
    text_response_pointer: z.string().regex(/^\/[A-Za-z0-9_./[\]-]*$/).max(200),
    structured_response_pointer: z.string().regex(/^\/[A-Za-z0-9_./[\]-]*$/).max(200).optional(),
  })
  .strict();

export const CreateProviderConnectionSchema = z.object({
  name: z.string().min(1).max(120),
  provider_type: ProviderType,
  base_url: z.url().max(500).optional(),
  credential: CredentialSchema.optional(),
  public_headers: boundedRecord(z.string().max(300), 20).default({}),
  secret_headers: boundedRecord(z.string().max(2000), 20).default({}),
  timeout_ms: z.number().int().min(1000).max(1_800_000).default(120_000),
  capabilities: z
    .object({
      structured_output: z.boolean().default(true),
      tool_calling: z.boolean().default(false),
      vision: z.boolean().default(false),
      streaming: z.boolean().default(false),
    })
    .default({ structured_output: true, tool_calling: false, vision: false, streaming: false }),
  custom_http_mapping: CustomHttpMappingSchema.optional(),
});
export type CreateProviderConnectionInput = z.infer<typeof CreateProviderConnectionSchema>;

export const CreateProfileSchema = z.object({
  name: z.string().min(1).max(120),
  provider_connection_id: z.uuid(),
  model_id: z.string().min(1).max(200),
  parameters: z.record(z.string(), z.unknown()).default({}),
  required_capabilities: z.array(z.enum(["structured_output", "tool_calling", "vision", "streaming"])).max(4).default([]),
});
export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;

export const PutRoleBindingSchema = z.object({
  ai_profile_id: z.uuid(),
});

/* ── Prompts (docs/09 §8) ── */

export const GeneratePromptSchema = z.object({
  mode: PromptMode.default("STANDALONE"),
});

/* ── CLI auth (docs/09 §20) ── */

export const CliAuthStartSchema = z.object({
  client_name: z.string().max(120).default("sddctl"),
  client_version: z.string().max(40).optional(),
});

export const CliAuthExchangeSchema = z.object({
  device_code: z.string().min(1).max(200),
});

export const CliAuthStatusSchema = z.object({
  status: z.enum(["PENDING", "AUTHORIZED", "EXCHANGED", "EXPIRED", "DENIED"]),
  user_code: z.string().max(20).nullish(),
  verification_url: z.string().max(300).nullish(),
  token: z.string().max(300).nullish(),
  scopes: z.array(TokenScope).nullish(),
});

/* ── Machines / gateway (docs/09 §21–22) ── */

export const RegisterMachineSchema = z.object({
  name: z.string().min(1).max(120),
  fingerprint: z.string().min(8).max(200),
  platform: z.string().max(60),
  capabilities: z.record(z.string(), z.unknown()).default({}),
});

export const ExecuteTaskCommandSchema = z.object({
  type: z.literal("execute_task"),
  command_id: z.string(),
  task_id: z.string(),
  task_key: z.string(),
  project_id: z.string(),
  repository_link_id: z.string(),
  execution_profile_id: z.string().nullish(),
  /** Structured intent only — never an arbitrary shell field (docs/13 §8). */
  prompt_mode: z.enum(["CONNECTED_CLI", "CONNECTED_MCP", "STANDALONE"]).default("CONNECTED_CLI"),
});

/* ── Misc shared ── */

export const TaskListQuerySchema = z.object({
  status: z.string().optional(),
  feature_id: z.uuid().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ActorSchema = z.object({ type: ActorType, id: z.string() });
export type Actor = z.infer<typeof ActorSchema>;

export const ExecutionResultSchema = ExecutionResult;
export const TaskEventTypeSchema = TaskEventType;
export const PrioritySchema = Priority;
