# Development and testing

[Back to README](../../README.md) · [Contributing](../../CONTRIBUTING.md)

Use Bun >=1.4.0 and the [local setup](../../README.md#quickstart-local-development). Commands below run from the repository root. Use a disposable development database and redact all credentials/output before sharing evidence.

## Scripts

```bash
bun install --frozen-lockfile
bun --env-file .env run dev:api
# In a separate terminal:
bun --env-file .env run dev:web
```

`dev` starts both via concurrently. `typecheck` runs workspace TypeScript checks and SvelteKit sync/svelte-check. `build` runs defined workspace builds, including the API's served CLI bundle and web build; it does not create a universal installer or certify deployment.

```bash
bun run typecheck
bun run build
```

Schema changes use `db:generate` and `db:migrate`; review generated SQL and a rollback/backup plan. `db:reset` is destructive and is not an onboarding or routine troubleshooting step.

## Test scope is not uniform

```bash
bun test
```

This discovers multiple kinds of tests. Read skip and environment messages; do not report all integration paths as covered by a default run.

For isolated unit discovery in Bash/Git Bash:

```bash
bun test $(find apps packages -type f -name '*.unit.test.ts' -not -path '*/node_modules/*')
```

This deliberately excludes tests with other naming patterns, including standalone package, CLI, agent, and AI suites. For those, choose explicit paths after inspecting their setup. For example:

```bash
bun test apps/cli/tests apps/agent/tests packages/agent-cli/tests
```

### Live API suites

`integration.test.ts`, `workflow.test.ts`, and `ai-providers.test.ts` use a running migrated/bootstrap API. They can skip after an unavailable environment or failed setup; a zero exit code alone does not establish that their scenarios ran. These suites create/mutate records: use a disposable instance, not production.

Start the API separately, then supply credentials in your local shell (example placeholders must be replaced):

```bash
export SDD_TEST_API=http://localhost:4000
export SDD_TEST_EMAIL=admin@example.com
export SDD_TEST_PASSWORD='YOUR_DISPOSABLE_OPERATOR_PASSWORD'
bun test apps/api/tests/integration.test.ts apps/api/tests/workflow.test.ts apps/api/tests/ai-providers.test.ts
```

### Isolated PostgreSQL suites

`delivery-review.integration.test.ts` and `pipeline-quality.integration.test.ts` require explicit `SDD_DELIVERY_TEST_DB` and use fake AI HTTP providers. They do not automatically use the application's `DATABASE_URL`. Provision and migrate a separate disposable test database before running them; never point the variable at shared/production data.

### Workflow verifier

With a disposable API running:

```bash
export SDD_VERIFY_API=http://localhost:4000
export SDD_VERIFY_EMAIL=admin@example.com
export SDD_VERIFY_PASSWORD='YOUR_DISPOSABLE_OPERATOR_PASSWORD'
bun run apps/api/scripts/verify-workflow.ts
```

Set `SDD_VERIFY_API` explicitly: the current script defaults to port **4010**, not the quickstart's 4000. It creates and mutates workflow records; it is not a read-only health probe or proof of browser rendering.

### Browser, visual, and live-provider validation

Inspect each test's setup and installed dependencies before invoking it. Browser-backed render checks need Chromium; provider-dependent checks need deliberate credentials/configuration. A unit run does not certify accessibility, every viewport, real model output, task execution on a machine, or production startup. Record those separately, including what was skipped.

## Release evidence

Report command, checkout/revision, environment, exit code, failures and skips, with secrets removed. Verify a clean checkout with a frozen dependency install, fresh database migration/bootstrap, typecheck, build and relevant tests before release. Dated preparation checks are not release certification. Use the existing [operations runbook](../../deploy/OPERATIONS.md) for production migrations/backup/restore.
