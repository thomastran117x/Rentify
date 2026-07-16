# Codex End-to-End Feature Implementation Guide

## Goal

When implementing an end-to-end feature, Codex should not stop at code changes. It should also run the application locally, verify the feature through the UI/API, and use the Playwright MCP to test the completed flow.

The expected local stack startup command is:

```bash
docker compose up --build
```

Codex should assume the full application must be running through Docker Compose before end-to-end validation can begin.

---

## Expected Workflow

For every end-to-end feature, follow this process:

1. Understand the requested feature.
2. Identify the affected areas:
   - Frontend
   - Backend
   - Database/schema
   - API contracts
   - Authentication/authorization
   - Background workers
   - Tests
   - Documentation
3. Implement the feature in small, focused changes.
4. Start the full stack with Docker Compose.
5. Use the Playwright MCP to validate the feature through the browser.
6. Fix any issues found during validation.
7. Repeat Playwright verification until the feature works.
8. Summarize the completed changes and tested flows.

---

## Running the Application

Before using Playwright MCP, start the application with:

```bash
docker compose up --build
```

Do not assume the frontend or backend is already running.

After startup, verify that the required services are healthy and reachable.

Common local URLs may include:

```txt
Frontend: http://localhost:3000
Backend:  http://localhost:8080
```

Use the actual ports from `docker-compose.yml` if they differ.

---

## End-to-End Feature Requirements

When building an end-to-end feature, Codex should update all required layers.

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

tests/
  - unit tests where useful
  - integration tests where useful
  - Playwright MCP browser validation
```

Do not implement only the frontend or only the backend unless the requested feature is explicitly limited to one layer.

---

## Playwright MCP Validation

After the stack is running, use the Playwright MCP to test the feature in the browser.

Codex should validate the real user flow, not just inspect the code.

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
9. Capture and fix any network/API errors.
10. Re-run the relevant flow after fixes.

---

## Docker Compose Requirement

For end-to-end testing, Codex must use Docker Compose.

Required command:

```bash
docker compose up --build
```

Codex should not rely on:

```bash
npm run dev
rails server
dotnet run
python app.py
```

unless the user explicitly asks for a non-Docker workflow.

The Docker Compose stack is the source of truth for local end-to-end validation.

---

## Handling Startup Issues

If `docker compose up --build` fails, Codex should debug the issue before continuing.

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

Then continue with Playwright MCP validation.

---

## Database and Seed Data

If the feature needs data to test properly, Codex should check whether seed data already exists.

If test data is missing, Codex may add or update seed data.

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

Do not hardcode test-only data into production logic.

---

## API Contract Expectations

For frontend/backend features, ensure the API contract is clear and consistent.

A recommended success response shape is:

```json
{
  "message": "Operation completed successfully.",
  "data": {},
  "error": null,
  "details": null
}
```

A recommended error response shape is:

```json
{
  "message": "Validation failed.",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "details": {}
  }
}
```

Keep frontend expectations aligned with backend responses.

---

## Authentication and Authorization

If the feature requires authentication:

1. Verify login works through the browser.
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
- Browser console has no unexpected errors
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
- Tests are added where valuable
- Logs are useful but do not leak sensitive data
```

---

## Playwright MCP Completion Criteria

The feature is not complete until Playwright MCP has been used to verify it.

A final Codex response should include:

```txt
- What was implemented
- What files changed
- What Docker Compose command was used
- What Playwright MCP flows were tested
- Any bugs found and fixed
- Any known limitations
```

Example final summary:

```md
## Summary

Implemented the booking request feature end-to-end.

### Changed

- Added backend booking request endpoint
- Added booking service validation
- Added frontend booking form
- Added loading, success, and error states
- Added seed data for available listings

### Validation

Started the stack with:

```bash
docker compose up --build
```

Tested with Playwright MCP:

- Opened the listings page
- Selected an available listing
- Submitted a valid booking request
- Confirmed success message appeared
- Tested missing required fields
- Confirmed validation errors appeared
- Checked browser console for unexpected errors

### Notes

No known blocking issues remain.
```

---

## Important Rules

Do not mark an end-to-end feature as complete without browser validation.

Do not only inspect the code.

Do not assume the app works because the build succeeds.

Do not skip Docker Compose unless explicitly instructed.

Do not skip Playwright MCP validation for user-facing features.

Do not ignore console or network errors.

Do not leave broken flows partially implemented.

---

## Preferred Behavior

Codex should behave like a full-stack engineer validating its own work.

The expected standard is:

```txt
Code compiles.
Stack runs.
Feature works in the browser.
Playwright MCP confirms the flow.
Errors discovered during testing are fixed.
Final summary explains what was tested.
```


