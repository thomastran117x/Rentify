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

## Realtime Transport

Booking request message threads are the one realtime surface. They run over a
WebSocket at `/ws/booking-messages`, outside the versioned REST prefix, fanned
out across processes by Redis pub/sub with one channel per thread.

Three things about it are worth knowing before extending it:

- **The socket is attached to the Node HTTP server directly, not routed through
  Hono.** `@hono/node-ws` peers on `@hono/node-server@^1.19.11` and this backend
  runs 2.x, so the adapter cannot be used. The consequence is that registering
  an `upgrade` listener stops Node from destroying unmatched upgrades on its
  own — a second upgrade consumer must negotiate paths with the existing
  handler rather than adding an independent listener, or unmatched sockets leak.
- **Authentication is a two-step ticket exchange.** A browser `WebSocket` cannot
  set an `authorization` header. The client posts to
  `/booking-requests/{id}/messages/socket-ticket` with its bearer token and the
  server replies with a single-use 30-second ticket in an HttpOnly cookie scoped
  to the socket path, which the browser then attaches to the upgrade. Putting
  the ticket in a query string instead would place a credential into proxy and
  access logs.
- **A connection holds no request scope.** The container scope used to redeem
  the ticket is disposed before the socket is registered, and each subsequent
  piece of work creates and disposes its own. A socket that pinned a scope would
  hold a database connection for its entire lifetime.

Access is checked at connect and re-checked every 60 seconds, on two axes that
are easy to conflate. **Membership** answers whether this user may still read
this thread. **The session** answers whether they are still signed in at all — a
logout, a password change, a token-version bump. Checking only the first leaves
a signed-out user receiving message bodies over a connection that outlives their
session while every REST call they make returns 401, so the ticket records the
session that minted it and the sweep validates both.

Presence keys are refreshed on a separate, faster interval. A refresh slower
than the key's own TTL leaves windows where the key has lapsed, and a disconnect
inside one of those goes unannounced — the counterpart is left looking at a
contact who appears permanently online.

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

### Database Connection Budget

Connection pool size is a per-process cost, not a per-request one. The API and
every worker that touches the database run as separate processes, and each owns
its own pool. Sixteen processes in the Compose stack connect: the API plus
fifteen workers. The SMS and log-consumer workers are queue-only and never open
a database connection. The email worker used to be queue-only too, but the
booking message notification job carries ids rather than a rendered recipient,
so delivery hydrates it from the database at send time.

That makes the arithmetic worth checking before adding a service. The pool holds
`DATABASE_POOL_MINIMUM_IDLE` connections at rest and grows to
`DATABASE_POOL_CONNECTION_LIMIT` under load. Compose gives the API 2/10 and each
worker 1/5, so the stack costs roughly seventeen connections idle and
eighty-five at its ceiling, against the 250 the local MySQL
container allows. A managed instance is usually stricter — connection caps there
derive from instance size, and a small instance may allow only around 150 — so
adding replicas of the API multiplies this cost rather than sharing it.

Two consequences to keep in mind:

- minimum idle must stay at or above 1; the driver only grows a pool to satisfy
  its minimum-idle target and never to satisfy a queued request, so a value of 0
  leaves every query waiting for the acquire timeout
- connections above the minimum are reaped only after the driver's 30-minute
  idle timeout, so a traffic burst holds its peak for a while before decaying

## Auth Model

Browser sessions use cookie-backed refresh tokens plus CSRF protection, while non-browser clients use refresh tokens in JSON bodies and bearer access tokens. For the full details, read [auth-session-model.md](./auth-session-model.md).

## Design Deep Dives

- booking concurrency: [booking-locking-tradeoffs.md](./booking-locking-tradeoffs.md)
- recommendation rollout: [recommendations-phase-1-activity-capture.md](./recommendations-phase-1-activity-capture.md), [recommendations-phase-2-precompute-worker.md](./recommendations-phase-2-precompute-worker.md), [recommendations-phase-3-query-api.md](./recommendations-phase-3-query-api.md)
- product and system direction: [rentify-plan.md](./rentify-plan.md)
