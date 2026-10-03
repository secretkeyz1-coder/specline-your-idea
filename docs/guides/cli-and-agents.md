# CLI and agents

[Back to README](../../README.md) · [MCP](mcp.md) · [Security](../../SECURITY.md)

`sddctl` coordinates tasks and evidence. Your coding agent implements changes. `sdd-agent` is a separate optional daemon, not installed by the `sddctl` web installer. No registry package installation is promised.

## Use the CLI from this checkout

With dependencies installed, from this control-plane repository root:

```bash
bun run apps/cli/src/index.ts --help
bun run apps/cli/src/index.ts login --server http://localhost:4000
bun run apps/cli/src/index.ts whoami
```

Login uses the browser device-authorization flow. Source commands require Bun and this checkout's dependencies. For commands in a target repository, invoke the entry point by its **absolute path**, or install the served CLI below; repository commands use the current working directory to find your target repository.

## Install from a trusted running API

Requires Node.js 18+ or Bun. These examples use the local API; replace the origin with your trusted HTTPS API origin for remote use. Download and inspect the script before executing it.

Bash/Git Bash (macOS/Linux/Windows):

```bash
curl -fsSL http://localhost:4000/api/v1/cli/install.sh -o sddctl-install.sh
# Open sddctl-install.sh in your editor and inspect it first.
sh sddctl-install.sh
export PATH="$HOME/.sdd/bin:$PATH"
sddctl --help
```

PowerShell:

```powershell
Invoke-WebRequest http://localhost:4000/api/v1/cli/install.ps1 -OutFile sddctl-install.ps1
# Open sddctl-install.ps1 in your editor and inspect it first.
& ./sddctl-install.ps1
sddctl --help
```

The installer downloads a server-built JS bundle into `~/.sdd/bin` (`SDD_HOME` overrides the root). PowerShell adds the directory to user PATH unless `SDD_NO_PATH` is set; old terminals may need the printed full path. Bash may install a shim in an existing user bin directory but does not guarantee permanent PATH setup. The shell installer checks SHA-256 only when `sha256sum` or `shasum` is available; PowerShell uses `Get-FileHash`. A checksum supplied by the same server is an integrity check, not independent publisher authentication.

Development serves a bundle from CLI source; the API production build includes `apps/api/scripts/build-cli.ts`. `sddctl update` fetches the configured server's build. Do not assume a server installation contains the source daemon, a coding-agent CLI, or a model login.

## Connect a target repository

Run these in the trusted implementation repository, not automatically in the control-plane checkout. Replace `PROJECT_KEY` and `TASK_KEY` with actual keys from the app.

```bash
sddctl login --server http://localhost:4000
sddctl project list
sddctl project link PROJECT_KEY --mode manual
sddctl project status
sddctl task next
sddctl task show TASK_KEY
sddctl task context TASK_KEY
sddctl task claim TASK_KEY
sddctl task start TASK_KEY
```

Read the work order and run your coding agent separately. Inspect each command's help before writing automation:

```bash
sddctl run test --help
sddctl task submit --help
sddctl ui pull --help
```

`run test` can execute a real command with `--execute` or report an external result with actual status/exit code. Do not submit fabricated evidence. `task submit` uses the current HEAD by default for commit evidence; review that it identifies the implementation you intend to submit. This guide does not instruct you to commit or push anything. Approved UI/design-system exports can be pulled with `sddctl ui pull` into `docs/ui-reference/` and `docs/design-system/` in the linked repository; inspect writes first if you already maintain those paths.

Login configuration defaults to `~/.config/sddctl/config.json`; `SDDCTL_CONFIG` selects another file. Keep tokens private. Repository linking writes local metadata under `.sdd/local.json`; keep it untracked. Linking does not grant a token authority to raise permissions to `AUTO_RUN`; enable that only deliberately in the browser's Machines controls.

## Optional daemon: source-based setup

Authenticate with the CLI above. From the control-plane checkout root:

```bash
bun run apps/agent/src/index.ts status
bun run apps/agent/src/index.ts connect
```

Keep the process running. It shares the CLI configuration, detects available coding agents, and makes outbound connections (use TLS for remote deployments). Machine-side Local CLI planning jobs require the installed/authenticated Claude Code or Codex CLI and a connection bound to your owned machine. Task dispatch additionally needs an authorized `AUTO_RUN` repository link.

**Only use trusted repositories and accounts.** Execution runs under your OS identity; the Claude execution adapter passes `--dangerously-skip-permissions`. Other adapters and a configurable generic executable can also modify files or run programs. Automatic review is not a sandbox and task scope is not an OS permission boundary. Use a separate low-privilege account or disposable environment for experiments; stop the daemon and lower permissions when not needed.
