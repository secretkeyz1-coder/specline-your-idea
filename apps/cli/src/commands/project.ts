import { basename } from "node:path";
import { findRepoRoot, machineFingerprint, machineName, readConfig, readRepoLink, writeConfig, writeRepoLink } from "../lib/config.js";
import { api, CliError, fail, output, printTable } from "../lib/api.js";
import { deviceLogin, serverOption } from "./auth.js";
import type { Command } from "commander";
import { rmSync } from "node:fs";

/** sddctl project … and sddctl connect: linking a repository to a project, pairing codes, self-connect. */

/* ── project ── */

/** A saved login that still works on `server`, or null (none, other server, expired/revoked). */
async function usableSavedToken(server: string): Promise<string | null> {
  const config = readConfig();
  if (!config.token || config.server_url.replace(/\/+$/, "").toLowerCase() !== server.toLowerCase()) return null;
  try {
    await api("GET", "/api/v1/auth/me", { baseUrl: server, token: config.token });
    return config.token;
  } catch (e) {
    if (e instanceof CliError && e.httpStatus === 401) return null;
    throw e;
  }
}

/** Best-effort server-side revocation of a token this command no longer needs. */
async function revokeToken(server: string, token: string): Promise<void> {
  try {
    const me = await api<{ user: { token_id?: string | null } }>("GET", "/api/v1/auth/me", { baseUrl: server, token });
    if (me.user.token_id) await api("POST", `/api/v1/auth/tokens/${me.user.token_id}/revoke`, { baseUrl: server, token, body: {} });
  } catch {
    /* it expires on its own */
  }
}

/** The code's unsigned payload — read only to decide what to do locally; the server verifies it. */
function peekPairingCode(code: string): { p?: string; s?: number } | null {
  const [tag, body] = code.trim().split(".");
  if (tag !== "SDDP1" || !body) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p?: string; s?: number };
  } catch {
    return null;
  }
}

async function connectWithPairingCode(code: string, opts: { server?: string; mode?: string }): Promise<void> {
    try {
      const server = serverOption(opts);
      const repoRoot = findRepoRoot();
      if (!repoRoot) throw new CliError("NO_REPO", "Run this command inside your project repository (a .git folder)");
      // The pairing code (created in the web app) fixes the maximum autonomy;
      // --mode can only ask for something MORE restrictive.
      const requested = opts.mode?.toUpperCase();
      if (requested && !(["MANUAL", "ASSISTED", "AUTO_RUN"] as const).includes(requested as never)) {
        throw new CliError("BAD_MODE", "--mode must be MANUAL, ASSISTED or AUTO_RUN");
      }
      // The code names the project; the machine is paired to WHOEVER runs this
      // command, so sign in first (device flow) when there is no usable login.
      // A self-connect code (from a copied execution prompt) is itself the
      // sign-in of the person who copied it: no login needed.
      const peeked = peekPairingCode(code);
      const selfConnect = peeked?.s === 1;
      let identity: string | null = selfConnect ? null : await usableSavedToken(server);
      let temporaryLogin = !selfConnect && !identity;
      if (!selfConnect && !identity) {
        console.log(`Sign in to ${server} to pair this machine as yourself.`);
        identity = await deviceLogin(server);
      }
      console.log(`Pairing with control plane (${server})…`);
      type ClaimResult = {
        user: { email: string };
        token: string;
        machine_id: string;
        machine_name: string;
        repository_link_id: string;
        permission_mode: "MANUAL" | "ASSISTED" | "AUTO_RUN";
        project: { id: string; key: string; name: string };
      };
      const claim = (token: string | null) =>
        api<ClaimResult>("POST", "/api/v1/agents/pairing/claim", {
          baseUrl: server,
          token,
          body: {
            code,
            ...(requested ? { permission_mode: requested } : {}),
            machine: { name: machineName(), fingerprint: machineFingerprint(), platform: `${process.platform}-${process.arch}` },
            repository: {
              repo_fingerprint: `${machineFingerprint()}:${repoRoot}`,
              display_path: basename(repoRoot) || repoRoot,
            },
          },
        });
      let result: ClaimResult;
      try {
        result = await claim(identity);
      } catch (e) {
        // A re-pasted prompt: its code is spent or expired, but this repository
        // is already connected to that project with a working sign-in.
        if (selfConnect && e instanceof CliError && (e.code === "PAIRING_ALREADY_USED" || /expired/i.test(e.message))) {
          const link = readRepoLink(repoRoot);
          if (link && link.project_id === peeked?.p && (await usableSavedToken(server))) {
            console.log(`✓ Already connected — this repository is linked to ${link.project_key}.`);
            console.log(`  Try: sddctl task next`);
            return;
          }
        }
        // A saved token narrowed to another project/workspace (an earlier
        // pairing) cannot claim this one: sign in fresh and try once more.
        if (selfConnect || temporaryLogin || !(e instanceof CliError && e.httpStatus === 403 && /Token is not valid|Project-scoped tokens/.test(e.message))) throw e;
        console.log("The saved sign-in is limited to another project — sign in again to pair this one.");
        identity = await deviceLogin(server);
        temporaryLogin = true;
        result = await claim(identity);
      }
      writeConfig({ server_url: server, token: result.token, profile: "default" });
      // The login made only to pair is superseded by the machine token.
      if (temporaryLogin && identity) await revokeToken(server, identity);
      writeRepoLink(repoRoot, {
        project_key: result.project.key,
        project_id: result.project.id,
        repository_id: result.repository_link_id,
        server_url: server,
        // Submissions carry machine_id so the link's approval mode applies.
        machine_id: result.machine_id,
        permission_mode: result.permission_mode,
      });
      console.log(`✓ Connected as ${result.user.email} — ${result.machine_name} ↔ ${result.project.key} (${result.project.name})`);
      console.log(
        `  Review: ${result.permission_mode === "AUTO_RUN" ? "auto-approve runs whose required checks pass" : "human review"} (change it on the Machines page of the web app)`,
      );
      console.log(`  Try: sddctl task next`);
    } catch (e) {
      fail(e);
    }
}

export function registerProject(program: Command): void {
  const project = program.command("project").description("Project linking");
  project
    .command("connect <pairing-code>")
    .description("One-command onboarding: sign in (if needed) + register this machine + link the current repository to a project")
    .option("--server <url>", "control plane URL (default: the configured server)")
    .option("--mode <mode>", "request a MORE restrictive permission mode than the pairing code grants: MANUAL | ASSISTED")
    .action((code: string, opts: { server?: string; mode?: string }) => connectWithPairingCode(code, opts));

  // `sddctl connect <code>` is what the web pairing dialog tells users to run.
  program
    .command("connect <pairing-code>")
    .description("Alias of `project connect`: pair this machine and link the current repository")
    .option("--server <url>", "control plane URL (default: the configured server)")
    .option("--mode <mode>", "request a MORE restrictive permission mode than the pairing code grants: MANUAL | ASSISTED")
    .action((code: string, opts: { server?: string; mode?: string }) => connectWithPairingCode(code, opts));

  project
    .command("list")
    .description("List projects in your workspace")
    .action(async () => {
      try {
        const { projects } = await api<{ projects: Array<{ id: string; key: string; name: string; lifecycleStatus: string }> }>("GET", "/api/v1/projects");
        printTable(
          projects.map((p) => ({ key: p.key, name: p.name, lifecycle: p.lifecycleStatus, id: p.id })),
          ["key", "name", "lifecycle", "id"],
        );
      } catch (e) {
        fail(e);
      }
    });

  project
    .command("link <project-key>")
    .description("Link the current repository to a project (writes .sdd/local.json, no secrets)")
    .option(
      "--mode <mode>",
      "manual | assisted (default: keep the link's current mode). Auto-approve is switched on in the web app, not here",
    )
    .action(async (projectKey: string, opts: { mode?: string }) => {
      try {
        const repoRoot = findRepoRoot();
        if (!repoRoot) throw new CliError("NO_REPO", "Not inside a git repository (no .git found)");
        const modes = { manual: "MANUAL", assisted: "ASSISTED" } as const;
        const requestedMode = opts.mode?.toLowerCase();
        // Auto-approve removes the human reviewer, so a project admin chooses it
        // in the browser; a CLI token cannot turn it on (the server refuses).
        const wantsAuto = requestedMode === "auto" || requestedMode === "auto_run";
        const permissionMode = requestedMode && !wantsAuto ? modes[requestedMode as keyof typeof modes] : undefined;
        if (requestedMode && !wantsAuto && !permissionMode) throw new CliError("VALIDATION_ERROR", "--mode must be manual or assisted");
        const me = await api<{ workspaces: Array<{ id: string }> }>("GET", "/api/v1/auth/me");
        const { projects } = await api<{ projects: Array<{ id: string; key: string; name: string }> }>("GET", "/api/v1/projects");
        const target = projects.find((p) => p.key.toUpperCase() === projectKey.toUpperCase());
        if (!target) throw new CliError("PROJECT_NOT_FOUND", `Project ${projectKey} not found in your workspace`);
        void me;

        // Register (or reuse) this machine, then create the server-verified link (T122).
        const { machine } = await api<{ machine: { id: string } }>("POST", "/api/v1/agents/machines/register", {
          body: { name: machineName(), fingerprint: machineFingerprint(), platform: `${process.platform}-${process.arch}` },
        });
        const repoFingerprint = `${machineFingerprint()}:${target.id}`;
        const { link } = await api<{ link: { id: string; permissionMode: "MANUAL" | "ASSISTED" | "AUTO_RUN" } }>("POST", "/api/v1/agents/repo-links", {
          body: {
            machine_id: machine.id,
            project_id: target.id,
            repo_fingerprint: repoFingerprint,
            display_path: repoRoot.split("/").pop() ?? repoRoot,
            ...(permissionMode ? { permission_mode: permissionMode } : {}),
          },
        });
        writeRepoLink(repoRoot, {
          project_key: target.key,
          project_id: target.id,
          repository_id: link.id,
          machine_id: machine.id,
          permission_mode: link.permissionMode,
        });
        const autoApprove = link.permissionMode === "AUTO_RUN";
        console.log(`✓ Linked ${repoRoot} to ${target.key} (${target.name}) · ${autoApprove ? "auto-approve" : "human review"}`);
        if (autoApprove) {
          console.log("  Tasks whose required checks all pass are approved automatically; high-risk tasks still wait for a human.");
        } else if (wantsAuto) {
          console.log(
            "  Auto-approve is not set from the CLI. A project admin switches it on for this repository on the Machines page of the web app\n" +
              "  (\"Auto-approve runs whose required checks pass\"). Until then every submission waits for a reviewer.",
          );
        }
        console.log("Add `.sdd/` to .gitignore — link metadata should not be committed by default.");
      } catch (e) {
        fail(e);
      }
    });

  project
    .command("status")
    .description("Show the repository link status")
    .action(async () => {
      try {
        const repoRoot = findRepoRoot();
        if (!repoRoot) throw new CliError("NO_REPO", "Not inside a git repository");
        const link = readRepoLink(repoRoot);
        if (!link) throw new CliError("NOT_LINKED", "No .sdd/local.json in this repository — run `sddctl project link <key>`");
        const { project: full } = await api<{ project: { name: string; lifecycleStatus: string; key: string } }>(
          "GET",
          `/api/v1/projects/${link.project_id}`,
        );
        output({ repository: repoRoot, project: full.key, name: full.name, lifecycle: full.lifecycleStatus, repository_id: link.repository_id });
      } catch (e) {
        fail(e);
      }
    });

  project
    .command("unlink")
    .description("Remove the repository link")
    .action(() => {
      const repoRoot = findRepoRoot();
      if (!repoRoot) throw new CliError("NO_REPO", "Not inside a git repository");
      const link = readRepoLink(repoRoot);
      if (!link) throw new CliError("NOT_LINKED", "No link present");
      void link;
      rmSync(`${repoRoot}/.sdd/local.json`);
      console.log("Repository unlinked.");
    });
}
