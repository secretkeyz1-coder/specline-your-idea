import { describe, expect, test } from "bun:test";
import { isUniqueViolation } from "@sdd/shared";
import { corsOriginAllowed } from "../src/plugins.js";
import {
  computeReadiness,
  discoveryAllowsRequirements,
  uncoveredRequiredTopics,
  uncoveredTopicAssumption,
  type DiscoverySession,
} from "../src/modules/discovery/service.js";

/** Pure pieces of the audit-hardening fixes: readiness vs the requirements gate, CORS, unique violations. */

type Fact = Parameters<typeof computeReadiness>[1][number];
type Assumption = Parameters<typeof computeReadiness>[2][number];

const session = (coverage: DiscoverySession["coverage"], status: DiscoverySession["status"] = "ACTIVE") =>
  ({ id: "s", projectId: "p", status, readiness: "INCOMPLETE", coverage, understanding: "" }) as unknown as DiscoverySession;
const fact = (factKey: string) => ({ factKey, status: "ACTIVE" }) as unknown as Fact;
const assumption = (description: string, status: "PROPOSED" | "ACCEPTED") => ({ description, status }) as unknown as Assumption;

describe("discovery completion vs the requirements gate", () => {
  test("uncovered required topics are the ones without coverage or a user-stated fact", () => {
    const coverage = { problem: { status: "KNOWN" as const, blocking: true }, core_workflows: { status: "UNKNOWN" as const, blocking: true } };
    expect(uncoveredRequiredTopics(coverage, [fact("primary_users_user")])).toEqual(["core_workflows", "mvp_scope"]);
    expect(uncoveredRequiredTopics(coverage, [fact("primary_users_user"), fact("core_workflows_user"), fact("mvp_scope_user")])).toEqual([]);
  });

  test("completing on assumptions with zero PROPOSED assumptions still opens the gate", () => {
    const s = session({});
    const readiness = computeReadiness(s, [], [], []);
    expect(readiness).toBe("INCOMPLETE");
    // Before the fix: nothing to accept → the gate stayed shut forever.
    expect(discoveryAllowsRequirements(s, readiness)).toBe(false);
    // Completion records each open required topic as an ACCEPTED assumption.
    const recorded = uncoveredRequiredTopics(s.coverage, []).map((t) => assumption(uncoveredTopicAssumption(t), "ACCEPTED"));
    expect(recorded).toHaveLength(4);
    expect(discoveryAllowsRequirements(s, computeReadiness(s, [], recorded, []))).toBe(false);
    expect(discoveryAllowsRequirements({ ...s, status: "COMPLETED" }, computeReadiness(s, [], recorded, []))).toBe(true);
  });

  test("a COMPLETED session passes the gate even without accepted assumptions (legacy data)", () => {
    const s = session({}, "COMPLETED");
    expect(discoveryAllowsRequirements(s, computeReadiness(s, [], [], []))).toBe(true);
  });

  test("an ACTIVE incomplete session with only PROPOSED assumptions stays gated", () => {
    const s = session({});
    expect(discoveryAllowsRequirements(s, "INCOMPLETE")).toBe(false);
    expect(discoveryAllowsRequirements(s, "READY_WITH_ASSUMPTIONS")).toBe(true);
  });
});

describe("CORS origin policy", () => {
  const dev = { WEB_PUBLIC_URL: "http://localhost:5173", NODE_ENV: "development" };
  const prod = { WEB_PUBLIC_URL: "https://sdd.example.com", NODE_ENV: "production" };

  test("the configured web origin is always allowed", () => {
    expect(corsOriginAllowed("http://localhost:5173", dev)).toBe(true);
    expect(corsOriginAllowed("https://sdd.example.com", prod)).toBe(true);
  });

  test("outside production only loopback hosts on the web port are added", () => {
    expect(corsOriginAllowed("http://127.0.0.1:5173", dev)).toBe(true);
    expect(corsOriginAllowed("http://[::1]:5173", dev)).toBe(true);
    expect(corsOriginAllowed("http://localhost:3000", dev)).toBe(false);
    expect(corsOriginAllowed("https://evil.example", dev)).toBe(false);
    expect(corsOriginAllowed("http://localhost.evil.example:5173", dev)).toBe(false);
    expect(corsOriginAllowed("null", dev)).toBe(false);
  });

  test("production reflects nothing but the web origin", () => {
    expect(corsOriginAllowed("http://localhost:443", prod)).toBe(false);
    expect(corsOriginAllowed("https://other.example.com", prod)).toBe(false);
  });
});

describe("unique-violation detection", () => {
  const pg = (constraint?: string) => Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { errno: "23505", code: "ERR_POSTGRES_SERVER_ERROR", constraint });

  test("finds SQLSTATE 23505 through a wrapper's cause chain", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: pg("users_email_unique") });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "users_email_unique")).toBe(true);
    expect(isUniqueViolation(wrapped, "workspaces_slug_unique")).toBe(false);
  });

  test("other errors are not unique violations", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(Object.assign(new Error("fk"), { errno: "23503" }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
