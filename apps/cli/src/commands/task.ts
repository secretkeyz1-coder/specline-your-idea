import { findRepoRoot, machineFingerprint, readRepoLink } from "../lib/config.js";
import { api, CliError, fail, output, printTable } from "../lib/api.js";
import { runTaskMismatch } from "../lib/run-state.js";
import type { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { collectRunEvidence, git } from "../lib/evidence.js";

/** sddctl task …: next, list, show, context, prompt, claim, start, block, submit — and the git helpers submit uses. */

/* ── task ── */

export function requireLink(): { projectId: string; projectKey: string } {
  const repoRoot = findRepoRoot();
  if (!repoRoot) throw new CliError("NO_REPO", "Not inside a git repository");
  const link = readRepoLink(repoRoot);
  if (!link?.project_id) throw new CliError("NOT_LINKED", "Repository not linked — run `sddctl project link <key>`");
  return { projectId: link.project_id, projectKey: link.project_key };
}

async function resolveTask(projectId: string, key: string): Promise<{ id: string }> {
  const { tasks } = await api<{ tasks: Array<{ id: string; key: string }> }>(
    "GET",
    `/api/v1/projects/${projectId}/tasks?q=${encodeURIComponent(key)}&limit=50`,
  );
  const exact = tasks.find((t) => t.key.toUpperCase() === key.toUpperCase());
  if (!exact) throw new CliError("TASK_NOT_FOUND", `Task ${key} not found in this project`);
  return exact;
}

export function registerTask(program: Command): void {
  const task = program.command("task").description("Task commands");

  task
    .command("next")
    .description("Ask the scheduler for the next claimable task (dependency-aware)")
    .action(async () => {
      try {
        const { projectId } = requireLink();
        const { task: next } = await api<{ task: { id: string; key: string; title: string; taskType: string; priority: string; position: number } | null }>(
          "GET",
          `/api/v1/projects/${projectId}/scheduler/next`,
        );
        if (!next) {
          // Say WHY, so an agent working through the plan knows whether to stop:
          // everything done, or work parked on a human reviewer.
          const { tasks } = await api<{ tasks: Array<{ key: string; title: string; workflowStatus: string }> }>(
            "GET",
            `/api/v1/projects/${projectId}/tasks?limit=500`,
          );
          const { summary } = await api<{ summary: { total: number; done: number; review: number; blocked: number } }>("GET", `/api/v1/projects/${projectId}/scheduler/summary`);
          const open = tasks.filter((t) => !["DONE", "CANCELLED"].includes(t.workflowStatus));
          const inReview = open.filter((t) => t.workflowStatus === "NEEDS_REVIEW");
          const blocked = open.filter((t) => t.workflowStatus === "BLOCKED");
          if (summary.total === summary.done) {
            const localLink = readRepoLink(findRepoRoot()!);
            const { links } = await api<{ links: Array<{ link: { machineId: string; permissionMode: string; status: string } }> }>("GET", `/api/v1/agents/repo-links?project_id=${projectId}`);
            const saved = links.find(row => row.link.machineId === localLink?.machine_id && row.link.status === "ACTIVE");
            if (saved?.link.permissionMode === "AUTO_RUN") {
              const reviewed = await api<{ status: string; message?: string }>("POST", `/api/v1/projects/${projectId}/orchestrate`);
              if (reviewed.status === "FIX_TASKS_READY") { console.log("FIX_TASKS_READY: release review generated corrections. Run sddctl task next again."); return; }
              if (reviewed.status !== "COMPLETE") { console.log(`${reviewed.status}: ${reviewed.message ?? "Release review still needs attention"}`); return; }
            }
            if (saved?.link.permissionMode !== "AUTO_RUN") { console.log("BUILD_DONE: tasks are finished; run feature Convergence and release approval in the web app."); return; }
            console.log("ALL_DONE: tasks and feature release reviews passed.");
          } else if (summary.review > 0) {
            console.log(
              `WAITING_FOR_REVIEW: ${inReview.map((t) => t.key).join(", ")} ${inReview.length === 1 ? "needs" : "need"} a human reviewer before the remaining tasks can start.`,
            );
            console.log("Stop here and ask the user to review them in the web app, then run `sddctl task next` again.");
          } else if (summary.blocked > 0) {
            console.log(`BLOCKED: ${blocked.map((t) => t.key).join(", ")} are blocked. Resolve the blocker, or ask the user.`);
          } else {
            console.log(`NOTHING_CLAIMABLE: ${summary.total - summary.done} open task(s), but none is ready yet — another agent may be working on them.`);
          }
          return;
        }
        console.log(`Next claimable task: ${next.key} — ${next.title}`);
        console.log(`Claim it with: sddctl task claim ${next.key}`);
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("list")
    .description("List tasks (default: ready)")
    .option("--ready", "only READY tasks", false)
    .option("--all", "all statuses", false)
    .action(async (opts: { ready: boolean; all: boolean }) => {
      try {
        const { projectId } = requireLink();
        const status = opts.all ? undefined : "READY";
        const url = `/api/v1/projects/${projectId}/tasks${status ? `?status=${status}` : ""}`;
        const { tasks } = await api<{ tasks: Array<{ key: string; title: string; workflowStatus: string; hardness: number; riskLevel: string }> }>("GET", url);
        printTable(
          tasks.map((t) => ({ key: t.key, title: t.title, status: t.workflowStatus, hardness: t.hardness, risk: t.riskLevel })),
          ["key", "title", "status", "hardness", "risk"],
        );
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("show <task-key>")
    .description("Show the task contract")
    .action(async (key: string) => {
      try {
        const { projectId } = requireLink();
        const t = await resolveTask(projectId, key);
        const detail = await api("GET", `/api/v1/tasks/${t.id}`);
        output(detail);
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("context <task-key>")
    .description("Fetch the agent context pack (use --format agent for the full JSON contract)")
    .option("--format <format>", "human | agent | json", "agent")
    .action(async (key: string, opts: { format: string }) => {
      try {
        const { projectId } = requireLink();
        const t = await resolveTask(projectId, key);
        const pack = await api("GET", `/api/v1/tasks/${t.id}/agent-context`);
        output(pack);
        void opts;
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("prompt <task-key>")
    .description("Print a standalone work-order prompt")
    .action(async (key: string) => {
      try {
        const { projectId } = requireLink();
        const t = await resolveTask(projectId, key);
        const { prompt } = await api<{ prompt: string }>("POST", `/api/v1/tasks/${t.id}/prompt`, { body: { mode: "STANDALONE" } });
        console.log(prompt);
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("claim <task-key>")
    .description("Atomically claim a READY task (T124)")
    .action(async (key: string) => {
      try {
        const { projectId } = requireLink();
        const t = await resolveTask(projectId, key);
        const result = await api<{ run_id: string; lease_expires_at: string }>("POST", `/api/v1/tasks/${t.id}/claim`, {
          body: { executor: { type: "LOCAL_AGENT", id: machineFingerprint() }, lease_seconds: 900 },
        });
        const repoRoot = findRepoRoot()!;
        mkdirSync(`${repoRoot}/.sdd`, { recursive: true });
        // base_commit: where this run started, so submit can list the files it changed.
        writeFileSync(
          `${repoRoot}/.sdd/run.json`,
          JSON.stringify({ task_key: key.toUpperCase(), run_id: result.run_id, base_commit: git(repoRoot, ["rev-parse", "HEAD"]) }, null, 2),
        );
        const keeper = spawn(process.execPath, [process.argv[1]!, "run", "keepalive", result.run_id], { cwd: repoRoot, detached: true, windowsHide: true, stdio: "ignore" });
        keeper.on("error", () => undefined); keeper.unref();
        output({ claimed: key.toUpperCase(), run_id: result.run_id, lease_expires_at: result.lease_expires_at });
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("start <task-key>")
    .description("Start the claimed run (CLAIMED → IN_PROGRESS)")
    .action(async (key: string) => {
      try {
        const { projectId } = requireLink();
        await resolveTask(projectId, key);
        const runId = await currentRunId(key);
        await api("POST", `/api/v1/runs/${runId}/start`);
        output({ started: key.toUpperCase(), run_id: runId });
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("block <task-key>")
    .description("Block the task with a required reason (T127)")
    .requiredOption("--reason <reason>", "why the task is blocked")
    .action(async (key: string, opts: { reason: string }) => {
      try {
        const { projectId } = requireLink();
        await resolveTask(projectId, key);
        const runId = await currentRunId(key);
        await api("POST", `/api/v1/runs/${runId}/block`, {
          body: { reason_code: "AGENT_BLOCKED", message: opts.reason },
        });
        output({ blocked: key.toUpperCase() });
      } catch (e) {
        fail(e);
      }
    });

  task
    .command("submit <task-key>")
    .description("Submit the completed task for review (T128)")
    .requiredOption("--summary <summary>", "implementation summary")
    .option("--commit <sha>", "commit SHA (default: the current HEAD)")
    .action(async (key: string, opts: { summary: string; commit?: string }) => {
      try {
        const { projectId } = requireLink();
        const resolvedTask = await resolveTask(projectId, key);
        const runId = await currentRunId(key);
        const repoRoot = findRepoRoot()!;
        const link = readRepoLink(repoRoot);
        // Evidence the reviewer (or the AUTO_RUN policy) can check: which commit
        // and which files. The run's first commit is the baseline when known.
        const commit = opts.commit ?? git(repoRoot, ["rev-parse", "HEAD"]);
        const state = JSON.parse(readFileSync(`${repoRoot}/.sdd/run.json`, "utf8")) as { base_commit?: string | null };
        const detail = await api<{ task: { contract?: { ui_screen_keys?: string[]; verification?: { required?: Array<{ command: string }> } } } }>("GET", `/api/v1/tasks/${resolvedTask.id}`);
        const evidenceScreens = [...new Set([...(detail.task.contract?.ui_screen_keys ?? []), ...(detail.task.contract?.verification?.required ?? []).flatMap(r => [...r.command.matchAll(/e2e\/render\/([\w.-]+)\.spec\./g)].map(m => m[1]!))])];
        const collected = collectRunEvidence(repoRoot, state.base_commit ?? null, evidenceScreens);
        const files = collected.files_changed;
        const result = await api<{ auto_approved?: boolean; changes_requested?: boolean; auto_approve_withheld?: string; task?: { workflowStatus?: string } }>(
          "POST",
          `/api/v1/runs/${runId}/request-review`,
          {
            body: {
              summary: opts.summary,
              commit_sha: commit,
              files_changed: files,
              evidence: collected.evidence,
              ...(link?.machine_id ? { machine_id: link.machine_id } : {}),
            },
          },
        );
        output({
          submitted: key.toUpperCase(),
          review: result.auto_approved
            ? "approved by AI review with acceptance coverage and passing checks"
            : result.changes_requested
              ? result.task?.workflowStatus === "READY" ? "AI review requested corrections; task requeued — run sddctl task next" : "AI review requested corrections; inspect the review before continuing"
            : result.auto_approve_withheld
              ? `waiting for a reviewer: ${result.auto_approve_withheld}`
              : "waiting for a reviewer",
          status: result.task?.workflowStatus ?? "NEEDS_REVIEW",
          commit,
          files_changed: files.length,
        });
      } catch (e) {
        fail(e);
      }
    });
}

/**
 * The run recorded by `task claim` in .sdd/run.json. With `taskKey`, the file
 * must belong to that task: `task submit TASK-002` after claiming TASK-001
 * used to act on TASK-001's run without a word.
 */
export async function currentRunId(taskKey?: string): Promise<string> {
  const repoRoot = findRepoRoot();
  if (!repoRoot) throw new CliError("NO_REPO", "Not inside a git repository");
  const path = `${repoRoot}/.sdd/run.json`;
  if (!existsSync(path)) throw new CliError("NO_RUN", "No active run — claim and start the task first");
  const run = JSON.parse(readFileSync(path, "utf8")) as { run_id: string; task_key?: string };
  const mismatch = runTaskMismatch(run.task_key, taskKey);
  if (mismatch) throw new CliError("RUN_TASK_MISMATCH", mismatch);
  return run.run_id;
}
