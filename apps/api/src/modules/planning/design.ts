import { eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { decodeDesignContent, DesignArtifactSchema, type DesignArtifact, type RequirementsArtifact } from "@sdd/contracts";
import { designPathExists, productContext } from "./quality.js";
import { errors } from "@sdd/shared";
import type { GatewayDeps } from "@sdd/ai";
import { runStructured, DESIGN_SYSTEM_PROMPT } from "@sdd/ai";
import {
  getApprovedRevision,
  createDraftRevision,
  getOrCreateArtifact,
  StaleArtifactError,
} from "../artifact/service.js";
import { listRequirementsForRevision } from "./requirements.js";
import { listStackComponents } from "./stack.js";
import { renderDesignMarkdown } from "./render.js";
import { getProject, projectRulesLines, updateLifecycle } from "../project/service.js";

/**
 * Technical design (Phase 7, T072–T076, FR-040..047).
 * Inputs are explicitly the approved requirements and stack revisions (T073).
 */

export async function generateDesign(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string },
) {
  const project = await getProject(db, input.projectId);
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  if (!approvedReq) throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve requirements before design generation");
  const approvedStack = await getApprovedRevision(db, input.projectId, "stack");
  if (!approvedStack) throw errors.conflict("STACK_NOT_APPROVED", "Approve the stack baseline before technical design is finalized (FR-036)");

  const reqs = await listRequirementsForRevision(db, approvedReq.revision.id);
  const stackRows = await listStackComponents(db, approvedStack.revision.id);

  const context = [
    `PROJECT: ${project.name}`,
    `IDEA: ${project.highLevelIdea}`,
    `REQUIREMENTS REVISION: ${approvedReq.revision.id} v${approvedReq.revision.version}`,
    `STACK REVISION: ${approvedStack.revision.id} v${approvedStack.revision.version}`,
    "",
    "APPROVED STACK:",
    ...stackRows.map((s) => `- ${s.category}: ${s.technology}${s.versionConstraint ? ` (${s.versionConstraint})` : ""}`),
    "",
    "APPROVED REQUIREMENTS:",
    ...reqs.map(
      (r) =>
        `- ${r.key} [${r.priority}] ${r.title}\n  ${r.statement}\n${r.acceptance_criteria.map((ac) => `  · ${ac.key}: ${ac.statement}`).join("\n")}`,
    ),
    ...projectRulesLines(project.projectRules, "the design must respect them"),
    ...productContext(approvedReq.revision.structuredContent as RequirementsArtifact),
  ].join("\n");

  const result = await runStructured(gateway, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    role: "ARCHITECTURE",
    schema: DesignArtifactSchema,
    schemaName: "DesignArtifact",
    system: DESIGN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: context }],
  });

  const data = analyzeDesignCoverage(result.data, reqs);
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "design" });
  const revision = await createDraftRevision(db, {
    artifactId: artifact.id,
    structuredContent: data,
    content: renderDesignMarkdown(data),
    actorType: "AI",
    actorId: input.userId,
    aiGenerationRunId: result.generationRunId,
    derivedFrom: [
      { artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version },
      { artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version },
    ],
  });
  await updateLifecycle(db, input.projectId, "DESIGN_DRAFT");
  return { artifact, revision, design: data };
}

/** Design coverage analyzer: requirements lacking a design path (T075). */
export function analyzeDesignCoverage(
  design: DesignArtifact,
  requirements: Array<{ key: string; title: string; acceptance_criteria: unknown[] }>,
): DesignArtifact {
  const covered = new Set(design.requirement_coverage.map((c) => c.requirement_key));
  const missing = requirements.filter((r) => !covered.has(r.key));
  return {
    ...design,
    requirement_coverage: [
      ...design.requirement_coverage.filter(c => requirements.some(r => r.key === c.requirement_key)).map(c => ({ ...c, status: c.status === "PATH_DEFINED" && !designPathExists(design, c.design_section) ? "NO_PATH" as const : c.status })),
      ...missing.map((r) => ({
        requirement_key: r.key,
        design_section: "(no design path identified)",
        status: "NO_PATH" as const,
      })),
    ],
  };
}

export async function refineDesign(
  gateway: GatewayDeps,
  db: DbExecutor,
  input: { projectId: string; userId: string; section: string; instructions: string },
) {
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  if (!approvedReq) throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve requirements before refining the design");
  const approvedStack = await getApprovedRevision(db, input.projectId, "stack");
  if (!approvedStack) throw errors.conflict("STACK_NOT_APPROVED", "Approve the stack baseline before refining the design (FR-036)");
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "design" });
  const stored = artifact.currentDraftRevisionId
    ? (((await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, artifact.currentDraftRevisionId)).limit(1))[0] ?? null)?.structuredContent as DesignArtifact | null)
    : null;
  if (!stored) throw errors.conflict("NO_DESIGN_DRAFT", "Generate a design before refining");
  const current = DesignArtifactSchema.parse(decodeDesignContent(stored));
  const project = await getProject(db, input.projectId);
  const requirements = await listRequirementsForRevision(db, approvedReq.revision.id);
  const stack = await listStackComponents(db, approvedStack.revision.id);

  const result = await runStructured(gateway, {
    workspaceId: (await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).limit(1))[0]!.workspaceId,
    projectId: input.projectId,
    role: "ARCHITECTURE",
    schema: DesignArtifactSchema,
    schemaName: "DesignArtifact",
    system: `${DESIGN_SYSTEM_PROMPT}\n\nThis is a REFINEMENT pass for section "${input.section}". Apply the change instructions while preserving all other sections exactly.`,
    messages: [
      { role: "user", content: JSON.stringify({ approved_requirements: requirements, approved_product: approvedReq.revision.structuredContent, approved_stack: stack, project_rules: project.projectRules }) },
      { role: "user", content: `EXISTING DESIGN JSON:\n${JSON.stringify(current, null, 2)}` },
      { role: "user", content: `CHANGE INSTRUCTIONS:\n${input.instructions}` },
    ],
  });
  const data = analyzeDesignCoverage(DesignArtifactSchema.parse(result.data), requirements);
  const revision = await createDraftRevision(db, {
    artifactId: artifact.id,
    structuredContent: data,
    content: renderDesignMarkdown(data),
    actorType: "AI",
    actorId: input.userId,
    aiGenerationRunId: result.generationRunId,
    derivedFrom: [
      { artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version },
      { artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version },
    ],
  });
  return { artifact, revision, design: data };
}

/** Manual design fallback — always available (C17).
 *
 * Mirrors `editRequirementsDraft`: the user may author or replace the technical
 * design themselves when no AI provider is configured (byo-provider, C21), or
 * when they simply prefer to hand-write it. Without this, design generation was
 * the only planning step with NO non-AI path, which contradicted C17 and the
 * README's "everything still works through deterministic fallbacks" promise.
 */
export async function editDesignDraft(
  db: DbExecutor,
  input: { projectId: string; userId: string; data: unknown },
) {
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  if (!approvedReq) {
    throw errors.conflict("REQUIREMENTS_NOT_APPROVED", "Approve requirements before authoring the technical design");
  }
  // Same gate as generateDesign: the design is written against a locked stack.
  const approvedStack = await getApprovedRevision(db, input.projectId, "stack");
  if (!approvedStack) {
    throw errors.conflict("STACK_NOT_APPROVED", "Approve the stack baseline before the technical design is authored (FR-036)");
  }
  const artifact = await getOrCreateArtifact(db, { projectId: input.projectId, artifactType: "design" });
  const parsed = DesignArtifactSchema.parse(decodeDesignContent(input.data));
  const reqs = await listRequirementsForRevision(db, approvedReq.revision.id);
  // Same coverage analyzer the AI path uses, so manual designs get identical
  // "no design path" findings for uncovered requirements.
  const data = analyzeDesignCoverage(parsed, reqs);
  const revision = await createDraftRevision(db, {
    artifactId: artifact.id,
    structuredContent: data,
    content: renderDesignMarkdown(data),
    actorType: "USER",
    actorId: input.userId,
    aiGenerationRunId: null,
    derivedFrom: [
      { artifact_id: approvedReq.artifact.id, version: approvedReq.revision.version },
      { artifact_id: approvedStack.artifact.id, version: approvedStack.revision.version },
    ],
  });
  await updateLifecycle(db, input.projectId, "DESIGN_DRAFT");
  return { artifact, revision, design: data };
}

/** Guard used by the task engine: design must be approved AND current (C6). */
export async function requireApprovedDesign(db: DbExecutor, projectId: string) {
  const approved = await getApprovedRevision(db, projectId, "design");
  if (!approved) throw errors.conflict("DESIGN_NOT_APPROVED", "Approve the technical design before task generation");
  if (approved.revision.status !== "APPROVED") throw new StaleArtifactError("design");
  return approved;
}
