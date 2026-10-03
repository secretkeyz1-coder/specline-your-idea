/** Shared UI-side types mirroring @sdd/contracts payloads the API returns. */

export interface StackPackage {
  registry: "npm" | "pypi" | "crates" | "github";
  name: string;
}

/** A live registry check of a layer (mirrors StackVerificationSchema in @sdd/contracts). */
export interface StackVerification {
  status: "current" | "stale" | "deprecated" | "unknown";
  latest_version: string | null;
  released_at: string | null;
  checked_at: string;
  source_url: string | null;
  note: string | null;
}

export interface StackComponent {
  category: string;
  technology: string;
  version_constraint: string | null;
  rationale?: string;
  package?: StackPackage | null;
  verified?: StackVerification;
}

/** GET /stack/catalog: per-layer choices with their live release facts (null = registry still answering). */
export interface StackCatalog {
  reviewed_at: string;
  checked_at: string;
  layers: Array<{
    category: string;
    core: boolean;
    options: Array<{ id: string; name: string; package: StackPackage | null; note?: string; verified: StackVerification | null }>;
  }>;
}

export interface StackDecision {
  mode: "RECOMMENDED" | "MANUAL";
  candidates: Array<{
    name: string;
    layers: StackComponent[];
    tradeoffs: Array<{ dimension: string; assessment: string }>;
    fit_assessment?: string;
  }>;
  recommendation_index: number | null;
  rationale: string;
  conflicts: Array<{ category: string; finding: string; severity: string }>;
}

export interface TaskSummary {
  id: string;
  key: string;
  title: string;
  workflowStatus: string;
  taskType: string;
  hardness: number;
  riskLevel: string;
  priority: string;
  featureId: string | null;
  readinessStatus: string;
  readinessReport: { ok: boolean; checks: Array<{ id: string; label: string; ok: boolean; detail?: string }> };
  /** The contract lint's findings (ids such as "no_render_check"); absent on older servers. */
  lintFindings?: Array<{ id: string; severity: string; message: string }>;
  reviewPolicy: string;
}

export interface FeatureRow {
  id: string;
  key: string;
  title: string;
  description: string;
  status: string;
}

export interface BugRow {
  id: string;
  key: string;
  title: string;
  status: string;
  severity: string;
  currentBehavior: string;
  expectedBehavior: string;
  unchangedBehavior: string;
  reproduction: string;
  fixTaskId: string | null;
  createdAt: string;
}

export interface MachineRow {
  id: string;
  name: string;
  platform: string;
  status: string;
  lastSeenAt: string | null;
  capabilities: Record<string, unknown>;
}

/**
 * A check on the UI-reference plan or a drawn screen. `block` findings refuse
 * approval; `warn` findings are advice with context; `repair` marks what the
 * one automatic AI repair is asked to fix. Findings stored before categories
 * existed carry only `severity`.
 */
export interface UxFinding {
  rule: string;
  category?: "security" | "completeness" | "usability" | "integrity" | "guidance" | "instruction";
  action?: "block" | "warn";
  repair?: boolean;
  severity?: "P0" | "P1";
  message: string;
}

/** What a person's own page says about layout (mirrors LayoutBriefSchema in @sdd/contracts). */
export interface LayoutBrief {
  archetype: string;
  regions: Array<{ name: string; role: string }>;
  grid: string;
  density: "compact" | "comfortable" | "spacious";
  navigation: string;
  patterns: string[];
  emphasis: string;
  spacing: string;
  components: string[];
  kit_mapping: Array<{ pattern: string; kit: string }>;
  notes: string;
}

/** An analysed layout reference: screens follow its layout, never its content or look. */
export interface LayoutReference {
  name: string;
  brief: LayoutBrief;
  source_chars: number;
  digest: string;
  analysed_at: string;
  mode?: "layout" | "adapt";
  source_html?: string;
  source_css?: string;
  design_system?: DesignSystemSpec;
  notes?: string[];
}

/** One screen of the UI reference ("ux" artifact); html is null until generated. */
export interface UxScreen {
  key: string;
  name: string;
  purpose: string;
  requirement_keys: string[];
  key_elements: string[];
  screen_type?: "dashboard" | "list" | "detail" | "form" | "settings" | "board" | "analytics";
  overlays?: Array<{ kind: "dialog" | "sheet" | "confirm"; name: string; purpose: string; result?: string }>;
  /** The main view's primary action and what happens after it. */
  primary_action?: { label: string; result: string };
  /** Every state that matters for the screen; at most two are drawn. */
  states?: Array<{ state: string; when: string; response: string }>;
  /** The screen's composition plan: focus, arrangement, density, media, adaptation per device. */
  layout_note?: string;
  /** This screen's own layout reference, instead of the reference's one. */
  layout_reference?: LayoutReference;
  /** Digest of the layout reference the drawing followed (null: none); absent on older drawings. */
  drawn_with_layout?: string | null;
  html: string | null;
  revision_note?: string;
  lint?: UxFinding[];
  history?: Array<{ content: string; at: string; note: string }>;
  comments?: UxComment[];
  /** A person's visual review of the drawing; `outdated` once the drawing changed since. */
  visual_review?: UxVisualReview & { outdated?: boolean };
  /** The last AI drawing's model, limits, token use, truncation, time and repair. */
  generation?: UxGenerationRecord;
  /** False when no render check describes this drawing (not run, or the drawing changed since); absent on older reads. */
  render_checked?: boolean;
}

/** The aspects of a visual review of a rendered screen (mirrors UxReviewAspect, aturan.md §5.6). */
export type UxReviewAspect = "focus" | "composition" | "hierarchy" | "product_fit" | "devices";
export type UxReviewStatus = "ok" | "revise" | "unchecked";

/** A person's visual review of one drawing: input for a decision, never a score or a blocker. */
export interface UxVisualReview {
  aspects: Array<{ aspect: UxReviewAspect; status: UxReviewStatus; element: string; change: string }>;
  reviewed_at: string;
  html_digest: string;
}

/** What one AI drawing cost and how it ended (mirrors UxGenerationRecord, aturan.md §5.7). */
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

/** The product's visual brief (mirrors UxVisualBriefSchema, aturan.md §4 Lapis 1). */
export interface UxVisualBrief {
  users: string;
  devices: string;
  direction: string;
  hierarchy: string;
  references: string;
  /** What the plan assumed because the requirements did not say — to review. */
  assumptions: string[];
  source: "ai" | "user";
}

/** How the web shell navigates; absent on older references: the side navigation. */
export type UxShellLayout = "sidebar" | "topnav" | "minimal";

/** A review comment pinned to one element of a UI-reference screen. */
export interface UxComment {
  id: string;
  nid: string | null;
  anchor: string;
  text: string;
  author_id: string;
  created_at: string;
  resolved_at: string | null;
}

/**
 * How a UI reference's screens are drawn (mirrors UxGenerator in @sdd/contracts).
 * "kit": the model writes <main> with the ds-* kit inside the platform's shell.
 * "od": open-design style — the model writes the whole body from a seed template;
 * the parts carry UX_OD_MARKERS (lib/ux-canvas.ts) instead of kit classes.
 */
export type UxGenerator = "kit" | "od";

/** A device a UI reference is drawn for (mirrors UxDevice in @sdd/contracts). */
export type UxDevice = "desktop" | "phone" | "tablet-landscape" | "tablet-portrait";

/** Web app or native mobile app, and its target devices, primary first (mirrors UxPlatformSchema). */
export interface UxPlatform {
  kind: "web" | "native-mobile";
  /** Native OS whose conventions the screens follow; null for web. Android only for now. */
  os: "android" | null;
  devices: UxDevice[];
  source: "detected" | "user";
  /** What it was read from: the stack layers and requirement words. */
  reason: string;
}

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
  /** Neutral greyscale, or drawn with the approved design system. */
  fidelity?: "neutral" | "styled";
  design_system_version?: number | null;
  /** Checks on the screen plan (a busy screen, uncovered requirements), after its one repair turn. */
  plan_lint?: UxFinding[];
  /** The person's count could not serve every visible P0 requirement. */
  count_conflict?: { uncovered: string[]; minimum_count: number; note: string };
  /** What is left out because it would need more than 12 screens. */
  uncovered_scope?: string[];
  /** When the person accepted the left-out scope; approval needs it when either of the two above is set. */
  scope_confirmed_at?: string | null;
  rules_version?: number;
  /** The person's own page every screen follows for layout (a screen may have its own). */
  layout_reference?: LayoutReference | null;
  /** What the screens are drawn as; absent on older references (a web app). */
  platform?: UxPlatform;
  /** The shell's utilities and, for web, how it navigates. */
  shell?: { layout?: UxShellLayout; search?: boolean; notifications?: boolean; account?: boolean; reason?: string };
  /** The product's visual brief; absent on references planned before it. */
  brief?: UxVisualBrief;
  /** How the screens are drawn: the ds-* kit in a platform shell ("kit", also when absent) or open-design style ("od"). */
  generator?: UxGenerator;
  /** The example data every screen shares (records, people, notes). */
  sample_data?: {
    records: Array<{ kind: string; name: string; facts: string }>;
    people: Array<{ name: string; role: string }>;
    notes: string;
    statuses?: Array<{ label: string; tone: "success" | "warn" | "danger" | "info" | "accent" | "neutral" }>;
    aggregates?: Array<{ label: string; value: string; basis: string }>;
  };
}

interface UxRevisionView {
  revision_id: string;
  version: number;
  approved_at: string | null;
  reference: UxReference | null;
}

/** GET /projects/:id/ux */
export interface UxState {
  design_approved: boolean;
  approved: UxRevisionView | null;
  draft: UxRevisionView | null;
  /** The reference was approved against a design that has since changed. */
  stale: boolean;
  /** Stale only because its design system changed: its screens can be kept and drawn again. */
  stale_plan: { version: number; screens: number; fidelity: "neutral" | "styled" } | null;
  /** What the approved stack and requirements say the screens should be drawn as (web or Android, which devices). */
  detected_platform?: UxPlatform;
  /** Styled references: the fonts the design system asks for, the one mockups show, and whether that is a fallback. */
  fonts?: { requested: string[]; shown: string; fallback: boolean } | null;
}

/* ── Design system (mirrors @sdd/contracts design-system.ts) ── */

export const DS_COLOR_TOKENS = ["bg", "surface", "surface2", "fg", "fgMuted", "border", "borderStrong", "accent", "accentFg", "success", "warn", "danger", "info"] as const;
export type DsColorToken = (typeof DS_COLOR_TOKENS)[number];
export type DsPalette = Record<DsColorToken, string>;
export type DsDensity = "compact" | "comfortable" | "spacious";
export type DsDepth = "flat" | "hairline" | "soft" | "hard";

export interface DesignSystemSpec {
  preset_id: string;
  name: string;
  summary: string;
  light: DsPalette;
  dark: DsPalette;
  fonts: { display: string; body: string; mono: string };
  radius: number;
  density: DsDensity;
  depth: DsDepth;
  border_width: number;
  component_library: string;
  guidance: string;
  /** The visual direction it follows, if any (its posture rules go to the agent). */
  direction?: DsDirectionId;
  /** Structural scale overrides; derived from density, radius and direction when absent. */
  scale?: DsScale;
}

/** The five visual directions adopted from open-design. */
export type DsDirectionId = "editorial-monocle" | "modern-minimal" | "human-approachable" | "tech-utility" | "brutalist-experimental";

/** Structural scale overrides (mirrors DsScaleSchema): every field optional, derived when absent. */
export interface DsScale {
  text?: Partial<Record<"xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl", number>>;
  leading_body?: number;
  leading_tight?: number;
  tracking_display?: number;
  section_y?: Partial<Record<"desktop" | "tablet" | "phone", number>>;
  container_max?: number;
  gutter?: Partial<Record<"desktop" | "tablet" | "phone", number>>;
  motion?: Partial<Record<"fast" | "base", number>>;
}

/** One visual direction, ready to start a spec from. */
export interface DsDirection {
  id: DsDirectionId;
  label: string;
  mood: string;
  references: string[];
  posture: string[];
  fonts: { display: string; body: string; mono: string };
  light: DsPalette;
  dark: DsPalette;
}

export type DsTokenLayer = "A1-identity" | "A1-structure" | "A2" | "B-slot" | "extension";
export type DsConfidenceLevel = "high" | "medium" | "alias" | "fallback" | "low";

export interface DsTokenConfidence {
  token: string;
  layer: DsTokenLayer;
  confidence: DsConfidenceLevel;
  from?: string;
}

/** The import's token report (open-design importer): per-token confidence, a 0–100 score and its grade. */
export interface DsImportConfidence {
  tokens: DsTokenConfidence[];
  score: number;
  grade: "excellent" | "usable" | "needs-review" | "needs-rebuild";
  recommend_rebuild: boolean;
}

/** The design-system package the agent gets. */
export interface DsPackage {
  files: Array<{ path: string; role: "usage" | "design" | "tokens" | "design-tokens" | "craft" | "other"; content: string }>;
}

export type DesignSystemPreset = Omit<DesignSystemSpec, "component_library" | "preset_id"> & { id: string; tags: string[] };

export interface ComponentLibraryInfo {
  id: string;
  name: string;
  summary: string;
  frameworks: string[];
  license: string;
  url: string;
}

export interface DsContrastCheck {
  mode: "light" | "dark";
  pair: string;
  foreground: DsColorToken;
  background: DsColorToken;
  ratio: number;
  minimum: number;
  ok: boolean;
}

interface DesignSystemRevisionView {
  revision_id: string;
  version: number;
  approved_at: string | null;
  spec: DesignSystemSpec | null;
  library_name: string | null;
}

/** GET /projects/:id/design-system */
export interface DesignSystemState {
  stack_approved: boolean;
  suggestions: Array<{ library_id: string; reason: string }>;
  approved: DesignSystemRevisionView | null;
  draft: DesignSystemRevisionView | null;
  stale: boolean;
}
