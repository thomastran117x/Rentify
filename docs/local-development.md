# Local Development

This guide is the practical path for running Rentify locally and understanding how the repo is wired together.

## Preferred Workflow

Rentify is Docker-first for local development and end-to-end validation.

```bash
cp .env.example .env
docker compose up --build
```

This boots:

- MySQL
- Redis
- Elasticsearch
- RabbitMQ
- backend API
- email worker
- SMS worker
- frontend web app

## Local URLs

- frontend: `http://localhost:3040`
- backend root: `http://localhost:8040`
- backend API: `http://localhost:8040/api/v1`
- backend health: `http://localhost:8040/api/v1/health`
- OpenAPI YAML: `http://localhost:8040/api/v1/openapi.yaml`
- OpenAPI JSON: `http://localhost:8040/api/v1/openapi.json`
- MySQL: `localhost:3307`
- Redis: `localhost:6380`
- Elasticsearch: `http://localhost:9201`
- RabbitMQ AMQP: `amqp://localhost:5673`
- RabbitMQ management: `http://localhost:15673`

Backing services are published on non-default host ports so the stack does not
collide with services you already run locally. Override them with
`MYSQL_HOST_PORT`, `REDIS_HOST_PORT`, `ELASTICSEARCH_HOST_PORT`,
`RABBITMQ_HOST_PORT`, and `RABBITMQ_MANAGEMENT_HOST_PORT` in `.env`.

## Environment Model

The repo-root `.env` file is the main source of truth for Docker Compose.

Important behaviors:

- backend secrets and service configuration come from the repo-root `.env`
- frontend `NEXT_PUBLIC_*` values are injected during Docker image build
- `INTERNAL_API_BASE_URL` is used by the frontend server runtime inside Docker
- explicit shell or Docker-provided variables override local file defaults
- SMS defaults to the local `noop` adapter unless you intentionally configure real Telnyx credentials

Optional local overrides outside Docker:

- `backend/.env` for backend-only runs
- `frontend/.env.local` for Next.js local runs

If you change `NEXT_PUBLIC_*` values, rebuild the frontend container:

```bash
docker compose up --build
```

## Seed Data

In `development` and `test`, the backend seeds automatically when the database is empty.

Useful browser sign-in accounts:

- `owner-one` / `owner1@rentify.local` / `Rentify123!` for owner and primary-manager organization flows
- `renter-one` / `user1@rentify.local` / `Rentify123!` for manager organization flows
- `renter-two` / `user2@rentify.local` / `Rentify123!` for operator and read-only organization flows

Additional fixture accounts:

- `owner1@rentify.local` / `Rentify123!`
- `owner2@rentify.local` / `Rentify123!`
- `owner3@rentify.local` / `Rentify123!`
- `owner4@rentify.local` / `Rentify123!`
- `user1@rentify.local` / `Rentify123!`
- `user2@rentify.local` / `Rentify123!`
- `user3@rentify.local` / `Rentify123!`
- `user4@rentify.local` / `Rentify123!`
- `admin1@rentify.local` / `Rentify123!`

Useful seed commands:

```bash
cd backend
npm run seed
npm run seed -- --only-if-empty
npm run seed -- --refresh
```

Set `DATABASE_AUTO_SEED_REFRESH=true` if you want startup to refresh fixture-owned records automatically.

## Seeded MFA Bypass

In non-production only, MFA bypass can be enabled for specific accounts with `MFA_BYPASS_EMAILS`.

- format: comma-delimited email list
- normalization: trimmed, lowercased, de-duplicated
- validation: every entry must be a valid email address
- local default: Docker Compose preloads all current seeded fixture account emails

Example:

```bash
MFA_BYPASS_EMAILS=owner1@rentify.local,user1@rentify.local
```

This bypass applies to both sign-in MFA and account-management step-up MFA, and it is ignored in `production`.

## Working Package-by-Package

Backend only:

```bash
cd backend
npm install
npm run prisma:generate
npm run dev
```

Frontend only:

```bash
cd frontend
npm install
npm run dev
```

Keep in mind that many real flows assume the backend, database, and supporting services are available.

## Common Commands

Backend:

```bash
cd backend
npm run check:all
npm run test:unit
npm run test:integration
npm run openapi:check
```

Frontend:

```bash
cd frontend
npm run lint
npm run test:unit
npm run test:e2e
```

## Troubleshooting

- If Docker Compose fails on startup, confirm `.env` exists and required secrets are present.
- If the frontend is using stale public env values, rebuild with `docker compose up --build`.
- If auth behavior seems broken after a provider change, verify both backend provider settings and matching frontend public client IDs.
- If you want a clean reseed of fixture-owned data, use `npm run seed -- --refresh` from `backend/`.





