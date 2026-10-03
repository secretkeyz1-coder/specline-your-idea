# Troubleshooting

[Back to README](../../README.md) · [Getting started](getting-started.md)

Start with the exact command, HTTP status/error code, and redacted logs. Never paste `.env`, passwords, bearer tokens, provider keys, or confidential prompts into an issue. Back up important data before migration or recovery; do not erase volumes as a default repair.

| Symptom | Check / next action |
|---|---|
| API refuses configuration | Generate distinct real secrets. `SDD_MASTER_KEY` must be base64 decoding to 32 bytes; the session secret must not be the example placeholder. Check `DATABASE_URL`. |
| PostgreSQL port conflict | Set `SDD_PG_PORT` and the matching `DATABASE_URL` port before starting Compose. Check `docker compose ps`; do not reset the database. |
| `/healthz` works but `/readyz` fails | Confirm database readiness, credentials, connectivity and migration completion. Liveness alone is not readiness. |
| Web starts but cannot reach API | Check running API and `API_PUBLIC_URL` in the web process environment; do not substitute `PUBLIC_API_URL`. Keep public origins aligned. |
| Bootstrap says account exists | Bootstrap only works on an empty-user database. Use the existing operator account; changing bootstrap variables is not a reset. |
| Sign-up unavailable | Production defaults closed; review `ALLOW_SELF_REGISTRATION`/`REGISTRATION_ALLOWLIST` with the operator. Do not open public registration as a login workaround. |
| `AI_PROVIDER_NOT_CONFIGURED` | Bind an active profile/model to the requested role. Check project overrides as well as workspace settings. |
| Model list empty / provider rejects model | Enter a supported model ID manually when enumeration is unavailable. Verify endpoint/key/quota; do not expose secrets in probe output. |
| Private AI URL refused | Egress policy is deliberate. Only a trusted self-host operator should consider `ALLOW_PRIVATE_AI_EGRESS=true`. |
| Local CLI generation unavailable | Check where it should run, CLI installation/login, and machine daemon status. Server-side generation needs `SDD_ENABLE_LOCAL_CLI`; machine-side does not. |
| `sddctl` not found | Use the installer's printed path, adjust PATH, or invoke the source entry point with Bun. The installer does not install a model CLI or daemon. |
| CLI command targets wrong project | Run in the target repo, check `project status` and `.sdd/local.json`. Check saved server/config identity before mutation. |
| MCP auth/transport failure | Verify token scope/server and POST transport. See [MCP](mcp.md); do not publicly share headers. |
| Task cannot become ready/start | Read the returned gate error: approved artifacts, dependencies, required checks, or another task lease may be missing. Do not manually bypass state. |
| Tests appear green but no workflow ran | Read skip/environment messages. A default test run is not live-API, browser, provider, or clean-checkout evidence. |

Useful local diagnostics from the repository root:

```bash
docker compose ps
curl -fsS http://localhost:4000/healthz
curl -fsS http://localhost:4000/readyz
bun run apps/cli/src/index.ts status
bun run apps/agent/src/index.ts status
```

UI render lint defaults to `UX_RENDER_LINT=auto`: browser-backed checks depend on Chromium availability; `UX_RENDER_CHROMIUM` can specify its executable. HTML lint alone is not proof of visual correctness. Review generated reference screens and the implemented app separately.

For backup/restore, upgrades, rollback and production failures, use the existing [operations runbook](../../deploy/OPERATIONS.md) and [deployment operations](../18_DEPLOYMENT_OPERATIONS.md). For suspected vulnerabilities, follow [private reporting](../../SECURITY.md), not a public issue with exploit secrets.
