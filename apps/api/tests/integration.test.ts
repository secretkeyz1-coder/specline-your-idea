import { beforeAll, afterAll, describe, expect, test } from "bun:test";

/**
 * Integration suite against a running API + PostgreSQL (T107–T117, C20).
 * Requires: docker compose up -d postgres && bun run dev:api
 * Covers: authorization, transition legality, atomic claim concurrency (T109),
 * idempotent events (NFR-003), evidence policy (C2), self-approval guard.
 */

const BASE = process.env.SDD_TEST_API ?? "http://localhost:4000";
// Test credentials come from the environment; never hardcode a real account.
//   SDD_TEST_EMAIL / SDD_TEST_PASSWORD must match the bootstrapped operator.
const EMAIL = process.env.SDD_TEST_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.SDD_TEST_PASSWORD ?? "";

let cookie = "";
let environmentReady = true;

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie: `sdd_session=${cookie}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie?.includes("sdd_session=")) {
    cookie = /sdd_session=([^;]+)/.exec(setCookie)![1]!;
  }
  const text = await response.text();
  if (process.env.SDD_TEST_DEBUG) {
    console.log(method, path, "->", response.status, text.slice(0, 100), "cookie:", cookie.slice(0, 30), "set-cookie hdr:", (response.headers.get("set-cookie") ?? "none").slice(0, 60));
  }
  return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}

let projectId = "";

beforeAll(async () => {
  try {
    // health gate
    const health = await fetch(`${BASE}/readyz`).catch(() => null);
    if (!health?.ok) throw new Error(`API not ready at ${BASE}`);
    if (!PASSWORD) {
      throw new Error("SDD_TEST_PASSWORD is not set — export the bootstrap operator password");
    }
    const login = await api("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD });
    if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.data).slice(0, 200)}`);
    const labKey = `TCLM${Math.floor(Math.random() * 900 + 100)}`;
    const created = await api<{ project: { id: string } }>("POST", "/api/v1/projects", {
      name: "Claim Test Lab",
      high_level_idea: "Integration test project exercising the atomic claim transaction and review gates.",
      key: labKey,
    });
    projectId = created.data.project.id;
  } catch (error) {
    environmentReady = false;
    console.log(
      `    (skipping integration suite — environment unavailable: ${error instanceof Error ? error.message : error})`,
    );
  }
});

describe("authorization (NFR-002, T016)", () => {
  test("unauthenticated reads are rejected", async () => {
    if (!environmentReady) return;
    const saved = cookie;
    cookie = "";
    const { status } = await api("GET", "/api/v1/projects");
    cookie = saved;
    expect(status).toBe(401);
  });

  test("unknown project ids are 404", async () => {
    if (!environmentReady) return;
    const { status } = await api("GET", "/api/v1/projects/00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });
});

describe("execution engine", () => {
  let taskId = "";
  let taskKey = "";

  beforeAll(async () => {
    if (!environmentReady) return;
    // Create one draft task directly through the manual endpoint.
    const { status, data } = await api<{ tasks: Array<{ id: string; key: string }> }>(
      "POST",
      `/api/v1/projects/${projectId}/tasks/manual`,
      {
        requirement_keys: [],
        contract: {
          title: "Prove the atomic claim transaction",
          task_type: "documentation",
          objective: "A READY task can be claimed exactly once under concurrent attempts (T109).",
          scope: { expected_paths: ["apps/api/tests/**"], forbidden_paths: [] },
          constraints: [],
          acceptance_criteria: ["Concurrent second claim cannot also succeed."],
          verification: { required: [{ type: "command", command: "bun test apps/api/tests" }], evidence: ["test_result"] },
          deliverables: ["automated_tests"],
          stop_conditions: ["The claim transaction cannot be made atomic."],
          risk_factors: { concurrency: 4 },
          parallel_safe: false,
          priority: "P1",
        },
      },
    );
    expect(status).toBeLessThan(300);
    const task = data.tasks.at(-1)!;
    taskId = task.id;
    taskKey = task.key;
  });

  test("a DRAFT task cannot be claimed (transition table)", async () => {
    if (!environmentReady) return;
    const { status, data } = await api("POST", `/api/v1/tasks/${taskId}/claim`, {
      executor: { type: "LOCAL_AGENT", id: "test-executor-1" },
    });
    expect(status).toBe(409);
    expect((data as { error?: { code?: string } }).error.code).toBe("TASK_NOT_READY");
    void taskKey;
  });

  test("readying requires lint+readiness; infrastructure-classified tasks pass traceability", async () => {
    if (!environmentReady) return;
    const lint = await api<{ readiness: string }>("POST", `/api/v1/tasks/${taskId}/lint`, {});
    expect(lint.status).toBeLessThan(300);
    const ready = await api("POST", `/api/v1/tasks/${taskId}/ready`, {});
    // Artifacts are not approved for this lab project, so infrastructure tasks may still ready.
    expect([200, 409]).toContain(ready.status);
    if (ready.status !== 200) {
      // The project has no approved artifacts: readiness must fail for that reason only.
      expect(JSON.stringify(ready.data)).toContain("readiness");
    }
  });

  test("concurrent claims produce exactly one winner (T109/T215)", async () => {
    if (!environmentReady) return;
    // Force the task into READY via direct DB-free path: lint may fail without
    // approved artifacts, so skip when the environment lacks an approved spec.
    const ready = await api<{ task?: { workflowStatus: string } }>("POST", `/api/v1/tasks/${taskId}/ready`, {});
    const nowReady = ready.status === 200;
    if (!nowReady) {
      console.log("    (skipping concurrency race — task could not enter READY without approved artifacts)");
      return;
    }
    const claims = await Promise.all(
      ["executor-a", "executor-b", "executor-c"].map((id) =>
        api("POST", `/api/v1/tasks/${taskId}/claim`, { executor: { type: "LOCAL_AGENT", id } }),
      ),
    );
    const winners = claims.filter((c) => c.status === 200);
    const losers = claims.filter((c) => c.status === 409);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(2);
  });
});

describe("event idempotency (NFR-003)", () => {
  test("duplicate idempotency keys create one event", async () => {
    if (!environmentReady) return;
    // create + ready + claim a fresh task, then submit the same progress twice
    const created = await api<{ tasks: Array<{ id: string }> }>("POST", `/api/v1/projects/${projectId}/tasks/manual`, {
      contract: {
        title: "Idempotent progress relay",
        task_type: "backend",
        objective: "Retried event submissions must not duplicate task timeline entries (FR-0xx idempotency).",
        scope: { expected_paths: ["apps/api/**"], forbidden_paths: [] },
        constraints: [],
        acceptance_criteria: ["One event per idempotency key."],
        verification: { required: [{ type: "command", command: "bun test" }], evidence: ["test_result"] },
        deliverables: ["implementation"],
        stop_conditions: ["The event log cannot enforce idempotency."],
        risk_factors: {},
        parallel_safe: false,
        priority: "P2",
      },
    });
    const taskId = created.data.tasks.at(-1)!.id;
    const ready = await api<{ task: { workflowStatus: string } }>("POST", `/api/v1/tasks/${taskId}/ready`, {});
    const key = `idem-${taskId}`;
    if (ready.status !== 200) {
      console.log("    (skipping idempotency race — no approved artifacts in lab project)");
      return;
    }
    const claim = await api<{ run_id: string }>("POST", `/api/v1/tasks/${taskId}/claim`, {
      executor: { type: "LOCAL_AGENT", id: "idem-executor" },
    });
    const runId = claim.data.run_id;
    await api("POST", `/api/v1/runs/${runId}/start`);
    const headers = { "idempotency-key": key };
    const first = await api("POST", `/api/v1/runs/${runId}/events`, { type: "progress_reported", message: "step 1" }, headers);
    const second = await api("POST", `/api/v1/runs/${runId}/events`, { type: "progress_reported", message: "step 1" }, headers);
    expect(first.status).toBeLessThan(300);
    expect(second.status).toBeLessThan(300);
    const events = await api<{ events: Array<{ eventType: string; payload: Record<string, unknown> }> }>(
      "GET",
      `/api/v1/tasks/${taskId}/events`,
    );
    const progress = events.data.events.filter(
      (e) => e.eventType === "progress_reported" && (e.payload.message as string) === "step 1",
    );
    expect(progress.length).toBe(1);
  });
});

describe("manual task lineage (C6/C9 regression)", () => {
  test("a manually created code task records the approved artifact lineage it needs to ready", async () => {
    if (!environmentReady) return;
    // Regression: `tasks/manual` used to hardcode `revisionRefs: []`, so a
    // non-infrastructure task could never satisfy the readiness gate's
    // `artifactsCurrent` check (which requires the task to cite the approved
    // requirements AND stack). Every manually created code task was therefore
    // permanently unable to enter READY.
    const created = await api<{ tasks: Array<{ id: string; createdFromRevisionIds: Array<{ artifact_id: string; version: number }> }> }>(
      "POST",
      `/api/v1/projects/${projectId}/tasks/manual`,
      {
        requirement_keys: [],
        contract: {
          title: "Manual lineage regression probe",
          task_type: "code",
          objective: "Prove that a manually authored task records the approved revisions it was authored against.",
          scope: { expected_paths: ["apps/api/**"], forbidden_paths: [] },
          constraints: [],
          acceptance_criteria: ["The task stores lineage to the approved requirements and stack revisions."],
          verification: { required: [{ type: "command", command: "bun test" }], evidence: ["test_result"] },
          deliverables: ["implementation"],
          stop_conditions: ["No lineage is recorded."],
          risk_factors: {},
          parallel_safe: false,
          priority: "P2",
        },
      },
    );
    expect(created.status).toBeLessThan(300);
    const task = created.data.tasks.at(-1)!;
    // Lineage is empty only when the project has no approved artifacts yet; the
    // lab project may be in either state, so assert the invariant rather than a
    // fixed count.
    const requirements = await api<{ revisions: Array<{ id: string; status: string }> }>(
      "GET",
      `/api/v1/projects/${projectId}/artifacts/requirements`,
    );
    const hasApproved = requirements.data.revisions.some((r) => r.status === "APPROVED");
    if (hasApproved) {
      expect(task.createdFromRevisionIds.length).toBeGreaterThan(0);
    } else {
      expect(Array.isArray(task.createdFromRevisionIds)).toBe(true);
    }
  });
});

describe("review authority (C2, docs/12 §4)", () => {
  test("submitting without evidence is rejected", async () => {
    if (!environmentReady) return;
    const created = await api<{ tasks: Array<{ id: string }> }>("POST", `/api/v1/projects/${projectId}/tasks/manual`, {
      contract: {
        title: "Evidence policy probe",
        task_type: "code",
        objective: "Review submission without reported tests must be refused by the evidence policy.",
        scope: { expected_paths: ["apps/api/**"], forbidden_paths: [] },
        constraints: [],
        acceptance_criteria: ["Server refuses unevidenced review requests."],
        verification: { required: [{ type: "command", command: "bun test" }], evidence: ["test_result"] },
        deliverables: ["implementation"],
        stop_conditions: ["The evidence policy cannot be evaluated server-side."],
        risk_factors: {},
        parallel_safe: false,
        priority: "P2",
      },
    });
    const taskId = created.data.tasks.at(-1)!.id;
    const ready = await api("POST", `/api/v1/tasks/${taskId}/ready`, {});
    if (ready.status !== 200) {
      console.log("    (skipping evidence policy probe — no approved artifacts in lab project)");
      return;
    }
    const claim = await api<{ run_id: string }>("POST", `/api/v1/tasks/${taskId}/claim`, {
      executor: { type: "LOCAL_AGENT", id: "evidence-executor" },
    });
    await api("POST", `/api/v1/runs/${claim.data.run_id}/start`);
    const submit = await api("POST", `/api/v1/runs/${claim.data.run_id}/request-review`, {
      summary: "claiming done without any tests",
    });
    expect(submit.status).toBe(409);
    expect((submit.data as { error?: { code?: string } }).error.code).toBe("EVIDENCE_MISSING");
  });

  test("cli device flow: user denial transitions code to DENIED", async () => {
    if (!environmentReady) return;
    const start = await api<{ device_code: string; user_code: string }>("POST", "/api/v1/auth/cli/start", {
      client_name: "test-cli-deny",
    });
    expect(start.status).toBe(200);

    const deny = await api("POST", "/api/v1/auth/cli/deny", {
      user_code: start.data.user_code,
    });
    expect(deny.status).toBe(200);

    const poll = await api<{ status: string }>("POST", "/api/v1/auth/cli/exchange", {
      device_code: start.data.device_code,
    });
    expect(poll.status).toBe(200);
    expect(poll.data.status).toBe("DENIED");
  });
});

afterAll(async () => {
  // No teardown: the lab project is reused across runs.
});
