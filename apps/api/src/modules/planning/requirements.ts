import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { RequirementsArtifactSchema, qualityCriteria, type RequirementsArtifact } from "@sdd/contracts";
import { errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, REQUIREMENTS_SYSTEM_PROMPT } from "@sdd/ai";
import { getActiveSession, buildTranscript, computeReadiness, discoveryAllowsRequirements } from "../discovery/service.js";
import { getOrCreateArtifact, createDraftRevision, getApprovedRevision } from "../artifact/service.js";
import { renderRequirementsMarkdown } from "./render.js";
import { updateLifecycle, getProject, projectRulesLines } from "../project/service.js";

/**
 * Requirements generation (Phase 5, T057–T060, FR-020..025).
 * Requires discovery readiness or explicitly accepted assumptions (C7).
 */

export async function generateRequirements(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string },
) {
  const project = (await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1))[0]!;
  const session = await getActiveSession(db, input.projectId);
  if (!session) throw errors.conflict("DISCOVERY_NOT_STARTED", "Start a discovery session before generating requirements");

  const { facts, assumptions, answers } = await buildTranscript(db, session, project);
  const readiness = computeReadiness(session, facts, assumptions, answers);
  const acceptedAssumptions = assumptions.filter((a) => a.status === "ACCEPTED");
  if (!discoveryAllowsRequirements(session, readiness)) {
    throw errors.conflict(
      "DISCOVERY_INCOMPLETE",
      "Discovery is incomplete — answer blocking questions or explicitly accept assumptions first (C7)",
    );
  }

  const transcript = [
    `PROJECT: ${project.name}`,
    `IDEA: ${project.highLevelIdea}`,
    project.constraints.length ? `CONSTRAINTS: ${project.constraints.join("; ")}` : "",
    ...projectRulesLines(project.projectRules, "the requirements must respect them"),
    "",
    "DISCOVERY FACTS (user-stated and derived):",
    ...facts.filter((f) => f.status === "ACTIVE").map((f) => `- (${f.sourceType}) ${f.factKey}: ${f.value}`),
    "",
    "ACCEPTED ASSUMPTIONS:",
    ...(acceptedAssumptions.length ? acceptedAssumptions.map((a) => `- ${a.description}`) : ["- (none)"]),
    "OPEN DECISIONS (not accepted facts; retain as open_questions unless explicitly resolved):",
    ...assumptions.filter(a => a.status === "PROPOSED").map(a => `- ${a.description}`),
    "",
    "Q&A TRANSCRIPT:",
    ...answers
      .filter(({ answer }) => answer !== null)
      .map(({ question, answer }) => `- Q: ${question.questionText}\n  A: ${answer!.answer.text}`),
  ].join("\n");

  const result = await runStructured(gateway, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    role: "SPECIFICATION",
    schema: RequirementsArtifactSchema,
    schemaName: "RequirementsArtifact",
    system: REQUIREMENTS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: transcript }],
  });

  const discovery = await getApprovedRevision(db, input.projectId, "discovery");
  return persistRequirementsDraft(db, {
    projectId: input.projectId,
    userId: input.userId,
    data: result.data,
    aiRunId: result.generationRunId,
    derivedFrom: discovery ? [{ artifact_id: discovery.artifact.id, version: discovery.revision.version }] : [],
  });
}

export async function persistRequirementsDraft(
  db: DbExecutor,
  input: { projectId: string; userId: string; data: RequirementsArtifact; aiRunId: string | null; derivedFrom: Array<{ artifact_id: string; version: number }> },
) {
  input.data = RequirementsArtifactSchema.parse(input.data);
  assertUniqueRequirementKeys(input.data);
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "requirements" });
  // Revision + normalized rows commit together: a failure half-way used to
  // leave an orphan draft (newest, approvable) with missing requirements.
  const revision = await db.transaction(async (tx) => {
    const rev = await createDraftRevision(tx, {
      artifactId: artifact.id,
      structuredContent: input.data,
      content: renderRequirementsMarkdown(input.data),
      actorType: input.aiRunId ? "AI" : "USER",
      actorId: input.userId,
      aiGenerationRunId: input.aiRunId,
      derivedFrom: input.derivedFrom,
    });
    await normalizeRequirements(tx, rev.id, input.projectId, input.data);
    return rev;
  });
  await updateLifecycle(db, input.projectId, "REQUIREMENTS_DRAFT");
  return { artifact, revision };
}

/** FR/NFR keys and AC keys (within a requirement) must be unique — traceability
 * links resolve by key, so duplicates would make them ambiguous. */
function assertUniqueRequirementKeys(data: RequirementsArtifact): void {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const key of [...data.functional_requirements.map((r) => r.key), ...data.non_functional.map((r) => r.key)]) {
    const k = key.trim().toUpperCase();
    if (seen.has(k)) dupes.push(key);
    seen.add(k);
  }
  for (const fr of data.functional_requirements) {
    const acSeen = new Set<string>();
    for (const ac of fr.acceptance_criteria) {
      const k = ac.key.trim().toUpperCase();
      if (acSeen.has(k)) dupes.push(`${fr.key}/${ac.key}`);
      acSeen.add(k);
    }
  }
  if (dupes.length > 0) {
    throw errors.validation(`Duplicate requirement/acceptance-criterion keys: ${[...new Set(dupes)].join(", ")}`, { duplicates: dupes });
  }
}

/** Stable requirement/AC records for traceability (T059, FR-051). */
export async function normalizeRequirements(
  db: DbExecutor,
  revisionId: string,
  projectId: string,
  data: RequirementsArtifact,
): Promise<void> {
  for (const fr of data.functional_requirements) {
    const [req] = await db
      .insert(schema.requirements)
      .values({
        projectId,
        artifactRevisionId: revisionId,
        key: fr.key,
        type: "FUNCTIONAL",
        title: fr.title,
        statement: fr.statement,
        priority: fr.priority,
        status: "ACTIVE",
      })
      .returning();
    for (const ac of fr.acceptance_criteria) {
      await db.insert(schema.acceptanceCriteria).values({
        requirementId: req!.id,
        key: ac.key,
        statement: ac.statement,
        verificationType: ac.verification_type,
      });
    }
  }
  for (const nfr of data.non_functional) {
    const [req] = await db.insert(schema.requirements).values({
      projectId,
      artifactRevisionId: revisionId,
      key: nfr.key,
      type: "NON_FUNCTIONAL",
      title: nfr.key,
      statement: nfr.statement,
      priority: nfr.priority ?? "P1",
      status: "ACTIVE",
    }).returning();
    for (const ac of qualityCriteria(nfr)) await db.insert(schema.acceptanceCriteria).values({ requirementId: req!.id, key: ac.key, statement: ac.statement, verificationType: ac.verification_type ?? "METRIC" });
  }
}

/** AI refine creates a NEW draft revision — approved baselines are never mutated (FR-025). */
export async function refineRequirements(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; instructions: string },
) {
  const approved = await getApprovedRevision(db, input.projectId, "requirements");
  const artifactRow = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "requirements" });
  // Refine what the user is looking at: the current DRAFT when there is one
  // (the UI only offers refine on drafts), otherwise the approved baseline.
  const [draft] = artifactRow.currentDraftRevisionId
    ? await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, artifactRow.currentDraftRevisionId)).limit(1)
    : [];
  const base = draft && draft.status === "DRAFT" ? draft : approved?.revision ?? null;
  const current = (base?.structuredContent as RequirementsArtifact | null) ?? null;
  if (!current) throw errors.conflict("NO_REQUIREMENTS_BASELINE", "Generate requirements before refining");
  const project = await getProject(db, input.projectId);
  const session = await getActiveSession(db, input.projectId);
  const transcript = session ? await buildTranscript(db, session, project) : null;

  const result = await runStructured(gateway, {
    workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1))[0]!.workspaceId,
    projectId: input.projectId,
    role: "SPECIFICATION",
    schema: RequirementsArtifactSchema,
    schemaName: "RequirementsArtifact",
    system: `${REQUIREMENTS_SYSTEM_PROMPT}\n\nThis is a REFINEMENT pass. Apply the user's change instructions to the existing requirements while preserving everything else.`,
    messages: [
      { role: "user", content: JSON.stringify({ idea: project.highLevelIdea, constraints: project.constraints, project_rules: project.projectRules, discovery_facts: transcript?.facts.filter(f => f.status === "ACTIVE"), assumptions: transcript?.assumptions, answers: transcript?.answers }) },
      { role: "user", content: `EXISTING REQUIREMENTS JSON:\n${JSON.stringify(current, null, 2)}` },
      { role: "user", content: `CHANGE INSTRUCTIONS:\n${input.instructions}` },
    ],
  });
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "requirements" });
  return persistRequirementsDraft(db, {
    projectId: input.projectId,
    userId: input.userId,
    data: result.data,
    aiRunId: result.generationRunId,
    derivedFrom: [{ artifact_id: artifact.id, version: base!.version }],
  });
}

/** Manual edit fallback — always available (C17). */
export async function editRequirementsDraft(
  db: DbExecutor,
  input: { projectId: string; userId: string; data: unknown },
) {
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "requirements" });
  const parsed = RequirementsArtifactSchema.parse(input.data);
  return persistRequirementsDraft(db, {
    projectId: input.projectId,
    userId: input.userId,
    data: parsed,
    aiRunId: null,
    derivedFrom: artifact.approvedRevisionId
      ? [{ artifact_id: artifact.id, version: (await db.select().from(schema.artifactRevisions).where(and(eq(schema.artifactRevisions.artifactId, artifact.id), eq(schema.artifactRevisions.id, artifact.approvedRevisionId))).limit(1))[0]!.version }]
      : [],
  });
}

/** Requirements + ACs for the active approved revision (traceability reads). */
export async function listRequirementsForRevision(db: DbExecutor, revisionId: string) {
  const reqs = await db.select().from(schema.requirements).where(eq(schema.requirements.artifactRevisionId, revisionId));
  const out = [];
  for (const req of reqs) {
    const acs = await db.select().from(schema.acceptanceCriteria).where(eq(schema.acceptanceCriteria.requirementId, req.id));
    out.push({ ...req, acceptance_criteria: acs });
  }
  return out;
}
