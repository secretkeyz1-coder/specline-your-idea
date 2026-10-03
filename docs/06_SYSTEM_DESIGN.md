# System Design

## 1. Architecture overview

```text
                           ┌──────────────────────────────┐
                           │          Browser             │
                           │ SvelteKit Planning / Review UI │
                           └──────────────┬───────────────┘
                                          │ HTTPS
                                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                        CONTROL PLANE API                           │
│                    Bun + Elysia + TypeScript                      │
│                                                                    │
│  Auth  Project  Discovery  Specs  Stack  Tasks  Runs  Review       │
│  Bugs  Convergence  Agent Registry  AI Gateway  Audit             │
│                                                                    │
│            REST / Realtime / MCP / Agent Gateway                   │
└──────┬───────────────────┬─────────────────────┬──────────────────┘
       │                   │                     │
       ▼                   ▼                     ▼
 PostgreSQL          AI Providers          Object Storage
 source of truth     adapters              optional artifacts
       │
       │
       ├─────────────────────────────┐
       │                             │
       ▼                             ▼
 Remote MCP                    Agent Gateway
 /mcp                          /agent/connect
 Streamable HTTP               outbound WSS
       ▲                             ▲
       │                             │
       │                    ┌────────┴─────────┐
       │                    │ Local sdd-agent │
       │                    │ daemon          │
       │                    └────────┬─────────┘
       │                             │ subprocess
       │                             ▼
       │                         Codex / Claude /
       │                         Kiro / Gemini /
       │                         custom CLI
       │
┌──────┴───────────┐
│ MCP-capable      │
│ local AI agent   │
└──────────────────┘

Alternative manual path:

Website → Copy Prompt → Local coding agent
                         │
                         └── optionally executes sddctl commands
```

The same agent gateway also relays planning-AI jobs to a machine whose `LOCAL_CLI` provider connection targets it (Claude Code or Codex used as a text model, §6A). Planning AI can therefore run on the user's machine without an inbound port or a stored API key.

## 2. Architectural style

Use a **modular monolith** for MVP.

Reasons:
- workflows are highly transactional;
- task/spec/run data is strongly related;
- premature microservices would increase operational complexity;
- modules can later be extracted if load/ownership requires it.

Suggested backend modules:

```text
apps/api/src/modules/
  auth/
  workspace/
  project/
  discovery/
  artifact/
  stack/
  design/
  design-system/   # presets, component-library catalog, contrast checks, render, exports
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

Suggested monorepo boundaries:

```text
apps/
  web/        SvelteKit
  api/        Bun + Elysia
  cli/        sddctl
  agent/      optional local daemon
packages/
  db/         Drizzle schema/migrations/query helpers
  contracts/  shared runtime/API/task schemas
  ai/         provider adapters and AI profiles
  agent-cli/  runs a local coding-agent CLI (Claude Code, Codex) as a text
              model; shared by the API (server target) and sdd-agent (machine target)
  mcp/        MCP tool/resource adapters
  auth/       shared auth primitives where safe
  shared/     vendor-neutral utilities
```

## 3. Frontend

Responsibilities:
- project onboarding;
- discovery chat;
- artifact editor/review;
- stack selection;
- optional design-system editor and UI reference (sandboxed previews);
- task graph/board;
- task detail;
- run timeline;
- review;
- bug/convergence views;
- agent connection management.

Frontend should never implement authoritative workflow transitions locally.

Before a plan exists, the web UX is guided/wizard-first: high-level idea → one-question discovery → technology preference → high-level plan. Dense task/run controls appear progressively after planning.

## 4. Backend API

Responsibilities:
- authorization;
- domain validation;
- state transitions;
- persistence;
- artifact revisioning;
- task graph;
- execution leases;
- event ingestion;
- AI orchestration;
- realtime publication;
- MCP exposure;
- CLI/daemon API.

## 5. PostgreSQL + Drizzle

Use PostgreSQL as the primary data store and Drizzle ORM/Drizzle Kit as the TypeScript schema, query and migration layer. The default Bun path uses the Drizzle Bun SQL driver unless a deployment constraint requires another PostgreSQL driver.

Reasons:
- transactional claim/lease behavior;
- graph edges can be represented relationally;
- JSONB useful for evolving AI metadata;
- mature concurrency primitives;
- audit/event tables;
- no separate queue is required for MVP.

Use a background-worker table with `FOR UPDATE SKIP LOCKED`-style job acquisition or equivalent transactional mechanism for internal async jobs.

A dedicated queue system can be introduced later.

## 6. AI gateway

The backend should expose an internal provider-neutral interface:

```ts
export interface PlannerModel {
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResponse<T>>;
  generateText(request: TextRequest): Promise<TextResponse>;
}
```

The AI gateway separates:

```text
Provider Connection → AI Profile → AI Role Binding → Generation Run
```

Provider adapters:
- OpenAI;
- Anthropic;
- Gemini;
- OpenAI-compatible custom;
- generic custom HTTP adapter where schema can be mapped safely;
- `LOCAL_CLI` — a locally installed coding-agent CLI (Claude Code, Codex) used as a text model (§6A).

The role resolver selects the effective AI Profile for Discovery, Specification, Architecture, Task Decomposition, Review or Convergence using system/workspace defaults and project overrides.

Every model call creates an `ai_generation_run` record so artifact lineage can identify the effective profile/provider/model and result status.

Generic HTTP mapping is declarative only; it may not evaluate arbitrary code. Custom endpoints pass the egress/SSRF policy before invocation.

AI output must be validated against application schemas before persistence.

### Timeout model

- HTTP providers go through `guardedFetch` (`packages/ai/src/ssrf.ts`). The connection's `timeoutMs` is an **idle** limit — the wait for response headers and every gap between streamed chunks. A **total** cap of `timeoutMs × 4` ends a stream that never finishes. Long streamed generations are therefore not cut at `timeoutMs`.
- Default connection timeout: 240 s for API providers; 15 min total for `LOCAL_CLI` (a CLI answers only when done, so its limit covers the whole run); maximum 30 min.
- Transport: the API lifts Bun's idle timeout for AI generate **and** refine endpoints (`AI_GENERATION_PATH`, `apps/api/src/index.ts`); the web server sends those POSTs over `node:http`, avoiding the 300 s header timeout of fetch/undici.

## 6A. Local CLI provider path

A `LOCAL_CLI` provider connection stores no credential. Its `base_url` is a target, not a URL that is fetched:

```text
cli://server/claude                          run on the API host (operator SYSTEM connection only)
cli://machine/<machine-uuid>/<claude|codex>  run on a connected machine via sdd-agent
```

```text
Role resolver → AI Profile (model: "default" | CLI alias, e.g. sonnet/opus/haiku)
   → LOCAL_CLI adapter (packages/ai/src/adapters/cli.ts)
        ├─ server target  → only if SDD_ENABLE_LOCAL_CLI=true → @sdd/agent-cli runCli()
        └─ machine target → agent gateway runAiOnMachine()
                              ── WSS ──► sdd-agent: ai_generate {job_id, tool, model, system,
                                                     prompt, timeout_ms, max_output_bytes}
                                           → @sdd/agent-cli runCli() (max 2 jobs at once)
                              ◄── WSS ── ai_result {job_id, ok, text, input_tokens,
                                          output_tokens, cost_usd, duration_ms
                                          | error_code, error_message}
```

- The job carries a tool name and prompt text, never a command line or credential; the runner builds the invocation. After `hello_ok` the daemon reports `ai_capabilities {ai_cli: [...]}` (installed, version, signed in), which `GET /api/v1/ai/cli` returns to the settings UI together with server availability.
- Only the machine the job was sent to may answer it; the gateway rejects the job with `MACHINE_OFFLINE` if the machine is not connected and times out at `timeout_ms + 60 s` if the socket is lost.
- Only the machine's owner may create a connection targeting it.
- A server target runs as the API process, so only an operator may create or re-point one, always as a SYSTEM connection, and only for Claude Code (`--tools ""`). Codex is refused on the server: `--sandbox read-only` limits writes, not reads, so it could read the host's secrets. The resolver and the connection test refuse older rows that break this rule.
- `@sdd/agent-cli` runs each prompt locked down: fresh temp directory (deleted afterwards), no tools, prompt on stdin, system prompt from a file (Claude Code) or prepended to stdin (Codex), allowlisted environment, hard timeout killing the process tree, 4 MB output cap. See `13_SECURITY.md` §17A. Claude Code runs with `--tools "" --strict-mcp-config`; Codex, which has no equivalent flags, with `--ignore-user-config` (skips `config.toml` and so the user's MCP servers; the login in `CODEX_HOME` still applies — an override such as `-c mcp_servers={}` would be deep-merged and remove nothing) and `-c features.plugins=false -c features.apps=false -c features.shell_tool=false`. Model ids are validated (`^[A-Za-z0-9._:/-]{1,100}$`, no leading `-`) on profile save and before spawning.
- A generation run's final status update applies only while the row is still `RUNNING`. The startup sweep marks runs `INTERRUPTED` only after `2 × 30 min × 4` (two calls per structured run at the maximum connection timeout and the streaming cap), so it cannot close a run that may still be live.
- CLI output then passes the same schema validation as any provider output.

## 7. Planning engine

Planning is stateful at application level.

The engine stores:
- current discovery coverage;
- questions;
- answers;
- facts;
- assumptions;
- contradictions;
- readiness.

Do not depend on LLM conversation memory as the only state.

## 8. Artifact engine

Artifact types (`ArtifactType` in `packages/contracts/src/enums.ts`):
- discovery;
- requirements;
- stack;
- design;
- data model;
- contracts (`api_contract`);
- UI reference (`ux`) — optional;
- design system (`design_system`) — optional;
- UAT;
- task plan;
- convergence report.

Each artifact has revisions.

Approved revisions are immutable.

Only an artifact's current draft (its newest revision) can be approved; approval locks the artifact and the revision, supersedes the previous baseline and every other open draft, and commits the project's active-revision pointer, lifecycle move and audit event in the same transaction.

Staleness propagates along dependencies: a stack change marks the design system stale; a design-system change marks the UI reference stale only when it was drawn `styled`.

### Design system

Module `apps/api/src/modules/design-system/`. A `design_system` revision holds a `DesignSystemSpec` (`packages/contracts/src/design-system.ts`): preset id, name, summary, light and dark palettes of 13 colour roles, font stacks, radius, density, depth, border width, component library and guidance markdown.

- `presets.ts` — 14 generic presets (adapted from nexu-io/open-design, Apache-2.0), each light + dark; no brand-named systems.
- `libraries.ts` — component-library catalog (shadcn/ui and its Svelte/Vue ports, daisyUI, Bootstrap 5.3, Material UI/Material 3, Ant Design v6, Flowbite, Pico CSS, none), ranked deterministically against the locked stack.
- `color.ts` — WCAG contrast checks, 12 pairs per mode; a draft with a failing pair is refused.
- `render.ts` — tokens CSS (`--ds-*`), the `ds-*` mockup kit classes and preview HTML; self-contained, no external fonts/scripts/images.
- `exports.ts` — the files `sddctl ui pull` writes to `docs/design-system/` (agent guide `DESIGN.md`, `tokens.css`, W3C DTCG `design-tokens.json`, Tailwind v4 `tailwind-theme.css`, the library's theme file, light/dark previews).

Task generation and the execution (master) prompt include the approved design system.

### UI reference

A `ux` revision holds the screen plan (each screen with a layout recipe `screen_type` and its planned overlays) and per-screen HTML. The model writes only the page content inside `<main>`; the platform frames it (`planning/ux-shell.ts`) with the stylesheet and one shared app shell in the shadcn/ui application pattern — a sidebar with the workspace, icon navigation of all screens (settings screens at its foot) and the signed-in user; a header with the sidebar trigger, breadcrumb, search and notifications; a mobile menu — so every screen has the same navigation and collapses on a phone; adding or removing a screen re-frames the others. Icons are Lucide: the model writes `<i data-icon="name">` and the platform draws inline SVG (`planning/ux-icons.ts`); content shown back to the model is collapsed to placeholders. `GET …/ux` rebuilds each framed screen's frame from its stored content, so shell and kit changes reach screens drawn before them. Fidelity is `neutral` (the same kit with a greyscale wireframe spec) or `styled` (the approved design system and its component-library skin), and a styled revision records `design_system_version`. Overlays (dialog, sheet, confirmation) are drawn as open frames after the main view, never as inline forms. Screen count is either the AI's recommendation with a rationale or a person's requested count (1–12, never exceeded); screens can be added to or removed from a draft (the last one cannot be removed). Every drawing passes a deterministic lint (`planning/ux-lint.ts`); P0 findings get one repair turn and all findings are stored on the screen as `lint`.

## 9. Task graph engine

The task graph is a DAG.

Functions:
- add dependency;
- remove dependency;
- cycle detection;
- readiness calculation;
- downstream invalidation;
- parallel candidate detection.

Task readiness should be derived from:
- task status;
- dependency completion;
- artifact freshness;
- approval policy;
- lint result.

## 10. Execution engine

### Claim transaction

Pseudo logic:

```text
BEGIN

SELECT task FOR UPDATE

assert task.status == READY
assert no active lease

create lease
create run
transition READY → CLAIMED

COMMIT
```

A unique partial constraint or equivalent defensive rule should prevent two active leases.

### Lease

Fields:
- lease ID;
- task ID;
- run ID;
- executor ID;
- issued_at;
- expires_at;
- last_heartbeat_at;
- status.

### Heartbeat

Connected clients periodically refresh liveness.

Lease expiry does not automatically mean code execution stopped. It means the server no longer trusts ownership.

Policy options:
- `NEEDS_ATTENTION`;
- `BLOCKED`;
- reclaim after grace period.

## 11. Event model

Task/workflow activity uses append-only `task_events`; events may optionally link to a run:

```text
task_claimed
run_started
progress_reported
file_change_reported
validation_started
test_reported
validation_completed
run_blocked
review_requested
review_approved
changes_requested
task_completed
```

Current state remains materialized in task/run tables for fast reads. Planning/review transitions without an active run still appear in the same task timeline.

## 12. Realtime

Use WebSocket for:
- local daemon command/control;
- bidirectional cancellation/status;
- execution log/event streaming.

Browser realtime can use:
- WebSocket;
- or SSE for simpler server → browser updates.

For MVP, it is acceptable to use one backend realtime implementation, but domain writes still go through command services.

## 13. MCP interface

MCP is an adapter over domain services.

```text
MCP tool
   ↓
authorization
   ↓
application command/query
   ↓
same transition validation
   ↓
database
```

Do not implement separate MCP-only business logic.

## 14. CLI architecture

`sddctl` is a single local binary.

```text
CLI
├── auth
├── config
├── project-link
├── task commands
├── run commands
├── evidence/reporting
└── JSON formatter
```

Local config:

```text
~/.config/sddctl/config.json
```

Repository link:

```text
.sdd/local.json
```

`local.json` must not store bearer secrets and should be gitignored by default.

## 15. Local daemon architecture

`sdd-agent`:
- reuses CLI auth/config packages;
- outbound WebSocket connection;
- machine identity;
- adapter registry;
- subprocess manager;
- log parser;
- cancellation;
- heartbeat.

Adapter example:

```text
AgentAdapter
  Detect()
  BuildCommand(taskContext)
  Start()
  Stream()
  Cancel()
  CollectResult()
```

The daemon also serves AI generation jobs for `LOCAL_CLI` connections that target its machine (`ai_generate` → `ai_result`, at most 2 concurrently), using the same `@sdd/agent-cli` runner as the server (§6A). `sdd-agent status` lists the detected AI CLIs.

Gateway socket identity: per-socket state (machine binding, hello timer) is keyed on the underlying Bun socket (`ws.raw`), not on Elysia's per-event wrapper object. Keying on the wrapper made every daemon look unauthenticated and dropped it with `HELLO_TIMEOUT` ten seconds after connecting.

## 16. Manual prompt execution

Standalone prompt must remain a first-class path.

After external/manual execution, user can:
- manually create an execution record;
- optionally attach commit hash;
- paste test result;
- submit for review.

This ensures portability even if a coding agent cannot use MCP or `sddctl`.

## 17. Review architecture

Review policy is resolved from:
- task risk;
- project policy;
- task type.

Example:
- low-risk docs task: auto-approve allowed;
- code task: AI review + optional human;
- auth/migration/security: human required.

## 18. Convergence engine

Inputs:
- approved requirements;
- acceptance criteria;
- done tasks, each with the evidence of its approved run (the run its latest APPROVED/WAIVED review decided on): summary, commit, files changed and the latest result per verification command;
- review decisions;
- open bugs and the approved UI reference screens in scope;
- later: a repository snapshot/diff supplied by the local agent. The approved design is not sent: without the code it adds no evidence.

Output:
- covered;
- partial;
- missing;
- contradiction;
- non-blocking observation.

Blocking findings generate new tasks or require explicit waiver.

## 19. Scalability path

MVP:
- one Bun/Elysia API deployment;
- PostgreSQL;
- SvelteKit frontend;
- optional object storage.

Scale later:
- separate AI worker;
- separate agent gateway;
- Redis/NATS/Kafka only if needed;
- object storage for large logs;
- read replicas;
- per-workspace rate limits.

## 20. Failure handling

### AI generation failure
Persist generation attempt and allow retry; never lose user answers.

### CLI disconnect
Task remains in known state; lease/heartbeat policy determines attention state.

### Duplicate event retry
Use idempotency key.

### Daemon process crash
Report disconnected; task not automatically marked done/failed without evidence.

### Backend restart
No execution state should rely only on process memory.

## 21. Trust boundaries

```text
Browser          untrusted input
Local CLI        authenticated but still validated
Local daemon     authenticated executor, scoped
AI model         untrusted generator (incl. local CLI output)
Local AI CLI     runs with the host's CLI login; locked down, no tools
MCP client       authenticated client, scoped
Repository       external mutable state
Database         authoritative application state
```

All AI-generated structured data must pass deterministic validation.
