# API Guide

This document is intentionally lightweight. The source of truth for Rentify endpoint details is the generated OpenAPI spec, not this page.

## Where To Look

Use one of these references instead of duplicating route docs by hand:

- committed spec: [../backend/openapi/openapi.yaml](../backend/openapi/openapi.yaml)
- committed JSON spec: [../backend/openapi/openapi.json](../backend/openapi/openapi.json)
- local served spec: `http://localhost:8040/api/v1/openapi.yaml`
- local served JSON spec: `http://localhost:8040/api/v1/openapi.json`
- local API base: `http://localhost:8040/api/v1`
- local health check: `http://localhost:8040/api/v1/health`

## Why This Page Is Small

Rentify's API surface changes often enough that hand-maintained endpoint lists drift quickly. Keeping the generated OpenAPI artifacts as the canonical reference makes it easier to:

- document every route in one place
- keep request and response shapes aligned with code
- avoid stale docs in multiple files
- validate that route registration and the committed spec stay in sync

## API Response Shape

Most JSON responses use the shared envelope below:

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

## Reporting Server Errors

For HTTP 500–599 failures, client error messages include `Request ID: <id>` when
the server supplies a valid request ID. Include this reference when reporting an
issue so support can find the corresponding backend logs.

The frontend prefers `meta.requestId` and falls back to the `x-request-id` response
header, including for unreadable or non-JSON error bodies. CORS exposes this header
to allowed browser origins. If neither source provides a valid ID, the existing
error message is shown without a reference. Client errors (including 429) and
network failures do not display request IDs. There is no separate trace ID.

## Authentication Security

Local sign-in failures are tracked in Redis by normalized username. Five
combined invalid-password or supplied-invalid-TOTP attempts within 15 minutes
lock that username for 30 minutes. While the lock is active, every local login
attempt returns `423 ACCOUNT_LOCKED`, even when the password and authenticator
code are correct, and no session is issued.

The first MFA round trip, where the password is correct but no TOTP code was
supplied, returns an `mfaRequired` challenge and does not count as a failure.
The failure record is cleared only after the password, email-verification, and
login MFA checks all succeed. Unknown usernames use the same schedule and a
timing-safe dummy password hash so the lockout behavior does not disclose
whether an account exists.

A locked user can recover with the emailed code through
`POST /auth/local/unlock`; successful verification clears the shared failure
record. Because the lock is keyed by username, another person who knows a
username can temporarily lock out its owner. The emailed unlock code is the
current mitigation. Per-IP credential-stuffing detection is tracked in
[#379](https://github.com/thomastran117x/Rentify/issues/379).

## Realtime Surfaces

Socket.IO connections are not HTTP operations, so the spec cannot describe them
directly. Each one is reached by first calling its ticket endpoint, which _is_ in
the spec and documents the frames the socket carries:

| Socket path            | Ticket operation                            | Auth                                                             |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `/ws/booking-messages` | `createBookingMessageSocketTicket`          | Signed-in participant only                                       |
| `/ws/blog-comments`    | `createOrganizationBlogCommentSocketTicket` | Optional — an unauthenticated caller receives a read-only ticket |

Both return the ticket as an HttpOnly cookie scoped to the socket path rather
than in the response body, and both reject personal access tokens. See
[architecture-overview.md](./architecture-overview.md#realtime-transport) for the
room and presence design.

## Working With The Spec

From `backend/`:

```bash
npm run openapi:check
npm run openapi:generate
```

Use `openapi:check` to confirm the committed YAML and JSON specs match the current backend routes and schemas. Use `openapi:generate` when backend API changes are intentional and the specs need to be refreshed.

## Related Docs

- [architecture-overview.md](./architecture-overview.md): where API modules live in the backend
- [testing-guide.md](./testing-guide.md): how API changes should be validated
- [../backend/README.md](../backend/README.md): backend scripts, startup, and API endpoints
