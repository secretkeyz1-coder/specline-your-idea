# SpecLine Your Idea

**Turn an idea into an approved specification, actionable work orders, and reviewed delivery evidence.**

SpecLine Your Idea is a self-hosted specification-to-execution control plane for AI coding agents. It helps you clarify requirements, choose a stack, design a solution, break it into tasks, and review what was actually built. Planning and delivery state live in the web app; implementation runs in your own repository through a portable prompt, connected CLI, or MCP client.

The existing technical name is **Agentic SDD Control Plane**. Package names (`@sdd/*`), environment variables (`SDD_*`), and executables (`sddctl`, `sdd-agent`) retain that name. SDD means specification-driven development; the public brand does not rename these interfaces.

**Early-stage software:** the repository is versioned `0.1.0`. Expect changing interfaces and incomplete release validation, not a production-readiness guarantee. The optional daemon needs particular care on trusted machines. No published package installation or hosted service is assumed here.

```text
Idea → Discovery → Requirements → Stack → Technical design → Tasks
     → Work order → Local execution → Evidence → Review → Convergence
                   Optional: design system + UI reference
```

## Why use it?

- Keep requirements, acceptance criteria, scope, and verification commands together instead of scattering them across chat sessions.
- Approve planning artifacts before implementation; give agents bounded work orders and explicit stop conditions.
- Bring your own AI provider, or author planning artifacts and tasks manually. AI generation requires a configured provider; discovery has a deterministic question-bank path.
- Record execution evidence, review runs, track bugs as entities, and use convergence checks before release approval. A successful task is not by itself a verified release.

This is a coordination layer, not a replacement coding agent, model subscription, or guarantee that generated code is safe or correct.

## Quickstart: local development

Prerequisites: [Bun](https://bun.sh) **1.4.0 or newer** (the repository's declared requirement), Docker with Compose, and OpenSSL for the secret-generation commands below. Run from this checkout's root. Commands use Bash/Git Bash; PowerShell users can copy `.env.example` with `Copy-Item .env.example .env` and use their editor for the same settings.

If you do not have a checkout, clone the repository (access depends on its current visibility and your permissions):

```bash
git clone https://github.com/secretkeyz1-coder/specline-your-idea.git specline
cd specline
```

If `.env` already exists, **do not overwrite it**. Otherwise:

```bash
bun install --frozen-lockfile
cp .env.example .env
openssl rand -base64 32
openssl rand -base64 32
```

Edit `.env` before starting anything:

- Put the first generated value in `SDD_MASTER_KEY` and the second in `SDD_SESSION_SECRET`. Use different values; do not leave `changeme` placeholders. The master key must decode to 32 bytes. Keep it safe: encrypted provider credentials depend on it.
- Set `BOOTSTRAP_ADMIN_EMAIL` and a strong `BOOTSTRAP_ADMIN_PASSWORD`; optionally set `BOOTSTRAP_WORKSPACE`. Bootstrap only creates an account when there are no users.
- Keep `DATABASE_URL=postgres://sdd:sdd@localhost:5432/sdd`, `API_PUBLIC_URL=http://localhost:4000`, and `WEB_PUBLIC_URL=http://localhost:5173` for the default local setup. The example database password is for loopback development only.
- Keep `.env`, tokens, and provider keys out of Git. Leave private AI egress and server-side Local CLI disabled unless you deliberately need them.

```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U sdd -d sdd
bun --env-file .env run db:migrate
bun --env-file .env run bootstrap
bun --env-file .env run dev
```

Wait for PostgreSQL readiness before migrating. Keep the development processes running; in another terminal:

```bash
curl -fsS http://localhost:4000/healthz
curl -fsS http://localhost:4000/readyz
```

`/healthz` checks API liveness; `/readyz` checks database readiness. Open <http://localhost:5173> and sign in with the account you configured. See [getting started](docs/guides/getting-started.md) for ports, environment details, and recovery steps. This quickstart is **not** a public deployment recipe.

## Your first workflow

1. Create a small project with one concrete user journey, then complete discovery.
2. Write or generate requirements; inspect and approve them before selecting the stack.
3. Select a manual or AI-recommended stack and prepare the technical design with real acceptance and delivery checks.
4. Optionally add a design system and UI reference. These planning aids are not the finished application and are not required for non-UI work.
5. Create or generate bounded tasks, check dependencies and verification commands, then make eligible tasks ready.
6. Copy a task's work order into your coding agent, or connect a repository using `sddctl` or MCP. Review scope before allowing execution.
7. Run actual checks, submit evidence, review changes, resolve bugs, and run feature convergence before release approval.

Follow the [first-project walkthrough](docs/guides/first-project.md). For generated planning, configure a connection, model/profile, and role routing under **Settings → AI**; see [AI providers](docs/guides/ai-providers.md).

## Execution choices

| Mode | What you need | Boundary |
|---|---|---|
| Portable prompt | Task work-order panel and your coding agent | No SpecLine CLI installation; report real results back to the app |
| Connected CLI | `sddctl login`, repository link, task/run commands | CLI coordinates state; your agent performs implementation |
| MCP | Scoped bearer token for `/mcp`, or `sddctl mcp` stdio bridge | Same domain authorization as REST; client support varies |
| Optional daemon | Source checkout, Bun, `sdd-agent` process and linked machine | Outbound connection; automatic dispatch requires `AUTO_RUN` authorization in the web app |

The API serves a **`sddctl`-only** installer at `/api/v1/cli/install.sh` and `/api/v1/cli/install.ps1`; it needs Node.js 18+ or Bun and installs under `~/.sdd/bin` by default. Inspect scripts from a trusted server before executing them. It does not install `sdd-agent`, Claude Code, Codex, or their credentials. See [CLI and agents](docs/guides/cli-and-agents.md) and [MCP](docs/guides/mcp.md) for source commands and installation details.

**Security:** an execution daemon runs tools under your OS identity in a trusted repository; it is not an isolation boundary. In particular, the Claude execution adapter uses `--dangerously-skip-permissions`. This differs from restricted Local CLI *planning* generation. Read [SECURITY.md](SECURITY.md) before enabling automatic execution.

## Repository map

| Path | Purpose |
|---|---|
| `apps/web` | SvelteKit / Svelte 5 planning and execution UI; Tailwind CSS 4 + daisyUI 5 |
| `apps/api` | Bun + Elysia API; REST, SSE, WebSocket gateway, MCP mount |
| `apps/cli`, `apps/agent` | `sddctl` bridge and optional `sdd-agent` daemon |
| `packages/db`, `packages/contracts` | PostgreSQL/Drizzle schema and shared Zod contracts |
| `packages/ai`, `packages/agent-cli` | AI gateway and restricted Local CLI planning runner |
| `packages/auth`, `packages/shared`, `packages/config`, `packages/mcp` | Authentication, shared utilities, configuration, MCP adapter |
| `deploy`, `docs` | Deployment references, specification pack, and practical guides |

## Documentation and contributing

- [Getting started](docs/guides/getting-started.md) · [First project](docs/guides/first-project.md)
- [AI providers](docs/guides/ai-providers.md) · [CLI and agents](docs/guides/cli-and-agents.md) · [MCP](docs/guides/mcp.md)
- [Troubleshooting](docs/guides/troubleshooting.md) · [Development and testing](docs/guides/development-and-testing.md)
- [Contributing](CONTRIBUTING.md) · [Security and private reporting](SECURITY.md)
- [Documentation navigation](docs/README.md)
- [Specification index](docs/00_README.md) · [Architecture](docs/06_SYSTEM_DESIGN.md) · [Technology stack](docs/07_TECH_STACK.md)
- [Product](PRODUCT.md) · [UI design](DESIGN.md) · [Open decisions](docs/27_OPEN_DECISIONS.md)
- [Deployment operations](docs/18_DEPLOYMENT_OPERATIONS.md) · [Operations runbook](deploy/OPERATIONS.md) · [VPS deployment guide](DEPLOY.md)
- [System design](docs/06_SYSTEM_DESIGN.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Some existing internal specifications and deployment material use the technical working name or Indonesian. These new guides are the English onboarding entry point; older design/status documents are context, not evidence that a release has passed validation.

## Checks and release status

```bash
bun run typecheck
bun test
```

Test prerequisites differ: live-API suites can skip when the environment is unavailable, isolated database suites require explicit configuration, and browser/live-provider checks have separate dependencies. A green default test run does not prove those paths ran. See [development and testing](docs/guides/development-and-testing.md); no fixed test-count, coverage, accessibility, or CI pass claim is made here.

## License and third-party material

The repository's original code is licensed under [Apache License 2.0](LICENSE), as approved by the owner on 2026-10-03. Third-party code, templates, documentation, fonts, icons and images retain their own licenses and notices; the root license does not relicense them. See [third-party notices](THIRD_PARTY_NOTICES.md).

The first public package excludes **Preline**, **Tabler and TailAdmin** (pending nested-vendor redistribution review), and all generated UI-template previews. Local copies remain at their original paths, but these sources are disabled in the application catalog and excluded from Git additions and Docker build contexts. Other template sources have retained top-level MIT texts, not exhaustive asset clearance. Dependency, nested-asset and provenance checks remain release requirements before publication; see [third-party notices](THIRD_PARTY_NOTICES.md).
