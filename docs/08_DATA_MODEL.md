# Data Model

## 1. High-level ER model

```text
Workspace
  └── Project
       ├── ProjectMember
       ├── DiscoverySession
       │    ├── DiscoveryQuestion
       │    ├── DiscoveryAnswer
       │    ├── Fact
       │    └── Assumption
       │
       ├── Feature
       │    ├── Artifact
       │    │    └── ArtifactRevision
       │    ├── Requirement
       │    ├── AcceptanceCriterion
       │    ├── Task
       │    │    ├── TaskDependency
       │    │    ├── TaskLease
       │    │    ├── TaskRun
       │    │    │    ├── RunEvent
       │    │    │    └── TestResult
       │    │    └── Review
       │    ├── Bug
       │    └── ConvergenceFinding
       │
       ├── LocalMachine
       └── AgentProfile
```

## 2. Workspaces

```sql
workspaces
- id uuid pk
- slug text unique
- name text
- created_at timestamptz
- updated_at timestamptz
```

## 3. Users and membership

```sql
users
- id uuid pk
- email text unique
- display_name text
- status text
- created_at timestamptz

workspace_members
- workspace_id uuid fk
- user_id uuid fk
- role text
- created_at timestamptz
unique(workspace_id, user_id)
```

## 4. Projects

```sql
projects
- id uuid pk
- workspace_id uuid fk
- key text
- name text
- high_level_idea text
- lifecycle_status text
- active_requirements_revision_id uuid nullable
- active_stack_revision_id uuid nullable
- active_design_revision_id uuid nullable
- created_by uuid
- created_at timestamptz
- updated_at timestamptz
unique(workspace_id, key)
```

## 5. Features

```sql
features
- id uuid pk
- project_id uuid fk
- key text
- title text
- description text
- status text
- priority text
- created_at timestamptz
- updated_at timestamptz
unique(project_id, key)
```

## 6. Discovery

```sql
discovery_sessions
- id uuid pk
- project_id uuid fk
- status text
- readiness text
- started_by uuid
- created_at timestamptz
- completed_at timestamptz nullable
- unique (project_id) where status = 'ACTIVE'   -- one active session per project

discovery_questions
- id uuid pk
- session_id uuid fk
- question_key text
- topic text
- question_text text
- reason text
- answer_type text
- options jsonb
- impact text
- blocking boolean
- status text
- sequence int

discovery_answers
- id uuid pk
- question_id uuid fk
- answered_by uuid
- answer jsonb
- created_at timestamptz

discovery_facts
- id uuid pk
- session_id uuid fk
- fact_key text
- value jsonb
- source_type text
- source_ref uuid nullable
- confidence text
- status text

discovery_assumptions
- id uuid pk
- session_id uuid fk
- description text
- impact text
- accepted_by uuid nullable
- status text
```

## 7. Artifacts and revisions

```sql
artifacts
- id uuid pk
- project_id uuid fk
- feature_id uuid nullable
- artifact_type text
- title text
- current_draft_revision_id uuid nullable
- approved_revision_id uuid nullable
- created_at timestamptz

artifact_revisions
- id uuid pk
- artifact_id uuid fk
- version int
- content_format text
- content text
- structured_content jsonb nullable
- status text
- derived_from jsonb
- ai_generation_run_id uuid nullable
- checksum text
- created_by_actor_type text
- created_by_actor_id text
- created_at timestamptz
- approved_by uuid nullable
- approved_at timestamptz nullable
unique(artifact_id, version)
```

Artifact types:
- discovery;
- requirements;
- stack;
- design;
- data_model;
- api_contract;
- ux;
- design_system;
- uat;
- task_plan;
- convergence.

### Structured content of `design_system` and `ux` revisions

Both are stored as the revision's `structured_content` (no extra tables).

`design_system` — a `DesignSystemSpec` (`packages/contracts/src/design-system.ts`), written by a person from a preset (no AI call):

```text
DesignSystemSpec
- preset_id text              -- preset it started from, "custom" when built from scratch
- name text
- summary text
- light / dark palette        -- 13 colour roles, 6-digit hex: bg, surface, surface2, fg, fgMuted,
                                 border, borderStrong, accent, accentFg, success, warn, danger, info
- fonts {display, body, mono} -- font stacks ending in a generic family
- radius int (0–24 px)
- density compact | comfortable | spacious
- depth flat | hairline | soft | hard
- border_width int (1–3 px)
- component_library text      -- id from the library catalog (shadcn, daisyui, bootstrap, material, antd, flowbite, pico, none)
- guidance text               -- markdown style guidance for agents
```

A draft is refused if any of the 12 contrast pairs per mode fails WCAG AA. The revision `content` holds the rendered DESIGN.md.

`ux` — a `UxReference` (`packages/contracts/src/ai.ts`):

```text
UxReference
- applicable bool, reason text          -- false for products with no UI (CLI, API, library)
- screens[] {key, name, purpose, requirement_keys[], key_elements[], screen_type?, overlays?[] {kind dialog|sheet|confirm, name, purpose}, html|null, revision_note?, lint?[] {rule, severity P0|P1, message}, history?[] {content, at, note} (max 5), comments?[] {id, nid, anchor, text, author_id, created_at, resolved_at}}  -- max 12
- recommended_count int, count_rationale text   -- the AI's own count and why
- requested_count int|null              -- count the person set (1–12); never exceeded
- guidance text                         -- what the person asked to include, leave out or focus on
- fidelity neutral | styled             -- greyscale mid-fi, or drawn with the approved design system
- design_system_version int|null        -- design-system version styled screens were drawn with
```

### Staleness graph

Approving an upstream artifact marks approved and draft revisions of its downstream artifacts `STALE`:

```text
discovery      → requirements
requirements   → stack, design, task_plan, ux
stack          → design, task_plan, ux, design_system
design         → task_plan, ux
design_system  → ux   (only revisions with fidelity = styled; neutral references stay valid)
```

## 8. Requirements

For traceability, important requirements should also be normalized.

```sql
requirements
- id uuid pk
- project_id uuid fk
- feature_id uuid nullable
- artifact_revision_id uuid fk
- key text
- type text
- title text
- statement text
- priority text
- status text
- metadata jsonb

acceptance_criteria
- id uuid pk
- requirement_id uuid fk
- key text
- statement text
- verification_type text
- metadata jsonb
```

## 9. Stack decisions

Can live as structured artifact plus optional normalized choices:

```sql
stack_components
- id uuid pk
- project_id uuid fk
- stack_revision_id uuid fk
- category text
- technology text
- version_constraint text nullable
- selection_source text
- locked_by_user boolean
- rationale text
```

## 10. Tasks

```sql
tasks
- id uuid pk
- project_id uuid fk
- feature_id uuid nullable
- key text
- title text
- description text
- task_type text
- workflow_status text
- execution_result text
- attention_status text
- priority text
- hardness smallint
- risk_level text
- objective text
- scope jsonb
- constraints jsonb
- verification jsonb
- deliverables jsonb
- stop_conditions jsonb
- parallel_safe boolean
- created_from_revision_ids jsonb
- readiness_status text
- readiness_report jsonb
- review_policy text
- created_at timestamptz
- updated_at timestamptz
unique(project_id, key)
```

## 11. Task traceability

```sql
task_requirement_links
- task_id uuid fk
- requirement_id uuid fk
- acceptance_criterion_id uuid nullable
primary key(task_id, requirement_id, acceptance_criterion_id)
```

## 12. Dependencies

```sql
task_dependencies
- task_id uuid fk
- depends_on_task_id uuid fk
- dependency_type text
- created_at timestamptz
primary key(task_id, depends_on_task_id)
check(task_id <> depends_on_task_id)
```

Cycle detection remains application-level plus transactional safeguards.

## 13. Task leases

```sql
task_leases
- id uuid pk
- task_id uuid fk
- run_id uuid fk
- executor_id text
- status text
- issued_at timestamptz
- expires_at timestamptz
- last_heartbeat_at timestamptz
- released_at timestamptz nullable
```

Enforce one active lease per task using a partial unique index where supported.

## 14. Runs

```sql
task_runs
- id uuid pk
- task_id uuid fk
- attempt int
- executor_type text
- executor_id text
- execution_agent_profile_id uuid nullable
- machine_id uuid nullable
- status text
- started_at timestamptz nullable
- ended_at timestamptz nullable
- exit_code int nullable
- summary text nullable
- commit_sha text nullable
- metadata jsonb
unique(task_id, attempt)
```

## 15. Task events

```sql
task_events
- id bigint generated always as identity pk
- task_id uuid fk
- run_id uuid nullable fk
- client_sequence bigint nullable
- event_type text
- actor_type text
- actor_id text
- payload jsonb
- idempotency_key text nullable
- occurred_at timestamptz
unique(run_id, client_sequence) where run_id is not null and client_sequence is not null
unique(idempotency_key) where idempotency_key is not null
```

`run_id` is nullable so the same task timeline can also capture legal transitions that occur before a run exists or between run attempts.

## 16. Test results

```sql
test_results
- id uuid pk
- run_id uuid fk
- command text
- suite text nullable
- status text
- exit_code int nullable
- duration_ms bigint nullable
- summary text nullable
- artifact_ref text nullable
- created_at timestamptz
```

## 17. Reviews

```sql
reviews
- id uuid pk
- task_id uuid fk
- run_id uuid fk
- reviewer_type text
- reviewer_id text
- decision text
- findings jsonb
- summary text
- created_at timestamptz
```

Decisions:
- approved;
- changes_requested;
- rejected;
- waived.

## 18. Bugs

```sql
bugs
- id uuid pk
- project_id uuid fk
- feature_id uuid nullable
- key text
- title text
- status text
- severity text
- current_behavior text
- expected_behavior text
- unchanged_behavior text
- reproduction text
- created_by_actor_type text
- created_by_actor_id text
- created_at timestamptz
- updated_at timestamptz
```

Links:

```sql
bug_links
- bug_id uuid fk
- entity_type text
- entity_id uuid
```

## 19. Convergence findings

```sql
convergence_runs
- id uuid pk
- feature_id uuid fk
- requirements_revision_id uuid
- design_revision_id uuid
- status text
- summary text
- created_at timestamptz

convergence_findings
- id uuid pk
- convergence_run_id uuid fk
- finding_type text
- severity text
- source_ref text
- description text
- resolution_status text
- generated_task_id uuid nullable
```

## 20. Local machines

```sql
local_machines
- id uuid pk
- user_id uuid fk
- name text
- fingerprint text
- platform text
- capabilities jsonb
- status text
- last_seen_at timestamptz
- created_at timestamptz
unique(user_id, fingerprint)
```

`capabilities` holds what the daemon reported in `hello` (agents, os). After the handshake the daemon also reports `ai_cli` — the AI CLIs installed on the machine (`{id, name, installed, version, auth: ok|missing|unknown, suggestedModels}`); the gateway keeps that list on the live connection and `GET /api/v1/ai/cli` returns it for the owner's machines.

## 21. Repository links

```sql
repository_links
- id uuid pk
- project_id uuid fk
- machine_id uuid fk
- repo_fingerprint text
- display_path text
- default_branch text nullable
- status text
- created_at timestamptz
```

Do not send full local path to other workspace users unless policy permits.

## 22. Execution-agent profiles

These profiles configure local coding-agent adapters and are distinct from planning/review AI Profiles.

```sql
execution_agent_profiles
- id uuid pk
- owner_user_id uuid nullable
- name text
- adapter_type text
- capabilities jsonb
- default_config jsonb
- status text
```

## 23. AI provider connections

```sql
ai_provider_connections
- id uuid pk
- scope_type text        -- SYSTEM | WORKSPACE
- workspace_id uuid nullable fk
- name text
- provider_type text
- base_url text nullable
- encrypted_credential_ref text nullable
- public_headers jsonb
- encrypted_secret_headers_ref text nullable
- timeout_ms int
- capabilities jsonb
- custom_http_mapping jsonb nullable
- status text
- created_at timestamptz
- updated_at timestamptz
```

`provider_type` is one of `OPENAI`, `ANTHROPIC`, `GEMINI`, `OPENAI_COMPATIBLE`, `CUSTOM_HTTP`, `LOCAL_CLI`. For `LOCAL_CLI` (a coding-agent CLI — Claude Code or Codex — used as the model) `base_url` is not a URL but the target: `cli://server/<claude|codex>` (runs on the API host, only when the operator sets `SDD_ENABLE_LOCAL_CLI=true`) or `cli://machine/<machine-uuid>/<claude|codex>` (runs through that machine's `sdd-agent`). No credential is stored — the CLI uses its own login. `timeout_ms` is the whole-run limit for CLIs (default 900,000, max 1,800,000); for HTTP providers it is an idle limit.

`custom_http_mapping` is declarative and may contain only allowlisted mapping fields; it never stores executable code. `SYSTEM` connections/profiles have `workspace_id = NULL` and are operator-managed; workspace users cannot mutate them. `WORKSPACE` connections/profiles require a matching `workspace_id`.

## 24. AI profiles

```sql
ai_profiles
- id uuid pk
- scope_type text        -- SYSTEM | WORKSPACE
- workspace_id uuid nullable fk
- name text
- provider_connection_id uuid fk
- model_id text
- parameters jsonb
- required_capabilities jsonb
- status text
- created_at timestamptz
- updated_at timestamptz
```

## 25. AI role bindings

```sql
ai_role_bindings
- id uuid pk
- scope_type text        -- SYSTEM | WORKSPACE | PROJECT
- workspace_id uuid nullable
- project_id uuid nullable
- role text              -- DISCOVERY | SPECIFICATION | ARCHITECTURE | TASK_DECOMPOSITION | REVIEW | CONVERGENCE
- ai_profile_id uuid fk
- created_by uuid nullable
- created_at timestamptz
- updated_at timestamptz
```

Enforce one active binding per scope + role. Project binding overrides workspace binding; workspace overrides the operator-managed system default. A binding may reference only a profile valid for that scope (project bindings use profiles available to the project workspace or a system profile).

## 26. AI generation runs

```sql
ai_generation_runs
- id uuid pk
- workspace_id uuid fk
- project_id uuid nullable
- artifact_id uuid nullable
- role text
- ai_profile_id uuid fk
- provider_connection_id uuid fk
- model_id text
- status text
- started_at timestamptz
- ended_at timestamptz nullable
- latency_ms bigint nullable
- input_units bigint nullable
- output_units bigint nullable
- error_code text nullable
- trace_id text nullable
- request_metadata jsonb
- response_metadata jsonb
```

Do not persist raw secret-bearing request headers. Raw prompts/responses are optional retention-controlled artifacts, not required columns. Generated artifact revisions reference the generation run through `artifact_revisions.ai_generation_run_id`; avoid a second reverse FK from the generation run to the revision.

## 27. Audit log

```sql
audit_events
- id uuid pk
- workspace_id uuid fk
- project_id uuid nullable
- actor_type text
- actor_id text
- source text
- action text
- entity_type text
- entity_id text
- metadata jsonb
- occurred_at timestamptz
```

Audit events should be append-only at application level.
