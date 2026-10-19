# Authentication Audit Log

The backend records authentication activity in the `auth_audit_events` table and writes one structured log line for each event. The record answers "who tried to sign in to which account, from where, and what happened". Users read their own history through `GET /auth/audit/me` (see [Reading Your Own Activity](#reading-your-own-activity)); there is no admin read API yet.

Code lives in [backend/src/app/features/auth/audit](../backend/src/app/features/auth/audit). Flows write through `AuthAuditService.recordSafely`, which never fails or retries. If the insert fails, the error is logged and the authentication operation goes ahead unchanged.

## What Is Recorded

| Event type                       | Outcome   | Reason                        | Written when                                                                                                                     |
| -------------------------------- | --------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `login.succeeded`                | `success` |                               | A local password sign-in issues a session. Carries `session_id`.                                                                 |
| `login.failed`                   | `failure` | `bad_credentials`             | The username is unknown or the password is wrong                                                                                 |
| `login.failed`                   | `failure` | `email_unverified`            | The password is right but the email address was never verified                                                                   |
| `login.failed`                   | `failure` | `mfa_invalid`                 | The password is right but the authenticator code was rejected                                                                    |
| `login.mfa_challenged`           | `success` | `mfa_required`                | The password is right, and the account needs an authenticator code that was not sent. The first factor passed.                   |
| `login.locked`                   | `blocked` | `locked`                      | Each attempt answered with `423`. On the attempt that set the lock, `metadata` is `{ "triggered": true, "failureReason": ... }`. |
| `login.unlock_requested`         | `success` |                               | `POST /auth/local/unlock/resend` emailed an unlock code                                                                          |
| `login.unlock_requested`         | `failure` | `not_locked`                  | The address is unknown or not locked, so nothing was sent                                                                        |
| `login.unlock_requested`         | `blocked` | `rate_limited`                | The resend was rate-limited                                                                                                      |
| `login.unlocked`                 | `success` |                               | `POST /auth/local/unlock` accepted the code                                                                                      |
| `login.unlocked`                 | `failure` | `otp_invalid`                 | The unlock code was rejected                                                                                                     |
| `logout`                         | `success` |                               | `POST /auth/logout`. `method` is `pat` when a personal access token signed out.                                                  |
| `oauth.login.succeeded`          | `success` |                               | A linked provider signs in. Carries the provider method, verified-email HMAC, user and new session.                              |
| `oauth.login.failed`             | `failure` | `token_invalid`               | Provider verification failed. The user and identifier hash are null/absent.                                                      |
| `oauth.login.failed`             | `failure` | `email_conflict`              | A verified provider email already belongs to another sign-in method.                                                             |
| `oauth.login.failed`             | `failure` | `signup_expired`              | A signup continuation is missing, expired, or already consumed. Provider context is included only when it is still available.    |
| `oauth.login.failed`             | `failure` | `mfa_required`, `mfa_invalid` | A linked OAuth account needs MFA or rejected its MFA code.                                                                       |
| `oauth.signup.completed`         | `success` |                               | Direct or continued OAuth signup creates the user and session. Issuing a continuation token alone writes no event.               |
| `oauth.linked`                   | `success` |                               | A provider identity was newly linked. Carries the provider, user and acting session.                                             |
| `oauth.unlinked`                 | `success` |                               | A provider identity was actually removed. Carries the provider, user and acting session.                                         |
| `session.refresh_reuse_detected` | `blocked` |                               | A consumed refresh token was replayed outside its five-second grace period. Carries method `refresh` and the revoked session.    |
| `session.revoked`                | `success` |                               | Device removal revoked an active session. One row is written per revoked session; metadata is `{ "source": "device" }`.          |
| `device.new_detected`            | `success` |                               | An unknown device was detected. Metadata records `emailNotification` as `sent` or `suppressed`.                                  |
| `password.changed`               | `success` |                               | A local password was replaced using the current password. Carries method `password` and the replacement session.                 |
| `password.reset`                 | `success` |                               | Password recovery completed. Also carries the normalized username HMAC.                                                          |
| `password.set`                   | `success` |                               | A social-only account added its first local password.                                                                            |
| `email.changed`                  | `success` |                               | Email change completed. Metadata contains only `oldEmailMasked` and `newEmailMasked`.                                            |
| `mfa.totp_enabled`               | `success` |                               | A pending TOTP factor was activated.                                                                                             |
| `mfa.totp_disabled`              | `success` |                               | An active TOTP factor was removed; pending/missing factors do not emit it.                                                       |
| `mfa.step_up_failed`             | `failure` | `mfa_invalid` or blank        | A confirm code was invalid, or challenge delivery failed. Metadata contains only stage, scope, factor and result.                |
| `mfa.step_up_locked`             | `blocked` | `rate_limited`                | Challenge/confirm windows, OTP cooldown, repeated-code lock, and attempts during that lock.                                      |
| `pat.created`                    | `success` |                               | A personal access token was created. Carries method `pat` and metadata `{ "tokenId": ... }`, never the token.                    |
| `pat.revoked`                    | `success` |                               | A personal access token changed from active to revoked. Repeated revoke calls write no event.                                    |
| `rate_limit.exceeded`            | `blocked` | `rate_limited`                | A Redis-backed `auth-sensitive` or `auth-refresh` policy returned 429. See dedupe rules below.                                   |

Each local sign-in attempt writes exactly one event. The fifth failed attempt, the one that sets the lock, is recorded as `login.locked`, not as `login.failed`.

The unlock responses are the same whether or not a code was sent, so the endpoint does not reveal which addresses exist. Only the audit row tells the cases apart. Failed captcha and request validation are still outside this catalogue. `users.last_login_at` is updated on every fresh sign-in, OAuth included, as a best-effort write.

### Rate-limit dedupe

Only `auth-sensitive` and `auth-refresh` 429 responses are audited. Before writing, the middleware atomically claims `auth:audit:rate-limit:<policy>:<ip-or-user>` in Redis with `SET NX EX` for the policy window. A burst therefore writes at most one row for the same policy and identity per window. Authenticated requests use the user identity; other requests use the resolved client IP. Metadata is exactly `{ "policy": ..., "identityType": "user" | "ip" }`, and `auth-refresh` also records method `refresh`.

When rate-limit evaluation falls back to process memory because Redis is unavailable, auditing is skipped. A dedupe or audit-write failure is caught and never changes the 429 response.

## The Table

| Column            | Type            | Notes                                                                                                                       |
| ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `id`              | `VARCHAR(36)`   | UUID                                                                                                                        |
| `user_id`         | `VARCHAR(36)?`  | The account the event is about. Null when the identifier matched no account, and set to null when the account is deleted.   |
| `actor_user_id`   | `VARCHAR(36)?`  | Set only when someone other than the subject acted, such as a future admin session revocation. Self-service leaves it null. |
| `event_type`      | `VARCHAR(80)`   | See the catalogue above                                                                                                     |
| `outcome`         | `VARCHAR(16)`   | `success`, `failure` or `blocked`                                                                                           |
| `reason_code`     | `VARCHAR(60)?`  | See the catalogue above                                                                                                     |
| `method`          | `VARCHAR(20)?`  | `password`, `google`, `microsoft`, `apple`, `refresh` or `pat`                                                              |
| `identifier_hash` | `VARCHAR(64)?`  | HMAC-SHA256 of the typed identifier; see below                                                                              |
| `ip_address`      | `VARCHAR(45)?`  | The client IP the request middleware resolved                                                                               |
| `user_agent`      | `VARCHAR(512)?` | Truncated to the column width                                                                                               |
| `device_id`       | `VARCHAR(64)?`  | The body's `deviceId`, else `x-device-id`. A sign-out uses its token's device. Truncated.                                   |
| `session_id`      | `VARCHAR(64)?`  | The session opened, closed, revoked, reused, or acting on the credential change                                             |
| `request_id`      | `VARCHAR(64)?`  | The `x-request-id` the response carried                                                                                     |
| `metadata`        | `JSON?`         | Small, non-secret extras only                                                                                               |
| `created_at`      | `DATETIME(6)`   | Set by the database                                                                                                         |

Indexes: `(user_id, created_at)`, `(actor_user_id, created_at)`, `(ip_address, created_at)`, `(event_type, created_at)`, `(identifier_hash, created_at)` and `(created_at)`. The last serves the retention prune.

Order events by `created_at`, never by insert order or `id`. Rows outlive their user: deleting an account sets `user_id` to null on its rows rather than deleting them.

## Reading Your Own Activity

`GET /auth/audit/me` returns the signed-in user's own events, newest first. It is served by `AuthAuditController.listMine` and `AuthAuditActivityService`, and it is documented in the OpenAPI spec as `listMySecurityActivity`.

- **Who can call it.** It needs a signed-in session with a recent MFA step-up for the `mfa-management` scope, the same guard as `GET /auth/devices`. Without the step-up it returns `401 MFA_VERIFICATION_REQUIRED`. Personal access tokens are rejected.
- **Whose events it returns.** Only the caller's. The user ID comes from the session and no parameter can override it; the query schema is strict, so an extra parameter such as `userId` is a `400 VALIDATION_ERROR`. Rows with a null `user_id`, such as unknown-username attempts, are never returned to anyone.
- **Query.** `limit` is 1 to 50 and defaults to 20. `category` is one of the values below. `outcome` is `success`, `failure` or `blocked`. `from` (inclusive) and `to` (exclusive) are ISO 8601 date-times with `Z` or an offset, and every filter combines with the others. A `to` that is not later than `from` is a `400`. `cursor` is the previous page's `nextCursor`, which is null on the last page. Keep the same filters while following it. A malformed cursor is a `400`.
- **What each item contains.** `id`, `type`, `outcome`, `label`, `occurredAt`, `method`, `ipAddress`, `browser`, `os`, `deviceKnown` and `current`. `toSecurityActivityItem` builds the item field by field. `identifier_hash`, `actor_user_id`, `reason_code`, `request_id`, `session_id`, `device_id`, the raw user agent and `metadata` never leave the server.

Field details:

- `label` is server-side wording keyed by event type and refined by reason and method, for example "Signed in with password", "Failed sign-in: wrong password" or "Signed in with Google". An event type with no wording yet reads "Account activity".
- When `actor_user_id` is set and is not the user, the label reads as an administrator action, for example "An administrator locked your account". The administrator is never identified.
- `browser` and `os` come from a small in-house user-agent parser (`parseUserAgent`). Unrecognised agents are null, and the account page shows them as "Unknown device".
- `current` is true when the event's session is the caller's current session.
- `deviceKnown` is true when the event's device ID matches one of the user's registered devices.

| Category           | Event types                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sign_in`          | `login.*`, `oauth.login.succeeded`, `oauth.login.failed`, `oauth.signup.completed`, `mfa.step_up_failed`, `mfa.step_up_locked`, `rate_limit.exceeded`                          |
| `security_changes` | `password.changed`, `password.reset`, `password.set`, `email.changed`, `mfa.totp_enabled`, `mfa.totp_disabled`, `oauth.linked`, `oauth.unlinked`, `pat.created`, `pat.revoked` |
| `sessions`         | `logout`, `session.revoked`, `session.refresh_reuse_detected`, `device.new_detected`                                                                                           |

The cursor is an opaque wrapper around the last event's ID, and paging uses Prisma's cursor. Prisma compares against that row's stored `created_at` in SQL, so the microsecond precision survives and events written in the same millisecond, such as several sessions revoked at once, are neither skipped nor repeated. A JavaScript `Date` would keep only milliseconds. A cursor naming another user's event, or one since pruned, yields an empty last page.

### On the Account Page

Account → Security shows the list as **Security activity**, below **Registered devices**. The Security tab already asks for the `mfa-management` step-up, so opening the list needs no further prompt. The component is [security-activity-panel.tsx](../frontend/src/components/account/security-activity-panel.tsx), and its API client is in [frontend/src/lib/security-activity](../frontend/src/lib/security-activity).

Each row shows:

- the server label;
- a relative time, with the full date and time on hover;
- an icon for the sign-in method;
- the browser and OS, or "Unknown device" when neither is recognised;
- the IP address.

Badges mark the current session ("This session") and unregistered devices ("New device"). Failed rows are rose with a "Failed" badge and blocked rows are amber with a "Blocked" badge, so the outcome does not rely on colour alone.

The filter buttons (All, Sign-ins, Security changes, Sessions), the **Status** select (Any status, Succeeded, Failed, Blocked) and the **From** and **To** dates all combine, and changing any of them restarts the list from the newest event. Both dates are local days and both are included: the page sends the start of From and the start of the day after To. A To date before From shows an inline error and loads nothing until it is fixed. **Clear dates** removes the range. When a status or date narrows the list to nothing, it reads "No activity matches these filters". **Load more** follows `nextCursor`, 20 events at a time. Loading, empty ("No recent activity") and error-with-retry states are handled. First pages are cached in memory (`frontend/src/lib/security-activity/cache.ts`), keyed by the user ID and every filter, so switching tabs or filters back and forth does not refetch:

- a cached page up to 60 seconds old is shown with no request;
- one up to 5 minutes old is shown at once and refreshed in the background, and if that refresh fails the cached list stays;
- older entries are dropped, and at most 20 filter combinations are kept.

The cache never touches browser storage, so a page reload starts empty, and a different account signed in on the same tab never sees another user's entries. The **Refresh** button in the section header, and **Try again** after an error, always fetch.

**This wasn't me** appears on every row except the current session's. Until self-lock (#378) lands, it shows advice to change the password and remove unknown devices, then scrolls to the Password section and focuses its first field.

## Retention

Rows are kept for `authAudit.retentionDays` (`AUTH_AUDIT_RETENTION_DAYS`), 180 days by default, and then deleted. Every event type and outcome follows the same period. That includes rows that suspicious sign-in detection (#379) later flags, unless a later decision gives them their own.

Why: each row can carry an IP address and a user agent, which are personal data. They are kept only as long as investigating credential stuffing, account takeover and support questions about past sign-ins needs them. The identifier hash and user ID only matter alongside the rest of the row, so they go with it. Nothing is archived; a deleted row is gone.

The `auth-audit-prune-worker` deletes rows whose `created_at` is older than the retention period. It runs once at startup and then every `authAudit.pruneIntervalMinutes` (60 by default). Each run deletes the oldest expired rows in batches of `authAudit.pruneBatchSize` (1000 by default) until none are left, using the `(created_at)` index, and logs `Auth audit prune completed.` with the number deleted. Each batch is deleted by ID, so replicas pruning at the same time only race for the same rows and none is deleted twice. A database error ends that run. The rows already deleted stay deleted, and the next run continues. A retention of zero or less is a startup error. See [backend-configuration.md](./backend-configuration.md#auth-audit-retention) and the [auth workers guide](../backend/src/app/workers/auth/README.md#auth-audit-prune-worker).

## What Is Never Stored

The table and the log lines never contain a password, a one-time or authenticator code, an OAuth authorization or signup-continuation token, an access, refresh or personal access token, or a full email address. Email-change metadata uses `redactEmail` (for example, `o***@rentify.local`). PAT metadata stores only the token row ID. The structured log line carries only event type, outcome, reason, user ID, identifier hash, IP and request ID; it never logs metadata.

## Why Identifiers Are Hashed

Credential stuffing and password spraying target usernames that often do not exist, so those attempts have no `user_id`. To correlate them, the row keeps `identifier_hash`: an HMAC-SHA256 of the normalized identifier, keyed by `AUTH_AUDIT_IDENTIFIER_SECRET`. Normalizing means Unicode NFKC, trimmed and lowercased.

- Equal identifiers produce equal hashes. "Every attempt at this username" and "every username this IP tried" are both index lookups.
- The raw value is never stored. A mistyped password in the username field, or a real person's email typed by mistake, does not end up in the table.
- A keyed hash, unlike a plain SHA-256, cannot be reversed by hashing a list of likely usernames without the server secret.

Local sign-in and password-reset events hash the normalized username. Unlock routes and OAuth success/failure events with a verified provider context hash the normalized email. Invalid OAuth tokens and expired continuations whose cached provider context is gone carry no identifier hash. Usernames cannot contain `@`, so username and email inputs never collide.

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
