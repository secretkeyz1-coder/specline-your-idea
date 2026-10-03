import { z } from "zod";
import { DesignSystemSpecSchema } from "./design-system.js";
import {
  AnswerType,
  CoverageStatus,
  FindingType,
  Priority,
  RiskLevel,
  Severity,
  StackMode,
  TaskType,
} from "./enums.js";

/* ────────────────────────── Discovery (docs/21 §1–2) ─────────────────────── */

export const DiscoveryQuestionSchema = z.object({
  key: z.string().min(1).max(64),
  topic: z.string().min(1).max(64),
  question: z.string().min(1).max(600),
  reason: z.string().max(400).default(""),
  answer_type: AnswerType.default("TEXT"),
  options: z.array(z.string().max(200)).max(8).optional(),
  impact: z.enum(["high", "medium", "low"]).default("high"),
  blocking: z.boolean().default(false),
});
export type DiscoveryQuestionPayload = z.infer<typeof DiscoveryQuestionSchema>;

export const DiscoveryResponseSchema = z.object({
  understanding: z.string().max(2000).default(""),
  /** The next batch of high-impact questions (presented up to 5 per screen). */
  questions: z.array(DiscoveryQuestionSchema).min(1).max(5),
  facts: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        value: z.string().max(1000),
        confidence: z.enum(["USER_STATED", "DERIVED"]).default("DERIVED"),
      }),
    )
    .max(20)
    .default([]),
  assumptions: z
    .array(z.object({ description: z.string().max(600), impact: z.string().max(300).default("") }))
    .max(12)
    .default([]),
  contradictions: z
    .array(z.object({ description: z.string().max(600), related_keys: z.array(z.string()).max(10).default([]) }))
    .max(10)
    .default([]),
  coverage: z.record(z.string(), z.object({ status: CoverageStatus, blocking: z.boolean().default(false) })),
});
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;

/** Deterministic coverage topics the readiness gate requires. */
export const COVERAGE_TOPICS = [
  "problem",
  "primary_users",
  "core_workflows",
  "mvp_scope",
  "roles_permissions",
  "data",
  "integrations",
  "platform",
  "nonfunctional",
  "deployment_constraints",
] as const;
export type CoverageTopic = (typeof COVERAGE_TOPICS)[number];

/**
 * Answers after which discovery counts as ready (with assumptions) even when
 * the required topics were never named as such — AI-led sessions ask about
 * the product's own topics. The web mirrors this for its progress meter.
 */
export const DISCOVERY_READY_AFTER_ANSWERS = 15;

/* ──────────────────────── Requirements (docs/21 §3) ──────────────────────── */

export const RequirementsArtifactSchema = z.object({
  summary: z.string().max(4000),
  actors: z.array(z.object({ name: z.string().max(120), description: z.string().max(600).default("") })).max(20),
  workflows: z
    .array(
      z.object({
        name: z.string().max(160),
        primary_actor: z.string().max(120).default(""),
        steps: z.array(z.string().max(300)).max(20),
      }),
    )
    .max(15),
  functional_requirements: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Z0-9-]+$/).max(32),
        title: z.string().max(200),
        statement: z.string().max(1500),
        priority: Priority.default("P1"),
        acceptance_criteria: z
          .array(
            z.object({
              key: z.string().regex(/^[A-Z0-9-]+$/).max(32),
              statement: z.string().max(800),
              verification_type: z.enum(["TEST", "MANUAL", "REVIEW", "METRIC"]).default("TEST"),
            }),
          )
          .max(10)
          .min(1),
      }),
    )
    .max(40),
  non_functional: z
    .array(z.object({
      key: z.string().max(32), statement: z.string().max(800), priority: Priority.default("P1"),
      acceptance_criteria: z.array(z.object({ key: z.string().max(32), statement: z.string().max(800), verification_type: z.enum(["TEST", "MANUAL", "REVIEW", "METRIC"]).default("METRIC") })).max(5).optional(),
    }))
    .max(15)
    .default([]),
  assumptions: z.array(z.object({ description: z.string().max(600) })).max(15).default([]),
  exclusions: z.array(z.object({ description: z.string().max(600) })).max(15).default([]),
  open_questions: z.array(z.object({ description: z.string().max(600) })).max(15).default([]),
}).superRefine((data, ctx) => {
  const actors = new Set(data.actors.map(a => a.name.trim().toLowerCase()));
  const keys = new Set([...data.functional_requirements, ...data.non_functional].map(r => r.key));
  const acKeys = new Set<string>();
  if (keys.size !== data.functional_requirements.length + data.non_functional.length) ctx.addIssue({ code: "custom", path: ["functional_requirements"], message: "Requirement keys must be unique" });
  for (const [i, workflow] of data.workflows.entries()) {
    if (workflow.primary_actor && !actors.has(workflow.primary_actor.trim().toLowerCase())) ctx.addIssue({ code: "custom", path: ["workflows", i, "primary_actor"], message: "Workflow actor is not listed in actors" });
    for (const step of workflow.steps) for (const [key] of step.matchAll(/\b(?:FR|NFR)-[A-Z0-9-]+\b/g)) if (!keys.has(key)) ctx.addIssue({ code: "custom", path: ["workflows", i, "steps"], message: `Unknown workflow requirement ${key}` });
  }
  for (const r of [...data.functional_requirements, ...data.non_functional]) for (const ac of r.acceptance_criteria ?? []) {
    if (acKeys.has(ac.key)) ctx.addIssue({ code: "custom", path: ["functional_requirements"], message: `Duplicate acceptance criterion ${ac.key}` });
    acKeys.add(ac.key);
  }
});
export type RequirementsArtifact = z.infer<typeof RequirementsArtifactSchema>;

/** Legacy NFRs still have an explicit outcome; never let an empty AC list waive quality coverage. */
export function qualityCriteria(r: { key: string; statement: string; acceptance_criteria?: Array<{ key: string; statement: string; verification_type?: "TEST" | "MANUAL" | "REVIEW" | "METRIC" }> }) {
  return r.acceptance_criteria?.length ? r.acceptance_criteria : [{ key: `AC-${r.key}-1`, statement: r.statement, verification_type: "METRIC" as const }];
}

/* ─────────────────────────── Stack (docs/21 §4) ──────────────────────────── */

/** Where a technology is published, so its current release can be checked live. */
export const StackPackageSchema = z.object({
  registry: z.enum(["npm", "pypi", "crates", "github"]),
  /** npm/PyPI/crates package name, or "owner/repo" on GitHub. */
  name: z.string().min(1).max(214),
});
export type StackPackage = z.infer<typeof StackPackageSchema>;

/** A live registry check of one layer's technology — filled in by the server, never by the model. */
export const StackVerificationSchema = z.object({
  /** current · stale (no release in 18 months) · deprecated (or archived) · unknown (not checked / lookup failed). */
  status: z.enum(["current", "stale", "deprecated", "unknown"]),
  latest_version: z.string().max(60).nullable().default(null),
  released_at: z.string().max(40).nullable().default(null),
  checked_at: z.string().max(40),
  source_url: z.string().max(300).nullable().default(null),
  note: z.string().max(300).nullable().default(null),
});
export type StackVerification = z.infer<typeof StackVerificationSchema>;

export const StackComponentSchema = z.object({
  category: z.string().max(64),
  technology: z.string().max(120),
  version_constraint: z.string().max(60).nullable().default(null),
  rationale: z.string().max(500).default(""),
  /** Registry id of the technology; null for a hosted service with no package. */
  package: StackPackageSchema.nullable().optional(),
  /** Set by the server after a live registry check; the model leaves it out. */
  verified: StackVerificationSchema.optional(),
});

export const StackCandidateSchema = z.object({
  name: z.string().max(120),
  layers: z.array(StackComponentSchema).max(20),
  tradeoffs: z.array(z.object({ dimension: z.string().max(80), assessment: z.string().max(400) })).max(10),
  fit_assessment: z.string().max(500).default(""),
});

export const StackDecisionSchema = z.object({
  mode: StackMode,
  candidates: z.array(StackCandidateSchema).max(4),
  /** Index into `candidates` of the recommended option (RECOMMENDED mode). */
  recommendation_index: z.number().int().min(0).nullable().default(null),
  rationale: z.string().max(1500).default(""),
  /** MANUAL mode compatibility findings — user choices are never silently replaced. */
  conflicts: z
    .array(
      z.object({
        category: z.string().max(64),
        finding: z.string().max(600),
        severity: z.enum(["BLOCKING", "HIGH", "MEDIUM", "LOW", "INFO"]).default("MEDIUM"),
      }),
    )
    .max(15)
    .default([]),
});
export type StackDecision = z.infer<typeof StackDecisionSchema>;

/* ─────────────────────────── Design (docs/21 §5) ─────────────────────────── */

export const DesignArtifactSchema = z.object({
  overview: z.string().max(4000),
  architecture: z.object({
    summary: z.string().max(3000),
    diagram_text: z.string().max(4000).default(""),
  }),
  components: z
    .array(
      z.object({
        name: z.string().max(120),
        responsibility: z.string().max(800),
        interfaces: z.string().max(800).default(""),
      }),
    )
    .max(25),
  data_model: z.string().max(8000),
  api_contracts: z.string().max(8000),
  state_machines: z.string().max(6000),
  requirement_coverage: z
    .array(
      z.object({
        requirement_key: z.string().max(32),
        design_section: z.string().max(160),
        status: z.enum(["PATH_DEFINED", "PARTIAL", "NO_PATH"]),
      }),
    )
    .max(60)
    .default([]),
  testing_strategy: z.string().max(4000),
  security: z.string().max(4000),
  deployment: z.string().max(3000),
  /** Bounded production checks owned by tasks; startup/journeys use a test fixture that stops the app. */
  delivery_checks: z.array(z.object({ purpose: z.enum(["build", "startup", "journey", "deployment"]), command: z.string().min(1).max(400), expected_paths: z.array(z.string().max(200)).max(20).default([]), outcome: z.string().min(1).max(800) })).max(6).optional(),
  unresolved_decisions: z
    .array(z.object({ description: z.string().max(600), blocking: z.boolean().default(false) }))
    .max(15)
    .default([]),
});
export type DesignArtifact = z.infer<typeof DesignArtifactSchema>;

/* ─────────────────── UI reference (the "ux" artifact) ──────────────────── */

/** The most screens one UI reference holds — each is its own AI call. */
export const MAX_UX_SCREENS = 12;

/**
 * The UI-reference numbers, in one place: the prompts state them and the
 * checks (plan lint, screen lint, render check, composition CSS, phone cards)
 * use them, so what the model reads and what it is checked against cannot
 * drift apart.
 *
 * Two kinds (aturan.md §4, Lapis 3): UX_LIMITS are hard limits the schema or
 * the platform enforces; the rest of UX_BUDGETS are design recommendations —
 * going over one is a review signal (a warning), never a reason to split a
 * screen or to refuse approval.
 */
export const UX_LIMITS = {
  /** requirement_keys of one planned screen. */
  requirementKeysPerScreen: 10,
  /** key_elements of one planned screen. */
  keyElementsPerScreen: 12,
  /** Overlays (dialog, sheet, confirmation) planned for one screen. */
  overlaysPerScreen: 3,
  /** State frames drawn after the overlays — a cap on pictures, not on the states a screen describes. */
  stateFrames: 2,
  /** Fixed widths from this many px are dropped from composition CSS (they overflow a phone). */
  phoneWidthPx: 320,
} as const;

export const UX_BUDGETS = {
  ...UX_LIMITS,
  /** Key elements of one planned screen — recommended; more is a review signal. */
  keyElements: 5,
  /** Main blocks of a screen — a review signal for the hierarchy, not a number to fill (aturan.md §4). No stat-card quota: a dashboard shows KPIs only when they help and have data. */
  blocksUnderHeader: 5,
  /** Columns of a main-view table (the row-selection column not counted); a comparison table may need more. */
  tableColumns: 7,
  /** A table with more columns than this spans the full width of the page. */
  fullWidthTableColumns: 5,
  /** Without a data-phone choice, a table with more columns than this becomes cards on a phone. */
  phoneCardsFromColumns: 4,
  /** Facts one phone card shows under its title. */
  phoneCardFacts: 4,
  /** Actions in the page header. */
  pageActions: 3,
  /** Primary buttons in one area of the main view (the page header, one section). */
  primaryPerArea: 1,
  /** A main view taller than this many phone screens is flagged. */
  phoneScreens: 4,
} as const;

/**
 * The rule set a reference was planned under. 2 (aturan.md, 2026-09-30): key
 * elements are marked with data-key-element, stat numbers come from the
 * example data, the shell shows only what the requirements ask for. A
 * reference without rules_version is checked without the checks it could not
 * have known about.
 */
export const UX_RULES_VERSION = 2;

/** What a screen is for (a category of function); its composition follows the work, not a recipe (aturan.md §4). */
export const UxScreenType = z.enum(["dashboard", "list", "detail", "form", "settings", "board", "analytics"]);
export type UxScreenType = z.infer<typeof UxScreenType>;

/**
 * Work that opens over a screen instead of sitting in it: a dialog for a
 * short one-record form, a sheet for details or editing while the list stays
 * visible, a confirmation for destructive actions. A long, multi-step or
 * draft-saving form is a screen of its own (screen_type "form").
 */
export const UxOverlaySchema = z.object({
  kind: z.enum(["dialog", "sheet", "confirm"]),
  name: z.string().min(1).max(80),
  purpose: z.string().max(240).default(""),
  /** What happens after its action succeeds or fails (a toast, a redirect, the row updated). */
  result: z.string().max(240).default(""),
});
export type UxOverlay = z.infer<typeof UxOverlaySchema>;

/**
 * The example data every screen of a UI reference shares, so one record looks
 * the same everywhere: the main records with their key facts, the people with
 * their roles, and notes (period, today's date, units).
 */
export const UxSampleDataSchema = z.object({
  records: z
    .array(z.object({ kind: z.string().max(40), name: z.string().max(100), facts: z.string().max(300).default("") }))
    .max(10)
    .default([]),
  people: z.array(z.object({ name: z.string().max(80), role: z.string().max(80) })).max(10).default([]),
  notes: z.string().max(600).default(""),
  /** Every status label the screens show and its badge tone — the same status looks the same everywhere. */
  statuses: z
    .array(z.object({ label: z.string().max(60), tone: z.enum(["success", "warn", "danger", "info", "accent", "neutral"]) }))
    .max(20)
    .default([]),
  /**
   * Totals and KPIs the records alone do not add up to, each with its basis:
   * a stat card's number comes from the records or from here, never from nowhere.
   */
  aggregates: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(60), basis: z.string().max(200).default("") }))
    .max(12)
    .default([]),
});
export type UxSampleData = z.infer<typeof UxSampleDataSchema>;
export type UxStatusTone = UxSampleData["statuses"][number]["tone"];

/** A state a screen must describe — drawn as one of its state frames, or only described. */
export const UxStateSchema = z.object({
  /** "Empty", "Save failed", "Permission denied", "Loading"… */
  state: z.string().min(1).max(60),
  /** When it happens. */
  when: z.string().max(200).default(""),
  /** What the person sees and can do then. */
  response: z.string().max(240).default(""),
});
export type UxState = z.infer<typeof UxStateSchema>;

/**
 * The devices a UI reference is drawn for, in CSS pixels (Android dp for the
 * native ones). Web references use the desktop frame (the canvas offers other
 * desktop presets) and a phone; native mobile references use phone and tablet.
 */
export const UX_DEVICES = {
  desktop: { w: 1440, h: 900, label: "Desktop" },
  phone: { w: 412, h: 915, label: "Phone" },
  "tablet-landscape": { w: 1280, h: 800, label: "Tablet landscape" },
  "tablet-portrait": { w: 800, h: 1280, label: "Tablet portrait" },
} as const;
export const UxDevice = z.enum(["desktop", "phone", "tablet-landscape", "tablet-portrait"]);
export type UxDevice = z.infer<typeof UxDevice>;

/**
 * What the screens are drawn as. Web: the web-app shell (sidebar, header).
 * Native mobile (Android first): Material 3 app chrome — top app bar, bottom
 * navigation on a phone, a navigation rail on a tablet — at device sizes.
 * Detected from the approved stack and the requirements when the plan is
 * made; the person can override it. Absent on older references: web.
 */
export const UxPlatformSchema = z.object({
  kind: z.enum(["web", "native-mobile"]),
  /** The native OS whose conventions the screens follow; null for web. Android only for now. */
  os: z.enum(["android"]).nullable().default(null),
  /** Target devices, the primary one first (the canvas opens on it). */
  devices: z.array(UxDevice).min(1).max(3),
  /** Detected from the stack and requirements, or chosen by the person. */
  source: z.enum(["detected", "user"]).default("detected"),
  /** Why: the stack layers and requirement words it was read from. */
  reason: z.string().max(300).default(""),
});
export type UxPlatform = z.infer<typeof UxPlatformSchema>;

/**
 * The product's visual brief (aturan.md §4 Lapis 1): who uses it and where,
 * the devices that come first, a concrete visual direction with its
 * consequences, what dominates the screens, and references and limits. The
 * plan writes it from the requirements (its guesses go in `assumptions`, for
 * the person to review); the person may rewrite it. It travels to the plan,
 * every draw and redraw, and AI element edits.
 */
export const UxVisualBriefSchema = z.object({
  /** Who uses it, the core job, how often, and the environment (a noisy counter, a desk, on the move). */
  users: z.string().max(500).default(""),
  /** The device that comes first and the sizes that must still work. */
  devices: z.string().max(300).default(""),
  /** A concrete character and what it means for the screens ("fast cashier → roomy touch targets, a scannable menu, the order always visible"). */
  direction: z.string().max(600).default(""),
  /** What dominates: the information or action that leads, and the role of photos, illustrations, numbers, tables or editors. */
  hierarchy: z.string().max(600).default(""),
  /** References from the person and which aspect to take from them, available assets, and what to avoid. */
  references: z.string().max(500).default(""),
  /** What the brief assumed because the requirements did not say — for the person to review. */
  assumptions: z.array(z.string().max(240)).max(8).default([]),
  /** Written by the plan, or edited by the person. */
  source: z.enum(["ai", "user"]).default("ai"),
});
export type UxVisualBrief = z.infer<typeof UxVisualBriefSchema>;

/**
 * How the web shell navigates (aturan.md §4 "Bentuk shell mengikuti pekerjaan
 * produk"): a side navigation for many work areas, a top navigation for a few
 * main destinations, or a minimal shell for one focused job. The platform
 * renders it; absent on older references means the side navigation. Native
 * mobile references use their own app chrome and ignore it.
 */
export const UxShellLayout = z.enum(["sidebar", "topnav", "minimal"]);
export type UxShellLayout = z.infer<typeof UxShellLayout>;

/** The aspects of a person's visual review of a rendered screen (aturan.md §5.6). */
export const UxReviewAspect = z.enum(["focus", "composition", "hierarchy", "product_fit", "devices"]);
export type UxReviewAspect = z.infer<typeof UxReviewAspect>;

/**
 * A person's visual review of one drawing: each aspect fits, needs revision,
 * or is not checked yet, with the element at fault and a concrete change.
 * Input for the person's decision — never a blocker and never a score.
 * `html_digest` names the drawing reviewed; a new drawing makes it outdated.
 */
export const UxVisualReviewSchema = z.object({
  aspects: z
    .array(
      z.object({
        aspect: UxReviewAspect,
        status: z.enum(["ok", "revise", "unchecked"]).default("unchecked"),
        element: z.string().max(200).default(""),
        change: z.string().max(500).default(""),
      }),
    )
    .max(5),
  reviewed_at: z.string().max(40),
  html_digest: z.string().max(64),
});
export type UxVisualReview = z.infer<typeof UxVisualReviewSchema>;

/**
 * What one AI drawing of a screen cost and how it ended (aturan.md §5.7), so
 * budgets are changed on evidence: the model and profile, the effective
 * output limit, token use, whether the answer was cut off, the time, and
 * whether a repair turn ran. Fields the provider does not report are null.
 */
export interface UxGenerationRecord {
  at: string;
  model: string | null;
  profile: string | null;
  provider: string | null;
  max_output_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  truncated: boolean;
  ms: number;
  repaired: boolean;
}

/** Utilities of the app shell; each is drawn only when a requirement asks for it. */
export const UxShellSchema = z.object({
  /** How the web shell navigates; absent on older plans: the side navigation. */
  layout: UxShellLayout.optional(),
  /** A search across the product's data. */
  search: z.boolean().default(false),
  /** A notifications bell. */
  notifications: z.boolean().default(false),
  /** A signed-in user with a user menu (profile, sign-out). */
  account: z.boolean().default(false),
  /** Which requirements ask for the utilities that are on. */
  reason: z.string().max(400).default(""),
});
export type UxShell = z.infer<typeof UxShellSchema>;

/**
 * What a person's own HTML page says about layout, read once by the AI: its
 * structure, density and patterns — never its text, numbers, colours or type.
 * Screens follow it for layout only; content comes from the requirements and
 * the example data, looks from the kit or the design system.
 */
export const LayoutBriefSchema = z.object({
  /** "Dashboard with KPI row over a two-column body", "Master–detail list"… */
  archetype: z.string().min(1).max(160),
  /** The page's areas in reading order: header strip, filters, KPI row, main table, side panel… */
  regions: z
    .array(z.object({ name: z.string().min(1).max(60), role: z.string().max(200).default("") }))
    .max(12)
    .default([]),
  /** Columns and their proportions: "12-col, main 8 / aside 4", "single column, max 960px". */
  grid: z.string().max(300).default(""),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  /** How the page navigates (tabs, breadcrumbs, a sidebar) — informational: the platform draws the shell. */
  navigation: z.string().max(240).default(""),
  /** Content patterns it relies on. */
  patterns: z.array(z.enum(["cards", "table", "list", "form", "stats", "detail-pane", "tabs", "chart", "timeline", "board", "gallery", "empty-state"])).max(12).default([]),
  /** What leads the eye: the primary action, the headline number, the main table… */
  emphasis: z.string().max(300).default(""),
  /** Spacing rhythm: gaps between sections and inside cards. */
  spacing: z.string().max(240).default(""),
  /** Components worth keeping: sticky filter bar, segmented control, inline row actions… */
  components: z.array(z.string().max(120)).max(12).default([]),
  /** How its parts map onto the kit's ds-* classes. */
  kit_mapping: z.array(z.object({ pattern: z.string().max(120), kit: z.string().max(160) })).max(16).default([]),
  notes: z.string().max(600).default(""),
});
export type LayoutBrief = z.infer<typeof LayoutBriefSchema>;

/** An analysed layout reference, stored on a UI reference (for every screen) or on one screen. */
export const LayoutReferenceSchema = z.object({
  name: z.string().min(1).max(80),
  brief: LayoutBriefSchema,
  /** Size of the page after cleaning, as it went to the analysis. */
  source_chars: z.number().int().min(0),
  /** Identifies this reference; a screen remembers the digest it was drawn with. */
  digest: z.string().min(1).max(64),
  analysed_at: z.string().max(40),
  /** Old references remain layout-only; new choices can explicitly adapt their visual language. */
  mode: z.enum(["layout", "adapt"]).optional(),
  source_html: z.string().max(40_000).optional(),
  source_css: z.string().max(20_000).optional(),
  design_system: DesignSystemSpecSchema.optional(),
  notes: z.array(z.string().max(600)).max(12).optional(),
});
export type LayoutReference = z.infer<typeof LayoutReferenceSchema>;

/** A screen count set by the person that is too small to serve every visible P0 requirement. */
export const UxCountConflictSchema = z.object({
  /** The P0 requirement keys no screen serves at the requested count. */
  uncovered: z.array(z.string().max(32)).max(20).default([]),
  /** The smallest count that would serve them. */
  minimum_count: z.number().int().min(0).max(MAX_UX_SCREENS).default(0),
  note: z.string().max(600).default(""),
});
export type UxCountConflict = z.infer<typeof UxCountConflictSchema>;

/**
 * The AI's screen plan: which key screens a mid-fidelity reference needs.
 * `applicable` follows the requirements' need for a visual interface, not the
 * technology: an API product whose requirements ask for an admin console has
 * screens; a CLI or library without such a requirement has none.
 */
export const UxPlanSchema = z.object({
  applicable: z.boolean(),
  reason: z.string().max(600).default(""),
  /** The AI's own screen count and why (or, when the person set the count, which screens it chose). */
  recommended_count: z.number().int().min(0).max(MAX_UX_SCREENS).default(0),
  count_rationale: z.string().max(600).default(""),
  /** Only when the person's count cannot serve every visible P0 requirement. */
  count_conflict: UxCountConflictSchema.optional(),
  /** What the reference leaves out because it would need more than MAX_UX_SCREENS screens. */
  uncovered_scope: z.array(z.string().max(200)).max(20).default([]),
  /** Requirements with nothing to see (a background job, an API, a quality): no screen serves them, by design. */
  no_ui_requirements: z.array(z.object({ key: z.string().max(32), reason: z.string().max(200).default("") })).max(60).default([]),
  /** The shell utilities the requirements ask for (absent on plans made before it existed: the full shell). */
  shell: UxShellSchema.optional(),
  /** The product's visual brief, written from the requirements with its assumptions listed. */
  brief: UxVisualBriefSchema.optional(),
  screens: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        name: z.string().max(80),
        purpose: z.string().max(400),
        requirement_keys: z.array(z.string().max(32)).max(UX_LIMITS.requirementKeysPerScreen).default([]),
        key_elements: z.array(z.string().max(160)).max(UX_LIMITS.keyElementsPerScreen).default([]),
        screen_type: UxScreenType.default("list"),
        shell_mode: z.enum(["app", "auth", "standalone"]).optional(),
        overlays: z.array(UxOverlaySchema).max(UX_LIMITS.overlaysPerScreen).default([]),
        /** The main view's primary action and what happens after it. */
        primary_action: z.object({ label: z.string().max(80), result: z.string().max(240).default("") }).optional(),
        /** Every state that matters for the screen, drawn or not. */
        states: z.array(UxStateSchema).max(8).default([]),
        /** The screen's composition plan: focus, arrangement, density, media, device adaptation (aturan.md §4). */
        layout_note: z.string().max(600).default(""),
      }),
    )
    .max(MAX_UX_SCREENS)
    .default([]),
  /** The records, people and numbers every screen shows (absent on plans made before it existed). */
  sample_data: UxSampleDataSchema.optional(),
});
export type UxPlan = z.infer<typeof UxPlanSchema>;

/** One screen of the stored reference; `html` is null until generated. */
export interface UxScreen {
  key: string;
  name: string;
  purpose: string;
  requirement_keys: string[];
  key_elements: string[];
  /** Layout recipe; absent on screens planned before recipes existed. */
  screen_type?: UxScreenType;
  shell_mode?: "app" | "auth" | "standalone";
  /** Dialogs, sheets and confirmations drawn as open frames after the main view. */
  overlays?: UxOverlay[];
  /** The main view's primary action and its result. */
  primary_action?: { label: string; result: string };
  /** Every state that matters for the screen; at most UX_LIMITS.stateFrames of them are drawn. */
  states?: UxState[];
  /** The screen's composition plan: the main focus, how the areas are arranged, density, the role of media, and how it adapts per device (aturan.md §4). */
  layout_note?: string;
  /** This screen's own layout reference, instead of the reference's one. */
  layout_reference?: LayoutReference;
  /** Digest of the layout reference the drawing followed (null: none); absent on screens drawn before layout references. */
  drawn_with_layout?: string | null;
  html: string | null;
  /** The last change a person asked for, kept so the history reads clearly. */
  revision_note?: string;
  /** Deterministic checks on the stored drawing (modules/ux/ux-lint.ts); absent on screens drawn before the linter. */
  lint?: UxLintFinding[];
  /** Earlier page contents, newest first (at most UX_SCREEN_HISTORY), for undo. */
  history?: UxScreenVersion[];
  /** Review comments pinned to elements of the screen (by their data-nid). */
  comments?: UxComment[];
  /** A person's visual review of the drawing (aturan.md §5.6); outdated once html_digest no longer matches. */
  visual_review?: UxVisualReview;
  /** The last AI drawing's model, limits, token use, truncation, time and repair (aturan.md §5.7). */
  generation?: UxGenerationRecord;
  /** Digest of what the stored render findings measured (framed HTML + sizes); null when no render ran. Approval re-renders on a mismatch (aturan.md §5.4). */
  render_digest?: string | null;
}

/** How many earlier versions of a screen are kept for undo. */
export const UX_SCREEN_HISTORY = 5;

/** One earlier version of a screen's page content (the inside of <main>). */
export interface UxScreenVersion {
  content: string;
  at: string;
  /** What replaced it: "Edited text", "Redrawn by AI: …". */
  note: string;
}

/** A comment pinned to one element of a UI-reference screen. */
export interface UxComment {
  id: string;
  /** The element's data-nid; null when the element no longer exists. */
  nid: string | null;
  /** The element's text or role when the comment was made, so a detached comment still reads. */
  anchor: string;
  text: string;
  author_id: string;
  created_at: string;
  resolved_at: string | null;
}

/**
 * What a finding is about (aturan.md §5.1). The category says what kind of
 * harm it does; the action says what the platform does about it.
 */
export type UxFindingCategory = "security" | "completeness" | "usability" | "integrity" | "guidance" | "instruction";

/**
 * One deterministic finding on a plan or a drawn screen. `block` findings
 * refuse approval; `warn` findings are shown with their context. `repair`
 * marks what the one automatic repair turn is asked to fix — an aesthetic
 * finding can be repaired without blocking anything.
 */
export interface UxLintFinding {
  rule: string;
  category: UxFindingCategory;
  action: "block" | "warn";
  repair: boolean;
  message: string;
}

/** structuredContent of a "ux" artifact revision. */
export interface UxReference {
  applicable: boolean;
  reason: string;
  screens: UxScreen[];
  /** The AI's own count and its reason; absent on references made before counts existed. */
  recommended_count?: number;
  count_rationale?: string;
  /** The count the person asked for, if they set one. */
  requested_count?: number | null;
  /** What the person asked the plan to include, leave out or focus on. */
  guidance?: string;
  /** Neutral greyscale mockups, or drawn with the approved design system. */
  fidelity?: UxFidelity;
  /** The design-system version styled screens were drawn with. */
  design_system_version?: number | null;
  /** Checks on the screen plan (after its one repair turn), for the person to see. */
  plan_lint?: UxLintFinding[];
  /** The example data every screen shares; made with the plan, or once for an older draft. */
  sample_data?: UxSampleData;
  /** The rule set the reference was planned under (UX_RULES_VERSION); absent on older references. */
  rules_version?: number;
  /** The person's count could not serve every visible P0 requirement. */
  count_conflict?: UxCountConflict;
  /** What is left out because it would need more than MAX_UX_SCREENS screens. */
  uncovered_scope?: string[];
  /** Requirements with nothing to see, and why. */
  no_ui_requirements?: Array<{ key: string; reason: string }>;
  /** Shell utilities the requirements ask for; absent = the full shell of older references. */
  shell?: UxShell;
  /** When the person accepted count_conflict / uncovered_scope — required before approval when either is set. */
  scope_confirmed_at?: string | null;
  /** The person's own page every screen follows for layout (a screen may have its own instead). */
  layout_reference?: LayoutReference | null;
  /** Web app or native mobile, and the target devices; absent on older references (web). */
  platform?: UxPlatform;
  /** The product's visual brief (aturan.md §4 Lapis 1); absent on references planned before it. */
  brief?: UxVisualBrief;
  /**
   * How the screens are drawn. "kit": the model writes only <main> with the
   * platform's ds-* kit inside a platform shell (every reference before the
   * open-design adoption; absent = "kit"). "od": open-design style — the model
   * writes the whole <body> from a per-surface seed template, the platform
   * injects the design-system tokens and the seed's base CSS (UX_OD_MARKERS).
   */
  generator?: UxGenerator;
}

export const UxGenerator = z.enum(["kit", "od"]);
export type UxGenerator = z.infer<typeof UxGenerator>;

/**
 * Markers every "od" screen document carries, so the canvas, the overlay
 * split, the render check and the approval gate find the parts without
 * relying on any seed's class names.
 */
export const UX_OD_MARKERS = {
  /** The app's root element (the screen as the person sees it). */
  app: "data-sdd-app",
  /** The main content region of the screen. */
  content: "data-screen-content",
  /** The section holding overlay and state frames (hidden on the screen artboard). */
  overlays: "data-sdd-overlays",
  /** One overlay or state frame (a <figure> with a <figcaption> naming it). */
  frame: "data-sdd-frame",
  /** The shared navigation (copied from the platform-given markup). */
  nav: "data-sdd-nav",
} as const;

export type UxFidelity = "neutral" | "styled";

/* ──────────────────── Task decomposition (docs/21 §6) ────────────────────── */

export const TaskPlanTaskSchema = z.object({
  /** Temporary AI reference key used to wire dependency edges before persistence. */
  ref: z.string().regex(/^[A-Za-z0-9_-]+$/).max(64),
  title: z.string().max(200),
  task_type: TaskType,
  feature_hint: z.string().max(160).default(""),
  objective: z.string().max(2000),
  requirement_keys: z.array(z.string().max(32)).max(10).default([]),
  acceptance_criterion_keys: z.array(z.string().max(32)).max(10).default([]),
  depends_on_refs: z.array(z.string().max(64)).max(12).default([]),
  scope: z.object({
    expected_paths: z.array(z.string().max(200)).max(20),
    forbidden_paths: z.array(z.string().max(200)).max(20).default([]),
  }),
  constraints: z.array(z.string().max(400)).max(10).default([]),
  ui_screen_keys: z.array(z.string().regex(/^[\w.-]+$/).max(100)).max(20).optional(),
  acceptance_criteria: z.array(z.string().max(400)).max(20).min(1),
  verification: z.object({
    required: z
      .array(z.object({ type: z.enum(["command", "manual"]).default("command"), command: z.string().max(400) }))
      .max(6)
      .min(1),
    evidence: z.array(z.enum(["test_result", "summary", "commit", "diff", "manual_note"])).max(5).default(["test_result"]),
  }),
  deliverables: z.array(z.enum(["implementation", "automated_tests", "execution_summary", "documentation", "migration", "configuration"])).max(6).min(1),
  stop_conditions: z.array(z.string().max(400)).max(6).min(1),
  risk_factors: z
    .object({
      ambiguity: z.number().int().min(0).max(5).default(1),
      blast_radius: z.number().int().min(0).max(5).default(1),
      cross_module: z.number().int().min(0).max(5).default(0),
      concurrency: z.number().int().min(0).max(5).default(0),
      database_impact: z.number().int().min(0).max(5).default(0),
      security: z.number().int().min(0).max(5).default(0),
      integration: z.number().int().min(0).max(5).default(0),
      verification: z.number().int().min(0).max(5).default(0),
      context_size: z.number().int().min(0).max(5).default(0),
    })
    .default({ ambiguity: 0, blast_radius: 0, cross_module: 0, concurrency: 0, database_impact: 0, security: 0, integration: 0, verification: 0, context_size: 0 }),
  parallel_safe: z.boolean().default(false),
  priority: Priority.default("P1"),
});
export type TaskPlanTask = z.infer<typeof TaskPlanTaskSchema>;

export const TaskPlanSchema = z.object({
  features: z
    .array(z.object({ key: z.string().max(32), title: z.string().max(200), description: z.string().max(1000).default("") }))
    .max(15)
    .default([]),
  tasks: z.array(TaskPlanTaskSchema).max(60).min(1),
  generation_notes: z.string().max(2000).default(""),
}).superRefine((plan, ctx) => {
  const refs = new Set<string>();
  const features = new Set(plan.features.map((f) => f.key));
  if (features.size !== plan.features.length) ctx.addIssue({ code: "custom", path: ["features"], message: "Feature keys must be unique" });
  for (const feature of plan.features) if (!plan.tasks.some(t => t.feature_hint === feature.key)) ctx.addIssue({ code: "custom", path: ["features"], message: `Feature ${feature.key} has no implementing task` });
  for (const [i, task] of plan.tasks.entries()) {
    if (refs.has(task.ref)) ctx.addIssue({ code: "custom", path: ["tasks", i, "ref"], message: "Task refs must be unique" });
    refs.add(task.ref);
    if (task.feature_hint && !features.has(task.feature_hint)) ctx.addIssue({ code: "custom", path: ["tasks", i, "feature_hint"], message: "Unknown feature" });
  }
  const byRef = new Map(plan.tasks.map((t) => [t.ref, t]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (ref: string): boolean => {
    if (visiting.has(ref)) return false;
    if (visited.has(ref)) return true;
    visiting.add(ref);
    for (const dep of byRef.get(ref)?.depends_on_refs ?? []) if (!byRef.has(dep) || !visit(dep)) return false;
    visiting.delete(ref); visited.add(ref); return true;
  };
  for (const task of plan.tasks) if (!visit(task.ref)) {
    ctx.addIssue({ code: "custom", path: ["tasks"], message: "Dependencies must resolve and be acyclic" }); break;
  }
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;

export const PlanQualitySchema = z.object({
  coverage: z.array(z.object({ requirement_key: z.string(), acceptance_criterion_key: z.string(), task_refs: z.array(z.string()).min(1), status: z.enum(["CONSISTENT", "CONTRADICTED", "UNKNOWN"]), evidence: z.string().min(1).max(300) })).max(500),
  issues: z.array(z.string().max(500)).max(30).default([]),
});
export type PlanQuality = z.infer<typeof PlanQualitySchema>;

/* ─────────────────── Convergence + lint (docs/21 §7,13) ──────────────────── */

export const ConvergenceFindingSchema = z.object({
  finding_type: FindingType,
  severity: Severity,
  requirement_key: z.string().max(32).nullable().default(null),
  acceptance_criterion_key: z.string().max(32).nullable().default(null),
  description: z.string().max(1200),
  evidence: z.string().max(1200).default(""),
  suggested_task: z
    .object({
      title: z.string().max(200),
      objective: z.string().max(2000),
      task_type: TaskType.default("code"),
    })
    .nullable()
    .default(null),
});

export const ConvergenceOutputSchema = z.object({
  summary: z.string().max(3000).default(""),
  findings: z.array(ConvergenceFindingSchema).max(50).default([]),
  completion_recommended: z.boolean().default(false),
  coverage: z.array(z.object({ requirement_key: z.string().max(32), acceptance_criterion_key: z.string().max(32), status: FindingType, evidence: z.string().min(1).max(1200) })).max(500).default([]),
});
export type ConvergenceOutput = z.infer<typeof ConvergenceOutputSchema>;

export const TaskReviewOutputSchema = z.object({
  summary: z.string().max(4000),
  recommended_decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  acceptance_coverage: z.array(z.object({ criterion_index: z.number().int().min(0), status: FindingType, evidence: z.string().min(1).max(1200) })).max(20),
  source_consistency: z.array(z.object({ requirement_key: z.string().max(32), status: z.enum(["CONSISTENT", "CONTRADICTED", "UNKNOWN"]), evidence: z.string().min(1).max(1200) })).max(40).default([]),
  findings: z.array(z.object({ severity: Severity, message: z.string().max(1000) })).max(30),
});

export const RiskLevelSchema = RiskLevel;

/**
 * Convert structured output schemas to JSON Schema for provider structured-output modes.
 * `io: "input"` describes what the model may SEND: fields with a `.default()`
 * stay optional (output mode would mark them required, and a model that
 * leaves one out would be told its valid answer is wrong).
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
}
