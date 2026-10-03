import { eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { StackDecisionSchema, type StackRecommendInput, type StackDecision, type StackPackage } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, STACK_SYSTEM_PROMPT } from "@sdd/ai";
import { getApprovedRevision, createDraftRevision, approveRevision, getOrCreateArtifact } from "../artifact/service.js";
import { listRequirementsForRevision } from "./requirements.js";
import { renderStackMarkdown } from "./render.js";
import { updateLifecycle, getProject, projectRulesLines } from "../project/service.js";
import { audit, type AuditSource } from "../audit/service.js";
import { behindLatestMajor, refKey, stackRegistry } from "./stack-registry.js";
import { catalogFactLines, matchCatalogOption, namedTechnologies, usesTechnology, verifiedCatalog, type CatalogOption } from "./stack-catalog.js";
import { productContext } from "./quality.js";
import type { RequirementsArtifact } from "@sdd/contracts";

type Layer = StackDecision["candidates"][number]["layers"][number];
type Conflict = StackDecision["conflicts"][number];
type LookupMany = typeof stackRegistry.lookupMany;

/**
 * Tech-stack selection (Phase 6, T063–T068, FR-030..037).
 * Two top-level modes only: RECOMMENDED | MANUAL. Manual mode can request an
 * AI suggestion for ONE unresolved layer; user-locked choices are never
 * silently replaced (C8, FR-033/035).
 */

export async function recommendStack(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; body: StackRecommendInput },
) {
  const { result, approved } = await runStackDecision(gateway, db, input);
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "stack" });
  const revision = await createDraftRevision(db, {
    artifactId: artifact.id,
    structuredContent: result.data,
    content: renderStackMarkdown(result.data),
    actorType: "AI",
    actorId: input.userId,
    aiGenerationRunId: result.generationRunId,
    derivedFrom: [{ artifact_id: approved.artifact.id, version: approved.revision.version }],
  });
  await updateLifecycle(db, input.projectId, "STACK_SELECTION");
  return { artifact, revision, decision: result.data };
}

/** The model's stack decision, grounded in the approved requirements; stores nothing. */
async function runStackDecision(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; body: StackRecommendInput },
) {
  const project = (await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1))[0]!;
  // C7 — Requirements before technology: the recommender is grounded in the
  // APPROVED requirements, never in raw discovery answers.
  const approved = await getApprovedRevision(db, input.projectId, "requirements");
  if (!approved) {
    throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve the requirements before selecting a technology stack (C7)");
  }
  const reqs = await listRequirementsForRevision(db, approved.revision.id);
  const reqContext = [
    "APPROVED REQUIREMENTS (keys, titles, acceptance criteria):",
    ...reqs.map(
      (r) =>
        `- ${r.key} [${r.priority}] ${r.title}${r.type === "NON_FUNCTIONAL" ? " (NFR)" : ""}\n  ${r.statement}\n${r.acceptance_criteria
          .map((ac) => `  · ${ac.key}: ${ac.statement}`)
          .join("\n")}`,
    ),
  ].join("\n");

  // Context builder: only relevant requirement context (T064) — titles/keys/ACs.
  const context = [
    `PROJECT: ${project.name}`,
    `IDEA: ${project.highLevelIdea}`,
    project.constraints.length ? `CONSTRAINTS (the user's decisions — every technology named here must be used): ${project.constraints.join("; ")}` : "",
    ...projectRulesLines(project.projectRules, "no candidate may break them"),
    "",
    reqContext,
    ...productContext(approved.revision.structuredContent as RequirementsArtifact),
  ].filter(Boolean).join("\n");

  const modeBlock =
    input.body.mode === "RECOMMENDED"
      ? "MODE: RECOMMENDED — propose 2-3 candidate stacks with tradeoffs and mark one recommendation."
      : `MODE: MANUAL — the user has selected/locked these components (NEVER replace locked choices):\n${input.body.manual_components
          .map((c) => `- ${c.category}: ${c.technology}${c.locked ? " (LOCKED)" : ""}${c.version_constraint ? ` (${c.version_constraint})` : ""}${c.package ? ` [${c.package.registry}:${c.package.name}]` : ""}`)
          .join("\n")}${
          input.body.suggest_category
            ? `\n\nThe user asks for a suggestion for ONLY this unresolved layer: ${input.body.suggest_category}. Fill only that layer; keep every other layer as chosen. Report any compatibility conflicts.`
            : "\nValidate compatibility and report conflicts without changing user choices."
        }`;

  // Live facts, not the model's memory: today's date and every catalog
  // option's latest release, checked against its registry (a slow registry
  // is left out after a few seconds rather than holding the request).
  const today = new Date().toISOString().slice(0, 10);
  const facts = catalogFactLines(await verifiedCatalog({ deadlineMs: 5000 }));

  const ask = {
    workspaceId: project.workspaceId,
    projectId: project.id,
    role: "ARCHITECTURE" as const,
    schema: StackDecisionSchema,
    schemaName: "StackDecision",
    system: STACK_SYSTEM_PROMPT,
  };
  const question = `${context}\n\n${stackFactsBlock(today, facts)}\n\n${modeBlock}`;
  let result = await runStructured(gateway, { ...ask, messages: [{ role: "user", content: question }] });

  // Every layer is checked against its registry. Layers the model chose that
  // are deprecated, stale or pinned below the latest major get one repair
  // turn with the facts; what the user chose is never replaced (C8) — it is
  // reported instead, like anything the repair could not fix.
  const userCategories = new Set(
    input.body.mode === "MANUAL" ? input.body.manual_components.filter((c) => c.technology.trim()).map((c) => c.category.trim().toLowerCase()) : [],
  );
  // Technologies the user named (constraints, project rules) bind the recommendation.
  const named = input.body.mode === "RECOMMENDED" ? namedTechnologies([...project.constraints, ...project.projectRules]) : [];
  let data = await verifyDecision(result.data);
  const fixable = [...namedIssues(data, named), ...decisionIssues(data).filter((i) => !userCategories.has(i.category.toLowerCase()))];
  if (fixable.length > 0) {
    try {
      const repaired = await runStructured(gateway, {
        ...ask,
        messages: [
          { role: "user", content: question },
          { role: "assistant", content: JSON.stringify(stripVerification(result.data)) },
          { role: "user", content: stackRepairInstruction(today, fixable, input.body.mode === "MANUAL") },
        ],
      });
      result = repaired;
      data = await verifyDecision(repaired.data);
    } catch {
      // The first answer stands; its problems become findings below.
    }
  }
  data = honourNamed(data, named);
  data = { ...data, conflicts: mergeConflicts(data.conflicts, [...namedIssues(data, named), ...decisionIssues(data)].map(issueConflict)) };
  return { result: { ...result, data }, approved };
}

/** The recommended candidate leaves out a technology the user named. */
export function namedIssues(decision: StackDecision, named: CatalogOption[]): StackIssue[] {
  const chosen = decision.candidates[decision.recommendation_index ?? 0] ?? decision.candidates[0];
  if (!chosen) return [];
  return named
    .filter((option) => !usesTechnology(chosen.layers, option))
    .map((option) => ({
      candidate: chosen.name,
      category: "Constraints",
      technology: option.name,
      severity: "HIGH" as const,
      finding: `The user's constraints name ${option.name}, but the recommended stack doesn't use it.`,
      fix: `recommend a candidate built on ${option.name}; keep it even where a requirement is hard with it, and say how the gap is closed (a native module, a library)`,
    }));
}

/**
 * Last resort after the repair turn: when the recommendation still drops a
 * named technology but another candidate uses all of them, recommend that one
 * — the user's choice wins over the model's preference — and say so.
 */
export function honourNamed(decision: StackDecision, named: CatalogOption[]): StackDecision {
  if (named.length === 0 || namedIssues(decision, named).length === 0) return decision;
  const index = decision.candidates.findIndex((c) => named.every((o) => usesTechnology(c.layers, o)));
  if (index < 0) return decision;
  const list = named.map((o) => o.name).join(", ");
  return {
    ...decision,
    recommendation_index: index,
    rationale: `Recommended ${decision.candidates[index]!.name} because your constraints name ${list}. ${decision.rationale}`,
  };
}

/** The facts block: today's date and the current releases per layer. */
export function stackFactsBlock(today: string, factLines: string[]): string {
  return [
    `TODAY: ${today}`,
    "CURRENT RELEASES — checked live against the package registries today. These are facts; where they differ from what you remember, they win:",
    ...factLines.map((l) => `- ${l}`),
  ].join("\n");
}

/** Registry id + live check on every layer of every candidate. */
export async function verifyDecision(decision: StackDecision, lookupMany: LookupMany = stackRegistry.lookupMany): Promise<StackDecision> {
  const candidates = await Promise.all(decision.candidates.map(async (c) => ({ ...c, layers: await verifyLayers(c.layers, lookupMany) })));
  return { ...decision, candidates };
}

/**
 * Attach a registry id to each layer (the model's or the user's, else the
 * catalog's match for the technology's name) and its live verification.
 * Layers with no package (a hosted service) carry no verification.
 */
export async function verifyLayers<L extends Layer>(layers: L[], lookupMany: LookupMany = stackRegistry.lookupMany): Promise<L[]> {
  const withPackage = layers.map((l) => {
    const pkg: StackPackage | null = l.package ?? matchCatalogOption(l.category, l.technology)?.package ?? null;
    return { ...l, package: pkg };
  });
  const facts = await lookupMany(withPackage.map((l) => l.package).filter((p): p is StackPackage => p !== null));
  return withPackage.map((l) => {
    const { verified: _old, ...rest } = l;
    const verified = l.package ? facts.get(refKey(l.package)) : undefined;
    return (verified ? { ...rest, verified } : rest) as L;
  });
}

export interface StackIssue {
  candidate: string;
  category: string;
  technology: string;
  severity: Conflict["severity"];
  finding: string;
  fix: string;
}

/** What the live check says is wrong with a layer, if anything. */
export function layerIssue(layer: Layer, candidate = ""): StackIssue | null {
  const v = layer.verified;
  if (!v) return null;
  const base = { candidate, category: layer.category, technology: layer.technology };
  if (v.status === "deprecated") {
    return {
      ...base,
      severity: "HIGH",
      finding: `${layer.technology} is deprecated or archived${v.note ? ` (${v.note.slice(0, 160)})` : ""}. Choose a maintained alternative.`,
      fix: "replace it with a maintained alternative from CURRENT RELEASES",
    };
  }
  if (v.status === "stale") {
    return {
      ...base,
      severity: "MEDIUM",
      finding: `${layer.technology} has had no release since ${v.released_at?.slice(0, 10) ?? "a long time"} (over 18 months).`,
      fix: "replace it with an actively maintained alternative, unless a requirement needs this one",
    };
  }
  if (behindLatestMajor(layer.version_constraint, v.latest_version)) {
    return {
      ...base,
      severity: "LOW",
      finding: `${layer.technology} ${layer.version_constraint} is behind the latest release, ${v.latest_version}.`,
      fix: `set version_constraint to the latest major (${v.latest_version})`,
    };
  }
  return null;
}

/** Issues across the decision, candidate by candidate. */
export function decisionIssues(decision: StackDecision): StackIssue[] {
  const named = decision.candidates.length > 1;
  return decision.candidates.flatMap((c) => c.layers.map((l) => layerIssue(l, named ? c.name : "")).filter((i): i is StackIssue => i !== null));
}

function issueConflict(issue: StackIssue): Conflict {
  return { category: issue.category, finding: `${issue.candidate ? `${issue.candidate}: ` : ""}${issue.finding}`, severity: issue.severity };
}

function mergeConflicts(existing: Conflict[], added: Conflict[]): Conflict[] {
  const seen = new Set(existing.map((c) => `${c.category.toLowerCase()}|${c.finding}`));
  return [...existing, ...added.filter((c) => !seen.has(`${c.category.toLowerCase()}|${c.finding}`))].slice(0, 15);
}

/** The model never sees (or echoes) verification: it is the server's to fill. */
function stripVerification(decision: StackDecision): StackDecision {
  return { ...decision, candidates: decision.candidates.map((c) => ({ ...c, layers: c.layers.map(({ verified: _v, ...l }) => l) })) };
}

export function stackRepairInstruction(today: string, issues: StackIssue[], manual: boolean): string {
  const line = (i: StackIssue) => `- ${i.candidate ? `${i.candidate} · ` : ""}${i.category} · ${i.technology}: ${i.finding} Fix: ${i.fix}.`;
  const constraint = issues.filter((i) => i.category === "Constraints");
  const registry = issues.filter((i) => i.category !== "Constraints");
  return [
    ...(constraint.length ? ["The recommendation breaks the user's constraints, which are binding:", ...constraint.map(line), ""] : []),
    ...(registry.length ? [`A live registry check (today, ${today}) found problems with layers you chose:`, ...registry.map(line), ""] : []),
    manual
      ? "Fix only these layers; keep every layer the user chose exactly as it is. Return the complete StackDecision."
      : constraint.length
        ? "Fix these: rebuild or re-rank the candidates so the recommended one uses every named technology, keep everything else. Return the complete StackDecision."
        : "Fix only these layers and keep everything else. Return the complete StackDecision.",
  ].join("\n");
}

/**
 * Deterministic sanity checks + AI findings for manual stacks (T066).
 * Validation only: it neither stores a stack draft nor moves the project's
 * lifecycle — checking a combination is not choosing it.
 */
export async function validateCustomStack(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; body: StackRecommendInput },
) {
  // Deterministic checks first: never silently replace user choices.
  const deterministic = deterministicStackChecks(input.body);
  const { result } = await runStackDecision(gateway, db, input);
  const decision = result.data;
  const conflicts = [
    ...deterministic,
    ...decision.conflicts.map((c) => ({ category: c.category, finding: c.finding, severity: c.severity })),
  ];
  return { conflicts, decision };
}

function deterministicStackChecks(body: StackRecommendInput): Array<{ category: string; finding: string; severity: string }> {
  const findings: Array<{ category: string; finding: string; severity: string }> = [];
  const byCategory = new Map(body.manual_components.map((c) => [c.category.toLowerCase(), c]));
  const hasDatabase = byCategory.has("database") || byCategory.has("data store") || byCategory.has("data storage");
  const hasBackend = byCategory.has("backend") || byCategory.has("backend/runtime") || byCategory.has("runtime");
  if (hasBackend && !hasDatabase) {
    findings.push({
      category: "database",
      finding: "A backend is selected but no database layer is chosen. Most applications with server-side state need one.",
      severity: "MEDIUM",
    });
  }
  const db = byCategory.get("database");
  if (db && /sqlite/i.test(db.technology) && /multi.?region|horizontally scalable writes/i.test(JSON.stringify(body.preferences))) {
    findings.push({
      category: "database",
      finding: `SQLite conflicts with a multi-region/horizontally-scaled write requirement. Relax the architecture requirement or choose a client-server database.`,
      severity: "BLOCKING",
    });
  }
  return findings;
}

/** Approve creates the STACK-vN baseline + normalized components (T068, FR-036). */
export async function approveStack(
  db: DbExecutor,
  input: {
    projectId: string;
    userId: string;
    components: Array<{
      category: string;
      technology: string;
      version_constraint: string | null;
      selection_source: "AI_RECOMMENDED" | "USER_SELECTED" | "AI_ASSISTED";
      locked_by_user: boolean;
      rationale: string;
      package?: StackPackage | null;
    }>;
    rationale: string;
    source?: AuditSource;
  },
) {
  const project = await getProject(db, input.projectId);
  // C7 gate enforced by the API itself (the web redirect is only UX).
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  if (!approvedReq) {
    throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve the requirements before locking a technology stack (C7)");
  }
  // One component per category (the DB enforces it too — duplicates used to
  // surface as a 500 after the revision was already approved).
  const byCategory = new Map<string, (typeof input.components)[number]>();
  for (const c of input.components) {
    const category = c.category.trim();
    const technology = c.technology.trim();
    if (!category || !technology) continue;
    const key = category.toLowerCase();
    if (byCategory.has(key)) throw errors.validation(`Stack category "${category}" appears more than once — choose one technology per layer`);
    byCategory.set(key, { ...c, category, technology });
  }
  const components = [...byCategory.values()];
  if (components.length === 0) throw errors.validation("A stack baseline needs at least one component");
  // The baseline records what each layer's registry said when it was locked.
  const layers = await verifyLayers(
    components.map((c) => ({
      category: c.category,
      technology: c.technology,
      version_constraint: c.version_constraint,
      rationale: c.rationale,
      package: c.package ?? null,
    })),
  );

  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "stack" });
  const decision: StackDecision = {
    mode: components.some((c) => c.selection_source === "USER_SELECTED") ? "MANUAL" : "RECOMMENDED",
    candidates: [
      {
        name: "Approved baseline",
        layers,
        tradeoffs: [],
        // The rationale is rendered once under "Recommendation rationale"; repeating
        // it as the candidate's fit assessment printed it twice.
        fit_assessment: "",
      },
    ],
    recommendation_index: 0,
    rationale: input.rationale,
    conflicts: [],
  };
  decision.conflicts = mergeConflicts([], decisionIssues(decision).map(issueConflict));
  // Preserve compatibility findings when locking the exact candidate that was reviewed.
  if (artifact.currentDraftRevisionId) {
    const [draft] = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, artifact.currentDraftRevisionId)).limit(1);
    const previous = draft?.structuredContent as StackDecision | null;
    if (previous?.candidates.some(candidate => candidate.layers.length === layers.length && candidate.layers.every(l => layers.some(chosen => chosen.category === l.category && chosen.technology === l.technology && chosen.version_constraint === l.version_constraint)))) decision.conflicts = mergeConflicts(decision.conflicts, previous.conflicts);
  }
  if (decision.conflicts.some(c => c.severity === "BLOCKING")) throw errors.conflict("STACK_CONFLICT", "Resolve incompatible stack choices before locking", { conflicts: decision.conflicts });

  // Revision, approval, components and project pointer commit together: a
  // failure can no longer leave a half-approved stack without components.
  const revision = await db.transaction(async (tx) => {
    const rev = await createDraftRevision(tx, {
      artifactId: artifact.id,
      structuredContent: decision,
      content: renderStackMarkdown(decision),
      actorType: "USER",
      actorId: input.userId,
      derivedFrom: [{ artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version }],
    });
    for (const c of components) {
      await tx.insert(schema.stackComponents).values({
        projectId: input.projectId,
        stackRevisionId: rev.id,
        category: c.category,
        technology: c.technology,
        versionConstraint: c.version_constraint,
        selectionSource: c.selection_source,
        lockedByUser: c.locked_by_user,
        rationale: c.rationale,
      });
    }
    // Approval also moves the project's stack pointer and lifecycle (STACK_APPROVED).
    await approveRevision(tx, { revisionId: rev.id, userId: input.userId, note: input.rationale, viaStackFlow: true, source: input.source });
    await audit(tx, {
      workspaceId: project.workspaceId,
      projectId: input.projectId,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: "stack.locked",
      entityType: "ARTIFACT_REVISION",
      entityId: rev.id,
      metadata: { components: components.length },
    });
    return rev;
  });
  return { revision, components };
}

export async function listStackComponents(db: DbExecutor, stackRevisionId: string) {
  return db.select().from(schema.stackComponents).where(eq(schema.stackComponents.stackRevisionId, stackRevisionId));
}
