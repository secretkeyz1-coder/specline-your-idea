import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const apiRoot = join(import.meta.dir, "..", "..", "api");

test("actual production build script produces a standalone Node CLI with every command registered once", () => {
  const build = spawnSync(process.execPath, ["scripts/build-cli.ts"], { cwd: apiRoot, encoding: "utf8", timeout: 30_000 });
  expect(build.stderr).toBe("");
  expect(build.status).toBe(0);
  const bundle = join(apiRoot, "dist", "cli", "sddctl.mjs");
  expect(readFileSync(bundle, "utf8")).toStartWith("#!/usr/bin/env node\n");
  const isolated = mkdtempSync(join(tmpdir(), "sddctl-node-"));
  try {
    const installed = join(isolated, "sddctl.mjs");
    copyFileSync(bundle, installed);
    const node = process.env.SDD_TEST_NODE ?? "node";
    const commands = [[], ["login"], ["connect"], ["project"], ["project", "connect"], ["task", "next"], ["task", "submit"], ["ui", "pull"], ["run", "test"], ["mcp"], ["bug", "report"], ["update"]];
    for (const command of commands) {
      const result = spawnSync(node, [installed, ...command, "--help"], { cwd: isolated, encoding: "utf8", timeout: 10_000 });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: sddctl");
      if (command.length === 0) {
        for (const name of ["login", "logout", "whoami", "status", "project", "connect", "task", "ui", "run", "mcp", "bug", "update"]) {
          expect(result.stdout.match(new RegExp(`^  ${name}(?:[ \\[])`, "gm"))).toHaveLength(1);
        }
      }
      if (command.at(-1) === "connect") {
        expect(result.stdout).toContain("<pairing-code>");
        expect(result.stdout).toContain("--server <url>");
        expect(result.stdout).toContain("--mode <mode>");
      }
      if (command[0] === "login") expect(result.stdout).toContain("--server <url>");
    }
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
}, 120_000);
