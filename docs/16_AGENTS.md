# AGENTS.md

Instructions for AI coding agents implementing the Agentic SDD Control Plane.

## 1. Mission

Implement tasks exactly against the approved specification and task contract.

Do not expand scope merely because an adjacent improvement seems useful.

## 2. Source-of-truth precedence

When instructions conflict, use:

1. approved project constitution;
2. approved requirements / accepted user decisions;
3. approved architecture decisions and technical design;
4. locked technology stack and applicable specialist contracts (API/data/state/security/UI);
5. repository-level AGENTS.md execution rules;
6. current task contract as the specific work package inside the boundaries above;
7. local module conventions and existing code.

A task is specific, but it may not override a higher-level approved constraint. If two mandatory artifacts cannot be satisfied together, block the task instead of guessing.

Before implementation, also read `27_OPEN_DECISIONS.md`. A task explicitly blocked by an open owner decision must remain blocked until that decision is recorded.

## 3. Before coding

For every task:

1. read task objective;
2. read acceptance criteria;
3. inspect dependencies;
4. inspect only relevant design/context;
5. inspect target code;
6. identify required verification;
7. confirm scope.

Do not begin implementation if a required dependency is incomplete.

## 4. Scope discipline

Respect:
- expected paths;
- forbidden paths;
- constraints;
- stop conditions.

If safe implementation requires a forbidden or materially unrelated change:
- report/block;
- do not silently broaden scope.

## 5. No architecture improvisation

Do not:
- replace major framework;
- introduce new infrastructure;
- add persistent service;
- change database technology;
- change authentication model;

unless the task explicitly authorizes it.


## 5A. Locked implementation stack

Unless a task explicitly changes the approved stack, use:
- SvelteKit + Svelte 5 + TypeScript for `apps/web`;
- Bun + Elysia + TypeScript for `apps/api`;
- PostgreSQL + Drizzle ORM/Drizzle Kit for persistence;
- Bun + TypeScript for `apps/cli` and `apps/agent`;
- shared runtime contracts from `packages/contracts`.

Do not introduce a second backend language, Prisma, a second ORM, Next.js/React, or a separate microservice framework as an implementation shortcut.

## 6. Dependencies

Do not add a new external dependency simply for convenience.

If a dependency is necessary:
- justify it;
- ensure it fits the approved stack;
- mention it in run summary.

## 7. Database

Every schema change:
- changes the Drizzle schema intentionally;
- uses a Drizzle Kit migration;
- includes rollback strategy where feasible;
- is tested;
- preserves existing data semantics unless migration says otherwise.

Never manually mutate production data as part of implementation.

## 8. State machines

Never bypass domain transition services by directly updating status columns from random handlers.

All task/run/review/bug transitions must use the defined domain layer.

## 9. Authorization

Never rely only on UI hiding.

Server-side permission checks are mandatory.

Every project/workspace object read/write must be scoped to authorized membership.

## 9A. Frontend reference discipline

For UI tasks:
- follow `14_UI_UX_SPEC.md` for interaction behavior;
- follow `25_FRONTEND_DESIGN_SPEC.md` and `frontend_reference.html` for visual direction;
- do not pixel-copy external screenshots;
- do not introduce pricing-tier/upsell controls into the open-source core UI.

## 10. AI-generated content

Treat model output as untrusted. Provider connections, AI Profiles and role bindings are separate domain concepts; do not collapse them for convenience.

Validate structured model response before persistence.

Do not let model output directly trigger privileged actions.

## 10A. Custom AI providers

Generic custom HTTP mappings are declarative only. Never execute user-supplied JavaScript or arbitrary template expressions. Route custom endpoints through the security/SSRF policy and redact secret headers.

## 11. Secrets

Never:
- hardcode secrets;
- print tokens;
- place API keys into generated prompts;
- commit local CLI credentials.

## 12. CLI

Agent-facing CLI commands must:
- support JSON where specified;
- use stable exit codes;
- produce actionable errors;
- avoid interactive prompts in machine mode.

## 13. MCP

MCP is an adapter.

Do not duplicate domain state rules inside MCP handlers.

Call the same application service used by REST/CLI paths.

## 14. Daemon

Server dispatch messages are structured intent, not arbitrary shell commands.

Validate:
- machine;
- repo binding;
- task;
- adapter;
- permissions;

before spawning a process.

## 15. Tests

Run all verification required by the task.

If a required test cannot be run:
- do not report it as passed;
- report reason;
- request review/block according to task contract.

For workflow code, prioritize:
- state-transition tests;
- concurrency tests;
- authorization tests;
- idempotency tests.

## 16. Definition of execution complete

Implementation execution can be submitted only when:
- requested change implemented;
- required tests attempted;
- relevant tests pass unless explicit documented waiver;
- summary produced;
- no known unreported blocker.

## 17. Do not self-approve

Implementation agent does not mark high-risk task accepted.

Submit to review.

## 18. Bug behavior

When a defect is discovered outside current task scope:
- report bug;
- link evidence;
- continue only if current task can safely complete.

Do not hide defect by silently increasing task scope.

## 19. Rework

For `CHANGES_REQUESTED`:
- read reviewer findings first;
- change only what is required plus necessary tests;
- preserve previous run history;
- create a new execution attempt.

## 20. Commit discipline

If task execution includes Git commits:
- keep commit focused;
- do not include unrelated local changes;
- include task ID in commit message if project convention requires it.

## 21. Progress reporting

Report meaningful milestones, not every shell command.

Useful:
- schema completed;
- endpoint implemented;
- test failed for specific reason;
- fix applied;
- validation passed.

Avoid noisy event spam.

## 22. Stop conditions

Stop and block when:
- requirement ambiguity changes behavior materially;
- design conflicts with code reality;
- dependency missing;
- credentials/environment required but unavailable;
- task requires unauthorized destructive action;
- requested work exceeds allowed scope.

## 23. Final run summary

Include:
- what changed;
- files/components changed;
- tests run and result;
- remaining limitation;
- known risk;
- commit/diff reference when available.

## 24. Never fabricate evidence

Do not claim:
- tests passed if not run;
- file changed if not changed;
- endpoint works if not verified;
- review approved if not approved.

Evidence integrity is more important than optimistic completion.
