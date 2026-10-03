import { describe, expect, test } from "bun:test";
import { resolveRequestToken } from "../src/lib/api.js";
import { runTaskMismatch } from "../src/lib/run-state.js";

describe("resolveRequestToken", () => {
  const saved = { token: "sdd_saved", server_url: "https://sdd.example.com/" };

  test("an explicit null means anonymous — the saved token is not substituted", () => {
    expect(resolveRequestToken(null, saved, "https://sdd.example.com")).toBeNull();
  });

  test("an explicit token wins", () => {
    expect(resolveRequestToken("sdd_other", saved, "https://elsewhere.example.com")).toBe("sdd_other");
  });

  test("the saved token only goes to the server that issued it", () => {
    expect(resolveRequestToken(undefined, saved, "https://sdd.example.com")).toBe("sdd_saved");
    expect(resolveRequestToken(undefined, saved, "https://SDD.example.com/")).toBe("sdd_saved");
    expect(resolveRequestToken(undefined, saved, "https://evil.example.com")).toBeNull();
  });
});

describe("runTaskMismatch", () => {
  test("the run file must belong to the task named on the command line", () => {
    expect(runTaskMismatch("TASK-001", "task-001")).toBeNull();
    expect(runTaskMismatch("TASK-001", "TASK-002")).toContain("TASK-001");
  });

  test("older run files without a task key, or commands without one, are accepted", () => {
    expect(runTaskMismatch(undefined, "TASK-002")).toBeNull();
    expect(runTaskMismatch("TASK-001", undefined)).toBeNull();
  });
});
