# Rentify Docs

This folder is the working documentation set for the Rentify repository. Use it as the first stop for local setup, architecture orientation, testing workflows, and deeper design notes.

## Start Here

- [api.md](./api.md): where to find the canonical API spec and how to keep it current
- [local-development.md](./local-development.md): quickest path to running the full stack, understanding env files, and using seeded accounts
- [architecture-overview.md](./architecture-overview.md): high-level map of the frontend, backend, workers, and infrastructure
- [testing-guide.md](./testing-guide.md): command map for backend, frontend, and Docker-first end-to-end validation

## Product and Planning

- [rentify-plan.md](./rentify-plan.md): long-form product vision, system direction, phases, and domain design

## Auth, Booking, and Recommendations Deep Dives

- [auth-session-model.md](./auth-session-model.md): browser versus API/mobile session model and CSRF behavior
- [booking-locking-tradeoffs.md](./booking-locking-tradeoffs.md): current booking-window locking strategy and why it is intentionally conservative
- [recommendations-phase-1-activity-capture.md](./recommendations-phase-1-activity-capture.md): recommendation event ingestion design
- [recommendations-phase-2-precompute-worker.md](./recommendations-phase-2-precompute-worker.md): recommendation precompute job design
- [recommendations-phase-3-query-api.md](./recommendations-phase-3-query-api.md): recommendation query API direction

## Code and API References

- [../backend/README.md](../backend/README.md): backend scripts, workers, seeds, and API notes
- [../frontend/README.md](../frontend/README.md): frontend envs, app areas, and test scripts
- [../backend/openapi/openapi.yaml](../backend/openapi/openapi.yaml): committed OpenAPI spec

## Suggested Reading Order

1. Read [local-development.md](./local-development.md) to get the app running.
2. Read [architecture-overview.md](./architecture-overview.md) to understand where features live.
3. Read [testing-guide.md](./testing-guide.md) before changing behavior.
4. Use the deep-dive docs when you need specific design context.
