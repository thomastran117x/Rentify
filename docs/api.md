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

## Security Headers

Every response carries `Content-Security-Policy`, `Permissions-Policy`,
`Referrer-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
and `X-Permitted-Cross-Domain-Policies`, plus `Strict-Transport-Security` in
production. `securityHeadersMiddleware` is mounted on the app ahead of every
other middleware, so CORS preflights, CSRF `403`s, `429`s and `404`s carry them
too.

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
combined invalid-password or invalid-authenticator-code attempts within 15
minutes lock that username for 30 minutes. While the lock is active, every
local login attempt returns `423 ACCOUNT_LOCKED`, even when the password and
authenticator code are correct, and no session is issued.

When the password is correct but the account needs an authenticator code,
the response is a login MFA challenge (see
[Signing In With an Authenticator App](#signing-in-with-an-authenticator-app)).
Issuing it does not count as a failure. The failure record is cleared only
after the password, email-verification, and login MFA checks all succeed.
Unknown usernames use the same schedule and a timing-safe dummy password hash
so the lockout behavior does not disclose whether an account exists.

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

Users can put their own account on a security hold ("This wasn't me"). Both
endpoints use the `auth-sensitive` rate limit, record `account.locked` with
`metadata.source` `user`, and queue an `account_self_locked` confirmation email.
A password reset lifts the hold.

- `POST /auth/account/self-lock` is public and takes `{ "token": "..." }`, a
  single-use token from an emailed link that lasts 24 hours. A valid token
  always returns `200` with `{ "locked": true }`, even when the account was
  already locked or suspended (neither changes). An unknown, expired or used
  token returns `410 GONE`.
- `POST /auth/account/self-lock/session` locks the signed-in caller's account.
  It needs a recent MFA step-up (`mfa-management` scope) and clears the
  browser's session cookies. An account with no local password to reset gets
  `409` with `details.reason` `password_reset_unavailable`.

Suspicious-activity detection can block an IP address from the `auth-sensitive`
policy (`429` with `details.reason` `ip_blocked`). Administrators see and lift
those blocks:

- `GET /admin/auth/ip-blocks` lists the blocked addresses with `expiresAt`, and
  records an `admin.audit_viewed` event.
- `DELETE /admin/auth/ip-blocks/:ip` lifts one block (`204`) and records
  `admin.ip_unblocked`. An address that is not blocked is a `404`.

Suspicious-activity alerts to the account owner are `suspicious_login` email
jobs.

See [auth-security.md](./auth-security.md#investigating-sign-in-activity),
[Account Status](./auth-security.md#account-status),
[Locking Your Own Account](./auth-security.md#locking-your-own-account) and
[Suspicious Activity Detection](./auth-security.md#suspicious-activity-detection).

### Session Cookies

Browser sign-in, refresh and logout keep the session in two cookies. Native
and API clients send the refresh token in the request body instead and get no
cookies.

| Cookie                   | Over plain http | Attributes                             | Holds                               |
| ------------------------ | --------------- | -------------------------------------- | ----------------------------------- |
| `__Host-rentify_refresh` | `refresh_token` | `HttpOnly; Secure; SameSite=Lax`       | The refresh token                   |
| `__Host-rentify_csrf`    | `csrf_token`    | `Secure; SameSite=Lax`, readable by JS | The token to echo in `x-csrf-token` |

Both have `Path=/` and no `Domain`, and live as long as the refresh token. The
`__Host-` prefix makes the browser refuse either cookie unless it is `Secure`,
host-only and on `/`, so a sibling subdomain can neither set nor overwrite it.
The frontend reads the CSRF cookie the API sets, so the frontend and the API
must be served from the same host; the port may differ.

Cookies are `Secure` in production, and locally only when `AUTH_COOKIE_SECURE`
is set (see [backend configuration](./backend-configuration.md#session-cookies)).
Over plain http they keep the `refresh_token` and `csrf_token` names, since a
`__Host-` cookie cannot be set without `Secure`.

Sessions issued before the rename still carry `refresh_token` and `csrf_token`.
The API accepts them as a pair, writes the `__Host-` cookies on the next
refresh and expires the old ones in the same response; logout clears all four.
It never pairs a `__Host-` refresh cookie with a legacy CSRF cookie. The legacy
fallback can be removed once one remember-me refresh-token lifetime (90 days,
`REMEMBER_ME_REFRESH_TOKEN_TTL_SECONDS`) has passed since the rename shipped.

### Signing In With an Authenticator App

When the account has an authenticator app, a correct password (or a verified
Google, Microsoft or Apple sign-in) is refused with the same
`401 UNAUTHORIZED` and `details.mfaRequired` it has always returned. The
details now also carry a login MFA challenge:

```json
{
  "success": false,
  "message": "Authenticator code is required.",
  "error": {
    "code": "UNAUTHORIZED",
    "details": {
      "mfaRequired": true,
      "mfaChallengeToken": "opaque-token",
      "availableFactors": ["totp"],
      "expiresInSeconds": 300
    }
  }
}
```

The client finishes with `POST /auth/login/mfa`, sending
`{ "mfaChallengeToken", "factor": "totp", "code", "deviceId" }`. That returns
the usual session response. The client never sends the password or the
provider token again. A client written before the challenge existed can still
ignore it and send the credentials again with `totpCode`.

- **Lifetime.** The challenge lasts five minutes. It is single-use: the
  sign-in it completes deletes it, and a concurrent second attempt gets `409`.
- **Binding.** The challenge belongs to the user, sign-in method and device
  that started it. Send the same `deviceId` as the first step. A challenge
  that is unknown, expired, already used, sent from another device, or voided
  by a password change or sign-out-everywhere returns
  `401 MFA_CHALLENGE_INVALID`, and the client starts again.
- **Wrong codes.** A wrong code returns `400 INVALID_MFA_CODE` and counts
  towards the username lockout described earlier, whichever way the sign-in
  started. The fifth locks the username, which also voids the challenge. A
  locked username gets `423 ACCOUNT_LOCKED` from this step even with a
  correct code.
- **New devices.** The code that completes the sign-in also counts as the
  `device-login` step-up for the new session, so the new-device check does
  not ask for a second code.

`totpCode` on `/auth/local/login` and `/auth/oauth/*` is **deprecated**. It is
still accepted for API clients that send the code together with the first
step. A wrong one still counts towards the lockout, and a correct one clears
it, for social sign-ins too.

Locally, almost every seeded account is on `auth.mfaBypassEmails` in
`backend/config/development.yml` and never sees this step. `totp-one`
(`totp1@rentify.local`, `Rentify123!`) is seeded off that list for trying it:
enroll an authenticator app from **Account → Security**, sign out, and sign in
again. [login-totp.spec.ts](../frontend/tests/e2e/login-totp.spec.ts) does the
same and removes the authenticator afterwards.

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
