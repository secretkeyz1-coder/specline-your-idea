#!/usr/bin/env bun
/**
 * sddctl — connected CLI bridge (Phase 11, T118–T129, docs/10 §4).
 * Exit codes: 0 ok, 1 failure (FR-097). `--json` gives machine-readable output (FR-096).
 *
 * Command modules are inert on import (including helper imports between
 * groups). This entrypoint registers each group once, in help display order.
 */
import { program } from "./commands/program.js";
import { registerAuth } from "./commands/auth.js";
import { registerProject } from "./commands/project.js";
import { registerTask } from "./commands/task.js";
import { registerUi } from "./commands/ui.js";
import { registerRun } from "./commands/run.js";
import { registerMcp } from "./commands/mcp.js";
import { registerBug } from "./commands/bug.js";
import { registerUpdate } from "./commands/update.js";
import { fail } from "./lib/api.js";

registerAuth(program);
registerProject(program);
registerTask(program);
registerUi(program);
registerRun(program);
registerMcp(program);
registerBug(program);
registerUpdate(program);

program.parseAsync(process.argv).catch((e) => fail(e));
