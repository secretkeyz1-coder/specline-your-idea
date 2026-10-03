# Deployment and Operations

## 1. Deployment shape

The project is open-source and self-hostable. A single-VPS / Docker Compose deployment is a supported reference target; a hosted deployment may use the same topology with managed PostgreSQL/object storage.

Recommended first production topology:

```text
Internet
   ↓
TLS Reverse Proxy / Load Balancer
   ├── SvelteKit Web
   └── Bun + Elysia API
          ├── PostgreSQL
          └── Object Storage (optional)
```

The same Bun/Elysia API may initially host:
- REST;
- browser realtime;
- MCP endpoint;
- agent gateway.

Split only when operational needs justify it.

## 2. Containers

Use separate images:
- web;
- api.

PostgreSQL should use managed service where available or a carefully managed persistent deployment.

## 3. Configuration

Required production config groups:
- base URLs;
- database DSN;
- session/auth config;
- encryption key/KMS reference;
- object storage;
- rate limits;
- AI provider defaults and egress policy (`ALLOW_PRIVATE_AI_EGRESS`, `AI_DEFAULT_TIMEOUT_MS`, `AI_MAX_RESPONSE_BYTES`);
- local CLI models on the server (`SDD_ENABLE_LOCAL_CLI`, default `false`);
- UI-reference render check (`UX_RENDER_LINT`, `auto` or `off`; `UX_RENDER_CHROMIUM`, a Chromium executable): it needs `playwright-core` and a Chromium on the API host. The reference API image ships neither, so there the check is skipped (one warning in the log) and screens get the HTML lint only; to enable it, install `playwright-core` and a Chromium in the image and point `UX_RENDER_CHROMIUM` at it;
- listen interface and sign-up policy (`API_HOST`, `ALLOW_SELF_REGISTRATION`, `REGISTRATION_ALLOWLIST`);
- WebSocket limits;
- allowed origins;
- MCP public metadata;
- logging level.

## 4. Database migrations

Deployment sequence:

1. backup if migration is risky;
2. run backward-compatible migration;
3. deploy API;
4. deploy SvelteKit web;
5. verify health;
6. run smoke test.

Avoid migrations that require old and new code to disagree during rolling deployment.

## 5. Health

### Liveness
Process can serve.

### Readiness
Required dependencies available enough to serve requests.

Do not report healthy only because process exists.

## 6. Backups

Minimum:
- daily database backup;
- retention policy;
- encrypted storage;
- periodic restore test.

Object artifacts require their own backup/retention strategy.

## 7. Observability

### Logs
Structured fields:
- trace_id;
- user_id when appropriate;
- workspace_id;
- project_id;
- task_id;
- run_id;
- source;
- route/tool;
- latency;
- result.

Never log bearer tokens/provider secrets.

### Metrics
- request count/error/latency;
- AI request latency/error;
- planning generation failures;
- active daemon connections;
- MCP calls/errors;
- task claims/conflicts;
- active runs;
- blocked tasks;
- lease expiry;
- review turnaround;
- background job queue depth.

### Tracing
Propagate trace/correlation IDs through:
- browser API;
- CLI API;
- MCP tool;
- daemon gateway;
- AI provider calls.

## 8. Alerts

Initial alerts:
- elevated API error rate;
- database unavailable;
- AI provider failure spike;
- agent gateway disconnect spike;
- background jobs stuck;
- backup failure.

## 9. Rate limits

Separate budgets:
- login/auth;
- AI planning generation;
- MCP read;
- MCP write;
- CLI events;
- WebSocket connections.

## 9A. AI provider egress

Hosted deployments should default custom provider calls to public HTTPS targets and deny private/metadata network destinations unless an administrator explicitly configures an allowlist.

Self-hosted deployments may opt into LAN model endpoints, but this is an explicit deployment setting (`ALLOW_PRIVATE_AI_EGRESS=true`; the reference compose pins it to `false`). `localhost` always refers to the machine running the API, not the user's laptop. Cloud metadata addresses stay refused even then, including when wrapped in IPv6 (IPv4-mapped/compatible, NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4, Teredo).

A refused hostname is reported to the user by name only; the address it resolved to is written to the API log (`"egress refused"`, fields `host`, `resolved_ip`) so operators can see what was blocked without the UI mapping the internal network. A connection test reports the provider's HTTP status and error code, not its response text.

## 9B. Local CLI models (Claude Code / Codex)

Besides API-key providers, an AI provider connection of type **Local CLI** uses a coding-agent CLI that is already signed in (subscription or the CLI's own key). No key is stored in the control plane. Two places it can run:

| Target | When to use | Setup |
|---|---|---|
| The user's machine via `sdd-agent` | Recommended for any server/VPS deployment | On the machine: `sddctl login --server https://<domain>`, then keep `sdd-agent connect` running. Outbound connection only; generations run only while the agent is online. Only the machine's owner can bind a connection to it. |
| The API server itself | Local or personal installs only | Set `SDD_ENABLE_LOCAL_CLI=true` on the API; install `claude` and sign in as the OS user that runs the API (or point `SDD_CLAUDE_BIN` at the binary). Only an operator can create it, and it is saved as a SYSTEM connection. Claude Code only: Codex is refused on the server because its read-only sandbox does not stop it reading host files (the API's `.env`, keys). Do not enable on a shared server: every generation runs with that server's CLI login. |

On a machine, Codex runs with `--ignore-user-config` (the user's `~/.codex/config.toml`, and so its MCP servers, is not loaded; the login in `CODEX_HOME` still is) and `-c features.plugins=false -c features.apps=false -c features.shell_tool=false`. A Codex CLI too old for `--ignore-user-config` fails with `CLI_UNSUPPORTED_VERSION` instead of running with the user's MCP servers — update it. A model id containing anything but letters, digits and `. _ : / -` is refused before the CLI starts.

The reference `deploy/docker-compose.production.yml` does not pass `SDD_ENABLE_LOCAL_CLI` (it stays off) and the API image contains no CLI, so VPS deployments use the machine target.

Operating `sdd-agent` for AI jobs:
- `sdd-agent status` prints the server, authentication state and detected AI CLIs (installed, version, signed in).
- `sdd-agent service` prints service instructions (systemd user unit with `Restart=always` on Linux; run `sdd-agent connect` at login via launchd on macOS or Task Scheduler on Windows).
- The daemon runs at most 2 AI jobs at once; CLI connections default to a 15-minute total timeout per generation (max 30). If the machine is offline the generation fails with `MACHINE_OFFLINE`.
- Choose the model on the AI profile: `default` (the CLI's own setting) or a CLI alias such as `sonnet`, `opus`, `haiku` for Claude Code.
- Users are responsible for checking each provider's terms for automated use of a subscription login.

Safeguards for both targets are listed in `13_SECURITY.md` §17A.

## 10. AI failure strategy

AI calls are non-transactional external operations.

Pattern:

```text
create generation attempt
→ call provider
→ validate output
→ persist artifact revision
```

On failure:
- generation attempt remains;
- user answers remain;
- retry is possible.

Timeouts: an HTTP provider's `timeoutMs` is an idle limit (headers and gaps between streamed chunks) with a total cap of 4×; default 240 s per connection. The API lifts Bun's idle timeout on AI generate/refine endpoints and the web server calls them over `node:http`, so a reverse proxy in front must also allow long requests on those paths.

## 11. Background jobs

Jobs include:
- AI artifact generation if async UX used;
- stale analysis;
- convergence;
- notifications;
- cleanup.

Use idempotent job handlers.

## 12. Execution log retention

MVP suggestion:
- task events: long-lived/audit-sensitive;
- verbose raw subprocess logs: shorter configurable retention;
- test summaries: long-lived;
- large artifacts: object storage with lifecycle rule.

## 13. Local daemon versioning

Server should expose minimum compatible daemon version.

On connection:
- daemon sends version;
- server warns/rejects only when protocol is incompatible.

## 14. CLI update distribution

The API serves the CLI, so the CLI always matches the server it talks to:
- `bun run build` (apps/api) also runs `scripts/build-cli.ts`, which bundles `apps/cli` into `dist/cli/sddctl.mjs` plus `sddctl.json` (version, sha256); the API image copies `apps/cli` into its build stage for this. A dev server builds the bundle from source on first request.
- `GET /api/v1/cli/install.sh` / `install.ps1` install it (checksum-verified); `sddctl update` re-downloads it; `sddctl --version` prints its version (the `apps/cli` package version).
- Still open: signed releases and standalone binaries for machines with neither Node.js nor Bun.

## 15. MCP versioning

Keep internal tool semantics stable.

Protocol adapter can evolve independently.

Do not store MCP-version-specific state in core task tables.

## 16. Disaster recovery priorities

Restore order:
1. PostgreSQL;
2. encryption/auth dependencies;
3. API;
4. web;
5. object artifacts;
6. daemon reconnect.

Local repositories remain on user machines and are not the platform backup responsibility.

## 17. Production launch checklist

- migrations tested;
- backup/restore tested;
- TLS active;
- secrets encrypted;
- auth/access tests pass;
- claim race test passes;
- MCP auth tests pass if MCP enabled;
- daemon dispatch security tests pass if daemon enabled;
- `SDD_ENABLE_LOCAL_CLI` is `false` unless this is a single-user/local install;
- rate limits configured;
- logs redact secrets;
- first admin creation documented;
- known limitations published;
- open-source license decision completed before public release.


## Secret-key operation

Production configuration must provide the instance encryption master key through a secret mechanism outside PostgreSQL. Losing this key makes stored provider credentials unrecoverable; rotating it must be an explicit operation.
