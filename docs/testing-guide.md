# Testing Guide

This guide describes how testing is organized in Rentify and which workflow to use for different kinds of changes.

## Testing Layers

Rentify currently uses three main testing layers:

- backend unit and integration tests with `Jest`
- frontend unit tests with `Vitest`
- browser end-to-end tests with `Playwright`

For user-facing end-to-end work, the preferred validation path is the full Docker Compose stack plus browser verification.

## Backend Tests

Run from `backend/`:

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:db-seeds
```

The backend has two integration suites with different infrastructure needs:

| Command | Suite | Infrastructure |
| --- | --- | --- |
| `npm run test:integration:mocked` | `*.routes.integration.test.ts` — route contracts against production route composition with stubbed services | none |
| `npm run test:integration` | `*.integration.test.ts` — real persistence against production application composition | full Compose stack |

### Running the persistence integration suite

These tests use live MySQL, Redis, Elasticsearch, and RabbitMQ. Start the stack first:

```bash
docker compose up --build -d
```

They run against an isolated `rent_test` schema, which the Compose stack does not
create for you. Create and migrate it once:

```bash
docker compose exec mysql mysql -uroot -proot -e \
  "CREATE DATABASE IF NOT EXISTS rent_test; GRANT ALL PRIVILEGES ON rent_test.* TO 'rent'@'%'; FLUSH PRIVILEGES;"
npm --prefix backend run prisma:migrate:deploy
```

The suite then owns its own namespaces: a `rent-test-<uuid>` RabbitMQ vhost and
Elasticsearch index prefix per test file, Redis database 15, and the `rent_test`
schema, which is truncated and reseeded before every test. Safety guards refuse
to run against a non-local host, a database whose name does not look like a test
database, Redis database 0, or a vhost/index prefix outside `rent-test-`.

### Port conflicts

The Compose stack publishes every backing service on a non-default host port
(MySQL `3307`, Redis `6380`, Elasticsearch `9201`, RabbitMQ `5673`/`15673`) so it
cannot collide with a service you already run locally.

If those ports are taken, override the published ports and point the test harness
at the same broker:

```bash
# .env
RABBITMQ_HOST_PORT=5674
RABBITMQ_MANAGEMENT_HOST_PORT=15674
ELASTICSEARCH_HOST_PORT=9202
```

```bash
RABBITMQ_TEST_AMQP_URL=amqp://guest:guest@127.0.0.1:5674 \
RABBITMQ_TEST_MANAGEMENT_URL=http://127.0.0.1:15674/api \
ELASTICSEARCH_TEST_URL=http://127.0.0.1:9202 \
  npm --prefix backend run test:integration
```

Both RabbitMQ variables must point at the same broker. The harness creates its
test vhost through the management API and then connects over AMQP, so if the two
URLs resolve to different brokers the vhost is created on one and connected to on
the other. Setup verifies this and fails with an explicit message naming both
endpoints rather than an opaque `ConnectionClose`.

Useful supporting checks:

```bash
npm run check:all
npm run openapi:check
npm run check:openapi-operation-coverage
npm run audit
npm run audit:signatures
```

### Endpoint coverage reporting

`check:openapi-operation-coverage` reports how many of the OpenAPI operations
have an integration test. It reads the test sources statically, so it needs no
running services and does not depend on a test run having happened.

It reports three levels, and they are not equivalent:

- **route-contract** — requested by a `*.routes.integration.test.ts` suite with
  stubbed services. Proves routing, validation, and authorization wiring.
- **persistence** — requested by a `*.integration.test.ts` suite against live
  backing services. Proves the behaviour actually persists.
- **smoke-only** — requested solely by the generic controller reachability
  matrix, which asserts only that a route is not 404 and not 5xx. This is
  **never counted as covered**.

The gate is configured in `backend/openapi-coverage.config.json`. It currently
runs in `warn` mode: the report prints and CI stays green. Preview the enforcing
outcome locally without changing the committed config:

```bash
npm run check:openapi-operation-coverage -- --enforce
npm run check:openapi-operation-coverage -- --json
```

When an operation genuinely cannot be integration tested, record it in the
`exceptions` array with a reason rather than leaving it uncovered:

```json
{
  "operationId": "receiveTelnyxWebhook",
  "reason": "Requires a live Telnyx signature; covered by the manual runbook.",
  "addedOn": "2026-08-09",
  "expiresOn": "2026-12-31"
}
```

Exceptions are keyed on `operationId`, so a renamed path surfaces as stale
instead of silently continuing to suppress. An exception that expires, names an
unknown operation, or covers an operation that now has a test is reported as a
stale exception.

Backend coverage includes configuration, middleware, route registration, auth, organizations, postings, bookings, payments, rentings, reports, search, recommendations, and seeds.

## Frontend Tests

Run from `frontend/`:

```bash
npm run lint
npm run test:unit
npm run test:unit:watch
npm run audit
npm run audit:signatures
```

Unit tests live alongside `src/**` files and use `jsdom`.

## MCP Tests

Run from `mcp/`:

```bash
npm run check
npm test
npm run audit
npm run audit:signatures
```

Only the audit scripts run in CI for this workspace; the type check, tests, and build are local-only for now.

## Playwright Tests

Run from `frontend/`:

```bash
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

By default, the Playwright config starts the frontend dev server on `http://127.0.0.1:3040`. If you want Playwright to use an already running app, set `PLAYWRIGHT_EXTERNAL_SERVER=1`.

## End-to-End Validation Workflow

For real feature validation, prefer this flow:

1. Start the full stack with `docker compose up --build` from the repo root.
2. Confirm the frontend and backend are reachable.
3. Exercise the real flow in the browser.
4. Check console and network behavior.
5. Re-run the relevant Playwright path after fixes.

Useful runtime URLs:

- frontend: `http://localhost:3040`
- backend API: `http://localhost:8040/api/v1`
- health: `http://localhost:8040/api/v1/health`

## Choosing the Right Level

- Use frontend unit tests for component logic, formatting, and client-side state transitions.
- Use backend unit or integration tests for API behavior, validation, persistence rules, and concurrency-sensitive flows.
- Use Playwright and Docker Compose for end-to-end user journeys, especially when a change crosses frontend, backend, auth, and data boundaries.

## Seeded Data for Testing

The local environment includes realistic seeded accounts and marketplace data, which makes smoke testing much faster. See [local-development.md](./local-development.md) for the account list and reseeding commands.

Most browser sign-in flows use the seeded usernames rather than the email addresses. These are the quickest accounts to reach the organization workspace states:

- `owner-one` / `owner1@rentify.local` / `Rentify123!` for owner and primary-manager flows
- `renter-one` / `user1@rentify.local` / `Rentify123!` for manager flows
- `renter-two` / `user2@rentify.local` / `Rentify123!` for operator and read-only role checks

For the full fixture list and reseeding commands, use [local-development.md](./local-development.md).
