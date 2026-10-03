# Product Requirements Document — Agentic SDD Control Plane

## 1. Overview

The product is a web-based planning and agent execution control plane for Spec-Driven Development.

It starts from a **high-level idea**, actively interviews the user, creates a requirements baseline, facilitates tech-stack selection, creates technical design artifacts, decomposes work into atomic tasks, and hands those tasks to local AI coding agents.

## 2. End-to-end user journey

```text
Create Project
   ↓
Describe High-Level Idea
   ↓
AI Discovery Session
   ↓
Adaptive Questions
   ↓
Discovery Readiness Gate
   ↓
Requirements Baseline
   ↓
Choose Tech-Stack Mode
   ├── Use AI recommendation
   └── Choose manually
        └── optional per-layer AI suggestion
   ↓
Lock Stack Baseline
   ↓
Generate Technical Design
   ↓
Review / Refine Design
   ↓
Generate Atomic Task Graph
   ↓
Task Lint / Dependency Validation
   ↓
Approve Execution Plan
   ↓
READY Queue
   ↓
Copy Prompt OR Connected Local Agent
   ↓
Local Execution
   ↓
Validation
   ↓
Review
   ├── Approve
   ├── Request changes
   └── Create bug
   ↓
Convergence Check
   ↓
Project / Feature Complete
```

## 3. Personas

### Builder
Creates projects, answers discovery questions, selects technology, reviews tasks, runs a local agent.

### Reviewer
Reviews specifications and implementation results.

### Workspace Admin
Controls member access, agent tokens, workspace settings.

### Local AI Agent
Receives work order, executes within repository, reports progress and evidence.

## 4. Project creation

The user creates:
- project name;
- optional repository URL;
- high-level idea;
- optional constraints.

Examples of high-level ideas:

> Build a web application to manage fiber optic field work and evidence.

> Create an RT/RW Net billing application integrated with MikroTik PPPoE.

The form should not force detailed requirements before the discovery agent starts.

## 5. Discovery agent

### Objective

Convert incomplete intent into a sufficiently explicit product definition.

### Behavior

The agent:
1. reads the high-level idea;
2. detects project type;
3. identifies missing decision areas;
4. asks one high-impact question at a time by default;
5. updates an evolving discovery brief after every answer;
6. exposes unresolved assumptions;
7. determines whether blocking ambiguity remains.

### Question categories

Depending on project type:
- target users;
- primary problem;
- core workflows;
- roles/permissions;
- data/entities;
- integrations;
- platform/device;
- offline needs;
- notification needs;
- import/export;
- security/compliance;
- scale;
- latency/performance;
- deployment constraints;
- existing systems;
- must-have vs later;
- acceptance expectations.

### Question UX

Avoid a 30-question form and avoid showing a long static questionnaire by default.

Default interaction:
- one primary high-impact question per step;
- structured answer chips/options where useful;
- free-text fallback;
- "I don't know — recommend" option;
- "Skip / use assumption" option;
- small "already understood" facts summary so the user can correct AI understanding.

The discovery engine may internally rank multiple candidate questions, but the normal UI surfaces one primary question at a time.

### Readiness

The system must not rely only on a fake percentage.

Use:
- blocking questions;
- required discovery categories;
- documented assumptions;
- unresolved contradictions.

Readiness status:
- `DISCOVERY_INCOMPLETE`;
- `READY_WITH_ASSUMPTIONS`;
- `DISCOVERY_READY`.

The user may explicitly continue with assumptions.

## 6. Requirements baseline

After discovery:
- product goal;
- actors;
- user journeys;
- functional requirements;
- acceptance criteria;
- edge cases;
- non-functional requirements;
- exclusions;
- assumptions.

The user can:
- edit;
- ask AI to refine;
- approve baseline.

Approval creates a version such as `REQ-v1`.

## 7. Tech-stack selection

Tech stack occurs **after discovery/requirements readiness**.

### Mode 1 — Use AI recommendation

AI proposes viable stack options and recommends one.

Each recommendation should cover the layers that materially affect the design, such as:
- frontend;
- backend/runtime;
- database/ORM;
- realtime/background work when required;
- storage/auth/testing/deployment when required.

The recommendation must explain tradeoffs and why it fits the approved requirements.

### Mode 2 — Choose manually

The user selects or types preferred technologies.

The AI validates compatibility and flags contradictions without silently replacing a user choice. For an unresolved individual layer, the user may ask AI for a suggestion while keeping already selected layers locked.

Example locked baseline for this platform:

```text
Frontend: SvelteKit + TypeScript
Backend: Bun + TypeScript + Elysia
Database: PostgreSQL + Drizzle ORM
Deployment: Docker Compose / VPS
```

### Stack lock

Approved choices form `STACK-v1`.

Changing a locked stack later must:
- create a new revision;
- run impact analysis;
- mark affected design/tasks stale.

## 8. Technical design generation

The platform generates:
- architecture;
- component boundaries;
- data model;
- API contracts;
- state machines;
- background workflows;
- security model;
- test strategy;
- deployment assumptions;
- optional UI/UX plan.

Design can be refined through AI chat.

Approval creates a design baseline.

## 9. Atomic task generation

The task generator derives tasks from the approved:
- requirements;
- acceptance criteria;
- stack;
- design.

Tasks are grouped by:
- feature/user story;
- technical dependency;
- implementation phase.

Each task must pass Task Lint before entering `READY`.

## 10. Task work order

Each task includes:
- ID;
- title;
- objective;
- parent requirement/AC;
- scope;
- allowed/expected paths;
- dependencies;
- constraints;
- acceptance criteria;
- verification commands;
- deliverables;
- stop conditions;
- risk/hardness;
- review policy.

## 11. Prompt generation

Two generated prompts:

### Standalone prompt

Contains enough context to execute without a connected platform.

### Connected prompt

Shorter. Instructs agent to load the latest task from:
- `sddctl`; or
- configured MCP server.

The prompt must never embed secrets.

## 12. Local CLI

CLI binary name: `sddctl`.

Core flows:

```bash
sddctl login
sddctl project link PRJ-123
sddctl task show TASK-084
sddctl task claim TASK-084
sddctl task start TASK-084
sddctl run progress --message "..."
sddctl run test --command "bun test ..." --status passed
sddctl task submit TASK-084
sddctl task block TASK-084
```

## 13. Remote MCP

The platform exposes MCP tools for compatible AI agents.

Minimum tools:
- `project_get_context`
- `task_get`
- `task_list_ready`
- `task_claim`
- `task_start`
- `task_report_progress`
- `task_report_test`
- `task_block`
- `task_request_review`
- `bug_report`

Write tools must require explicit scopes.

## 14. Connected daemon

Optional `sdd-agent` process:
- logs in;
- registers local machine/capabilities;
- maintains outbound secure connection;
- receives an approved execution request;
- spawns configured local coding agent;
- streams run events;
- supports cancel;
- reports process exit.

The website must not execute arbitrary shell strings directly. It sends a structured task execution request.

## 15. Task board

Default columns:
- Ready
- Claimed
- Running
- Validating
- Review
- Rework
- Blocked
- Done

Draft planning tasks may be shown separately.

## 16. Review

Reviewer sees:
- task objective;
- acceptance criteria;
- run timeline;
- files changed;
- test evidence;
- diff/commit reference;
- agent completion summary;
- warnings.

Actions:
- Approve;
- Request changes;
- Create defect;
- Cancel.

## 17. Bugs

Bugs are independent entities.

Bug fields:
- current behavior;
- expected behavior;
- unchanged behavior;
- reproduction;
- severity;
- affected task/run;
- evidence.

Bug workflow is separate from task workflow.

## 18. Convergence

At feature end, an AI reviewer compares:
- approved requirements;
- acceptance criteria;
- approved design;
- completed tasks;
- current implementation evidence.

If gaps are detected, it proposes new traceable tasks.

Feature status remains incomplete until blocking gaps are resolved.

## 19. AI provider configuration

Planning/review AI is **bring-your-own-provider** and provider-abstracted.

The domain separates three concepts:

### Provider Connection

Stores how the control plane reaches a provider:
- provider type;
- base URL;
- encrypted credential reference;
- timeout;
- non-secret and secret headers;
- capability metadata;
- safe custom request/response mapping where applicable.

Supported connection types:
- OpenAI;
- Anthropic;
- Gemini;
- OpenAI-compatible endpoint;
- generic custom HTTP endpoint.

### AI Profile

Stores model behavior independently from the connection:
- provider connection ID;
- model identifier;
- temperature/reasoning/structured-output parameters where supported;
- required capabilities;
- profile name/status.

### AI Role Binding

Selects an AI profile for a planning role. Minimum roles:
- Discovery;
- Specification;
- Architecture;
- Task Decomposition;
- Review;
- Convergence.

Resolution precedence:

```text
system default
  → workspace default
  → project override
```

A single project may therefore use different providers/models for different roles.

### Generic custom HTTP

Custom HTTP adapters use **declarative mapping**, not arbitrary executable code. Configuration may define:
- HTTP method and base endpoint;
- auth scheme and secret headers;
- request JSON template using an allowlisted variable set;
- response text/structured-data extraction path;
- timeout/response-size limits;
- declared capabilities.

Custom endpoints must pass the SSRF/egress policy in `13_SECURITY.md`.

### Generation attribution

Every AI generation attempt records the resolved profile, provider, model, timing, result status, and artifact linkage. Raw prompts/responses are not retained indefinitely by default.

Provider credentials must be encrypted at rest and never embedded in generated prompts/exports.

## 20. Open-source/self-host behavior

The core project is open-source and must remain usable without a commercial tier or mandatory hosted AI provider. A self-hosted deployment may use the user's own provider credentials.

The reference UI contains no pricing-tier or upsell state.

## 21. Permissions

Minimum roles:
- Owner
- Admin
- Planner
- Executor
- Reviewer
- Viewer

Important capability separation:
- creating task != executing task;
- executing task != approving task;
- admin may override only with audit event.

## 22. Notifications

MVP:
- in-app;
- browser optional.

Trigger examples:
- task blocked;
- task requests review;
- local agent disconnected during active run;
- task lease expired;
- convergence found gap.

## 23. Audit

Store:
- actor;
- action;
- target;
- before/after metadata;
- time;
- source (web/CLI/MCP/daemon/system).

## 24. Acceptance definition for MVP

MVP passes when a real repository can complete this sequence:

```text
idea
→ discovery
→ requirements
→ stack
→ design
→ tasks
→ local linked repo
→ task start
→ local code change
→ test evidence
→ review
→ done
→ convergence
```

without manual database intervention.
