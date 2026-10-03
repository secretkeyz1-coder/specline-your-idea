import { desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { CreateProjectInput, ProjectLifecycle } from "@sdd/contracts";
import { errors, newUuid } from "@sdd/shared";
import { audit, type AuditSource } from "../audit/service.js";

/** Project repository + create-project service (T017–T019, FR-002..004). */

export async function nextCounter(db: DbExecutor, projectId: string, kind: string): Promise<number> {
  const [row] = await db.execute(sql`
    INSERT INTO project_counters (project_id, kind, value) VALUES (${projectId}, ${kind}, 1)
    ON CONFLICT (project_id, kind) DO UPDATE SET value = project_counters.value + 1
    RETURNING value
  `);
  const value = (row as { value: number }).value;
  return Number(value);
}

export function displayKey(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

function deriveProjectKey(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8);
  return base.length >= 2 ? base : `PRJ`;
}

export async function createProject(
  db: DbExecutor,
  input: {
    workspaceId: string;
    userId: string;
    source?: AuditSource;
    body: CreateProjectInput;
  },
) {
  // Unique key per workspace (T017). The insert itself is the check: a
  // select-then-insert let two concurrent creates pick the same key and the
  // loser died on the unique index as a 500. ON CONFLICT DO NOTHING turns a
  // taken key into "try the next one" (or a 409 for a caller-chosen key).
  // The project and its audit row commit together.
  return db.transaction(async (tx) => {
    let key = input.body.key ? input.body.key.toUpperCase() : deriveProjectKey(input.body.name);
    let project: typeof schema.projects.$inferSelect | undefined;
    for (let attempt = 0; attempt < 8 && !project; attempt++) {
      if (attempt > 0) key = `${deriveProjectKey(input.body.name)}${Math.floor(Math.random() * 90 + 10)}`;
      [project] = await tx
        .insert(schema.projects)
        .values({
          workspaceId: input.workspaceId,
          key,
          name: input.body.name.trim(),
          highLevelIdea: input.body.high_level_idea.trim(),
          constraints: input.body.constraints ?? [],
          lifecycleStatus: "IDEA_DRAFT",
          createdBy: input.userId,
        })
        .onConflictDoNothing({ target: [schema.projects.workspaceId, schema.projects.key] })
        .returning();
      if (!project && input.body.key) throw errors.conflict("PROJECT_KEY_TAKEN", "Project key already exists in this workspace");
    }
    if (!project) throw errors.conflict("PROJECT_KEY_TAKEN", "Could not allocate a free project key — pass an explicit key");

    await audit(tx, {
      workspaceId: input.workspaceId,
      projectId: project!.id,
      actorType: "USER",
      actorId: input.userId,
      source: input.source ?? "WEB",
      action: "project.created",
      entityType: "PROJECT",
      entityId: project!.id,
      metadata: { key },
    });
    return project!;
  });
}

export async function getProject(db: DbExecutor, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  if (!project) throw errors.notFound("Project", projectId);
  return project;
}

export async function listProjects(db: DbExecutor, workspaceId: string) {
  return db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, workspaceId))
    .orderBy(desc(schema.projects.updatedAt));
}

/**
 * The project list with real progress. The lifecycle enum stops at task
 * generation, so on its own it said "Tasks generated" for projects that were
 * fully built and released; these counts let the UI say where work really is.
 */
export async function listProjectsWithProgress(db: DbExecutor, workspaceId: string) {
  const projects = await listProjects(db, workspaceId);
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const [taskRows, featureRows] = await Promise.all([
    db
      .select({ projectId: schema.tasks.projectId, status: schema.tasks.workflowStatus, n: sql<number>`count(*)::int` })
      .from(schema.tasks)
      .where(inArray(schema.tasks.projectId, ids))
      .groupBy(schema.tasks.projectId, schema.tasks.workflowStatus),
    db
      .select({ projectId: schema.features.projectId, status: schema.features.status, n: sql<number>`count(*)::int` })
      .from(schema.features)
      .where(inArray(schema.features.projectId, ids))
      .groupBy(schema.features.projectId, schema.features.status),
  ]);
  return projects.map((p) => {
    const tasks = taskRows.filter((r) => r.projectId === p.id && r.status !== "CANCELLED");
    const features = featureRows.filter((r) => r.projectId === p.id && r.status !== "CANCELLED");
    const sum = (rows: Array<{ n: number }>) => rows.reduce((a, r) => a + Number(r.n), 0);
    return {
      ...p,
      progress: {
        tasks_total: sum(tasks),
        tasks_done: sum(tasks.filter((r) => r.status === "DONE")),
        // Claimed, running, in review or blocked: the build has begun.
        tasks_started: sum(tasks.filter((r) => r.status !== "DRAFT" && r.status !== "READY")),
        // Submitted work waiting for the user's review.
        tasks_review: sum(tasks.filter((r) => r.status === "NEEDS_REVIEW")),
        features_total: sum(features),
        features_complete: sum(features.filter((r) => r.status === "COMPLETE")),
      },
    };
  });
}

/** Planning progression order; the trailing states are out-of-band flags. */
const LIFECYCLE_ORDER: readonly ProjectLifecycle[] = [
  "IDEA_DRAFT",
  "DISCOVERY_ACTIVE",
  "DISCOVERY_READY",
  "REQUIREMENTS_DRAFT",
  "REQUIREMENTS_APPROVED",
  "STACK_SELECTION",
  "STACK_APPROVED",
  "DESIGN_DRAFT",
  "DESIGN_APPROVED",
  "TASK_GENERATION",
  "TASK_REVIEW",
  "EXECUTION_READY",
];

/**
 * Lifecycle only moves forward by default: drafting new requirements or
 * re-completing discovery must not drag a project that already has an approved
 * design back to an earlier phase. Approvals that genuinely invalidate
 * downstream work (an upstream re-approval marks stack/design STALE) pass
 * `allowRegression`.
 */
/**
 * The project's rules (its constitution) as a prompt block; empty when there
 * are none. Generating prompts that shape the build (stack, design, tasks)
 * carry it, so a rule is never broken at a stage that did not see it.
 */
export function projectRulesLines(rules: string[], purpose: string): string[] {
  return rules.length ? ["", `PROJECT RULES (constitution — ${purpose}):`, ...rules.map((r) => `- ${r}`)] : [];
}

export async function updateLifecycle(
  db: DbExecutor,
  projectId: string,
  lifecycle: ProjectLifecycle,
  options: { allowRegression?: boolean } = {},
): Promise<void> {
  if (!options.allowRegression) {
    const [row] = await db.select({ lifecycle: schema.projects.lifecycleStatus }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
    const current = row ? LIFECYCLE_ORDER.indexOf(row.lifecycle as ProjectLifecycle) : -1;
    const next = LIFECYCLE_ORDER.indexOf(lifecycle);
    if (current >= 0 && next >= 0 && next < current) return;
  }
  await db
    .update(schema.projects)
    .set({ lifecycleStatus: lifecycle, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
}

export async function setActiveRevision(
  db: DbExecutor,
  projectId: string,
  kind: "requirements" | "stack" | "design",
  revisionId: string | null,
): Promise<void> {
  // Drizzle's .set() takes the schema's property keys; the previous version
  // passed the SQL column name and produced an invalid UPDATE.
  const pointer =
    kind === "requirements"
      ? { activeRequirementsRevisionId: revisionId }
      : kind === "stack"
        ? { activeStackRevisionId: revisionId }
        : { activeDesignRevisionId: revisionId };
  await db.update(schema.projects).set({ ...pointer, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
}

export function newProjectId(): string {
  return newUuid();
}
