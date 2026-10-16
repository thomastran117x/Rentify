# Authentication Audit Log

The backend records authentication activity in the `auth_audit_events` table and writes one structured log line for each event. The record answers "who tried to sign in to which account, from where, and what happened". It backs the later security-activity and admin views, but has no read API yet.

Code lives in [backend/src/app/features/auth/audit](../backend/src/app/features/auth/audit). Flows write through `AuthAuditService.recordSafely`, which never fails or retries. If the insert fails, the error is logged and the sign-in, unlock or sign-out goes ahead unchanged.

## What Is Recorded

| Event type               | Outcome   | Reason             | Written when                                                                                                                     |
| ------------------------ | --------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `login.succeeded`        | `success` |                    | A local password sign-in issues a session. Carries `session_id`.                                                                 |
| `login.failed`           | `failure` | `bad_credentials`  | The username is unknown or the password is wrong                                                                                 |
| `login.failed`           | `failure` | `email_unverified` | The password is right but the email address was never verified                                                                   |
| `login.failed`           | `failure` | `mfa_invalid`      | The password is right but the authenticator code was rejected                                                                    |
| `login.mfa_challenged`   | `success` | `mfa_required`     | The password is right, and the account needs an authenticator code that was not sent. The first factor passed.                   |
| `login.locked`           | `blocked` | `locked`           | Each attempt answered with `423`. On the attempt that set the lock, `metadata` is `{ "triggered": true, "failureReason": ... }`. |
| `login.unlock_requested` | `success` |                    | `POST /auth/local/unlock/resend` emailed an unlock code                                                                          |
| `login.unlock_requested` | `failure` | `not_locked`       | The address is unknown or not locked, so nothing was sent                                                                        |
| `login.unlock_requested` | `blocked` | `rate_limited`     | The resend was rate-limited                                                                                                      |
| `login.unlocked`         | `success` |                    | `POST /auth/local/unlock` accepted the code                                                                                      |
| `login.unlocked`         | `failure` | `otp_invalid`      | The unlock code was rejected                                                                                                     |
| `logout`                 | `success` |                    | `POST /auth/logout`. `method` is `pat` when a personal access token signed out.                                                  |

Each local sign-in attempt writes exactly one event. The fifth failed attempt, the one that sets the lock, is recorded as `login.locked`, not as `login.failed`.

The unlock responses are the same whether or not a code was sent, so the endpoint does not reveal which addresses exist. Only the audit row tells the cases apart.

Requests rejected before reaching the auth service are not recorded yet. That covers failed captcha, request validation and rate-limiter `429`s. OAuth, refresh, credential-change and rate-limit events are planned next. `users.last_login_at` is updated on every fresh sign-in, OAuth included, as a best-effort write.

## The Table

| Column            | Type            | Notes                                                                                                                     |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `VARCHAR(36)`   | UUID                                                                                                                      |
| `user_id`         | `VARCHAR(36)?`  | The account the event is about. Null when the identifier matched no account, and set to null when the account is deleted. |
| `actor_user_id`   | `VARCHAR(36)?`  | Set only when someone other than the subject acted, such as an admin. Unused for now.                                     |
| `event_type`      | `VARCHAR(80)`   | See the catalogue above                                                                                                   |
| `outcome`         | `VARCHAR(16)`   | `success`, `failure` or `blocked`                                                                                         |
| `reason_code`     | `VARCHAR(60)?`  | See the catalogue above                                                                                                   |
| `method`          | `VARCHAR(20)?`  | `password`, `google`, `microsoft`, `apple`, `refresh` or `pat`                                                            |
| `identifier_hash` | `VARCHAR(64)?`  | HMAC-SHA256 of the typed identifier; see below                                                                            |
| `ip_address`      | `VARCHAR(45)?`  | The client IP the request middleware resolved                                                                             |
| `user_agent`      | `VARCHAR(512)?` | Truncated to the column width                                                                                             |
| `device_id`       | `VARCHAR(64)?`  | The body's `deviceId`, else `x-device-id`. A sign-out uses its token's device. Truncated.                                 |
| `session_id`      | `VARCHAR(64)?`  | The session a sign-in opened or a sign-out closed                                                                         |
| `request_id`      | `VARCHAR(64)?`  | The `x-request-id` the response carried                                                                                   |
| `metadata`        | `JSON?`         | Small, non-secret extras only                                                                                             |
| `created_at`      | `DATETIME(6)`   | Set by the database                                                                                                       |

Indexes: `(user_id, created_at)`, `(actor_user_id, created_at)`, `(ip_address, created_at)`, `(event_type, created_at)` and `(identifier_hash, created_at)`.

Order events by `created_at`, never by insert order or `id`. Rows outlive their user: deleting an account sets `user_id` to null on its rows rather than deleting them.

## What Is Never Stored

The table and the log lines never contain a password, a one-time or authenticator code, an access, refresh or personal access token, or the identifier the caller typed. The log line carries the event type, outcome, reason, user id, identifier hash, IP and request id, and nothing else.

## Why Identifiers Are Hashed

Credential stuffing and password spraying target usernames that often do not exist, so those attempts have no `user_id`. To correlate them, the row keeps `identifier_hash`: an HMAC-SHA256 of the normalized identifier, keyed by `AUTH_AUDIT_IDENTIFIER_SECRET`. Normalizing means Unicode NFKC, trimmed and lowercased.

- Equal identifiers produce equal hashes. "Every attempt at this username" and "every username this IP tried" are both index lookups.
- The raw value is never stored. A mistyped password in the username field, or a real person's email typed by mistake, does not end up in the table.
- A keyed hash, unlike a plain SHA-256, cannot be reversed by hashing a list of likely usernames without the server secret.

Sign-in events hash the username. The unlock routes are keyed by email, so their events hash the email instead. Usernames cannot contain `@`, so the two never collide.

To look up a known identifier, compute its hash with the same secret and normalization. The backend container already has the secret in its environment:

```bash
docker compose exec backend node -e "
  const { createHmac } = require('node:crypto');
  const id = process.argv[1].normalize('NFKC').trim().toLowerCase();
  console.log(createHmac('sha256', process.env.AUTH_AUDIT_IDENTIFIER_SECRET).update(id).digest('hex'));
" owner-one
```

`hashAuthIdentifier` in `auth-audit-identifier.ts` is the source of truth for this computation.

Rotating `AUTH_AUDIT_IDENTIFIER_SECRET` breaks correlation between rows written before and after the rotation. The secret is required, must be at least 32 characters, and is independent of the token secrets, so rotating those does not affect it. See [backend-configuration.md](./backend-configuration.md).

## Client IP Behind a Proxy

`ip_address` is whatever the client-context middleware resolved. It is never re-parsed from headers. With `http.trustProxyHeaders` (`TRUST_PROXY_HEADERS`) off, the address is the socket peer. Behind a reverse proxy, that is the proxy's own address. Turn the setting on only where a trusted proxy sets `X-Forwarded-For`.

## Inspecting Events Locally

With the stack running:

```bash
docker compose exec mysql mysql -urent -prent rent -e "
  SELECT created_at, event_type, outcome, reason_code, user_id, ip_address, request_id
  FROM auth_audit_events ORDER BY created_at DESC LIMIT 20;"
```

The matching log lines are emitted by `AuthAuditService` with the message `Auth event.`.
