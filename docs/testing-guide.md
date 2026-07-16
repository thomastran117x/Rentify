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

Useful supporting checks:

```bash
npm run check:all
npm run openapi:check
```

Backend coverage includes configuration, middleware, route registration, auth, organizations, postings, bookings, payments, rentings, reports, search, recommendations, and seeds.

## Frontend Tests

Run from `frontend/`:

```bash
npm run lint
npm run test:unit
npm run test:unit:watch
```

Unit tests live alongside `src/**` files and use `jsdom`.

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
