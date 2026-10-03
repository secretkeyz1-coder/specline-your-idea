# Security Design

## 1. Threat model

The system connects a public/hosted web control plane to code repositories and AI agents running on user laptops.

This creates significant trust boundaries.

Threats include:
- stolen CLI token;
- malicious prompt content;
- accidental agent shell execution;
- cross-project data access;
- task hijacking;
- replayed task events;
- duplicate execution;
- malicious MCP client;
- daemon command injection;
- secrets leaking into prompts/logs;
- AI hallucinating authorization;
- a compromised local machine;
- a local coding-agent CLI used as a planning model acting on the host (running tools, reading files, leaking the host's secrets) or being driven on someone else's machine (§17A);
- AI-generated HTML (UI reference, design-system previews) running script or loading remote content in the browser (§3).

## 2. Core rule

AI output is **untrusted input**.

The model may propose:
- task data;
- stack choices;
- state reasons;
- summaries.

It may not bypass:
- authorization;
- transition validation;
- repository binding;
- review policy.

## 3. Browser security

- HTTPS only in production.
- Secure, HTTP-only, SameSite cookies.
- CSRF protection where applicable.
- Content Security Policy.
- server-side authorization on every protected endpoint.
- validate all IDs against workspace/project membership.

Generated mockups and design-system previews (AI- or template-produced HTML) render only inside `<iframe sandbox="">` via `srcdoc`, with an injected CSP `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:` (`apps/web/src/lib/ux.ts`). No script runs and nothing is fetched. The design-system renderer (`apps/api/src/modules/design-system/render.ts`) emits self-contained CSS/HTML only — no external fonts, scripts or images; font stacks end in system fallbacks.

## 4. CLI authentication

Preferred:
- browser/device authorization flow;
- short-lived access token;
- refresh credential in OS secure store.

Fallback PAT:
- show once;
- hashed server-side if design permits;
- scoped;
- revocable;
- expiration required/recommended.

## 5. CLI token scopes

Examples:
- `project:read`;
- `task:read`;
- `task:execute`;
- `run:write`;
- `bug:write`.

A CLI used only for task execution does not need artifact approval permissions.

## 6. MCP security

Remote MCP:
- TLS;
- proper authorization;
- explicit audience/resource binding;
- scoped permissions;
- rate limiting;
- input schema validation;
- audit tool calls.

Never pass an unrelated upstream access token through the MCP server.

## 7. Local daemon

The daemon creates **outbound** connection only by default.

It must not expose an unauthenticated public local port.

Daemon registration binds:
- user;
- machine;
- installation identity;
- capabilities.

## 8. Dispatch command safety

The server must not send arbitrary shell text such as:

```json
{"command":"rm -rf ..."}
```

Instead send structured execution intent:

```json
{
  "type": "execute_task",
  "task_id": "TASK-084",
  "repository_link_id": "...",
  "execution_profile_id": "..."
}
```

The local adapter resolves the executable and approved arguments.

AI generation jobs sent to the daemon (`ai_generate`) follow the same rule: a tool id (`claude` | `codex`), model name, prompt text and limits — never a command line (§17A).

## 9. Repository binding

A machine repository link is created locally.

The daemon must ensure:
- requested project matches link;
- current working directory resolves inside linked repository;
- optional fingerprint matches;
- symlink/path traversal protections exist.

## 10. Agent permission modes

Per project:

### Manual
Agent cannot be started remotely.

### Assisted
Website can prepare command; user confirms locally.

### Auto-run
Website may dispatch approved tasks to daemon.

Default should be Manual or Assisted.

## 11. Scope restrictions

Task contract may declare:
- allowed paths;
- forbidden paths.

Agent path rules are guidance plus review evidence, not a perfect sandbox.

For stronger isolation, future versions may use:
- worktree;
- container;
- VM/sandbox.

## 12. Secret handling

Never:
- include provider API keys in generated Markdown;
- include access tokens in copied prompts;
- log `Authorization` headers;
- store secrets in `.sdd/local.json`.

Provider credentials:
- encrypted at rest using authenticated application-layer encryption;
- referenced by opaque secret ID;
- decrypted only by authorized backend execution;
- secret headers stored separately from public provider connection metadata;
- never returned by normal provider read/list APIs.

For the self-hosted MVP, an instance master key is supplied outside PostgreSQL (for example as an orchestrator/container secret), is never written to logs or exports, and has a key version identifier so rotation can be introduced without changing provider records. Do not silently generate a new encryption key on every application start. Production operators may replace this with KMS/HSM-backed envelope encryption later without changing the provider-domain model.

## 13. Prompt injection

Planning documents and repository content can contain malicious instructions.

Agent prompt should enforce these boundaries:
1. system/agent execution policy;
2. project constitution;
3. approved requirements and technical design;
4. task contract **and** applicable repository `AGENTS.md` instructions as mandatory execution constraints;
5. ordinary repository content as data/context.

If the task contract conflicts with an applicable `AGENTS.md` or another higher-level approved constraint, the agent must stop/block rather than selecting whichever instruction is more convenient. The platform must never treat ordinary repository text as authorization.

## 14. Task claim security

Claim operation must verify:
- user/executor permission;
- task project scope;
- task is `READY`;
- no active lease;
- artifact freshness;
- dependencies done.

## 15. Replay/idempotency

CLI/daemon mutations use idempotency keys.

Repeated network submission must not:
- create duplicate runs;
- duplicate review request;
- duplicate test record unexpectedly;
- transition a task twice.

## 16. Audit

Security-sensitive events:
- login;
- token creation/revocation;
- machine registration;
- repository link;
- task dispatch;
- task claim;
- permission change;
- artifact approval;
- review approval;
- policy override.

## 17. AI provider SSRF protections

Custom AI base URLs are dangerous.

Protect by:
- workspace permission;
- URL validation;
- disallow metadata/local network targets by default for hosted deployment;
- egress policy;
- DNS rebinding protections;
- timeout;
- response size limits.

If self-hosted mode intentionally allows LAN model endpoints, make it an explicit configuration mode. A hosted control plane must not treat `localhost` as the user's laptop; local-only model servers require an explicit local bridge/relay design rather than silently targeting server localhost.

Generic custom HTTP mappings must:
- use a fixed allowlist of template variables;
- use declarative JSON/body and response-pointer mapping;
- reject arbitrary JavaScript/template expression evaluation;
- enforce redirect, DNS-rebinding, timeout and response-size policy.

Timeouts: the connection timeout is an idle limit (headers and each gap between streamed chunks) with a total cap of 4× that value, so a trickling stream cannot hold a request open indefinitely.

The egress posture is `ALLOW_PRIVATE_AI_EGRESS=false` by default (hosted posture); `true` is the explicit self-hosted LAN opt-in.

## 17A. Local CLI model providers

A `LOCAL_CLI` provider connection uses a coding-agent CLI (Claude Code, Codex) installed on a host as a text model. The CLI runs with that host's CLI login and OS user, so it is treated as a privileged local process.

Threats:
- the model using the CLI's own tools (shell, file edits, MCP servers) on the host;
- the host's secrets (database URL, master key, session secret) reaching the CLI process or its prompt;
- one user driving another user's machine and login;
- a forged or misrouted answer for a job;
- a runaway process or unbounded output;
- use of a subscription login against the provider's terms.

Safeguards (implemented in `packages/agent-cli`, `packages/ai/src/adapters/cli.ts`, `apps/api/src/modules/ai/routes.ts`, `apps/api/src/modules/agent/gateway.ts`):
- **Server target is off by default.** `cli://server/<tool>` runs only when the operator sets `SDD_ENABLE_LOCAL_CLI=true`; otherwise it fails with `LOCAL_CLI_DISABLED`. Enable it only on a local/personal install, never on a shared server.
- **Owner-only machine binding.** A connection targeting `cli://machine/<id>/<tool>` can be created only by the machine's owner (a revoked machine is refused). Only the machine a job was sent to may answer it; other `ai_result` messages are ignored.
- **Structured job, no command line.** The server sends `ai_generate` with the tool name, model, prompt text, timeout and output cap; the runner builds the invocation. No credential is sent.
- **No tools.** Claude Code runs with `--tools ""` and `--strict-mcp-config` (no MCP servers), `--no-session-persistence`; Codex runs `exec --sandbox read-only --ephemeral`. We deliberately do not use bypass/"yolo" permission modes.
- **Throwaway working directory.** Each run gets a fresh temp directory, deleted afterwards.
- **Prompt off the command line.** Prompt on stdin; Claude Code's system prompt from a file in the temp directory; Codex instructions prepended to stdin.
- **Allowlisted environment.** Only variables the CLI needs (PATH, home/profile and temp dirs, locale, proxy/CA settings, and `ANTHROPIC_*`/`CLAUDE_*`/`OPENAI_*`/`CODEX_*`) are passed; server secrets never are.
- **Bounded run.** Hard timeout (default 15 min, max 30) that kills the whole process tree (`taskkill /t /f` on Windows; on Linux/macOS each CLI, task run and verification command starts in its own process group, which is sent SIGKILL — also when the daemon or API exits); 4 MB output cap. The daemon validates the tool id and clamps the timeout to 30 min whatever the server requests, and runs at most 2 AI jobs at once. The gateway adds a 60 s backstop for a lost socket.
- **Output is untrusted.** CLI text goes through the same schema validation as any provider response (§2).
- **Terms of use.** Subscription CLIs use their own login; operators and users must check each provider's terms for automated use. The control plane stores no credential for the CLI.

## 17B. Agent gateway socket identity

Per-socket authentication state is keyed on the underlying Bun socket (`ws.raw`), not on Elysia's per-event wrapper objects. Keying on the wrapper lost the binding between messages and dropped every daemon with `HELLO_TIMEOUT` after 10 s; keying on the socket keeps one identity per connection, so a message is always attributed to the machine that authenticated on that socket.

## 18. MCP/local HTTP security

If any local MCP/HTTP server is introduced:
- bind to `127.0.0.1` by default;
- validate origin where applicable;
- authenticate sensitive requests.

## 19. WebSocket security

- `wss://`;
- short-lived connection token;
- server-side machine authorization;
- heartbeat/timeouts;
- message schema validation;
- maximum frame size;
- rate limits;
- command IDs;
- replay protection.

## 20. High-risk tasks

Tasks classified as:
- authentication;
- authorization;
- secrets;
- migrations;
- destructive data operations;
- infrastructure;
- deployment;
- payment;
- security boundary;

should require stricter review policy.

## 21. Data retention

Define separate retention for:
- planning artifacts;
- audit events;
- execution logs;
- uploaded artifacts.

Do not retain raw model prompts/responses containing sensitive data indefinitely without policy.

## 22. Production readiness checklist

- auth threat model reviewed;
- access-control tests;
- claim concurrency tests;
- MCP auth tests;
- WebSocket authentication tests;
- token revoke tests;
- secret-redaction tests;
- local-CLI runner/adapter tests (disabled server target, target parsing, no tools/stdin prompt, env allowlist + throwaway folder, timeout kill);
- `SDD_ENABLE_LOCAL_CLI` left `false` on shared or public servers;
- backup restore test;
- rate limiting;
- dependency scanning;
- container/non-root hardening where applicable.
