# Local Troubleshooting

Use this guide with [local-development.md](./local-development.md), [backend-configuration.md](./backend-configuration.md), [database.md](./database.md), and the [worker index](../backend/src/app/workers/README.md). Fix the failing dependency before repeating the affected flow.

## Stack Startup and Reachability

Create `.env` from `.env.example` and populate required secrets. From the repository root:

```bash
docker compose up --build
docker compose ps -a
docker compose logs --tail=100 mysql backend-migrate backend frontend
```

The one-off migration service should exit successfully. An exited API or repeatedly restarting worker is not expected. For build failures, inspect the failing stage, Dockerfile, context, lockfile, and required resources before retrying.

Check the exposed URLs:

```bash
curl --fail http://localhost:8040/api/v1/health
curl --fail http://localhost:3040
```

In Windows PowerShell, use `curl.exe` for curl flags or `Invoke-WebRequest`. Frontend/backend ports are 3040/8040.

For conflicts, inspect listeners with `Get-NetTCPConnection -LocalPort 3040` in PowerShell or the relevant OS tool. Do not kill unrelated services automatically. Infrastructure ports are overridden through `.env`: MySQL 3307, Redis 6380, Elasticsearch 9201, RabbitMQ AMQP 5673, management 15673. Coordinate test overrides using the testing guide. Frontend/backend published ports are fixed in Compose rather than exposed through those override variables.

## Configuration and Stale Builds

Configuration loads once per backend process. Missing secrets, unknown YAML keys, invalid profiles/overlays, or invalid value combinations stop startup; read the validation error in logs. A relative `BACKEND_CONFIG_FILE` resolves against `backend/config`; a selected host file must also be accessible in the container.

Rebuild/recreate through `docker compose up --build` after configuration or source changes. Frontend `NEXT_PUBLIC_*` values are build-time inputs; a restart alone does not replace stale values.

Use service addresses inside containers and published loopback URLs for host/browser clients. The frontend server uses `INTERNAL_API_BASE_URL`; its browser uses `NEXT_PUBLIC_API_BASE_URL`. `http://backend:8040` is not a browser-reachable URL.

## Database and Migrations

Inspect `backend-migrate`/MySQL logs, datasource addressing, schema existence, credentials/grants, and pending migrations. Use the database guide's explicit test migration command: migrating `rent` does not prepare `rent_test`.

For connection exhaustion:

```bash
docker compose exec mysql mysql -uroot -proot -e "SELECT @@max_connections; SELECT COUNT(*) FROM information_schema.PROCESSLIST;"
```

Each database-connected process owns a pool. Review [the connection budget](./architecture-overview.md#database-connection-budget), especially after adding replicas. Minimum idle must be at least one under current driver behavior. Do not reset a populated database or delete named volumes to hide migration errors.

## Authentication and Fixtures

Use `owner-one`, `renter-one`, or `renter-two` with `Rentify123!` for username sign-in; use fixture emails for email-based flows. Confirm fixtures exist and refresh only when needed, since refresh overwrites fixture-owned edits.

Development MFA bypass is under `auth.mfaBypassEmails` and matches the current email. Changing the account email can remove bypass. Production ignores bypass and does not register development OTP routes. See the local development guide for authenticated OTP endpoints.

No real mail goes to `rentify.local` outside production; SMS defaults to noop. Check job acceptance separately from external delivery. For OAuth, compare backend credentials, frontend public IDs, callback URLs, popup/network errors, and provider requirements. Apple round trips require a configured HTTPS domain.

## Worker Backlogs, Logs, and Delivery

```bash
docker compose logs --tail=100 email-worker sms-worker log-consumer-worker
```

RabbitMQ management is `http://localhost:15673`. Inspect consumers, ready/unacknowledged messages, retry tiers, and dead letters. Use directory READMEs for exact policies. Pollers require inspection of due candidates, outbox states, attempts, and errors instead.

A startup log or running container does not prove processing: confirm the domain result. Retry policies vary and duplicate delivery is possible. Do not purge queues or replay dead letters without understanding payload validity and duplicate effects.

If central logs stop, check the consumer's broker connection/output failures, producer output, and fallback files at `/app/logs/fallback` on the shared `backend_logs` volume unless overridden. Do not dump environment variables or tokens into reports.

Recommendation precompute has no Compose service. When activity ingests but snapshots remain stale, use the [documented one-off process](../backend/src/app/workers/recommendations/README.md#precompute-poller).

## Search and Browser Tests

Check Elasticsearch at `http://localhost:9201`, enabled configuration, and the relevant projection. Inspect both maintainer/indexer for broker pipelines; reports use the database outbox directly. Verify async outbox/queue progress and the actual result rather than repeatedly refreshing.

For browser tests against Docker, set `PLAYWRIGHT_EXTERNAL_SERVER=1` as shown in [testing-guide.md](./testing-guide.md#playwright-tests). Without it, current configuration attempts to start a dev server. Check base URL, fixtures, console/network errors, and stored traces/screenshots.

For integration safety failures, use the isolated schema, nonzero Redis DB, and test-scoped broker/search namespaces. RabbitMQ management and AMQP URLs must reach the same broker. Do not weaken safety guards or coverage gates.
