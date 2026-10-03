# Agentic SDD Control Plane — Documentation Pack

> **Status reviewed 2026-10-03:** Original 00–27 specification/planning pack, not current implementation or test certification. Start at [README.md](README.md). Current visuals: [DESIGN.md](../DESIGN.md) and `apps/web/src/app.css`; prototype is historical intent. Historical aggregate/checksum and owner-only evidence are archived locally, not current guidance.

**Working title:** Agentic SDD Control Plane  
**Purpose:** A web-based planning and execution control plane that turns a high-level software idea into clarified requirements, a chosen technical stack, technical design, atomic tasks, and executable work orders for local AI coding agents.

## Core product thesis

The product is not a Kanban board with AI attached. It is a **specification-to-execution system**:

```text
High-Level Idea
      ↓
AI Discovery / Focused Clarifying Questions
      ↓
Requirements & Scope Baseline
      ↓
Tech Stack Decision (AI recommendation or manual)
      ↓
Technical Design
      ↓
Atomic Task Graph
      ↓
Agent Work Order
      ↓
Local Agent Execution
      ↓
Validation
      ↓
Review / Rework / Bug
      ↓
Convergence
      ↓
Feature / Project Complete
```

The web application is the **source of truth** for planning artifacts, task state, execution history, reviews, and bugs.

The local machine is the **execution environment**. A lightweight CLI (`sddctl`) connects the repository and the local AI agent to the website.

## Connectivity modes

### Mode A — Portable Prompt

The user clicks **Copy Agent Prompt** and pastes it into any coding agent.

Suitable for:
- Codex CLI
- Claude Code
- Kiro CLI
- Gemini CLI
- other shell-capable coding agents

No permanent connection is required. The prompt can be generated as a complete standalone work order.

### Mode B — Connected CLI

The local repository is linked with:

```bash
sddctl login
sddctl project link <project-key>
```

The AI agent can execute `sddctl` commands to:
- fetch task context;
- claim/start a task;
- report progress;
- report tests;
- block a task;
- request review;
- report bugs.

### Mode C — Remote MCP

The web platform exposes an MCP endpoint. MCP-capable local agents can call planning/task tools directly without learning proprietary HTTP endpoints.

### Mode D — Local Agent Daemon

An optional daemon (`sdd-agent`) maintains an outbound secure connection to the website. This allows the website to dispatch an approved task to a local agent without exposing an inbound port on the user's laptop.

## Recommended architecture decision

**Primary execution transport:** HTTPS REST + outbound WebSocket through `sddctl` / `sdd-agent`.

**Interoperability layer:** MCP Streamable HTTP.

Rationale:
- CLI/daemon gives deterministic process control, local repository discovery, subprocess execution, logging, heartbeat, lease handling, and cancellation.
- MCP is excellent for standardized agent tool access and context retrieval.
- MCP alone is not a full local process supervisor and should not be the only execution-control mechanism.

## Documentation index

| File | Purpose |
|---|---|
| `01_PRODUCT_VISION.md` | Product goals, users, boundaries, success criteria |
| `02_CONSTITUTION.md` | Non-negotiable engineering/product rules |
| `03_PRD.md` | Full product requirements document |
| `04_PLANNING_WORKFLOW.md` | Idea → questions → stack → design → tasks |
| `05_REQUIREMENTS.md` | Functional and non-functional requirements |
| `06_SYSTEM_DESIGN.md` | System architecture and component design |
| `07_TECH_STACK.md` | Recommended implementation stack |
| `08_DATA_MODEL.md` | Core entities, relationships, state data |
| `09_API_CONTRACT.md` | REST and realtime API contract |
| `10_MCP_CLI_PROTOCOL.md` | MCP tools, CLI commands, local bridge protocol |
| `11_TASK_SPECIFICATION.md` | Atomic task schema and task lint rules |
| `12_AGENT_STATE_MACHINE.md` | Task/run/review/bug state machines |
| `13_SECURITY.md` | Security model and trust boundaries |
| `14_UI_UX_SPEC.md` | Screens, navigation, interaction model |
| `15_IMPLEMENTATION_TASKS.md` | Atomic implementation plan for this platform |
| `16_AGENTS.md` | Instructions for coding agents building this platform |
| `17_UAT.md` | End-to-end user acceptance tests |
| `18_DEPLOYMENT_OPERATIONS.md` | Deployment, observability, backups, operations |
| `19_ROADMAP.md` | MVP → connected execution → autonomous orchestration |
| `20_ADR.md` | Architecture decisions and rationale |
| `21_PROMPT_TEMPLATES.md` | Discovery, planning, task and review prompt templates |
| `22_BUG_CONVERGENCE.md` | Bug lifecycle and specification convergence |
| `23_SOURCES.md` | Standards and implementation references |
| `25_FRONTEND_DESIGN_SPEC.md` | SvelteKit visual/component implementation contract |
| `26_DOCUMENTATION_AUDIT.md` | Consistency audit and corrections |
| `27_OPEN_DECISIONS.md` | Explicit unresolved owner decisions and implementation gates |
| `32_UI_TEMPLATE_GALLERY.md` | Gallery implementation note |
| `SCREENS.md` | 18-screen frontend UI catalog, data contracts, routes & mutation actions |
| `workflow-schema.html` | Visual workflow diagram: topology + 1-prompt autonomous execution loop |
| `frontend_reference.html` | Interactive single-file frontend reference prototype |

## Source-of-truth principle

Markdown is an export and interoperability format. Operational state must remain in the database.

Therefore:

```text
Database
  = authoritative runtime state

Versioned planning artifacts
  = authoritative specification revisions

Markdown export
  = portable representation

Git commit / diff
  = implementation evidence
```

Do not use `[x]` inside `tasks.md` as the sole source of task completion.

## External standards informing this design

This design intentionally borrows proven patterns from:
- GitHub Spec Kit: constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge.
- Kiro Specs: requirements → design → tasks with clarification and execution.
- AGENTS.md: persistent repository instructions.
- Model Context Protocol (MCP): interoperable tool/context interface for AI hosts.

The platform does **not** clone any one workflow. It combines these concepts into a vendor-neutral execution control plane.


## Locked implementation stack

- Frontend: SvelteKit + Svelte 5 + TypeScript + Tailwind CSS
- Backend: Bun + Elysia + TypeScript
- Database: PostgreSQL + Drizzle ORM/Drizzle Kit
- CLI/daemon: Bun + TypeScript
- MCP: TypeScript MCP SDK over shared domain services

The package also contains `25_FRONTEND_DESIGN_SPEC.md` and `frontend_reference.html` as historical visual planning references; current implementation follows `../DESIGN.md` and `apps/web/src/app.css`. Legacy prototype variants are intentionally excluded from the final ZIP.

## Frontend reference update

`frontend_reference.html` uses an original open-source visual direction. External screenshots are UX inspiration only; the implementation must not pixel-copy their branding or layout. The open-source core UI has no monetization-tier or upsell controls.


## AI provider model

The planning/review AI layer follows:

```text
Provider Connection
  → AI Profile (model + parameters)
  → Role Binding (Discovery / Specification / Architecture / Task Decomposition / Review / Convergence)
  → AI Generation Run
```

Users may bring credentials for supported providers, OpenAI-compatible endpoints, or a safe declarative custom HTTP adapter.

## Open-source release note

Original project code is self-hostable and licensed under [Apache-2.0](../LICENSE), explicitly approved by the owner on 2026-10-03. Third-party material retains its own licenses. The first public package excludes Preline, Tabler and TailAdmin pending nested-vendor review, and generated UI-template previews; local copies remain untouched. Other asset/provenance checks still apply; see [third-party notices](../THIRD_PARTY_NOTICES.md).
