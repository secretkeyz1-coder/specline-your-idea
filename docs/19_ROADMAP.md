# Product Roadmap

## Stage 0 — Planning prototype

Goal: validate the planning UX.

Features:
- high-level idea;
- provider connection + AI Profile setup;
- focused adaptive discovery questions;
- requirements generation;
- stack selection (AI recommendation or manual);
- design generation;
- task generation;
- Copy Agent Prompt.

No local execution connectivity required; user-owned planning AI provider configuration is required unless an instance administrator supplies a default.

## Stage 1 — Controlled connected execution

Goal: prove local agent can report work to web control plane.

Features:
- `sddctl`;
- login;
- project link;
- task context;
- claim/start;
- progress/test/block/submit;
- execution timeline;
- review;
- task status state machine.

This is the most important technical milestone.

## Stage 2 — MCP interoperability

Goal: make agent integration vendor-neutral.

Features:
- Remote MCP;
- task/context tools;
- execution-reporting tools;
- scoped authorization;
- MCP compatibility tests.

Agent can operate without learning proprietary CLI commands if its host supports MCP.

## Stage 3 — Bugs and convergence

Goal: prove task completion does not equal feature correctness.

Features:
- bug specs;
- fix-task generation;
- convergence analysis;
- gap-to-task loop;
- feature completion gate.

## Stage 4 — Local daemon

Goal: move from "agent pulls task" to approved remote dispatch.

Features:
- `sdd-agent`;
- machine registry;
- outbound WSS;
- adapters;
- Run on Local Agent;
- log streaming;
- cancellation.

## Stage 5 — Safe multi-agent orchestration

Features:
- multiple connected machines;
- capability routing;
- task scheduler;
- parallel task conflict checks;
- lease-based scheduling;
- repository worktree strategy;
- per-agent performance metrics.

## Stage 6 — Git lifecycle integration

Features:
- branch/worktree creation;
- commit evidence;
- GitHub/GitLab integration;
- PR creation;
- review synchronization;
- CI status as validation evidence.

## Stage 7 — Team and organization controls

Features:
- advanced RBAC;
- SSO;
- organization policies;
- audit export;
- approval rules;
- managed MCP policy;
- agent allowlists;
- secret/KMS integration.

## Stage 8 — Planning intelligence

Features:
- reuse prior project patterns;
- architecture decision library;
- task-size learning from actual run history;
- estimate task failure risk;
- automatically recommend agent capability by hardness;
- planning quality analytics.

## Product sequencing principle

Do not start with autonomous multi-agent scheduling.

First prove:

```text
Good Specification
      ↓
Good Atomic Task
      ↓
Reliable Task State
      ↓
Reliable Evidence
      ↓
Reliable Review
```

Only then increase autonomy.
