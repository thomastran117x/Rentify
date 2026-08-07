# Architecture Overview

This document is a practical map of how the current Rentify codebase is organized.

## High-Level Shape

Rentify is a modular full-stack application with:

- a `Next.js` frontend in `frontend/`
- a `Hono` API in `backend/`
- background workers in `backend/src/app/workers`
- shared local infrastructure through Docker Compose

At runtime, the app typically looks like this:

```text
Browser
  -> Frontend (Next.js, port 3040)
    -> Backend API (/api/v1, port 8040)
      -> MySQL for durable data
      -> Redis for cache and locking
      -> Elasticsearch for search
      -> RabbitMQ for async work
        -> background workers
```

## Frontend Layout

Main frontend areas:

- `frontend/src/app`: Next.js App Router pages and route segments
- `frontend/src/components`: UI components grouped by feature
- `frontend/src/lib`: API clients, env helpers, auth helpers, and feature-specific client logic
- `frontend/tests/e2e`: Playwright end-to-end tests

Key patterns:

- browser requests use `NEXT_PUBLIC_API_BASE_URL`
- server-side requests can use `INTERNAL_API_BASE_URL`
- API helpers expect the backend envelope with `success`, `message`, `data`, `error`, and `meta`
- auth refresh logic is handled in the frontend API client layer

## Backend Layout

Main backend areas:

- `backend/src/app/configuration`: bootstrap, env parsing, container setup, middleware, logging, and route registration
- `backend/src/app/features`: domain modules such as auth, postings, bookings, payments, organizations, rentings, reports, search, and recommendations
- `backend/src/app/workers`: long-running worker entrypoints
- `backend/src/app/seeds`: local fixture orchestration and seed modules
- `backend/prisma`: Prisma schema and migrations
- `backend/openapi`: committed OpenAPI output
- `backend/src/test`: Jest coverage for configuration, features, and integration paths

The backend follows a route-module plus feature-service structure:

- route modules register HTTP endpoints under `/api/v1`
- controllers translate requests into feature calls
- services hold application logic
- repositories handle persistence and query behavior

## Current Backend Route Areas

The route registry currently groups the API into these main areas:

- system and health routes
- auth local login/signup/session routes
- auth OAuth routes
- auth device and personal access token routes
- organizations
- profiles and blob upload support
- reports and moderation
- search admin
- owner posting management
- posting analytics, reviews, availability, and activity
- saved postings (renter wishlist)
- booking requests
- payments
- rentings
- public posting discovery and detail routes

## Background Workers

Workers currently cover:

- postings analytics
- booking expiry
- email delivery
- SMS delivery and webhook processing
- log consumption
- payment retry, repair, and payout release
- posting thumbnail generation
- recommendation activity and precompute
- report search indexing
- search maintenance and indexing

This keeps the API focused on request-response work while heavier or asynchronous processing can be handled off the main server path.

## Data and Infrastructure Responsibilities

- MySQL: source of truth for product and transactional data
- Redis: cache and concurrency helpers such as booking-related locking
- Elasticsearch: search indexes and query acceleration
- RabbitMQ: queue backbone for worker-driven async jobs

## Auth Model

Browser sessions use cookie-backed refresh tokens plus CSRF protection, while non-browser clients use refresh tokens in JSON bodies and bearer access tokens. For the full details, read [auth-session-model.md](./auth-session-model.md).

## Design Deep Dives

- booking concurrency: [booking-locking-tradeoffs.md](./booking-locking-tradeoffs.md)
- recommendation rollout: [recommendations-phase-1-activity-capture.md](./recommendations-phase-1-activity-capture.md), [recommendations-phase-2-precompute-worker.md](./recommendations-phase-2-precompute-worker.md), [recommendations-phase-3-query-api.md](./recommendations-phase-3-query-api.md)
- product and system direction: [rentify-plan.md](./rentify-plan.md)
