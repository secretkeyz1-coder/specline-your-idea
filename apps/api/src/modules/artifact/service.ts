import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

function sqlMaxVersion() {
  return sql<number>`coalesce(max(${schema.artifactRevisions.version}), 0)`;
}
import { schema, type DbExecutor } from "@sdd/db";
import { decodeDesignContent, type ArtifactType, type ProjectLifecycle } from "@sdd/contracts";
import { DomainError, errors, sha256Hex } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";
import { setActiveRevision, updateLifecycle } from "../project/service.js";
import { publish, topics } from "../../events/bus.js";

/**
 * Versioned artifact engine (Phase 4, C6, T048–T052).
 * Approved revisions are immutable; a newly approved upstream revision marks
 * derived downstream artifacts STALE so affected tasks revalidate (C6, FR-025).
 */

export type Artifact = typeof schema.artifacts.$inferSelect;
export type ArtifactRevision = typeof schema.artifactRevisions.$inferSelect;

/** Downstream impact order used by stale marking (docs/12 §10). */
const DOWNSTREAM: Partial<Record<ArtifactType, ArtifactType[]>> = {
  discovery: ["requirements"],
  requirements: ["stack", "design", "task_plan", "ux"],
  stack: ["design", "task_plan", "ux", "design_system"],
  design: ["task_plan", "ux"],
  // Only a UI reference drawn WITH the design system depends on it; neutral
  // mockups stay valid when the look changes (see markDerivedArtifactsStale).
  design_system: ["ux"],
};

export async function getOrCreateArtifact(
  db: DbExecutor,
  input: { projectId: string; artifactType: ArtifactType; featureId?: string | null; title?: string },
): Promise<Artifact> {
  const [existing] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, input.projectId), eq(schema.artifacts.artifactType, input.artifactType)))
    .limit(1);
  if (existing) return existing;
  // Concurrent first access (two tabs / a GET and a generate) must not 500 on
  // the (project, type) unique index: insert-or-ignore, then read back.
  const [artifact] = await db
    .insert(schema.artifacts)
    .values({
      projectId: input.projectId,
      artifactType: input.artifactType,
      featureId: input.featureId ?? null,
      title: input.title ?? defaultTitle(input.artifactType),
    })
    .onConflictDoNothing()
    .returning();
  if (artifact) return artifact;
  const [winner] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, input.projectId), eq(schema.artifacts.artifactType, input.artifactType)))
    .limit(1);
  return winner!;
}

function defaultTitle(type: ArtifactType): string {
  const titles: Record<ArtifactType, string> = {
    discovery: "Discovery summary",
    requirements: "Requirements",
    stack: "Technology stack",
    design: "Technical design",
    data_model: "Data model",
    api_contract: "API contracts",
    ux: "UX specification",
    design_system: "Design system",
    uat: "Acceptance tests",
    task_plan: "Task plan",
    convergence: "Convergence report",
  };
  return titles[type];
}

export async function createDraftRevision(
  db: DbExecutor,
  input: {
    artifactId: string;
    content?: string;
    structuredContent?: unknown;
    contentFormat?: "markdown" | "json";
    actorType: "USER" | "AI" | "SYSTEM";
    actorId: string;
    aiGenerationRunId?: string | null;
    derivedFrom?: Array<{ artifact_id: string; version: number }>;
  },
): Promise<ArtifactRevision> {
  return db.transaction(async (tx) => createDraftRevisionTx(tx, input));
}

async function createDraftRevisionTx(
  db: DbExecutor,
  input: Parameters<typeof createDraftRevision>[1],
): Promise<ArtifactRevision> {
  // Row lock on the artifact serializes version allocation: two concurrent
  // generations used to compute the same max+1 and hit a unique violation.
  const [artifact] = await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, input.artifactId)).for("update").limit(1);
  if (!artifact) throw errors.notFound("Artifact", input.artifactId);
  const [{ maxVersion }] = await db
    .select({ maxVersion: sqlMaxVersion() })
    .from(schema.artifactRevisions)
    .where(eq(schema.artifactRevisions.artifactId, input.artifactId));
  const version = (maxVersion ?? 0) + 1;
  const content = input.content ?? "";
  const [revision] = await db
    .insert(schema.artifactRevisions)
    .values({
      artifactId: input.artifactId,
      version,
      contentFormat: input.contentFormat ?? "json",
      content,
      // The schema's shared transport covers every artifact kind. Keep design's
      // existing input normalization and the original checksum calculation.
      structuredContent: artifact.artifactType === "design" && input.structuredContent != null
        ? decodeDesignContent(input.structuredContent)
        : (input.structuredContent ?? null) as ArtifactRevision["structuredContent"],
      status: "DRAFT",
      derivedFrom: input.derivedFrom ?? [],
      aiGenerationRunId: input.aiGenerationRunId ?? null,
      checksum: sha256Hex(content || JSON.stringify(input.structuredContent ?? {})),
      createdByActorType: input.actorType,
      createdByActorId: input.actorId,
    })
    .returning();

  // The newest draft becomes the artifact's current draft.
  await db
    .update(schema.artifacts)
    .set({ currentDraftRevisionId: revision!.id })
    .where(eq(schema.artifacts.id, input.artifactId));
  return revision!;
}

/** Artifacts whose approval moves a project pointer and its lifecycle phase. */
const APPROVED_PHASE: Partial<Record<ArtifactType, { pointer: "requirements" | "stack" | "design"; lifecycle: ProjectLifecycle }>> = {
  requirements: { pointer: "requirements", lifecycle: "REQUIREMENTS_APPROVED" },
  stack: { pointer: "stack", lifecycle: "STACK_APPROVED" },
  design: { pointer: "design", lifecycle: "DESIGN_APPROVED" },
};

/** Approval is immutable + audited (T051, FR-024). */
export async function approveRevision(
  db: DbExecutor,
  input: { revisionId: string; userId: string; note?: string; viaStackFlow?: boolean; source?: AuditSource },
): Promise<ArtifactRevision> {
  const { revision, artifact } = await db.transaction(async (tx) => {
    const [revision] = await tx.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, input.revisionId)).limit(1);
    if (!revision) throw errors.notFound("Artifact revision", input.revisionId);
    // Lock the artifact: concurrent approvals of two drafts must serialize, or
    // each supersedes the other and the pointer lands on a SUPERSEDED revision.
    const [artifact] = await tx.select().from(schema.artifacts).where(eq(schema.artifacts.id, revision.artifactId)).for("update").limit(1);
    if (!artifact) throw errors.notFound("Artifact");
    // Locked too: the checks below (status, UX completeness, lineage) must see
    // the content that gets approved, not a version a concurrent edit replaces.
    const [fresh] = await tx.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, revision.id)).for("update").limit(1);
    if (fresh!.status === "APPROVED") {
      throw errors.conflict("REVISION_ALREADY_APPROVED", "This revision is already approved and immutable");
    }
    if (fresh!.status === "STALE" || fresh!.status === "SUPERSEDED") {
      throw errors.conflict(
        "REVISION_NOT_APPROVABLE",
        `Revision v${fresh!.version} is ${fresh!.status} — regenerate or edit a new draft from the current upstream artifacts`,
        { status: fresh!.status },
      );
    }
    // Only the artifact's current draft is approvable: an older draft left
    // behind by a later generation/edit would otherwise replace the newer work
    // (or a newer approved baseline) with outdated content.
    if (artifact.currentDraftRevisionId && artifact.currentDraftRevisionId !== fresh!.id) {
      throw errors.conflict(
        "REVISION_OUTDATED",
        `Revision v${fresh!.version} is not the current draft — review and approve the newest draft instead`,
        { current_draft_revision_id: artifact.currentDraftRevisionId },
      );
    }
    if (artifact.artifactType === "stack" && !input.viaStackFlow) {
      // A stack baseline is its normalized components; approving a raw AI
      // recommendation draft here would lock a stack with ZERO components.
      throw errors.conflict("STACK_APPROVAL_FLOW", "Approve the stack from the stack selection screen so its components are recorded (FR-036)");
    }
    if (artifact.artifactType === "requirements") {
      const { RequirementsArtifactSchema } = await import("@sdd/contracts");
      const parsed = RequirementsArtifactSchema.safeParse(fresh!.structuredContent);
      if (!parsed.success) throw errors.validation("Requirements contain invalid actor/workflow/criterion references", parsed.error.flatten());
    }
    if (artifact.artifactType === "design") {
      const { designReadinessIssues } = await import("@sdd/contracts");
      const { listRequirementsForRevision } = await import("../planning/requirements.js");
      const baseline = await getApprovedRevision(tx, artifact.projectId, "requirements");
      const reqs = baseline ? await listRequirementsForRevision(tx, baseline.revision.id) : [];
      const issues = designReadinessIssues(fresh!.structuredContent, reqs.map(r => r.key));
      if (issues.length) throw errors.conflict("DESIGN_NOT_READY", "Resolve material design gaps before approval", { issues });
    }
    if (artifact.artifactType === "ux") {
      // Every screen drawn, and no finding that blocks approval (aturan.md §5.4).
      // Loaded on use: the planning modules import this one.
      const { assertUxApprovable } = await import("../ux/ux-approval.js");
      await assertUxApprovable(tx, artifact.projectId, fresh!.structuredContent);
    }
    // A draft is only approvable against the upstream revisions it was built
    // from: approving a design derived from requirements v1 after v2 was
    // approved would silently resurrect the outdated baseline (C6).
    for (const ref of fresh!.derivedFrom ?? []) {
      if (ref.artifact_id === artifact.id) continue; // lineage to its own earlier version
      const [upstream] = await tx.select().from(schema.artifacts).where(eq(schema.artifacts.id, ref.artifact_id)).limit(1);
      if (!upstream) continue;
      if (!upstream.approvedRevisionId) {
        throw errors.conflict("UPSTREAM_NOT_APPROVED", `The ${upstream.artifactType} this draft was built from is no longer approved — approve it first, then regenerate`, {
          upstream_type: upstream.artifactType,
        });
      }
      const [upstreamRev] = await tx.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, upstream.approvedRevisionId)).limit(1);
      // A newer approval with the same content (approved again, unchanged) leaves the draft current.
      if (upstreamRev && upstreamRev.version !== ref.version && !(await sameContentAs(tx, upstreamRev, ref))) {
        throw errors.conflict(
          "DERIVED_FROM_OUTDATED",
          `This draft was built from ${upstream.artifactType} v${ref.version}, but v${upstreamRev.version} is approved now — regenerate it first`,
          { upstream_type: upstream.artifactType, derived_version: ref.version, approved_version: upstreamRev.version },
        );
      }
    }

    // The baseline this approval replaces: approving the same content again changes nothing downstream.
    const [previous] = artifact.approvedRevisionId
      ? await tx.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, artifact.approvedRevisionId)).limit(1)
      : [];
    const unchanged = Boolean(previous && contentFingerprint(previous) === contentFingerprint(fresh!));

    await tx
      .update(schema.artifactRevisions)
      .set({ status: "APPROVED", approvedBy: input.userId, approvedAt: new Date(), approvalNote: input.note ?? "" })
      .where(eq(schema.artifactRevisions.id, revision.id));
    // Supersede the previously approved revision and any other open draft of
    // the same artifact (not this one): one baseline, nothing stale left approvable.
    await tx
      .update(schema.artifactRevisions)
      .set({ status: "SUPERSEDED" })
      .where(
        and(
          eq(schema.artifactRevisions.artifactId, revision.artifactId),
          inArray(schema.artifactRevisions.status, ["APPROVED", "DRAFT"]),
          ne(schema.artifactRevisions.id, revision.id),
        ),
      );
    await tx.update(schema.artifacts).set({ approvedRevisionId: revision.id }).where(eq(schema.artifacts.id, artifact.id));
    if (!unchanged) await markDerivedArtifactsStale(tx, artifact.projectId, artifact.artifactType, fresh!);

    // The project's active-revision pointer and lifecycle commit with the
    // approval: a failure between them used to leave an approved baseline the
    // project did not point at. Re-approving an upstream artifact marks
    // downstream STALE, so the project legitimately moves back to this phase.
    const phase = APPROVED_PHASE[artifact.artifactType];
    if (phase) {
      await setActiveRevision(tx, artifact.projectId, phase.pointer, revision.id);
      await updateLifecycle(tx, artifact.projectId, phase.lifecycle, { allowRegression: true });
    }

    const [project] = await tx.select({ workspaceId: schema.projects.workspaceId }).from(schema.projects).where(eq(schema.projects.id, artifact.projectId)).limit(1);
    await audit(tx, {
      workspaceId: project!.workspaceId,
      projectId: artifact.projectId,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: `artifact.${artifact.artifactType}.approved`,
      entityType: "ARTIFACT_REVISION",
      entityId: revision.id,
      metadata: { artifact_type: artifact.artifactType, version: fresh!.version, checksum: fresh!.checksum },
    });
    return { revision: fresh!, artifact };
  });

  publish({
    topic: topics.project(artifact.projectId),
    type: `artifact_approved:${artifact.artifactType}`,
    payload: { artifact_id: artifact.id, revision_id: revision.id },
  });

  const [updated] = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, revision.id)).limit(1);
  return updated!;
}

/**
 * JSON with its keys sorted, so the same content always reads the same
 * whichever order it was built or stored in.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * What a revision says, without what only records how it was reviewed: for a
 * UI reference the stored findings, comments, undo history and the scope
 * confirmation are left out — a comment added to a copy does not make it
 * different content.
 */
function comparableContent(revision: Pick<ArtifactRevision, "structuredContent">): unknown {
  const s = revision.structuredContent as Record<string, unknown> | null;
  if (!s || !Array.isArray(s.screens)) return s;
  const { plan_lint: _p, scope_confirmed_at: _c, ...rest } = s;
  return {
    ...rest,
    screens: (s.screens as Array<Record<string, unknown>>).map(({ lint: _l, comments: _m, history: _h, revision_note: _n, ...screen }) => screen),
  };
}

/** The content of a revision as one hash: equal when two revisions say the same thing (aturan.md §1.1). */
export function contentFingerprint(revision: Pick<ArtifactRevision, "content" | "structuredContent">): string {
  return sha256Hex(`${revision.content ?? ""}\n${stableJson(comparableContent(revision))}`);
}

/** Whether a revision says the same as the version of its artifact a reference points at. */
async function sameContentAs(db: DbExecutor, revision: ArtifactRevision, ref: { artifact_id: string; version: number }): Promise<boolean> {
  if (revision.artifactId !== ref.artifact_id) return false;
  if (revision.version === ref.version) return true;
  const [used] = await db
    .select()
    .from(schema.artifactRevisions)
    .where(and(eq(schema.artifactRevisions.artifactId, ref.artifact_id), eq(schema.artifactRevisions.version, ref.version)))
    .limit(1);
  return Boolean(used && contentFingerprint(used) === contentFingerprint(revision));
}

/**
 * Whether a reference to an upstream version is still current against the
 * approved revision: the same version, or another version with the same content.
 */
export async function isRefCurrent(
  db: DbExecutor,
  ref: { artifact_id: string; version: number } | undefined,
  approved: { artifact: { id: string }; revision: ArtifactRevision } | null,
): Promise<boolean> {
  if (!ref || !approved || ref.artifact_id !== approved.artifact.id) return false;
  return sameContentAs(db, approved.revision, ref);
}

/**
 * Downstream artifacts become STALE when an upstream revision with different
 * content is approved (T052, aturan.md §1.1). Only revisions built on an
 * upstream version whose content differs are marked: each records the
 * versions it used (derivedFrom). A revision that recorded none is treated as
 * built on the old one. Nothing is deleted — STALE asks for an impact check.
 */
export async function markDerivedArtifactsStale(
  db: DbExecutor,
  projectId: string,
  upstreamType: ArtifactType,
  approved?: ArtifactRevision,
): Promise<void> {
  const downstream = DOWNSTREAM[upstreamType];
  if (!downstream) return;
  for (const type of downstream) {
    const [artifact] = await db
      .select()
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.projectId, projectId), eq(schema.artifacts.artifactType, type)))
      .limit(1);
    if (!artifact) continue;
    // Approved AND draft revisions built on the previous upstream are stale:
    // drafts too, or the UI keeps offering "Approve vN" for an outdated draft.
    const revisions = await db
      .select()
      .from(schema.artifactRevisions)
      .where(and(eq(schema.artifactRevisions.artifactId, artifact.id), inArray(schema.artifactRevisions.status, ["APPROVED", "DRAFT"])));
    const affected: ArtifactRevision[] = [];
    for (const r of revisions) {
      // Only a UI reference drawn WITH the design system depends on it; neutral mockups stay valid when the look changes.
      if (upstreamType === "design_system" && (r.structuredContent as { fidelity?: string } | null)?.fidelity !== "styled") continue;
      const ref = approved ? (r.derivedFrom ?? []).find((d) => d.artifact_id === approved.artifactId) : undefined;
      if (ref && approved && (await sameContentAs(db, approved, ref))) continue;
      affected.push(r);
    }
    if (affected.length === 0) continue;
    await db.update(schema.artifactRevisions).set({ status: "STALE" }).where(inArray(schema.artifactRevisions.id, affected.map((r) => r.id)));
    if (affected.some((r) => r.id === artifact.approvedRevisionId)) {
      await db.update(schema.artifacts).set({ approvedRevisionId: null }).where(eq(schema.artifacts.id, artifact.id));
    }
  }
}

export async function getArtifactWithRevisions(db: DbExecutor, artifactId: string) {
  const artifact = (await db.select().from(schema.artifacts).where(eq(schema.artifacts.id, artifactId)).limit(1))[0];
  if (!artifact) throw errors.notFound("Artifact", artifactId);
  const revisions = await db
    .select()
    .from(schema.artifactRevisions)
    .where(eq(schema.artifactRevisions.artifactId, artifactId))
    .orderBy(desc(schema.artifactRevisions.version));
  return { artifact, revisions };
}

export async function getRevision(db: DbExecutor, revisionId: string): Promise<ArtifactRevision> {
  const [revision] = await db.select().from(schema.artifactRevisions).where(eq(schema.artifactRevisions.id, revisionId)).limit(1);
  if (!revision) throw errors.notFound("Artifact revision", revisionId);
  return revision;
}

export async function getApprovedRevision(
  db: DbExecutor,
  projectId: string,
  type: ArtifactType,
): Promise<{ artifact: Artifact; revision: ArtifactRevision } | null> {
  const [artifact] = await db
    .select()
    .from(schema.artifacts)
    .where(and(eq(schema.artifacts.projectId, projectId), eq(schema.artifacts.artifactType, type)))
    .limit(1);
  if (!artifact?.approvedRevisionId) return null;
  const revision = await getRevision(db, artifact.approvedRevisionId);
  return { artifact, revision: type === "design" ? { ...revision, structuredContent: decodeDesignContent(revision.structuredContent) } : revision };
}

export function structuredOf<T>(revision: ArtifactRevision): T | null {
  return (revision.structuredContent as T | null) ?? null;
}

export class StaleArtifactError extends DomainError {
  constructor(type: string) {
    super("ARTIFACT_STALE", `The approved ${type} artifact is stale — regenerate or re-approve it first`, 409, { artifact_type: type });
    this.name = "StaleArtifactError";
  }
}

export { asc };
