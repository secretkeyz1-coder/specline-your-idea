import { and, eq } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import { getTask, linkTaskRequirement, traceabilityOf, type TaskRow } from "./repo.js";
import { getApprovedRevision } from "../artifact/service.js";
import { listRequirementsForRevision } from "../planning/requirements.js";
import { publish, topics } from "../../events/bus.js";
import { computeTaskReadiness } from "./readiness.js";
import { deriveTaskRisk } from "./lint.js";
import { approvedUxReference, uxFilePath } from "../ux/ux.js";
import { screenConstraint } from "./generation.js";
import { parseVerificationCommand } from "@sdd/contracts";

/** Server-generated fix tasks (bugs, convergence findings): inherited links, scope and checks, then readiness. */

/**
 * Context for server-generated fix tasks (bug fixes, convergence findings):
 * inherit traceability and scope from the most specific source available, and
 * pin the current approved revisions, so the task can actually pass the linter
 * instead of sitting in DRAFT forever with empty scope and no links.
 */
export async function deriveFixTaskContext(
  db: DbExecutor,
  input: { projectId: string; featureId?: string | null; sourceTaskId?: string | null; requirementKey?: string | null; acceptanceCriterionKey?: string | null },
) {
  const approvedReq = await getApprovedRevision(db, input.projectId, "requirements");
  const approvedStack = await getApprovedRevision(db, input.projectId, "stack");
  const approvedDesign = await getApprovedRevision(db, input.projectId, "design");
  const approvedDs = await getApprovedRevision(db, input.projectId, "design_system");
  const revisionRefs = [approvedReq, approvedStack, approvedDesign, await getApprovedRevision(db, input.projectId, "ux"), approvedDs]
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ artifact_id: r.artifact.id, version: r.revision.version }));

  const links: Array<{ requirementId: string; acceptanceCriterionId: string | null }> = [];
  const paths = new Set<string>();
  const forbidden = new Set<string>();
  // The project's own checks, taken from the tasks that built the code being
  // fixed — a hardcoded `bun test` was wrong for every non-Bun project.
  const commands = new Set<string>();
  const constraints = new Set<string>();
  const screens = new Set<string>();
  const criteria = new Set<string>();
  let riskFactors: TaskRow["riskFactors"] = { ambiguity: 1, blast_radius: 1, cross_module: 0, concurrency: 0, database_impact: 0, security: 0, integration: 0, verification: 1, context_size: 0 };
  let humanRequired = false;
  const manualChecks = new Set<string>();
  const inherit = (t: TaskRow) => {
    humanRequired ||= t.reviewPolicy === "HUMAN_REQUIRED";
    for (const r of t.contract.verification?.required ?? []) if (r.type === "manual") manualChecks.add(r.command);
    for (const p of t.contract.scope?.expected_paths ?? []) paths.add(p);
    for (const p of t.contract.scope?.forbidden_paths ?? []) forbidden.add(p);
    for (const c of t.contract.constraints ?? []) constraints.add(c);
    for (const k of t.contract.ui_screen_keys ?? []) screens.add(k);
    for (const c of t.contract.acceptance_criteria ?? []) criteria.add(c);
    for (const key of Object.keys(riskFactors) as Array<keyof typeof riskFactors>) riskFactors[key] = Math.max(riskFactors[key], t.contract.risk_factors[key] ?? 0);
    for (const r of t.contract.verification?.required ?? []) if (r.type !== "manual") commands.add(r.command);
  };

  if (input.sourceTaskId) {
    const source = await getTask(db, input.sourceTaskId).catch(() => null);
    if (source && source.projectId === input.projectId) {
      for (const l of await traceabilityOf(db, source.id)) links.push({ requirementId: l.requirement.id, acceptanceCriterionId: l.ac?.id ?? null });
      inherit(source);
    }
  }
  if (links.length === 0 && approvedReq && input.requirementKey) {
    const requirements = await listRequirementsForRevision(db, approvedReq.revision.id);
    const req = requirements.find((r) => r.key.toUpperCase() === input.requirementKey!.toUpperCase());
    if (req) {
      const ac = input.acceptanceCriterionKey ? req.acceptance_criteria.find((a) => a.key.toUpperCase() === input.acceptanceCriterionKey!.toUpperCase()) : undefined;
      links.push({ requirementId: req.id, acceptanceCriterionId: ac?.id ?? null });
    }
  }
  // The tasks that implemented this requirement, in whichever feature they
  // live: that is where the code to fix is. (Only the finding's own feature was
  // searched before, so a requirement built under another feature produced a
  // fix task with no scope that could never pass lint.)
  if (input.requirementKey && paths.size === 0) {
    const implementing = await db
      .select({ task: schema.tasks })
      .from(schema.taskRequirementLinks)
      .innerJoin(schema.requirements, eq(schema.requirements.id, schema.taskRequirementLinks.requirementId))
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskRequirementLinks.taskId))
      .where(and(eq(schema.tasks.projectId, input.projectId), eq(schema.requirements.key, input.requirementKey)));
    for (const { task } of implementing) if (task.workflowStatus !== "CANCELLED") inherit(task);
  }
  if (input.featureId && (links.length === 0 || paths.size === 0)) {
    const featureTasks = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.projectId, input.projectId), eq(schema.tasks.featureId, input.featureId)));
    for (const t of featureTasks) {
      if (t.workflowStatus === "CANCELLED") continue;
      inherit(t);
      if (links.length < 5) {
        for (const l of await traceabilityOf(db, t.id)) {
          if (!links.some((x) => x.requirementId === l.requirement.id)) links.push({ requirementId: l.requirement.id, acceptanceCriterionId: null });
        }
      }
    }
  }
  const ux = await approvedUxReference(db, input.projectId);
  for (const s of ux?.screens ?? []) if (input.requirementKey && s.requirement_keys.includes(input.requirementKey)) {
    screens.add(s.key);
    constraints.add(screenConstraint(ux!.fidelity === "styled", Boolean(approvedDs)).replace("<file>", uxFilePath(s.key)));
    for (const element of s.key_elements) criteria.add(`Preserve screen element: ${element}`.slice(0, 600));
    if (ux!.platform?.kind !== "native-mobile" && ![...commands].some(c => c.includes(`e2e/render/${s.key}.spec.`))) {
      const runner = [...commands].some(c => /^bun/.test(c)) ? "bunx" : [...commands].some(c => /^pnpm/.test(c)) ? "pnpm exec" : "npx";
      commands.add(`${runner} playwright test e2e/render/${s.key}.spec.ts`);
    }
  }
  const design = approvedDesign?.revision.structuredContent as { testing_strategy?: string } | null;
  if (!commands.size && design?.testing_strategy) {
    for (const m of design.testing_strategy.matchAll(/`([^`]+)`/g)) if (parseVerificationCommand(m[1]!).ok && commands.size < 4) commands.add(m[1]!);
  }
  if (commands.size + manualChecks.size > 6 || constraints.size > 10 || criteria.size > 18 || screens.size > 20 || forbidden.size > 20 || paths.size > 20 || links.length > 10) throw (await import("@sdd/shared")).errors.validation("Fix exceeds the atomic contract budget; split its scope instead of dropping inherited checks or constraints");
  return {
    revisionRefs,
    links,
    scope: { expected_paths: [...paths], forbidden_paths: [...forbidden] },
    constraints: [...constraints],
    ui_screen_keys: [...screens],
    acceptance_criteria: [...criteria],
    riskFactors,
    risk: { ...deriveTaskRisk({ risk_factors: riskFactors, task_type: "code" } as TaskRow["contract"]), ...(humanRequired ? { reviewPolicy: "HUMAN_REQUIRED" as const } : {}) },
    verification: {
      required: [...[...commands].map(command => ({ type: "command" as const, command })), ...[...manualChecks].map(command => ({ type: "manual" as const, command }))],
    },
  };
}

/**
 * Attach derived links to a freshly created fix task, compute readiness, and —
 * like a generated plan — move it to READY when it passes, so it shows up on
 * the board and an agent can claim it. A DRAFT fix task was invisible there.
 */
export async function applyFixTaskContext(db: DbExecutor, taskId: string, links: Array<{ requirementId: string; acceptanceCriterionId: string | null }>) {
  for (const link of links) await linkTaskRequirement(db, { taskId, requirementId: link.requirementId, acceptanceCriterionId: link.acceptanceCriterionId });
  const task = await computeTaskReadiness(db, await getTask(db, taskId));
  if (task.readinessStatus !== "READY" || task.workflowStatus !== "DRAFT") return task;
  const [readied] = await db
    .update(schema.tasks)
    .set({ workflowStatus: "READY", updatedAt: new Date() })
    .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.workflowStatus, "DRAFT")))
    .returning();
  if (!readied) return task;
  publish({ topic: topics.project(task.projectId), type: "task_transitioned", payload: { task_id: task.id, from: "DRAFT", to: "READY" } });
  return readied;
}
