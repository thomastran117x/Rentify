# Coding Agent Implementation Guide

## Goal

This guide applies to any coding agent working in this repository, including Codex, Claude, and similar tools.

When implementing a user-facing or end-to-end feature, the agent should not stop at code changes. It should update all required layers, run the application locally through Docker, verify the feature through the UI and API when applicable, and keep tests and documentation aligned with the behavior that shipped.

For browser validation, the agent should ask whether it is expected to run Playwright MCP end-to-end validation or whether the user will test manually. If the user does not choose, default to agent-run Playwright MCP validation for user-facing changes.

The expected local stack startup command is:

```bash
docker compose up --build
```

The Docker Compose stack is the source of truth for local frontend and backend execution because it provides the required infrastructure, service wiring, and environment variables.

## Task Ownership, Branches, and Logical Commits

Carry the authorized task through implementation, applicable validation, documentation, and commits until it is complete. Do not stop at a plan, a partial implementation, or a passing build. Resolve issues found during validation and repeat the affected checks. If a genuine blocker prevents progress, explain the blocker, completed work, and the exact input or external change needed; do not claim completion.

Before editing, read applicable agent instructions and inspect `git status --short` and `git branch --show-current`. Never implement or commit directly on `main` or `master`. Create a descriptive task branch first, for example `git switch -c docs/update-contributor-guidance`. On a suitable existing task branch, continue there. For a detached HEAD, create a task branch before editing. Preserve unrelated user changes; do not reset, discard, or commit them.

Define logical phases before substantial implementation. Commit each coherent phase automatically after its applicable checks pass, then continue working through the remaining phases. A phase should deliver a reviewable behavior or subsystem change, including its associated tests, API artifacts, and documentation. Do not split solely by file type, leave intentionally broken intermediate commits, or collect the whole task into one final commit when it has distinct phases. A small single-purpose task may need only one commit.

Use Conventional Commits, for example `feat(bookings): validate owner approval` or `docs(workers): explain delivery retries`. Stage explicit paths or hunks belonging to the phase, inspect `git diff --cached` and `git diff --cached --check`, and commit only task changes. Prefer independently cherry-pickable commits; when dependencies are necessary, record their order and explain them in the final handoff. Include follow-up fixes in separate focused commits rather than rewriting existing history.

Do not push, merge, squash, amend existing commits, or otherwise rewrite history unless the user requests it. Local commits are part of the normal implementation workflow. Report commit hashes, purposes, dependencies, validation results, and any task changes left uncommitted.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contributor workflow and validation expectations.

## Pull Request Descriptions

Follow [docs/pull-requests.md](./docs/pull-requests.md) and the default or specialized PR templates. Include Summary, Context, Changes, API, How to Test, and Reviewer Notes. Explain the problem and resulting behavior, affected backend methods/paths and contracts (or explicitly none), reproducible user- or consumer-level steps with expected results, risks, and commit dependencies. Omit routine CI commands, passing test counts, coverage, and lint output from PR descriptions; reserve Reviewer Notes for exceptional skipped, unavailable, failing, or non-CI validation. Keep descriptions aligned with the final change and do not claim unperformed checks.

For visual changes to core frontend pages or flows, include actual screenshots with page/state/viewport captions when browser capture is available. Capture useful success and relevant validation states during browser verification; provide local artifact paths or attach images during authorized publication. If tools cannot capture them, explain why and provide capture steps. Screenshots are supporting evidence, not a replacement for the applicable browser-validation requirements. Non-visual changes can mark screenshots not applicable.

Prepare a complete PR description for handoff; publishing a PR still requires user authorization.

## Pull Request Reviews

Follow [docs/pr-review.md](./docs/pr-review.md) for author self-review and requested PR reviews. Review both behavior (bugs, edge cases, regressions, security, and tests) and code quality (readability, responsibilities, complexity, duplication, abstractions, typing, error handling, dependencies, conventions, and test maintainability). Correct behavior does not exempt code from quality review.

A review request authorizes inspection and reporting, not edits or commits. Fix findings only when remediation is explicitly requested. Report actionable behavioral defects and code-quality issues with evidence, file/line references, impact-based P0-P3 priorities, and proportionate remedies. Keep optional suggestions separate. State the result for both review categories, checks performed, and remaining gaps. Do not publish comments, submit remote approval/change requests, or merge without explicit authorization.

## Documentation-Only Tasks

For changes limited to Markdown and documentation templates, check formatting, relative links and anchors, documented commands and configuration against source, and diff hygiene. Docker startup, application tests, OpenAPI generation, dependency audits, and browser validation are not required unless the task also changes the runtime, contracts, or dependencies to which those checks apply. State which documentation checks ran and which runtime checks were skipped.

The end-to-end requirements below apply to runtime and user-facing changes. This documentation-only exception also applies to the Docker and completion rules below.

---

## Validation Ownership

Before treating a user-facing change as complete, the agent should confirm who owns end-to-end validation.

- If the agent owns end-to-end validation, it should start the full stack with Docker Compose and run Playwright MCP against the real flow.
- If the user owns end-to-end validation, the agent should still run applicable non-UI checks, use Docker for local verification unless the user explicitly requested a non-Docker workflow, provide clear manual validation steps, and state that Playwright MCP validation was not performed.
- If the user does not specify, default to agent-run Playwright MCP validation for user-facing changes.

Do not claim browser validation was completed unless it actually was.

---

## Expected Workflow

For every end-to-end feature, follow this process:

1. Understand the requested change and identify whether it affects the frontend, backend, database, API contract, authentication, background jobs, tests, or documentation.
2. Confirm who will perform end-to-end browser validation for user-facing work.
3. Plan logical commit phases, then implement the feature in small, focused changes across all affected layers on a task branch.
4. Update contracts, tests, and documentation alongside the code.
   - If the change touches a `package.json` or `package-lock.json`, run `npm run audit:all` in that workspace and review install-script changes with `npm approve-scripts --allow-scripts-pending`, deleting any obsolete `allowScripts` entries by hand. See [docs/dependency-security.md](./docs/dependency-security.md).
5. Start the full stack with Docker Compose.
6. Run the appropriate validation path:
   - Agent-run path: use Playwright MCP, fix issues found, and re-run until the flow works.
   - User-run path: run applicable non-UI checks, document manual validation steps, and clearly note what remains unverified in the browser.
7. Commit validated logical phases as they become complete. Summarize what changed, commit hashes and dependencies, what was validated, what was not validated, and any known risks or assumptions.

---

## Running the Application

For local frontend and backend execution, use Docker Compose:

```bash
docker compose up --build
```

Do not assume the frontend or backend is already running.

After startup, verify that the required services are healthy and reachable.

Common local URLs may include:

```txt
Frontend: http://localhost:3040
Backend:  http://localhost:8040
```

Use the actual ports from `docker-compose.yml` if they differ.

Unless the user explicitly requests a non-Docker workflow, do not use direct local startup commands such as:

```bash
npm run dev
rails server
dotnet run
python app.py
```

Those commands do not provide the full repo-standard infrastructure and environment configuration that Docker Compose does.

---

## End-to-End Feature Requirements

When building an end-to-end feature, the agent should update all required layers.

A complete feature may include:

```txt
frontend/
  - pages/routes
  - components
  - forms
  - validation
  - API client functions
  - loading/error/empty states

backend/
  - routes/controllers
  - services
  - repositories/data access
  - DTOs/request/response models
  - validation
  - authorization checks
  - database migrations/schema updates
  - OpenAPI contract updates

tests/
  - unit tests where useful
  - integration tests where useful
  - Playwright MCP browser validation when the agent owns E2E validation

docs/
  - setup or feature documentation affected by the change
```

Do not implement only the frontend or only the backend unless the requested change is explicitly limited to one layer.

---

## Playwright MCP Validation

If the agent owns browser validation, use Playwright MCP after the stack is running.

The agent should validate the real user flow, not just inspect the code.

Examples of what to test:

```txt
- Can the user navigate to the feature?
- Does the page render correctly?
- Can the user submit the form?
- Are validation errors shown correctly?
- Does the frontend call the correct backend endpoint?
- Does the backend return the expected response?
- Does the UI update after success?
- Are loading states, empty states, and error states handled?
- Does the feature still work after refresh?
```

If the user is handling browser validation instead, provide manual steps that cover the intended success path and at least one failure or validation path when applicable.

---

## Playwright MCP Testing Rules

When using Playwright MCP:

1. Open the frontend URL in the browser.
2. Navigate like a real user.
3. Interact with buttons, inputs, links, dropdowns, and modals.
4. Verify visible UI output.
5. Check that expected data appears.
6. Test at least one success path.
7. Test at least one failure or validation path when applicable.
8. Capture and fix any console errors.
9. Capture and fix any network or API errors.
10. Re-run the relevant flow after fixes.

---

## Docker Compose Requirement

For normal local validation in this repository, frontend and backend should be run through Docker Compose.

Required command:

```bash
docker compose up --build
```

Do not rely on:

```bash
npm run dev
rails server
dotnet run
python app.py
```

unless the user explicitly asks for a non-Docker workflow.

Docker Compose is the authoritative local runtime because it carries the infrastructure and environment variables that the application expects.

---

## Handling Startup Issues

If `docker compose up --build` fails, debug the issue before continuing.

Check for:

```txt
- Missing environment variables
- Incorrect build context
- Broken Dockerfile
- Port conflicts
- Database connection errors
- Migration failures
- Missing dependencies
- Service healthcheck failures
- Incorrect service names
```

After fixing startup issues, rerun:

```bash
docker compose up --build
```

Then continue with the selected validation path.

---

## Database and Seed Data

If the feature needs data to test properly, check whether seed data already exists.

If test data is missing, add or update seed data rather than hardcoding one-off values into production logic.

Seed data should be realistic enough to test the user flow.

Examples:

```txt
- Test users
- Products/listings/postings
- Orders/bookings
- Reviews
- Inventory records
- Categories/tags
```

For local browser validation, prefer the seeded accounts defined in `backend/src/app/seeds/fixtures/users.ts`. The most useful role-based logins are:

- `owner-one` / `owner1@rentify.local` / `Rentify123!` for owner and primary-manager organization flows
- `renter-one` / `user1@rentify.local` / `Rentify123!` for manager organization flows
- `renter-two` / `user2@rentify.local` / `Rentify123!` for operator and read-only organization flows

Use the username when the UI expects username sign-in, and use the seeded email when validating email-based auth or MFA behavior.

---

## API Contract and OpenAPI Expectations

For frontend and backend features, keep the API contract clear, consistent, and up to date.

When backend routes, request or response payloads, authentication requirements, or error shapes change, update the committed OpenAPI artifacts:

- `backend/openapi/openapi.yaml`
- `backend/openapi/openapi.json`

Use the existing backend commands:

```bash
npm --prefix backend run openapi:generate
npm --prefix backend run openapi:check
```

JSON responses use the shared envelope in `backend/src/app/configuration/http/responses.ts`; a `204` response has no body. Representative response shapes are:

Success:

```json
{
  "success": true,
  "message": "Operation completed successfully.",
  "data": {},
  "error": null,
  "meta": {
    "requestId": "..."
  }
}
```

Error:

```json
{
  "success": false,
  "message": "Validation failed.",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {}
  },
  "meta": {
    "requestId": "..."
  }
}
```

Keep frontend expectations aligned with backend responses and the committed OpenAPI contract.

---

## Authentication and Authorization

If the feature requires authentication:

1. Verify login works through the selected validation path.
2. Use an existing seeded user if available.
3. Confirm protected pages redirect unauthenticated users.
4. Confirm unauthorized users cannot perform restricted actions.
5. Confirm API endpoints enforce the same rules as the UI.

Do not rely only on frontend route guards.

Backend authorization must also be enforced.

---

## Frontend Quality Checklist

Before considering the feature complete, confirm:

```txt
- Page is responsive
- Loading state exists
- Empty state exists where needed
- Error state exists
- Form validation works
- Buttons are disabled during submission
- Success feedback is shown
- UI does not crash on bad API responses
- No obvious layout shift or broken styling
- Browser console has no unexpected errors when the agent performs browser validation
```

---

## Backend Quality Checklist

Before considering the feature complete, confirm:

```txt
- Route is registered correctly
- Request validation exists
- Service logic is isolated from controller logic
- Database access is handled safely
- Errors are returned consistently
- Authorization is enforced
- Edge cases are handled
- Logs are useful but do not leak sensitive data
- OpenAPI artifacts are updated when backend contracts change
```

---

## Backend Test Expectations

When backend behavior changes:

- Add or update automated tests for the changed behavior.
- Add or update integration tests for routes, validation, authorization, persistence, and error handling when those behaviors are affected.
- Preserve backend automated coverage at 90% or higher, consistent with the thresholds defined in `backend/jest.unit.config.cjs`.
- Do not lower coverage thresholds to make a change pass.

Treat backend changes without matching automated coverage as incomplete work.

---

## Documentation Expectations

Update relevant documentation when behavior, setup, contracts, workflows, or validation expectations change.

Inspect existing repo conventions before editing, and prefer extending current patterns over inventing new ones.

---

## Completion Criteria

The work is not complete just because the build succeeds.

If the agent owns end-to-end browser validation, the feature is not complete until Playwright MCP has been used to verify it.

If the user owns end-to-end browser validation, the agent should clearly hand off with:

- the Docker command used for local runtime
- the checks that were performed
- explicit manual browser test steps
- expected outcomes
- any unverified areas or known limitations

A final response should include:

```txt
- What was implemented
- What files changed
- What Docker Compose command was used
- Whether Playwright MCP was run or the user is expected to test manually
- What flows were tested by the agent
- Any bugs found and fixed
- Any known limitations, assumptions, or skipped validation
```

---

## Important Rules

Do not mark an end-to-end feature as complete without either:

- completed browser validation by the agent, or
- an explicit handoff that the user will perform browser validation

Do not only inspect the code.

Do not assume the app works because the build succeeds.

Do not skip Docker Compose unless the user explicitly instructs a non-Docker workflow.

Do not ignore console or network errors.

Do not leave broken flows partially implemented.

Do not let backend contract changes ship without OpenAPI updates.

Do not let backend test coverage regress below 90.

---

## Preferred Behavior

The agent should behave like a full-stack engineer validating its own work.

The expected standard is:

```txt
Code is updated across all affected layers.
OpenAPI is updated when backend contracts change.
Backend automated coverage stays at or above 90.
Integration tests are added or updated for backend behavior changes.
The stack runs through Docker Compose.
The feature is validated through Playwright MCP or explicitly handed off for user testing.
Errors discovered during validation are fixed.
The final summary explains what was tested, what was not tested, and why.
```
