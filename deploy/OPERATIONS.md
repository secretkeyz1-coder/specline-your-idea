# Operations Runbook — Agentic SDD Control Plane

## 1. First deployment

1. Provision PostgreSQL 16 (the compose file in this directory is the reference).
2. Generate secrets **outside** the database (docs/13 §12):
   ```bash
   openssl rand -base64 32   # SDD_MASTER_KEY (keep safe — encrypted credentials depend on it)
   openssl rand -base64 32   # SDD_SESSION_SECRET
   ```
3. Start the stack:
   ```bash
   docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env up -d
   ```
4. Apply migrations (one-off job from the api image; the compose file ships a
   `migrate` service for exactly this):
   ```bash
   docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env run --rm migrate
   ```
5. Create the first operator (T211):
   ```bash
   bun run --filter '@sdd/api' bootstrap -- --email you@example.com --password '…' --workspace "Default"
   ```
6. Verify: `GET /healthz` (liveness) and `GET /readyz` (database readiness are distinct, T207).

## 2. Migration runbook (T210)

Deploy sequence:
1. Back up the database (section 3).
2. Build and tag new images.
3. Apply migrations **before** switching traffic:
   `docker compose -f deploy/docker-compose.production.yml --env-file deploy/.env run --rm migrate`
   (or `bun run db:migrate` from a checkout).
4. Roll the api + web containers to the new tag.
5. Smoke test: `/readyz`, login, create project, task list.

Rollback:
1. Roll containers back to the previous tag.
2. Migrations are additive-first; if a rollback needs a schema reversal, apply
   the prepared down-migration from the release notes, then restore the backup
   only if data was mutated (C19: every schema change ships a reversible plan).

## 3. Backup (T208)

```bash
# nightly logical backup (retain ≥ 7 days, encrypted at rest)
# The container name is compose-derived (<project>-postgres-1); resolve it
# dynamically so this works regardless of the directory the stack runs from.
docker exec "$(docker compose ps -q postgres)" pg_dump -U sdd -Fc sdd > "backup-$(date +%F).dump"
```
Also snapshot the SDD_MASTER_KEY storage (vault/KMS). **A backup without the
master key cannot decrypt provider credentials.**

## 4. Restore test (T209)

Quarterly, on a clean database:
```bash
createdb sdd_restore
pg_restore -U sdd -d sdd_restore backup-YYYY-MM-DD.dump
DATABASE_URL=postgres://…/sdd_restore bun run --filter '@sdd/db' migrate   # no-op expected
# smoke: boot api against sdd_restore, login, open a project, read a task
```
Record the result in the release checklist.

## 5. Observability (T189/T190)

- Structured JSON logs on stdout with `traceId` per request; ship to your log pipeline.
- Metrics to watch: API error rate, AI generation failures (`ai_generation_runs.error_code`),
  lease expiries, claim conflicts (409 `TASK_ALREADY_CLAIMED`), review turnaround.
- Audit trail: `audit_events` is append-only; export periodically if required by policy.

## 6. Secret handling checklist

- Never log `Authorization` headers (redaction is applied in the logger; keep it that way).
- Provider credentials are AES-256-GCM envelopes (`v1.…`) — rotate the master key
  by re-encrypting connections (key version prefix supports migration).
- `.sdd/local.json` in linked repositories must not contain tokens; `.gitignore` it.

## 7. Known limitations (initial release)

- Local daemon remote dispatch is MVP.2 (OD-005); Copy-Prompt, `sddctl` and MCP are the supported execution paths.
- License: unset by owner decision (OD-002) — choose before public release.
- Brand name is the working title (OD-001).
