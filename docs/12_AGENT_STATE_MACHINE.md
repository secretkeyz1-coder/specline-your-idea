# Agent and Task State Machines

## 1. Separate state dimensions

Avoid one overloaded status field.

### Workflow status

```text
DRAFT
READY
CLAIMED
IN_PROGRESS
VALIDATING
NEEDS_REVIEW
CHANGES_REQUESTED
BLOCKED
DONE
CANCELLED
```

### Execution result

```text
NONE
PASS
FAIL
PARTIAL
ABORTED
```

### Attention status

```text
NONE
NEEDS_INPUT
BUG_FOUND
LEASE_EXPIRED
AGENT_DISCONNECTED
POLICY_VIOLATION
```

## 2. Primary task state machine

```text
DRAFT
  │ task lint + approval
  ▼
READY
  │ claim transaction
  ▼
CLAIMED
  │ execution start
  ▼
IN_PROGRESS
  │
  ├──────────────→ BLOCKED
  │                  │
  │                  └── resolved → READY or IN_PROGRESS by policy
  │
  ▼
VALIDATING
  │
  ├── validation not satisfactory → IN_PROGRESS
  │
  ▼
NEEDS_REVIEW
  │
  ├── changes requested → CHANGES_REQUESTED
  │                         │
  │                         └── requeue → READY
  │
  └── approved → DONE
```

`CANCELLED` is terminal and can be reached only from allowed non-terminal states.

## 3. Transition table

| From | Action | To |
|---|---|---|
| DRAFT | ready task | READY |
| READY | claim | CLAIMED |
| CLAIMED | start | IN_PROGRESS |
| CLAIMED | release/cancel claim | READY |
| IN_PROGRESS | begin validation | VALIDATING |
| IN_PROGRESS | block | BLOCKED |
| VALIDATING | validation failed but fixable | IN_PROGRESS |
| VALIDATING | submit | NEEDS_REVIEW |
| VALIDATING | block | BLOCKED |
| NEEDS_REVIEW | approve | DONE |
| NEEDS_REVIEW | request changes | CHANGES_REQUESTED |
| CHANGES_REQUESTED | requeue | READY |
| BLOCKED | unblock/replan | READY or IN_PROGRESS |
| allowed non-terminal | cancel | CANCELLED |

All other transitions are rejected by default.

## 4. Implementer authority

An implementer may:
- claim;
- start;
- report progress;
- report test;
- block;
- request review.

An implementer does not directly approve its own task. A server-side review policy may auto-accept narrowly classified low-risk work after deterministic checks, but that is a policy decision, not an implementer action.

## 5. Lease lifecycle

```text
ACTIVE
  ├── heartbeat → ACTIVE
  ├── release → RELEASED
  ├── task completed → RELEASED
  └── timeout → EXPIRED
```

Lease expiry creates an attention event.

Do not automatically assume the local process stopped.

## 6. Run state

```text
CREATED
STARTING
RUNNING
VALIDATING
SUBMITTED
BLOCKED
FAILED
CANCELLED
FINISHED
```

A task can have multiple runs over time.

Example:

```text
TASK-084
 ├── RUN-1 → CHANGES_REQUESTED
 ├── RUN-2 → FAILED
 └── RUN-3 → APPROVED
```

## 7. Review lifecycle

```text
PENDING
  ├── APPROVED
  ├── CHANGES_REQUESTED
  ├── REJECTED
  └── WAIVED
```

Policy approval (`AUTO_RUN` link, every required check passed) never closes a web screen task that has no render check: it stays in `NEEDS_REVIEW` (`auto_approve_withheld`). A screen task with one has passed it — submitting requires every required check to pass. For a person reviewing a screen task the task page shows a checklist: the render check's result and screenshots, inside the shell, every key element, regions/order/copy as in the mockup at both widths, design tokens only.

## 8. Bug lifecycle

```text
REPORTED
   ↓
ASSESSING
   ↓
CONFIRMED
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

Alternative exits:
- `NOT_A_BUG`;
- `DUPLICATE`;
- `WONT_FIX`.

Bug workflow must not overwrite the original task execution history.

## 9. Feature lifecycle

```text
DRAFT
PLANNING
READY
IN_PROGRESS
CONVERGENCE
COMPLETE
BLOCKED
CANCELLED
```

A feature can enter `COMPLETE` only after convergence gate.

## 10. Planning artifact state

```text
DRAFT
GENERATING
READY_FOR_REVIEW
APPROVED
STALE
SUPERSEDED
FAILED
```

When an upstream approved artifact changes:
- downstream approved artifact may become `STALE`;
- already completed work remains historically valid but may generate new corrective tasks.

## 11. Status UI mapping

For non-technical users:

| Internal | UI label |
|---|---|
| DRAFT | Draft |
| READY | Ready |
| CLAIMED | Claimed |
| IN_PROGRESS | Running |
| VALIDATING | Testing |
| NEEDS_REVIEW | Review |
| CHANGES_REQUESTED | Rework |
| BLOCKED | Blocked |
| DONE | Done |
| CANCELLED | Cancelled |

## 12. Event-driven updates

Every state mutation creates an event.

Example:

```json
{
  "event_type": "task_transitioned",
  "task_id": "TASK-084",
  "from": "VALIDATING",
  "to": "NEEDS_REVIEW",
  "actor_type": "LOCAL_AGENT",
  "actor_id": "...",
  "reason": "required_validation_passed"
}
```

## 13. Server authority

The server is the only authority that commits state transition.

Clients request actions.

Correct:

```text
agent → request_review()
server → validate → transition
```

Avoid:

```text
agent → set status = DONE
```
