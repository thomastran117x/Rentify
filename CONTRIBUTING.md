# Contributing to Rentify

Start with the [project README](./README.md), [local development guide](./docs/local-development.md), [architecture overview](./docs/architecture-overview.md), and [testing guide](./docs/testing-guide.md). Package READMEs describe backend, frontend, and MCP commands. Coding agents must also follow [AGENTS.md](./AGENTS.md) and instructions in the directories they change.

## Branches and Commits

Inspect the working tree and branch before changing files:

```bash
git status --short
git branch --show-current
```

Never implement or commit directly on `main` or `master`. Create a descriptive task branch from the intended base, or continue on an existing branch for the task:

```bash
git switch -c docs/update-contributor-guidance
```

Preserve unrelated work. Do not discard another contributor's edits or include them in your commits.

Divide substantial tasks into coherent phases by behavior or subsystem. Each commit should include the implementation and associated tests, contracts, and documentation needed to understand and validate that phase. Prefer commits that can be cherry-picked independently; document required earlier commits when separation is impractical. Do not split a working feature into broken commits merely to increase the commit count. A small task can be one commit.

Use Conventional Commits: `feat(bookings): validate approval`, `fix(auth): reject expired tickets`, or `docs(workers): describe queue delivery`. Agents commit each phase automatically once its applicable checks pass, and continue until the task is complete.

Stage explicit paths or hunks, review `git diff --cached`, and run `git diff --cached --check` before committing. Avoid whole-repository staging when unrelated changes exist. Do not rewrite existing history or push/merge on behalf of a user without their instruction.

## Local Runtime and Validation

The standard application runtime is Docker Compose, from the repository root:

```bash
docker compose up --build
```

Use the actual service ports and environment setup in the local development guide. Direct package startup is an alternative only when explicitly selected; it does not provide the stack's infrastructure or environment wiring.

| Change             | Required validation                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation only | Markdown formatting, relative links/anchors, command/configuration accuracy, and diff hygiene; no Docker or browser run required          |
| Frontend behavior  | Applicable lint, type checks, tests/build, plus Docker and real-flow browser validation for user-facing changes                           |
| Backend behavior   | Applicable app/test type checks, automated tests, persistence integration tests for affected routes/rules, and unit coverage at least 90% |
| API contract       | Update both committed OpenAPI artifacts; run `openapi:generate`, `openapi:check`, and the operation integration coverage check            |
| Dependencies       | Follow the dependency security guide, audit the changed workspace, and review install-script permissions                                  |
| Database/workers   | Validate affected persistence, migration, processing, retries, and failure behavior with the relevant real infrastructure                 |

Checks are cumulative when a change touches multiple areas. Use the testing guide for exact commands and isolated integration infrastructure. Do not lower coverage or coverage-check thresholds to pass a change.

For user-facing changes, agree who owns browser validation. Agents default to Playwright MCP against the Docker stack when the user has not chosen manual testing. If the user owns validation, run applicable non-UI checks and provide success and failure-path manual steps. Never claim browser checks passed unless they ran.

## Dependencies, Contracts, and Migrations

Each package has its own manifest and lockfile. When either changes, run `npm run audit:all` in that workspace and review install-script changes with `npm approve-scripts --allow-scripts-pending`; manually remove obsolete `allowScripts` entries. Follow [dependency-security.md](./docs/dependency-security.md) for the complete workflow.

When routes, payloads, authentication requirements, or errors change, update `backend/openapi/openapi.yaml` and `backend/openapi/openapi.json` alongside implementation and tests:

```bash
npm --prefix backend run openapi:generate
npm --prefix backend run openapi:check
npm --prefix backend run check:openapi-operation-coverage
```

Include Prisma migrations with schema changes, validate against the intended database, and describe data compatibility and rollout requirements. Do not rewrite an already applied migration or use an unreviewed reset as a migration strategy. Keep seeds aligned with changed behavior and use existing fixtures for local validation.

## Preparing a Pull Request

Follow the [PR review guide](./docs/pr-review.md) for author self-review and reviewing another contributor's changes. Both behavioral correctness and code quality are required review dimensions.

Use the existing [feature](./.github/PULL_REQUEST_TEMPLATE/feature.md) or [bug](./.github/PULL_REQUEST_TEMPLATE/bug.md) template. Explain the problem, resulting behavior, scope, and risks. Include migrations, required configuration, or manual steps where applicable.

Review the full diff and commit sequence before handoff. Record commands and outcomes, Docker/browser validation ownership, unavailable checks, and any ordering dependencies between commits. Treat blockers honestly and distinguish completed checks from checks still needed.

Agents should complete authorized implementation, validation, documentation, and local commits before handing back the task. A passing build alone does not establish that a user flow works.
