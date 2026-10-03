# User Acceptance Test Plan

## 1. Goal

Prove that the platform can take a real software idea through planning, local AI execution, review and convergence.

## 2. Test environment

Required:
- production-like web/API;
- PostgreSQL;
- configured planning AI provider;
- one test workspace;
- one local machine;
- one local Git repository;
- `sddctl`;
- at least one local coding agent;
- MCP-capable agent for MCP scenarios;
- optional `sdd-agent` for daemon scenarios.

## 3. UAT-001 — Create project from high-level idea

**Given**
User is authenticated.

**When**
User creates project with only:
- name;
- high-level idea.

**Then**
- project exists;
- discovery starts;
- no tech stack is forced.

**Pass**
No detailed pre-planning form is required.

## 4. UAT-002 — Adaptive discovery

**When**
User answers the current focused discovery question.

**Then**
- answer appears in history;
- discovery brief updates;
- the next focused question reflects remaining gaps;
- only one primary question is emphasized by default;
- questions are not simply static form order.

## 5. UAT-003 — Blocking ambiguity

**Given**
A critical workflow decision is unanswered.

**Then**
Discovery shows it as blocking and does not claim clean readiness.

## 6. UAT-004 — Proceed with assumption

**When**
User selects proceed with assumption.

**Then**
- assumption is visible;
- user acceptance is recorded;
- planning may continue;
- audit contains action.

## 7. UAT-005 — Requirements generation

**When**
Discovery is ready.

**Then**
Generated requirements include:
- actors;
- workflows;
- functional requirements;
- acceptance criteria;
- assumptions/exclusions.

## 8. UAT-006 — Requirements revision

**When**
User edits an approved requirement.

**Then**
- previous approved revision remains available;
- new revision is created;
- downstream impact is visible after approval.

## 9. UAT-007 — AI recommended stack

**When**
User chooses Recommend for me.

**Then**
- multiple feasible options are shown when appropriate;
- tradeoffs are explained;
- recommendation is justified from requirements.

## 10. UAT-008 — Custom stack

**When**
User chooses a compatible custom stack.

**Then**
User choices remain unchanged and can be approved.

## 11. UAT-009 — Conflicting custom stack

**When**
User chooses technology that conflicts with requirements.

**Then**
The system flags conflict instead of silently replacing technology.

## 12. UAT-010 — Per-layer AI assist in manual stack

**When**
User manually locks frontend/database and asks AI to suggest only the unresolved deployment layer.

**Then**
- locked values are preserved;
- AI only proposes the requested unresolved layer;
- no separate third stack mode is required.

## 13. UAT-011 — Design generation

**Then**
Design explicitly derives from approved requirements and stack revision.

## 14. UAT-012 — Task generation

**Then**
- tasks are discrete;
- each feature task traces to requirement/AC;
- dependencies exist;
- task contract contains verification.

## 15. UAT-013 — Dependency cycle

**When**
A user attempts to create a cycle.

**Then**
The server rejects the change with actionable error.

## 16. UAT-014 — Task lint

**Given**
Task has no verification.

**Then**
It cannot become READY.

## 17. UAT-015 — Standalone prompt

**When**
User copies standalone prompt.

**Then**
- prompt contains task ID/objective/AC/scope/verification;
- no token/API key is present;
- task can be understood in an offline copy.

## 18. UAT-016 — CLI login

**When**
User runs:

```bash
sddctl login
```

**Then**
Authentication succeeds without putting credential inside repository file.

## 19. UAT-017 — Link local repository

**When**
User links project from repository root.

**Then**
- repository link is created;
- local metadata contains no bearer token.

## 20. UAT-018 — Fetch task context

**When**

```bash
sddctl task context TASK-X --format agent
```

**Then**
Only relevant context is returned and exact task ID matches.

## 21. UAT-019 — Atomic claim

**When**
Two executors simultaneously claim same READY task.

**Then**
Exactly one succeeds.

The other receives deterministic conflict.

## 22. UAT-020 — Status progression

**When**
Winning executor starts task.

**Then**
UI progresses through server-authorized states and timeline records events.

## 23. UAT-021 — Report test

**When**
CLI reports passed test.

**Then**
Test evidence appears on task run.

## 24. UAT-022 — Block task

**When**
Agent blocks due to ambiguity.

**Then**
- task shows Blocked;
- reason is visible;
- reviewer/user can resolve and requeue.

## 25. UAT-023 — Submit for review

**When**
Required validation is present and agent submits.

**Then**
Task becomes Review, not automatically Done unless policy allows it.

## 26. UAT-024 — Request changes

**When**
Reviewer requests changes.

**Then**
- findings stored;
- task becomes Rework;
- next execution creates a new run attempt;
- original run remains visible.

## 27. UAT-025 — Approve

**When**
Reviewer approves valid run.

**Then**
Task becomes Done and approval audit event exists.

## 28. UAT-026 — Lease expiry

**Given**
Connected executor stops heartbeat.

**Then**
- lease expires according to policy;
- attention state appears;
- system does not falsely mark implementation successful.

## 29. UAT-027 — MCP task retrieval

**When**
Authorized MCP client calls `task_get`.

**Then**
Correct scoped work order is returned.

## 30. UAT-028 — MCP unauthorized write

**When**
Read-only token calls `task_claim`.

**Then**
Operation is denied and audited.

## 31. UAT-029 — MCP execution flow

Authorized MCP client performs:
- task_get;
- task_claim;
- task_start;
- test report;
- request review.

All states match REST/CLI behavior.

## 32. UAT-030 — Bug entity

**When**
Reviewer creates a bug.

**Then**
Task workflow does not change to a fictional BUG state.

Bug has independent lifecycle and links.

## 33. UAT-031 — Bug fix tasks

**When**
Confirmed bug generates fix plan.

**Then**
New task(s) reference bug and relevant requirement.

## 34. UAT-032 — Convergence missing criterion

**Given**
All original tasks are Done but one acceptance criterion lacks implementation/evidence.

**Then**
Feature is not Complete.

Convergence finding identifies gap.

## 35. UAT-033 — Generate convergence task

**When**
User accepts convergence finding.

**Then**
New traceable task is generated and feature remains active.

## 36. UAT-034 — Stack change after tasks generated

**When**
Approved stack changes materially.

**Then**
Affected design/tasks are marked stale or require revalidation.

No history is silently deleted.

## 37. UAT-035 — Manual external execution

**When**
User does not use CLI/MCP.

**Then**
User can:
- copy standalone task prompt;
- execute externally;
- record manual execution evidence;
- submit review.

## 38. UAT-036 — Daemon connected

**When**
`sdd-agent` connects.

**Then**
Website shows machine online and capabilities.

## 39. UAT-037 — Remote dispatch

**When**
User confirms Run on Local Agent.

**Then**
- structured dispatch sent;
- correct linked repository selected;
- local agent starts;
- run events stream to website.

## 40. UAT-038 — Wrong repository dispatch

**Given**
Task project and linked repo do not match.

**Then**
Daemon rejects execution.

## 41. UAT-039 — Cancel run

**When**
Authorized user cancels active daemon run.

**Then**
- local process cancellation attempted;
- event and final run state recorded;
- task does not become Done.

## 42. UAT-040 — Secret leakage

Inspect:
- copied prompts;
- API errors;
- logs;
- export ZIP.

**Pass**
No provider key, auth token or refresh secret appears.

## 43. UAT-041 — Cross-workspace access

User from workspace A attempts direct API access to workspace B object.

**Pass**
Denied.

## 44. UAT-042 — Duplicate event retry

Same idempotency key is submitted twice.

**Pass**
No duplicate side effect.

## 45. UAT-043 — Export

Export planning bundle.

**Pass**
Contains approved planning artifacts/tasks and version metadata, but no credentials.

## 46. UAT-044 — Backup/restore

Restore production-like backup to clean instance.

**Pass**
Projects, planning revisions, tasks, runs and audit records remain coherent.

## 47. UAT-045 — Bring-your-own provider credential

**When**
User configures a supported provider using their own API credential and runs connection test.

**Then**
- connection can be saved/tested;
- normal reads never return the plaintext credential;
- planning can use the configured profile.

## 48. UAT-046 — OpenAI-compatible custom endpoint

**When**
User configures a custom OpenAI-compatible base URL and model.

**Then**
- request uses the custom endpoint/model;
- artifact generation records effective provider/profile/model attribution.

## 49. UAT-047 — Generic custom HTTP safety

**When**
User configures a declarative custom HTTP mapping.

**Then**
- allowed request/response mapping works;
- arbitrary executable expression/code is rejected;
- blocked SSRF/private target policy is enforced for hosted mode;
- secret headers are redacted.

## 50. UAT-048 — AI role routing

**Given**
Workspace default uses Profile A and project Review role overrides to Profile B.

**When**
Discovery and Review generations run.

**Then**
- Discovery resolves Profile A;
- Review resolves Profile B;
- generation-run records show the effective profile/provider/model.

## 51. UAT-049 — Open-source reference UI

**When**
User traverses idea → discovery → stack → plan.

**Then**
- UI remains guided and progressively disclosed;
- no monetization-tier/upsell controls appear;
- external reference branding/layout is not reproduced.

## 52. MVP sign-off

MVP is accepted only when UAT-001 through UAT-035, UAT-045 through UAT-049, and security-critical scenarios pass.

Daemon UATs may be moved to MVP.2 if daemon is not part of initial release.
