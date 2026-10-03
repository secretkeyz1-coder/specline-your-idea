# Research Sources

> **MCP research vs installed SDK:** v2 / 2026-07-28 language below is research/target intent, not installed-version evidence. `packages/mcp/package.json` declares v1 (`^1.30.0`); `packages/mcp/src/index.ts` uses v1 server/Streamable HTTP APIs. No v2 migration or support for all researched features is certified here.

> **Status reviewed 2026-10-03:** Original specification/research pack, not current implementation or verification certification. [Navigation](README.md). Code/configuration takes precedence; recorded audits/open decisions are not automatically current.

This documentation pack was informed by the following current public references checked on 2026-09-05.

## GitHub Spec Kit

- GitHub Spec Kit — Agentic SDD: https://github.github.com/spec-kit/reference/agentic-sdd.html
- GitHub Spec Kit — Quickstart: https://github.com/github/spec-kit/blob/main/docs/quickstart.md
- GitHub Spec Kit — Task template: https://github.com/github/spec-kit/blob/main/templates/tasks-template.md
- GitHub Spec Kit — Converge: https://github.com/github/spec-kit/blob/main/templates/commands/converge.md
- GitHub Spec Kit — Spec of Specs: https://github.github.com/spec-kit/concepts/spec-of-specs.html

Key patterns used:
- constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge;
- task grouping by user story and dependency;
- explicit convergence after implementation.

## Kiro Specs

- Kiro CLI Specs: https://kiro.dev/docs/cli/v3/specs/
- Kiro Quick Spec: https://kiro.dev/docs/specs/quick-spec/
- Kiro Steering: https://kiro.dev/docs/steering/
- Kiro Web Specs: https://kiro.dev/docs/web/specs/

Key patterns used:
- requirements → design → tasks;
- clarifying questions before generation;
- persistent product/tech/structure steering;
- discrete trackable tasks with execution verification.

## Model Context Protocol

- MCP 2026-07-28 specification announcement: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP 2026-07-28 TypeScript SDK support guide: https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- MCP TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/

Key patterns used:
- use the official MCP SDK instead of implementing the wire protocol manually;
- the v2 TypeScript SDK is the stable line for the 2026-07-28 protocol revision and supports Bun;
- remote MCP is exposed over the SDK HTTP handler, with compatibility behavior handled by the SDK;
- authenticated remote tools use scoped authorization and the same domain services as REST/CLI.

## AGENTS.md

- AGENTS.md standard: https://agents.md/

Key pattern used:
- repository-scoped persistent instructions for coding agents.

## Design note

External references influenced workflow and interoperability choices only. The data model, state machines, `sddctl`, local daemon protocol, task work-order schema, UI, and execution architecture in this package are original design recommendations for this product.


## Implementation stack references added in the TypeScript/Bun revision

### Svelte

- Svelte package/adapters catalog: https://svelte.dev/packages
- Used to verify the current SvelteKit adapter ecosystem and deployment options.

### Bun

- Bun runtime: https://bun.sh/
- Bun API reference: https://bun.sh/reference/bun/BuildConfig
- Relevant capabilities: TypeScript runtime, test runner, WebSocket/HTTP runtime, SQL client, and optional standalone executable compilation for local CLI/daemon distribution.

### Drizzle ORM

- Drizzle + Bun SQL: https://orm.drizzle.team/docs/connect-bun-sql
- PostgreSQL getting started: https://orm.drizzle.team/docs/get-started-postgresql
- Used to verify Drizzle support for Bun SQL and PostgreSQL.

### Elysia

- Elysia quick start: https://elysiajs.com/quick-start
- OpenAPI plugin: https://elysiajs.com/plugins/openapi
- Used as the Bun-optimized TypeScript HTTP API framework and OpenAPI surface.

## Audit refresh — September 2026

Revalidated during the documentation consistency audit:

- GitHub Spec Kit current docs describe the core agentic SDD sequence including constitution/specify/clarify/plan/checklist/tasks/analyze/implement/converge and emphasize specification artifacts as structured context.
  - https://github.github.com/spec-kit/
  - https://github.com/github/spec-kit/blob/main/docs/reference/agentic-sdd.md
- MCP TypeScript SDK v2 is the stable line implementing the 2026-07-28 revision and documents HTTP/stdio integration for Bun-capable TypeScript runtimes.
  - https://ts.sdk.modelcontextprotocol.io/v2/
  - https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28
- Drizzle documents native Bun SQL connectivity for PostgreSQL.
  - https://orm.drizzle.team/docs/connect-bun-sql
- Bun documents native server-side WebSocket support.
  - https://bun.sh/docs/runtime/http/websockets

Design implication: the project keeps its own workflow/domain model rather than claiming these sources define one universal SDD standard.
