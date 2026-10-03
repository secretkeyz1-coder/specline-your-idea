# Documentation

Navigation reviewed on **2026-10-03**. Distinguish current implementation guidance from the original specification pack and dated evidence. Historical audits, aggregate snapshots and owner-only publication reports are retained in an ignored local archive, not distributed as current guidance.

## Guides by task

Use the task-oriented guides below. The last column links to existing references and implementation context.

| Category | Guide | Available now |
|---|---|---|
| Getting started | [Getting Started](guides/getting-started.md) | [Repository quickstart](../README.md), [deployment guide](../DEPLOY.md) |
| Illustrated walkthrough (Indonesian) | [Tutorial bergambar](guides/tutorial-bergambar.md) | 16 genuine screenshots; verified login/prototype navigation, imported demo artifacts, explicit untested actions and mobile layout finding |
| First project | [First Project](guides/first-project.md) | [Planning workflow](04_PLANNING_WORKFLOW.md), [product overview](../PRODUCT.md) |
| AI providers | [Ai Providers](guides/ai-providers.md) | [Provider model](00_README.md#ai-provider-model), [provider setup](../DEPLOY.md) |
| CLI and agents | [Cli And Agents](guides/cli-and-agents.md) | [Protocol reference](10_MCP_CLI_PROTOCOL.md), [agent instructions](16_AGENTS.md) |
| MCP | [Mcp](guides/mcp.md) | [Protocol reference](10_MCP_CLI_PROTOCOL.md), [research vs installed SDK](23_SOURCES.md#model-context-protocol) |
| Troubleshooting | [Troubleshooting](guides/troubleshooting.md) | [Deployment troubleshooting](../DEPLOY.md#troubleshooting), [operations](../deploy/OPERATIONS.md) |
| Development and testing | [Development And Testing](guides/development-and-testing.md) | [Development commands](../README.md), [contribution guide](../CONTRIBUTING.md) |

## Deployment and operations

- [VPS deployment](../DEPLOY.md) is **Indonesian** and follows production Compose configuration.
- [Operations](../deploy/OPERATIONS.md) is **English**: backups, restore and migration runbooks.

## Product, architecture and UI

- [PRODUCT](../PRODUCT.md): product overview; [DESIGN](../DESIGN.md): current app design record. Code/configuration takes precedence for implemented behavior; project runtime state stays in the database.
- [SCREENS](SCREENS.md): 18-screen catalog; current layout details come from DESIGN and route files.
- [UI rules](../aturan.md): revision target, not proof every rule is implemented.

## Original specifications and dated evidence

[00_README](00_README.md) indexes the **original 00–27 specification pack** and later additions. Original specs/prototypes record planning contracts and research, not a blanket description of the current working tree.

- [UI template gallery](32_UI_TEMPLATE_GALLERY.md): practical implementation note; documentation status reviewed 2026-10-03.
- [Open decisions](27_OPEN_DECISIONS.md): unresolved owner decisions and implementation gates.

Individual specifications remain available. Dated project audits/tests, the historical master map, generated aggregate and its original checksum manifest are archived locally; they do not certify the current tree. Current behavior follows code/configuration and the current guides above.

## Contributing and security

- [Contributing](../CONTRIBUTING.md): development and change-submission guidance.
- [Security](../SECURITY.md): private reporting and trust boundaries.
- [Third-party notices](../THIRD_PARTY_NOTICES.md): licensing and distribution boundaries.
