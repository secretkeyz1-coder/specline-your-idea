import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dockerfile = (name: string) => readFileSync(join(import.meta.dir, `${name}.Dockerfile`), "utf8");

// Check the transitive workspace closure before the first frozen install, not
// just a hard-coded package list: adding a workspace dependency must fail here.
test("API install stage copies every transitive workspace manifest", () => {
  const install = dockerfile("api").split("RUN bun install")[0]!;
  const queue = ["apps/api", "apps/cli"];
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    expect(install).toContain(`COPY ${path}/package.json ${path}/`);
    const manifest = JSON.parse(readFileSync(join(root, path, "package.json"), "utf8"));
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (String(version).startsWith("workspace:")) queue.push(`packages/${name.replace("@sdd/", "")}`);
    }
  }
  expect(seen.has("packages/agent-cli")).toBe(true);
});

test("web flattened runtime dependency copy requires an explicitly hoisted install", () => {
  const source = dockerfile("web");
  expect(source).toMatch(/RUN bun install --frozen-lockfile --linker=hoisted/);
  expect(source).toContain("COPY --from=build /app/node_modules ./node_modules");
  expect(source).toContain("COPY --from=build /app/apps/web/build ./build");
});

// Explicit opt-in: requires a preceding web build and downloads dependencies
// into a disposable directory, never changing the checkout's install layout.
const runtimeTest = process.env.SDD_TEST_WEB_RUNTIME === "1" ? test : test.skip;
runtimeTest("web adapter starts after Docker-style relocation with hoisted dependencies", async () => {
  expect(existsSync(join(root, "apps/web/build/index.js"))).toBe(true);
  const stage = mkdtempSync(join(tmpdir(), "sdd-web-stage-"));
  const runtime = mkdtempSync(join(tmpdir(), "sdd-web-runtime-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    for (const path of ["package.json", "bun.lock", "packages/config/package.json", "packages/shared/package.json", "packages/contracts/package.json", "apps/web/package.json"]) {
      mkdirSync(join(stage, path, ".."), { recursive: true });
      cpSync(join(root, path), join(stage, path));
    }
    const install = spawnSync(process.execPath, ["install", "--frozen-lockfile", "--linker=hoisted"], { cwd: stage, encoding: "utf8", timeout: 120_000 });
    expect(install.status).toBe(0);
    // Dereference workspace links for Windows without symlink privileges;
    // only manifest stubs exist here, so runtime cannot rely on workspace source.
    cpSync(join(stage, "node_modules"), join(runtime, "node_modules"), { recursive: true, dereference: true });
    cpSync(join(root, "apps/web/build"), join(runtime, "build"), { recursive: true });
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(port));
      });
    });
    let log = "";
    child = spawn(process.execPath, ["build/index.js"], { cwd: runtime, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), ORIGIN: `http://127.0.0.1:${port}` }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout!.on("data", chunk => { log += chunk; });
    child.stderr!.on("data", chunk => { log += chunk; });
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { healthy = true; break; }
      } catch { /* startup still pending */ }
      await Bun.sleep(100);
    }
    expect({ healthy, log }).toMatchObject({ healthy: true });
  } finally {
    if (child && child.exitCode === null) {
      const stopped = new Promise<void>(resolve => child!.once("close", () => resolve()));
      child.kill();
      await stopped;
    }
    rmSync(runtime, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
  }
}, 180_000);
