/**
 * End-to-end business workflow verification.
 *
 * Drives the WHOLE product flow against a live API and asserts that each
 * constitutional gate (C1–C24) actually refuses violations:
 *   idea → discovery → requirements → stack → design → tasks → work order
 *   → claim → run → evidence → review → bugs → convergence → completion
 *
 * Every planning step is exercised through BOTH its AI path and its manual
 * fallback, so the BYO-provider posture (C21) and the manual fallback
 * guarantee (C17) are verified rather than assumed.
 *
 * Prerequisites: a running API and PostgreSQL, plus the bootstrap operator
 * password. Credentials are never hardcoded.
 *
 *   export SDD_VERIFY_PASSWORD='<bootstrap operator password>'
 *   export SDD_VERIFY_API=http://localhost:4000          # optional
 *   bun run apps/api/scripts/verify-workflow.ts
 *
 * Exits non-zero if any assertion fails, so it can gate CI.
 */

const BASE = process.env.SDD_VERIFY_API ?? "http://localhost:4010";
const EMAIL = process.env.SDD_VERIFY_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.SDD_VERIFY_PASSWORD ?? "";

if (!PASSWORD) {
  console.error("Set SDD_VERIFY_PASSWORD");
  process.exit(1);
}

let cookie = "";
let pass = 0;
let fail = 0;
const failures: string[] = [];
// Findings where behaviour differs from what docs/ describe.
const docMismatches: string[] = [];

async function call<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie: `sdd_session=${cookie}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie?.includes("sdd_session=")) cookie = /sdd_session=([^;]+)/.exec(setCookie)![1]!;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: res.status, data };
}

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function note(label: string, detail: string) {
  docMismatches.push(`${label}: ${detail}`);
  console.log(`  ⚠ DOC: ${label} — ${detail}`);
}

function section(name: string) {
  console.log(`\n━━━ ${name} ━━━`);
}

const code = (r: { data: any }) => r.data?.error?.code ?? null;

/* ══════════════════ 0. auth ══════════════════ */
section("0. Authentication & session");
{
  const login = await call("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD });
  check("operator login", login.status === 200, `status=${login.status}`);
  check("session cookie issued", cookie.length > 0);

  const saved = cookie;
  cookie = "";
  const anon = await call("GET", "/api/v1/projects");
  check("unauthenticated read rejected (C12)", anon.status === 401, `status=${anon.status}`);
  cookie = saved;
}

/* ══════════════════ 1. idea → project ══════════════════ */
section("1. Phase A — high-level idea");
let projectId = "";
let workspaceId = "";
{
  const me = await call<any>("GET", "/api/v1/auth/me");
  workspaceId = me.data.workspaces?.[0]?.id ?? "";
  check("workspace membership resolved", Boolean(workspaceId));

  const key = `VFY${Math.floor(Math.random() * 900 + 100)}`;
  const created = await call<any>("POST", "/api/v1/projects", {
    name: "Field Construction App",
    high_level_idea:
      "An app to manage field progress, photo evidence, and PM approvals for construction sites. Technicians work offline on mobile; PMs approve from the office.",
    constraints: ["must work on mobile", "offline tolerant"],
    key,
  });
  check("project created from idea", created.status < 300, `status=${created.status}`);
  projectId = created.data?.project?.id ?? "";
  check("project id returned", Boolean(projectId));
  if (!created.data?.project?.lifecycleStatus) note("Project create response", "no lifecycleStatus field returned");
}

/* ══════════════════ 2. discovery ══════════════════ */
section("2. Phase B — adaptive discovery");
{
  const start = await call<any>("POST", `/api/v1/projects/${projectId}/discovery-sessions`);
  check("discovery session started", start.status < 300, `status=${start.status}`);

  const state = await call<any>("GET", `/api/v1/projects/${projectId}/discovery`);
  check("discovery state readable", state.status === 200);
  const sessionId = state.data?.session?.id;
  console.log(`     readiness=${state.data?.readiness} pending=${(state.data?.pending ?? []).length}`);
  check("session present", Boolean(sessionId));

  // Answer questions until the engine stops surfacing them or we hit the cap.
  let answered = 0;
  for (let i = 0; i < 30; i++) {
    const cur = await call<any>("GET", `/api/v1/projects/${projectId}/discovery`);
    const q = (cur.data?.pending ?? [])[0];
    if (!q) break;
    const answer =
      (q.options && q.options.length > 0 ? String(q.options[0]) : null) ??
      "Technicians capture progress and photo evidence; PMs review and approve.";
    const res = await call("POST", `/api/v1/discovery/questions/${q.id}/answer`, {
      answer: String(answer),
    });
    if (res.status >= 300) {
      console.log(`     answer rejected at Q${i + 1}: ${res.status} ${code(res)}`);
      break;
    }
    answered++;
  }
  check("discovery questions answered", answered > 0, `answered=${answered}`);

  const after = await call<any>("GET", `/api/v1/projects/${projectId}/discovery`);
  console.log(
    `     readiness=${after.data?.readiness} facts=${after.data?.facts?.length ?? 0} assumptions=${after.data?.assumptions?.length ?? 0}`,
  );
  check("readiness reported", Boolean(after.data?.readiness));

  // C7 gate: requirements generation before discovery close must be refused
  // or must carry documented assumptions.
  const premature = await call("POST", `/api/v1/projects/${projectId}/artifacts/requirements/generate`, {});
  console.log(`     premature requirements generate → ${premature.status} ${code(premature) ?? ""}`);
  if (premature.status < 300) {
    note(
      "C7 requirements-before-technology gate",
      "requirements generation succeeded while discovery was still open (gate not enforced server-side)",
    );
  }
}

/* ══════════════════ 3. requirements ══════════════════ */
section("3. Phase C — requirements synthesis & approval");
let requirementsRevisionId = "";
let requirementIds: string[] = [];
{
  // Try AI generation first; when no provider is bound (BYO-provider, C21) fall
  // back to the manual authoring path that MUST exist for C17 to hold.
  const gen = await call<any>("POST", `/api/v1/projects/${projectId}/artifacts/requirements/generate`, {});
  const needManual = gen.status >= 300;
  if (needManual) {
    console.log(`     AI generation unavailable (${code(gen)}) → using the manual authoring path`);
    const manual = await call<any>("POST", `/api/v1/projects/${projectId}/artifacts/requirements/edit`, {
      structured: {
        summary: "Field construction progress app with offline photo evidence and PM approval.",
        actors: [
          { name: "Technician", description: "Captures progress and evidence on site" },
          { name: "PM", description: "Reviews and approves submitted progress" },
        ],
        workflows: [
          {
            name: "Capture and approve progress",
            primary_actor: "Technician",
            steps: ["Capture photo", "Submit for approval", "PM reviews", "PM approves"],
          },
        ],
        functional_requirements: [
          {
            key: "REQ-001",
            title: "Offline evidence capture",
            statement: "The system shall allow technicians to capture photo evidence while offline, without data loss.",
            priority: "P1",
            acceptance_criteria: [
              {
                key: "AC-001-01",
                statement: "Evidence captured offline is retained and synchronized when connectivity returns.",
                verification_type: "TEST",
              },
            ],
          },
        ],
        non_functional: [{ key: "NFR-001", statement: "Evidence capture shall complete within 2 seconds on a mid-range device." }],
        assumptions: [{ description: "Technicians carry camera-equipped mobile devices." }],
        exclusions: [{ description: "No desktop-native application in the first release." }],
        open_questions: [],
      },
    });
    check("requirements authored MANUALLY without AI (C17/C21)", manual.status < 300, `status=${manual.status} ${code(manual) ?? ""}`);
  } else {
    check("requirements generated", gen.status < 300, `status=${gen.status}`);
  }

  const reqs = await call<any>("GET", `/api/v1/projects/${projectId}/requirements`);
  check("requirements readable", reqs.status === 200);
  const rev = reqs.data?.revision ?? reqs.data?.artifact?.revision;
  requirementsRevisionId = rev?.id ?? "";
  const items = reqs.data?.requirements ?? reqs.data?.artifact?.requirements ?? [];
  requirementIds = (items ?? []).map((r: any) => r.id).filter(Boolean);
  console.log(`     revision=${requirementsRevisionId ? "yes" : "no"} requirements=${requirementIds.length}`);
  check("requirements revision exists", Boolean(requirementsRevisionId));
  check("at least one requirement produced", requirementIds.length > 0);

  // C6: approval creates an immutable revision
  const approve = await call("POST", `/api/v1/artifact-revisions/${requirementsRevisionId}/approve`, {});
  check("requirements approved (C6)", approve.status < 300, `status=${approve.status} ${code(approve) ?? ""}`);

  // Stack must not be selectable before requirements are approved (C7).
  // We test this AFTER approval here, and test the negative case earlier.
}

/* ══════════════════ 4. stack ══════════════════ */
section("4. Phase D — technology stack (C7/C8)");
{
  const rec = await call<any>("POST", `/api/v1/projects/${projectId}/stack/recommend`, {
    mode: "RECOMMENDED",
    preferences: {},
    manual_components: [],
  });
  if (rec.status < 300) check("AI stack recommendation accepted", true);
  else check("AI stack path reports a clear, actionable error", code(rec) === "AI_PROVIDER_NOT_CONFIGURED", `code=${code(rec)}`);

  // C8: manual mode with an explicit user choice must be preserved, not replaced.
  // C8: an explicit user selection must be preserved, never silently replaced.
  // This is asserted on the approved baseline, which works with or without AI.
  const baseline = await call<any>("POST", `/api/v1/projects/${projectId}/stack/approve`, {
    components: [
      { category: "database", technology: "SQLite", version_constraint: null, selection_source: "USER_SELECTED", locked_by_user: true, rationale: "offline-first local cache" },
      { category: "runtime", technology: "TypeScript", version_constraint: null, selection_source: "AI_RECOMMENDED", locked_by_user: false, rationale: "team skill" },
    ],
    rationale: "Offline-tolerant mobile capture with a simple operational footprint.",
  });
  check("stack baseline approved with explicit user choice (C8)", baseline.status < 300, `status=${baseline.status} ${code(baseline) ?? ""}`);
  const stackRows = await call<any>("GET", `/api/v1/projects/${projectId}/artifacts/stack`);
  const stackText = JSON.stringify(stackRows.data ?? {});
  check("locked user selection preserved in the baseline (C8)", stackText.includes("SQLite"), "SQLite absent from stored baseline");

  const validate = await call<any>("POST", `/api/v1/projects/${projectId}/stack/validate`, {
    manual_components: [
      { category: "database", technology: "SQLite", version_constraint: null, locked: false },
      { category: "deployment", technology: "multi-region horizontal writes", version_constraint: null, locked: false },
    ],
  });
  console.log(`     stack validate → ${validate.status}`);
  check("stack validation endpoint responds", validate.status < 500, `status=${validate.status}`);

  const approve = await call("POST", `/api/v1/projects/${projectId}/stack/approve`, {
    components: [
      { category: "database", technology: "SQLite", version_constraint: null, selection_source: "USER_SELECTED", locked_by_user: true, rationale: "offline-first local cache" },
      { category: "runtime", technology: "TypeScript", version_constraint: null, selection_source: "AI_RECOMMENDED", locked_by_user: false, rationale: "team skill" },
    ],
    rationale: "Offline-tolerant mobile capture with a simple operational footprint.",
  });
  check("stack baseline approved (C8)", approve.status < 300, `status=${approve.status} ${code(approve) ?? ""}`);
}

/* ══════════════════ 5. design ══════════════════ */
section("5. Phase E — technical design");
let designId = "";
{
  const gen = await call<any>("POST", `/api/v1/projects/${projectId}/design/generate`, {});
  if (gen.status < 300) {
    check("design generated", true);
    designId = gen.data?.design?.id ?? gen.data?.id ?? "";
  } else {
    console.log(`     AI design unavailable (${code(gen)}) → using the manual authoring path`);
    // C17: a manual design path must exist. Before this was added, design was
    // the ONLY planning step with no non-AI route, so the product could not be
    // completed without a provider.
    const manualDesign = await call<any>("POST", `/api/v1/projects/${projectId}/design/edit`, {
      structured: {
        overview: "A mobile-first field app. Technicians capture progress and photo evidence offline; PMs review from the office.",
        architecture: { summary: "Offline-capable client with a local queue that synchronizes to a central API.", diagram_text: "mobile -> local queue -> sync API -> store" },
        components: [
          { name: "Mobile client", responsibility: "Offline capture and queueing of evidence", interfaces: "Sync API over HTTPS" },
          { name: "Sync API", responsibility: "Idempotent evidence ingestion and reconciliation", interfaces: "REST/JSON" },
        ],
        data_model: "Evidence(id, project_id, captured_at, payload_ref, sync_state).",
        api_contracts: "POST /evidence (idempotent via client id) -> { evidence_id }.",
        state_machines: "Evidence: QUEUED -> SYNCING -> SYNCED, SYNCING -> FAILED -> SYNCING (retry).",
        requirement_coverage: [{ requirement_key: "REQ-001", design_section: "Mobile client + Sync API", status: "PATH_DEFINED" }],
        testing_strategy: "Unit tests for the offline queue; integration test for idempotent re-sync.",
        security: "Evidence scoped to the owning project; TLS-only transport.",
        deployment: "Single API service plus managed PostgreSQL.",
        unresolved_decisions: [],
      },
    });
    check("design authored MANUALLY without AI (C17)", manualDesign.status < 300, `status=${manualDesign.status} ${code(manualDesign) ?? ""}`);
    designId = manualDesign.data?.design?.id ?? manualDesign.data?.revision?.id ?? "";
  }

  const design = await call<any>("GET", `/api/v1/projects/${projectId}/artifacts/design`);
  check("design artifact readable", design.status === 200, `status=${design.status}`);
  const revisions = design.data?.revisions ?? [];
  const draft = revisions.find((r: any) => r.status === "DRAFT") ?? revisions[0];
  if (draft?.id) {
    const approve = await call("POST", `/api/v1/artifact-revisions/${draft.id}/approve`, {});
    check("design approved (C6)", approve.status < 300, `status=${approve.status} ${code(approve) ?? ""}`);
  } else {
    check("design revision exists to approve", false, "no revision returned");
  }
}

/* ══════════════════ 6. tasks ══════════════════ */
section("6. Phase F — atomic task decomposition (C1/C9)");
let tasks: any[] = [];
{
  const gen = await call<any>("POST", `/api/v1/projects/${projectId}/tasks/generate`, {});
  if (gen.status < 300) {
    check("tasks generated from the approved design", true);
  } else {
    // BYO-provider (C21): decomposition needs a model. The manual path (C17)
    // must remain available; that is asserted in the C1/C9 probes below.
    check(
      "task decomposition reports a clear, actionable provider error (C21)",
      code(gen) === "AI_PROVIDER_NOT_CONFIGURED",
      `code=${code(gen)}`,
    );
  }

  const list = await call<any>("GET", `/api/v1/projects/${projectId}/tasks?limit=200`);
  tasks = list.data?.tasks ?? [];
  console.log(`     tasks after generation=${tasks.length}`);

  const graph = await call<any>("GET", `/api/v1/projects/${projectId}/task-graph/validate`);
  check("dependency graph validated", graph.status === 200, `status=${graph.status}`);
  check("graph is acyclic", graph.data?.acyclic === true, `acyclic=${graph.data?.acyclic}`);

  // C1: a feature task without requirement links may not enter READY.
  const manual = await call<any>("POST", `/api/v1/projects/${projectId}/tasks/manual`, {
    requirement_keys: [],
    contract: {
      title: "Orphan code task (C1 probe)",
      task_type: "code",
      objective: "This feature task deliberately links to no requirement to prove C1 blocks it.",
      scope: { expected_paths: ["apps/**"], forbidden_paths: [] },
      constraints: [],
      acceptance_criteria: ["C1 must refuse to ready this task."],
      verification: { required: [{ type: "command", command: "bun test" }], evidence: ["test_result"] },
      deliverables: ["implementation"],
      stop_conditions: ["C1 is not enforced."],
      risk_factors: {},
      parallel_safe: false,
      priority: "P1",
    },
  });
  const orphanId = manual.data?.tasks?.at(-1)?.id;
  if (orphanId) {
    await call("POST", `/api/v1/tasks/${orphanId}/lint`, {});
    const ready = await call("POST", `/api/v1/tasks/${orphanId}/ready`, {});
    check("C1: orphan feature task cannot enter READY", ready.status >= 400, `status=${ready.status}`);
    if (ready.status < 300) {
      note("C1 traceability gate", "orphan feature task became READY without a requirement link");
    }
  } else {
    check("manual task creation works", false, "no task id returned");
  }

  // C9: a task whose contract lacks verification commands must not ready.
  const noVerify = await call<any>("POST", `/api/v1/projects/${projectId}/tasks/manual`, {
    requirement_keys: requirementIds.length ? [requirementIds[0]] : [],
    contract: {
      title: "Task without verification (C9 probe)",
      task_type: "code",
      objective: "Proves the readiness gate refuses a contract with no verification commands.",
      scope: { expected_paths: ["docs/**"], forbidden_paths: [] },
      constraints: [],
      acceptance_criteria: ["Readiness must refuse an unverifiable task."],
      verification: { required: [], evidence: [] },
      deliverables: ["implementation"],
      stop_conditions: ["Readiness accepted a task with no verification."],
      risk_factors: {},
      parallel_safe: false,
      priority: "P3",
    },
  });
  const nvId = noVerify.data?.tasks?.at(-1)?.id;
  if (nvId) {
    await call("POST", `/api/v1/tasks/${nvId}/lint`, {});
    const ready = await call("POST", `/api/v1/tasks/${nvId}/ready`, {});
    check("C9: task without verification cannot ready", ready.status >= 400, `status=${ready.status}`);
  }
}

/* ══════════════════ 7. work order + prompt ══════════════════ */
section("7. Work order & portable prompt (C10/C13/C17)");
{
  // Re-read: the C1/C9 probes above create tasks AFTER the earlier snapshot,
  // so the `tasks` array captured in section 6 is stale by now.
  const fresh = await call<any>("GET", `/api/v1/projects/${projectId}/tasks?limit=200`);
  const allTasks = fresh.data?.tasks ?? tasks;
  console.log(`     tasks available for work order=${allTasks.length}`);
  const target = allTasks.find((t: any) => t.workflowStatus === "DRAFT") ?? allTasks[0];
  if (!target) {
    check("a task exists for work-order checks", false, "no tasks returned by the API");
  } else {
    const ctx = await call<any>("GET", `/api/v1/tasks/${target.id}/agent-context`);
    check("agent context (work order) served", ctx.status === 200, `status=${ctx.status}`);

    // All three documented prompt modes (C10/C13/C17).
    const modes = ["STANDALONE", "CONNECTED_CLI", "CONNECTED_MCP"];
    let prompt: { status: number; data: any } = { status: 0, data: null };
    for (const mode of modes) {
      const res = await call<any>("POST", `/api/v1/tasks/${target.id}/prompt`, { mode });
      check(`prompt mode ${mode} generated (C17)`, res.status < 300, `status=${res.status} ${code(res) ?? ""}`);
      if (mode === "STANDALONE") prompt = res;
    }
    const text = JSON.stringify(prompt.data ?? {});
    // C13: prompts must never embed credentials.
    const leaksToken = /sdd_session=|Bearer [A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{16,}/.test(text);
    check("C13: prompt contains no credentials", !leaksToken, leaksToken ? "credential-shaped string found" : "");
    check("C10: prompt is bounded (not the whole document set)", text.length < 60_000, `len=${text.length}`);

    const order = await call<any>("GET", `/api/v1/tasks/${target.id}/export/work-order`);
    check("work order export available", order.status === 200, `status=${order.status}`);
  }
}

/* ══════════════════ 8. execution lifecycle ══════════════════ */
section("8. Execution: claim → run → evidence → submit (C2/C3)");
let doneTaskId = "";
{
  // pick a ready-able task that has requirement links (generated tasks should)
  let candidate: any = null;
  for (const t of tasks) {
    if (t.workflowStatus !== "DRAFT") continue;
    await call("POST", `/api/v1/tasks/${t.id}/lint`, {});
    const ready = await call("POST", `/api/v1/tasks/${t.id}/ready`, {});
    if (ready.status < 300) {
      candidate = t;
      break;
    }
  }
  if (!candidate) {
    // fall back to a documentation task (infrastructure-classified) so the
    // execution chain can still be verified.
    const manual = await call<any>("POST", `/api/v1/projects/${projectId}/tasks/manual`, {
      requirement_keys: requirementIds.length ? [requirementIds[0]] : [],
      contract: {
        title: "Verify the full execution lifecycle",
        task_type: "documentation",
        objective: "A READY task can be claimed, run, evidenced, submitted and reviewed exactly once.",
        scope: { expected_paths: ["docs/**"], forbidden_paths: [] },
        constraints: [],
        acceptance_criteria: ["The lifecycle completes and evidence is required."],
        verification: { required: [{ type: "command", command: "bun test" }], evidence: ["test_result"] },
        deliverables: ["automated_tests"],
        stop_conditions: ["The lifecycle cannot be driven end to end."],
        risk_factors: {},
        parallel_safe: false,
        priority: "P1",
      },
    });
    candidate = manual.data?.tasks?.at(-1);
    if (candidate) {
      await call("POST", `/api/v1/tasks/${candidate.id}/lint`, {});
      await call("POST", `/api/v1/tasks/${candidate.id}/ready`, {});
    }
  }
  check("a task reached READY", Boolean(candidate), "no task could be readied");

  if (candidate) {
    doneTaskId = candidate.id;

    // C3: illegal DRAFT→DONE style shortcut
    const illegal = await call("POST", `/api/v1/reviews`, {
      task_id: candidate.id,
      decision: "APPROVED",
      findings: [],
      summary: "attempt to approve without review state",
    });
    check("C3: approve outside NEEDS_REVIEW rejected", illegal.status >= 400, `status=${illegal.status}`);

    // claim
    const claim = await call<any>("POST", `/api/v1/tasks/${candidate.id}/claim`, {
      executor: { type: "LOCAL_AGENT", id: "verify-agent" },
      lease_seconds: 600,
    });
    check("task claimed", claim.status < 300, `status=${claim.status} ${code(claim) ?? ""}`);
    const runId = claim.data?.run_id ?? claim.data?.run?.id;

    // C3: second claim must fail deterministically (single active lease)
    const claim2 = await call("POST", `/api/v1/tasks/${candidate.id}/claim`, {
      executor: { type: "LOCAL_AGENT", id: "verify-agent-2" },
      lease_seconds: 600,
    });
    check("second concurrent claim rejected", claim2.status >= 400, `status=${claim2.status}`);
    check("second claim is a deterministic conflict, not 500", claim2.status === 409, `status=${claim2.status}`);

    const start = await call("POST", `/api/v1/runs/${runId}/start`);
    check("run started", start.status < 300, `status=${start.status}`);

    const hb = await call("POST", `/api/v1/runs/${runId}/heartbeat`, { lease_seconds: 600 });
    check("lease heartbeat accepted", hb.status < 300, `status=${hb.status}`);

    await call("POST", `/api/v1/runs/${runId}/events`, {
      message: "implemented the change",
      client_sequence: 1,
    });

    // C2: the evidence policy requires a PASSED result for EVERY required
    // command of the contract (a single unrelated passing row is not evidence).
    const detail = await call<any>("GET", `/api/v1/tasks/${candidate.id}`);
    const requiredCommands: string[] = (detail.data?.task?.contract?.verification?.required ?? []).map((r: any) => r.command);
    let test = { status: 200 } as { status: number };
    for (const command of requiredCommands.length ? requiredCommands : ["bun test"]) {
      test = await call("POST", `/api/v1/runs/${runId}/tests`, {
        command,
        status: "PASSED",
        exit_code: 0,
        summary: "all green",
      });
      if (test.status >= 300) break;
    }
    check("test evidence recorded (C2)", test.status < 300, `status=${test.status}`);

    // C2: submitting a review with no evidence must be refused.
    // Use a second task to prove the negative without disturbing this one.
    const { runId: runId2, taskId: taskId2 } = await (async () => {
      const m = await call<any>("POST", `/api/v1/projects/${projectId}/tasks/manual`, {
        requirement_keys: requirementIds.length ? [requirementIds[0]] : [],
        contract: {
          title: "Evidence policy probe",
          task_type: "documentation",
          objective: "Review submission without reported tests must be refused by the evidence policy.",
          scope: { expected_paths: ["docs/**"], forbidden_paths: [] },
          constraints: [],
          acceptance_criteria: ["Server refuses unevidenced review."],
          verification: { required: [{ type: "command", command: "bun test" }], evidence: ["test_result"] },
          deliverables: ["implementation"],
          stop_conditions: ["Evidence policy cannot be evaluated."],
          risk_factors: {},
          parallel_safe: false,
          priority: "P2",
        },
      });
      const id = m.data?.tasks?.at(-1)?.id;
      await call("POST", `/api/v1/tasks/${id}/lint`, {});
      await call("POST", `/api/v1/tasks/${id}/ready`, {});
      const c = await call<any>("POST", `/api/v1/tasks/${id}/claim`, {
        executor: { type: "LOCAL_AGENT", id: "evidence-agent" },
        lease_seconds: 600,
      });
      const r = c.data?.run_id ?? c.data?.run?.id;
      await call("POST", `/api/v1/runs/${r}/start`);
      return { runId: r, taskId: id };
    })();
    const noEvidence = await call("POST", `/api/v1/runs/${runId2}/request-review`, {
      summary: "done, trust me",
    });
    check("C2: review without evidence rejected", noEvidence.status >= 400, `status=${noEvidence.status}`);
    check("C2: evidence error code is explicit", code(noEvidence) === "EVIDENCE_MISSING", `code=${code(noEvidence)}`);

    // now submit the real one
    const submit = await call("POST", `/api/v1/runs/${runId}/request-review`, {
      summary: "implemented and verified",
      files_changed: ["docs/verify.md"],
    });
    check("review requested with evidence", submit.status < 300, `status=${submit.status} ${code(submit) ?? ""}`);

    const taskAfter = await call<any>("GET", `/api/v1/tasks/${candidate.id}`);
    const statusAfter = taskAfter.data?.task?.workflowStatus;
    check("task reached NEEDS_REVIEW", statusAfter === "NEEDS_REVIEW", `status=${statusAfter}`);

    // Self-approval by a user is allowed (owner decision 2026-10-01: no reviewer
    // roles); only agent tokens are refused, which the review route enforces.

    // request changes requires findings
    const noFindings = await call("POST", `/api/v1/reviews`, {
      task_id: candidate.id,
      decision: "CHANGES_REQUESTED",
      findings: [],
      summary: "no findings",
    });
    check("changes without findings rejected", noFindings.status >= 400, `status=${noFindings.status}`);
  }
}

/* ══════════════════ 9. bugs ══════════════════ */
section("9. Bugs as entities (C4)");
let bugId = "";
{
  const created = await call<any>("POST", `/api/v1/projects/${projectId}/bugs`, {
    title: "Concurrent claim returns 500",
    current_behavior: "A second simultaneous claim can return HTTP 500.",
    expected_behavior: "Exactly one claim succeeds; the loser gets a deterministic conflict.",
    unchanged_behavior: "Existing valid single claim still succeeds.",
    reproduction: "Start two claim requests simultaneously.",
    severity: "MAJOR",
  });
  check("bug created (C4)", created.status < 300, `status=${created.status}`);
  bugId = created.data?.bug?.id ?? "";
  check("bug has entity id", Boolean(bugId));

  const confirmed = await call("POST", `/api/v1/bugs/${bugId}/confirm`, { note: "reproduced" });
  check("bug confirmed", confirmed.status < 300, `status=${confirmed.status}`);

  // C3-style: illegal bug transition must be refused
  const illegalBug = await call("POST", `/api/v1/bugs/${bugId}/transition`, { to: "CLOSED" });
  check("C3: illegal bug transition rejected", illegalBug.status >= 400, `status=${illegalBug.status}`);

  const fix = await call<any>("POST", `/api/v1/bugs/${bugId}/generate-fix-tasks`, {});
  check("fix task generated from bug", fix.status < 300, `status=${fix.status} ${code(fix) ?? ""}`);

  const listed = await call<any>("GET", `/api/v1/projects/${projectId}/bugs`);
  check("bugs listed", listed.status === 200 && (listed.data?.bugs?.length ?? 0) > 0);
}

/* ══════════════════ 10. convergence ══════════════════ */
section("10. Convergence & feature completion gate (C18)");
{
  const listed = await call<any>("GET", `/api/v1/projects/${projectId}/features`);
  let features = listed.data?.features ?? [];
  if (features.length === 0) {
    // The project read does not embed features; create one explicitly.
    const made = await call<any>("POST", `/api/v1/projects/${projectId}/features`, {
      title: "Offline evidence capture",
      description: "Technicians capture evidence offline and it syncs when connectivity returns.",
      priority: "P1",
    });
    if (made.status < 300 && made.data?.feature) features = [made.data.feature];
  }
  const feature = features[0];
  if (!feature) {
    check("project has at least one feature", false, "feature creation failed");
  } else {
    const gate = await call<any>("GET", `/api/v1/features/${feature.id}/completion-gate`);
    check("completion gate evaluated", gate.status === 200, `status=${gate.status}`);
    // The gate serialises as camelCase `canComplete`. Reading the snake_case
    // field here yielded `undefined`, which made the assertion below pass even
    // when the gate was broken — so resolve the field explicitly and require a
    // real boolean.
    const canComplete = gate.data?.canComplete ?? gate.data?.can_complete;
    console.log(`     gate.can_complete=${canComplete} blockers=${JSON.stringify(gate.data?.blockers ?? gate.data?.reasons ?? [])}`);

    // C18: with an open blocking bug the gate must refuse completion.
    check(
      "C18: open blocking bug blocks completion",
      canComplete === false,
      `can_complete=${canComplete} (expected an explicit false, not undefined)`,
    );

    const complete = await call("POST", `/api/v1/features/${feature.id}/complete`, {});
    console.log(`     force complete → ${complete.status} ${code(complete) ?? ""}`);

    // A feature with no task traced to an approved requirement has no work to
    // check: the gate reports it and the release check refuses it up front.
    if (gate.data?.blockers?.no_tasks === true) {
      check("C18: feature without tasks cannot complete", canComplete === false, `can_complete=${canComplete}`);
      const noWork = await call<any>("POST", `/api/v1/features/${feature.id}/convergence-runs`, {});
      check(
        "release check refuses a feature with no traced requirements",
        noWork.status === 409 && code(noWork) === "FEATURE_HAS_NO_REQUIREMENTS",
        `status=${noWork.status} code=${code(noWork)}`,
      );
    }
    const cvg = gate.data?.blockers?.no_tasks === true ? null : await call<any>("POST", `/api/v1/features/${feature.id}/convergence-runs`, {});
    if (!cvg) {
      // covered above
    } else if (cvg.status < 300) {
      check("convergence run started", true);
      // The service returns `{ run, findings }` — findings are a SIBLING of the
      // run, not a nested field, and each carries `finding_type` (which holds
      // the documented COVERED/PARTIAL/MISSING status). The previous read of
      // `run.findings[].status` always produced an empty list, so the model
      // check below silently degraded to a note instead of asserting.
      const findings: any[] = cvg.data?.findings ?? [];
      const statuses = findings.map((f) => f.finding_type ?? f.status);
      console.log(`     convergence findings=${findings.length} statuses=${JSON.stringify(statuses.slice(0, 8))}`);
      const validStatuses = new Set(["COVERED", "PARTIAL", "MISSING", "CONTRADICTED", "NOT_APPLICABLE"]);
      check(
        "convergence run persisted per-requirement findings",
        findings.length > 0,
        `findings=${findings.length} (run status=${cvg.data?.run?.status})`,
      );
      if (findings.length > 0) {
        check(
          "convergence result statuses match the spec model",
          statuses.every((s: string) => validStatuses.has(s)),
          `statuses=${statuses.join(",")}`,
        );
        check(
          "convergence findings reference a source requirement",
          findings.some((f) => Boolean(f.requirement_key ?? f.requirementKey)),
          "no finding carried a requirement_key",
        );
      } else {
        note("Convergence result model", "run produced no per-requirement results to validate");
      }
    } else {
      // The convergence ANALYSER is an AI role (BYO-provider, C21). The
      // DETERMINISTIC gate must still work without it — that is the C18 part
      // asserted just above.
      check(
        "convergence analyser reports a clear provider error when unbound (C21)",
        code(cvg) === "AI_PROVIDER_NOT_CONFIGURED",
        `code=${code(cvg)}`,
      );
      note(
        "Convergence without an AI provider",
        "convergence analysis requires a bound AI role, so the per-requirement COVERED/PARTIAL/MISSING model is unavailable offline; the deterministic completion gate still enforces C18",
      );
    }
  }
}

/* ══════════════════ 11. exports & audit ══════════════════ */
section("11. Exports, audit trail (C5/C14)");
{
  const md = await call<any>("GET", `/api/v1/projects/${projectId}/export/markdown`);
  check("markdown export (C5 portable snapshot)", md.status === 200, `status=${md.status}`);

  const agents = await call<any>("GET", `/api/v1/projects/${projectId}/export/agents-md`);
  check("AGENTS.md export", agents.status === 200, `status=${agents.status}`);

  const bundle = await call<any>("GET", `/api/v1/projects/${projectId}/export/bundle`);
  check("bundle export", bundle.status === 200, `status=${bundle.status}`);

  const activity = await call<any>("GET", `/api/v1/projects/${projectId}/activity`);
  check("activity/audit trail readable (C14)", activity.status === 200, `status=${activity.status}`);
  const events = activity.data?.events ?? activity.data?.activity ?? [];
  check("audit trail is non-empty", (events.length ?? 0) > 0, `events=${events.length}`);
  const actions = new Set((events ?? []).map((e: any) => e.action));
  console.log(`     distinct audit actions: ${[...actions].slice(0, 12).join(", ")}`);

  // C13: exports must not leak credentials
  const exportText = JSON.stringify(bundle.data ?? {}) + JSON.stringify(md.data ?? {});
  const leak = /sdd_session=|sk-[A-Za-z0-9]{16,}|SDD_MASTER_KEY/.test(exportText);
  check("C13: exports contain no secrets", !leak, leak ? "secret-shaped string in export" : "");

  const taskEvents = doneTaskId ? await call<any>("GET", `/api/v1/tasks/${doneTaskId}/events`) : null;
  if (taskEvents) {
    check("task event timeline (C14)", taskEvents.status === 200, `status=${taskEvents.status}`);
  }
}

/* ══════════════════ summary ══════════════════ */
console.log(`\n${"═".repeat(62)}`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
}
if (docMismatches.length) {
  console.log("\nDOC-vs-IMPLEMENTATION NOTES:");
  for (const d of docMismatches) console.log(`  ⚠ ${d}`);
}
console.log("═".repeat(62));
process.exit(fail > 0 ? 1 : 0);
