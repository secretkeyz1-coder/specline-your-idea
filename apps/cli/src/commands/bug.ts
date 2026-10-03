import { api, fail, output } from "../lib/api.js";
import { program } from "./program.js";
import { requireLink } from "./task.js";

/** sddctl bug report. */

/* ── bug ── */

program
  .command("bug")
  .description("Bug reporting group")
  .command("report")
  .description("Report a bug from the linked repository")
  .requiredOption("--title <title>", "bug title")
  .requiredOption("--expected <text>", "expected behavior")
  .requiredOption("--current <text>", "current behavior")
  .requiredOption("--repro <text>", "reproduction steps")
  .action(async (opts: { title: string; expected: string; current: string; repro: string }) => {
    try {
      const { projectId } = requireLink();
      const { bug } = await api<{ bug: { key: string; id: string } }>("POST", `/api/v1/projects/${projectId}/bugs`, {
        body: {
          title: opts.title,
          expected_behavior: opts.expected,
          current_behavior: opts.current,
          reproduction: opts.repro,
        },
      });
      output({ reported: bug.key, id: bug.id });
    } catch (e) {
      fail(e);
    }
  });
