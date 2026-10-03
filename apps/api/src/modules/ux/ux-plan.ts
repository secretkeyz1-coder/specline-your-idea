import { desc, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import {
  MAX_UX_SCREENS,
  UX_RULES_VERSION,
  UxPlanSchema,
  UxVisualBriefSchema,
  type LayoutReference,
  type UxFidelity,
  type UxPlatform,
  type UxPlan,
  type UxLintFinding,
  type UxReference,
  type UxScreen,
  type UxVisualBrief,
} from "@sdd/contracts";
import { errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, UX_PLAN_NATIVE_NOTE, UX_PLAN_SYSTEM_PROMPT } from "@sdd/ai";
import { createDraftRevision, getApprovedRevision, getOrCreateArtifact, structuredOf } from "../artifact/service.js";
import { approvedDesignSystem, designSystemBrief } from "../design-system/service.js";
import { reframeScreens } from "./ux-shell.js";
import { acceptPlanRepair, lintUxPlan, planRepairInstruction } from "./ux-lint.js";
import { repairTargets } from "./ux-rules.js";
import { layoutReferenceLines, templateDesignSystem } from "./ux-layout.js";
import { deviceList, detectedPlatform, platformOf, samePlatform } from "./ux-platform.js";
import { briefBase, briefLines, currentDraft, mutateDraft, planInputsCurrent, planningContext, pushHistory, renderUxMarkdown, shellOf, slug } from "./ux-draft.js";

/** Planning the screens: the AI's plan with its one repair turn, the stored reference it becomes, adding and removing screens, and accepting left-out scope. */

/** The plan as the person will get it: a requested count is a promise — never more screens than they asked for. */
export function planForCount(plan: UxPlan, screenCount: number | null): UxPlan {
  return screenCount && plan.screens.length > screenCount ? { ...plan, screens: plan.screens.slice(0, screenCount) } : plan;
}

/** Turn the AI's plan into the stored reference, under the current rule set. */
export function referenceFromPlan(
  plan: UxPlan,
  opts: { screenCount: number | null; guidance: string; fidelity?: UxFidelity; designSystemVersion?: number | null; planLint?: UxLintFinding[] },
): UxReference {
  const taken = new Set<string>();
  const planned = plan.applicable ? planForCount(plan, opts.screenCount).screens : [];
  const conflict = plan.count_conflict?.uncovered.length ? plan.count_conflict : undefined;
  return {
    rules_version: UX_RULES_VERSION,
    // New plans are drawn in open-design style; revise and restyle keep a reference's generator.
    generator: "od",
    ...(conflict ? { count_conflict: conflict } : {}),
    ...(plan.uncovered_scope?.length ? { uncovered_scope: plan.uncovered_scope } : {}),
    ...(plan.no_ui_requirements?.length ? { no_ui_requirements: plan.no_ui_requirements } : {}),
    // Without a shell answer the plan predates it: nothing on, rather than the old full shell.
    shell: plan.shell ?? { search: false, notifications: false, account: false, reason: "" },
    scope_confirmed_at: null,
    applicable: plan.applicable && planned.length > 0,
    reason: plan.reason,
    recommended_count: plan.applicable ? plan.recommended_count || plan.screens.length : 0,
    count_rationale: plan.count_rationale,
    requested_count: opts.screenCount,
    fidelity: opts.fidelity ?? "neutral",
    design_system_version: opts.designSystemVersion ?? null,
    guidance: opts.guidance,
    ...(opts.planLint?.length ? { plan_lint: opts.planLint } : {}),
    ...(plan.sample_data && (plan.sample_data.records.length || plan.sample_data.people.length) ? { sample_data: plan.sample_data } : {}),
    ...(plan.brief ? { brief: { ...plan.brief, source: "ai" as const } } : {}),
    screens: planned.map((s) => ({
      key: slug(s.key || s.name, taken),
      name: s.name,
      purpose: s.purpose,
      requirement_keys: s.requirement_keys,
      key_elements: s.key_elements,
      screen_type: s.screen_type,
      shell_mode: s.shell_mode,
      overlays: s.overlays,
      ...(s.primary_action?.label ? { primary_action: { label: s.primary_action.label, result: s.primary_action.result ?? "" } } : {}),
      ...(s.states?.length ? { states: s.states } : {}),
      ...(s.layout_note?.trim() ? { layout_note: s.layout_note.trim() } : {}),
      html: null,
    })),
  };
}

/**
 * The brief a new plan carries: the person's own, kept as written, with the
 * parts they left empty filled from the plan's draft (aturan.md §4 Lapis 1);
 * without one, the plan's draft as it is.
 */
export function mergeBrief(person: UxVisualBrief | undefined, drafted: UxVisualBrief | undefined): UxVisualBrief | undefined {
  if (!person) return drafted ? { ...drafted, source: "ai" } : undefined;
  const pick = (key: "users" | "devices" | "direction" | "hierarchy" | "references") => (person[key].trim() ? person[key] : (drafted?.[key] ?? ""));
  return {
    users: pick("users"),
    devices: pick("devices"),
    direction: pick("direction"),
    hierarchy: pick("hierarchy"),
    references: pick("references"),
    assumptions: person.assumptions.length ? person.assumptions : (drafted?.assumptions ?? []),
    source: "user",
  };
}

/** The newest brief the person wrote for this project's UI reference (any revision), to keep when the screens are planned again. */
async function personBrief(db: DbExecutor, projectId: string): Promise<UxVisualBrief | undefined> {
  const artifact = await getOrCreateArtifact(db, { projectId, artifactType: "ux" });
  const revisions = await db
    .select()
    .from(schema.artifactRevisions)
    .where(eq(schema.artifactRevisions.artifactId, artifact.id))
    .orderBy(desc(schema.artifactRevisions.version));
  for (const r of revisions) {
    const brief = structuredOf<UxReference>(r)?.brief;
    if (brief?.source === "user") return brief;
  }
  return undefined;
}

/**
 * The person's own product brief on the draft (PUT …/ux/brief). It is kept
 * as written and carried into every draw, redraw, AI edit and the next plan;
 * drawings already made stay until they are redrawn. `base` is the digest of
 * the brief as the page saw it — a brief changed meanwhile is a 409.
 */
export async function setUxBrief(db: DbExecutor, input: { projectId: string; brief: unknown; base?: string }) {
  const parsed = UxVisualBriefSchema.safeParse(input.brief);
  if (!parsed.success) throw errors.validation("That brief is not valid — check the length of each part");
  const brief: UxVisualBrief = { ...parsed.data, source: "user" };
  const { draft } = await currentDraft(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current) => {
    if (input.base !== undefined && input.base !== briefBase(current.brief)) {
      throw errors.conflict("UX_BRIEF_CHANGED", "The brief changed since you opened it — it was reloaded; make the change again");
    }
    return { ...current, brief };
  });
  return { revision, brief, base: briefBase(brief) };
}

/**
 * Start a UI reference draft: the AI plans the screens (mode "plan"), or the
 * approved reference is copied into a new draft to be revised (mode "revise").
 */
export async function startUxDraft(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: {
    projectId: string;
    userId: string;
    mode: "plan" | "revise";
    screenCount?: number | null;
    guidance?: string;
    fidelity?: UxFidelity;
    /** The person's own page every screen follows for layout (plan only; a revise keeps the approved one's). */
    layoutReference?: LayoutReference | null;
    /** Web app or Android app, and the devices (plan only); omitted: what the stack and requirements suggest. */
    platform?: UxPlatform | null;
  },
) {
  const ctx = await planningContext(db, input.projectId);
  // Styled screens are drawn with the approved design system, and go stale with it.
  const ds = await approvedDesignSystem(db, input.projectId);
  const screenCount = input.screenCount ? Math.min(Math.max(Math.trunc(input.screenCount), 1), MAX_UX_SCREENS) : null;
  const guidance = input.guidance?.trim().slice(0, 1000) ?? "";
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "ux" });

  let reference: UxReference;
  let aiGenerationRunId: string | null = null;
  if (input.mode === "revise") {
    const approved = await getApprovedRevision(db, input.projectId, "ux");
    const current = approved ? structuredOf<UxReference>(approved.revision) : null;
    if (!current) throw errors.conflict("UX_NOT_APPROVED", "There is no approved UI reference to revise — generate one instead");
    reference = { ...current, screens: current.screens.map((s) => ({ ...s })) };
    if (reference.fidelity === "styled" && !ds && !(reference.layout_reference?.mode === "adapt" && reference.layout_reference.design_system)) {
      throw errors.conflict("DESIGN_SYSTEM_NOT_APPROVED", "These screens were drawn with a design system that is no longer approved — approve one, or plan neutral screens");
    }
  } else {
    if (input.fidelity === "styled" && !ds && !(input.layoutReference?.mode === "adapt" && input.layoutReference.design_system)) {
      throw errors.conflict("DESIGN_SYSTEM_NOT_APPROVED", "Approve a design system first, or draw neutral screens");
    }
    const platform = input.platform ?? (await detectedPlatform(db, input.projectId));
    // A brief the person wrote is input, not a draft to replace: the plan keeps it and fills only its gaps.
    const kept = await personBrief(db, input.projectId);
    const request = [
      ctx.text,
      "",
      ...(input.fidelity === "styled" && (ds || input.layoutReference?.design_system) ? ["ACTIVE VISUAL SYSTEM FOR PLANNING:", designSystemBrief(templateDesignSystem(ds?.spec ?? input.layoutReference!.design_system!, input.layoutReference)), "Brief controls product priorities; template controls adapted geometry; this system controls colour/type/spacing. Keep source permissions and required actions."] : []),
      ...(kept ? [...briefLines(kept), "Keep this brief as the person wrote it; in brief, fill only the parts it leaves empty.", ""] : []),
      ...(platform.kind === "native-mobile" ? [UX_PLAN_NATIVE_NOTE, `Target devices, primary first: ${deviceList(platform)}.`, ""] : []),
      screenCount
        ? `SCREEN COUNT: the person wants exactly ${screenCount} screen${screenCount === 1 ? "" : "s"}.`
        : `SCREEN COUNT: not set — recommend the number yourself (at most ${MAX_UX_SCREENS}).`,
      guidance ? `GUIDANCE FROM THE PERSON: ${guidance}` : "",
      ...(input.layoutReference ? layoutReferenceLines(input.layoutReference, "plan") : []),
    ]
      .filter(Boolean)
      .join("\n");
    const plan = (content: string) =>
      runStructured(gateway, {
        workspaceId: ctx.project.workspaceId,
        projectId: ctx.project.id,
        artifactId: artifact.id,
        role: "ARCHITECTURE",
        schema: UxPlanSchema,
        schemaName: "UxPlan",
        system: UX_PLAN_SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
      });
    const planOpts = { screenCount, requirements: ctx.requirements };
    // Checked as the person will get it (a requested count trims extra screens).
    const lintOf = (p: UxPlan) => lintUxPlan(planForCount(p, screenCount), planOpts);
    let result = await plan(request);
    let planLint = lintOf(result.data);
    // One repair turn when the plan has findings a repair can fix (a missing
    // P0 screen, a wrong count). The repair is kept only when those went down,
    // no new approval blocker appeared and no P0 requirement lost its screen;
    // a failed call keeps the first plan.
    if (repairTargets(planLint).length > 0) {
      try {
        const repaired = await plan(`${request}\n\nYOUR PLAN:\n${JSON.stringify(result.data)}\n\n${planRepairInstruction(planLint)}`);
        const repairedLint = lintOf(repaired.data);
        const before = { plan: planForCount(result.data, screenCount), findings: planLint };
        if (acceptPlanRepair(before, { plan: planForCount(repaired.data, screenCount), findings: repairedLint }, ctx.requirements)) {
          result = repaired;
          planLint = repairedLint;
        }
      } catch {
        // Keep the first plan; its findings are stored with it.
      }
    }
    reference = referenceFromPlan(result.data, {
      screenCount,
      guidance,
      fidelity: input.fidelity ?? "neutral",
      designSystemVersion: input.fidelity === "styled" ? ds?.version ?? null : null,
      planLint,
    });
    const brief = mergeBrief(kept, result.data.brief);
    if (brief) reference.brief = brief;
    // Stored with the plan, so the first Draw already follows it.
    if (input.layoutReference) reference.layout_reference = input.layoutReference;
    reference.platform = platform;
    aiGenerationRunId = result.generationRunId;
  }

  const revision = await createDraftRevision(db, {
    artifactId: artifact.id,
    structuredContent: reference,
    content: renderUxMarkdown(reference),
    actorType: input.mode === "plan" ? "AI" : "USER",
    actorId: input.userId,
    aiGenerationRunId,
    derivedFrom:
      reference.fidelity === "styled" && ds
        ? [...ctx.derivedFrom, { artifact_id: ds.artifactId, version: ds.version }]
        : ctx.derivedFrom,
  });
  return { revision, reference };
}

/**
 * The reference a new look starts from: the current draft, else the approved
 * version, else the newest stale one when only its drawings are outdated (its
 * design system changed; the requirements, stack and design it was planned
 * from are still the approved ones). Null when the screens must be planned again.
 */
export async function restyleSource(db: DbExecutor, projectId: string) {
  const artifact = await getOrCreateArtifact(db, { projectId, artifactType: "ux" });
  const revisions = await db
    .select()
    .from(schema.artifactRevisions)
    .where(eq(schema.artifactRevisions.artifactId, artifact.id))
    .orderBy(desc(schema.artifactRevisions.version));
  const draft = revisions.find((r) => r.id === artifact.currentDraftRevisionId && r.status === "DRAFT");
  const approved = revisions.find((r) => r.id === artifact.approvedRevisionId && r.status === "APPROVED");
  const stale = !draft && !approved ? revisions.find((r) => r.status === "STALE") : undefined;
  const revision = draft ?? approved ?? stale;
  const reference = revision ? structuredOf<UxReference>(revision) : null;
  if (!revision || !reference?.applicable || !reference.screens.length) return null;
  if (revision === stale && !(await planInputsCurrent(db, projectId, revision.derivedFrom ?? []))) return null;
  return { artifact, revision, reference };
}

/**
 * Keep the screens, change how they are drawn: neutral greys, or the approved
 * design system (again, after it changed). The plan — screens, what each must
 * show, example data, the accepted scope — carries over into a new draft;
 * every drawing is cleared onto its screen's undo history and comments stay,
 * finding their elements again when the screen is redrawn.
 */
/**
 * The plan kept, every drawing cleared onto its history, the look (and the
 * platform, when one is given) set: what "change look" stores. Pure — the
 * caller supplies whether the source is stale and the design system version.
 * The same look on a current reference is refused (UX_LOOK_UNCHANGED);
 * drawing it as another platform (a web app as an Android app) is a change.
 */
export function restyledReference(
  current: UxReference,
  opts: { stale: boolean; fidelity: UxFidelity; designSystemVersion: number | null; platform?: UxPlatform | null },
): UxReference {
  const version = opts.designSystemVersion;
  const platformChanged = Boolean(opts.platform && !samePlatform(opts.platform, platformOf(current)));
  if (!opts.stale && !platformChanged && (current.fidelity ?? "neutral") === opts.fidelity && (current.design_system_version ?? null) === version) {
    throw errors.conflict("UX_LOOK_UNCHANGED", "These screens already use this look — redraw a screen to change it");
  }
  const platform = opts.platform ?? platformOf(current);
  const look = [
    opts.fidelity === "styled" ? `design system v${version}` : "neutral greys",
    ...(platformChanged ? [platform.kind === "native-mobile" ? "an Android app" : "a web app"] : []),
  ].join(", as ");
  return {
    ...current,
    fidelity: opts.fidelity,
    design_system_version: version,
    // A reference made before platforms keeps none unless one is chosen (it stays a web reference).
    ...(opts.platform || current.platform ? { platform } : {}),
    screens: current.screens.map(({ lint: _lint, revision_note: _note, ...s }) => ({
      ...s,
      html: null,
      history: pushHistory(s, `Look changed to ${look}`),
    })),
  };
}

export async function restyleUxReference(db: DbExecutor, input: { projectId: string; userId: string; fidelity: UxFidelity; platform?: UxPlatform | null }) {
  const ctx = await planningContext(db, input.projectId);
  const ds = await approvedDesignSystem(db, input.projectId);
  const source = await restyleSource(db, input.projectId);
  if (!source) throw errors.conflict("UX_NOTHING_TO_RESTYLE", "There are no planned screens to keep — plan the screens");
  if (input.fidelity === "styled" && !ds && !(source.reference.layout_reference?.mode === "adapt" && source.reference.layout_reference.design_system)) throw errors.conflict("DESIGN_SYSTEM_NOT_APPROVED", "Approve a design system or adapt a template first");
  const reference = restyledReference(source.reference, {
    stale: source.revision.status === "STALE",
    fidelity: input.fidelity,
    designSystemVersion: input.fidelity === "styled" ? ds?.version ?? null : null,
    platform: input.platform,
  });
  const revision = await createDraftRevision(db, {
    artifactId: source.artifact.id,
    structuredContent: reference,
    content: renderUxMarkdown(reference),
    actorType: "USER",
    actorId: input.userId,
    derivedFrom: input.fidelity === "styled" && ds ? [...ctx.derivedFrom, { artifact_id: ds.artifactId, version: ds.version }] : ctx.derivedFrom,
  });
  return { revision, reference };
}

/** Add a screen the person describes; it is drawn like any other. */
export async function addUxScreen(
  db: DbExecutor,
  input: { projectId: string; name: string; purpose: string; keyElements: string[]; requirementKeys: string[] },
) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current) => {
    if (!current.applicable) throw errors.conflict("UX_NOT_APPLICABLE", "This product has no screens — plan the screens again to add some");
    if (current.screens.length >= MAX_UX_SCREENS) {
      throw errors.conflict("UX_TOO_MANY_SCREENS", `A UI reference holds at most ${MAX_UX_SCREENS} screens — remove one first`);
    }
    const taken = new Set(current.screens.map((s) => s.key));
    const screen: UxScreen = {
      key: slug(input.name, taken),
      name: input.name.trim().slice(0, 80),
      purpose: input.purpose.trim().slice(0, 400),
      requirement_keys: input.requirementKeys.map((k) => k.trim().toUpperCase()).filter(Boolean).slice(0, 10),
      key_elements: input.keyElements.map((e) => e.trim().slice(0, 160)).filter(Boolean).slice(0, 12),
      html: null,
    };
    // The other screens' navigation lists the new one too.
    return reframeScreens({ ...current, screens: [...current.screens, screen] }, key => shell.spec(current, key), shell.brand);
  });
  const screens = structuredOf<UxReference>(revision)!.screens;
  return { revision, screen: screens[screens.length - 1]! };
}

/** Drop a screen from the draft; the last one stays — skip the step instead. */
export async function removeUxScreen(db: DbExecutor, input: { projectId: string; screenKey: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const shell = await shellOf(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current) => {
    if (!current.screens.some((s) => s.key === input.screenKey)) throw errors.notFound("UI reference screen", input.screenKey);
    if (current.screens.length <= 1) {
      throw errors.conflict("UX_LAST_SCREEN", "A UI reference needs at least one screen — the step is optional if you don't want one");
    }
    return reframeScreens({ ...current, screens: current.screens.filter((s) => s.key !== input.screenKey) }, key => shell.spec(current, key), shell.brand);
  });
  return { revision };
}

/**
 * The person accepts what the plan leaves out — the P0 requirements the
 * requested screen count cannot serve, or scope beyond the screen limit.
 * Approval needs it when either is set (ux-approval.ts).
 */
export async function confirmUxScope(db: DbExecutor, input: { projectId: string }) {
  const { draft } = await currentDraft(db, input.projectId);
  const revision = await mutateDraft(db, draft.id, (current) => {
    if (!current.count_conflict?.uncovered.length && !current.uncovered_scope?.length) {
      throw errors.conflict("UX_NOTHING_TO_CONFIRM", "This plan leaves nothing out — there is nothing to confirm");
    }
    return { ...current, scope_confirmed_at: new Date().toISOString() };
  });
  return { revision };
}
