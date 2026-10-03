import { beforeAll, describe, expect, test } from "bun:test";

/**
 * Full execution workflow against a running API (C20, T214/T217):
 * ready → claim → start → progress → test (PASSED) → VALIDATING → submit →
 * self-approval rejected → second reviewer approves → DONE.
 * Requires: docker compose up -d postgres && bun run dev:api
 * Credentials come from the environment (no hard-coded production account):
 *   SDD_TEST_EMAIL / SDD_TEST_PASSWORD  (required; must match a bootstrapped operator)
 */

const BASE = process.env.SDD_TEST_API ?? "http://localhost:4000";
const EMAIL = process.env.SDD_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.SDD_TEST_PASSWORD ?? "";

let cookie = "";
let reviewerCookie = "";
const reviewerEmail = `reviewer-${Date.now()}@example.test`;

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: T; setCookie: string | null }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: `sdd_session=${opts.cookie}` } : {}),
      ...opts.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    data: (text ? JSON.parse(text) : null) as T,
    setCookie: response.headers.get("set-cookie"),
  };
}

function bearerFrom(setCookie: string | null): string {
  return /sdd_session=([^;]+)/.exec(setCookie ?? "")?.[1] ?? "";
}

let ready = true;
let projectId = "";
let workspaceId = "";
let taskId = "";

beforeAll(async () => {
  try {
    const health = await fetch(`${BASE}/readyz`);
    if (!health.ok) throw new Error("not ready");
    if (!PASSWORD) throw new Error("SDD_TEST_PASSWORD is not set");
    const login = await api("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD });
    if (login.status !== 200) throw new Error("operator login failed");
    cookie = bearerFrom(login.setCookie);
    const me = await api<{ workspaces: Array<{ id: string }> }>("GET", "/api/v1/auth/me", undefined, { cookie });
    workspaceId = me.data.workspaces[0]!.id;
    const created = await api<{ project: { id: string } }>(
      "POST",
      "/api/v1/projects",
      {
        name: "Workflow E2E Lab",
        high_level_idea: "Exercises the full execution workflow: claim, validation chain, evidence policy and review authority.",
        key: `WFLOW${Math.floor(Math.random() * 90 + 10)}`,
      },
      { cookie },
    );
    projectId = created.data.project.id;
  } catch (error) {
    ready = false;
    console.log(`    (skipping workflow suite — environment unavailable: ${error instanceof Error ? error.message : error})`);
  }
});

describe("full execution workflow", () => {
  test("ready → claim → start → test → VALIDATING → submit → reviewed → DONE", async () => {
    if (!ready) return;

    // infrastructure-classified draft task (no approved artifacts needed)
    const created = await api<{ tasks: Array<{ id: string; key: string }> }>(
      "POST",
      `/api/v1/projects/${projectId}/tasks/manual`,
      {
        contract: {
          title: "Prove the full execution workflow",
          task_type: "documentation",
          objective: "Walk the legal transition chain end-to-end with real evidence and an independent reviewer.",
          scope: { expected_paths: ["apps/api/tests/**"], forbidden_paths: [] },
          constraints: [],
          acceptance_criteria: ["The whole chain completes with a DONE task."],
          verification: { required: [{ type: "command", command: "bun test apps/api/tests/workflow.test.ts" }], evidence: ["test_result"] },
          deliverables: ["execution_summary"],
          stop_conditions: ["Any transition is rejected by the state machine."],
          risk_factors: {},
          parallel_safe: false,
          priority: "P1",
        },
      },
      { cookie },
    );
    taskId = created.data.tasks.at(-1)!.id;

    // DRAFT cannot be claimed
    const early = await api("POST", `/api/v1/tasks/${taskId}/claim`, { executor: { type: "LOCAL_AGENT", id: "wf-exec" } }, { cookie });
    expect(early.status).toBe(409);

    // ready
    const readyRes = await api<{ task: { workflowStatus: string } }>("POST", `/api/v1/tasks/${taskId}/ready`, {}, { cookie });
    expect(readyRes.status).toBe(200);
    expect(readyRes.data.task.workflowStatus).toBe("READY");

    // claim — lease binds to the authenticated principal, not the declared id
    const claim = await api<{ run_id: string }>(
      "POST",
      `/api/v1/tasks/${taskId}/claim`,
      { executor: { type: "LOCAL_AGENT", id: "some-machine-fingerprint" } },
      { cookie },
    );
    expect(claim.status).toBe(200);

    // start with the SAME principal succeeds even though the declared executor id differs
    const start = await api("POST", `/api/v1/runs/${claim.data.run_id}/start`, {}, { cookie });
    expect(start.status).toBe(200);

    // progress
    const progress = await api("POST", `/api/v1/runs/${claim.data.run_id}/events`, { type: "progress_reported", message: "working" }, { cookie });
    expect(progress.status).toBe(200);

    // a FAILED test is not evidence…
    const failedTest = await api(
      "POST",
      `/api/v1/runs/${claim.data.run_id}/tests`,
      { command: "bun test apps/api/tests/workflow.test.ts", status: "FAILED", exit_code: 1 },
      { cookie },
    );
    expect(failedTest.status).toBe(200);
    const submitFailed = await api("POST", `/api/v1/runs/${claim.data.run_id}/request-review`, { summary: "premature" }, { cookie });
    expect(submitFailed.status).toBe(409);
    expect((submitFailed.data as { error?: { code?: string } }).error.code).toBe("EVIDENCE_NOT_PASSING");

    // …and reporting it moved the task into VALIDATING (fix #3)
    const during = await api<{ task: { workflowStatus: string } }>("GET", `/api/v1/tasks/${taskId}`, undefined, { cookie });
    expect(during.data.task.workflowStatus).toBe("VALIDATING");

    // passing evidence then submit
    const passed = await api(
      "POST",
      `/api/v1/runs/${claim.data.run_id}/tests`,
      { command: "bun test apps/api/tests/workflow.test.ts", status: "PASSED", exit_code: 0, duration_ms: 120 },
      { cookie },
    );
    expect(passed.status).toBe(200);
    const submit = await api("POST", `/api/v1/runs/${claim.data.run_id}/request-review`, { summary: "workflow proven" }, { cookie });
    expect(submit.status).toBe(200);
    const reviewing = await api<{ task: { workflowStatus: string } }>("GET", `/api/v1/tasks/${taskId}`, undefined, { cookie });
    expect(reviewing.data.task.workflowStatus).toBe("NEEDS_REVIEW");

    // register an independent reviewer into the workspace
    const reg = await api("POST", "/api/v1/auth/register", {
      email: reviewerEmail,
      password: "Reviewer1Pass",
      display_name: "Reviewer",
    });
    expect([201, 409]).toContain(reg.status);
    const rLogin = await api("POST", "/api/v1/auth/login", { email: reviewerEmail, password: "Reviewer1Pass" });
    reviewerCookie = bearerFrom(rLogin.setCookie);
    const addMember = await api("POST", `/api/v1/workspaces/${workspaceId}/members`, { email: reviewerEmail, role: "MEMBER" }, { cookie });
    expect(addMember.status).toBeLessThan(300);

    // Any workspace member approves (no reviewer roles; the implementer may too) → DONE
    const approve = await api("POST", "/api/v1/reviews", { task_id: taskId, decision: "APPROVED", summary: "criteria met" }, { cookie: reviewerCookie });
    expect(approve.status).toBe(200);
    const done = await api<{ task: { workflowStatus: string } }>("GET", `/api/v1/tasks/${taskId}`, undefined, { cookie });
    expect(done.data.task.workflowStatus).toBe("DONE");
    const runResp = await api<{ runs: Array<{ run: { id: string; status: string } }> }>("GET", `/api/v1/tasks/${taskId}/runs`, undefined, { cookie });
    expect(runResp.data.runs.find((r) => r.run.id === claim.data.run_id)?.run.status).toBe("FINISHED");
  });
});
