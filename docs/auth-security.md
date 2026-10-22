# Authentication Audit Log

The backend records authentication activity in the `auth_audit_events` table and writes one structured log line for each event. The record answers "who tried to sign in to which account, from where, and what happened". Users read their own history through `GET /auth/audit/me` (see [Reading Your Own Activity](#reading-your-own-activity)). Administrators search every account's events through `GET /admin/auth/audit` and `GET /admin/users/:id/security` (see [Investigating Sign-in Activity](#investigating-sign-in-activity)).

Code lives in [backend/src/app/features/auth/audit](../backend/src/app/features/auth/audit). Flows write through `AuthAuditService.recordSafely`, which never fails or retries. If the insert fails, the error is logged and the authentication operation goes ahead unchanged.

## What Is Recorded

| Event type                       | Outcome   | Reason                                | Written when                                                                                                                                                                                  |
| -------------------------------- | --------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login.succeeded`                | `success` |                                       | A local password sign-in issues a session. Carries `session_id`.                                                                                                                              |
| `login.failed`                   | `failure` | `bad_credentials`                     | The username is unknown or the password is wrong                                                                                                                                              |
| `login.failed`                   | `failure` | `email_unverified`                    | The password is right but the email address was never verified                                                                                                                                |
| `login.failed`                   | `failure` | `mfa_invalid`                         | The password is right but the authenticator code was rejected                                                                                                                                 |
| `login.failed`                   | `blocked` | `account_locked`, `account_suspended` | The password is right but the account is locked or suspended. Answered with `423` or `403`; see [Account Status](#account-status).                                                            |
| `login.mfa_challenged`           | `success` | `mfa_required`                        | The password is right, and the account needs an authenticator code that was not sent. The first factor passed.                                                                                |
| `login.locked`                   | `blocked` | `locked`                              | Each attempt answered with `423`. On the attempt that set the lock, `metadata` is `{ "triggered": true, "failureReason": ... }`.                                                              |
| `login.unlock_requested`         | `success` |                                       | `POST /auth/local/unlock/resend` emailed an unlock code                                                                                                                                       |
| `login.unlock_requested`         | `failure` | `not_locked`                          | The address is unknown or not locked, so nothing was sent                                                                                                                                     |
| `login.unlock_requested`         | `blocked` | `rate_limited`                        | The resend was rate-limited                                                                                                                                                                   |
| `login.unlocked`                 | `success` |                                       | `POST /auth/local/unlock` accepted the code                                                                                                                                                   |
| `login.unlocked`                 | `failure` | `otp_invalid`                         | The unlock code was rejected                                                                                                                                                                  |
| `logout`                         | `success` |                                       | `POST /auth/logout`. `method` is `pat` when a personal access token signed out.                                                                                                               |
| `oauth.login.succeeded`          | `success` |                                       | A linked provider signs in. Carries the provider method, verified-email HMAC, user and new session.                                                                                           |
| `oauth.login.failed`             | `failure` | `token_invalid`                       | Provider verification failed. The user and identifier hash are null/absent.                                                                                                                   |
| `oauth.login.failed`             | `failure` | `email_conflict`                      | A verified provider email already belongs to another sign-in method.                                                                                                                          |
| `oauth.login.failed`             | `failure` | `signup_expired`                      | A signup continuation is missing, expired, or already consumed. Provider context is included only when it is still available.                                                                 |
| `oauth.login.failed`             | `failure` | `mfa_required`, `mfa_invalid`         | A linked OAuth account needs MFA or rejected its MFA code.                                                                                                                                    |
| `oauth.login.failed`             | `blocked` | `account_locked`, `account_suspended` | The provider verified a linked account that is locked or suspended. Recorded before MFA.                                                                                                      |
| `oauth.signup.completed`         | `success` |                                       | Direct or continued OAuth signup creates the user and session. Issuing a continuation token alone writes no event.                                                                            |
| `oauth.linked`                   | `success` |                                       | A provider identity was newly linked. Carries the provider, user and acting session.                                                                                                          |
| `oauth.unlinked`                 | `success` |                                       | A provider identity was actually removed. Carries the provider, user and acting session.                                                                                                      |
| `session.refresh_reuse_detected` | `blocked` |                                       | A consumed refresh token was replayed outside its five-second grace period. Carries method `refresh` and the revoked session.                                                                 |
| `session.revoked`                | `success` |                                       | Device removal revoked an active session. One row is written per revoked session; metadata is `{ "source": "device" }`.                                                                       |
| `device.new_detected`            | `success` |                                       | An unknown device was detected. Metadata records `emailNotification` as `sent` or `suppressed`.                                                                                               |
| `password.changed`               | `success` |                                       | A local password was replaced using the current password. Carries method `password` and the replacement session.                                                                              |
| `password.reset`                 | `success` |                                       | Password recovery completed. Also carries the normalized username HMAC.                                                                                                                       |
| `password.set`                   | `success` |                                       | A social-only account added its first local password.                                                                                                                                         |
| `email.changed`                  | `success` |                                       | Email change completed. Metadata contains only `oldEmailMasked` and `newEmailMasked`.                                                                                                         |
| `mfa.totp_enabled`               | `success` |                                       | A pending TOTP factor was activated.                                                                                                                                                          |
| `mfa.totp_disabled`              | `success` |                                       | An active TOTP factor was removed; pending/missing factors do not emit it.                                                                                                                    |
| `mfa.step_up_failed`             | `failure` | `mfa_invalid` or blank                | A confirm code was invalid, or challenge delivery failed. Metadata contains only stage, scope, factor and result.                                                                             |
| `mfa.step_up_locked`             | `blocked` | `rate_limited`                        | Challenge/confirm windows, OTP cooldown, repeated-code lock, and attempts during that lock.                                                                                                   |
| `pat.created`                    | `success` |                                       | A personal access token was created. Carries method `pat` and metadata `{ "tokenId": ... }`, never the token.                                                                                 |
| `pat.revoked`                    | `success` |                                       | A personal access token changed from active to revoked. Repeated revoke calls write no event.                                                                                                 |
| `rate_limit.exceeded`            | `blocked` | `rate_limited`                        | A Redis-backed `auth-sensitive` or `auth-refresh` policy returned 429. See dedupe rules below.                                                                                                |
| `admin.audit_viewed`             | `success` |                                       | An administrator read the audit log. `user_id` is null, `actor_user_id` is the reader and `metadata` holds the filters used.                                                                  |
| `account.locked`                 | `success` |                                       | An account was put on a security hold. `actor_user_id` is the admin, or null for the system. `metadata` is `{ "source", "previousStatus", "reason" }`; see [Account Status](#account-status). |
| `account.suspended`              | `success` |                                       | An account was suspended. Same `actor_user_id` and `metadata` as `account.locked`.                                                                                                            |
| `account.reinstated`             | `success` |                                       | A locked or suspended account was set back to active, by an admin or by the user's own password reset (`metadata.source` `user`, no actor). Reinstating an active account writes nothing.     |

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
- **Query.** `limit` is 1 to 50 and defaults to 20. `category` is one of the values below. `outcome` is `success`, `failure` or `blocked`. `from` (inclusive) and `to` (exclusive) are ISO 8601 date-times with `Z` or an offset, and every filter combines with the others. A `to` that is not later than `from` is a `400`. `cursor` is the previous page's `nextCursor`, which is null on the last page. A malformed cursor, or one that does not name one of the caller's events under the same filters, is a `400`.
- **What each item contains.** `id`, `type`, `outcome`, `label`, `occurredAt`, `method`, `ipAddress`, `browser`, `os`, `deviceKnown` and `current`. `toSecurityActivityItem` builds the item field by field. `identifier_hash`, `actor_user_id`, `reason_code`, `request_id`, `session_id`, `device_id`, the raw user agent and `metadata` never leave the server.

Field details:

- `label` is server-side wording keyed by event type and refined by reason and method, for example "Signed in with password", "Failed sign-in: wrong password" or "Signed in with Google". An event type with no wording yet reads "Account activity".
- When `actor_user_id` is set and is not the user, the label reads as an administrator action, for example "An administrator locked your account". The administrator is never identified. That row's IP address, user agent, method and device belong to the administrator's request, so the item returns them as null and `current` as false.
- `browser` and `os` come from a small in-house user-agent parser (`parseUserAgent`). Unrecognised agents are null, and the account page shows them as "Unknown device".
- `current` is true when the event's session is the caller's current session.
- `deviceKnown` is true when the event's device ID matches one of the user's currently registered devices, false when it does not, and null when the event recorded no device or an administrator acted. It reflects today's device list, so removing a device turns its past events false. Whether a device was new when an event happened is recorded separately as `device.new_detected`, which appears in the list as "New device detected".

| Category           | Event types                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sign_in`          | `login.*`, `oauth.login.succeeded`, `oauth.login.failed`, `oauth.signup.completed`, `mfa.step_up_failed`, `mfa.step_up_locked`, `rate_limit.exceeded`                          |
| `security_changes` | `password.changed`, `password.reset`, `password.set`, `email.changed`, `mfa.totp_enabled`, `mfa.totp_disabled`, `oauth.linked`, `oauth.unlinked`, `pat.created`, `pat.revoked` |
| `sessions`         | `logout`, `session.revoked`, `session.refresh_reuse_detected`, `device.new_detected`                                                                                           |

The cursor is an opaque wrapper around the last event's ID, and paging uses Prisma's cursor. Prisma compares against that row's stored `created_at` in SQL, so the microsecond precision survives and events written in the same millisecond, such as several sessions revoked at once, are neither skipped nor repeated. A JavaScript `Date` would keep only milliseconds. Prisma locates the cursor row by ID alone, and `skip: 1` then drops whichever row comes first. So the cursor row is first checked against the caller's user ID and the request's filters. A cursor naming another user's event, one of the caller's events the current filters exclude, or one since pruned is a `400 VALIDATION_ERROR` instead of silently dropping a row. Keep the same filters while following `nextCursor`.

### On the Account Page

Account → Security shows the list as **Security activity**, below **Registered devices**. The Security tab already asks for the `mfa-management` step-up, so opening the list needs no further prompt. If that step-up expires while the tab is open, the next load, refresh or Load more gets `401 MFA_VERIFICATION_REQUIRED`, and the page locks the tab again with "Your identity check has expired" and the usual Verify button, rather than leaving an error that retrying cannot fix. The component is [security-activity-panel.tsx](../frontend/src/components/account/security-activity-panel.tsx), and its API client is in [frontend/src/lib/security-activity](../frontend/src/lib/security-activity).

Each row shows:

- the server label;
- a relative time, with the full date and time on hover;
- an icon for the sign-in method;
- the browser and OS, or "Unknown device" when neither is recognised;
- the IP address.

A badge marks the current session ("This session"). There is no per-row "New device" badge, because `deviceKnown` reflects today's registered devices: removing a device would brand its own past sign-ins as new. The "New device detected" event carries that signal instead. Failed rows are rose with a "Failed" badge and blocked rows are amber with a "Blocked" badge, so the outcome does not rely on colour alone.

The filter buttons (All, Sign-ins, Security changes, Sessions), the **Status** select (Any status, Succeeded, Failed, Blocked) and the **From** and **To** dates all combine, and changing any of them restarts the list from the newest event. Both dates are local days and both are included: the page sends the start of From and the start of the day after To. A To date before From shows an inline error and loads nothing until it is fixed. **Clear dates** removes the range. When a status or date narrows the list to nothing, it reads "No activity matches these filters". **Load more** follows `nextCursor`, 20 events at a time. Loading, empty ("No recent activity") and error-with-retry states are handled. First pages are cached in memory (`frontend/src/lib/security-activity/cache.ts`), keyed by the user ID and every filter, so returning to the tab or to a filter shows the list at once instead of a skeleton:

- each time the section mounts, the cached page is shown and refreshed in the background, so anything the user did elsewhere on the page shows up;
- within that visit, switching back to a filter whose page is under 60 seconds old makes no request;
- a page up to 5 minutes old is shown at once and refreshed in the background, and if that refresh fails the cached list stays;
- older entries are dropped, and at most 20 filter combinations are kept.

While a cached page is being refreshed, **Load more** reads "Updating..." and waits, so it never pages from a stale cursor. The cache never touches browser storage, so a page reload starts empty. It empties whenever the signed-in user changes, sign-out included, so a new session never sees the previous one's "This session" flags and a different account never sees another user's entries. The **Refresh** button in the section header, and **Try again** after an error, always fetch.

**This wasn't me** appears on every row except the current session's. Until self-lock (#378) lands, it shows advice to change the password and remove unknown devices, then scrolls to the Password section and focuses its first field.

## Investigating Sign-in Activity

Administrators read every account's events through two endpoints, served by `AuthAuditAdminController` and `AuthAuditAdminService` and documented in the OpenAPI spec as `listAdminAuthAuditEvents` and `getAdminUserSecuritySummary`.

- **Who can call them.** Only the `admin` role, from a signed-in session. Users, owners and moderators get `403`, because the view exposes other people's IP addresses, user agents and devices. Personal access tokens are rejected. The role is checked before the query is validated, so a non-admin learns nothing from a validation error. There is no MFA step-up, matching `/admin/feature-flags`.
- **Every read is itself audited.** Before returning anything, each call, including every further page, writes an `admin.audit_viewed` event with the reader as `actor_user_id`, the reader's IP, user agent and request ID, and the filters in `metadata`: `view`, the `filter_*` keys, `limit`, and, for a summary, `target_user_id`. The cursor is not recorded. `user_id` stays null, so these rows never appear in the subject's own security activity. The write uses `record`, not `recordSafely`: if it fails, the read fails, so nobody can look without leaving a trace.

### Searching Events

`GET /admin/auth/audit` returns events newest first.

| Parameter   | Meaning                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `userId`    | Events about this account.                                                                                                                                |
| `user`      | An email or username, resolved server side. One that matches no account is hashed and matched against `identifier_hash` instead. Exclusive with `userId`. |
| `ip`        | Events from this IPv4 or IPv6 address.                                                                                                                    |
| `eventType` | One or more event types; repeat the parameter (`?eventType=login.failed&eventType=login.locked`). At most 10.                                             |
| `outcome`   | `success`, `failure` or `blocked`.                                                                                                                        |
| `from`/`to` | Inclusive and exclusive bounds. `to` defaults to now and `from` to seven days before `to`. The window is at most 90 days; a wider one is a `400`.         |
| `cursor`    | The previous page's `nextCursor`. Send it with the same filters; one that names no event under them is a `400`.                                           |
| `limit`     | 1 to 100, default 25.                                                                                                                                     |

The response carries `items`, `nextCursor` and `range`, the window actually searched. Each item has every column except `identifier_hash`, plus `browser` and `os` parsed from the user agent, `subject` (`{ id, email, username }` of the account the event is about) and `actor` (set only when someone other than the subject acted). `subject` is null for an attempt against an unknown username and for an account deleted since.

Each filter is the leading column of one of the table's indexes, and the window bounds `created_at` on both sides, so MySQL serves a search from `(user_id, created_at)`, `(ip_address, created_at)`, `(event_type, created_at)` or `(identifier_hash, created_at)` as a short range scan. That is why the window is capped rather than open-ended.

A search's window ends when the request starts, so its own `admin.audit_viewed` row is never part of its result; the next search sees it.

### A User's Security Summary

`GET /admin/users/:id/security` returns, for one account:

- `user` (`id`, `email`, `username`, `role`), `accountStatus` (`active`, `locked` or `suspended`) and `accountStatusChange`, the latest change's `reason`, `changedAt` and `changedBy` (`{ id, email, username }` of the admin, or null), or null when the status was never changed;
- `lastLoginAt`, from `users.last_login_at`;
- `failedSignIns.last24Hours` and `last7Days`, counting `login.failed` and `oauth.login.failed` events. The attempt that sets a lock is recorded as `login.locked`, so it is not counted;
- `lockout`, read live from the same Redis record sign-in uses: `locked`, `failedAttempts`, `lockedAt`, and `lockedUntil`, which is 30 minutes after `lockedAt`. Failed attempts that have not locked the account expire 15 minutes after the last one, so `failedAttempts` can be lower than the 24-hour count;
- `devices`, the account's registered devices with their last IP address;
- `recentEvents`, the 20 newest events from the last 90 days, in the same shape as the search.

An unknown ID is a `404` and a malformed one a `400`; neither writes an `admin.audit_viewed` row.

### On the Admin Page

Admins open **Admin** in the app sidebar, which goes to `/admin/security`. The entry is shown only to the `admin` role. Everything under `/admin` sits behind a role-guarded layout ([admin-guard.tsx](../frontend/src/components/admin/admin-guard.tsx)): a signed-out visitor is sent to sign in and brought back, and any other role is sent home. That guard only saves non-admins a page they cannot use. The page treats the API's `403` as the source of truth and shows "You don't have access to this page" if it gets one. The components are in [frontend/src/components/admin/security](../frontend/src/components/admin/security), and the API client is in [frontend/src/lib/admin-security](../frontend/src/lib/admin-security).

- **Filters.** User (email or username), IP address, Outcome, a multi-select of event types grouped as in the catalogue, and From and To dates. The dates are local days and both are included. Filters apply on **Apply filters**, not on every keystroke, so typing an email does not write one `admin.audit_viewed` row per character. **Clear** resets them at once. A To date before From shows an inline error and disables Apply. A filter the API rejects, such as a malformed IP, shows its reason ("Check the filters: ..."). The applied filters live in the URL, so a search survives a refresh, works with the back button and can be shared with another admin.
- **Table.** Each row shows the time (relative, with the full date on hover), the event name with its raw type and reason, an outcome badge (Succeeded, Failed or Blocked), the account, the IP address, the device and who acted. An attempt that matched no account reads "unknown"; an administrator action that concerns no account, such as an `admin.audit_viewed` read, shows a dash. The IP address is a button that searches that address across every account, keeping the other filters but dropping the account filter; this is the credential-stuffing pivot from the runbook. The account is a button that opens the drawer.
- **Pages.** **Older** and **Newer** step through 25 events at a time using `nextCursor`. The cursor is not kept in the URL, so a refresh returns to the newest events. The line above the table states the window searched, adding "(last 7 days)" when no dates were given. **Refresh** searches again.
- **Drawer.** A side panel with the account's security summary: status (Active, Security hold or Suspended) and role, last sign-in, the 24-hour and 7-day failed sign-in counts, a password-lockout card ("Password sign-in is locked" with the time it lifts, or "Password sign-in is not locked" with the number of recent failed attempts), the registered devices and the 20 recent events. **Show all events** closes it and filters the table by that account's email. It traps focus, closes on Escape, the close button or the backdrop, and returns focus to the row. Every open is a fresh read, so the lockout state is live, and each open is audited. A deleted account reads "This account no longer exists."
- **Account status.** The drawer's **Account status** card shows the latest change's reason, time and admin. Its buttons depend on the status: an active account offers **Place security hold** and **Suspend**, a held one **Suspend** and **Reinstate**, and a suspended one only **Reinstate**. Each opens a dialog asking for the reason (5 to 255 characters, with a counter). The confirm button is disabled and relabelled while the request runs, a refusal such as a `409` keeps the dialog open with the API's message, and Escape closes only the dialog. On success the dialog closes, a confirmation appears, the status buttons stay disabled until the summary reloads, and the events table refreshes so the new `account.*` event shows. On your own account the buttons are replaced by "You can't change the status of your own account."
- Loading skeletons, empty states ("No events match these filters", "No more events"), and errors with **Try again** are handled for both the table and the drawer.

### Runbook

1. **Start from the account.** Search with `user` set to the email or username the report names. Look for `login.failed` rows with `bad_credentials`, then `login.locked` and `login.unlock_requested`.
2. **Check the current state.** Open the account's security summary. `lockout.locked` says whether sign-in is refusing the account right now and until when; `devices` and their last IPs show where it is normally used.
3. **Pivot to the IP.** Search with `ip` set to an address from those failures. Several accounts, or many `subject: null` rows, from one address in a short window is the signature of credential stuffing.
4. **Find attempts on names that do not exist.** Search with `user` set to the username that was typed. It matches no account, so the search falls back to the keyed hash and returns those attempts with `subject: null`.
5. **Narrow the window.** Add `from`/`to` around the burst and `eventType` or `outcome` to cut noise. A wider look-back than seven days needs explicit dates, up to 90 days at a time.
6. **Review who has been looking.** Search with `eventType=admin.audit_viewed`. Each row's `actor` is the administrator and `metadata` holds what they searched for.

To act on what you find, see [Changing an Account's Status](#changing-an-accounts-status). Automatic flagging, and a `flagged` filter, is #379.

## Account Status

`users.status` is the durable state of an account, separate from the 30-minute password lockout above. Every account starts `active`.

| Status      | Meaning                                          | Who clears it                                       |
| ----------- | ------------------------------------------------ | --------------------------------------------------- |
| `active`    | Normal.                                          |                                                     |
| `locked`    | A security hold: the account may be compromised. | The user, by resetting their password, or an admin. |
| `suspended` | A policy action.                                 | Only an admin.                                      |

`status_reason`, `status_changed_at` and `status_changed_by` record the latest change. `status_changed_by` is the admin's ID, or null when the system or the user made it. It has no foreign key, so it survives the admin's account being deleted. An unrecognised stored value is read as `suspended`, so a bad write fails closed.

### Where It Is Enforced

| Entry point                                               | A `locked` account gets  | A `suspended` account gets               |
| --------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| Local password sign-in, once the password is proven       | `423 ACCOUNT_LOCKED`     | `403 ACCOUNT_SUSPENDED`                  |
| OAuth sign-in to a linked account, before MFA             | `423 ACCOUNT_LOCKED`     | `403 ACCOUNT_SUSPENDED`                  |
| Password reset, once the emailed code is proven           | Allowed: clears the hold | `403 ACCOUNT_SUSPENDED`, nothing written |
| Every access-token request and WebSocket session re-check | `401 UNAUTHORIZED`       | `401 UNAUTHORIZED`                       |
| `POST /auth/refresh`                                      | `401 UNAUTHORIZED`       | `401 UNAUTHORIZED`                       |
| Every personal-access-token request                       | `401 UNAUTHORIZED`       | `401 UNAUTHORIZED`                       |

The security-hold `423` carries `details: { "reason": "security_hold", "recovery": "password_reset" }`. The temporary lockout's `423` carries `details.unlockRequired` instead, which is how a client tells them apart.

- **The status is revealed only to someone who proved the credentials.** A wrong password on a suspended account still reads `Invalid username or password.`.
- **No extra query.** The access-token check already reads `token_version` and `role` from `users` on every request (`TokenRepository.findSessionValidationByUserId`); it now reads `status` in the same query. Refresh and WebSocket re-checks share it.
- **Personal access tokens are checked on their own.** They carry no token version, so rotating `token_version` does not reach them; `PersonalAccessTokenService.authenticateToken` reads the owner's status with the token.
- **A backstop.** `AuthSessionService` refuses to issue a session to a non-active account, so a flow that skipped its own check, such as email-verification sign-in, still cannot hand one out.

### Recovering From a Security Hold

The security-hold `423` sends the user to password reset. Once the emailed code is proven and the new password is written, `PasswordService.resetPassword` calls `AccountStatusService.liftSecurityHold`, which changes `locked` to `active` (with `source: "user"` and no actor) and nothing else, then issues the session only if the account is now active. The password is written first, so a failed write cannot reinstate a compromised account on its old password. The status is read again at that point rather than trusted from the start of the request, so an admin's suspension that lands mid-reset stands and the reset ends in `403 ACCOUNT_SUSPENDED`. The user's own suspicious-activity lock is #378.

An account with no local password (social sign-in only) cannot reset one, so only an admin can lift its hold.

On the sign-in page, a security hold reads "This account is on a security hold to protect it. Reset your password to get back in." with a **Reset your password** button that opens the reset form, instead of the unlock-code panel the temporary lockout shows. A suspension reads "This account has been suspended. Contact support if you believe this is a mistake." Provider sign-in shows the same messages. A signed-in user whose account is locked or suspended has their next refresh rejected and is signed out; the reason appears when they next try to sign in.

### Changing an Account's Status

`AccountStatusService` (`lock`, `suspend`, `reinstate`) is the only place the status changes. Each change:

1. Writes the status, reason, time and actor, but only while the account is still in the status that was read. If another change got there first, nothing is written, recorded or sent, and an admin gets `409`. A lock or suspension bumps `token_version` in the same write, which ends every access and refresh token at once; their 900-second lifetime does not matter.
2. Revokes every Redis session record for the user (best effort; the token version already ended them).
3. Records `account.locked`, `account.suspended` or `account.reinstated` with `metadata.source` `admin`, `system` or `user`.
4. Queues an `account_locked`, `account_suspended` or `account_reinstated` email when the status actually moved. The email explains what the status means and what to do; it never includes the reason, which may be an internal note.

The audit write and email are best effort, like the rest of the auth audit log, so a failure is logged and never undoes a committed change.

| Change                   | Result                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Lock a locked account    | Records the new reason and ends sessions again; no second email.                       |
| Lock a suspended account | `409`. Reinstate it first, so a policy action cannot become a hold the user can clear. |
| Suspend a locked account | Allowed.                                                                               |
| Reinstate an active one  | `200` with `changed: false`; nothing is written, recorded or sent.                     |

Admins call `POST /admin/users/:id/lock`, `/suspend` and `/reinstate` with `{ "reason": "..." }`, 5 to 255 characters after trimming. They need an admin signed-in session; every other role gets `403` and personal access tokens are rejected. An admin cannot change their own status (`403`), whatever the casing of the ID, but can change another admin's. An unknown ID is a `404`.

#### Admin Runbook

1. **Investigate first.** Open the account from **Sign-in activity** (`/admin/security`) and read its recent events, devices and failed sign-ins (see the [runbook](#runbook) above).
2. **Choose the status.** Lock when the account may be compromised and the owner should recover it themself. Suspend for a policy action only an admin should reverse.
3. **Write a reason another admin can act on.** It is shown in the drawer and the audit log, never to the user.
4. **Confirm.** The drawer refreshes with the new status, and the change appears in the events table. The user's open sessions fail on their next request.
5. **Reinstate** once the investigation or appeal is done. The user signs in again; their old sessions do not come back.

Locally, `locked-one` (`locked1@rentify.local`, `Rentify123!`) is seeded on a security hold, for trying the locked sign-in message and the password-reset recovery. Re-seeding resets it, and leaves any status an admin set on another account alone.

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
