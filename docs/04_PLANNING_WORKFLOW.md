# Planning Workflow

## 1. Purpose

This document defines exactly how the planning engine turns a high-level idea into executable atomic work.

## 2. Planning state machine

```text
IDEA_DRAFT
    ↓
DISCOVERY_ACTIVE
    ↓
DISCOVERY_READY
    ↓
REQUIREMENTS_DRAFT
    ↓
REQUIREMENTS_APPROVED
    ↓
STACK_SELECTION
    ↓
STACK_APPROVED
    ↓
DESIGN_DRAFT
    ↓
DESIGN_APPROVED
    ↓
TASK_GENERATION
    ↓
TASK_REVIEW
    ↓
EXECUTION_READY
```

Optional states:
- `NEEDS_USER_INPUT`
- `STALE`
- `CANCELLED`

## 3. Phase A — High-level idea

Input should be intentionally lightweight:

```yaml
project_name: "Field Construction App"
idea: >
  I want an app to manage field progress, evidence,
  and PM approvals.
constraints:
  - "must work on mobile"
```

The planning agent must not respond by immediately selecting frameworks.

First, it extracts:
- known intent;
- explicit constraints;
- suspected actors;
- missing information;
- assumptions.

## 4. Phase B — Adaptive discovery

### 4.1 Question selection

The planning agent maintains a **Discovery Coverage Map**.

Example:

```yaml
problem:
  status: known

primary_users:
  status: partial

core_workflows:
  status: missing

roles_permissions:
  status: missing

data:
  status: partial

integrations:
  status: unknown

platform:
  status: known

nonfunctional:
  status: unknown

deployment_constraints:
  status: unknown
```

The engine should rank the highest-value missing information and normally surface **one primary question at a time**. Suggested answer choices may be grouped under that question.

### 4.2 Do not ask everything

Prioritize questions by whether the answer can materially change:
- product scope;
- architecture;
- data model;
- security;
- task decomposition.

Do not ask cosmetic questions before core workflow is understood.

### 4.3 Question format

Each question has:
- ID;
- topic;
- question;
- reason;
- answer type;
- options where useful;
- impact level.

Example:

```yaml
id: Q-012
topic: offline_behavior
question: "Does the field technician need to keep working without internet?"
reason: "This changes local storage and sync architecture."
answer_type: single_choice
options:
  - "No"
  - "Yes, read-only"
  - "Yes, full offline data capture"
  - "I don't know — recommend"
impact: high
```

### 4.4 Discovery answer processing

After each answer:
1. update fact;
2. update assumption;
3. detect contradiction;
4. update coverage;
5. select next question or declare readiness.

## 5. Discovery readiness gate

Use deterministic rules plus AI assessment.

### Required for most software projects

- explicit problem statement;
- primary actors;
- at least one primary end-to-end workflow;
- MVP scope;
- important exclusions;
- critical data type(s);
- important integration(s), if any;
- platform;
- auth/role expectation;
- major deployment constraint, if known.

### Gate outputs

`DISCOVERY_READY`
- no blocking ambiguity.

`READY_WITH_ASSUMPTIONS`
- unknowns exist, but user explicitly accepts documented assumptions.

`DISCOVERY_INCOMPLETE`
- one or more blocking questions remain.

## 6. Phase C — Requirements synthesis

The agent generates requirements without embedding implementation technology unless the requirement itself is technology-constrained by the user.

Example:

Correct:

> The system shall prevent two agents from holding an active execution lease on the same task.

Avoid:

> PostgreSQL SELECT FOR UPDATE shall prevent two agents...

The latter belongs in design.

## 7. Requirements approval

UI:
- artifact preview;
- inline edit;
- AI refine;
- unresolved assumptions panel;
- approve.

Approval creates immutable revision:
- `requirements_version`;
- checksum;
- approved_by;
- approved_at.

Later edits create a new draft revision.

## 8. Phase D — Tech-stack mode selection

Prompt:

> How do you want to choose the implementation stack?

Options:

### Recommend for me
The planner generates candidates based on requirements.

### I'll choose
The user enters choices.

Manual mode may still ask AI to recommend an individual unresolved layer while preserving every explicit user selection. This is assistance inside manual mode, not a third top-level mode.

## 9. AI stack recommendation

The stack recommender evaluates:
- application type;
- expected scale;
- local/offline needs;
- realtime;
- team skill constraints;
- deployment model;
- ecosystem maturity;
- operational burden;
- portability.

Each candidate is scored qualitatively, not with fake absolute precision.

Example:

| Dimension | Stack A | Stack B |
|---|---|---|
| Development speed | High | Medium |
| Runtime simplicity | Medium | High |
| Realtime support | High | High |
| Deployment complexity | Medium | Low |
| Fit for stated constraints | Strong | Strong |

The agent must explain tradeoffs.

## 10. Custom stack validation

When the user chooses:
- detect incompatible choices;
- suggest missing runtime pieces;
- do not silently replace user choice.

Example:

> You selected SQLite and multi-region horizontal writes. These requirements conflict. Choose whether to relax the architecture requirement or change database strategy.

## 11. Stack approval

Creates `STACK-vN`.

The baseline contains:
- chosen components;
- versions/ranges;
- decision rationale;
- rejected alternatives;
- user-locked values;
- assumptions.

## 12. Phase E — Technical design

Input:
- approved requirements;
- stack baseline;
- constitution/project rules.

Outputs:
- architecture;
- components;
- data model;
- contracts;
- workflows;
- state machines;
- error strategy;
- security;
- test plan;
- repository structure.

## 13. Design quality gate

Before tasks:
- each functional requirement has a design path;
- critical states have transitions;
- key entities exist;
- API boundaries are coherent;
- security expectations addressed;
- no unresolved `TBD` marked blocking.

## 14. Phase F — Task decomposition

### Decomposition hierarchy

```text
Project
  ↓
Feature
  ↓
User Story / Requirement Group
  ↓
Technical Slice
  ↓
Atomic Task
```

### Dependency-first generation

The task engine creates:
- tasks;
- `depends_on` edges;
- optional safe parallel groups.

### Example

```text
T001 Create task_runs migration
  ↓
T002 Implement task run repository
  ↓
T003 Implement claim transaction
  ↓
T004 Expose claim endpoint
  ↓
T005 Add concurrency integration test
```

## 15. Task readiness

A generated task starts as `DRAFT`.

It may enter `READY` only if:
- task lint passes;
- dependencies exist;
- dependency graph is acyclic;
- parent spec is approved/current;
- no blocking upstream artifact is stale;
- reviewer/owner approves execution plan if project policy requires it.

## 16. Change impact after planning

When requirements change:
1. create new requirements revision;
2. compute affected design sections;
3. mark dependent design/task artifacts `STALE`;
4. do not delete completed execution history;
5. regenerate or manually reconcile tasks.

## 17. Planning artifact lineage

Every artifact must store:

```yaml
project_id:
feature_id:
artifact_type:
version:
status:
derived_from:
  - artifact_id@version
generated_by:
approved_by:
created_at:
approved_at:
checksum:
```

This allows the system to answer:

> Which requirements version was TASK-084 generated from?
