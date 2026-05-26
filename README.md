# Rentify

Rentify is a rental marketplace platform where users can list rentable assets such as homes, rooms, equipment, tools, and other items, while other users can discover listings, message owners, request bookings, and complete payments through the platform.

The project is being built as a web-first application with a Node-based backend and room to expand into mobile clients, richer search, and AI/integration tooling over time.

## Vision

Rentify is intended to support the full rental workflow:

- owners create and manage listings
- renters search and compare available listings
- both sides communicate through in-platform messaging
- renters submit booking requests
- owners approve arrangements
- payments and follow-up notifications are handled through the platform

## Tech Stack

The project is planned to stay primarily within the Node ecosystem:

- Backend: `Node.js`, `Hono`, `Prisma`
- Database: `MySQL`
- Cache: `Redis`
- Web client: `Next.js`, `React`
- End-to-end testing: `Playwright`
- File storage: `Azure Blob Storage`
- Search: `Elasticsearch`
- Future mobile client: `React Native`
- Future automation / AI tooling: Node-based `MCP`

## Architecture Direction

The current direction is a modular monolith backend with clear feature boundaries. That keeps delivery fast early on while leaving room to split out heavier concerns later.

Planned infrastructure includes:

- `Azure Blob Storage` for media uploads
- `Elasticsearch` for marketplace search
- a future message broker for decoupled async work such as email sending, notification fanout, indexing, reminders, and payout-related workflows

## Repository Structure

Current and planned structure:

```text
/backend
/docs
/web                 # planned
/mobile              # optional later
/mcp                 # optional later
```

## Current Status

The repository already contains an early backend foundation, including:

- server bootstrap with `Hono`
- environment loading
- database and Redis resource setup
- authentication foundations
- profile-related backend modules
- blob upload support
- email service support

The main product planning document lives here:

- [docs/rentify-plan.md](C:/Users/thoma/Documents/Rent/docs/rentify-plan.md)

## Near-Term Priorities

- finalize MVP scope and booking rules
- expand the Prisma schema for marketplace entities
- add backend modules for listings, bookings, messaging, and payments
- scaffold the `web` application
- define API contracts for the primary owner and renter flows

## Development Notes

At the moment, the backend workspace is under `backend/`.

Useful backend scripts:

- `npm run dev`
- `npm run seed`
- `npm run seed:dev`
- `npm run seed:refresh`
- `npm run build`
- `npm run check`
- `npm run prisma:generate`
- `npm run prisma:migrate:dev`
- `npm run test:db-seeds`

Run them from:

```bash
cd backend
```

## Docker

The repository now includes Docker support for:

- `MySQL`
- `Redis`
- `Elasticsearch`
- the `backend` service
- the `frontend` service

From the repo root, start everything with:

```bash
cp .env.example .env
docker compose up --build
```

Exposed ports:

- frontend: `http://localhost:3040`
- backend: `http://localhost:8040`
- backend API root: `http://localhost:8040/api/v1`
- MySQL: `localhost:3307`
- Redis: `localhost:6380`
- Elasticsearch: `http://localhost:9201`

Notes:

- `docker compose` reads backend secrets and frontend public env values from the repo-root `.env` file.
- Start by copying `.env.example` to `.env`, then replace the placeholder secrets before using the stack beyond local bootstrapping.
- Frontend `NEXT_PUBLIC_*` values are consumed at build time, so after changing them you should rerun `docker compose up --build`.
- The backend container runs `prisma migrate deploy` before starting the server.
- In `development` and `test`, the backend now auto-seeds when the database is empty.
- Set `DATABASE_AUTO_SEED_REFRESH=true` to force a refresh of fixture-owned records on startup.
- You can manually invoke the orchestrator with `npm run seed`.
- Use `npm run seed:refresh` or `npm run seed -- --refresh` to force a refresh.
- Use `npm run seed -- --only-if-empty` if you want a one-off guarded manual run.
- The local Docker stack now runs the backend in `development` mode, so startup seeding follows the same rules there.
- Local fixture accounts include:
  - `owner1@rentify.local` / `Rentify123!`
  - `owner2@rentify.local` / `Rentify123!`
  - `owner3@rentify.local` / `Rentify123!`
  - `owner4@rentify.local` / `Rentify123!`
  - `user1@rentify.local` / `Rentify123!`
  - `user2@rentify.local` / `Rentify123!`
  - `user3@rentify.local` / `Rentify123!`
  - `user4@rentify.local` / `Rentify123!`
  - `admin1@rentify.local` / `Rentify123!`
- The seed set includes 62 postings and 27 bookings, along with related payments, rentings, reviews across 5 reviewed postings, search rows, and analytics fixtures for local browsing and testing.

Local app overrides:

- Docker Compose expects the shared repo-root `.env`.
- The backend can optionally read `backend/.env` for local non-Docker runs.
- The frontend can optionally read `frontend/.env.local` through Next.js native env loading.
- Explicit shell or Docker-provided environment variables keep precedence over local env files.
## Documentation

- Application plan: [docs/rentify-plan.md](C:/Users/thoma/Documents/Rent/docs/rentify-plan.md)
- Backend OpenAPI YAML: [backend/openapi/openapi.yaml](C:/Users/thoma/Documents/Rent/backend/openapi/openapi.yaml)
- Served OpenAPI YAML: `http://localhost:8040/api/v1/openapi.yaml`

As the project evolves, it would be useful to add:

- `docs/api-design.md`
- `docs/domain-model.md`
- setup instructions for local development
- deployment notes
