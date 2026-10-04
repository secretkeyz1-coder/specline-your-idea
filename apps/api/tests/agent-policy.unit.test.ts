import { describe, expect, test } from "bun:test";
import { decideLinkModeFromApi, modeForAutoApprove } from "../src/modules/agent/link-policy.js";
import { bugTransitionNeedsHuman } from "../src/modules/bug/service.js";
import { convergenceVerdictStale } from "../src/modules/convergence/service.js";
import { dependencyEditAllowed } from "../src/modules/task/repo.js";
import { mcpFailure, textContent } from "@sdd/mcp";
import { daemonResumeBlocker, dispatchResume } from "../src/modules/agent/gateway.js";
import type { DbExecutor } from "@sdd/db";

test("machine-attributed interactive runs resume without a daemon socket or AUTO_RUN grant", async () => {
  const db = { select: () => { throw new Error("Interactive resume must not consult daemon links"); } } as unknown as DbExecutor;
  const run = { id: "run", machineId: "machine", metadata: { daemon_execution: false } };
  expect(await daemonResumeBlocker(db, run, "project")).toBeNull();
  expect(await dispatchResume(db, run, { id: "task", key: "TASK-001", projectId: "project" })).toEqual({ acked: false, reason: "NOT_A_DAEMON_RUN" });
});

/** Auto-approve is a web-app decision; tokens can create/keep/lower a link, never raise it. */
describe("repository link permission policy", () => {
  test("the two-option control maps to AUTO_RUN and MANUAL, keeping legacy ASSISTED", () => {
    expect(modeForAutoApprove(true, "MANUAL")).toBe("AUTO_RUN");
    expect(modeForAutoApprove(false, "AUTO_RUN")).toBe("MANUAL");
    expect(modeForAutoApprove(false, "ASSISTED")).toBe("ASSISTED");
    expect(modeForAutoApprove(false, null)).toBe("MANUAL");
  });

  test("tokens can never set or raise AUTO_RUN", () => {
    const set = decideLinkModeFromApi({ viaToken: true, current: null, requested: "AUTO_RUN" });
    expect(set.ok).toBe(false);
    if (!set.ok) expect(set.code).toBe("AUTO_APPROVE_WEB_ONLY");
    const raise = decideLinkModeFromApi({ viaToken: true, current: "MANUAL", requested: "AUTO_RUN" });
    expect(raise.ok).toBe(false);
  });

  test("tokens respect the ceiling but may keep or lower", () => {
    expect(decideLinkModeFromApi({ viaToken: true, current: "MANUAL", requested: "ASSISTED" }).ok).toBe(false);
    expect(decideLinkModeFromApi({ viaToken: true, current: "AUTO_RUN", requested: "AUTO_RUN" })).toEqual({ ok: true, mode: null });
    expect(decideLinkModeFromApi({ viaToken: true, current: "AUTO_RUN", requested: "MANUAL" })).toEqual({ ok: true, mode: "MANUAL" });
    expect(decideLinkModeFromApi({ viaToken: true, current: null, requested: "ASSISTED" })).toEqual({ ok: true, mode: "ASSISTED" });
    expect(decideLinkModeFromApi({ viaToken: true, current: "AUTO_RUN", requested: undefined })).toEqual({ ok: true, mode: null });
  });

  test("a browser session may ask for any mode (admin is checked by the route)", () => {
    expect(decideLinkModeFromApi({ viaToken: false, current: "MANUAL", requested: "AUTO_RUN" })).toEqual({ ok: true, mode: "AUTO_RUN" });
  });
});

describe("bug closing decisions", () => {
  test("closing states need a person; reporting and fixing states do not", () => {
    for (const status of ["VERIFIED", "CLOSED", "WONT_FIX", "NOT_A_BUG", "DUPLICATE"]) expect(bugTransitionNeedsHuman(status)).toBe(true);
    for (const status of ["ASSESSING", "CONFIRMED", "PLANNED", "IN_FIX", "VERIFYING"]) expect(bugTransitionNeedsHuman(status)).toBe(false);
  });
});

describe("convergence verdict freshness", () => {
  const completedAt = new Date("2026-09-01T10:00:00Z");
  const run = { requirementsRevisionId: "req-1", completedAt };

  test("current when requirements and tasks are unchanged", () => {
    expect(convergenceVerdictStale(run, { approvedRequirementsRevisionId: "req-1", scopeTasks: [{ key: "TASK-001", updatedAt: new Date("2026-09-01T09:00:00Z") }] })).toBeNull();
  });

  test("stale when the approved requirements moved on", () => {
    expect(convergenceVerdictStale(run, { approvedRequirementsRevisionId: "req-2", scopeTasks: [] })).toContain("requirements");
  });

  test("stale when an in-scope task changed after the run", () => {
    const verdict = convergenceVerdictStale(run, { approvedRequirementsRevisionId: "req-1", scopeTasks: [{ key: "TASK-004", updatedAt: new Date("2026-09-01T11:00:00Z") }] });
    expect(verdict).toContain("TASK-004");
  });

  test("an unfinished run is not a verdict", () => {
    expect(convergenceVerdictStale({ requirementsRevisionId: "req-1", completedAt: null }, { approvedRequirementsRevisionId: "req-2", scopeTasks: [] })).toBeNull();
  });
});

describe("dependency edits", () => {
  test("only DRAFT and READY tasks take dependency changes", () => {
    expect(dependencyEditAllowed("DRAFT")).toBe(true);
    expect(dependencyEditAllowed("READY")).toBe(true);
    for (const status of ["CLAIMED", "IN_PROGRESS", "VALIDATING", "NEEDS_REVIEW", "DONE", "BLOCKED"]) expect(dependencyEditAllowed(status)).toBe(false);
  });
});

describe("MCP tool results", () => {
  test("a failed service call is reported with isError", () => {
    const result = textContent(mcpFailure({ code: "TASK_ALREADY_CLAIMED", message: "taken" }));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toEqual({ error: { code: "TASK_ALREADY_CLAIMED", message: "taken" } });
  });

  test("a successful call is not marked as an error", () => {
    expect(textContent({ ok: true }).isError).toBeUndefined();
  });
});
