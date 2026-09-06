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

- auth, devices, refresh sessions, personal access tokens, Google OAuth, Microsoft OAuth
- organizations and invitation flows
- postings, reviews, availability, analytics, thumbnails, and public search
- booking requests, payments, and renting lifecycle endpoints
- moderation reports, admin search tools, profiles, and blob upload support
- background workers for analytics, booking expiry, email, SMS, logging, payments, recommendations, reports, search, thumbnails, and username availability filter rebuilds

## Architecture Notes

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

## Standalone Backend Development

If you are working only on the backend package, you can run it directly after installing dependencies and providing the required infrastructure.

```bash
npm install
npm run prisma:generate
npm run dev
```

Environment notes:

- Docker Compose reads from the repo-root `.env`
- local non-Docker backend runs can use `backend/.env`
- explicit shell variables still take precedence

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

Worker watch scripts are also available for individual services, for example:

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

Useful commands:

```bash
npm run seed
npm run seed -- --only-if-empty
npm run seed -- --refresh
```

Set `DATABASE_AUTO_SEED_REFRESH=true` if you want startup to refresh fixture-owned records automatically.

## Tests

```bash
npm run test:unit
npm run test:integration
npm run test:db-seeds
```

The test suite covers configuration, middleware, route registration, auth, postings, organizations, bookings, payments, rentings, reports, search, recommendations, seeds, and OpenAPI validation.
