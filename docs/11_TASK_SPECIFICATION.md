# Atomic Task Specification

## 1. Task principle

> One task = one bounded outcome = one primary execution unit = one verifiable result.

This does not mean a task must change only one file. It means the task should have one coherent completion condition.

## 2. Bad task examples

```text
Build authentication.
```

Too large and ambiguous.

```text
Create the entire backend.
```

Not bounded.

```text
Fix all bugs in task execution.
```

Undefined completion.

## 3. Better examples

```text
Create database migration for task run and active lease entities.
```

```text
Implement atomic READY-task claim transaction.
```

```text
Add integration test proving concurrent task claims cannot both succeed.
```

## 4. Task contract schema

```yaml
id: TASK-084

title: Implement atomic task claim transaction

task_type: code

parent:
  feature_id: FTR-012
  requirement_ids:
    - FR-070
    - FR-071
  acceptance_criterion_ids:
    - AC-012-04

objective: >
  Ensure exactly one executor can acquire an active claim
  for a READY task.

status: READY

priority: P1

risk:
  hardness: 3
  level: MEDIUM
  factors:
    concurrency: 4
    blast_radius: 2
    security: 1
    database_impact: 3
    ambiguity: 1

dependencies:
  - TASK-081
  - TASK-082

scope:
  expected_paths:
    - apps/api/src/modules/task/**
    - apps/api/src/modules/execution/**
    - packages/db/drizzle/**
    - tests/integration/task/**
  forbidden_paths:
    - apps/web/**
    - apps/api/src/modules/auth/**

constraints:
  - Use a database transaction.
  - Do not add a new queue dependency.
  - Preserve existing API error envelope.

acceptance_criteria:
  - A READY task can be claimed.
  - The claim creates a run and active lease atomically.
  - A concurrent second claim cannot also succeed.
  - A non-READY task cannot be claimed.

verification:
  required:
    - type: command
      command: bun test apps/api/src/modules/task
    - type: command
      command: bun test apps/api/tests/integration/task
  evidence:
    - test_result

deliverables:
  - implementation
  - automated_tests
  - execution_summary

stop_conditions:
  - The current schema cannot enforce required semantics without redesign.
  - The requirement conflicts with an approved design decision.
  - Required dependency task is incomplete.

review_policy:
  type: HUMAN_OR_APPROVED_REVIEWER
```

## 5. Task types

- `code`
- `test`
- `database`
- `frontend`
- `backend`
- `integration`
- `documentation`
- `infrastructure`
- `security`
- `research`
- `bugfix`
- `refactor`

Task type is descriptive, not workflow status.

## 6. Task lint

A task cannot become `READY` until lint passes.

### Required checks

1. Has a stable ID.
2. Has a title.
3. Has a bounded objective.
4. Has source traceability.
5. Has explicit acceptance criteria.
6. Has verification.
7. Has scope.
8. Has deliverables.
9. Has stop conditions.
10. Dependencies exist.
11. Dependency graph remains acyclic.
12. No unresolved blocking placeholder.
13. Parent artifact revisions are current.
14. Task is not trivially duplicate.
15. Risk/hardness exists.
16. Review policy resolved.
17. A web screen task has a render check (`no_render_check`, blocking) — see below.

### Screen tasks (approved UI reference)

A task builds a screen when a constraint names the screen's mockup: the screen constraint sentence ("Layout, elements … follow `docs/ui-reference/<key>.html` …"), or — if the model reworded it — any `docs/ui-reference/*.html` in a constraint, unless the task's title names the app shell.

- **Inside the shell.** The constraint sentence ends with "it renders inside the app shell, no full-screen wrapper or navigation of its own (unless listed outside the shell)". The design-system setup task owns the root layout (global styles, tokens, viewport meta); one shell task owns the layout around every in-app route, lists each shell utility in its acceptance criteria, and every screen task depends on it.
- **Render check (web references).** A required Playwright command, `e2e/render/<screen key>.spec.ts`, that opens the screen's route at 1280×800 and 360×800 — signing in first through a shared fixture and seeding or stubbing the data its key elements need — asserts each key element (and, inside the shell, the shell navigation) is visible, and saves `docs/ui-reference/renders/<key>-1280.png` and `-360.png`. A jsdom or unit test is not a render check. The design-system setup task installs Playwright and its Chromium browser. Lint finding `no_render_check` is BLOCKING; a DRAFT task can get the standard command from the task list ("Add render check", `POST /tasks/{id}/render-check`). Native-mobile references have no render check.
- **Key elements.** Lint finding `key_elements_missing` (HIGH, not blocking) names the screen's key elements no acceptance criterion carries (fewer than 60% of an element's words appear in the criteria).
- **Generation.** One repair turn asks for whatever the first plan lacks — the shell task, the render checks — and is kept only if it is better and no worse.

## 7. Additional quality checks

### Ambiguity

Flag words such as:
- appropriate;
- fast;
- modern;
- user-friendly;
- secure;
- optimize;
- handle everything;

unless they are operationally defined.

### Size

Potentially too large if task:
- spans many unrelated modules;
- contains multiple independent outcomes;
- has many unrelated acceptance criteria;
- would likely require multiple separate review decisions.

The AI may recommend split, but user can override with justification.

## 8. Hardness model

Hardness is not merely "easy/medium/hard".

Factors 0–5:
- ambiguity;
- blast radius;
- cross-module impact;
- concurrency complexity;
- database impact;
- security sensitivity;
- integration uncertainty;
- verification difficulty;
- expected context size.

Derived score maps to 1–5.

Hardness affects:
- agent recommendation;
- review policy;
- whether autonomous execution is permitted.

## 9. Parallel safety

`parallel_safe = true` means task is a candidate for parallel execution.

It is not unconditional.

Runtime scheduler still checks:
- dependencies;
- declared path overlap;
- repository branch/worktree strategy;
- shared external resource conflicts.

## 10. Dependency outputs

A task can reference required outputs from dependencies.

Example:

```yaml
dependency_outputs:
  TASK-081:
    - migration_name
    - schema_contract
```

Agent context should include only relevant dependency summaries, not every prior run log.

## 11. Task prompt modes

### Standalone

Includes:
- task contract;
- required project rules;
- relevant requirements;
- relevant design excerpts;
- verification commands.

### Connected CLI

Includes:
- task ID;
- initial `sddctl` commands;
- execution protocol.

### Connected MCP

Includes:
- task ID;
- instruction to fetch context using MCP;
- required reporting tools.

## 12. Task revision behavior

A task that has not begun may be edited and versioned.

A task already executed should not silently mutate.

Material change should:
- create task revision;
- invalidate unreviewed run if needed;
- log change;
- possibly require new execution attempt.

## 13. Definition of execution complete

Agent execution is complete when:
- implementation activity ended;
- required verification was attempted;
- result summary exists;
- task moved to review or blocked.

This is not the same as task acceptance.

## 14. Definition of task done

Task is `DONE` when:
- required verification passes or approved waiver exists;
- required review policy is satisfied;
- no blocking review finding remains;
- server performs the legal transition to `DONE`.
