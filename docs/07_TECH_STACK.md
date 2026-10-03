# Technology Stack

> **Status reviewed 2026-10-03:** Original specification/research pack, not current implementation or verification certification. [Navigation](README.md). Code/configuration takes precedence; recorded audits/open decisions are not automatically current.

## 1. Locked baseline for this platform

The Agentic SDD Control Plane uses a **TypeScript-first monorepo** so the web UI, API, shared contracts, MCP layer, CLI and optional local agent daemon can share domain types and validation logic.

## 2. Frontend

- **SvelteKit**
- **Svelte 5**
- **TypeScript**
- **Tailwind CSS v4**
- **Themes / daisyUI 5:** custom `forest` (dark, default) / `forest-light`, built-in themes disabled (`themes: false`). Sidebar choice stores `sdd-theme`; `app.html` maps legacy names before first paint.
- **Components:** daisyUI classes, native `<dialog>` wrapper, popover API and native selects; no current bits-ui behavior layer.
- **Lucide Svelte** for icons
- Geist Variable / Fira Code Variable fonts via `@fontsource-variable/*`
- SvelteKit server/load/form primitives where appropriate
- `svelte-check` for framework-aware type checking
- Playwright for end-to-end testing and visual QA (`apps/web/scripts/qa-shots.ts`); axe accessibility audits during QA in light and dark themes

Optional packages should be added only when a concrete UI requirement justifies them. Prefer native Svelte/SvelteKit state and form capabilities over adding a large client state framework by default.

Theme tokens live in `apps/web/src/app.css`: the `@plugin "daisyui"` block plus an `@theme inline` mapping of the app's token names onto daisyUI variables. Status text colours are mixed with `base-content` so they pass WCAG AA in both themes; daisyUI's raw `success`/`warning`/`info` are not used as text colours. `DESIGN.md` at the repository root records the result.

### Why SvelteKit

The UI is a stateful authenticated application with:
- idea/discovery conversations;
- long-form specification artifacts;
- stack selection;
- task graph and Kanban views;
- realtime agent execution;
- review flows;
- settings and provider configuration.

SvelteKit gives routing, layouts, SSR where useful, server hooks and a mature application structure while keeping client bundles and component code relatively lean.

## 3. Backend runtime and API

- **Bun** runtime
- **TypeScript**
- **Elysia** as the HTTP API framework
- Elysia OpenAPI plugin for API documentation/contract visibility
- Bun/Elysia WebSocket support for agent gateway connections
- SSE for simple browser server-to-client event streams

The API remains a **modular monolith** for MVP.

Suggested modules:

```text
apps/api/src/modules/
  auth/
  workspace/
  project/
  discovery/
  artifact/
  stack/
  design/
  design-system/
  task/
  execution/
  review/
  bug/
  convergence/
  agent/
  mcp/
  ai/
  audit/
  notification/
```

### Why Bun + TypeScript

The same language can be used for:
- API domain services;
- shared task contracts;
- AI provider adapters;
- MCP tools;
- `sddctl`;
- `sdd-agent`;
- frontend-facing types.

This reduces contract duplication between server and local execution tooling.

## 4. Database

- **PostgreSQL**
- **Drizzle ORM**
- **Drizzle Kit** migrations
- Prefer `drizzle-orm/bun-sql` / Bun SQL for the primary Bun deployment unless a production constraint requires another PostgreSQL driver.

Use relational tables for authoritative domain state. Use JSONB for flexible metadata such as provider-specific settings and event payloads, not as a replacement for relational modeling.

Database package:

```text
packages/db/
  src/
    schema/
    queries/
    index.ts
  drizzle/
  drizzle.config.ts
```

All schema changes require generated/reviewed migrations.

## 5. Monorepo

Use **Bun workspaces** initially. Do not introduce Turborepo/Nx until build scale justifies it.

```text
apps/
  web/          # SvelteKit
  api/          # Bun + Elysia
  cli/          # sddctl
  agent/        # optional sdd-agent daemon
packages/
  db/
  contracts/
  ai/
  agent-cli/    # @sdd/agent-cli — local coding-agent CLI runner (API + sdd-agent)
  mcp/
  auth/
  shared/
  config/
docs/
deploy/
```

Root commands should use `bun run ...` consistently.

## 6. Shared contracts and validation

Create `packages/contracts` for:
- task status and transition schemas;
- task/run events;
- REST request/response contracts;
- MCP tool input/output schemas;
- AI structured-output schemas;
- CLI machine-readable payloads.

Use a single runtime schema approach for boundary validation. Prefer Elysia schemas or a Standard-Schema-compatible validator that can be shared without introducing duplicate definitions.

Database schemas are not a substitute for API/domain validation.

## 7. Internal async jobs

MVP:
- PostgreSQL-backed job table;
- transactional acquisition;
- idempotent handlers.

Examples:
- AI generation attempts;
- artifact rendering;
- convergence analysis;
- notification delivery;
- cleanup.

Introduce Redis/NATS/Kafka only if measured operational needs justify them.

## 8. Realtime

### Browser realtime

Prefer **SSE** for:
- task activity feed;
- run progress;
- review status;
- planning-generation status.

Use **WebSocket** only where bidirectional interaction materially helps.

### Local agent daemon

Use secure **outbound WebSocket (WSS)** from `sdd-agent` to the control plane.

The laptop should not require an inbound public port.

## 9. MCP

Expose a remote MCP endpoint using the official **TypeScript MCP SDK**.

Target:
- Streamable HTTP;
- authenticated/scoped access;
- MCP tool schemas mapped to the same domain command services used by REST/CLI;
- vendor-neutral tool names.

MCP is an adapter, not a second implementation of task business rules.

## 10. CLI and local daemon

Implement both in **TypeScript on Bun**.

Applications:
- `apps/cli` → `sddctl`;
- `apps/agent` → `sdd-agent`.

Development runs directly with Bun. Release builds may use Bun's executable compilation where supported by the targeted OS/architecture, with runtime script distribution as a fallback.

The CLI owns local concerns such as:
- repository linking;
- local credential storage integration;
- machine-readable task context;
- status/report commands.

The daemon additionally owns:
- outbound connection;
- agent adapter detection;
- local process lifecycle;
- stdout/stderr capture;
- heartbeat;
- cancellation;
- AI generation jobs for `LOCAL_CLI` provider connections that target the machine (max 2 concurrently).

`SDDCTL_CONFIG` points both tools at an alternative config file (default `~/.config/sddctl/config.json`).

## 11. AI provider integration

Use a provider-neutral TypeScript adapter layer.

Provider types:
- OpenAI;
- Anthropic;
- Gemini;
- OpenAI-compatible custom endpoint;
- generic custom HTTP endpoint;
- `LOCAL_CLI` — a locally installed coding-agent CLI used as a text model.

### Local coding-agent CLIs

`packages/agent-cli` (`@sdd/agent-cli`) wraps the supported CLIs for the API (server target, only with `SDD_ENABLE_LOCAL_CLI=true`) and `sdd-agent` (machine target):

| CLI | Invocation | Answer | Detection |
|---|---|---|---|
| Claude Code (`claude`) | `claude -p --output-format json --no-session-persistence --tools "" --strict-mcp-config --system-prompt-file <file> [--model m]`, prompt on stdin | JSON `result` (+ usage, cost) | `--version`, `claude auth status` |
| Codex CLI (`codex`) | `codex exec --skip-git-repo-check --sandbox read-only --ephemeral -C <tmp> --output-last-message <file> [-m m] -`, instructions prepended to stdin | last-message file | `--version`, `codex login status` |

Binaries are found on `PATH` or via `SDD_CLAUDE_BIN` / `SDD_CODEX_BIN`. The profile model is `default` (the CLI's own configured model) or a name the CLI accepts (Claude Code aliases `sonnet`, `opus`, `haiku`). The CLI uses its own login — subscription or its own key; the control plane stores no credential for it. Other CLIs (OpenCode, Gemini CLI, …) are not supported yet.

Configuration concept:

```yaml
name: "OpenRouter Personal"
provider_type: "openai-compatible"
base_url: "https://..."
credential_ref: "secret://..."
timeout_seconds: 240   # idle limit; total cap is 4x. LOCAL_CLI: 900 total (max 1800)
headers: {}
capabilities:
  structured_output: true
  tool_calling: true
  vision: false
  streaming: true
```

Provider connection intentionally does **not** own the selected planning model. Model choice belongs to an AI Profile.

### AI profiles

Provider connection and task-role selection are separate concepts.

```text
Provider Connection
  OpenAI Personal
  Anthropic Work
  Gemini
  Custom Gateway

AI Profiles
  Discovery Agent
  Requirements Agent
  Architecture Agent
  Task Decomposer
  Review Agent
  Convergence Agent
```

Profile resolution precedence:

```text
system default
  → workspace default
  → project override
```

A single project may therefore use different providers/models for discovery, planning, review and convergence.

### Generic custom HTTP

For a non-OpenAI-compatible endpoint support controlled mappings for:
- method and URL;
- authentication scheme;
- headers;
- request template;
- response extraction path;
- model/temperature/reasoning fields;
- timeout and maximum response size;
- capability declarations.

Custom endpoints must pass the SSRF/egress security policy defined in `13_SECURITY.md`. Request/response mapping is declarative and must not evaluate arbitrary code. Secret headers are stored as encrypted secret references, not plain JSON config.

## 12. Authentication

### Browser authentication
- secure HTTP-only session cookie;
- server-side session validation;
- workspace/project authorization on every protected operation.

### CLI
Preferred:
- browser/device authorization flow;
- short-lived access token;
- refresh credential stored in OS secure credential storage.

MVP fallback:
- scoped personal access token with expiration and revocation.

### MCP authentication
Use scoped HTTP authorization and resource-bound permissions.

## 13. File/object storage

MVP:
- small Markdown/JSON artifacts may live in PostgreSQL.

Use S3-compatible object storage for:
- large logs;
- uploaded files;
- archived diffs;
- generated bundles.

MinIO is suitable for local/self-hosted development.

## 14. Search

Use PostgreSQL first:
- full-text search;
- trigram extension when needed.

Do not add Elasticsearch/OpenSearch for MVP.

## 15. Testing

### API / domain
- Bun test runner for TypeScript modules where practical;
- PostgreSQL integration tests;
- transition-table tests;
- concurrency tests for task claims/leases;
- authorization and idempotency tests.

### Frontend
- `svelte-check`;
- component tests where valuable;
- Playwright end-to-end.

### CLI / daemon
- command parsing tests;
- fake API server integration tests;
- repository-link tests;
- daemon reconnect/process lifecycle tests.

### MCP testing
- tool schema tests;
- auth tests;
- task_get → claim → start → report → submit integration path.

## 16. Local development

Docker Compose should provide infrastructure only where practical:

```text
postgres
optional-minio
```

Run application processes with Bun during normal development:

```bash
bun install
bun run dev
```

The root `dev` script should start `apps/web` and `apps/api` concurrently.

## 17. Deployment

Recommended MVP:
- SvelteKit web container/process;
- Bun/Elysia API container/process;
- PostgreSQL;
- reverse proxy/load balancer;
- optional S3-compatible object storage.

The API should remain horizontally scalable by keeping authoritative task/run state in PostgreSQL.

## 18. Observability

Use structured JSON logs and correlation IDs.

Track at minimum:
- API latency/error rate;
- AI generation latency/error;
- active local-agent connections;
- agent run duration;
- task transition failures;
- lease expiry/conflicts;
- review turnaround;
- background job latency.

Keep the implementation OpenTelemetry-ready but do not make a full telemetry stack a prerequisite for MVP.

## 19. Deliberately excluded from MVP

Do not introduce by default:
- microservices;
- Kubernetes;
- Redis solely for queues;
- Kafka/NATS;
- Elasticsearch/OpenSearch;
- GraphQL;
- a second backend language.

The default engineering goal is a coherent TypeScript/Bun system that is easy for both humans and coding agents to navigate.

## 20. Open-source distribution

The reference deployment is self-hostable and must not require a commercial control-plane service. Users bring their own planning/review AI credentials.

Before public release, the repository owner must explicitly choose and add an open-source license; this documentation does not assume a license on the user's behalf.
