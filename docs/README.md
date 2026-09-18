# Rentify Docs

This folder is the working documentation set for the Rentify repository. Use it as the first stop for local setup, architecture orientation, testing workflows, and deeper design notes.

## Start Here

- [pull-requests.md](./pull-requests.md): PR description format, API/test evidence, reviewer notes, and frontend screenshots

- [pr-review.md](./pr-review.md): author self-review, behavioral correctness, code quality, and actionable findings

- [../CONTRIBUTING.md](../CONTRIBUTING.md): contributor workflow, branches, logical commits, and validation

- [api.md](./api.md): where to find the canonical API spec and how to keep it current
- [local-development.md](./local-development.md): quickest path to running the full stack, understanding env files, and using seeded accounts
- [backend-configuration.md](./backend-configuration.md): layered backend YAML profiles, secrets, and overrides
- [architecture-overview.md](./architecture-overview.md): high-level map of the frontend, backend, workers, and infrastructure
- [testing-guide.md](./testing-guide.md): command map for backend, frontend, and Docker-first end-to-end validation

## Database and Operations

- [database.md](./database.md): connection targets, migrations, seeds, and isolated test databases
- [troubleshooting.md](./troubleshooting.md): startup, ports, configuration, authentication, logs, queues, and search

## Product and Planning

- [rentify-plan.md](./rentify-plan.md): long-form product vision, system direction, phases, and domain design

## Security

- [dependency-security.md](./dependency-security.md): dependency auditing, the CI severity gate, install-script allowlists, Socket.dev, and the remediation runbook
- [content-screening.md](./content-screening.md): text screening rules and term-bank maintenance

## Code and API References

- [Worker index](../backend/src/app/workers/README.md): every background entrypoint, Compose mapping, configuration, and operations

- [../backend/README.md](../backend/README.md): backend scripts, workers, seeds, and API notes
- [../frontend/README.md](../frontend/README.md): frontend envs, app areas, and test scripts
- [../mcp/README.md](../mcp/README.md): stdio MCP server, configuration, tools, and Compose integration
- [../backend/openapi/openapi.yaml](../backend/openapi/openapi.yaml): committed OpenAPI YAML spec
- [../backend/openapi/openapi.json](../backend/openapi/openapi.json): committed OpenAPI JSON spec

## Suggested Reading Order

1. Read [CONTRIBUTING](../CONTRIBUTING.md) for branches, commits, and validation expectations.
2. Read [local-development.md](./local-development.md) to get the app running.
3. Read [architecture-overview.md](./architecture-overview.md) to understand where features live.
4. Read [testing-guide.md](./testing-guide.md) before changing behavior and [pr-review.md](./pr-review.md) before handoff or review.
5. Use database, worker, and other deep-dive references for the area you change; read dependency security before changing dependencies.
