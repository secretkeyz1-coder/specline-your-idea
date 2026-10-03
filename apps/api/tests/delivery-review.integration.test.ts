import { describe, expect, test } from "bun:test";
import { createDb, schema } from "@sdd/db";
import { eq } from "drizzle-orm";
import { SecretBox } from "@sdd/shared";
import { TaskContractSchema } from "@sdd/contracts";
import { reviewSubmittedRun } from "../src/modules/review/automation.js";
import { orchestrateProject } from "../src/modules/convergence/orchestrator.js";
import { generateTaskFromFinding, evaluateFeatureCompletionGate } from "../src/modules/convergence/service.js";
import { claimTask } from "../src/modules/execution/claim.js";
import { startRun, reportTestResult } from "../src/modules/execution/runs.js";
import { submitRunForReview } from "../src/modules/execution/evidence.js";

// Explicit isolated database only. Never use the application's DATABASE_URL.
const url = process.env.SDD_DELIVERY_TEST_DB;
(url ? describe : describe.skip)("delivery loop against PostgreSQL and a fake AI provider", () => {
  test("real evidence → AI rejection → retry → release gap → one fix → COMPLETE", async () => {
    const db = createDb(url!);
    let workspaceId = "", userId = "";
    let answer: Record<string, unknown> = {};
    let failProvider = false;
    let requests = 0;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const body = await request.json() as { messages: Array<{ content: string }> };
      expect(body.messages.some(m => m.content.includes("FR-1"))).toBe(true);
      requests++;
      await new Promise(resolve => setTimeout(resolve, 100));
      if (failProvider) return Response.json({ error: { message: "Test provider unavailable" } }, { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
    } });
    try {
      const suffix = crypto.randomUUID();
      const [user] = await db.insert(schema.users).values({ email: `${suffix}@example.test`, displayName: "Delivery test" }).returning(); userId = user!.id;
      const [workspace] = await db.insert(schema.workspaces).values({ name: "Delivery test", slug: suffix }).returning(); workspaceId = workspace!.id;
      const [project] = await db.insert(schema.projects).values({ workspaceId, key: "DELIVERY", name: "Stock application", highLevelIdea: "Stock quantities", createdBy: userId }).returning();
      const [feature] = await db.insert(schema.features).values({ projectId: project!.id, key: "stock", title: "Stock lookup" }).returning();
      const refs: Array<{ artifact_id: string; version: number }> = [];
      let requirementsRevisionId = "";
      for (const artifactType of ["requirements", "stack"] as const) {
        const [artifact] = await db.insert(schema.artifacts).values({ projectId: project!.id, artifactType, title: artifactType }).returning();
        const [revision] = await db.insert(schema.artifactRevisions).values({ artifactId: artifact!.id, version: 1, checksum: suffix, status: "APPROVED", approvedAt: new Date(), approvedBy: userId }).returning();
        await db.update(schema.artifacts).set({ approvedRevisionId: revision!.id }).where(eq(schema.artifacts.id, artifact!.id));
        refs.push({ artifact_id: artifact!.id, version: 1 });
        if (artifactType === "requirements") requirementsRevisionId = revision!.id;
      }
      const [requirement] = await db.insert(schema.requirements).values({ projectId: project!.id, artifactRevisionId: requirementsRevisionId, key: "FR-1", title: "Stock lookup", statement: "Return the warehouse stock quantity" }).returning();
      const [ac] = await db.insert(schema.acceptanceCriteria).values({ requirementId: requirement!.id, key: "AC-1", statement: "Unknown warehouses return an error" }).returning();
      const contract = TaskContractSchema.parse({ title: "Implement warehouse stock lookup", task_type: "code", objective: "Return the stock quantity and reject unknown warehouses", scope: { expected_paths: ["src/stock.ts", "tests/stock.test.ts"] }, constraints: ["Keep the public API unchanged"], acceptance_criteria: [ac!.statement], verification: { required: [{ type: "command", command: "bun test tests/stock.test.ts" }], evidence: ["diff", "summary", "test_result"] }, deliverables: ["implementation", "automated_tests"], stop_conditions: ["The approved requirement changes"] });
      const [task] = await db.insert(schema.tasks).values({ projectId: project!.id, featureId: feature!.id, key: "TASK-001", title: contract.title, objective: contract.objective, contract, createdFromRevisionIds: refs, workflowStatus: "READY" }).returning();
      await db.insert(schema.taskRequirementLinks).values({ taskId: task!.id, requirementId: requirement!.id, acceptanceCriterionId: ac!.id });
      await db.insert(schema.projectCounters).values({ projectId: project!.id, kind: "task", value: 1 });
      const box = SecretBox.fromMasterKey(new Uint8Array(32));
      const [connection] = await db.insert(schema.aiProviderConnections).values({ workspaceId, providerType: "OPENAI", name: "Fake provider", baseUrl: `http://127.0.0.1:${server.port}/v1`, encryptedCredentialRef: await box.encrypt("test-only") }).returning();
      const [profile] = await db.insert(schema.aiProfiles).values({ workspaceId, name: "Fake reviewer", providerConnectionId: connection!.id, modelId: "fake", parameters: { stream: false } }).returning();
      for (const role of ["REVIEW", "CONVERGENCE"] as const) await db.insert(schema.aiRoleBindings).values({ workspaceId, role, aiProfileId: profile!.id });
      const gateway = { db, secretBox: box, allowPrivateEgress: true, maxResponseBytes: 1000000 };
      const actor = { type: "LOCAL_AGENT" as const, id: userId, source: "CLI" as const };
      const execute = async (taskId: string) => {
        const claimed = await claimTask(db, { taskId, actor, body: { executor: { type: "LOCAL_AGENT", id: "test-machine" }, lease_seconds: 900 } });
        const runId = claimed.run_id;
        await startRun(db, { runId, actor });
        await expect(reportTestResult(db, { runId, actor, body: { command: "bun test tests/stock.test.ts", status: "PASSED", exit_code: 1 } })).rejects.toThrow();
        await reportTestResult(db, { runId, actor, body: { command: "bun test tests/stock.test.ts", status: "PASSED", exit_code: 0, summary: "Warehouse regression passed" } });
        const body = { summary: "Implemented FR-1 warehouse stock lookup", commit_sha: "123abc", files_changed: ["src/stock.ts"], evidence: { base_commit: "base", diff: "+ if (!warehouse) throw new Error('unknown warehouse');", diff_truncated: false, artifacts: [] } };
        await submitRunForReview(db, { runId, actor, body });
        await submitRunForReview(db, { runId, actor, body }); // network retry is idempotent
        return runId;
      };
      let runId = await execute(task!.id);
      answer = { summary: "Error handling is not yet proven", recommended_decision: "CHANGES_REQUESTED", acceptance_coverage: [{ criterion_index: 0, status: "PARTIAL", evidence: "Missing assertion in stock test" }], findings: [{ severity: "HIGH", message: "Assert rejection for an unknown warehouse" }] };
      const initialCalls = requests;
      const concurrent = await Promise.all([reviewSubmittedRun(gateway, db, runId, userId, true), reviewSubmittedRun(gateway, db, runId, userId, true)]);
      const rejected = concurrent.find(result => result.task?.workflowStatus === "READY")!;
      expect(requests - initialCalls).toBe(1);
      expect(rejected.auto_approve_withheld).toBeUndefined();
      expect(rejected.task?.workflowStatus).toBe("READY");
      answer = { summary: "Warehouse contract proven", recommended_decision: "APPROVED", acceptance_coverage: [{ criterion_index: 0, status: "COVERED", evidence: "src/stock.ts and stock regression test" }], source_consistency: [{ requirement_key: "FR-1", status: "CONSISTENT", evidence: "Unknown warehouses remain rejected" }], findings: [] };
      runId = await execute(task!.id);
      const approved = await reviewSubmittedRun(gateway, db, runId, userId, true);
      expect(approved.task?.workflowStatus).toBe("DONE");
      const callsBeforeRetry = requests;
      await reviewSubmittedRun(gateway, db, runId, userId, true);
      expect(requests).toBe(callsBeforeRetry);
      answer = { summary: "Missing unknown warehouse regression", completion_recommended: true, coverage: [{ requirement_key: "FR-1", acceptance_criterion_key: "AC-1", status: "PARTIAL", evidence: "Stock error path lacks regression" }], findings: [{ finding_type: "PARTIAL", severity: "HIGH", requirement_key: "FR-1", acceptance_criterion_key: "AC-1", description: "Prove unknown warehouse rejection", evidence: "No error path assertion", suggested_task: { title: "Add warehouse error regression", objective: "Prove unknown warehouse rejection without changing the public API" } }] };
      const beforeConvergence = requests;
      const releases = await Promise.all([orchestrateProject(gateway, db, project!.id, userId), orchestrateProject(gateway, db, project!.id, userId)]);
      const repair = releases.find(result => result.status === "FIX_TASKS_READY")!;
      expect(requests - beforeConvergence).toBe(1);
      expect(releases.some(result => result.status === "RUNNING")).toBe(true);
      const [unlocked] = await db.select().from(schema.projects).where(eq(schema.projects.id, project!.id));
      expect(unlocked!.deliveryLockToken).toBeNull();
      expect(repair.status).toBe("FIX_TASKS_READY");
      expect((await evaluateFeatureCompletionGate(db, feature!.id)).canComplete).toBe(false);
      const [finding] = await db.select().from(schema.convergenceFindings).innerJoin(schema.convergenceRuns, eq(schema.convergenceRuns.id, schema.convergenceFindings.convergenceRunId)).where(eq(schema.convergenceRuns.featureId, feature!.id));
      const fix = await generateTaskFromFinding(db, { findingId: finding!.convergence_findings.id, userId });
      expect(fix.task.title).toBe("Add warehouse error regression");
      expect(fix.task.contract.constraints).toContain("Keep the public API unchanged");
      expect(fix.task.workflowStatus).toBe("READY");
      const sameFix = await generateTaskFromFinding(db, { findingId: finding!.convergence_findings.id, userId });
      expect(sameFix.task.id).toBe(fix.task.id);
      answer = { summary: "Fix criteria proven", recommended_decision: "APPROVED", acceptance_coverage: fix.task.contract.acceptance_criteria.map((_, criterion_index) => ({ criterion_index, status: "COVERED", evidence: "stock implementation and regression tests" })), source_consistency: [{ requirement_key: "FR-1", status: "CONSISTENT", evidence: "The fix preserves warehouse rejection" }], findings: [] };
      await reviewSubmittedRun(gateway, db, await execute(fix.task.id), userId, true);
      answer = { summary: "Stock release proven", completion_recommended: true, coverage: [{ requirement_key: "FR-1", acceptance_criterion_key: "AC-1", status: "COVERED", evidence: "stock implementation and regression tests" }], findings: [] };
      expect((await orchestrateProject(gateway, db, project!.id, userId)).status).toBe("COMPLETE");
      expect((await evaluateFeatureCompletionGate(db, feature!.id)).canComplete).toBe(true);
      const [failedFeature] = await db.insert(schema.features).values({ projectId: project!.id, key: "FR-1", title: "Provider failure check" }).returning();
      failProvider = true;
      expect((await orchestrateProject(gateway, db, project!.id, userId)).status).toBe("HUMAN_ACTION_REQUIRED");
      const [failedRelease] = await db.select().from(schema.convergenceRuns).where(eq(schema.convergenceRuns.featureId, failedFeature!.id));
      expect(failedRelease!.status).toBe("FAILED");
      const beforeRetry = requests;
      await orchestrateProject(gateway, db, project!.id, userId);
      expect(requests).toBe(beforeRetry);
      await db.update(schema.features).set({ status: "CANCELLED" }).where(eq(schema.features.id, failedFeature!.id));
      await db.update(schema.convergenceRuns).set({ coverage: [] }).where(eq(schema.convergenceRuns.featureId, feature!.id));
      expect((await evaluateFeatureCompletionGate(db, feature!.id)).canComplete).toBe(false);
      for (let round = 0; round < 2; round++) {
        const [bounded] = await db.insert(schema.convergenceRuns).values({ featureId: feature!.id, requirementsRevisionId, status: "COMPLETED", completionRecommended: "NO", completedAt: new Date() }).returning();
        await db.insert(schema.convergenceFindings).values({ convergenceRunId: bounded!.id, findingType: "MISSING", severity: "HIGH", description: "Repeated warehouse gap", sourceRef: "FR-1", generatedTaskId: fix.task.id, resolutionStatus: "TASK_GENERATED" });
      }
      const beforeCeiling = requests;
      const ceiling = await orchestrateProject(gateway, db, project!.id, userId);
      expect(ceiling.status).toBe("HUMAN_ACTION_REQUIRED");
      expect(ceiling.message).toContain("three repair rounds");
      expect(requests).toBe(beforeCeiling);
    } finally {
      server.stop(true);
      if (workspaceId) await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
      if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.close();
    }
  }, 30000);
});
