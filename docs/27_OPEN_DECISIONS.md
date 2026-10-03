# Open Decisions Register

> **Status reviewed 2026-10-03:** Original specification/research pack, not current implementation or verification certification. [Navigation](README.md). Code/configuration takes precedence; recorded audits/open decisions are not automatically current.

This file records product/architecture decisions that are intentionally **not guessed**. Coding agents must not silently choose them.

## Decision status meanings

- `OPEN` — owner decision required.
- `PROPOSED` — documentation has a current default direction, but owner has not explicitly locked it.
- `LOCKED` — approved and reflected in canonical documents.

## OD-001 — Final product / brand name

**Status:** OPEN  
**Current working name:** `Agentic SDD Control Plane`

The working name may be used in code and documentation placeholders, but branding-specific assets should remain easy to rename.

**Blocks:** final branding only; does not block core implementation.

## OD-002 — Open-source license

**Status:** LOCKED (2026-10-03, explicit owner approval)

Original project code is licensed under Apache-2.0; the complete standard text is in [LICENSE](../LICENSE). Third-party material retains its upstream terms and notices, not the root project's license.

The first public package excludes Preline, Tabler and TailAdmin pending nested-vendor review, and generated UI-template previews, without deleting local copies. Git/Docker exclusions and the application catalog enforce this scope. Other asset/dependency clearance remains a release requirement, not a completed legal audit; see [third-party notices](../THIRD_PARTY_NOTICES.md).

**Blocks:** license selection is resolved; redistribution/provenance review of included third-party material still blocks a fully cleared public release.

## OD-003 — Authentication implementation

**Status:** OPEN

The product requirements lock the behavior (authenticated browser sessions, workspace authorization, CLI/device login, scoped tokens), but do not yet lock the implementation package/provider.

Candidate directions may include:
- application-owned credentials/session implementation;
- a TypeScript auth library compatible with SvelteKit/Bun;
- OIDC/OAuth-based identity for deployments that already have an IdP.

The selected solution must preserve the API/domain requirements in `05_REQUIREMENTS.md` and security controls in `13_SECURITY.md`.

**Blocks:** `T015` and downstream tasks that require browser identity/session behavior. Coding agents must stop at this gate instead of selecting an auth library by preference.

## OD-004 — Local planning-model relay

**Status:** LOCKED for coding-agent CLIs (2026-09-28, see OD-006) · OPEN for local HTTP model endpoints

Question: should a hosted instance be able to use Ollama/LM Studio or another model endpoint that exists only on the user's laptop?

Current custom-provider URLs are server-side connections. `http://localhost:...` on a hosted server is **not** the user's laptop.

Decided: `sdd-agent` is the explicitly authorized relay for **Local CLI** providers (Claude Code, Codex) — the server sends `ai_generate` jobs over the daemon's existing outbound WebSocket (OD-006).

Still open: relaying HTTP model endpoints (Ollama, LM Studio) that exist only on the laptop through the same daemon. Not implemented.

## OD-005 — Local daemon release scope

**Status:** PROPOSED

Current documentation treats `sdd-agent` remote dispatch as **MVP.2 / optional for the first core release**. The first useful release already supports:
- standalone Copy Prompt;
- connected `sddctl`;
- remote MCP for MCP-capable hosts.

Promoting the daemon into the first public release also makes daemon security/UAT tasks mandatory (`T196`, `T221` and their dependencies).

Note (2026-09-28): the daemon now also runs AI generation jobs for Local CLI providers (OD-006). Users who pick the machine target need `sdd-agent connect` running, independent of remote task dispatch.

## OD-006 — Local CLI model providers

**Status:** LOCKED (2026-09-28)

A provider connection of type `LOCAL_CLI` uses Claude Code or Codex as a text model with the CLI's own login; no credential is stored. Two targets:
- **server** (`cli://server/<tool>`) — only when the operator sets `SDD_ENABLE_LOCAL_CLI=true` (default `false`); intended for local/personal installs;
- **machine** (`cli://machine/<id>/<tool>`) — relayed to the owner's `sdd-agent` over the outbound WebSocket; only the machine's owner may create such a connection and only that machine may answer its jobs.

Every run is locked down: no tools (no bypass/"yolo" modes), throwaway temp directory, stdin prompt, allowlisted environment, hard timeout with process-tree kill, 4 MB output cap (`13_SECURITY.md` §17A). CLI connections default to a 15-minute total timeout (max 30). Checking each provider's terms for automated use of a subscription login is the user's responsibility.

## OD-007 — Web UI component system

**Status:** LOCKED (2026-09-28)

The web app uses **daisyUI 5** on Tailwind CSS v4 with daisyUI's built-in `light` (default) and `dark` themes (system preference or header toggle); bits-ui remains for dialog/select/menu/tooltip behaviour. App tokens map onto daisyUI variables; status text colours are mixed for WCAG AA in both themes. Replaces the earlier hand-built shadcn-style light theme. Recorded in `DESIGN.md`.

## OD-008 — Project design system and UI reference

**Status:** LOCKED (2026-09-28)

- The design system is an optional milestone after the stack is locked. Only **generic** presets are offered (14, adapted from open-design under Apache-2.0, light + dark, all WCAG AA); no brand-named or brand-imitating systems.
- The component library is ranked deterministically against the locked stack; exports cover shadcn/ui, daisyUI, Bootstrap, MUI/Material 3, Ant Design, Flowbite and Pico.
- The UI reference is optional and has two fidelities: `neutral` (greyscale mid-fi) and `styled` (drawn with the approved design system, the model never writes colours). Screen count is recommended by the AI with a reason or set by the person (1–12).

## OD-009 — Which coding-agent CLIs to support next

**Status:** OPEN

Only Claude Code and Codex are supported as Local CLI providers. Candidates include OpenCode and Gemini CLI. Each needs a verified locked-down invocation (no tools, no session, stdin prompt, parsable final answer) and a sign-in probe before it is added.

## OD-010 — Scope of machine-targeted CLI connections

**Status:** OPEN

Provider connections are workspace-scoped, and role bindings can be overridden per project. A machine-targeted `LOCAL_CLI` connection can be created only by the machine's owner, but at run time any workspace member whose role binding resolves to it triggers a generation on the owner's machine with the owner's CLI login. Options: keep as is (fine for solo workspaces); restrict runs to the owner; or add a per-user / per-project provider override so each member uses their own machine.

## OD-011 — Progress and cancellation for CLI runs

**Status:** OPEN

CLI runs return only when finished; the UI shows an estimate and elapsed time but no streamed progress, and a running generation cannot be cancelled from the web. Decide whether to stream CLI output (e.g. Claude Code `stream-json`) through the agent socket and add a cancel message.

## Locked decisions summary

Already locked elsewhere and not open for agent improvisation:
- SvelteKit + Svelte 5 + TypeScript frontend;
- Bun + TypeScript runtime/backend/CLI/daemon;
- Elysia API framework;
- PostgreSQL + Drizzle ORM/Drizzle Kit;
- CLI is the primary deterministic local execution bridge;
- MCP is a vendor-neutral interoperability adapter;
- database/event log is runtime state authority;
- task completion requires server validation/review policy;
- planning AI is BYO-provider with Provider Connection → AI Profile → Role Binding;
- Local CLI providers (Claude Code, Codex) on the server only by operator opt-in, or on the owner's machine via `sdd-agent` (OD-006);
- web UI on daisyUI 5 with light/dark themes (OD-007);
- design system presets are generic only; UI reference is neutral or styled (OD-008);
- open-source core reference UI has no pricing-tier/upsell controls.
