# Documentation Audit — v5 Consistency Pass

> **Status reviewed 2026-10-03:** Original specification/research pack, not current implementation or verification certification. [Navigation](README.md). Code/configuration takes precedence; recorded audits/open decisions are not automatically current.

**Audit scope:** all canonical Markdown documents plus `frontend_reference.html`.

**Target product:** open-source Agentic SDD Control Plane.

## Locked product decisions after audit

1. High-level idea is the first project input.
2. Discovery is adaptive and normally presents one primary high-impact question at a time.
3. Requirements are approved before technology is locked.
4. Tech-stack UX has two top-level modes: AI Recommendation or Manual Selection. Manual mode can request AI help for an unresolved individual layer.
5. Technical design produces a simplified high-level planning view before deep task detail.
6. Atomic tasks are the execution unit; database state is authoritative.
7. Standalone copy prompt remains first-class.
8. `sddctl` is the primary connected local bridge; MCP is the standardized interoperability layer; `sdd-agent` daemon is later/optional remote dispatch.
9. Task execution, review, bugs and convergence remain separate domain concepts.
10. Planning/review AI is bring-your-own-provider and provider-neutral.
11. Provider Connection, AI Profile, AI Role Binding and AI Generation Run are separate domain concepts.
12. Generic custom HTTP provider mapping is declarative and SSRF/egress controlled.
13. Frontend uses SvelteKit/Svelte 5/TypeScript; backend/runtime/CLI/daemon use Bun + TypeScript; API uses Elysia; persistence uses PostgreSQL + Drizzle.
14. The core reference UI is open-source oriented with no monetization-tier/upsell controls.
15. External UI screenshots are UX inspiration only; canonical implementation references are the local UI specs and HTML prototype.

## Material inconsistencies fixed

### Discovery UX
Previous documents mixed small multi-question batches with the newer simple one-question UI direction. Standardized to one primary question at a time by default, while the engine may internally rank candidates.

### Tech-stack modes
Previous documents modeled Recommended / Custom / Hybrid as three top-level modes. Standardized to two modes: AI Recommendation and Manual. Partial AI assistance remains available per unresolved manual layer.

### AI provider data model
Previous provider configuration mixed connection and selected model, and referenced role/profile assignment without explicit tables. Added:
- `ai_provider_connections`;
- `ai_profiles`;
- `ai_role_bindings`;
- `ai_generation_runs`.

Also renamed local coding-agent profiles to `execution_agent_profiles` to avoid collision with planning AI Profiles.

### AI generation lineage
`artifact_revisions` had a dangling provider-run concept without a normalized generation-run table. Replaced with `ai_generation_run_id` and defined attribution/retention rules.

### Custom HTTP safety
Added explicit no-arbitrary-code mapping rule, SSRF/egress policy, secret-header separation, timeout/size controls and hosted-vs-self-hosted LAN behavior.

### MCP/CLI language consistency
Removed the remaining Go adapter-interface example and replaced it with TypeScript consistent with the locked Bun/TypeScript stack.

### Frontend consistency
Reconciled `14_UI_UX_SPEC.md` and `25_FRONTEND_DESIGN_SPEC.md` around the guided flow:

```text
Idea → Discovery → Requirements → Technology → High-Level Plan → Docs → Atomic Tasks → Agent Work Order
```

The initial wizard has no permanent sidebar/dense dashboard. Advanced execution views appear later through progressive disclosure.

### Open-source positioning
Removed legacy prototype variants from the canonical ZIP and standardized documentation around a self-hostable core without monetization-tier controls.


### Dependency-plan integrity

Replaced narrative/non-task dependency placeholders with concrete task IDs, removed the daemon from the mandatory initial-release gate, and made CLI + MCP part of the canonical connected-execution MVP while keeping the local daemon optional for MVP.2.

### Current external references

Updated the Spec Kit sequence to include its `checklist` quality gate and refreshed MCP guidance to the TypeScript SDK v2 / 2026-07-28 protocol line rather than pinning core guidance to older 2025 transport pages.

## Implementation-plan corrections

The atomic task plan was reindexed and expanded to cover:
- AI Profiles and role routing;
- AI generation-run attribution;
- generic custom HTTP adapter safety;
- focused discovery UI;
- simplified high-level planning map/outline;
- two-mode stack UX.

The final task graph is automatically checked for duplicate IDs, missing dependencies and numeric gaps.

## Remaining user decisions (not guessed)

The canonical register is `27_OPEN_DECISIONS.md`. Current unresolved items are:

1. Final product/brand name. `Agentic SDD Control Plane` remains a working title.
2. Open-source license (MIT, Apache-2.0, AGPL, etc.). Must be chosen explicitly before public release.
3. Authentication implementation/provider for the hosted/self-hosted reference app.
4. Whether a local planning-model relay (for Ollama/LM Studio on the user's laptop) belongs in MVP or after `sdd-agent`. Current hosted custom URLs do not pretend server `localhost` is the user's laptop.
5. Whether the daemon is MVP.2 or part of the first public release.

## Canonical precedence

When implementing the project:

1. `02_CONSTITUTION.md`
2. `05_REQUIREMENTS.md` + approved product artifacts
3. `06_SYSTEM_DESIGN.md` / `20_ADR.md`
4. `07_TECH_STACK.md`
5. applicable specialist specs such as `08_DATA_MODEL.md`, `09_API_CONTRACT.md`, `12_AGENT_STATE_MACHINE.md`, `13_SECURITY.md`, and UI specs
6. `16_AGENTS.md` execution discipline
7. `15_IMPLEMENTATION_TASKS.md` specific work package within the constraints above

If a later approved project artifact conflicts with these static starter docs, the versioned approved artifact is authoritative for that project scope.
