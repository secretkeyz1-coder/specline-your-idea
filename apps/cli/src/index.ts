#!/usr/bin/env bun
/**
 * sddctl — connected CLI bridge (Phase 11, T118–T129, docs/10 §4).
 * Exit codes: 0 ok, 1 failure (FR-097). `--json` gives machine-readable output (FR-096).
 *
 * Each commands/* file adds its command group to the shared program when it
 * is imported; the order below is the order `sddctl --help` lists them in.
 */
import { program } from "./commands/program.js";
import "./commands/auth.js";
import "./commands/project.js";
import "./commands/task.js";
import "./commands/ui.js";
import "./commands/run.js";
import "./commands/mcp.js";
import "./commands/bug.js";
import "./commands/update.js";
import { fail } from "./lib/api.js";

program.parseAsync(process.argv).catch((e) => fail(e));
