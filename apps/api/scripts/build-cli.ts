/**
 * Production build step: bundle sddctl next to the API bundle (dist/cli/),
 * where GET /api/v1/cli/sddctl.mjs serves it from. The production image has
 * no apps/cli source at runtime, so the bundle must exist before it ships.
 *
 *   bun scripts/build-cli.ts            (run from apps/api, after the API build)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCli } from "../src/modules/cli/bundle.js";

const outDir = join(import.meta.dir, "..", "dist", "cli");
const bundle = await buildCli(join(import.meta.dir, "..", "..", "cli"));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "sddctl.mjs"), bundle.code);
writeFileSync(join(outDir, "sddctl.json"), JSON.stringify({ version: bundle.version, sha256: bundle.sha256 }, null, 2));
console.log(`sddctl ${bundle.version} → ${join(outDir, "sddctl.mjs")} (${(bundle.code.length / 1024).toFixed(0)} KB, sha256 ${bundle.sha256.slice(0, 12)}…)`);
