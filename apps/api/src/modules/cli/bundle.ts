import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sddctl the control plane hands out (GET /api/v1/cli/sddctl.mjs): the
 * CLI bundled into one file that runs on Node 18+ or Bun. Served by the same
 * server it talks to, so a coding agent can install it on its own — the
 * execution prompt used to stop and ask the user to `bun link` it from a
 * checkout of this repository, which nobody using the web app has.
 *
 * A production image ships it prebuilt next to the API bundle
 * (dist/cli/sddctl.mjs + sddctl.json, written by scripts/build-cli.ts during
 * `bun run build`); a dev server builds it once from apps/cli on first use.
 */
export interface CliBundle {
  code: string;
  version: string;
  sha256: string;
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The bundle's first line runs it with Node; the source's own `#!/usr/bin/env bun` is dropped. */
export function withNodeShebang(code: string): string {
  return `#!/usr/bin/env node\n${code.replace(/^#![^\n]*\n/, "")}`;
}

/** Bundle apps/cli (its dependencies included) into one Node-compatible ES module. */
export async function buildCli(cliRoot: string): Promise<CliBundle> {
  const out = await Bun.build({ entrypoints: [join(cliRoot, "src", "index.ts")], target: "node", format: "esm" });
  if (!out.success || !out.outputs[0]) throw new Error(`sddctl bundle failed: ${out.logs.map(String).join("\n")}`);
  const code = withNodeShebang(await out.outputs[0].text());
  const version = (JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  return { code, version, sha256: sha256(code) };
}

/** Where a production build leaves the bundle: beside the API bundle (dist/index.js → dist/cli/). */
export const PREBUILT_DIR = join(import.meta.dir, "cli");
/** The CLI source, reachable from this file in a checkout (apps/api/src/modules/cli → apps/cli). */
const SOURCE_ROOT = join(import.meta.dir, "..", "..", "..", "..", "cli");

let cached: Promise<CliBundle | null> | null = null;

async function load(): Promise<CliBundle | null> {
  const prebuilt = join(PREBUILT_DIR, "sddctl.mjs");
  if (existsSync(prebuilt)) {
    const code = readFileSync(prebuilt, "utf8");
    const meta = JSON.parse(readFileSync(join(PREBUILT_DIR, "sddctl.json"), "utf8")) as { version?: string };
    return { code, version: meta.version ?? "0.0.0", sha256: sha256(code) };
  }
  if (existsSync(join(SOURCE_ROOT, "src", "index.ts"))) return buildCli(SOURCE_ROOT);
  return null;
}

/** The bundle to serve, or null when this server has neither a prebuilt one nor the source to build it. */
export async function cliBundle(): Promise<CliBundle | null> {
  cached ??= load();
  const bundle = await cached.catch(() => null);
  // A failed build is tried again on the next request instead of being remembered.
  if (!bundle) cached = null;
  return bundle;
}
