# Implementation Tasks

This plan is intentionally decomposed into small execution units suitable for AI coding agents.

## Task conventions

Format:

```text
[ID] [P?] [Area] Task
Depends on:
Definition of Done:
```

`[P]` means potentially parallel-safe after dependencies are satisfied. Runtime scheduling must still check file/path overlap.

---

# Phase 0 — Repository and engineering baseline

## T001 — Initialize monorepo structure

**Area:** Repository  
**Depends on:** none

Create:

```text
apps/web
apps/api
apps/cli
apps/agent
packages/db
packages/contracts
packages/ai
packages/mcp
packages/shared
docs
deploy
```

**DoD**
- directories committed;
- root README explains components.

## T002 — Add root development commands

**Area:** Tooling  
**Depends on:** T001

Add repeatable root commands for lint, test, build and local start.

**DoD**
- one command documents how to start local stack;
- one command runs all repository tests.

## T003 [P] — Pin Bun and TypeScript toolchain

**Area:** Tooling  
**Depends on:** T001

**DoD**
- Bun version is pinned/documented;
- TypeScript baseline is shared;
- API/CLI/daemon use the same supported Bun toolchain.

## T004 [P] — Initialize SvelteKit frontend baseline

**Area:** Tooling  
**Depends on:** T001

**DoD**
- `apps/web` is a SvelteKit + TypeScript application;
- SvelteKit dev/build/typecheck commands work under Bun;
- clean `bun install` is reproducible.

## T005 [P] — Add formatting and lint configuration

**Area:** Tooling  
**Depends on:** T003, T004

**DoD**
- TypeScript lint/format command exists;
- `svelte-check` command exists;
- backend and frontend typecheck commands exist.

## T006 — Add CI baseline

**Area:** CI  
**Depends on:** T002, T005

**DoD**
- CI runs backend tests, frontend checks and builds.

## T007 [P] — Create environment configuration package

**Area:** Backend  
**Depends on:** T003

**DoD**
- typed TypeScript configuration;
- env validation;
- secrets never printed.

## T008 [P] — Create structured logging package

**Area:** Backend  
**Depends on:** T003

**DoD**
- JSON logging;
- request/run trace fields supported.

## T009 — Create Docker Compose development stack

**Area:** DevOps  
**Depends on:** T001

**DoD**
- PostgreSQL and application dependencies start locally;
- volumes documented.

## T010 — Add Drizzle ORM and Drizzle Kit migration framework

**Area:** Database  
**Depends on:** T007, T009

**DoD**
- PostgreSQL connection through Drizzle is implemented;
- Drizzle schema/migration directories are documented;
- generate/apply migration commands exist;
- migration test command exists.

---

# Phase 1 — Identity, workspace and project foundation

## T011 — Create users table migration

**Area:** Database  
**Depends on:** T010

**DoD**
- users schema created;
- rollback works.

## T012 — Create workspaces and memberships migration

**Area:** Database  
**Depends on:** T011

**DoD**
- workspace/member role schema exists.

## T013 — Implement user repository

**Area:** Backend  
**Depends on:** T011

**DoD**
- find/create user operations tested.

## T014 — Implement workspace repository

**Area:** Backend  
**Depends on:** T012

**DoD**
- membership reads/writes tested.

## T015 — Implement browser authentication

**Area:** Backend  
**Depends on:** T013, T014  
**Decision gate:** OD-003 in `27_OPEN_DECISIONS.md` must be resolved before implementation.

**DoD**
- authenticated session established;
- logout invalidates session;
- protected endpoint test exists.

## T016 — Implement authorization middleware

**Area:** Backend  
**Depends on:** T015

**DoD**
- workspace role checks server-side;
- unauthorized cross-workspace access tested.

## T017 — Create projects migration

**Area:** Database  
**Depends on:** T012

**DoD**
- project key unique per workspace.

## T018 — Implement project repository

**Area:** Backend  
**Depends on:** T017

**DoD**
- CRUD methods tested.

## T019 — Implement create-project service

**Area:** Backend  
**Depends on:** T016, T018

**DoD**
- high-level idea can be stored without detailed requirements.

## T020 — Expose project REST endpoints

**Area:** API  
**Depends on:** T019

**DoD**
- create/get/list endpoints;
- OpenAPI contract updated.

## T021 [P] — Build workspace switcher UI

**Area:** Frontend  
**Depends on:** T015

**DoD**
- current workspace visible;
- user can switch authorized workspace.

## T022 — Build new-project UI

**Area:** Frontend  
**Depends on:** T020, T021

**DoD**
- simple guided layout;
- name + high-level idea required (name may be proposed/inferred before save if UX chooses);
- create redirects into focused discovery;
- no technology or dense dashboard controls on the first screen.

---

# Phase 2 — AI provider abstraction

## T023 — Define provider-neutral AI interfaces

**Area:** AI  
**Depends on:** T007

**DoD**
- structured and text generation interfaces exist;
- domain code does not import vendor SDK directly.

## T024 — Create AI provider connection schema migration

**Area:** Database  
**Depends on:** T010

**DoD**
- provider type/base URL/connection config fields exist;
- OpenAI-compatible and generic HTTP mapping fields are representable.

## T025 — Implement encrypted secret storage interface

**Area:** Security  
**Depends on:** T007, T024

**DoD**
- plaintext key is not returned in normal reads;
- authenticated encryption uses an instance master key supplied outside PostgreSQL;
- key version metadata supports future rotation;
- encryption/decryption boundary tested.

## T026 — Implement OpenAI-compatible provider adapter

**Area:** AI  
**Depends on:** T023, T025

**DoD**
- custom base URL/model supported;
- timeout supported;
- structured response validation supported.

## T027 [P] — Implement generic custom HTTP provider adapter

**Area:** AI  
**Depends on:** T023, T025

**DoD**
- declarative method/path/header/request-template mapping supported;
- response text/structured extraction path supported;
- no arbitrary code/expression evaluation;
- SSRF/egress validation hook enforced;
- timeout and maximum response size enforced;
- adapter contract tests pass.

## T028 — Implement AI provider capability model

**Area:** AI  
**Depends on:** T023

**DoD**
- structured output/tool/vision/streaming capability flags represented.

## T029 — Implement provider connection API

**Area:** API  
**Depends on:** T024–T028

**DoD**
- create/test/update provider;
- provider connection is separate from AI role/profile assignment;
- secret not returned.

## T030 — Build provider settings UI

**Area:** Frontend  
**Depends on:** T029

**DoD**
- first-party, OpenAI-compatible and generic custom HTTP provider forms exist;
- custom endpoint/API credential/public+secret headers can be configured;
- connection test result displayed;
- saved secrets are never redisplayed in plaintext.

---

## T031 — Create AI profile and role-binding schema migration

**Area:** Database  
**Depends on:** T024

**DoD**
- `ai_profiles` table separates model behavior from provider connection;
- system-scoped operator defaults and workspace-scoped profiles/connections are representable;
- `ai_role_bindings` supports workspace defaults and project overrides;
- one active binding per scope/role enforced;
- migration tests pass.

## T032 — Implement AI profile and role resolver API

**Area:** AI/API  
**Depends on:** T029, T031

**DoD**
- profile CRUD validates provider capabilities;
- effective role profile resolves system/workspace/project precedence;
- project roles include Discovery, Specification, Architecture, Task Decomposition, Review and Convergence;
- credentials are never returned.

## T033 — Build AI profile and role-routing settings UI

**Area:** Frontend  
**Depends on:** T030, T032

**DoD**
- provider connection and AI profile are visibly separate concepts;
- user can assign workspace defaults and project overrides;
- effective provider/model is visible without revealing secrets.

## T034 — Add AI generation-run persistence and artifact attribution

**Area:** AI/Database  
**Depends on:** T023, T024, T031

**DoD**
- every planning/review generation creates an `ai_generation_runs` record;
- resolved profile/provider/model/status/timing stored;
- artifact revisions can link to generation run;
- raw secret headers are never persisted;
- failure/retry path tested.

---

# Phase 3 — Discovery engine

## T035 — Create discovery schema migration

**Area:** Database  
**Depends on:** T017

Create sessions, questions, answers, facts and assumptions.

**DoD**
- migrations reversible.

## T036 — Implement discovery repository

**Area:** Backend  
**Depends on:** T035

**DoD**
- session/question/answer persistence tested.

## T037 — Define discovery coverage schema

**Area:** Planning  
**Depends on:** T036

**DoD**
- coverage topics and status represented deterministically.

## T038 — Define planning-agent structured output schema

**Area:** AI  
**Depends on:** T023, T037

Output includes:
- understanding;
- questions;
- facts;
- assumptions;
- contradictions;
- coverage update.

**DoD**
- invalid model response rejected.

## T039 — Implement start-discovery service

**Area:** Planning  
**Depends on:** T036, T038

**DoD**
- new project can create one active discovery session.

## T040 — Implement next-question generation

**Area:** Planning  
**Depends on:** T039, T032, T034

**DoD**
- returns one primary high-impact question by default, with optional answer choices;
- persisted before response.

## T041 — Implement discovery answer processing

**Area:** Planning  
**Depends on:** T040

**DoD**
- answer stored;
- facts/assumptions can update;
- contradiction result persisted.

## T042 — Implement readiness gate

**Area:** Planning  
**Depends on:** T037, T041

**DoD**
- produces INCOMPLETE / READY_WITH_ASSUMPTIONS / READY;
- blocking questions prevent READY.

## T043 — Implement accept-assumptions action

**Area:** Planning  
**Depends on:** T042

**DoD**
- accepted assumptions attributable to user;
- audit event created.

## T044 — Expose discovery APIs

**Area:** API  
**Depends on:** T039–T043

**DoD**
- start/read/answer/next/accept-assumptions endpoints tested.

## T045 — Build discovery conversation UI

**Area:** Frontend  
**Depends on:** T044

**DoD**
- one primary question is focused at a time;
- concise already-understood facts/constraints visible;
- prior answers remain accessible without dominating the screen;
- loading/error/retry supported.

## T046 [P] — Build discovery coverage panel

**Area:** Frontend  
**Depends on:** T044

**DoD**
- known/partial/missing/blocking topics visible.

## T047 — Build discovery readiness CTA

**Area:** Frontend  
**Depends on:** T045, T046

**DoD**
- cannot silently proceed with blocking ambiguity;
- assumption override is explicit.

---

# Phase 4 — Versioned planning artifacts

## T048 — Create artifacts/revisions migration

**Area:** Database  
**Depends on:** T017

**DoD**
- artifacts and immutable revision rows supported.

## T049 — Implement artifact repository

**Area:** Backend  
**Depends on:** T048

**DoD**
- create draft revision;
- read revisions;
- approved revision cannot be overwritten.

## T050 — Implement artifact lineage model

**Area:** Backend  
**Depends on:** T049

**DoD**
- derived-from revision IDs stored.

## T051 — Implement artifact approval service

**Area:** Backend  
**Depends on:** T049, T016

**DoD**
- approval actor/time/checksum persisted;
- audit event emitted.

## T052 — Implement stale downstream marking

**Area:** Backend  
**Depends on:** T050, T051

**DoD**
- upstream new approved revision can mark derived artifacts stale.

## T053 — Expose artifact APIs

**Area:** API  
**Depends on:** T049–T052

**DoD**
- get/revise/approve/history endpoints tested.

## T054 — Build reusable artifact viewer/editor

**Area:** Frontend  
**Depends on:** T053

**DoD**
- Markdown preview/edit;
- save draft;
- revision history.

## T055 [P] — Build revision comparison UI

**Area:** Frontend  
**Depends on:** T053

**DoD**
- user can compare two revisions.

---

# Phase 5 — Requirements generation

## T056 — Define normalized requirement schema migration

**Area:** Database  
**Depends on:** T048

**DoD**
- requirements and acceptance criteria tables created.

## T057 — Define requirements AI schema

**Area:** AI  
**Depends on:** T038

**DoD**
- actors/workflows/FR/AC/NFR/assumptions/exclusions represented.

## T058 — Implement requirements generation service

**Area:** Planning  
**Depends on:** T042, T049, T057, T032, T034

**DoD**
- requires discovery readiness or explicit assumption acceptance;
- generates artifact draft.

## T059 — Normalize requirement IDs from artifact

**Area:** Planning  
**Depends on:** T056, T058

**DoD**
- stable requirement/AC records created for traceability.

## T060 — Implement requirements refine service

**Area:** Planning  
**Depends on:** T058

**DoD**
- creates new draft revision, not overwrite.

## T061 — Build requirements screen

**Area:** Frontend  
**Depends on:** T054, T058–T060

**DoD**
- sections navigable;
- approve/refine actions.

---

# Phase 6 — Tech-stack selection

## T062 — Create stack components migration

**Area:** Database  
**Depends on:** T048

**DoD**
- component category/source/user-lock stored.

## T063 — Define stack recommendation schema

**Area:** AI  
**Depends on:** T023

**DoD**
- multiple options, rationale, tradeoffs, risks.

## T064 — Implement requirements-to-stack context builder

**Area:** Planning  
**Depends on:** T059, T063

**DoD**
- only relevant requirements/context included.

## T065 — Implement recommended-stack generation

**Area:** Planning  
**Depends on:** T064, T032, T034

**DoD**
- creates candidate set;
- one recommendation identified with rationale.

## T066 — Implement custom-stack validation

**Area:** Planning  
**Depends on:** T064

**DoD**
- incompatible choices returned as findings;
- user choices are not silently replaced.

## T067 — Implement per-layer AI assist for manual stack

**Area:** Planning  
**Depends on:** T065, T066

**DoD**
- user-locked components preserved;
- AI can recommend only unresolved individual layers;
- no third top-level stack mode is required.

## T068 — Implement stack approval baseline

**Area:** Planning  
**Depends on:** T062, T067, T051

**DoD**
- approved stack artifact and normalized components created.

## T069 — Build stack mode selection UI

**Area:** Frontend  
**Depends on:** T065–T068

**DoD**
- Use AI recommendation / Choose manually options;
- no separate Hybrid card/mode.

## T070 — Build stack comparison UI

**Area:** Frontend  
**Depends on:** T065

**DoD**
- tradeoffs and recommendation visible.

## T071 — Build manual stack editor

**Area:** Frontend  
**Depends on:** T066, T067

**DoD**
- user can edit/lock categories and request AI suggestion for unresolved rows;
- validation findings visible.

---

# Phase 7 — Technical design

## T072 — Define design generation schema

**Area:** AI  
**Depends on:** T057, T063

**DoD**
- architecture/components/data/API/states/security/testing/deployment sections.

## T073 — Implement design context builder

**Area:** Planning  
**Depends on:** T059, T068

**DoD**
- approved requirements and stack revisions are explicit inputs.

## T074 — Implement design generation service

**Area:** Planning  
**Depends on:** T072, T073, T049, T032, T034

**DoD**
- design draft revision created with lineage.

## T075 — Implement design coverage analyzer

**Area:** Planning  
**Depends on:** T074

**DoD**
- identifies requirements lacking design path.

## T076 — Implement design refine service

**Area:** Planning  
**Depends on:** T074

**DoD**
- selected section can be refined into new revision.

## T077 — Build design review UI

**Area:** Frontend  
**Depends on:** T074–T076

**DoD**
- sections navigable;
- findings visible;
- approve action.

---

## T078 — Build high-level planning map / outline view

**Area:** Frontend  
**Depends on:** T077

**DoD**
- approved project intent/features/sub-features render in a simple original planning view;
- view is derived from approved planning artifacts, not runtime task status;
- desktop supports fit/zoom or equivalent navigation;
- mobile has a readable outline/card fallback;
- implementation follows `25_FRONTEND_DESIGN_SPEC.md` originality/open-source rules.

---

# Phase 8 — Atomic task engine

## T079 — Create task schema migration

**Area:** Database  
**Depends on:** T017, T056

**DoD**
- task contract fields created.

## T080 — Create task-requirement link migration

**Area:** Database  
**Depends on:** T079, T056

**DoD**
- task → requirement/AC mapping supported.

## T081 — Create task dependency migration

**Area:** Database  
**Depends on:** T079

**DoD**
- self-dependency prevented.

## T082 — Implement task repository

**Area:** Backend  
**Depends on:** T079–T081

**DoD**
- task and dependency CRUD tested.

## T083 — Define task-generation AI schema

**Area:** AI  
**Depends on:** T072

**DoD**
- task contract fields and dependency references validated.

## T084 — Implement task generation service

**Area:** Planning  
**Depends on:** T059, T074, T082, T083, T032, T034

**DoD**
- draft tasks created with artifact lineage.

## T085 — Implement dependency graph cycle detection

**Area:** Task Engine  
**Depends on:** T082

**DoD**
- cycle rejected;
- automated tests include multi-node cycle.

## T086 — Implement task traceability validator

**Area:** Task Engine  
**Depends on:** T080, T084

**DoD**
- feature tasks require source requirement/AC.

## T087 — Implement atomic task linter

**Area:** Task Engine  
**Depends on:** T084–T086

**DoD**
- objective/scope/AC/verification/deliverable/stop-condition checks.

## T088 — Implement hardness/risk calculator

**Area:** Task Engine  
**Depends on:** T084

**DoD**
- factor model persisted;
- override requires audit reason.

## T089 — Implement task readiness calculator

**Area:** Task Engine  
**Depends on:** T052, T085–T088

**DoD**
- artifact freshness/dependencies/lint/approval checked.

## T090 — Implement parallel candidate analyzer

**Area:** Task Engine  
**Depends on:** T081, T089

**DoD**
- dependency/path metadata considered.

## T091 — Implement task split action

**Area:** Task Engine  
**Depends on:** T082

**DoD**
- original draft superseded;
- new task lineage preserved.

## T092 — Implement task merge action

**Area:** Task Engine  
**Depends on:** T082

**DoD**
- only eligible draft tasks merged;
- links/dependencies reconciled.

## T093 — Expose task planning APIs

**Area:** API  
**Depends on:** T084–T092

**DoD**
- generate/edit/split/merge/lint/validate/read endpoints.

## T094 — Build task table planning UI

**Area:** Frontend  
**Depends on:** T093

**DoD**
- simple readable default list; traceability, hardness and readiness visible;
- advanced dependency detail is progressive, not first-screen clutter.

## T095 [P] — Build task dependency graph UI

**Area:** Frontend  
**Depends on:** T093

**DoD**
- dependency edges rendered;
- cycle errors visible.

## T096 — Build task editor

**Area:** Frontend  
**Depends on:** T093

**DoD**
- all task contract fields editable before execution.

---

# Phase 9 — Prompt and context-pack generation

## T097 — Implement minimal task context selector

**Area:** Context  
**Depends on:** T059, T074, T082

**DoD**
- selects linked requirements, AC, design sections, contracts, rules.

## T098 — Define standalone work-order prompt template

**Area:** Prompting  
**Depends on:** T097

**DoD**
- usable without connection;
- no secrets.

## T099 — Define connected CLI prompt template

**Area:** Prompting  
**Depends on:** T097

**DoD**
- exact `sddctl` workflow instructions.

## T100 — Define connected MCP prompt template

**Area:** Prompting  
**Depends on:** T097

**DoD**
- uses stable MCP tool names.

## T101 — Implement prompt generation API

**Area:** API  
**Depends on:** T098–T100

**DoD**
- three modes returned;
- prompt audit metadata stored.

## T102 — Build task prompt panel

**Area:** Frontend  
**Depends on:** T101

**DoD**
- Copy Standalone / CLI / MCP;
- copied prompt never displays secret.

---

# Phase 10 — Execution state, runs and events

## T103 — Create task runs migration

**Area:** Database  
**Depends on:** T079

**DoD**
- multiple attempts per task.

## T104 — Create task leases migration

**Area:** Database  
**Depends on:** T103

**DoD**
- active lease data and expiry fields.

## T105 — Create task events migration

**Area:** Database  
**Depends on:** T103

**DoD**
- task timeline supports optional run linkage, client sequence and idempotency metadata.

## T106 — Create test results migration

**Area:** Database  
**Depends on:** T103

**DoD**
- command/status/evidence fields.

## T107 — Implement task state transition service

**Area:** Execution  
**Depends on:** T082, T103, T105

**DoD**
- illegal transitions rejected;
- legal transitions append a task event;
- table-driven tests cover transition matrix.

## T108 — Implement atomic claim transaction

**Area:** Execution  
**Depends on:** T104, T107

**DoD**
- one active claim under concurrent attempts.

## T109 — Add concurrent-claim integration test

**Area:** Testing  
**Depends on:** T108

**DoD**
- simultaneous claim race produces one winner.

## T110 — Implement run start action

**Area:** Execution  
**Depends on:** T108

**DoD**
- CLAIMED → IN_PROGRESS with event.

## T111 — Implement heartbeat action

**Area:** Execution  
**Depends on:** T104, T110

**DoD**
- lease liveness updates authorized run only.

## T112 — Implement lease expiry worker

**Area:** Execution  
**Depends on:** T111

**DoD**
- expired lease creates attention event;
- no silent DONE/FAIL assumption.

## T113 — Implement append-only task/run event service

**Area:** Execution  
**Depends on:** T105

**DoD**
- task timeline supports run-linked and non-run events;
- ordered run events;
- idempotent retry supported.

## T114 — Implement test report service

**Area:** Execution  
**Depends on:** T106, T113

**DoD**
- validation results persisted and event emitted.

## T115 — Implement block action

**Area:** Execution  
**Depends on:** T107, T113

**DoD**
- reason required;
- task/run status consistent.

## T116 — Implement request-review action

**Area:** Execution  
**Depends on:** T107, T114

**DoD**
- required evidence policy checked;
- transition to NEEDS_REVIEW.

## T117 — Expose execution REST APIs

**Area:** API  
**Depends on:** T108–T116

**DoD**
- claim/start/heartbeat/events/tests/block/submit endpoints tested.

---

# Phase 11 — CLI (`sddctl`)

## T118 — Create CLI config package

**Area:** CLI  
**Depends on:** T003

**DoD**
- server URL/profile config;
- JSON output framework.

## T119 — Implement CLI login flow

**Area:** CLI  
**Depends on:** T118, backend auth endpoint

**DoD**
- user can authenticate;
- credentials stored securely where supported.

## T120 — Implement `whoami`

**Area:** CLI  
**Depends on:** T119

**DoD**
- current account/server displayed.

## T121 — Implement project link metadata

**Area:** CLI  
**Depends on:** T118

**DoD**
- `.sdd/local.json` written without token;
- repo root detection tested.

## T122 — Implement `project link/status/unlink`

**Area:** CLI  
**Depends on:** T121

**DoD**
- project mapping verified server-side.

## T123 — Implement `task show/context`

**Area:** CLI  
**Depends on:** T122, T117

**DoD**
- human and JSON/agent formats.

## T124 — Implement `task claim/start`

**Area:** CLI  
**Depends on:** T123

**DoD**
- active run ID persisted in local run state.

## T125 — Implement `run progress`

**Area:** CLI  
**Depends on:** T124

**DoD**
- idempotency key generated;
- event reaches server.

## T126 — Implement `run test`

**Area:** CLI  
**Depends on:** T124

**DoD**
- test result reaches server.

## T127 — Implement `task block`

**Area:** CLI  
**Depends on:** T124

**DoD**
- clear reason required.

## T128 — Implement `task submit`

**Area:** CLI  
**Depends on:** T126

**DoD**
- review request created or actionable error returned.

## T129 — Add CLI fake-server integration suite

**Area:** Testing  
**Depends on:** T119–T128

**DoD**
- auth/link/task happy path and failures covered.

## T130 — Add cross-platform CLI build pipeline

**Area:** Release  
**Depends on:** T129

**DoD**
- Windows/macOS/Linux binaries generated.

---

# Phase 12 — MCP server

## T131 — Add official MCP SDK integration

**Area:** MCP  
**Depends on:** T117

**DoD**
- server endpoint starts;
- protocol smoke test.

## T132 — Implement MCP authorization adapter

**Area:** MCP/Security  
**Depends on:** T131, T016

**DoD**
- scoped token checked;
- unauthorized tool call rejected.

## T133 — Implement `project_get_context`

**Area:** MCP  
**Depends on:** T132, T097

**DoD**
- returns minimal project context.

## T134 — Implement `task_list_ready`

**Area:** MCP  
**Depends on:** T132, T089

**DoD**
- only authorized project tasks returned.

## T135 — Implement `task_get`

**Area:** MCP  
**Depends on:** T133

**DoD**
- task contract/context returned.

## T136 — Implement `task_claim` and `task_start`

**Area:** MCP  
**Depends on:** T132, T108, T110

**DoD**
- same domain services as REST.

## T137 — Implement progress/test MCP tools

**Area:** MCP  
**Depends on:** T113, T114

**DoD**
- tool schema validation;
- audit source=MCP.

## T138 — Implement block/review MCP tools

**Area:** MCP  
**Depends on:** T115, T116

**DoD**
- legal transitions enforced.

## T139 — Define MCP bug-report tool contract

**Area:** MCP  
**Depends on:** T132

**DoD**
- `bug_report` input/output schema is defined and registered as a deferred capability contract;
- contract contains project/task/run linkage fields without bypassing bug-domain authorization;
- executable wiring is completed only in T161 after the bug service exists.

## T140 — Add MCP integration/conformance tests

**Area:** Testing  
**Depends on:** T133–T139

**DoD**
- read/write/auth/error scenarios tested.

---

# Phase 13 — Browser realtime and task execution UI

## T141 — Implement browser event subscription endpoint

**Area:** Realtime  
**Depends on:** T113

**DoD**
- authorized project/run subscriptions.

## T142 — Publish task/run state invalidation events

**Area:** Realtime  
**Depends on:** T141, T107

**DoD**
- transition updates reach subscribers.

## T143 — Build execution Kanban board

**Area:** Frontend  
**Depends on:** T093, T142

**DoD**
- Ready/Running/Testing/Review/Rework/Blocked/Done.

## T144 — Build task detail work-order view

**Area:** Frontend  
**Depends on:** T102, T117

**DoD**
- objective/scope/AC/verification/dependencies shown.

## T145 — Build active-run timeline

**Area:** Frontend  
**Depends on:** T141, T144

**DoD**
- events update without full-page reload.

## T146 — Build test evidence panel

**Area:** Frontend  
**Depends on:** T114, T144

**DoD**
- command/result/time visible.

---

# Phase 14 — Review

## T147 — Create reviews migration

**Area:** Database  
**Depends on:** T103

**DoD**
- decision/findings/reviewer stored.

## T148 — Implement review policy resolver

**Area:** Review  
**Depends on:** T088, T147

**DoD**
- task risk/type resolves required reviewer policy.

## T149 — Implement approve action

**Area:** Review  
**Depends on:** T107, T148

**DoD**
- valid NEEDS_REVIEW task can become DONE;
- audit event.

## T150 — Implement request-changes action

**Area:** Review  
**Depends on:** T107, T148

**DoD**
- findings required;
- task moves to CHANGES_REQUESTED.

## T151 — Implement requeue after changes request

**Area:** Review  
**Depends on:** T150, T089

**DoD**
- new run attempt can begin;
- history preserved.

## T152 — Expose review APIs

**Area:** API  
**Depends on:** T149–T151

**DoD**
- approve/change history endpoints tested.

## T153 — Build review screen

**Area:** Frontend  
**Depends on:** T146, T152

**DoD**
- task contract and run evidence shown together.

---

# Phase 15 — Bugs

## T154 — Create bugs and bug-links migration

**Area:** Database  
**Depends on:** T017

**DoD**
- bug independent from task status.

## T155 — Implement bug repository/service

**Area:** Bug  
**Depends on:** T154

**DoD**
- current/expected/unchanged/reproduction required by policy.

## T156 — Implement bug state machine

**Area:** Bug  
**Depends on:** T155

**DoD**
- legal bug transitions tested.

## T157 — Implement link bug to task/run/feature/AC

**Area:** Bug  
**Depends on:** T154, T155

**DoD**
- multiple source links supported.

## T158 — Implement bug fix-task generation

**Area:** Bug/AI  
**Depends on:** T084, T155

**DoD**
- generated fix task has traceability to bug.

## T159 — Expose bug APIs

**Area:** API  
**Depends on:** T155–T158

**DoD**
- report/confirm/plan/list endpoints.

## T160 — Build bug detail UI

**Area:** Frontend  
**Depends on:** T159

**DoD**
- behavior triplet and linked evidence visible.

## T161 — Wire MCP `bug_report`

**Area:** MCP  
**Depends on:** T139, T155

**DoD**
- remote agent can report scoped bug.

---

# Phase 16 — Convergence

## T162 — Create convergence schema migration

**Area:** Database  
**Depends on:** T056, T079

**DoD**
- runs/findings/resolution fields.

## T163 — Define convergence AI output schema

**Area:** AI  
**Depends on:** T072

**DoD**
- covered/partial/missing/contradiction findings.

## T164 — Implement convergence context builder

**Area:** Convergence  
**Depends on:** T059, T074, T082, T147

**DoD**
- approved artifacts + completed task evidence selected.

## T165 — Implement convergence analysis service

**Area:** Convergence  
**Depends on:** T162–T164, T032, T034

**DoD**
- findings persisted;
- blocking severity supported.

## T166 — Implement generate-task-from-finding

**Area:** Convergence  
**Depends on:** T084, T165

**DoD**
- task links back to finding and requirement.

## T167 — Implement feature completion gate

**Area:** Convergence  
**Depends on:** T165

**DoD**
- blocking finding/open blocking bug prevents COMPLETE.

## T168 — Build convergence dashboard

**Area:** Frontend  
**Depends on:** T165–T167

**DoD**
- coverage, findings and generated tasks visible.

---

# Phase 17 — Local daemon and remote dispatch

## T169 — Create machine/repository-link schema

**Area:** Database  
**Depends on:** T012, T017

**DoD**
- machine and repository binding stored.

## T170 — Implement machine registration API

**Area:** Agent Gateway  
**Depends on:** T169, T016

**DoD**
- authenticated user registers/revokes machine.

## T171 — Implement outbound WebSocket agent gateway

**Area:** Agent Gateway  
**Depends on:** T170

**DoD**
- authenticated connection;
- reconnect safe;
- capability hello.

## T172 — Define structured dispatch protocol

**Area:** Agent Gateway  
**Depends on:** T171

**DoD**
- execute/cancel/ack messages;
- no arbitrary shell command field.

## T173 — Create daemon config/auth package

**Area:** Daemon  
**Depends on:** T118, T119

**DoD**
- shares secure auth concepts with CLI.

## T174 — Implement daemon connection/reconnect

**Area:** Daemon  
**Depends on:** T171, T173

**DoD**
- exponential backoff;
- machine heartbeat.

## T175 — Implement local repository resolver

**Area:** Daemon  
**Depends on:** T121, T174

**DoD**
- dispatch cannot escape linked repository.

## T176 — Define generic agent adapter interface

**Area:** Daemon  
**Depends on:** T175

**DoD**
- detect/build/start/cancel abstraction.

## T177 — Implement generic shell-capable adapter

**Area:** Daemon  
**Depends on:** T176

**DoD**
- structured command configuration;
- stdout/stderr captured.

## T178 [P] — Implement Codex adapter

**Area:** Daemon  
**Depends on:** T176

**DoD**
- installation detection;
- invocation builder;
- result capture.

## T179 [P] — Implement Claude Code adapter

**Area:** Daemon  
**Depends on:** T176

**DoD**
- same adapter tests.

## T180 [P] — Implement Kiro adapter

**Area:** Daemon  
**Depends on:** T176

**DoD**
- same adapter tests.

## T181 — Implement daemon dispatch execution

**Area:** Daemon  
**Depends on:** T172, T174–T177

**DoD**
- task verified;
- claim created;
- subprocess started;
- status streamed.

## T182 — Implement remote cancel

**Area:** Daemon  
**Depends on:** T181

**DoD**
- cancellation signal handled;
- run event persisted;
- process cleanup.

## T183 — Build connected-machines UI

**Area:** Frontend  
**Depends on:** T170, T171

**DoD**
- online/offline, capabilities, last seen.

## T184 — Build Run on Local Agent dialog

**Area:** Frontend  
**Depends on:** T172, T181, T183

**DoD**
- machine/repo/adapter selection;
- explicit confirmation.

---

# Phase 18 — Audit, notifications and observability

## T185 — Create audit-events migration

**Area:** Database  
**Depends on:** T012

**DoD**
- append-only audit model.

## T186 — Implement audit service

**Area:** Backend  
**Depends on:** T185

**DoD**
- source/actor/entity/action recorded.

## T187 — Add audit events to planning approvals

**Area:** Backend  
**Depends on:** T186, T051

**DoD**
- requirement/stack/design approvals logged.

## T188 — Add audit events to execution/review

**Area:** Backend  
**Depends on:** T186, T107, T149

**DoD**
- claim/block/review/override logged.

## T189 — Implement structured metrics

**Area:** Observability  
**Depends on:** T008

**DoD**
- API, AI, task, lease, agent metrics.

## T190 — Add trace IDs across web/CLI/MCP/gateway

**Area:** Observability  
**Depends on:** T008, T117, T131, T171

**DoD**
- correlation ID appears in error/log/event path.

## T191 — Create in-app notification model

**Area:** Backend  
**Depends on:** T012

**DoD**
- recipient/type/read state.

## T192 — Notify on blocked/review/lease expiry

**Area:** Backend  
**Depends on:** T112, T115, T116, T191

**DoD**
- duplicate notification suppression.

## T193 — Build activity/audit UI

**Area:** Frontend  
**Depends on:** T186

**DoD**
- filter by project/entity/actor/source.

---

# Phase 19 — Security hardening

## T194 — Add CLI token scope enforcement tests

**Area:** Security  
**Depends on:** T119, T117

**DoD**
- least-privilege scenarios covered.

## T195 — Add MCP authorization tests

**Area:** Security  
**Depends on:** T132, T140

**DoD**
- cross-project and insufficient-scope calls rejected.

## T196 — Add daemon dispatch authorization tests

**Area:** Security  
**Depends on:** T172, T181

**DoD**
- wrong user/machine/repo dispatch rejected.

## T197 — Implement secret redaction utility

**Area:** Security  
**Depends on:** T008, T025

**DoD**
- auth headers/provider secrets removed from logs.

## T198 — Add custom AI endpoint SSRF controls

**Area:** Security  
**Depends on:** T026, T027

**DoD**
- forbidden network target policy tested.

## T199 — Add rate limits for auth/AI/MCP

**Area:** Security  
**Depends on:** T015, T029, T131

**DoD**
- limits configurable and observable.

## T200 — Add security headers/CSP

**Area:** Frontend/Edge  
**Depends on:** T004, T015

**DoD**
- production headers verified.

---

# Phase 20 — Export and portability

## T201 — Implement project artifact Markdown export

**Area:** Export  
**Depends on:** T049, T082

**DoD**
- approved requirements/stack/design/tasks exportable.

## T202 — Implement task JSON work-order export

**Area:** Export  
**Depends on:** T082

**DoD**
- schema version included.

## T203 — Implement `AGENTS.md` export template

**Area:** Export  
**Depends on:** T201

**DoD**
- project rules can be exported to repository instructions.

## T204 — Implement portable bundle export

**Area:** Export  
**Depends on:** T201–T203

**DoD**
- ZIP includes index and version metadata;
- no secrets.

---

# Phase 21 — Deployment and production readiness

## T205 — Create production Dockerfiles

**Area:** DevOps  
**Depends on:** T006

**DoD**
- web/api images build;
- non-development settings.

## T206 — Create production Compose/reference deployment

**Area:** DevOps  
**Depends on:** T205

**DoD**
- API, web, PostgreSQL, reverse proxy configuration documented.

## T207 — Add health/readiness endpoints

**Area:** Backend  
**Depends on:** T205

**DoD**
- database readiness distinct from process liveness.

## T208 — Implement backup procedure

**Area:** Operations  
**Depends on:** T206

**DoD**
- backup command/runbook documented.

## T209 — Perform restore test

**Area:** Operations  
**Depends on:** T208

**DoD**
- clean database restored and smoke tested.

## T210 — Add production migration runbook

**Area:** Operations  
**Depends on:** T010, T205

**DoD**
- deploy/rollback sequence documented.

## T211 — Create first admin/bootstrap flow

**Area:** Operations  
**Depends on:** T015, T206

**DoD**
- clean install can create initial account/workspace.

---

# Phase 22 — End-to-end acceptance

## T212 — Automate idea-to-requirements E2E

**Area:** E2E  
**Depends on:** T061

**DoD**
- project → questions → requirements approval.

## T213 — Automate requirements-to-task E2E

**Area:** E2E  
**Depends on:** T096

**DoD**
- stack/design/task generation and approval.

## T214 — Automate CLI task execution E2E

**Area:** E2E  
**Depends on:** T129, T153

**DoD**
- linked fake repo → claim → progress → test → submit → approve.

## T215 — Automate concurrent claim E2E

**Area:** E2E  
**Depends on:** T109

**DoD**
- two executors cannot own same task.

## T216 — Automate MCP task execution E2E

**Area:** E2E  
**Depends on:** T140, T153

**DoD**
- task_get → claim → start → test → submit.

## T217 — Automate changes-requested loop

**Area:** E2E  
**Depends on:** T151

**DoD**
- review change → requeue → new run → approval.

## T218 — Automate bug-to-fix-task E2E

**Area:** E2E  
**Depends on:** T158

**DoD**
- bug report → confirm → generated task.

## T219 — Automate convergence-gap E2E

**Area:** E2E  
**Depends on:** T168

**DoD**
- missing AC generates finding/task and blocks feature completion.

## T220 — Validate manual standalone prompt workflow

**Area:** UAT  
**Depends on:** T102, T153

**DoD**
- task can be completed without CLI/MCP and evidence entered manually.

## T221 — Validate local daemon execution workflow

**Area:** UAT  
**Depends on:** T184

**DoD**
- website dispatches approved task to connected machine and streams run.

## T222 — Complete core security regression suite

**Area:** UAT/Security  
**Depends on:** T194, T195, T197–T200

**DoD**
- no critical known control failure in the initial release scope;
- if the optional daemon is enabled for a release, T196 is also mandatory.

## T223 — Complete production readiness review

**Area:** Release  
**Depends on:** T209, T210, T211, T212–T220, T222

**DoD**
- core UAT pass, including CLI and MCP connected execution;
- backup restore pass;
- core security checks pass;
- known limitations and optional-daemon status documented;
- T221/T196 are required only when the daemon is included in that release.

---

# Suggested MVP cut line

For the first genuinely useful open-source release, complete through:

- planning + AI provider/profile routing + guided frontend: T001–T102;
- connected execution state + `sddctl`: T103–T130;
- MCP interoperability: T131–T140;
- browser execution/review: T141–T153;
- bugs/convergence: T154–T168;
- security/ops subset required for deployment.

The local daemon phase can be **MVP.2** because users can already use Copy Prompt + `sddctl`.

This is an intentional scope decision: prove discovery → specification → atomic task → evidence → review before automating local subprocess dispatch.
