import { createHash } from "node:crypto";
import { renameSync, writeFileSync } from "node:fs";
import { CliError, fail, output } from "../lib/api.js";
import { serverOption } from "./auth.js";
import { program } from "./program.js";

/**
 * sddctl update: replace this installed sddctl with the one the control plane
 * serves (GET /api/v1/cli/sddctl.mjs), so the CLI always matches the API it
 * talks to. Only an installed copy (the bundled .mjs) can update itself; a
 * checkout running from source is updated with git.
 */
program
  .command("update")
  .description("Update sddctl to the version the control plane serves")
  .option("--server <url>", "Control plane URL (default: the one you signed in to)")
  .action(async (opts: { server?: string }) => {
    try {
      const self = process.argv[1] ?? "";
      if (!self.endsWith(".mjs")) {
        throw new CliError("NOT_INSTALLED", "This sddctl runs from source — update it with git, or install it with the control plane's installer.");
      }
      const server = serverOption(opts);
      const res = await fetch(`${server}/api/v1/cli/sddctl.mjs`);
      if (!res.ok) throw new CliError("DOWNLOAD_FAILED", `The control plane answered ${res.status} for the CLI download.`, res.status);
      const body = Buffer.from(await res.arrayBuffer());
      const expected = res.headers.get("x-sddctl-sha256");
      if (expected && createHash("sha256").update(body).digest("hex") !== expected) {
        throw new CliError("CHECKSUM_MISMATCH", "The downloaded CLI does not match its checksum; nothing was changed.");
      }
      // Write beside it, then swap: a failed download never leaves a broken CLI.
      writeFileSync(`${self}.tmp`, body);
      renameSync(`${self}.tmp`, self);
      output({ updated: true, version: res.headers.get("x-sddctl-version") ?? "unknown", path: self });
    } catch (e) {
      fail(e);
    }
  });
