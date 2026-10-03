import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { TaskPlanSchema, TaskContractSchema, type DesignArtifact, type TaskContract, type TaskPlan, type UxReference, type UxScreen } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, TASK_DECOMPOSITION_SYSTEM_PROMPT } from "@sdd/ai";
import { createTask, getTask, listTasks, validateProjectGraph, type TaskRow } from "./repo.js";
import { deriveTaskRisk, hasRenderCheck, missingKeyElements, screenFilesOf, SHELL_TITLE } from "./lint.js";
import { getApprovedRevision, structuredOf } from "../artifact/service.js";
import { listRequirementsForRevision } from "../planning/requirements.js";
import { listStackComponents } from "../planning/stack.js";
import { requireApprovedDesign } from "../planning/design.js";
import { approvedUxReference, nativeFramework, uxFilePath } from "../ux/ux.js";
import { isAuthScreen } from "../ux/ux-od-seeds.js";
import { approvedDesignSystem, designSystemBrief } from "../design-system/service.js";
import { DESIGN_SYSTEM_DIR } from "../design-system/exports.js";
import { findLibrary } from "../design-system/libraries.js";
import { getProject, projectRulesLines, updateLifecycle } from "../project/service.js";
import { audit } from "../audit/service.js";
import { publish, topics } from "../../events/bus.js";
import { computeTaskReadiness, loadReadinessBaseline } from "./readiness.js";
import { parseVerificationCommand } from "@sdd/contracts";
import type { RequirementsArtifact } from "@sdd/contracts";
import { productContext, contradictsOutcome } from "../planning/quality.js";
import { PlanQualitySchema, PLAN_QUALITY_PROMPT, planQualityIssues } from "./plan-quality.js";

/** Task generation (T083/T084): the approved spec → the decomposer's context → a persisted task plan. */

/* ── Generation (T083/T084) ── */

/**
 * The approved design as the decomposer sees it. Every section goes in: the
 * prompt asks for verification commands, env vars, ports and paths "exactly as
 * the design names them", and those live in the testing, deployment and
 * layout sections — sending only the overview made the model invent them.
 * Each field is length-capped by DesignArtifactSchema, so the whole is bounded.
 */
export function designContextLines(design: DesignArtifact | null): string[] {
  if (!design) return ["APPROVED DESIGN: (no structured content)"];
  const section = (title: string, body: string | undefined) => (body?.trim() ? ["", `${title}:`, body.trim()] : []);
  // Stored revisions can predate a field (the schema grew over time), so
  // every read tolerates its absence.
  const decisions = design.unresolved_decisions ?? [];
  const blocking = decisions.filter((d) => d.blocking);
  const open = decisions.filter((d) => !d.blocking);
  return [
    "DESIGN OVERVIEW:",
    design.overview ?? "",
    design.architecture?.summary ?? "",
    ...section("PROJECT LAYOUT AND RUNTIME", design.architecture?.diagram_text),
    "",
    "COMPONENTS:",
    ...(design.components ?? []).map((c) => `- ${c.name}: ${c.responsibility}${c.interfaces ? `\n  interfaces: ${c.interfaces}` : ""}`),
    ...section("DATA MODEL", design.data_model),
    ...section("API CONTRACTS", design.api_contracts),
    ...section("STATE MACHINES", design.state_machines),
    ...section("SECURITY", design.security),
    ...section("TESTING STRATEGY (verification commands use this test runner, command and file layout verbatim)", design.testing_strategy),
    ...section("DEPLOYMENT (env var names, ports, build and start commands — quote them verbatim)", design.deployment),
    ...section("REQUIRED DELIVERY CHECKS (each has an owning task, exact command, output paths and outcome)", JSON.stringify(design.delivery_checks ?? [])),
    ...(blocking.length || open.length
      ? [
          "",
          "UNRESOLVED DECISIONS (do not decide them inside a task; a task that depends on one lists it in stop_conditions):",
          ...blocking.map((d) => `- [blocking] ${d.description}`),
          ...open.map((d) => `- ${d.description}`),
        ]
      : []),
  ];
}

/**
 * The sentence a screen-building task carries in its constraints. It depends
 * on what was approved: a fixed "styling follows the stack" contradicted an
 * approved design system and a styled reference whose look is binding. For a
 * native mobile reference (`native` names the stack's UI framework) the
 * screens are built in that framework: the HTML mockup is a picture, not code.
 */
export function screenConstraint(styled: boolean, hasDesignSystem: boolean, native: string | null = null): string {
  return `${screenLook(styled, hasDesignSystem, native)}; ${IN_SHELL}`;
}

/**
 * Where a screen renders. FiberOptik's screen tasks each built a full-screen
 * page with no navigation: the shell existed only in the decomposer's request,
 * never in the task a builder reads (docs/28 R4).
 */
const IN_SHELL = "it renders inside the app shell, no full-screen wrapper or navigation of its own (unless listed outside the shell)";

function screenLook(styled: boolean, hasDesignSystem: boolean, native: string | null): string {
  if (native) {
    const build = `Layout, elements and flow follow <file>; build them as ${native} screens (Android, Material 3) — the HTML mockup is a visual reference, not code`;
    if (styled) return `${build}; the look follows the design system in ${DESIGN_SYSTEM_DIR}/`;
    if (hasDesignSystem) return `${build}; visual styling follows ${DESIGN_SYSTEM_DIR}/DESIGN.md`;
    return `${build}; visual styling follows the stack's Material 3 theme`;
  }
  if (styled) return `Layout, elements, flow and look follow <file>, drawn with the design system in ${DESIGN_SYSTEM_DIR}/`;
  if (hasDesignSystem) return `Layout, elements and flow follow <file>; visual styling follows ${DESIGN_SYSTEM_DIR}/DESIGN.md`;
  return "Layout, elements and flow follow <file>; visual styling follows the stack";
}

/**
 * The approved UI reference and design system a task plan was built with,
 * as lineage refs: a later change to either is checked against these tasks
 * (their readiness), instead of going unnoticed.
 */
async function usedUiRefs(db: DbExecutor, projectId: string, used: { ux: boolean; ds: boolean }) {
  const refs: Array<{ artifact_id: string; version: number }> = [];
  for (const [type, on] of [["ux", used.ux], ["design_system", used.ds]] as const) {
    const approved = on ? await getApprovedRevision(db, projectId, type) : null;
    if (approved) refs.push({ artifact_id: approved.artifact.id, version: approved.revision.version });
  }
  return refs;
}

/**
 * What a UI reference screen asks the builder to make work, beyond how it
 * looks: the primary action and each overlay with its result, and every state.
 * A mockup shows a dialog; it cannot show that the dialog works — that is
 * built and tested in the task (aturan.md §6.5).
 */
export function screenBehaviourLines(s: Pick<UxScreen, "primary_action" | "overlays" | "states">): string[] {
  const lines: string[] = [];
  if (s.primary_action?.label) lines.push(`primary action "${s.primary_action.label}"${s.primary_action.result ? ` → ${s.primary_action.result}` : ""}`);
  for (const o of s.overlays ?? []) lines.push(`${o.kind} "${o.name}"${o.result ? ` → ${o.result}` : ""}`);
  for (const st of s.states ?? []) lines.push(`state "${st.state}"${st.when ? ` (${st.when})` : ""}${st.response ? `: ${st.response}` : ""}`);
  return lines;
}

/**
 * The shell every screen of the approved UI reference shares: how it
 * navigates, its destinations in order and the utilities it shows. Without
 * it in the request, plans build screens as standalone pages.
 */
/** The UI reference's explicit visual overrides must survive decomposition and the local build prompt. */
export function templateAppearanceLines(ux: UxReference | null): string[] {
  if (!ux || ux.fidelity !== "styled") return [];
  const screens = ux.screens.flatMap(screen => {
    const template = screen.layout_reference ?? ux.layout_reference;
    if (template?.mode !== "adapt" || !template.design_system) return [];
    const ds = template.design_system;
    return [`- ${uxFilePath(screen.key)}: template ${template.name}; body ${ds.fonts.body}; display ${ds.fonts.display}; primary ${ds.light.accent}; page ${ds.light.bg}; card ${ds.light.surface}; radius ${ds.radius}px; density ${ds.density}.`];
  });
  return screens.length ? ["TEMPLATE APPEARANCE OVERRIDES (approved through UI Reference): these screens use their template-derived visual system instead of the base project palette. Read the effective light/dark tokens in their rendered HTML and implement a shared theme with per-screen overrides where needed; retain the approved component library, functional requirements and permissions. Do not revert these screens to the base design-system colours/fonts.", ...screens] : [];
}

export function appShellLine(ux: Pick<UxReference, "screens" | "shell" | "platform" | "generator">): string {
  const native = ux.platform?.kind === "native-mobile";
  const layout = ux.shell?.layout ?? "sidebar";
  const form = native
    ? "Android app chrome: a top app bar with the screen title, a bottom navigation bar on phones (at most 5 destinations, the rest under More) and a navigation rail on tablets"
    : layout === "topnav"
      ? "a top navigation bar across the header with the brand on the left"
      : layout === "minimal"
        ? "a minimal header with the brand and the screen title, no persistent navigation (screens link to each other from their content)"
        : "a side navigation (sidebar) with the brand at the top, collapsing to a menu on small screens, and a header with the current screen's title";
  const isSettings = (s: { name: string; screen_type?: string | null }) => s.screen_type === "settings" || /setting|pengaturan/i.test(s.name);
  const inApp = ux.screens.filter((s) => !isAuthScreen(s));
  const ordered = [...inApp.filter((s) => !isSettings(s)), ...inApp.filter(isSettings)];
  const outside = ux.screens.filter((s) => isAuthScreen(s));
  // Older references without shell flags were drawn with every utility.
  const legacyFull = !ux.shell;
  const utilities = [
    (legacyFull || ux.shell?.search) && "global search",
    (legacyFull || ux.shell?.notifications) && "notifications",
    (legacyFull || ux.shell?.account) && "the signed-in user's menu with visible identity and sign-out/session invalidation",
  ].filter(Boolean);
  return [
    `APP SHELL (shared by in-app screens only — build it once): ${form}.`,
    `  destinations, in order: ${ordered.map((s) => `${s.name} (${uxFilePath(s.key)})`).join(", ")}`,
    `  utilities: ${utilities.length ? utilities.join(", ") : "none beyond the brand"}`,
    ...(ux.shell?.reason ? [`  utility requirements: ${ux.shell.reason}`] : []),
    ...(outside.length ? [`  outside the shell (no navigation; they lead into the app): ${outside.map((s) => `${s.name} (${uxFilePath(s.key)})`).join(", ")}`] : []),
    "  in-app screen files show this shell; screens listed outside the shell never show its navigation or signed-in utilities",
  ].join("\n");
}

type PlanTask = { ref?: string; title: string; objective?: string; task_type?: string; constraints?: string[]; ui_screen_keys?: string[]; depends_on_refs?: string[] };

/**
 * Whether a plan has the task that builds the shared application shell: a
 * front-end task that says so in its title, builds no screen itself, and —
 * when the plan has screen tasks — is one they depend on. Matching the
 * objective too took "a responsive layout" for a shell.
 */
export function hasShellTask(plan: { tasks: PlanTask[] }): boolean {
  const screenTasks = plan.tasks.filter((t) => screenFilesOf(t).length > 0);
  return plan.tasks.some(
    (t) =>
      (t.task_type === "frontend" || t.task_type === "ui" || t.task_type === "code") &&
      SHELL_TITLE.test(t.title) &&
      screenFilesOf(t).length === 0 &&
      (screenTasks.length === 0 || screenTasks.every((s) => t.ref !== undefined && (s.depends_on_refs ?? []).includes(t.ref))),
  );
}

export const SHELL_REPAIR_INSTRUCTION = [
  "Your plan has no task for the APPLICATION SHELL in the APP SHELL line, so every screen would be built as a standalone page with no navigation.",
  "Add one front-end task that builds that shell (navigation with every listed destination in order, the brand, the utilities, responsive behaviour) as the layout every screen renders inside;",
  "it depends on the design-system setup task, and make every task that builds a screen depend on it and render inside it.",
].join(" ");

/** Where render tests and their screenshots live in the built repository; screenshots sit next to the mockups they are compared with. */
export const RENDER_TEST_DIR = "e2e/render";
export const RENDER_SHOT_DIR = "docs/ui-reference/renders";

/**
 * How a screen task proves its screen renders. FiberOptik's screen tasks all
 * passed jsdom tests while no page loaded the design system at all — the root
 * layout did not exist (docs/28 R1). Web only: a native screen has no browser
 * route to open.
 */
export function renderCheckLine(ux: Pick<UxReference, "screens" | "platform">): string | null {
  if (ux.platform?.kind === "native-mobile") return null;
  const example = ux.screens.find((s) => !isAuthScreen(s)) ?? ux.screens[0];
  return [
    `RENDER CHECK (a required verification of every task that builds a screen): a Playwright test ${RENDER_TEST_DIR}/<screen key>.spec.ts that opens the screen's route at 1280×800 and at 360×800, asserts that each of the screen's key elements is visible (and, for a screen inside the shell, the shell navigation), and saves ${RENDER_SHOT_DIR}/<screen key>-1280.png and -360.png.`,
    `  a screen behind sign-in signs in first, with the test user or session fixture the testing strategy names (create one in the setup if it names none), and the test seeds or stubs the data its key elements need — an empty table hides its rows`,
    `  run it with the project's package runner, e.g. "npx playwright test ${RENDER_TEST_DIR}/${example?.key ?? "dashboard"}.spec.ts"; a jsdom or unit test is not a render check`,
  ].join("\n");
}

/** The refs of a plan's screen tasks that have no render check. */
export function missingRenderChecks(plan: { tasks: Array<PlanTask & { verification?: { required?: Array<{ type?: string; command: string }> } }> }): string[] {
  return plan.tasks.filter((t) => screenFilesOf(t).length > 0 && !hasRenderCheck(t)).map((t) => t.ref ?? t.title);
}

export function renderRepairInstruction(refs: string[]): string {
  return [
    `These tasks build a screen but have no RENDER CHECK: ${refs.join(", ")}.`,
    "Give each one a required verification command that runs its Playwright render test as the RENDER CHECK line describes, and automated_tests in its deliverables;",
    "the design-system setup task installs Playwright and its Chromium browser with a config whose webServer starts the app and stops it when the tests end, and a sign-in fixture the render tests share.",
  ].join(" ");
}

/** What a first plan lacks that one repair turn can add: the shell task and the screens' render checks. */
export function planGaps(plan: TaskPlan, ux: UxReference | null): { shell: boolean; unchecked: string[] } {
  if (!ux?.applicable) return { shell: false, unchecked: [] };
  return {
    shell: ux.screens.length > 1 && !hasShellTask(plan),
    unchecked: renderCheckLine(ux) ? missingRenderChecks(plan) : [],
  };
}

export function repairInstruction(gaps: { shell: boolean; unchecked: string[] }): string | null {
  const parts = [gaps.shell ? SHELL_REPAIR_INSTRUCTION : null, gaps.unchecked.length ? renderRepairInstruction(gaps.unchecked) : null].filter(Boolean);
  return parts.length ? [...parts, "Keep every other task as it is. Return the complete TaskPlan."].join(" ") : null;
}

/** Validate completeness against the actual approved baseline, not merely the JSON shape. */
export function taskPlanIssues(plan: TaskPlan, requirements: Array<{ key: string; statement?: string; acceptance_criteria: Array<{ key: string; statement?: string }> }>, ux: UxReference | null, design?: DesignArtifact | null): string[] {
  const issues: string[] = [];
  const reqs = new Map(requirements.map(r => [r.key, r]));
  for (const t of plan.tasks) {
    if (!["infrastructure", "documentation", "research"].includes(t.task_type) && (!t.feature_hint || !t.requirement_keys.length)) issues.push(`${t.ref}: feature and requirement links required`);
    for (const key of t.requirement_keys) if (!reqs.has(key)) issues.push(`${t.ref}: unknown requirement ${key}`);
    for (const key of t.requirement_keys) {
      const source = reqs.get(key);
      for (const criterion of [source?.statement, ...(source?.acceptance_criteria.filter(ac => t.acceptance_criterion_keys.includes(ac.key)).map(ac => ac.statement) ?? [])].filter((s): s is string => Boolean(s))) if ([t.objective, ...t.acceptance_criteria].some(local => contradictsOutcome(criterion, local))) issues.push(`${t.ref}: contradicts source outcome ${key}`);
    }
    for (const key of t.acceptance_criterion_keys) if (!t.requirement_keys.some(r => reqs.get(r)?.acceptance_criteria.some(ac => ac.key === key))) issues.push(`${t.ref}: unknown acceptance criterion ${key}`);
    for (const check of t.verification.required) if (check.type !== "manual") {
      const parsed = parseVerificationCommand(check.command);
      if (!parsed.ok) issues.push(`${t.ref}: ${parsed.reason}`);
    }
  }
  for (const check of design?.delivery_checks ?? []) {
    const owners = plan.tasks.filter(t => t.verification.required.some(v => v.type !== "manual" && v.command.trim() === check.command.trim()));
    if (!owners.length) issues.push(`No task verifies delivery ${check.purpose}: ${check.command}`);
    for (const path of check.expected_paths) if (!plan.tasks.some(t => t.scope.expected_paths.includes(path))) issues.push(`No task owns delivery output ${path}`);
  }
  for (const r of requirements) {
    const tasks = plan.tasks.filter(t => t.requirement_keys.includes(r.key));
    if (!tasks.length) issues.push(`${r.key}: no implementing task`);
    for (const ac of r.acceptance_criteria) if (!tasks.some(t => t.acceptance_criterion_keys.includes(ac.key))) issues.push(`${r.key}/${ac.key}: no implementing task`);
  }
  if (ux?.applicable) {
    for (const screen of ux.screens) if (!plan.tasks.some(t => screenFilesOf(t).includes(uxFilePath(screen.key)))) issues.push(`${screen.key}: no screen task`);
    for (const t of plan.tasks) for (const file of screenFilesOf(t)) {
      const screen = ux.screens.find(s => uxFilePath(s.key) === file);
      if (!screen) issues.push(`${t.ref}: unknown UI screen ${file}`);
      else {
        const missing = missingKeyElements(screen.key_elements, t.acceptance_criteria);
        if (missing.length) issues.push(`${t.ref}: missing screen elements ${missing.join(", ")}`);
      }
    }
    const gap = planGaps(plan, ux);
    if (gap.shell) issues.push(SHELL_REPAIR_INSTRUCTION);
    if (gap.unchecked.length) issues.push(renderRepairInstruction(gap.unchecked));
    for (const task of plan.tasks) if (SHELL_TITLE.test(task.title) && !screenFilesOf(task).length && renderCheckLine(ux) && !hasRenderCheck(task)) issues.push(`${task.ref}: application shell needs a bounded render/utility test on an in-app route`);
  }
  return issues;
}

export async function generateTasks(
  gateway: GatewayDeps,
  db: import("@sdd/db").SddDatabase,
  input: { projectId: string; userId: string; featureId?: string | null },
) {
  const project = await getProject(db, input.projectId);
  const design = await requireApprovedDesign(db, input.projectId);
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  if (!approvedReq) throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Requirements must be approved to generate tasks");
  const approvedStack = await getApprovedRevision(db, input.projectId, "stack");
  if (!approvedStack) throw errors.conflict("STACK_NOT_APPROVED", "The stack baseline must be approved to generate tasks");

  const requirements = await listRequirementsForRevision(db, approvedReq.revision.id);
  // Stack components hang off the STACK revision (not the design revision —
  // that lookup always returned an empty stack to the decomposer).
  const stackRows = await listStackComponents(db, approvedStack.revision.id);
  const ux = await approvedUxReference(db, input.projectId);
  const ds = await approvedDesignSystem(db, input.projectId);
  const context = [
    `PROJECT: ${project.name}`,
    "",
    "APPROVED STACK:",
    ...stackRows.map((s) => `- ${s.category}: ${s.technology} ${s.versionConstraint ?? ""}`),
    ...productContext(approvedReq.revision.structuredContent as RequirementsArtifact),
    ...projectRulesLines(project.projectRules, "every task must respect them"),
    "",
    ...designContextLines(structuredOf<DesignArtifact>(design.revision)),
    "",
    "REQUIREMENTS (cover every requirement and every acceptance criterion key, including setup and test tasks):",
    ...requirements.map(
      (r) =>
        `- ${r.key} [${r.priority}] ${r.title}\n  ${r.statement}\n${r.acceptance_criteria.map((ac) => `  · ${ac.key} (${ac.verificationType}): ${ac.statement}`).join("\n")}`,
    ),
    ...(ux
      ? [
          "",
          ux.fidelity === "styled"
            ? "APPROVED UI REFERENCE (layout, elements, flow and look are binding; drawn with the design system below):"
            : "APPROVED UI REFERENCE (layout, elements and flow are binding; styling follows the design system or the stack):",
          `Screen constraint sentence (put it in the constraints of every task that builds a screen, with that screen's file in place of <file>): "${screenConstraint(ux.fidelity === "styled", Boolean(ds), ux.platform?.kind === "native-mobile" ? (nativeFramework(stackRows) ?? "native Android") : null)}"`,
          ...ux.screens.map((s) => {
            const behaviour = screenBehaviourLines(s);
            return (
              `- ${uxFilePath(s.key)} — ${s.name}: ${s.purpose}\n  requirements: ${s.requirement_keys.join(", ") || "-"}\n  key elements: ${s.key_elements.join("; ")}` +
              (behaviour.length ? `\n  behaviour to build and test: ${behaviour.join("; ")}` : "")
            );
          }),
          appShellLine(ux),
          ...(renderCheckLine(ux) ? [renderCheckLine(ux)!] : []),
          "The mockups prove how screens look, not that they work: a task that builds a screen puts its behaviour above (keyboard and focus in dialogs and sheets, validation messages, what happens after each action, each state) in its acceptance criteria and checks it with a test.",
        ]
      : []),
    ...(ds
      ? [
          "",
          `APPROVED ${designSystemBrief(ds.spec)}`,
          `The first front-end task sets the design system up: install ${findLibrary(ds.spec.component_library)?.name ?? "the component library"}, apply the theme file from ${DESIGN_SYSTEM_DIR}/ and load tokens.css — its checks include that light and dark mode render.`,
          "UI tasks name the library components they use and must not hard-code colours or fonts.",
        ]
      : []),
    ...templateAppearanceLines(ux),
  ].join("\n");

  const ask = {
    workspaceId: project.workspaceId,
    projectId: project.id,
    role: "TASK_DECOMPOSITION" as const,
    schema: TaskPlanSchema,
    schemaName: "TaskPlan",
    system: TASK_DECOMPOSITION_SYSTEM_PROMPT,
  };
  let result = await runStructured(gateway, { ...ask, messages: [{ role: "user", content: context }] });
  // A large plan can need a second correction. Each turn repairs the latest
  // schema-valid plan; persistence still requires every baseline check to pass.
  const planIssues = async (plan: TaskPlan) => {
    const structural = taskPlanIssues(plan, requirements, ux, structuredOf<DesignArtifact>(design.revision));
    if (structural.length) return structural;
    const quality = await runStructured(gateway, { workspaceId: project.workspaceId, projectId: project.id, role: "TASK_DECOMPOSITION", schema: PlanQualitySchema, schemaName: "PlanQuality", system: PLAN_QUALITY_PROMPT, maxTokens: Math.max(4096, Math.min(24000, requirements.reduce((n, r) => n + r.acceptance_criteria.length, 0) * 90)), messages: [{ role: "user", content: `${context}\nPROPOSED TASK PLAN:\n${JSON.stringify(plan)}` }] });
    return planQualityIssues(plan, requirements, quality.data);
  };
  let remainingIssues = await planIssues(result.data);
  for (let attempt = 0; attempt < 2 && remainingIssues.length; attempt++) {
    try {
      const repaired = await runStructured(gateway, {
        ...ask,
        messages: [
          { role: "user", content: context },
          { role: "assistant", content: JSON.stringify(result.data) },
          { role: "user", content: `Fix these plan validation errors: ${remainingIssues.join("\n")}. Keep correct tasks and return the complete TaskPlan.` },
        ],
      });
      result = repaired;
      remainingIssues = await planIssues(result.data);
    } catch {
      // A provider/schema failure stops correction; invalid plans never persist.
      break;
    }
  }

  if (remainingIssues.length) throw errors.conflict("TASK_PLAN_INVALID", "Task plan does not cover the approved specification", { issues: remainingIssues });

  const plan = await persistTaskPlan(db, {
    projectId: input.projectId,
    userId: input.userId,
    plan: result.data,
    revisionRefs: [
      { artifact_id: design.artifact.id, version: design.revision.version },
      { artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version },
      { artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version },
      // The UI reference and design system the plan was built with, when it used them: a change to either is checked against these tasks.
      ...(await usedUiRefs(db, input.projectId, { ux: Boolean(ux), ds: Boolean(ds) })),
    ],
  });

  // Auto-approve (product decision: no manual per-task approval gate). Every
  // generated task that passes readiness goes straight to READY so the whole
  // plan lands on the execution board immediately. Deliberately scoped to
  // DECOMPOSED plans only — manually created tasks stay DRAFT so their one-time
  // authoring review (C6/C9 lineage) stays a conscious act. Dependency ordering
  // is enforced at claim time, not here.
  let autoReadied = 0;
  const leftDraft: string[] = [];
  const graph = await validateProjectGraph(db, input.projectId);
  const baseline = await loadReadinessBaseline(db, input.projectId);
  for (const task of plan.createdTasks) {
    const row = await getTask(db, task.id);
    const refreshed = await computeTaskReadiness(db, row, graph, baseline);
    if (refreshed.readinessStatus === "READY") {
      await db
        .update(schema.tasks)
        .set({ workflowStatus: "READY", updatedAt: new Date() })
        .where(eq(schema.tasks.id, task.id));
      autoReadied += 1;
      await audit(db, {
        workspaceId: project.workspaceId,
        projectId: input.projectId,
        actorType: "SYSTEM",
        actorId: input.userId,
        source: "SYSTEM",
        action: "task.readied",
        entityType: "TASK",
        entityId: task.id,
        metadata: { key: task.key, auto: true },
      });
      publish({ topic: topics.project(input.projectId), type: "task_transitioned", payload: { task_id: task.id, from: "DRAFT", to: "READY" } });
    } else {
      leftDraft.push(task.key);
    }
  }

  await updateLifecycle(db, input.projectId, "TASK_GENERATION");
  return { plan: result.data, ...plan, autoReadied, leftDraft };
}

export async function persistTaskPlan(
  db: import("@sdd/db").SddDatabase,
  input: {
    projectId: string;
    userId: string;
    plan: import("@sdd/contracts").TaskPlan;
    revisionRefs: Array<{ artifact_id: string; version: number }>;
  },
) {
  // One transaction: a failed generation must not leave partial tasks/features.
  return db.transaction(async (tx) => {
    const db = tx;
  input.plan = TaskPlanSchema.parse(input.plan);
  const project = await getProject(db, input.projectId);
  // Features (upsert by key)
  const featureByKey = new Map<string, string>();
  // A feature no task belongs to has no work behind it; creating it only
  // leaves an empty card that can never be checked or completed.
  const usedFeatureKeys = new Set(input.plan.tasks.map((t) => t.feature_hint).filter(Boolean));
  for (const f of input.plan.features) {
    if (!usedFeatureKeys.has(f.key)) continue;
    const [existing] = await db
      .select()
      .from(schema.features)
      .where(and(eq(schema.features.projectId, input.projectId), eq(schema.features.key, f.key)))
      .limit(1);
    if (existing) {
      featureByKey.set(f.key, existing.id);
    } else {
      const [feature] = await db
        .insert(schema.features)
        .values({ projectId: input.projectId, key: f.key, title: f.title, description: f.description, status: "PLANNING" })
        .returning();
      featureByKey.set(f.key, feature!.id);
    }
  }

  // Requirement lookup by key (active approved revision).
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  const requirementByKey = new Map<string, { id: string; acs: Map<string, string> }>();
  if (approvedReq) {
    const reqs = await listRequirementsForRevision(db, approvedReq.revision.id);
    for (const r of reqs) {
      requirementByKey.set(r.key, { id: r.id, acs: new Map(r.acceptance_criteria.map((ac) => [ac.key, ac.id])) });
    }
  }

  const approvedRequirements = approvedReq ? await listRequirementsForRevision(db, approvedReq.revision.id) : [];
  const approvedDesign = await getApprovedRevision(db, input.projectId, "design");
  const planIssues = taskPlanIssues(input.plan, approvedRequirements, await approvedUxReference(db, input.projectId), approvedDesign?.revision.structuredContent as DesignArtifact | null);
  if (planIssues.length) throw errors.validation(`Task plan is incomplete: ${planIssues.slice(0, 5).join("; ")}`);
  const refToTask = new Map<string, TaskRow>();
  for (const t of input.plan.tasks) {
    const contract: TaskContract = TaskContractSchema.parse({
      title: t.title,
      task_type: t.task_type,
      objective: t.objective,
      scope: t.scope,
      constraints: t.constraints,
      ui_screen_keys: t.ui_screen_keys ?? [],
      acceptance_criteria: t.acceptance_criteria,
      verification: t.verification,
      deliverables: t.deliverables,
      stop_conditions: t.stop_conditions,
      risk_factors: t.risk_factors,
      parallel_safe: t.parallel_safe,
      priority: t.priority,
    });
    const risk = deriveTaskRisk(contract);
    const featureId = t.feature_hint ? featureByKey.get(t.feature_hint) ?? null : null;
    const task = await createTask(db, {
      projectId: input.projectId,
      featureId,
      title: t.title,
      taskType: contract.task_type,
      objective: t.objective,
      contract,
      riskFactors: contract.risk_factors,
      hardness: risk.hardness,
      riskLevel: risk.riskLevel,
      reviewPolicy: risk.reviewPolicy,
      parallelSafe: contract.parallel_safe,
      priority: contract.priority,
      createdFromRevisionIds: input.revisionRefs,
    });
    refToTask.set(t.ref, task);

    // Traceability links (C1): requirement_keys (+ optional AC keys)
    for (const reqKey of t.requirement_keys) {
      const req = requirementByKey.get(reqKey);
      if (!req) throw errors.validation(`Unknown requirement key ${reqKey}`);
      const acIds = t.acceptance_criterion_keys
        .map((ack) => req.acs.get(ack))
        .filter((v): v is string => Boolean(v));
      if (acIds.length === 0) {
        await db.insert(schema.taskRequirementLinks).values({ taskId: task.id, requirementId: req.id, acceptanceCriterionId: null }).onConflictDoNothing();
      } else {
        for (const acId of acIds) {
          await db.insert(schema.taskRequirementLinks).values({ taskId: task.id, requirementId: req.id, acceptanceCriterionId: acId }).onConflictDoNothing();
        }
      }
    }
    await audit(db, {
      workspaceId: project.workspaceId,
      projectId: input.projectId,
      actorType: "AI",
      actorId: input.userId,
      source: "AI",
      action: "task.created",
      entityType: "TASK",
      entityId: task.id,
      metadata: { key: task.key },
    });
  }

  // Dependency edges from ref map (T084).
  const missingRefs: string[] = [];
  const failedDeps: Array<{ from: string; to: string; reason: string }> = [];
  const edges: Array<{ taskId: string; dependsOnTaskId: string }> = [];
  for (const t of input.plan.tasks) {
    for (const depRef of t.depends_on_refs) {
      const target = refToTask.get(depRef);
      const source = refToTask.get(t.ref);
      if (!target || !source) throw errors.validation(`Unresolved dependency ${depRef}`);
      edges.push({ taskId: source.id, dependsOnTaskId: target.id });
    }
  }

  if (edges.length) await db.insert(schema.taskDependencies).values(edges).onConflictDoNothing();
  const graph = await validateProjectGraph(db, input.projectId);
  if (!graph.acyclic) throw errors.validation("Task dependencies must be acyclic");
  const tasks = await listTasks(db, input.projectId);
  return {
    created: refToTask.size,
    createdTasks: Array.from(refToTask.values()).map((t) => ({ id: t.id, key: t.key })),
    missingRefs,
    failedDeps,
    graph,
    tasks,
  };
  });
}
