# Project Constitution

This document contains non-negotiable rules for the Agentic SDD Control Plane itself.

## C1 — Specification traceability

Every executable implementation task must link to:
- one project;
- one feature or work package;
- at least one requirement or acceptance criterion, unless the task is explicitly classified as infrastructure/maintenance.

No orphan feature task may enter `READY`.

## C2 — No hidden completion

A task is not complete merely because an agent says it is complete.

Completion requires:
- implementation run ended;
- required verification executed;
- required evidence stored;
- review policy satisfied.

## C3 — State-machine integrity

Task states may only change through defined transitions.

The database must reject illegal transitions.

Examples:
- `DRAFT → DONE` is illegal.
- `READY → IN_PROGRESS` without a valid claim/run is illegal.
- `NEEDS_REVIEW → DONE` requires an approval decision unless policy explicitly allows auto-approval.

## C4 — Bugs are entities, not statuses

`BUG` is not a normal task workflow status.

A bug must be recorded as a defect entity and may be linked to:
- feature;
- task;
- agent run;
- release;
- acceptance criterion.

## C5 — Database is runtime source of truth

Task status, lease, execution run, review, bugs, and events must be stored in the application database.

Markdown may be generated as a portable snapshot but must not silently override runtime state.

## C6 — Planning artifacts are versioned

Requirements, design, stack decisions, and task plans must have revisions.

When an upstream artifact materially changes:
- impacted downstream artifacts are marked stale;
- affected tasks must be revalidated before execution.

## C7 — Requirements before technology

The planning agent must not prematurely lock technical implementation while the product problem is still ambiguous.

Tech-stack selection begins only after the minimum discovery gate is satisfied or the user explicitly chooses to continue with documented assumptions.

## C8 — Technology choice must be explicit

The user must be able to choose:
- **Use AI recommendation**; or
- **Choose manually**.

Manual selection may request AI assistance for individual unresolved technology layers without becoming a separate third workflow mode.

The selected stack becomes a versioned decision baseline.

## C9 — Atomic task rule

A task must represent one bounded outcome.

A task entering `READY` must define:
- objective;
- scope;
- dependencies;
- acceptance conditions;
- verification;
- expected deliverables;
- stop/block conditions.

## C10 — Minimal context principle

Agent work orders should contain the minimum context necessary to execute safely.

Do not include all project documents by default.

Use references and context packs selected from:
- task;
- parent acceptance criteria;
- relevant design sections;
- relevant contracts;
- relevant repository instructions.

## C11 — Local-first execution safety

Local execution must use outbound connections by default.

The user should not be required to expose a laptop port to the public internet.

The local agent bridge may execute only within explicitly linked repositories.

## C12 — Least privilege

Credentials must be scoped by:
- user;
- workspace;
- project;
- capability.

Agent tokens must not grant broader access than needed.

## C13 — No secrets in generated prompts

Copied prompts must never contain:
- access tokens;
- API keys;
- refresh tokens;
- passwords.

Connected prompts may refer to authenticated CLI/MCP tools without embedding credentials.

## C14 — Auditability

Every important operation must produce an immutable or append-only audit event:
- specification approved;
- stack locked;
- task created;
- task claimed;
- task started;
- task blocked;
- task validation result;
- review decision;
- bug created;
- task completed;
- task reopened.

## C15 — Evidence-based review

Review decisions should consider:
- task acceptance criteria;
- test evidence;
- diff/commit metadata when available;
- agent summary;
- reviewer findings.

## C16 — Vendor-neutral agent integrations

Core task models and APIs must not contain agent-specific semantics.

Agent-specific behavior belongs in adapters.

## C17 — Manual fallback

Every connected execution feature must have a manual fallback where reasonable.

A user must still be able to:
- copy a task prompt;
- mark a run as externally executed;
- upload or paste evidence;
- review work manually.

## C18 — Convergence before feature completion

A feature is only `COMPLETE` when:
- all required acceptance criteria are satisfied;
- no blocking task remains;
- no open blocking defect remains;
- convergence analysis finds no unresolved implementation gap.

## C19 — Migration safety

Database schema changes require reversible migrations or an explicit rollback strategy.

## C20 — Test critical state transitions

All workflow state transitions, lease behavior, permission checks, and idempotent APIs must have automated tests.

## C21 — Bring-your-own AI provider

The planning/review AI layer must not require a single hosted model vendor.

Users must be able to configure supported provider APIs and safe custom endpoints. Provider credentials never become part of generated project artifacts.

## C22 — Provider connection is separate from AI role profile

A provider connection stores how to reach/authenticate to a provider. An AI profile stores model/behavior configuration. Project role bindings select which AI profile performs discovery, specification, architecture, task decomposition, review, or convergence.

Do not collapse these into one provider row.

## C23 — Open-source core has no tier gating

The core self-hosted application must not hide normal planning/execution capabilities behind pricing-tier state. The reference UI must not contain monetization/upsell controls.

## C24 — Custom AI endpoints are untrusted network targets

Generic/custom provider configuration must use safe declarative mappings only. Never evaluate arbitrary user-supplied code for request/response mapping. Hosted deployments must apply SSRF/egress controls.
