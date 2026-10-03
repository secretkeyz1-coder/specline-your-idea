# Contributing to SpecLine Your Idea

The technical workspace name is Agentic SDD Control Plane (`@sdd/*`). This is early-stage software; interfaces and planning contracts can change. The project license and broader third-party redistribution review remain pending. Discuss substantial contributions with the owner before submitting them; this document does not grant a license or invent a contributor agreement.

## Before changing anything

- Read the [README](README.md), [development/testing guide](docs/guides/development-and-testing.md), and the relevant existing specification.
- Check your working tree. Preserve unrelated local changes and keep patches focused; do not reset, delete, or reformat other work.
- Describe the problem, expected behavior, affected workflow, and acceptance criteria. For a bug, include a minimal reproduction and current versus expected behavior.
- Never include credentials, private prompts, local environment files, or confidential task/repository content. Suspected vulnerabilities belong in the [private reporting path](SECURITY.md).

## Local workflow

Follow the [quickstart](README.md#quickstart-local-development), using your own untracked secrets and disposable data. Maintain public onboarding documentation in English under the SpecLine Your Idea brand; retain technical names accurately in commands, config, and package references. Verify commands against actual scripts, not historical specifications.

Prefer small, reviewable changes. When changing a contract or state transition, update the related API/CLI/MCP behavior and tests as appropriate. Add regression coverage for bugs where practical. Review schema migrations, backup implications, and rollback strategy before applying them.

## Checks and realistic scope

```bash
bun run typecheck
bun run build
bun test
```

The default test command includes heterogeneous suites; some live-API tests can skip after environment/setup failure, while database/browser/live-provider checks need explicit setup. A successful command is not evidence that every workflow ran. See [development and testing](docs/guides/development-and-testing.md) for isolated unit selection, test credentials, the dedicated database variable, and the workflow verifier's explicit URL requirement.

For a documentation-only patch, validate links and every copied command against current configuration; application integration tests may be unnecessary. For behavior changes, run focused regression tests plus relevant broader checks and exercise the affected journey. Do not use a passing unit suite to claim production readiness, end-to-end coverage, or accessibility compliance.

## What to include in a pull request

- Purpose, scope, affected user journey, and any contract/migration changes.
- Exact checks run and results, including skips, unavailable environments, and checks not run.
- A reproduction or evidence for behavior changes; include real screenshots only if useful and free of private data.
- Dependencies or third-party material added, their sources/licenses, and unresolved redistribution concerns. Do not select the project license on the owner's behalf.

No CI pass guarantee, review response time, or supported release matrix is promised. Publishing, commits, tags, and pushes are separate owner-authorized actions; preparing a patch or documentation does not authorize them.
