import { findRepoRoot } from "../lib/config.js";
import { api, CliError, fail, output } from "../lib/api.js";
import { program } from "./program.js";
import { verificationInvocation, stopVerification } from "../lib/verification.js";
import { currentRunId } from "./task.js";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parseVerificationCommand } from "@sdd/contracts";

/** sddctl run …: status, progress, test results and heartbeats of the active run. */

/* ── run ── */
const run = program.command("run").description("Active run commands");

run
  .command("status")
  .description("Show the active run")
  .action(async () => {
    try {
      const runId = await currentRunId();
      const state = JSON.parse(readFileSync(`${findRepoRoot()}/.sdd/run.json`, "utf8")) as { task_key?: string };
      output({ run_id: runId, task_key: state.task_key });
    } catch (e) {
      fail(e);
    }
  });

run
  .command("progress")
  .description("Report progress on the active run (T125)")
  .requiredOption("--message <message>", "what was done")
  .action(async (opts: { message: string }) => {
    try {
      const runId = await currentRunId();
      // One key for this report (the server also renews the lease on it).
      const key = globalThis.crypto.randomUUID();
      await api("POST", `/api/v1/runs/${runId}/events`, { body: { type: "progress_reported", message: opts.message, idempotency_key: key } });
      output({ reported: true });
    } catch (e) {
      fail(e);
    }
  });

run
  .command("test")
  .description("Report a validation result (T126)")
  .requiredOption("--command <command>", "the verification command")
  .option("--status <status>", "passed | failed | error | skipped")
  .option("--execute", "Execute the command and capture its real result", false)
  .option("--exit-code <code>", "actual exit code when reporting an external command")
  .option("--duration <ms>", "duration in ms")
  .option("--summary <summary>", "test summary")
  .action(async (opts: { command: string; status?: string; execute: boolean; exitCode?: string; duration?: string; summary?: string }) => {
    try {
      const runId = await currentRunId();
      let status = opts.status?.toUpperCase() ?? "";
      let exitCode = opts.exitCode == null ? undefined : Number(opts.exitCode);
      if (opts.execute) {
        const parsed = parseVerificationCommand(opts.command);
        if (!parsed.ok) throw new CliError("VERIFICATION_UNSUPPORTED", parsed.reason);
        const started = Date.now();
        let log = "";
        const argv = verificationInvocation(parsed.argv);
        const child = spawn(argv[0]!, argv.slice(1), { cwd: findRepoRoot()!, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
        const capture = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-4000); };
        child.stdout.on("data", capture); child.stderr.on("data", capture);
        const timer = setTimeout(() => stopVerification(child), 15 * 60_000);
        try { exitCode = await new Promise<number>((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve(code ?? -1)); }); }
        finally { clearTimeout(timer); }
        status = exitCode === 0 ? "PASSED" : "FAILED";
        opts.duration = String(Date.now() - started); opts.summary = log;
      }
      if (!["PASSED", "FAILED", "ERROR", "SKIPPED"].includes(status)) {
        throw new CliError("VALIDATION_ERROR", "--status must be passed|failed|error|skipped");
      }
      await api("POST", `/api/v1/runs/${runId}/tests`, {
        body: {
          command: opts.command,
          status,
          ...(exitCode == null ? {} : { exit_code: exitCode }),
          // Optional on the server but not nullable: sending null for an
          // omitted flag failed every plain `run test` with VALIDATION_ERROR.
          ...(opts.duration ? { duration_ms: Number(opts.duration) } : {}),
          ...(opts.summary ? { summary: opts.summary } : {}),
          idempotency_key: globalThis.crypto.randomUUID(),
        },
      });
      output({ reported: true, status });
    } catch (e) {
      fail(e);
    }
  });

// Spawned automatically on claim; keeps long copy-paste runs alive and exits when ownership ends.
run.command("keepalive <run-id>", { hidden: true }).action(async (runId: string) => {
  let failures = 0;
  for (;;) {
    try {
      const current = JSON.parse(readFileSync(`${findRepoRoot()}/.sdd/run.json`, "utf8")) as { run_id: string };
      if (current.run_id !== runId) return;
      await api("POST", `/api/v1/runs/${runId}/heartbeat`, { body: { lease_seconds: 900 } });
      failures = 0;
    } catch (error) {
      if (error instanceof CliError && error.httpStatus && error.httpStatus < 500) return;
      if (++failures >= 10) return;
    }
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
});

run
  .command("heartbeat")
  .description("Keep the claim alive during long work: renew the active run's lease")
  .option("--lease-seconds <seconds>", "new lease length (60–3600)", "900")
  .action(async (opts: { leaseSeconds: string }) => {
    try {
      const runId = await currentRunId();
      const seconds = Number(opts.leaseSeconds);
      if (!Number.isInteger(seconds) || seconds < 60 || seconds > 3600) {
        throw new CliError("VALIDATION_ERROR", "--lease-seconds must be a whole number between 60 and 3600");
      }
      const result = await api<{ lease_expires_at: string }>("POST", `/api/v1/runs/${runId}/heartbeat`, { body: { lease_seconds: seconds } });
      output({ run_id: runId, lease_expires_at: result.lease_expires_at });
    } catch (e) {
      fail(e);
    }
  });
