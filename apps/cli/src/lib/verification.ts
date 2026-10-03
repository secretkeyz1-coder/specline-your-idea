import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

/** Windows .cmd wrappers cannot be spawned without a shell. Run their installed JS entry point with Node instead. */
export function verificationInvocation(argv: string[]): string[] {
  const command = argv[0]!;
  if (process.platform !== "win32" || !["npm", "npx", "pnpm", "yarn"].includes(command)) return argv;
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (!existsSync(join(dir, `${command}.cmd`))) continue;
    const entries = [`node_modules/npm/bin/${command}-cli.js`, `node_modules/${command}/bin/${command}.cjs`, `node_modules/${command}/bin/${command}.js`, `node_modules/corepack/dist/${command}.js`];
    for (const entry of entries) if (existsSync(join(dir, entry))) return [process.execPath, join(dir, entry), ...argv.slice(1)];
  }
  return argv;
}

export function stopVerification(child: ReturnType<typeof spawn>) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.on("error", () => child.kill());
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}
