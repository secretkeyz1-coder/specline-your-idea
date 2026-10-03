# Getting started

[Back to README](../../README.md) · [First project](first-project.md)

## Start locally

Use the [README quickstart](../../README.md#quickstart-local-development) from the repository root. It is the canonical command sequence: install dependencies, copy the environment example only if no `.env` exists, generate two distinct secrets, configure bootstrap credentials, start PostgreSQL, apply migrations, bootstrap, and start API + web.

Prerequisites are Bun >=1.4.0, Docker Compose, and OpenSSL for the documented secret generation. A coding-agent subscription, AI key, Chromium, and MinIO are **not** required to start the app or author a manual plan.

## Understand the environment

| Setting | Local purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection; must match the database port/user/password |
| `SDD_MASTER_KEY` | Base64 of 32 random bytes; encrypts provider credentials |
| `SDD_SESSION_SECRET` | Independent random secret for sessions and pairing |
| `API_PUBLIC_URL`, `API_PORT` | Default `http://localhost:4000` and `4000`; web server also uses the API URL |
| `WEB_PUBLIC_URL` | Default `http://localhost:5173`; keep aligned with your browser origin |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_WORKSPACE` | Initial operator and workspace on an empty-user database |

Do not invent a `PUBLIC_API_URL` setting: the web server uses `API_PUBLIC_URL`. Keep all actual values in your untracked environment, not documentation or bug reports. Removing bootstrap settings later does not remove the account; bootstrap is not a password-reset command.

If port 5432 is occupied, set `SDD_PG_PORT=5433` in `.env` and change `DATABASE_URL` to use `localhost:5433` before starting Compose. The development database publishes on loopback and persists in a named volume. Do not reset an existing database to fix a port problem.

Leave `API_HOST` empty for the default loopback development binding. Development registration defaults open; set `ALLOW_SELF_REGISTRATION=false` if you do not want sign-ups. Do not expose the development stack directly to the Internet.

## Know when it is ready

`docker compose exec postgres pg_isready -U sdd -d sdd` should succeed before migrations. `/healthz` means the API process is alive; `/readyz` additionally probes the database. These are different checks and neither verifies every user workflow.

Open the web app and sign in using your configured bootstrap email/password. If it fails, see [troubleshooting](troubleshooting.md); do not overwrite secrets or erase database volumes. Once signed in, continue to [your first project](first-project.md). Configure [AI providers](ai-providers.md) only if you want generation.

## Hosting is a separate step

Use the existing [deployment operations specification](../18_DEPLOYMENT_OPERATIONS.md), [operations runbook](../../deploy/OPERATIONS.md), and [VPS deployment guide](../../DEPLOY.md) for reverse proxy/TLS, production registration, migration, backup, and restore. The VPS guide is in Indonesian. Review those references against current configuration before deploying; this guide does not duplicate or certify the production runbook.
