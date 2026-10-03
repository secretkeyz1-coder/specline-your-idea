import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { RunEvidence } from "@sdd/contracts";

export function git(repo: string, args: string[]): string | null {
  try { return execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim() || null; }
  catch { return null; }
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const sensitive = /(^|\/)(\.env(?:\..*)?|[^/]*\.(pem|key|p12)|credentials[^/]*|secrets?[^/]*)$/i;

/** Resuming the same daemon run must retain the commit from before its first edits. */
export function runBaseline(repo: string, runId: string): string | null {
  if (!/^[a-f0-9-]{36}$/i.test(runId)) throw new Error("Invalid evidence run ID");
  const dir = join(repo, ".sdd/run-evidence");
  const file = join(dir, `${runId}.json`);
  if (existsSync(file)) {
    const value = JSON.parse(readFileSync(file, "utf8")) as { base_commit: string | null };
    if (value.base_commit !== null && !/^[a-f0-9]{40,64}$/i.test(value.base_commit)) throw new Error("Invalid saved Git baseline");
    return value.base_commit;
  }
  const baseline = git(repo, ["rev-parse", "HEAD"]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ base_commit: baseline }), "utf8");
  return baseline;
}

/** The same bounded Git evidence for CLI and daemon. No repository content is uploaded except changed files and render reports. */
export function collectRunEvidence(repo: string, baseCommit: string | null, screenKeys: string[] = []) {
  const head = git(repo, ["rev-parse", "HEAD"]);
  const names = git(repo, ["diff", "--name-only", "--no-renames", baseCommit ?? EMPTY_TREE]) ?? "";
  const untracked = git(repo, ["ls-files", "--others", "--exclude-standard"]) ?? "";
  const files = [...new Set([...names.split("\n"), ...untracked.split("\n")])].filter(p => p && !p.startsWith(".sdd/"));
  if (files.some(p => sensitive.test(p))) throw new Error("Evidence contains a credentials file. Remove it from the task changes before submission.");
  let diff = "", truncated = false;
  // ponytail: bounded text patch, human review required for binary or >120k changes; use an artifact store for larger reviews.
  for (const file of files) {
    if (diff.length >= 120000) { truncated = true; break; }
    const patch = git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", baseCommit ?? EMPTY_TREE, "--", file]);
    if (patch) { diff += patch + "\n"; if (/^Binary files /m.test(patch) && !/^docs\/ui-reference\/renders\/[\w.-]+\.png$/.test(file)) truncated = true; }
    else if (untracked.split("\n").includes(file)) {
      const path = join(repo, file);
      if (lstatSync(path).isSymbolicLink()) { truncated = true; continue; }
      if (/^docs\/ui-reference\/renders\/[\w.-]+\.png$/.test(file)) continue;
      if (statSync(path).size > 120000) { truncated = true; continue; }
      const content = readFileSync(path);
      if (content.includes(0)) { if (!/^docs\/ui-reference\/renders\/[\w.-]+\.png$/.test(file)) truncated = true; continue; }
      diff += `diff --git a/${file} b/${file}\nnew file\n${content.toString("utf8").split("\n").map(l => "+" + l).join("\n")}\n`;
    } else if (!patch) truncated = true;
  }
  const artifacts: RunEvidence["artifacts"] = [];
  const dir = join(repo, "docs/ui-reference/renders");
  if (existsSync(dir)) for (const name of readdirSync(dir).filter(name => !screenKeys.length || screenKeys.some(key => name.startsWith(`${key}-`))).sort()) {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) continue;
    if (!statSync(path).isFile() || artifacts.length >= 40) continue;
    if (statSync(path).size > 500000) continue;
    const bytes = readFileSync(path);
    artifacts.push({ path: relative(repo, path).replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex"), ...(/\.(json|txt|md)$/.test(name) ? { content: bytes.toString("utf8").slice(0, 16000) } : {}), ...(/\.png$/.test(name) ? { image: `data:image/png;base64,${bytes.toString("base64")}` } : {}) });
  }
  return { commit_sha: head, files_changed: files.slice(0, 200), evidence: { base_commit: baseCommit, diff: diff.slice(0, 120000), diff_truncated: truncated || diff.length > 120000 || files.length > 200, artifacts } satisfies RunEvidence };
}
