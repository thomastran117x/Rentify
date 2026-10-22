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

Users can review their own authentication history through
`GET /auth/audit/me`. The endpoint needs a signed-in session with a recent MFA
step-up (`mfa-management` scope), returns only the caller's events newest
first, and pages with an opaque `cursor`. `limit` is 1 to 50 (default 20),
`category` is `sign_in`, `security_changes` or `sessions`, `outcome` is
`success`, `failure` or `blocked`, and the optional
`from` (inclusive) and `to` (exclusive) ISO date-times bound the time range. Each item is a
user-safe projection with a server-written `label`. Identifier hashes, actor
IDs, request IDs, session and device IDs, raw user agents and metadata are
never returned. See
[auth-security.md](./auth-security.md#reading-your-own-activity).

Administrators investigate sign-in activity across every account through two
admin-only endpoints. Both need an `admin` signed-in session; every other role
gets `403` and personal access tokens are rejected. Each call first records an
`admin.audit_viewed` audit event with the reader as actor and the filters as
metadata, and fails if that write fails.

- `GET /admin/auth/audit` searches events newest first. Filters are `userId`,
  `user` (an email or username resolved server side; one matching no account
  finds the attempts made with it), `ip`, a repeatable `eventType`, `outcome`,
  and `from`/`to`. The window defaults to the last seven days and may not
  exceed 90 days. `limit` is 1 to 100 (default 25), and paging uses an opaque
  `cursor`. Each item carries every stored column except the identifier hash,
  plus `subject` and `actor` summaries (`{ id, email, username }`); the
  response also echoes the `range` searched.
- `GET /admin/users/:id/security` summarizes one account: account status,
  last sign-in, failed sign-ins in the last 24 hours and 7 days, the live
  lockout state, registered devices and the 20 most recent events. An unknown
  ID is a `404`.

Administrators change an account's durable status through three more
admin-only endpoints, with the same access rules. Each takes
`{ "reason": "..." }` (5 to 255 characters), returns the new status details,
records an `account.*` audit event and queues an email to the user. An admin
cannot change their own status (`403`).

- `POST /admin/users/:id/lock` puts the account on a security hold, ending
  every session and personal access token. A suspended account is a `409`.
- `POST /admin/users/:id/suspend` suspends the account, ending every session
  and personal access token.
- `POST /admin/users/:id/reinstate` sets the account back to active. An
  account that is already active returns `changed: false`.

A locked account's sign-in returns `423 ACCOUNT_LOCKED` with
`details.reason` `security_hold`, and a suspended one `403 ACCOUNT_SUSPENDED`.

See [auth-security.md](./auth-security.md#investigating-sign-in-activity) and
[Account Status](./auth-security.md#account-status).

## Realtime Surfaces

Socket.IO connections are not HTTP operations, so the spec cannot describe them
directly. Each one is reached by first calling its ticket endpoint, which _is_ in
the spec and documents the frames the socket carries:

| Socket path            | Ticket operation                            | Auth                                                             |
| ---------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `/ws/booking-messages` | `createBookingMessageSocketTicket`          | Signed-in participant only                                       |
| `/ws/blog-comments`    | `createOrganizationBlogCommentSocketTicket` | Optional — an unauthenticated caller receives a read-only ticket |
| `/ws/media`            | `createMediaStatusSocketTicket`             | Signed-in user; hears only about their own uploads               |

Each returns the ticket as an HttpOnly cookie scoped to the socket path rather
than in the response body, and each rejects personal access tokens. See
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
