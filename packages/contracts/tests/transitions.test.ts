import { describe, expect, test } from "bun:test";
import { isLegalTransition, resolveTransition, isTerminal, isLegalRunTransition, isLegalBugTransition, isBlockingBug, TASK_TRANSITIONS } from "../src/transitions.js";
import type { WorkflowStatus } from "../src/enums.js";

/** docs/12_AGENT_STATE_MACHINE.md — table-driven transition tests (C20, T107). */

describe("task transition table", () => {
  test("legal happy path transitions resolve", () => {
    expect(resolveTransition("DRAFT", "ready")).toBe("READY");
    expect(resolveTransition("READY", "claim")).toBe("CLAIMED");
    expect(resolveTransition("CLAIMED", "start")).toBe("IN_PROGRESS");
    expect(resolveTransition("IN_PROGRESS", "begin_validation")).toBe("VALIDATING");
    expect(resolveTransition("VALIDATING", "submit")).toBe("NEEDS_REVIEW");
    expect(resolveTransition("NEEDS_REVIEW", "approve")).toBe("DONE");
  });

  test("illegal shortcuts are rejected (C3)", () => {
    expect(isLegalTransition("DRAFT", "approve")).toBe(false);
    expect(isLegalTransition("DRAFT", "done")).toBe(false);
    expect(isLegalTransition("READY", "start")).toBe(false); // claim required first
    expect(isLegalTransition("READY", "approve")).toBe(false);
    expect(isLegalTransition("CLAIMED", "submit")).toBe(false);
    expect(isLegalTransition("IN_PROGRESS", "approve")).toBe(false);
    expect(isLegalTransition("NEEDS_REVIEW", "claim")).toBe(false);
    expect(isLegalTransition("DONE", "ready")).toBe(false);
    expect(isLegalTransition("CANCELLED", "claim")).toBe(false);
  });

  test("review loop and blocked paths are legal", () => {
    expect(resolveTransition("NEEDS_REVIEW", "request_changes")).toBe("CHANGES_REQUESTED");
    expect(resolveTransition("CHANGES_REQUESTED", "requeue")).toBe("READY");
    expect(resolveTransition("IN_PROGRESS", "block")).toBe("BLOCKED");
    expect(resolveTransition("VALIDATING", "block")).toBe("BLOCKED");
    expect(resolveTransition("BLOCKED", "unblock_ready")).toBe("READY");
    expect(resolveTransition("BLOCKED", "unblock_resume")).toBe("IN_PROGRESS");
    expect(resolveTransition("VALIDATING", "validation_failed")).toBe("IN_PROGRESS");
    expect(resolveTransition("CLAIMED", "release")).toBe("READY");
    expect(resolveTransition("IN_PROGRESS", "requeue")).toBe("READY");
    expect(resolveTransition("VALIDATING", "requeue")).toBe("READY");
  });

  test("non-blocking claim release is illegal from BLOCKED review states", () => {
    expect(isLegalTransition("BLOCKED", "submit")).toBe(false);
    expect(isLegalTransition("CHANGES_REQUESTED", "approve")).toBe(false);
  });

  test("terminal statuses are terminal", () => {
    expect(isTerminal("DONE")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("READY")).toBe(false);
    for (const status of Object.keys(TASK_TRANSITIONS) as WorkflowStatus[]) {
      if (isTerminal(status)) {
        expect(Object.keys(TASK_TRANSITIONS[status]!)).toHaveLength(0);
      }
    }
  });

  test("run lifecycle is enforced", () => {
    expect(isLegalRunTransition("CREATED", "STARTING")).toBe(true);
    expect(isLegalRunTransition("STARTING", "RUNNING")).toBe(true);
    expect(isLegalRunTransition("RUNNING", "VALIDATING")).toBe(true);
    expect(isLegalRunTransition("VALIDATING", "SUBMITTED")).toBe(true);
    expect(isLegalRunTransition("SUBMITTED", "FINISHED")).toBe(true);
    expect(isLegalRunTransition("CREATED", "RUNNING")).toBe(false);
    expect(isLegalRunTransition("FINISHED", "RUNNING")).toBe(false);
  });

  test("bug lifecycle is enforced and blocking bugs gate completion", () => {
    expect(isLegalBugTransition("REPORTED", "CONFIRMED")).toBe(true);
    expect(isLegalBugTransition("REPORTED", "CLOSED")).toBe(false);
    expect(isLegalBugTransition("VERIFIED", "CLOSED")).toBe(true);
    expect(isBlockingBug("CONFIRMED")).toBe(true);
    expect(isBlockingBug("IN_FIX")).toBe(true);
    expect(isBlockingBug("CLOSED")).toBe(false);
    expect(isBlockingBug("NOT_A_BUG")).toBe(false);
  });
});
