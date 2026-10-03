import { execFileSync } from "node:child_process";
import { clearToken, findRepoRoot, machineName, readConfig, readRepoLink, writeConfig } from "../lib/config.js";
import { api, CliError, fail, output } from "../lib/api.js";
import type { Command } from "commander";

/** sddctl login / logout / whoami / status: device-flow sign-in and the saved identity. */

/* ── auth ── */

/** Device flow (RFC 8628): returns a fresh access token for `server`. Does not save it. */
export async function deviceLogin(server: string): Promise<string> {
  // token: null — a stale saved token must never ride along to the login endpoints.
  const start = await api<{ device_code: string; user_code: string; verification_url: string; interval: number }>(
    "POST",
    "/api/v1/auth/cli/start",
    { body: { client_name: "sddctl" }, baseUrl: server, token: null },
  );
  console.log(`Open this URL in your browser:\n  ${start.verification_url}\n\nCode: ${start.user_code}\n\nWaiting for authorization...`);
  const interval = (start.interval ?? 5) * 1000;
  let pollInterval = interval;
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));
    let result: { status: string; access_token?: string };
    try {
      result = await api<{ status: string; access_token?: string }>("POST", "/api/v1/auth/cli/exchange", {
        body: { device_code: start.device_code },
        baseUrl: server,
        token: null,
      });
    } catch (e) {
      // RFC 8628 §3.5: a rate-limited poll must back off and retry, never
      // abort — approvals routinely take longer than the burst window.
      if (e instanceof CliError && (e.code === "RATE_LIMITED" || e.httpStatus === 429)) {
        pollInterval = Math.min(pollInterval + 5000, 30_000);
        continue;
      }
      throw e;
    }
    pollInterval = interval;
    if (result.status === "AUTHORIZED" && result.access_token) return result.access_token;
    if (result.status === "EXPIRED" || result.status === "DENIED") {
      throw new CliError("AUTH_" + result.status, `Authorization ${result.status.toLowerCase()}`);
    }
  }
  throw new CliError("AUTH_TIMEOUT", "Timed out waiting for authorization");
}

/** `--server` falls back to the configured server, read when the command runs
 * (not when options are defined — that read the config file on every command). */
export function serverOption(opts: { server?: string }): string {
  return (opts.server ?? readConfig().server_url).replace(/\/+$/, "");
}

export function registerAuth(program: Command): void {
  program
    .command("login")
    .description("Authenticate via the browser/device flow")
    .option("--server <url>", "control plane URL (default: the configured server)")
    .action(async (opts: { server?: string }) => {
      try {
        const server = serverOption(opts);
        const token = await deviceLogin(server);
        writeConfig({ server_url: server, token, profile: "default" });
        const me = await api<{ user: { email: string } }>("GET", "/api/v1/auth/me");
        console.log(`✓ Logged in as ${me.user.email}`);
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("logout")
    .description("Revoke this CLI token on the server and clear stored credentials")
    .action(async () => {
      const config = readConfig();
      if (config.token) {
        // Server-side revocation first: deleting only the local copy would leave
        // a valid 30/90-day credential behind (e.g. in backups or shell history).
        try {
          const me = await api<{ user: { token_id?: string | null } }>("GET", "/api/v1/auth/me");
          if (me.user.token_id) await api("POST", `/api/v1/auth/tokens/${me.user.token_id}/revoke`, { body: {} });
        } catch (e) {
          console.warn(`Warning: could not revoke the token on the server (${e instanceof Error ? e.message : String(e)}); clearing it locally.`);
        }
      }
      clearToken();
      console.log("Logged out.");
    });

  program
    .command("whoami")
    .description("Show the authenticated account and server (T120)")
    .action(async () => {
      try {
        const config = readConfig();
        const me = await api<{ user: { email: string; display_name: string }; workspaces: Array<{ name: string; role: string }> }>("GET", "/api/v1/auth/me");
        output({ server: config.server_url, user: me.user.email, display_name: me.user.display_name, workspaces: me.workspaces });
      } catch (e) {
        fail(e);
      }
    });

  program
    .command("status")
    .description("Show machine, repository binding and execution summary (connection manager)")
    .action(async () => {
      try {
        const config = readConfig();
        const repoRoot = findRepoRoot();
        const link = repoRoot ? readRepoLink(repoRoot) : null;
        const me = config.token
          ? await api<{ user: { email: string; display_name: string }; workspaces: Array<{ id: string; name: string; role: string }> }>("GET", "/api/v1/auth/me").catch(() => null)
          : null;

        let machine: Record<string, unknown> | null = null;
        try {
          const machines = await api<{ machines: Array<Record<string, unknown>> }>("GET", "/api/v1/agents/machines");
          machine = machines.machines.find((m) => m.name === machineName()) ?? null;
        } catch {
          /* fleet view is best-effort */
        }

        let branch: string | null = null;
        if (repoRoot) {
          try {
            branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
          } catch {
            branch = null;
          }
        }

        let execution: Record<string, unknown> | null = null;
        if (link) {
          try {
            const s = await api<{ summary: Record<string, unknown>; next: { key: string; title: string } | null }>(
              "GET",
              `/api/v1/projects/${link.project_id}/scheduler/summary`,
            );
            execution = { ...s.summary, next: s.next ? `${s.next.key} — ${s.next.title}` : null };
          } catch {
            /* scheduler summary is best-effort */
          }
        }

        output({
          server: config.server_url,
          user: me?.user.email ?? null,
          machine: machine ? { name: machineName(), status: machine.status, platform: machine.platform, last_seen: machine.lastSeenAt } : null,
          repository: link ? { path: repoRoot, project_id: link.project_id, project_key: link.project_key } : null,
          branch: branch ? branch.trim() : null,
          execution,
        });
      } catch (e) {
        fail(e);
      }
    });
}
