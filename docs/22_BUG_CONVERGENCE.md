# Bug and Convergence Workflow

## 1. Why bugs are separate from task status

A bug answers:

> What behavior is defective?

A task status answers:

> Where is a planned unit of work in its execution lifecycle?

These are not the same dimension.

A task may be:
- `IN_PROGRESS` while a bug is discovered;
- `DONE` and later linked to a regression bug;
- `NEEDS_REVIEW` while reviewer creates a bug.

## 2. Bug specification

Minimum bug record:

```yaml
id: BUG-017
title: Concurrent claim returns 500

current_behavior: >
  A second simultaneous claim can return HTTP 500.

expected_behavior: >
  Exactly one claim succeeds; the losing request returns
  deterministic conflict.

unchanged_behavior: >
  Existing valid single claim still succeeds, and an already claimed task
  remains owned by the original executor.

reproduction:
  - Start two claim requests simultaneously.
  - Observe one succeeds and one returns 500.

severity: MAJOR

links:
  task: TASK-084
  run: RUN-102
  acceptance_criterion: AC-012-04
```

`severity` uses the implemented enum — `BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`,
`TRIVIAL` — and `unchanged_behavior` is a single free-text field (the record
protects against over-broad fixes by stating what must keep working).

The `unchanged_behavior` field is important because it protects against over-broad fixes.

## 3. Bug triage state

```text
REPORTED
   ↓
ASSESSING
   ├── NOT_A_BUG
   ├── DUPLICATE
   └── CONFIRMED
          ↓
       PLANNED
          ↓
       IN_FIX
          ↓
       VERIFYING
          ↓
       VERIFIED
          ↓
       CLOSED
```

## 4. Bug fix planning

A confirmed bug should produce:
- assessment;
- root-cause hypothesis/evidence;
- fix design;
- regression requirements;
- one or more atomic tasks.

Do not directly expand the original completed task.

## 5. Regression task requirements

A fix plan should usually include:
- reproduction test or failing test;
- implementation fix;
- regression verification.

These may be one task if tightly bounded or separate tasks if independently reviewable.

## 6. Convergence purpose

Convergence asks:

> Does the current implemented result actually satisfy the approved specification?

It is run after normal task implementation, not instead of implementation review.

## 7. Convergence inputs

Minimum:
- active approved requirements revision;
- active approved design revision;
- tasks and final statuses;
- latest approved run evidence;
- bugs;
- waivers.

Optional connected-repository evidence:
- current commit;
- repository analysis;
- tests;
- API schema;
- generated artifacts.

## 8. Convergence result model

For each relevant source requirement/criterion:

```yaml
source: AC-012-04
status: PARTIAL
severity: HIGH
evidence:
  - TASK-084
  - RUN-102
finding: >
  Single claim is verified, but no evidence proves two simultaneous
  claim requests cannot both succeed.
```

Statuses:
- `COVERED`;
- `PARTIAL`;
- `MISSING`;
- `CONTRADICTED`;
- `NOT_APPLICABLE`.

## 9. Convergence findings

Finding categories:
- missing implementation;
- incomplete acceptance;
- design drift;
- unverified behavior;
- stale task;
- open blocking bug;
- requirement contradiction.

## 10. From finding to task

Example:

```text
Finding CVG-009
AC-012-04 unverified under concurrency
       ↓
Generate Task
       ↓
TASK-091
Add concurrent task-claim integration test
```

The new task links to:
- convergence finding;
- requirement/AC;
- feature.

## 11. Feature completion gate

Feature can become `COMPLETE` only if:
- all required tasks done;
- no blocking bug open;
- no blocking convergence finding;
- no stale required planning artifact;
- required review policy satisfied.

## 12. Waiver

Some findings may be intentionally waived.

Waiver requires:
- authorized reviewer;
- reason;
- risk;
- timestamp.

Waiver is evidence, not deletion.

## 13. Continuous convergence

Future option:

Run convergence:
- after each feature;
- before release;
- after major requirement revision.

Do not run expensive repository-wide AI convergence after every tiny task by default.

## 14. Known gaps (from the 2026-10-01 delivery audit)

Recorded in the locally archived delivery audit. The app shell now reaches the release check (2026-10-02, R4: a screen outside the shell is CONTRADICTED); still open:

- **No rendered evidence.** The convergence context has the shell line and the key elements but no screenshots or render-check verdicts, so a screen far from its mockup still reads as COVERED when the run summary claims it (R5).
- **Cross-cutting requirements are judged per feature.** An NFR linked to every UI task lands in every feature scope; each run re-judges it and creates its own fix task (four near-identical tasks in the audited project). A requirement should have one owning feature (or a project-level check), and a finding should reuse an open fix task for the same requirement key.
- **Weak fix tasks.** `generateTaskFromFinding` creates tasks with no constraints and the finding sentence (a negative statement) as the acceptance criterion; `fix-context.ts` drops manual checks. Fix tasks should state the positive target and keep the requirement's manual or browser check.
- **Manual-verification requirements are not planned.** A requirement that says "verified by manual browser testing" gets no verification at decomposition time (the prompt discourages manual checks), so it only surfaces here, as evidence-only fix tasks.

## 15. Relationship to task generation

Initial planning:

```text
Spec → Design → Task Plan
```

After implementation:

```text
Implementation → Convergence → Gap Tasks
```

This creates a controlled loop until intent and implementation match sufficiently.
