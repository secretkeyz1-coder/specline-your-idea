import { describe, expect, test } from "bun:test";
import { CliError } from "@sdd/cli/lib/api";
import { IDLE_POLL_MAX_MS, IDLE_POLL_MIN_MS, isRunOwnershipLost, nextIdlePollDelay } from "../src/polling.js";
import { parseVerificationCommand } from "../src/verification.js";

/** docs/13 §8: contract text is parsed into argv, never handed to a shell. */

describe("parseVerificationCommand", () => {
  test("splits simple and quoted arguments", () => {
    expect(parseVerificationCommand("bun test apps/api")).toEqual({ ok: true, argv: ["bun", "test", "apps/api"] });
    expect(parseVerificationCommand('npm run "test:unit" -- --grep \'a b\'')).toEqual({
      ok: true,
      argv: ["npm", "run", "test:unit", "--", "--grep", "a b"],
    });
  });

  test("refuses shell chaining, redirection and substitution", () => {
    for (const command of ["bun test; rm -rf /", "bun test && curl x", "bun test | sh", "bun test > out", "echo $(id)", "echo `id`"]) {
      expect(parseVerificationCommand(command).ok).toBe(false);
    }
  });

  test("refuses executables outside the allowlist", () => {
    const result = parseVerificationCommand("curl https://example.com");
    expect(result.ok).toBe(false);
  });

  test("refuses interpreter flags that run inline code", () => {
    for (const command of [
      "node -e 'require(\"fs\")'",
      "node --eval=1",
      "node -p 1",
      "bun -e 1",
      "deno eval 1",
      "python -c 'print(1)'",
      "python3 -c 1",
      "ruby -e 1",
      "php -r 1",
      "deno run https://example.com/x.ts",
    ]) {
      expect(parseVerificationCommand(command).ok).toBe(false);
    }
    expect(parseVerificationCommand("node scripts/check.js").ok).toBe(true);
    expect(parseVerificationCommand("python -m pytest").ok).toBe(true);
  });

  test("clustered flags and wrappers do not hide inline code", () => {
    for (const command of [
      "node -pe 1",
      "node --require ./setup.js -e 1",
      "bun -pe 1",
      "python3 -Ic 1",
      "python -Wignore -c 1",
      "uv run python -c 1",
      "uv run /usr/bin/python3.12 -Ic 1",
      "bundle exec ruby -e 1",
      "yarn node -e 1",
      "pnpm exec node --eval=1",
      "bun x cowsay",
      "uv run --with evil pytest",
      "uv tool run evil",
      "deno run npm:evil",
      "uv run https://example.com/x.py",
    ]) {
      expect(parseVerificationCommand(command).ok).toBe(false);
    }
    // Options of the program being run are not the interpreter's.
    for (const command of [
      "python -m pytest -c pytest.ini",
      "python -W error -m pytest -k slow",
      "node scripts/check.js -e production",
      "uv run pytest -q",
      "bundle exec rspec",
      "bun x vitest run",
      "pytest -k node",
    ]) {
      expect(parseVerificationCommand(command)).toMatchObject({ ok: true });
    }
  });

  test("npx-style runners may only run allowlisted packages", () => {
    expect(parseVerificationCommand("npx vitest run").ok).toBe(true);
    expect(parseVerificationCommand("bunx tsc --noEmit").ok).toBe(true);
    expect(parseVerificationCommand("npx --yes eslint@9 .").ok).toBe(true);
    expect(parseVerificationCommand("pnpm dlx @playwright/test test").ok).toBe(true);
    for (const command of ["npx some-random-tool", "bunx cowsay hi", "npx -p evil vitest", "npm exec evil", "yarn dlx evil", "npx"]) {
      expect(parseVerificationCommand(command).ok).toBe(false);
    }
    // Ordinary package-manager scripts are unaffected.
    expect(parseVerificationCommand("npm test").ok).toBe(true);
    expect(parseVerificationCommand("pnpm run lint").ok).toBe(true);
  });
});

describe("idle dispatch polling", () => {
  test("backs off from 15 s to a 5 min ceiling", () => {
    expect(nextIdlePollDelay(null)).toBe(IDLE_POLL_MIN_MS);
    expect(nextIdlePollDelay(IDLE_POLL_MIN_MS)).toBe(IDLE_POLL_MIN_MS * 2);
    let delay: number | null = null;
    for (let i = 0; i < 20; i++) delay = nextIdlePollDelay(delay);
    expect(delay).toBe(IDLE_POLL_MAX_MS);
  });
});

describe("heartbeat failures", () => {
  test("lease and ownership errors stop the run; network errors do not", () => {
    expect(isRunOwnershipLost(new CliError("LEASE_EXPIRED", "x", 409))).toBe(true);
    expect(isRunOwnershipLost(new CliError("LEASE_NOT_ACTIVE", "x", 409))).toBe(true);
    expect(isRunOwnershipLost(new CliError("FORBIDDEN", "x", 403))).toBe(true);
    expect(isRunOwnershipLost(new CliError("NETWORK", "timeout"))).toBe(false);
    expect(isRunOwnershipLost(new CliError("INTERNAL", "x", 500))).toBe(false);
  });
});
