# MCP and Local CLI Protocol

> **MCP research vs installed SDK:** v2 / 2026-07-28 language below is research/target intent, not installed-version evidence. `packages/mcp/package.json` declares v1 (`^1.30.0`); `packages/mcp/src/index.ts` uses v1 server/Streamable HTTP APIs. No v2 migration or support for all researched features is certified here.

> **Status reviewed 2026-10-03:** Original specification/research pack, not current implementation or verification certification. [Navigation](README.md). Code/configuration takes precedence; recorded audits/open decisions are not automatically current.

## 1. Recommendation

Use **both CLI and MCP**, with distinct responsibilities.

### CLI / local bridge is the primary execution-control layer

Use it for:
- repository linking;
- local machine identity;
- starting local agent processes;
- process cancellation;
- log capture;
- heartbeat;
- local path resolution;
- adapter detection.

### MCP is the interoperability layer

Use it for:
- task discovery;
- retrieving task context;
- updating execution state;
- reporting progress;
- reporting tests;
- reporting blocks;
- submitting review;
- reporting bugs.

An MCP-capable agent can work directly with the website, while a non-MCP agent can still execute `sddctl` commands.

## 2. Why MCP alone is not enough

MCP is a standardized protocol for exposing tools/resources to an AI host.

It does not by itself solve every local execution concern:
- Which repository path is linked?
- Which local process should be spawned?
- Is a local agent process still alive?
- How should stdout/stderr be captured?
- How should the website cancel a subprocess?
- Which executable exists on this machine?
- How should a task be dispatched when no AI host is currently making MCP calls?

Those are local runner/daemon responsibilities.

## 3. Why CLI alone is not enough

A proprietary CLI is easy to control but requires every AI agent to learn custom shell commands.

MCP gives a common semantic tool layer and reduces agent-specific prompting.

Therefore:

```text
Domain API
   │
   ├── Web REST
   ├── sddctl CLI
   ├── Remote MCP
   └── sdd-agent gateway

All use the same task/execution services.
```

## 4. CLI command design

### Authentication

```bash
sddctl login
sddctl logout
sddctl whoami
```

### Project

```bash
sddctl project list
sddctl project link PRJ-001 [--mode manual|assisted]
sddctl project status
sddctl project unlink
sddctl connect <pairing-code>
```

`--server` defaults to the configured server; the saved token is only ever sent to the server that issued it.

`project link` keeps the link's current mode unless `--mode manual|assisted` lowers it. Auto-approve ("Auto-approve runs whose required checks pass", `AUTO_RUN`) is never set from the CLI: `--mode auto` links the repository and explains that a project admin switches auto-approve on for it on the Machines page of the web app. The server refuses `AUTO_RUN` from any API token.

`connect <code>` pairs the machine as the person running it: without a usable login for the server it runs the device flow first, claims the code with that login, saves the machine-bound token, revokes the temporary login, and writes `machine_id` and `permission_mode` to `.sdd/local.json` so submissions carry the machine. A self-connect code (from the execution prompt copied in the web app) skips the login: the code signs the CLI in as the person who copied the prompt. If that code is spent or expired but the repository is already linked to the same project with a working sign-in, `connect` prints "Already connected" and exits 0, so a re-pasted prompt goes on working.

### Task

```bash
sddctl task list --ready
sddctl task show TASK-084
sddctl task context TASK-084
sddctl task context TASK-084 --format json
sddctl task prompt TASK-084
sddctl task claim TASK-084
sddctl task start TASK-084
sddctl task block TASK-084 --reason "..."
sddctl task submit TASK-084
```

`task start|block|submit` act on the run recorded in `.sdd/run.json` and refuse (`RUN_TASK_MISMATCH`) when that run belongs to a different task than the one named.

### Run

```bash
sddctl run status
sddctl run heartbeat [--lease-seconds 900]
sddctl run progress --message "..."
sddctl run test --command "..." --status passed
sddctl run artifact --type diff --file ...
sddctl run complete --summary-file ...
```

### Bug

```bash
sddctl bug report \
  --title "Concurrent claim returns 500" \
  --expected "Return 409" \
  --current "Returns 500"
```

### UI reference and design system

```bash
sddctl ui pull
```

Writes the approved planning visuals into the linked repository:

- `docs/ui-reference/` — one `<screen-key>.html` per drawn screen plus `README.md` (version, screen names, purposes, requirement keys, key elements). The README states the fidelity: styled screens bind layout, elements, flow **and** look; neutral screens bind layout, elements and flow, with colours, fonts and components taken from the design system or the stack.
- `docs/design-system/` — from `GET /api/v1/projects/{id}/design-system/export`: `DESIGN.md` (agent guide incl. UI role → mockup class → library component table), `tokens.css`, `design-tokens.json` (W3C DTCG), `tailwind-theme.css` (Tailwind v4 `@theme`), the chosen library's theme file (`shadcn-theme.css` | `daisyui-theme.css` | `bootstrap-theme.css` | `mui-theme.ts` + `material-tokens.css` | `antd-theme.ts` | `flowbite-theme.css` | `pico-theme.css`; none for "no library"), `preview-light.html`, `preview-dark.html`.

Without an approved artifact it prints `NO_UI_REFERENCE: ...` or `NO_DESIGN_SYSTEM: ...` so the agent builds from the specs / stack defaults. Paths from the server are kept inside the repository (no `..`, no absolute paths).

### Installation and update

The control plane serves `sddctl` itself — no checkout of this repository is needed, only Node.js 18+ or Bun:

```bash
curl -fsSL <api-url>/api/v1/cli/install.sh | sh     # macOS, Linux, Git Bash
irm <api-url>/api/v1/cli/install.ps1 | iex          # Windows PowerShell
sddctl update                                       # fetch the server's current build
```

- `GET /api/v1/cli` returns `{ available, version, install: { sh, ps1 } }`; `GET /api/v1/cli/sddctl.mjs` is the CLI bundled into one ES module (headers `x-sddctl-version`, `x-sddctl-sha256`). All four are public: nothing in them is secret, and the agent that needs them has not signed in yet.
- The installers check for Node.js 18+ or Bun, verify the download against the checksum written into the script, and install into `~/.sdd/bin` (`SDD_HOME` overrides `~/.sdd`). `install.sh` also copies its shim into `~/.local/bin` or `~/bin` when that folder is on `PATH` — never over another `sddctl`; `install.ps1` writes `sddctl.cmd` plus a Git Bash shim and adds the folder to the user `PATH` (`SDD_NO_PATH=1` skips that). Both print the full path to call when `sddctl` is not on `PATH` in the current shell.
- The execution prompt's Phase 1 tells the coding agent to run the installer itself when `sddctl --version` fails; it stops and asks the user only when neither Node.js nor Bun is installed.
- The CLI must stay runnable on Node: no `Bun.*` APIs and no `require()` in `apps/cli` (ES imports only).

### Configuration

The CLI reads `~/.config/sddctl/config.json`; the `SDDCTL_CONFIG` environment variable points at another config file (a second sign-in, or tests).

### Machine-readable output

```bash
sddctl task show TASK-084 --json
```

All commands used by AI agents should support deterministic exit codes and JSON.

## 5. Local repository link

Repository-local file:

```text
.sdd/local.json
```

Example:

```json
{
  "project_key": "PRJ-001",
  "repository_id": "repo-link-id"
}
```

Must not contain authentication secrets.

Add to `.gitignore` unless deliberate shared link metadata is introduced later.

## 6. Connected task prompt

Example:

```text
You are executing TASK-084 for this repository.

First run:
  sddctl task context TASK-084 --format agent

Follow the returned task contract exactly.

Then:
  sddctl task claim TASK-084
  sddctl task start TASK-084

Report meaningful progress and test results with sddctl.

Do not mark the task accepted yourself.
When implementation and required verification pass:
  sddctl task submit TASK-084

If the specification is ambiguous, a dependency is missing, or the requested
change requires work outside the allowed scope:
  sddctl task block TASK-084 --reason "<clear reason>"
and stop unsafe implementation.
```

## 7. MCP endpoint

Concept:

```text
https://control-plane.example.com/mcp
```

Original research target: **MCP TypeScript SDK v2**, serving the 2026-07-28 revision (not the installed v1 SDK). For remote access, use the SDK HTTP server handler; do not implement MCP framing or backward-compatibility logic manually.

## 8. MCP tools

### `project_get_context`

Input:

```json
{
  "project_id": "PRJ-001"
}
```

Returns a minimal project context and active artifact revisions.

### `task_list_ready`

Input:

```json
{
  "project_id": "PRJ-001",
  "limit": 10
}
```

### `task_get`

Input:

```json
{
  "task_id": "TASK-084"
}
```

Returns task contract and selected context pack.

### `task_claim`

```json
{
  "task_id": "TASK-084",
  "executor_id": "..."
}
```

### `task_start`

### `task_heartbeat`

```json
{ "task_id": "TASK-084", "lease_seconds": 900 }
```

Renews the lease on the caller's active run. Progress and test reports renew it as well (to at least 900 s from now).

### `task_report_progress`

### `task_report_test`

### `task_block`

### `task_request_review`

### `bug_report`

MCP tool names should stay stable and vendor-neutral.

A tool call the server rejects (illegal transition, lease lost, access denied…) returns `isError: true` with `{ "error": { "code", "message", "details" } }` as its text content, so an agent never mistakes a refusal for success. The endpoint is stateless: each request gets its own server and transport, closed when the response is complete.

## 9. MCP resources

Optional resources can expose read-only documents:

```text
sdd://projects/PRJ-001/product
sdd://projects/PRJ-001/requirements/active
sdd://tasks/TASK-084/context
```

Prefer tools for state-changing operations.

## 10. MCP authorization

Remote MCP must be authenticated.

Principles:
- TLS only;
- short-lived access credentials;
- project/workspace scopes;
- resource/audience validation;
- no token in query string;
- no token embedded in generated prompt.

## 11. CLI auth UX

Preferred flow:

```text
$ sddctl login

Open this URL in your browser:
https://...

Code:
ABCD-EFGH

Waiting for authorization...

✓ Logged in as user@example.com
```

Store refresh material in OS secure credential storage where supported.

## 12. Local daemon

Command:

```bash
sdd-agent connect
```

or service mode:

```bash
sdd-agent service install
sdd-agent service start
```

### Outbound architecture

```text
Laptop
  sdd-agent
      │
      │ WSS outbound
      ▼
Agent Gateway
```

Benefits:
- NAT/firewall friendly;
- no public local HTTP server;
- central visibility;
- website can dispatch approved tasks.

The gateway authorizes every message after `hello` by the socket it arrives on (keyed on the underlying Bun socket, not Elysia's per-event wrapper), never by a `machine_id` field in the message. A socket that has not completed `hello` within 10 s is closed with `HELLO_TIMEOUT`.

`sdd-agent status` prints the daemon configuration, detected coding agents and detected AI CLIs (`ai_cli: [{cli, installed, version, signed_in}]`).

### AI jobs (Local CLI providers)

A `LOCAL_CLI` provider connection with target `cli://machine/<machine-id>/<claude|codex>` runs planning prompts through the machine's `sdd-agent` over the same outbound socket. The job carries the prompt and a tool name only — never a command line or a credential; the daemon builds the invocation and the CLI uses the machine's own login.

After `hello_ok` the daemon reports which CLIs it can run:

```json
{
  "type": "ai_capabilities",
  "machine_id": "...",
  "ai_cli": [
    { "id": "claude", "name": "Claude Code", "installed": true, "version": "2.1.0", "auth": "ok", "suggestedModels": ["sonnet", "opus", "haiku"] },
    { "id": "codex", "name": "Codex CLI", "installed": false, "version": null, "auth": "unknown", "suggestedModels": [] }
  ]
}
```

The server keeps at most 10 entries on the live connection; `GET /api/v1/ai/cli` shows them to the machine's owner.

Server → daemon:

```json
{
  "type": "ai_generate",
  "job_id": "...",
  "tool": "claude",
  "model": "sonnet",
  "system": "...",
  "prompt": "...",
  "timeout_ms": 900000,
  "max_output_bytes": 4000000
}
```

Daemon → server, success or failure:

```json
{ "type": "ai_result", "job_id": "...", "machine_id": "...", "ok": true, "text": "...", "input_tokens": 1200, "output_tokens": 3400, "cost_usd": 0.05, "duration_ms": 61000 }
{ "type": "ai_result", "job_id": "...", "machine_id": "...", "ok": false, "error_code": "NOT_SIGNED_IN", "error_message": "..." }
```

- Only the machine the job was sent to may answer it; an `ai_result` from any other socket is ignored.
- `error_code` is one of `NOT_INSTALLED`, `NOT_SIGNED_IN`, `TIMEOUT`, `FAILED`, `EMPTY_OUTPUT`, `OUTPUT_TOO_LARGE`; the API surfaces it as `CLI_<code>` (504 for `TIMEOUT`, else 502).
- The daemon runs at most **2** AI jobs at once (a third is answered with `ok: false`) and caps `timeout_ms` at 30 minutes itself. The server's backstop is `timeout_ms + 60 s`; a lost socket gives `PROVIDER_TIMEOUT`, an offline machine `MACHINE_OFFLINE`.
- The daemon uses the same runner as the server (`@sdd/agent-cli`): a fresh temporary folder deleted afterwards, no tools, prompt on stdin (Claude Code reads the system prompt from a file; Codex gets it prepended to stdin), allowlisted environment (server secrets are never passed), hard timeout that kills the whole process tree, output cap (`max_output_bytes` = the server's `AI_MAX_RESPONSE_BYTES`, 4 MB when absent). CLIs are never run with bypass/"yolo" permissions.

## 13. Daemon execution flow

```text
User clicks "Run on Local Agent"
        ↓
Server creates dispatch command
        ↓
Daemon receives command
        ↓
Daemon checks:
  machine
  repo link
  execution-agent adapter
  task eligibility
        ↓
Daemon confirms execution
        ↓
Task claim
        ↓
Spawn local AI CLI
        ↓
Stream events
        ↓
Agent performs work
        ↓
Collect result
        ↓
Validation / review request
```

Daemon rules:

- **One run at a time.** The daemon marks itself busy synchronously when it accepts a dispatch (before claiming) and stays busy until verification and the final report are done; a second dispatch meanwhile is NACKed `AGENT_BUSY`.
- **Finding work.** After `hello_ok` and after every run it calls `dispatch-next`; while idle it polls again with backoff (15 s → 5 min). The server's `work_available` message (approval, requeue, unblock, readied task, auto-approve switched on) triggers an immediate poll.
- **The claim names the machine** (`machine_id`), so the server can reach the run later.
- **Stopping.** `cancel_task` for the active run, or a heartbeat answered with a lease error (409/403/404), kills the adapter process tree — and a running verification command — and nothing further is reported for that run. The adapter run is bounded by `SDD_AGENT_RUN_TIMEOUT_MS` (default 2 h, then blocked `AGENT_TIMEOUT`); each verification command by `SDD_AGENT_VERIFY_TIMEOUT_MS`.
- **Resume.** A human resuming a blocked daemon run hands it back with `execute_task` + `resume_run_id`; the daemon continues under the fresh lease. If the machine is offline the server refuses the resume — unblock to READY instead.
- **Verification commands** are parsed into argv (no shell) and limited to an executable allowlist (`SDD_AGENT_ALLOWED_COMMANDS`). Interpreter flags that run inline code (`node -e/--eval/-p`, `bun -e`, `deno eval`, `python -c`, `ruby -e`, `perl -e`, `php -r/-B/-R/-E`, `rake -e`, `mix eval`) are refused, also when short flags are clustered (`node -pe`, `python3 -Ic`) and when a wrapper runs the interpreter (`uv run python -c`, `bundle exec ruby -e`, `yarn node -e`). `npx`/`bunx`/`bun x`/`pnpm dlx`/`yarn dlx`/`npm exec` of packages outside `SDD_AGENT_ALLOWED_PACKAGES`, `uv tool`, `uv pip`, `uv run --with …` and code fetched by URL or registry specifier (`deno run npm:x`, `uv run https://…`) are refused too. This is a guard against contract text smuggling code past a reviewer, not a security boundary: test runners execute the repository's own code.

## 14. Agent adapters

Initial adapter interface:

```ts
export interface ExecutionAgentAdapter {
  name(): string;
  detect(): Promise<DetectionResult>;
  buildInvocation(input: TaskInvocation): Promise<CommandSpec>;
  start(command: CommandSpec): Promise<ManagedProcess>;
}
```

Adapters:
- generic shell;
- Codex;
- Claude Code;
- Kiro;
- Gemini.

Do not couple task semantics to adapter flags.

## 15. Manual mode

If user does not install CLI:

1. Copy standalone prompt.
2. Run task in local AI agent.
3. Return to website.
4. Create manual execution record.
5. Paste summary/test evidence.
6. Request review.

This workflow must remain fully supported.

## 16. Status updates

Do not ask the AI to edit task Markdown as the primary status mechanism.

Connected agent uses:
- MCP tools; or
- CLI commands.

Server validates every transition.

## 17. Reconnect behavior

CLI command mode is stateless request/response.

Daemon mode:
- reconnect with backoff;
- re-register connection;
- query active run state;
- reconcile missed commands/events using IDs and idempotency keys.

## 18. Compatibility principle

MCP evolves. Keep the domain API independent from MCP protocol version.

The MCP adapter may support more than one protocol revision while all versions map to the same internal domain command/query layer.
