# API modules

20 folders, 9 business domains. Each folder is one Elysia route group (`routes.ts`,
mounted in `src/index.ts`) over plain service functions (`service.ts`) that take a
`DbExecutor` first, so they run inside or outside a transaction.

## Core domains

| # | Domain | Folders | Owns |
|---|---|---|---|
| 1 | Discovery | `discovery/` | Idea → questions → facts; readiness, assumptions, one active session per project |
| 2 | Artifact & approval | `artifact/` | Revisions, approval, content fingerprint, STALE marking of what was derived |
| 3 | Spec planning | `planning/` (requirements, stack, design, render) | The approved requirements, locked stack and technical design |
| 4 | UI reference | `ux/` (`ux.ts` re-exports: draft, plan, draw, edit, comments, state; `routes.ts`) | Screen plan, drawn screens, lint and render check, approval gate (rules: `/aturan.md`) |
| 5 | Design system | `design-system/` | Presets, palette contrast, component libraries, mockup kit CSS, repo exports |
| 6 | Task planning | `task/`, `prompt/`, `export/` | Tasks from the design, readiness, dependency graph, work orders and prompts |
| 7 | Execution | `execution/`, `review/`, `bug/` | Claims, leases, runs, evidence, reviews, bugs and their fix tasks |
| 8 | Convergence | `convergence/` | Release check against the spec, feature completion |
| 9 | Agent connectivity | `agent/`, `cli/` (+ `apps/cli`, `apps/agent`, `packages/agent-cli`) | Machines, pairing, the daemon WebSocket gateway, repo-link policy; `cli/` serves the bundled `sddctl` and its installers (`/api/v1/cli/*`) |

## Foundation

`auth/`, `workspace/`, `project/`, `audit/`, `notification/` — used by every domain,
depend on none. `ai/` exposes the AI provider settings; the gateway itself is
`packages/ai`. `mcp/` mounts the MCP server over the task and execution services.

## Dependency direction

```
foundation ← artifact ← planning · ux · design-system ← task · prompt · export
          ← execution · review · bug ← convergence        (agent beside execution)
```

A module imports only from its left. The one exception — `artifact/service.ts`
checking a UI reference before approval — loads `ux/ux-approval.ts` with a
dynamic `import()` so the two files never import each other at load time.

## Where to start reading

| To change… | Read first |
|---|---|
| What an approval refuses, or what goes STALE | `artifact/service.ts` → `approveRevision`, `markDerivedArtifactsStale` |
| A UI-reference rule or finding | `ux/ux-rules.ts` (catalogue), then `ux-lint.ts` / `ux-render.ts` |
| How tasks are generated or become READY | `task/generation.ts` → `generateTasks`; `task/readiness.ts` → `computeTaskReadiness` |
| How a run is claimed, started or submitted | `execution/claim.ts`, `runs.ts`, `evidence.ts`, `scheduler.ts` |
| What the local agent receives | `agent/gateway.ts`, `task/work-order.ts` |

Agent-facing notes with the invariants live in `.serena/memories` (start at `core`,
then `architecture/modules`).
