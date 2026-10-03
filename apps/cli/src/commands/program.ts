import { Command } from "commander";
import { setJsonMode } from "../lib/api.js";

/** The sddctl command tree every commands/* file adds its commands to; --json switches output to machine-readable JSON. */

export const program = new Command();
program.name("sddctl").description("Agentic SDD Control Plane CLI").version("0.1.0");
program.option("--json", "machine-readable JSON output", false);
program.hook("preAction", () => {
  setJsonMode(program.opts().json === true);
});
