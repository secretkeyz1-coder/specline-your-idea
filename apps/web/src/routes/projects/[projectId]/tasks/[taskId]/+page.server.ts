import { error, fail } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types.js";
import { api, ApiError, rethrowKitError, sessionFrom, throwLoadError } from "$lib/server/api.js";
import { BAD_ID, formUuid } from "$lib/server/ids.js";
import type { ScreenReview } from "$lib/task-detail.js";

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const session = sessionFrom(cookies);
  const safe = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return await api<T>(fetch, session, "GET", path);
    } catch {
      return fallback;
    }
  };
  const [detail, runs, events, reviews] = await Promise.all([
    api<{
      task: {
        id: string;
        projectId: string;
        key: string;
        title: string;
        objective: string;
        workflowStatus: string;
        taskType: string;
        priority: string;
        hardness: number;
        riskLevel: string;
        reviewPolicy: string;
        parallelSafe: boolean;
        contract: {
          scope: { expected_paths: string[]; forbidden_paths: string[] };
          constraints: string[];
          acceptance_criteria: string[];
          verification: { required: Array<{ type: string; command: string }>; evidence: string[] };
          deliverables: string[];
          stop_conditions: string[];
        };
      };
      dependencies: Array<{ key: string; title: string; status: string }>;
      dependents: Array<{ key: string; title: string; status: string }>;
      traceability: Array<{ requirement_key: string; requirement_title: string; ac_key: string | null }>;
      screen_review?: ScreenReview | null;
    }>(fetch, session, "GET", `/api/v1/tasks/${params.taskId}`).catch((e) => throwLoadError(e)),
    safe<{ runs: Array<{ run: { id: string; attempt: number; status: string; executorType: string; startedAt: string | null; endedAt: string | null; summary: string | null; commitSha: string | null; filesChanged: string[]; metadata?: { ai_review?: { summary: string; recommended_decision: string; acceptance_coverage: Array<{ criterion_index: number; status: string; evidence: string }>; findings: Array<{ severity: string; message: string }> } } }; tests: Array<{ id: string; command: string; status: string; durationMs: number | null; summary: string | null }> }> }>(
      `/api/v1/tasks/${params.taskId}/runs`,
      { runs: [] },
    ),
    safe<{ events: Array<{ id: number; eventType: string; actorType: string; payload: Record<string, unknown>; occurredAt: string }> }>(
      `/api/v1/tasks/${params.taskId}/events`,
      { events: [] },
    ),
    safe<{ reviews: Array<{ id: string; decision: string; reviewerId: string; summary: string; findings: Array<{ severity: string; message: string }>; createdAt: string }> }>(
      `/api/v1/tasks/${params.taskId}/reviews`,
      { reviews: [] },
    ),
  ]);
  // The URL's project must own the task: otherwise another project's task
  // would render inside this project's header and navigation.
  if (detail.task.projectId !== params.projectId) error(404, "Task not found in this project");
  return { ...detail, screen_review: detail.screen_review ?? null, runs: runs.runs, events: events.events, reviews: reviews.reviews, projectId: params.projectId };
};

export const actions: Actions = {
  prompt: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    try {
      const result = await api<{ prompt: string }>(fetch, session, "POST", `/api/v1/tasks/${taskId}/prompt`, {
        body: { mode: String(form.get("mode") ?? "STANDALONE") },
      });
      return { prompt: result.prompt, mode: String(form.get("mode") ?? "STANDALONE") };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not generate the prompt." });
    }
  },

  manualRun: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    try {
      // Pasted evidence: one result per required verification command. The
      // API applies the same evidence policy as agent submissions (C2).
      const commands = form.getAll("test_command").map(String);
      const statuses = form.getAll("test_status").map(String);
      const exits = form.getAll("test_exit_code").map(String);
      const diff = String(form.get("diff") ?? "");
      const test_results = commands
        .map((command, i) => ({ command, status: statuses[i] ?? "", exit_code: exits[i]?.trim() ? Number(exits[i]) : null }))
        .filter((t) => t.command && ["PASSED", "FAILED", "ERROR", "SKIPPED"].includes(t.status));
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/manual-run`, {
        body: {
          summary: String(form.get("summary") ?? ""),
          commit_sha: String(form.get("commit") ?? "") || null,
          test_results,
          ...(diff ? { evidence: { base_commit: null, diff, diff_truncated: false, artifacts: [] } } : {}),
        },
      });
      return { ok: true, notice: "Manual execution recorded — the task is now in review." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not record the run." });
    }
  },

  /** BLOCKED is not a dead end: requeue the task or let the executor resume. */
  unblock: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    const mode = String(form.get("mode") ?? "ready") === "resume" ? "resume" : "ready";
    try {
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/unblock`, {
        body: { mode, note: String(form.get("note") ?? "").trim() || undefined },
      });
      return { ok: true, notice: mode === "resume" ? "Task resumed — the executor can continue its run." : "Task unblocked and back in the READY queue." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not unblock the task." });
    }
  },

  cancel: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) return fail(422, { message: "Give a reason for cancelling the task." });
    try {
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/cancel`, { body: { reason } });
      return { ok: true, notice: "Task cancelled." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not cancel the task." });
    }
  },

  review: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    const decision = String(form.get("decision") ?? "");
    try {
      await api(fetch, session, "POST", `/api/v1/reviews`, {
        body: {
          task_id: taskId,
          decision,
          summary: String(form.get("summary") ?? ""),
          findings:
            decision === "CHANGES_REQUESTED"
              ? [{ severity: "HIGH", message: String(form.get("findings") ?? "Changes requested") }]
              : [],
        },
      });
      return { ok: true, notice: decision === "APPROVED" ? "Task approved and completed." : "Changes requested — the task is back in rework." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Review failed." });
    }
  },

  /**
   * Create a bug from the review context (docs/14 §16).
   *
   * Reviewers find defects while reviewing; forcing them to abandon the task
   * page and re-describe the work over in Bugs loses the link to the task and
   * run. The bug is pre-linked to this task so traceability survives.
   */
  createBug: async ({ request, fetch, cookies, params }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    const current = String(form.get("current_behavior") ?? "").trim();
    const expected = String(form.get("expected_behavior") ?? "").trim();
    const reproduction = String(form.get("reproduction") ?? "").trim();
    if (!current || !expected || !reproduction) {
      return fail(422, { message: "Current behavior, expected behavior and reproduction are all required." });
    }
    try {
      const created = await api<{ bug: { key: string } }>(fetch, session, "POST", `/api/v1/projects/${params.projectId}/bugs`, {
        body: {
          title: String(form.get("title") ?? "").trim() || "Defect found during review",
          severity: String(form.get("severity") ?? "MAJOR"),
          current_behavior: current,
          expected_behavior: expected,
          unchanged_behavior: String(form.get("unchanged_behavior") ?? "").trim(),
          reproduction,
          task_id: taskId,
        },
      });
      return { ok: true, notice: `Bug ${created.bug.key} recorded and linked to this task.` };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Could not record the bug." });
    }
  },

  requeue: async ({ request, fetch, cookies }) => {
    const session = sessionFrom(cookies);
    const form = await request.formData();
    const taskId = formUuid(form, "taskId");
    if (!taskId) return fail(400, { message: BAD_ID });
    try {
      await api(fetch, session, "POST", `/api/v1/tasks/${taskId}/requeue`, { body: {} });
      return { ok: true, notice: "Task requeued — a new run attempt can claim it." };
    } catch (error) {
      rethrowKitError(error);
      if (error instanceof ApiError) return fail(error.status, { message: error.message });
      return fail(500, { message: "Requeue failed." });
    }
  },
};
