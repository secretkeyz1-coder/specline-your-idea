#!/usr/bin/env bun
import { Command } from "commander";
import { DaemonConnection } from "./connection.js";
import { readConfig } from "@sdd/cli/lib/config";
import { setServerOverride } from "@sdd/cli/lib/api";
import { detectCapabilities } from "./adapters.js";
import { detectAllClis } from "@sdd/agent-cli";

/**
 * sdd-agent — optional outbound daemon (Phase 17 / MVP.2, T183-side local half).
 * `connect` dials the control plane over WSS and waits for approved dispatches.
 * No inbound port is ever opened (C11, docs/13 §7).
 */

const program = new Command();
program.name("sdd-agent").description("Local agent daemon for the Agentic SDD Control Plane").version("0.1.0");

program
  .command("connect")
  .description("Connect to the control plane and wait for approved task dispatches")
  .option("--server <url>", "control plane URL (defaults to sddctl config)")
  .action(async (opts: { server?: string }) => {
    const config = readConfig();
    if (!config.token) {
      console.error("Not authenticated — run `sddctl login` first.");
      process.exit(1);
    }
    const server = (opts.server ?? config.server_url).replace(/\/+$/, "");
    // The saved token belongs to the server it was issued by; never hand it to another one.
    if (server.toLowerCase() !== config.server_url.replace(/\/+$/, "").toLowerCase()) {
      console.error(`The saved login is for ${config.server_url}. Run \`sddctl login --server ${server}\` first, then connect again.`);
      process.exit(1);
    }
    // REST calls (register, claim, heartbeat…) must hit the same server as the WebSocket.
    setServerOverride(server);
    const caps = await detectCapabilities();
    console.log(`sdd-agent connecting to ${server}`);
    console.log(`detected agents: ${caps.agents.join(", ") || "(generic shell only)"}`);
    const connection = new DaemonConnection(server);
    process.on("SIGINT", () => {
      console.log("\nshutting down...");
      connection.stop();
      process.exit(0);
    });
    await connection.run();
  });

program
  .command("status")
  .description("Show daemon configuration and detected agents")
  .action(async () => {
    const config = readConfig();
    const caps = await detectCapabilities();
    const ai = await detectAllClis();
    console.log(
      JSON.stringify(
        {
          server: config.server_url,
          authenticated: Boolean(config.token),
          agents: caps.agents,
          ai_cli: ai.map((c) => ({ cli: c.id, installed: c.installed, version: c.version, signed_in: c.auth })),
          os: caps.os,
        },
        null,
        2,
      ),
    );
  });

program
  .command("service")
  .description("Print service-install instructions for this platform")
  .action(() => {
    console.log(
      [
        "Run sdd-agent as a service:",
        "",
        "  systemd (Linux):",
        "    create ~/.config/systemd/user/sdd-agent.service with:",
        "      [Service]",
        "      ExecStart=" + process.execPath + " " + import.meta.path + " connect",
        "      Restart=always",
        "    then: systemctl --user enable --now sdd-agent",
        "",
        "  launchd (macOS) / Task Scheduler (Windows):",
        "    run the same command at login: sdd-agent connect",
        "",
        "The daemon only makes OUTBOUND connections; no inbound port is opened.",
      ].join("\n"),
    );
  });

program.parseAsync(process.argv);
