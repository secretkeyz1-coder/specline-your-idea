import { eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { AgentContextPack } from "@sdd/contracts";
import { getApprovedRevision } from "../artifact/service.js";
import { listStackComponents } from "../planning/stack.js";
import { listTasks, getTask } from "../task/repo.js";
import { buildContextPack } from "../prompt/service.js";
import { renderStandalonePrompt } from "../prompt/service.js";

/**
 * Export & portability (Phase 20, T201–T204, NFR-007).
 * Markdown is a portable snapshot; the database remains the authority (C5).
 */

export async function exportProjectMarkdown(db: DbExecutor, projectId: string): Promise<string> {
  const project = (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1))[0]!;
  const out: string[] = [];
  out.push(`# ${project.name} (${project.key})`);
  out.push(`\n> Exported from Agentic SDD Control Plane. Database state remains authoritative.`);
  out.push(`\n## High-level idea\n\n${project.highLevelIdea}`);
  if (project.constraints.length) out.push(`\n## Constraints\n\n${project.constraints.map((c) => `- ${c}`).join("\n")}`);

  const requirements = await getApprovedRevision(db, projectId, "requirements");
  if (requirements) {
    out.push(`\n---\n\n# Requirements (v${requirements.revision.version})\n`);
    out.push(requirements.revision.content);
  }
  const stack = await getApprovedRevision(db, projectId, "stack");
  if (stack) {
    const components = await listStackComponents(db, stack.revision.id);
    out.push(`\n---\n\n# Stack (v${stack.revision.version})\n`);
    if (components.length) {
      out.push(`| Category | Technology | Version | Source | Rationale |`);
      out.push(`|---|---|---|---|---|`);
      for (const c of components) out.push(`| ${c.category} | ${c.technology} | ${c.versionConstraint ?? "—"} | ${c.selectionSource} | ${c.rationale} |`);
    } else {
      out.push(stack.revision.content);
    }
  }
  const design = await getApprovedRevision(db, projectId, "design");
  if (design) {
    out.push(`\n---\n\n# Technical design (v${design.revision.version})\n`);
    out.push(design.revision.content);
  }
  return out.join("\n");
}

export async function exportTaskWorkOrder(db: DbExecutor, taskId: string): Promise<{ json: string; markdown: string }> {
  const task = await getTask(db, taskId);
  const pack = await buildContextPack(db, task);
  const workOrder = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    task: { ...task, created_at: task.createdAt.toISOString(), updated_at: task.updatedAt.toISOString() },
    context: pack,
  };
  return { json: JSON.stringify(workOrder, null, 2), markdown: renderStandalonePrompt(pack as AgentContextPack) };
}

export async function exportAgentsMd(db: DbExecutor, projectId: string): Promise<string> {
  const project = (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1))[0]!;
  const out: string[] = [];
  out.push(`# AGENTS.md — ${project.name}`);
  out.push(`\nRepository instructions exported from the Agentic SDD Control Plane.`);
  out.push(`\n## Project`);
  out.push(`- Project key: ${project.key}`);
  out.push(`\n## Idea\n\n${project.highLevelIdea}`);
  if (project.projectRules.length) {
    out.push(`\n## Project rules (binding)\n`);
    for (const rule of project.projectRules) out.push(`- ${rule}`);
  }
  const stack = await getApprovedRevision(db, projectId, "stack");
  if (stack) {
    const components = await listStackComponents(db, stack.revision.id);
    out.push(`\n## Approved technology stack\n`);
    for (const c of components) out.push(`- ${c.category}: ${c.technology}${c.versionConstraint ? ` (${c.versionConstraint})` : ""}`);
  }
  out.push(`\n## Execution discipline`);
  out.push(`- Implement one bounded task at a time; never modify unrelated code.`);
  out.push(`- Never claim a test passed if it was not run.`);
  out.push(`- If instructions here conflict with an approved task work order, stop and report the conflict.`);
  return out.join("\n");
}

/** Portable bundle index (T204) — deterministic metadata, no secrets (C13). */
export async function exportBundle(db: DbExecutor, projectId: string): Promise<{ files: Record<string, string>; index: Record<string, unknown> }> {
  const project = (await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1))[0]!;
  const files: Record<string, string> = {};
  files["README.md"] = await exportProjectMarkdown(db, projectId);
  files["AGENTS.md"] = await exportAgentsMd(db, projectId);

  const tasks = await listTasks(db, projectId);
  const workOrders: string[] = [];
  for (const t of tasks) {
    const { json } = await exportTaskWorkOrder(db, t.id);
    files[`tasks/${t.key}.work-order.json`] = json;
    workOrders.push(t.key);
  }
  const requirements = await getApprovedRevision(db, projectId, "requirements");
  const stack = await getApprovedRevision(db, projectId, "stack");
  const design = await getApprovedRevision(db, projectId, "design");
  const index = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    project: {
      id: project.id,
      key: project.key,
      name: project.name,
      lifecycle: project.lifecycleStatus,
      rules: project.projectRules.length,
    },
    revisions: {
      requirements: requirements ? { version: requirements.revision.version, checksum: requirements.revision.checksum } : null,
      stack: stack ? { version: stack.revision.version, checksum: stack.revision.checksum } : null,
      design: design ? { version: design.revision.version, checksum: design.revision.checksum } : null,
    },
    task_count: tasks.length,
    task_keys: workOrders,
    note: "Markdown/JSON export is a portable snapshot. The control-plane database remains the runtime source of truth.",
  };
  files["index.json"] = JSON.stringify(index, null, 2);
  return { files, index };
}
