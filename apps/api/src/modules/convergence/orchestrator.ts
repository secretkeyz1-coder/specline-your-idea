import { and, eq, sql } from "drizzle-orm";
import { schema, type DbExecutor } from "@sdd/db";
import type { GatewayDeps } from "@sdd/ai";
import { getProject } from "../project/service.js";
import { getApprovedRevision } from "../artifact/service.js";
import { listAllTasks } from "../task/repo.js";
import { startConvergenceRun, listConvergenceRuns, generateTaskFromFinding, evaluateProjectCompletionGates, completeFeature } from "./service.js";

/** One durable review/fix pass. Newly READY fixes are picked up by the existing scheduler; the next completion starts another pass. */
export async function orchestrateProject(gateway: GatewayDeps, db: DbExecutor, projectId: string, userId: string) {
  // ponytail: renewable three-hour project lease; no transaction/pool connection is held while the model runs.
  const token = crypto.randomUUID();
  const [claimed] = await db.update(schema.projects).set({ deliveryLockToken: token, deliveryLockExpiresAt: new Date(Date.now() + 3 * 60 * 60_000) })
    .where(and(eq(schema.projects.id, projectId), sql`(${schema.projects.deliveryLockExpiresAt} IS NULL OR ${schema.projects.deliveryLockExpiresAt} < now())`)).returning({ id: schema.projects.id });
  if (!claimed) return { status: "RUNNING", message: "Release review is already running or project is unavailable" };
  try {
    const executor = db;
    const scopedGateway = { ...gateway, db: executor };
    const project = await getProject(executor, projectId);
    if (project.archivedAt) return { status: "HUMAN_ACTION_REQUIRED", message: "Project is archived" };
    const tasks = (await listAllTasks(executor, projectId)).filter(t => t.workflowStatus !== "CANCELLED");
    if (!tasks.length || tasks.some(t => t.workflowStatus !== "DONE")) return { status: "BUILDING", message: "Tasks still need execution or human review" };
    const baseline = await getApprovedRevision(executor, projectId, "requirements");
    const features = await executor.select().from(schema.features).where(and(eq(schema.features.projectId, projectId)));
    if (!features.some(f => f.status !== "CANCELLED")) return { status: "HUMAN_ACTION_REQUIRED", message: "No releasable feature is assigned" };
    let generated = 0;
    const initialGates = await evaluateProjectCompletionGates(executor, projectId);
    for (const feature of features.filter(f => f.status !== "CANCELLED")) {
      const [renewed] = await db.update(schema.projects).set({ deliveryLockExpiresAt: new Date(Date.now() + 3 * 60 * 60_000) }).where(and(eq(schema.projects.id, projectId), eq(schema.projects.deliveryLockToken, token))).returning({ id: schema.projects.id });
      if (!renewed) return { status: "HUMAN_ACTION_REQUIRED", message: "Release review lease changed; rerun against current evidence" };
      const gate = initialGates.find(g => g.feature.id === feature.id);
      if (gate?.gate.canComplete) {
        if (feature.status !== "COMPLETE") await completeFeature(executor, { featureId: feature.id, userId, source: "SYSTEM" });
        continue;
      }
      if (gate?.gate.blockers.uncovered_requirements.length) return { status: "HUMAN_ACTION_REQUIRED", message: `Requirements have no tasks: ${gate.gate.blockers.uncovered_requirements.join(", ")}` };
      const previous = await listConvergenceRuns(executor, feature.id);
      if (previous[0]?.run.status === "FAILED") return { status: "HUMAN_ACTION_REQUIRED", message: `${feature.key}: previous release review failed; inspect the provider or missing evidence and retry Convergence manually` };
      const repairRounds = previous.filter(r => r.run.requirementsRevisionId === baseline?.revision.id && r.findings.some(f => f.generatedTaskId)).length;
      if (repairRounds >= 3) return { status: "HUMAN_ACTION_REQUIRED", message: `${feature.key}: three repair rounds exhausted; inspect the remaining findings` };
      let featureGenerated = 0;
      let checked;
      try { checked = await startConvergenceRun(scopedGateway, executor, { featureId: feature.id, userId, source: "SYSTEM" }); }
      catch (error) { return { status: "HUMAN_ACTION_REQUIRED", message: error instanceof Error ? error.message : "Release review failed" }; }
      const gaps = (await listConvergenceRuns(executor, feature.id)).find(r => r.run.id === checked.run.id)?.findings ?? [];
      for (const finding of gaps.filter(f => ["BLOCKING", "HIGH"].includes(f.severity) && f.findingType !== "COVERED")) {
        if (/\b(specification|baseline|requirement|requirements|spesifikasi|kebutuhan)\b.*\b(conflict|contradict|ambiguous|bertentangan|kontradiksi|ambigu)/i.test(finding.description)) return { status: "HUMAN_ACTION_REQUIRED", message: `${feature.key}: correct the approved specification before generating an implementation fix` };
        let fix;
        try { fix = await generateTaskFromFinding(executor, { findingId: finding.id, userId }); }
        catch (error) { return { status: "HUMAN_ACTION_REQUIRED", message: error instanceof Error ? error.message : "Fix task needs manual scope repair" }; }
        generated++; featureGenerated++;
        if (fix.task.workflowStatus !== "READY") return { status: "HUMAN_ACTION_REQUIRED", message: `${fix.task.key}: fix contract needs scope or verification before execution`, generated_tasks: generated };
      }
      if (!featureGenerated) {
        const refreshed = (await evaluateProjectCompletionGates(executor, projectId)).find(g => g.feature.id === feature.id);
        if (!refreshed?.gate.canComplete) return { status: "HUMAN_ACTION_REQUIRED", message: `${feature.key}: reviewer did not prove completion; inspect the release check` };
        await completeFeature(executor, { featureId: feature.id, userId, source: "SYSTEM" });
      }
    }
    return { status: generated ? "FIX_TASKS_READY" : "COMPLETE", generated_tasks: generated };
  } finally {
    await db.update(schema.projects).set({ deliveryLockToken: null, deliveryLockExpiresAt: null }).where(and(eq(schema.projects.id, projectId), eq(schema.projects.deliveryLockToken, token)));
  }
}
