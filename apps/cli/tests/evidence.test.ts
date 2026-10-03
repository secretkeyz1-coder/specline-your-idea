import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { collectRunEvidence, git, runBaseline } from "../src/lib/evidence.js";
import { verificationInvocation } from "../src/lib/verification.js";

test("installed npm verification runs without a shell on Windows", () => {
  if (!Bun.which("npm")) return;
  const argv = verificationInvocation(["npm", "--version"]);
  expect(execFileSync(argv[0]!, argv.slice(1), { encoding: "utf8", windowsHide: true }).trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("Git evidence includes committed, working-tree and untracked changes, with bounded screenshots", () => {
  const repo = mkdtempSync(join(tmpdir(), "sdd-evidence-"));
  const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  try {
    run("init"); run("config", "user.email", "evidence@example.test"); run("config", "user.name", "Evidence Test");
    writeFileSync(join(repo, "stock.ts"), "export const quantity = 0;\n"); run("add", "."); run("commit", "-m", "baseline");
    const base = git(repo, ["rev-parse", "HEAD"]);
    const runId = crypto.randomUUID();
    expect(runBaseline(repo, runId)).toBe(base);
    writeFileSync(join(repo, "stock.ts"), "export const quantity = 1;\n"); run("add", "."); run("commit", "-m", "implementation");
    expect(runBaseline(repo, runId)).toBe(base);
    writeFileSync(join(repo, "stock.test.ts"), "test('quantity', () => {});\n");
    mkdirSync(join(repo, "docs/ui-reference/renders"), { recursive: true });
    const png = Buffer.alloc(130000); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
    writeFileSync(join(repo, "docs/ui-reference/renders/stock-1280.png"), png);
    const evidence = collectRunEvidence(repo, base);
    expect(evidence.files_changed).toContain("stock.ts"); expect(evidence.files_changed).toContain("stock.test.ts");
    expect(evidence.evidence.diff).toContain("quantity = 1"); expect(evidence.evidence.diff).toContain("test('quantity'");
    expect(evidence.evidence.diff_truncated).toBe(false); expect(evidence.evidence.artifacts[0]?.image).toStartWith("data:image/png;base64,");
    for (let i = 0; i < 45; i++) writeFileSync(join(repo, `docs/ui-reference/renders/aaa-${i}.png`), png);
    const focused = collectRunEvidence(repo, base, ["stock"]);
    expect(focused.evidence.artifacts.map(a => a.path)).toEqual(["docs/ui-reference/renders/stock-1280.png"]);
    writeFileSync(join(repo, ".env"), "SECRET=value");
    expect(() => collectRunEvidence(repo, base)).toThrow("credentials");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
