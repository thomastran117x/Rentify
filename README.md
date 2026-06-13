# Rentify

Rentify is a full-stack rental marketplace for listing, discovering, booking, paying for, and managing rentable items. This repository contains the web app, API, background workers, seed data, and local infrastructure needed to run the platform end to end.

## What Exists Today

- public marketplace browsing and posting detail pages
- owner posting creation and management flows
- booking request, payment, and renting lifecycle flows
- local auth plus Google and Microsoft OAuth
- organizations and invitation management
- moderation, reporting, search, recommendations, and analytics foundations

## Stack

- frontend: `Next.js 16`, `React 19`, `Tailwind CSS 4`
- backend: `Node.js 22`, `Hono`, `Prisma`
- infrastructure: `MySQL`, `Redis`, `Elasticsearch`, `RabbitMQ`
- testing: `Vitest`, `Jest`, `Playwright`
- integrations: `Azure Blob Storage`, `Square`, OAuth providers

## Start Here

Rentify is Docker-first for local development.

```bash
cp .env.example .env
docker compose up --build
```

Once the stack is up:

- frontend: `http://localhost:3040`
- backend root: `http://localhost:8040`
- backend API: `http://localhost:8040/api/v1`
- health check: `http://localhost:8040/api/v1/health`
- OpenAPI YAML: `http://localhost:8040/api/v1/openapi.yaml`
- RabbitMQ management: `http://localhost:15672`

## Seeded Accounts

The backend auto-seeds local data in `development` and `test` when the database is empty.

- `owner1@rentify.local` / `Rentify123!`
- `owner2@rentify.local` / `Rentify123!`
- `owner3@rentify.local` / `Rentify123!`
- `owner4@rentify.local` / `Rentify123!`
- `user1@rentify.local` / `Rentify123!`
- `user2@rentify.local` / `Rentify123!`
- `user3@rentify.local` / `Rentify123!`
- `user4@rentify.local` / `Rentify123!`
- `admin1@rentify.local` / `Rentify123!`

The fixture set includes postings, bookings, payments, rentings, reviews, search rows, and analytics data for realistic local testing.

## Repository Guide

```text
/backend    API, Prisma schema, seeds, workers, OpenAPI spec
/docs       onboarding, architecture, testing, and design docs
/frontend   Next.js web application
/mcp        MCP server and related tooling
```

Package-specific docs:

- [backend/README.md](./backend/README.md)
- [frontend/README.md](./frontend/README.md)

Project docs hub:

- [docs/README.md](./docs/README.md)

## Common Commands

Full stack:

```bash
docker compose up --build
```

Backend:

```bash
cd backend
npm run dev
npm test
```

Frontend:

```bash
cd frontend
npm run dev
npm run test:unit
npm run test:e2e
```

## API Contract

The backend returns a shared JSON envelope:

```json
{
  "success": true,
  "message": "Request completed successfully.",
  "data": {},
  "error": null,
  "meta": {
    "requestId": "..."
  }
}
```

The committed API spec lives at [backend/openapi/openapi.yaml](./backend/openapi/openapi.yaml).

## Documentation

- [docs/README.md](./docs/README.md): documentation hub
- [docs/api.md](./docs/api.md): API entry point that redirects to the OpenAPI spec
- [docs/local-development.md](./docs/local-development.md): setup, envs, services, local workflows
- [docs/architecture-overview.md](./docs/architecture-overview.md): how the app is organized today
- [docs/testing-guide.md](./docs/testing-guide.md): unit, integration, and end-to-end validation flow
- [docs/rentify-plan.md](./docs/rentify-plan.md): long-form product and system plan
