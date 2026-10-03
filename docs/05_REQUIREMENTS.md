# System Requirements

Identifiers are stable and should be referenced by implementation tasks.

## A. Project and workspace

### FR-001
The system shall allow an authorized user to create a workspace.

### FR-002
The system shall allow a user to create a project using only a project name and high-level idea.

### FR-003
The system shall allow optional initial constraints to be attached to the project.

### FR-004
The system shall maintain project lifecycle state.

## B. Discovery and clarification

### FR-010
The system shall initiate a discovery session from a high-level idea.

### FR-011
The planning AI shall ask adaptive clarification questions chosen from current discovery gaps.

### FR-012
The default discovery UI shall present one primary high-impact question at a time instead of a large static questionnaire.

### FR-013
Each discovery question shall record topic, impact, answer type, answer and status.

### FR-014
The system shall record explicit user facts separately from AI assumptions.

### FR-015
The system shall detect and surface contradictions between answers.

### FR-016
The system shall calculate discovery readiness using required coverage and unresolved blocking questions.

### FR-017
The user shall be able to explicitly proceed with documented assumptions.

### FR-018
The system shall preserve discovery history.

### FR-019
The discovery UI shall expose a concise summary of facts/constraints already understood by AI so the user can correct them.

## C. Requirements

### FR-020
The system shall generate a requirements artifact from discovery output.

### FR-021
Requirements shall include actors, workflows, functional behavior, acceptance criteria, exclusions, assumptions and non-functional requirements where relevant.

### FR-022
The user shall be able to edit generated requirements.

### FR-023
The user shall be able to request AI refinement of requirements.

### FR-024
Requirements approval shall create an immutable versioned baseline.

### FR-025
A later modification shall create a new revision rather than silently mutating an approved baseline.

## D. Technology stack

### FR-030
The system shall expose two top-level stack-selection modes: `RECOMMENDED` and `MANUAL`.

### FR-031
In recommended mode, AI shall provide feasible options where meaningful and identify a recommendation.

### FR-032
AI stack recommendations shall explain rationale and tradeoffs.

### FR-033
In manual mode, the system shall preserve user-selected technologies.

### FR-034
The system shall validate stack choices against approved requirements and identify material conflicts.

### FR-035
In manual mode, a user may ask AI to suggest an unresolved individual technology layer without replacing already locked selections.

### FR-036
The user shall approve a stack baseline before technical design is finalized.

### FR-037
Changing an approved stack shall create a new revision and trigger downstream impact analysis.

## E. Technical design

### FR-040
The system shall generate a technical design from approved requirements and stack.

### FR-041
Technical design shall include architecture and component boundaries.

### FR-042
The system shall support data-model artifacts.

### FR-043
The system shall support API/interface contract artifacts.

### FR-044
The design shall include relevant workflow/state-machine definitions.

### FR-045
The design shall include a test/verification strategy.

### FR-046
The user shall be able to refine and approve technical design.

### FR-047
The system shall provide a simplified high-level planning view derived from approved planning artifacts before exposing lower-level task detail.

## F. Tasks

### FR-050
The system shall generate implementation tasks from approved planning artifacts.

### FR-051
Each feature task shall link to at least one requirement or acceptance criterion.

### FR-052
The system shall support task dependencies as a directed graph.

### FR-053
The system shall reject dependency cycles.

### FR-054
The system shall calculate whether a task can safely enter `READY`.

### FR-055
Each executable task shall contain objective, scope, dependencies, constraints, acceptance criteria, verification, deliverables and stop conditions.

### FR-056
The system shall estimate task hardness/risk metadata.

### FR-057
The user shall be able to split, merge, edit, reorder or cancel draft tasks.

### FR-058
The system shall preserve task lineage to source artifact versions.

### FR-059
The system shall identify tasks that can potentially execute in parallel.

## G. Prompt handoff

### FR-060
The system shall generate a standalone copyable agent prompt for a task.

### FR-061
The system shall generate a connected-agent prompt referencing CLI/MCP context retrieval.

### FR-062
Generated prompts shall not contain credentials.

### FR-063
A prompt shall contain or retrieve the exact task ID.

## H. Task execution

### FR-070
The system shall support atomic task claim.

### FR-071
At most one active claim lease shall exist for a task unless an explicit multi-executor task type is introduced later.

### FR-072
An executor shall create a task run when execution begins.

### FR-073
The system shall record heartbeat or equivalent liveness for connected runs.

### FR-074
The executor shall be able to report progress events.

### FR-075
The executor shall be able to report file-change metadata.

### FR-076
The executor shall be able to report test/validation results.

### FR-077
The executor shall be able to block a task with reason and evidence.

### FR-078
The executor shall be able to request review.

### FR-079
The server shall enforce legal task state transitions.

### FR-080
Expired execution leases shall be recoverable according to policy.

## I. CLI

### FR-090
A local CLI shall authenticate to the platform.

### FR-091
The CLI shall link a local repository to a project.

### FR-092
The CLI shall store project-link metadata without committing credentials to the repository.

### FR-093
The CLI shall retrieve task context.

### FR-094
The CLI shall update task execution state.

### FR-095
The CLI shall report validation evidence.

### FR-096
The CLI shall support machine-readable JSON output.

### FR-097
The CLI shall return non-zero exit codes for failed commands.

## J. MCP

### FR-100
The platform shall expose a remote MCP endpoint.

### FR-101
The MCP endpoint shall expose read tools for project/task context.

### FR-102
The MCP endpoint shall expose scoped write tools for execution reporting.

### FR-103
MCP authentication shall not depend on tokens embedded in prompts.

### FR-104
MCP operations shall map to the same domain services and state validation used by REST APIs.

## K. Local daemon

### FR-110
An optional local daemon shall connect outbound to the platform.

### FR-111
The daemon shall register machine and execution-agent capabilities.

### FR-112
The daemon shall only execute tasks explicitly authorized for that machine/repository.

### FR-113
The daemon shall start local coding agents through configured adapters.

### FR-114
The daemon shall stream execution events.

### FR-115
The daemon shall support cancellation.

### FR-116
The daemon shall not expose a public inbound control port by default.

## L. Review

### FR-120
A reviewer shall see task requirements and execution evidence together.

### FR-121
A reviewer shall be able to approve a task.

### FR-122
A reviewer shall be able to request changes.

### FR-123
A review decision shall create an audit event.

### FR-124
Task completion shall obey review policy based on risk/classification.

## M. Bugs

### FR-130
The system shall represent bugs as independent entities.

### FR-131
A bug may link to a task, run, feature and acceptance criterion.

### FR-132
A bug shall store current behavior, expected behavior and unchanged behavior.

### FR-133
A confirmed bug shall be convertible into one or more fix tasks.

## N. Convergence

### FR-140
The system shall support feature convergence analysis.

### FR-141
Convergence shall compare approved specification intent with implementation evidence/current state.

### FR-142
Convergence gaps shall be stored as findings.

### FR-143
A convergence finding may generate a new traceable task.

### FR-144
A feature shall not be complete while a blocking convergence finding is unresolved.

## O. AI providers, profiles and routing

### FR-150
The system shall abstract planning/review AI providers and shall not require one vendor.

### FR-151
The system shall allow a user to configure supported provider API connections using their own credentials.

### FR-152
The system shall support OpenAI-compatible custom base URLs and model identifiers.

### FR-153
The system shall support a generic custom HTTP adapter using declarative request/response mappings.

### FR-154
Provider credentials and secret headers shall be encrypted at rest and shall not be returned by normal read APIs.

### FR-155
The system shall represent provider capability metadata such as structured output, tool use, vision and streaming.

### FR-156
The system shall represent an AI Profile separately from a Provider Connection.

### FR-157
An AI Profile shall select a provider connection, model identifier, model parameters and required capabilities.

### FR-158
The system shall support AI role bindings for Discovery, Specification, Architecture, Task Decomposition, Review and Convergence.

### FR-159
AI role resolution shall support system/workspace defaults and project overrides.

### FR-160
Every AI generation attempt shall record the resolved profile, provider/model, status, timing and artifact linkage.

### FR-161
Custom provider URLs shall be subject to SSRF/egress controls, timeout and response-size limits.

### FR-162
The custom HTTP adapter shall not execute arbitrary user-provided code for request/response mapping.

## P. Audit and history

### FR-170
Important state changes shall create audit records.

### FR-171
The system shall provide a human-readable activity timeline.

### FR-172
The system shall distinguish actions originating from web, CLI, MCP, daemon, AI and system automation.

## Q. Open-source/self-host behavior

### FR-180
The core application shall be usable without a commercial tier or mandatory hosted AI provider.

### FR-181
The self-hosted deployment shall support user-managed provider credentials.

### FR-182
The reference application UI shall not include monetization-tier or upsell controls.

## R. Non-functional requirements

### NFR-001 Security
All production web, API, realtime and remote MCP traffic shall use TLS.

### NFR-002 Authorization
Every protected operation shall be authorized server-side.

### NFR-003 Idempotency
Critical execution mutation APIs shall support idempotent retries.

### NFR-004 Concurrency
Task claim must remain correct under concurrent requests.

### NFR-005 Auditability
Execution and approval events shall be timestamped and attributable.

### NFR-006 Availability
A temporary realtime connection failure shall not corrupt task state.

### NFR-007 Portability
Core task work order data shall be exportable as Markdown/JSON.

### NFR-008 Agent neutrality
The core system shall not require a specific coding-agent vendor.

### NFR-009 AI provider neutrality
The planning/review layer shall not require a specific AI model vendor.

### NFR-010 Observability
The backend shall emit structured logs and trace identifiers for execution APIs and AI-generation operations.

### NFR-011 Performance
Interactive task/project reads should be designed for normal sub-second API response under expected MVP load, excluding AI generation.

### NFR-012 Data integrity
Approved artifact versions and completed run evidence must not be silently overwritten.

### NFR-013 Secret handling
Secrets shall not be logged or included in generated prompt artifacts.

### NFR-014 Recovery
PostgreSQL backups and restore procedures shall be documented and tested before production use.

### NFR-015 UX simplicity
Before a plan exists, the primary UI shall favor a guided flow with progressive disclosure rather than a dense permanent project dashboard.
