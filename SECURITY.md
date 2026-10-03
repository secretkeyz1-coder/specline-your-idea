# Security policy

SpecLine Your Idea (technical name: Agentic SDD Control Plane) is early-stage software. No maintained-version matrix, response-time commitment, or completed independent security audit is claimed here. Operators should assess the current revision and dependencies before exposing an instance or enabling execution.

## Reporting a vulnerability privately

If this GitHub repository has **private vulnerability reporting enabled**, use the repository's **Security → Report a vulnerability** flow. That feature depends on owner configuration; this document does not claim it is enabled.

If it is not available, **do not post secrets, private data, exploit credentials, or sensitive exploit details in public issues/discussions**. Ask the repository owner through an already-established private channel for a secure reporting route. If no private route is known, request one without publishing sensitive details. No email address or external reporting service is invented here.

A useful private report includes affected revision, deployment mode, impact, minimal reproduction, redacted logs, and a suggested mitigation if known. Do not test against another person's deployment without authorization. For leaked credentials, revoke/rotate the affected credentials immediately; removing them from the current file does not remove them from Git history or logs.

## Operational trust boundaries

- Browser operations use sessions and server authorization. CLI/MCP use scoped, revocable tokens; use the minimum project/workspace access and scopes needed. Keep the CLI configuration and `.env` private.
- Provider credentials are encrypted using an instance master key outside PostgreSQL. Protect the key and backups; losing or casually replacing it can make stored credentials unreadable.
- Planning content may leave your host through the selected AI provider. Encryption of credentials is not a promise that prompt content remains local. Check provider privacy/retention terms.
- Custom endpoint egress defaults to blocking private/metadata targets. `ALLOW_PRIVATE_AI_EGRESS=true` deliberately widens access for trusted self-hosted LAN endpoints; do not enable it casually on a shared/public server.
- Server-side Local CLI planning is off by default (`SDD_ENABLE_LOCAL_CLI=false`). Enabling it runs a logged-in CLI under the API host's OS user. Machine-side generation uses the owner's machine and CLI login instead.

## Permissions and daemon execution

A repository link has `MANUAL`, legacy `ASSISTED`, or `AUTO_RUN` permission state. Tokens cannot raise links to `AUTO_RUN`; elevated authorization is configured through the browser's machine/repository controls. Automatic dispatch needs `AUTO_RUN`, and qualifying runs may be automatically approved by policy. Human review should not be assumed for those runs.

The optional `sdd-agent` daemon makes outbound connections and runs local tools in linked repositories under **your OS identity**. No inbound listening port is needed, but outbound-only networking does not make execution safe. Use TLS for remote deployments and only trusted servers, accounts, prompts, and repositories.

**Task execution is not sandboxed by the control plane.** The Claude execution adapter invokes `--dangerously-skip-permissions`; generic configured executables and other coding agents can also run programs and modify files. Task scope and permission flags are coordination controls, not OS isolation. Use a dedicated low-privilege account or disposable environment, keep unrelated secrets inaccessible, inspect work orders/diffs, and disable automation when it is not needed.

Do not confuse this with the restricted Local CLI *planning* runner: its tool/environment constraints do not apply as a blanket guarantee to coding-agent execution. AI output and imported UI references are untrusted input even when previews are sandboxed.

## Deployment hygiene

Keep development services on loopback; example database credentials are not production credentials. Configure registration deliberately, trust proxy headers only behind your controlled proxy, and preserve master-key backups together with database recovery plans. Inspect CLI installer scripts from a trusted server before running them; a checksum from that same server is not independent publisher authentication.

See the existing [security specification](docs/13_SECURITY.md), [operations runbook](deploy/OPERATIONS.md), and [deployment operations](docs/18_DEPLOYMENT_OPERATIONS.md). Those documents describe intended controls and operating procedures, not a substitute for a current security assessment or a guarantee of complete isolation.
