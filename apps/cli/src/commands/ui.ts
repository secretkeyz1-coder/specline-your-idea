import { findRepoRoot } from "../lib/config.js";
import { CliError, fail, output } from "../lib/api.js";
import type { Command } from "commander";
import { requireLink } from "./task.js";
import { pullApprovedUi } from "../lib/ui.js";

/** sddctl ui pull: writes the approved UI reference and design system into the repository, inert (no script, no network). */

/* ── ui ── */

export function registerUi(program: Command): void {
  const ui = program.command("ui").description("UI reference (approved screen mockups) and design system");


  ui
    .command("pull")
    .description("Write the approved UI reference into docs/ui-reference/ and the design system into docs/design-system/")
    .action(async () => {
      try {
        const { projectId } = requireLink();
        const repoRoot = findRepoRoot()!;
        output(await pullApprovedUi(projectId, repoRoot));
      } catch (e) {
        // Sign-ins from before UI references existed lack read access to specs.
        if (e instanceof Error && e.message.includes("artifact:read")) {
          fail(new CliError("SIGN_IN_OUTDATED", "This CLI sign-in cannot read specs yet — run `sddctl login` again, then retry."));
        }
        fail(e);
      }
    });
}
