import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCli, withNodeShebang, type CliBundle } from "../src/modules/cli/bundle.js";
import { installCommands, installPs1, installSh } from "../src/modules/cli/installers.js";

const CLI_ROOT = join(import.meta.dir, "..", "..", "cli");
const has = (cmd: string) => Bun.which(cmd) !== null;
/** Run a command without blocking the event loop (the test server answers the installer's download). */
async function run(cmd: string[], env: Record<string, string | undefined> = process.env) {
  const proc = Bun.spawn(cmd, { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("sddctl is served by the control plane", () => {
  let bundle: CliBundle;
  beforeAll(async () => {
    bundle = await buildCli(CLI_ROOT);
  }, 60_000);

  test("the bundle is one Node-runnable file whose version is the CLI package's", () => {
    expect(bundle.code.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(bundle.code).not.toContain("#!/usr/bin/env bun");
    expect(bundle.code).not.toContain("Bun.spawn");
    const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8")) as { version: string };
    expect(bundle.version).toBe(pkg.version);
    // `sddctl --version` prints the program's version: it must be the one the server advertises.
    expect(readFileSync(join(CLI_ROOT, "src", "commands", "program.ts"), "utf8")).toContain(`.version("${pkg.version}")`);
    expect(bundle.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a source shebang is replaced, not stacked", () => {
    expect(withNodeShebang("#!/usr/bin/env bun\nconsole.log(1);")).toBe("#!/usr/bin/env node\nconsole.log(1);");
    expect(withNodeShebang("console.log(1);")).toBe("#!/usr/bin/env node\nconsole.log(1);");
  });

  test.if(has("node"))("the bundle runs under Node", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sddctl-node-"));
    try {
      const file = join(dir, "sddctl.mjs");
      await Bun.write(file, bundle.code);
      const out = await run(["node", file, "--version"]);
      expect(out.exitCode).toBe(0);
      expect(out.stdout.trim()).toBe(bundle.version);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test("the installers check the runtime and the checksum, and say where sddctl went", () => {
    const sh = installSh("https://sdd.example.com/", bundle);
    expect(sh.startsWith("#!/bin/sh\n")).toBe(true);
    expect(sh).toContain("SERVER='https://sdd.example.com'");
    expect(sh).toContain(`SHA256='${bundle.sha256}'`);
    expect(sh).toContain(">= 18");
    expect(sh).toContain("does not match its checksum");
    expect(sh).toContain("is not on PATH");
    const ps1 = installPs1("https://sdd.example.com", bundle);
    expect(ps1).toContain("$Server = 'https://sdd.example.com'");
    expect(ps1).toContain("Get-FileHash -Algorithm SHA256");
    expect(ps1).toContain("sddctl.cmd");
    expect(ps1).toContain("\r\n");
    // A quote in the URL cannot break out of the script's string.
    expect(installSh("https://x.example/a'b", bundle)).toContain("SERVER='https://x.example/a%27b'");
    expect(installCommands("https://sdd.example.com/")).toEqual({
      sh: "curl -fsSL https://sdd.example.com/api/v1/cli/install.sh | sh",
      ps1: "irm https://sdd.example.com/api/v1/cli/install.ps1 | iex",
    });
  });
});

/** The whole path an agent takes: fetch install.sh from a server, run it, run the installed sddctl. */
describe.if(has("sh") && has("curl") && has("node"))("install.sh end to end", () => {
  let server: ReturnType<typeof Bun.serve>;
  let home: string;
  let bundle: CliBundle;
  beforeAll(async () => {
    bundle = await buildCli(CLI_ROOT);
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/api/v1/cli/sddctl.mjs") return new Response(bundle.code);
        if (path === "/api/v1/cli/install.sh") return new Response(installSh(`http://localhost:${server.port}`, bundle));
        return new Response("not found", { status: 404 });
      },
    });
    home = mkdtempSync(join(tmpdir(), "sddctl-home-"));
  }, 60_000);
  afterAll(() => {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  });

  test("installs into SDD_HOME and the shim runs", async () => {
    const script = await (await fetch(`http://localhost:${server.port}/api/v1/cli/install.sh`)).text();
    const scriptFile = join(home, "install.sh");
    await Bun.write(scriptFile, script);
    const sdd = join(home, "sdd");
    const install = await run(["sh", scriptFile], { ...process.env, SDD_HOME: sdd, HOME: home });
    expect(install.stderr).toBe("");
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain(`Installed sddctl ${bundle.version}`);
    const shim = await run(["sh", join(sdd, "bin", "sddctl"), "--version"]);
    expect(shim.exitCode).toBe(0);
    expect(shim.stdout.trim()).toBe(bundle.version);
  }, 60_000);

  test("a user bin on PATH gets the shim, but another sddctl there is never replaced", async () => {
    const script = installSh(`http://localhost:${server.port}`, bundle);
    const sep = process.platform === "win32" ? ";" : ":";
    // An empty ~/.local/bin on PATH: the shim goes there, so `sddctl` works in every new command.
    const fresh = mkdtempSync(join(tmpdir(), "sddctl-fresh-"));
    const freshBin = join(fresh, ".local", "bin");
    mkdirSync(freshBin, { recursive: true });
    const a = await run(["sh", "-c", script], { ...process.env, HOME: fresh, SDD_HOME: join(fresh, "sdd"), PATH: `${freshBin}${sep}${process.env.PATH}` });
    expect(a.exitCode).toBe(0);
    expect(readFileSync(join(freshBin, "sddctl"), "utf8")).toContain("sddctl.mjs");
    // A ~/.local/bin that already holds someone else's sddctl (say, a `bun link` from source): left alone.
    const taken = mkdtempSync(join(tmpdir(), "sddctl-taken-"));
    const takenBin = join(taken, ".local", "bin");
    mkdirSync(takenBin, { recursive: true });
    const foreign = "#!/bin/sh\necho mine\n";
    writeFileSync(join(takenBin, "sddctl"), foreign);
    const b = await run(["sh", "-c", script], { ...process.env, HOME: taken, SDD_HOME: join(taken, "sdd"), PATH: `${takenBin}${sep}${process.env.PATH}` });
    expect(b.exitCode).toBe(0);
    expect(readFileSync(join(takenBin, "sddctl"), "utf8")).toBe(foreign);
    expect(b.stdout).toContain("is not on PATH");
    rmSync(fresh, { recursive: true, force: true });
    rmSync(taken, { recursive: true, force: true });
  }, 60_000);

  test("a tampered download is refused and nothing is installed", async () => {
    const sdd = join(home, "tampered");
    const script = installSh(`http://localhost:${server.port}`, { ...bundle, sha256: "0".repeat(64) });
    const install = await run(["sh", "-c", script], { ...process.env, SDD_HOME: sdd, HOME: home });
    expect(install.exitCode).not.toBe(0);
    expect(install.stderr).toContain("does not match its checksum");
    expect(await Bun.file(join(sdd, "bin", "sddctl.mjs")).exists()).toBe(false);
  }, 60_000);
});

/** The PowerShell installer, where there is PowerShell; SDD_NO_PATH keeps the user's real PATH untouched. */
const pwsh = has("pwsh") ? "pwsh" : has("powershell") ? "powershell" : null;
describe.if(pwsh !== null && has("node") && process.platform === "win32")("install.ps1 end to end", () => {
  test("installs sddctl.cmd and the Git Bash shim, and both run", async () => {
    const bundle = await buildCli(CLI_ROOT);
    const server = Bun.serve({ port: 0, fetch: () => new Response(bundle.code) });
    const home = mkdtempSync(join(tmpdir(), "sddctl-ps-"));
    try {
      const scriptFile = join(home, "install.ps1");
      await Bun.write(scriptFile, installPs1(`http://localhost:${server.port}`, bundle));
      const sdd = join(home, "sdd");
      const install = await run([pwsh!, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptFile], { ...process.env, SDD_HOME: sdd, SDD_NO_PATH: "1" });
      expect(install.stderr).toBe("");
      expect(install.exitCode).toBe(0);
      expect(install.stdout).toContain(`Installed sddctl ${bundle.version}`);
      const viaCmd = await run(["cmd", "/c", join(sdd, "bin", "sddctl.cmd"), "--version"]);
      expect(viaCmd.stdout.trim()).toBe(bundle.version);
      if (has("sh")) expect((await run(["sh", join(sdd, "bin", "sddctl"), "--version"])).stdout.trim()).toBe(bundle.version);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  }, 90_000);
});
