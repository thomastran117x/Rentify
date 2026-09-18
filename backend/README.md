# Rentify Backend

The backend is the Rentify API and background processing layer. It exposes the main marketplace, auth, organization, booking, payment, moderation, and renting workflows, and it also owns the Prisma schema, seed fixtures, and OpenAPI contract.

## Stack

- runtime: `Node.js 24`
- server: `Express`
- data access: `Prisma`
- database: `MySQL`
- supporting services: `Redis`, `Elasticsearch`, `RabbitMQ`
- testing: `Jest`

## Main Areas

- auth, devices, refresh sessions, personal access tokens, Google, Microsoft, and Apple OAuth
- organizations and invitation flows
- postings, reviews, availability, analytics, thumbnails, and public search
- renter activity: saved postings, saved searches, and recently viewed history
- booking requests, payments, and renting lifecycle endpoints
- moderation reports, admin search tools, profiles, and blob upload support
- background workers for analytics, booking expiry, email, SMS, logging, payments, recommendations, reports, search, thumbnails, and username availability filter rebuilds

## Architecture Notes

See the [worker index and directory READMEs](./src/app/workers/README.md) for service mappings, processing, retries, configuration, and operational checks.

- route modules are composed under `/api/v1`
- controllers delegate to feature services and repositories
- Prisma migrations live in `prisma/migrations`
- committed OpenAPI lives in `openapi/openapi.yaml` and `openapi/openapi.json`
- API responses use a shared envelope with `success`, `message`, `data`, `error`, and `meta`

## Recommended Startup

For the full local stack, start from the repo root:

```bash
cp .env.example .env
docker compose up --build
```

That brings up MySQL, Redis, Elasticsearch, RabbitMQ, the API, and the frontend together.

## Explicit Non-Docker Alternative

Use direct backend startup only when a non-Docker workflow has been explicitly selected. Provide the required infrastructure and host-reachable configuration first; backend-only scope does not remove the Docker requirement for normal validation.

```bash
npm ci
npm run prisma:generate
npm run dev
```

Environment notes:

- non-secret defaults come from `config/default.yml` and the active
  `config/{NODE_ENV}.yml` profile
- Docker Compose reads secrets and bootstrap values from the repo-root `.env`
- local non-Docker backend runs can use `backend/.env`
- use published host datasource URLs for host tooling rather than container addresses such as `mysql:3306`; see [database.md](../docs/database.md)
- `BACKEND_CONFIG_FILE` adds an optional YAML overlay; explicit environment
  variables still take precedence
- see [../docs/backend-configuration.md](../docs/backend-configuration.md) for
  the complete precedence and secret-boundary rules

## Useful Scripts

```bash
npm run dev
npm run build
npm run start
npm run format
npm run format:diff
npm run check
npm run check:test
npm run check:all
npm test
npm run test:unit
npm run test:integration
npm run test:db-seeds
npm run seed
npm run seed:refresh
npm run prisma:generate
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
npm run openapi:generate
npm run openapi:check
```

Worker watch scripts are available for an explicitly selected non-Docker workflow, for example:

```bash
npm run dev:email-worker
npm run dev:sms-worker
npm run dev:search-worker
npm run dev:recommendation-precompute-worker
npm run dev:identity-bloom-worker
```

## API Endpoints and Docs

- API base: `http://localhost:8040/api/v1`
- health: `http://localhost:8040/api/v1/health`
- OpenAPI YAML: `http://localhost:8040/api/v1/openapi.yaml`
- OpenAPI JSON: `http://localhost:8040/api/v1/openapi.json`
- committed specs: [openapi/openapi.yaml](./openapi/openapi.yaml), [openapi/openapi.json](./openapi/openapi.json)

## Database and Seeds

The backend auto-seeds in `development` and `test` when the database is empty. That makes the Docker stack usable without a separate manual bootstrap step.

With the Compose stack running, use the compiled seed script:

```bash
docker compose exec backend node dist/scripts/seed.js
docker compose exec backend node dist/scripts/seed.js --only-if-empty
docker compose exec backend node dist/scripts/seed.js --refresh
```

Set `database.autoSeedRefresh: true` in YAML (or legacy `DATABASE_AUTO_SEED_REFRESH=true`) to refresh fixtures at startup. Refresh can overwrite fixture edits. See [database.md](../docs/database.md) for seed modes, migrations, and isolated test targets.

## Tests

```bash
npm run test:unit
npm run test:integration
npm run test:db-seeds
```

The test suite covers configuration, middleware, route registration, auth, postings, organizations, bookings, payments, rentings, reports, search, recommendations, seeds, and OpenAPI validation. Follow [testing-guide.md](../docs/testing-guide.md) before persistence or seed tests; seed tests otherwise default to the application database. Use [troubleshooting.md](../docs/troubleshooting.md) for local failures.
