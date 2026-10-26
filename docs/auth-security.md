# Authentication Audit Log

The backend records authentication activity in the `auth_audit_events` table and writes one structured log line for each event. The record answers "who tried to sign in to which account, from where, and what happened". Users read their own history through `GET /auth/audit/me` (see [Reading Your Own Activity](#reading-your-own-activity)). Administrators search every account's events through `GET /admin/auth/audit` and `GET /admin/users/:id/security` (see [Investigating Sign-in Activity](#investigating-sign-in-activity)).

Code lives in [backend/src/app/features/auth/audit](../backend/src/app/features/auth/audit). Flows write through `AuthAuditService.recordSafely`, which never fails or retries. If the insert fails, the error is logged and the authentication operation goes ahead unchanged.

## What Is Recorded

| Event type                       | Outcome              | Reason                                | Written when                                                                                                                                                                                  |
| -------------------------------- | -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login.succeeded`                | `success`            |                                       | A local password sign-in issues a session. Carries `session_id`.                                                                                                                              |
| `login.failed`                   | `failure`            | `bad_credentials`                     | The username is unknown or the password is wrong                                                                                                                                              |
| `login.failed`                   | `failure`            | `email_unverified`                    | The password is right but the email address was never verified                                                                                                                                |
| `login.failed`                   | `failure`            | `mfa_invalid`                         | The password is right but the authenticator code was rejected                                                                                                                                 |
| `login.failed`                   | `blocked`            | `account_locked`, `account_suspended` | The password is right but the account is locked or suspended. Answered with `423` or `403`; see [Account Status](#account-status).                                                            |
| `login.mfa_challenged`           | `success`            | `mfa_required`                        | The password is right, and the account needs an authenticator code that was not sent. The first factor passed.                                                                                |
| `login.locked`                   | `blocked`            | `locked`                              | Each attempt answered with `423`. On the attempt that set the lock, `metadata` is `{ "triggered": true, "failureReason": ... }`.                                                              |
| `login.unlock_requested`         | `success`            |                                       | `POST /auth/local/unlock/resend` emailed an unlock code                                                                                                                                       |
| `login.unlock_requested`         | `failure`            | `not_locked`                          | The address is unknown or not locked, so nothing was sent                                                                                                                                     |
| `login.unlock_requested`         | `blocked`            | `rate_limited`                        | The resend was rate-limited                                                                                                                                                                   |
| `login.unlocked`                 | `success`            |                                       | `POST /auth/local/unlock` accepted the code                                                                                                                                                   |
| `login.unlocked`                 | `failure`            | `otp_invalid`                         | The unlock code was rejected                                                                                                                                                                  |
| `logout`                         | `success`            |                                       | `POST /auth/logout`. `method` is `pat` when a personal access token signed out.                                                                                                               |
| `oauth.login.succeeded`          | `success`            |                                       | A linked provider signs in. Carries the provider method, verified-email HMAC, user and new session.                                                                                           |
| `oauth.login.failed`             | `failure`            | `token_invalid`                       | Provider verification failed. The user and identifier hash are null/absent.                                                                                                                   |
| `oauth.login.failed`             | `failure`            | `email_conflict`                      | A verified provider email already belongs to another sign-in method.                                                                                                                          |
| `oauth.login.failed`             | `failure`            | `signup_expired`                      | A signup continuation is missing, expired, or already consumed. Provider context is included only when it is still available.                                                                 |
| `oauth.login.failed`             | `failure`            | `mfa_required`, `mfa_invalid`         | A linked OAuth account needs MFA or rejected its MFA code.                                                                                                                                    |
| `oauth.login.failed`             | `blocked`            | `account_locked`, `account_suspended` | The provider verified a linked account that is locked or suspended. Recorded before MFA.                                                                                                      |
| `oauth.signup.completed`         | `success`            |                                       | Direct or continued OAuth signup creates the user and session. Issuing a continuation token alone writes no event.                                                                            |
| `oauth.linked`                   | `success`            |                                       | A provider identity was newly linked. Carries the provider, user and acting session.                                                                                                          |
| `oauth.unlinked`                 | `success`            |                                       | A provider identity was actually removed. Carries the provider, user and acting session.                                                                                                      |
| `session.refresh_reuse_detected` | `blocked`            |                                       | A consumed refresh token was replayed outside its five-second grace period. Carries method `refresh` and the revoked session.                                                                 |
| `session.revoked`                | `success`            |                                       | Device removal revoked an active session. One row is written per revoked session; metadata is `{ "source": "device" }`.                                                                       |
| `device.new_detected`            | `success`            |                                       | An unknown device was detected. Metadata records `emailNotification` as `sent` or `suppressed`. A sent alert's id is its lock link's `sourceEventId`.                                         |
| `password.changed`               | `success`            |                                       | A local password was replaced using the current password. Carries method `password` and the replacement session.                                                                              |
| `password.reset`                 | `success`            |                                       | Password recovery completed. Also carries the normalized username HMAC.                                                                                                                       |
| `password.set`                   | `success`            |                                       | A social-only account added its first local password.                                                                                                                                         |
| `email.changed`                  | `success`            |                                       | Email change completed. Metadata contains only `oldEmailMasked` and `newEmailMasked`.                                                                                                         |
| `mfa.totp_enabled`               | `success`            |                                       | A pending TOTP factor was activated.                                                                                                                                                          |
| `mfa.totp_disabled`              | `success`            |                                       | An active TOTP factor was removed; pending/missing factors do not emit it.                                                                                                                    |
| `mfa.step_up_failed`             | `failure`            | `mfa_invalid` or blank                | A confirm code was invalid, or challenge delivery failed. Metadata contains only stage, scope, factor and result.                                                                             |
| `mfa.step_up_locked`             | `blocked`            | `rate_limited`                        | Challenge/confirm windows, OTP cooldown, repeated-code lock, and attempts during that lock.                                                                                                   |
| `pat.created`                    | `success`            |                                       | A personal access token was created. Carries method `pat` and metadata `{ "tokenId": ... }`, never the token.                                                                                 |
| `pat.revoked`                    | `success`            |                                       | A personal access token changed from active to revoked. Repeated revoke calls write no event.                                                                                                 |
| `rate_limit.exceeded`            | `blocked`            | `rate_limited`                        | A Redis-backed `auth-sensitive` or `auth-refresh` policy returned 429. See dedupe rules below.                                                                                                |
| `admin.audit_viewed`             | `success`            |                                       | An administrator read the audit log. `user_id` is null, `actor_user_id` is the reader and `metadata` holds the filters used.                                                                  |
| `account.locked`                 | `success`            |                                       | An account was put on a security hold. `actor_user_id` is the admin, or else null. `metadata` is `{ "source", "previousStatus", "reason" }`, and more; see [Account Status](#account-status). |
| `account.suspended`              | `success`            |                                       | An account was suspended. Same `actor_user_id` and `metadata` as `account.locked`.                                                                                                            |
| `account.reinstated`             | `success`            |                                       | A locked or suspended account was set back to active, by an admin or by the user's own password reset (`metadata.source` `user`, no actor). Reinstating an active account writes nothing.     |
| `security.suspicious_activity`   | `blocked`, `failure` |                                       | A detection rule fired. `blocked` when enforce mode locked the account or blocked the IP. Always `flagged`. See [Suspicious Activity Detection](#suspicious-activity-detection).              |

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
| `flagged`         | `BOOLEAN`       | Set by suspicious-activity detection on the events it acted on. Defaults to false.                                          |
| `created_at`      | `DATETIME(6)`   | Set by the database                                                                                                         |

Indexes: `(user_id, created_at)`, `(actor_user_id, created_at)`, `(ip_address, created_at)`, `(event_type, created_at)`, `(identifier_hash, created_at)`, `(flagged, created_at)` and `(created_at)`. The last serves the retention prune.

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

**This wasn't me** appears on every row except the current session's. It opens a confirmation in the row ("Lock your account?") with **Lock my account** and **Cancel**; nothing is sent until the user confirms. Confirming calls `POST /auth/account/self-lock/session` (see [Locking Your Own Account](#locking-your-own-account)); both buttons are disabled while it runs. On success the page goes to `/auth/self-lock?status=locked`, which clears the browser's session and shows the recovery steps. An expired step-up locks the Security tab again for re-verification, exactly like a failed load. An account with no password to reset (`409`) gets advice to set a password and remove unknown devices instead, and the page scrolls to the Password section and focuses its first field. Any other failure keeps the confirmation open with the error.

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
| `flagged`   | `true` for only the events suspicious-activity detection flagged, `false` for only the rest. Anything else is a `400`.                                    |
| `from`/`to` | Inclusive and exclusive bounds. `to` defaults to now and `from` to seven days before `to`. The window is at most 90 days; a wider one is a `400`.         |
| `cursor`    | The previous page's `nextCursor`. Send it with the same filters; one that names no event under them is a `400`.                                           |
| `limit`     | 1 to 100, default 25.                                                                                                                                     |

The response carries `items`, `nextCursor` and `range`, the window actually searched. Each item has every column except `identifier_hash` (so it includes `flagged`), plus `browser` and `os` parsed from the user agent, `subject` (`{ id, email, username }` of the account the event is about) and `actor` (set only when someone other than the subject acted). `subject` is null for an attempt against an unknown username and for an account deleted since.

Each filter is the leading column of one of the table's indexes, and the window bounds `created_at` on both sides, so MySQL serves a search from `(user_id, created_at)`, `(ip_address, created_at)`, `(event_type, created_at)`, `(identifier_hash, created_at)` or `(flagged, created_at)` as a short range scan. That is why the window is capped rather than open-ended.

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

- **Filters.** User (email or username), IP address, Outcome, **Flagged only**, a multi-select of event types grouped as in the catalogue, and From and To dates. The dates are local days and both are included. Filters apply on **Apply filters**, not on every keystroke, so typing an email does not write one `admin.audit_viewed` row per character. **Clear** resets them at once. A To date before From shows an inline error and disables Apply. A filter the API rejects, such as a malformed IP, shows its reason ("Check the filters: ..."). The applied filters live in the URL, so a search survives a refresh, works with the back button and can be shared with another admin.
- **Table.** Each row shows the time (relative, with the full date on hover), the event name with its raw type and reason, an outcome badge (Succeeded, Failed or Blocked) with a **Flagged** badge beside it when detection flagged the event, the account, the IP address, the device and who acted. An attempt that matched no account reads "unknown"; an administrator action that concerns no account, such as an `admin.audit_viewed` read, shows a dash. The IP address is a button that searches that address across every account, keeping the other filters but dropping the account filter; this is the credential-stuffing pivot from the runbook. The account is a button that opens the drawer.
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

To act on what you find, see [Changing an Account's Status](#changing-an-accounts-status). To start from what detection already caught, search with `flagged=true`; see [Suspicious Activity Detection](#suspicious-activity-detection).

## Suspicious Activity Detection

`SuspiciousActivityDetector` ([backend/src/app/features/auth/detection](../backend/src/app/features/auth/detection)) watches the events above for patterns no single event shows. `AuthAuditService.recordSafely` hands it each event it wrote, without waiting, so detection never slows or changes an auth response. Only the API process subscribes it; workers record no auth events.

### Modes

`authSecurity.detection.mode` (`AUTH_SECURITY_DETECTION_MODE`) is `alert` by default. See [backend-configuration.md](./backend-configuration.md#auth-security-detection) for every key.

| Mode      | Counts and records | Flags | Emails the user (c, d) | Locks the account (a) | Blocks the IP (b) |
| --------- | ------------------ | ----- | ---------------------- | --------------------- | ----------------- |
| `off`     | No                 | No    | No                     | No                    | No                |
| `alert`   | Yes                | Yes   | Yes                    | No                    | No                |
| `enforce` | Yes                | Yes   | Yes                    | Yes                   | Yes               |

An email only tells the account owner what happened, so alert mode sends it too. Only the lock and the IP block wait for enforce.

### Rules

Each rule counts in a Redis sliding window (a sorted set scored by time, under `auth:detection:<rule>:<user or IP>`) and fires when the count reaches its threshold, not before.

| Rule                         | Counts                                                                                                                   | Default threshold                | Enforce action                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------- |
| (a) `repeated_lockouts`      | `login.locked` with `metadata.triggered`, per account                                                                    | 3 in 24 hours                    | `AccountStatusService.lock` with `source: "system"`, then email |
| (b) `credential_stuffing`    | `login.failed` with outcome `failure`, as distinct `identifier_hash` values per IP                                       | 20 in 10 minutes                 | Block the IP on the `auth-sensitive` policy for 60 minutes      |
| (c) `success_after_failures` | Failed sign-ins per account (`login.failed` failures and the `login.locked` that set a lock), then `device.new_detected` | 5 in the hour before the success | None beyond the email, which alert mode also sends              |
| (d) `refresh_reuse`          | `session.refresh_reuse_detected`                                                                                         | Any                              | None beyond the email, which alert mode also sends              |

- **(a)** counts only the attempt that set the lock, not later refusals of the locked account. Only an `active` account is locked: a held account is left alone and a suspension is never downgraded. The hold sends the usual `account_locked` email, and the user recovers by [resetting their password](#recovering-from-a-security-hold). The hold's reason is `Repeated sign-in lockouts`, and its `account.locked` event carries `metadata.rule` and the `sourceEventId` of the detection event.
- **(b)** counts distinct names, so one person retrying their own password never fires it. It never locks an account. Attempts the rate limiter already refused never reach sign-in, so they are not counted: with the default 10 a minute, an address needs at least two minutes to reach 20.
- **(c)** fires on `device.new_detected`, which is written only for a successful sign-in from a device the account has not used, on an IP address it has not used either. That is the "new device and new IP" success.
- **(d)** fires on the first reuse. `refreshReuse.windowMinutes` only stops a second email for the same account within the window.

### What a Firing Does

1. **Dedupes.** It claims `auth:detection:fired:<rule>:<user or IP>` with `SET NX` for the rule's window. If the key exists, the rule already fired in this window, and nothing else happens: no second event, lock, block or email.
2. **Finds the events behind it.** The triggering event, plus the newest of what the rule counted in the window (by user for a, c and d; by IP for b), up to 50.
3. **Acts**, as in the tables above. An action that throws is logged and recorded as `failed`; the firing is still recorded.
4. **Records `security.suspicious_activity`.** It is `flagged`, has the user (null for b) and the triggering request's IP and user agent, and `metadata` is `{ rule, mode, action, windowSeconds, count, threshold, relatedEventCount, relatedEventIds }`. `action` is `none` (alert mode, for a or b), `account_locked`, `ip_blocked`, `email_sent`, `skipped` (the account was already held or suspended, or no longer exists) or `failed`. `relatedEventIds` lists up to 20 ids, comma-joined, because metadata values are scalars.
5. **Flags** each related event, so the admin view finds them with `flagged=true`.
6. **Logs** `Suspicious activity detected.` at warn level, with the rule, mode, action, counts, user, IP and event ids.

The user sees the event on their [account page](#on-the-account-page) as "Suspicious sign-in activity detected", without its metadata.

### The `suspicious_login` Email

Rules (c) and (d) queue one `suspicious_login` email. It says what was seen, lists the time, IP address and user agent, and advises changing the password and reviewing devices and personal access tokens:

- (c): "Someone signed in to your account from a new device and a new location, right after several failed attempts to sign in."
- (d): "A sign-in session on your account was used from two places, which can mean someone copied it. We signed that session out."

For an account that can reset a password, it carries the same "This wasn't you? Lock your account" link as the new-device alert, and the link's `sourceEventId` is the `security.suspicious_activity` event. See [Locking Your Own Account](#locking-your-own-account).

### IP Blocks

A block is the Redis key `auth:ip-block:<ip>`. It holds the time the block lifts and expires then. While it exists, every request on the `auth-sensitive` policy from that address gets `429 TOO_MANY_REQUESTS` with `Retry-After` and `details: { "policy": "auth-sensitive", "reason": "ip_blocked", "retryAfterSeconds": ... }`, before the sliding window is consulted.

- **It is by address**, whoever is signed in. Other policies, such as browsing or `/auth/refresh`, are unaffected, so a signed-in user behind the address stays signed in.
- **The rate limiter enforces it**, so `rateLimiter.enabled: false` turns blocks off too.
- **It fails open.** If the block list cannot be read, the request is allowed and the failure is logged at most once a minute.

### When Redis or the Database Is Unavailable

Counting, dedupe and IP blocks all live in Redis. When it is unreachable, detection for that event is skipped and logged as `Suspicious activity detection skipped.`, and sign-in carries on. A database failure while recording or flagging is handled the same way. Either way, the auth response was already sent.

### Tuning

- **Start in `alert`.** Watch `flagged=true` for a week or two to see what each rule catches before turning on `enforce`.
- **(b) and shared addresses.** Offices, universities, mobile carriers and VPNs put many users behind one IP, so a burst of typos can look like stuffing. Raise `credentialStuffing.threshold` if flags come from known shared ranges, and keep `blockMinutes` short: the block only slows sign-in from that address and lifts on its own.
- **(a) and lockout denial of service.** Anyone who knows a username can fail its sign-in on purpose, so rule (a) in enforce mode lets an attacker put a victim on a security hold. This is an accepted trade-off: the hold costs the victim a password reset, while an account that really is under attack is protected. Raise `repeatedLockouts.threshold`, or switch the rule off, if holds become a nuisance.
- **(c) and forgetful users.** Several wrong passwords and then a sign-in from a new laptop on a new network fires (c). The email only asks the user to check, so a false positive is cheap. Raise the threshold if they are frequent.
- **A threshold of `1`** fires on the first event, which is useful only for testing.

### False-Positive Runbook

1. **Find the firing.** On **Sign-in activity** (`/admin/security`), tick **Flagged only**. Each `security.suspicious_activity` row names its rule and action in `metadata`, and the flagged rows around it are the events it fired on.
2. **Credential stuffing (b).** Search with `ip` set to the address. Many unrelated names (`subject: null` rows) in a short window is an attack; a handful of real accounts from a known office or VPN is probably not. To lift a block early, delete its key with `redis-cli DEL auth:ip-block:<ip>`, or wait for it to expire. Raise the threshold if it recurs.
3. **Repeated lockouts (a).** Open the account and check the IPs first: lockouts from unfamiliar addresses are the attack the hold is for. If they came from the user's own devices and addresses, ask them to reset their password, which lifts the hold, or reinstate the account (see [Changing an Account's Status](#changing-an-accounts-status)).
4. **Success after failures (c) or refresh reuse (d).** These only emailed the user. If the user confirms it was them, nothing needs doing. If not, lock the account and ask them to reset their password.
5. **Flags stay.** A flag records that detection fired. It is not cleared when the cause is resolved, and it is deleted with its row by [retention](#retention).

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

The security-hold `423` sends the user to password reset. Once the emailed code is proven and the new password is written, `PasswordService.resetPassword` calls `AccountStatusService.liftSecurityHold`, which changes `locked` to `active` (with `source: "user"` and no actor) and nothing else, then issues the session only if the account is now active. The password is written first, so a failed write cannot reinstate a compromised account on its old password. The status is read again at that point rather than trusted from the start of the request, so an admin's suspension that lands mid-reset stands and the reset ends in `403 ACCOUNT_SUSPENDED`. The user can also place the hold themself; see [Locking Your Own Account](#locking-your-own-account).

An account with no local password (social sign-in only) cannot reset one, so only an admin can lift its hold.

On the sign-in page, a security hold reads "This account is on a security hold to protect it. Reset your password to get back in." with a **Reset your password** button that opens the reset form, instead of the unlock-code panel the temporary lockout shows. A suspension reads "This account has been suspended. Contact support if you believe this is a mistake." Provider sign-in shows the same messages. A signed-in user whose account is locked or suspended has their next refresh rejected and is signed out; the reason appears when they next try to sign in.

### Locking Your Own Account

A user who sees activity they don't recognise can put their own account on a security hold. `SelfLockService` does it through `AccountStatusService.lock` with `source: "user"`, no actor and the reason `Reported by user`, so it ends every session and personal access token exactly like an admin's hold. There are two ways in:

- **An emailed link.** Every [new-device alert](#what-is-recorded), and every [`suspicious_login` alert](#the-suspicious_login-email), to an account that can reset its password carries "This wasn't you? Lock your account", linking to `/auth/self-lock?token=...`. `DeviceService` picks the `device.new_detected` event's id before sending, so the token can name it; if Redis cannot store the token, the alert goes out without the link. The page posts the token to `POST /auth/account/self-lock` with `{ "token": "..." }`, which is public: the real user may already have been signed out. The token is 32 random bytes, valid for 24 hours, and stored in Redis only as `auth:self-lock:<sha256 of the token>`, mapping to `{ userId, sourceEventId }`. Redeeming it first claims it: a Lua script reads the key and renames it to `auth:self-lock:claimed:<hash>` in one step, keeping its expiry, so a link used twice, or by two racing requests, is acted on at most once. Once the lock is written, or there was nothing to change, the claimed key is deleted. If anything else fails, such as a database outage, the key is renamed back so the same link still works on retry. The event records `metadata.channel` `email_link` and the `sourceEventId` of the event whose email carried the link.
- **A signed-in session.** **This wasn't me** on the account page's [security activity](#on-the-account-page) calls `POST /auth/account/self-lock/session`, which needs the same recent `mfa-management` step-up as the Security tab, records `metadata.channel` `session`, and clears the browser's refresh and CSRF cookies.

Both use the `auth-sensitive` rate limit.

The link opens `/auth/self-lock` ([page.tsx](../frontend/src/app/auth/self-lock/page.tsx), [self-lock-card.tsx](../frontend/src/components/auth/self-lock-card.tsx)). Opening it changes nothing: email link scanners and browser prefetchers issue only `GET` requests, and the token is posted only when the user clicks **Lock my account** (relabelled "Locking..." and disabled while the request runs; **Cancel** returns to sign in). Success shows "Your account is locked" with the recovery steps and a **Reset your password** button to `/login?recovery=account`, and then re-checks the browser's session with a refresh. A session of the locked account fails that refresh and is dropped, so the reset form is reachable at once; the sign-in page would otherwise send a signed-in visitor home. A session of another account survives, so the page offers **Sign out** first instead of a reset link that would bounce, and never signs that account out on its own. The expired state does the same. A `410`, or a link with no token, shows "This link has expired" and says nothing was changed. Any other failure keeps the confirmation with an inline error so the user can try again. `/auth/self-lock?status=locked` shows the success state without a token; the signed-in variant lands there.

| Situation                                    | Result                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| A valid token for an active account          | `200 { "locked": true }`; the account is locked.                                 |
| A valid token for a locked or suspended one  | The same `200`; nothing changes, and a suspension is never downgraded to a hold. |
| An unknown, expired or already used token    | `410 GONE`, "This link has expired or was already used."; nothing changes.       |
| An admin's change lands mid-request          | The same `200`; the admin's change stands.                                       |
| The session variant without a recent step-up | `401 MFA_VERIFICATION_REQUIRED`; nothing changes.                                |
| The session variant with no local password   | `409` with `details.reason` `password_reset_unavailable`; nothing changes.       |

A valid token's answer never depends on the account's state, so it cannot be used to learn whether an account is held or suspended. Only accounts that can reset a local password (a verified email and a password) can lock themselves, because that reset is the only way back in: a social-only account would otherwise be stranded behind a hold only an admin could lift.

Instead of the `account_locked` notice, the user gets an `account_self_locked` email confirming the lock, with the recovery steps: reset the password from `/login?recovery=account`, choose a new one, then remove devices and tokens they don't recognise. Recovery is the ordinary reset described [above](#recovering-from-a-security-hold), so it still needs the code emailed to the address on file. Someone who controls the user's mailbox could therefore both lock and recover the account; mailbox compromise is outside this threat model.

### Changing an Account's Status

`AccountStatusService` (`lock`, `suspend`, `reinstate`) is the only place the status changes. Each change:

1. Writes the status, reason, time and actor, but only while the account is still in the status that was read. If another change got there first, nothing is written, recorded or sent, and an admin gets `409`. A lock or suspension bumps `token_version` in the same write, which ends every access and refresh token at once; their 900-second lifetime does not matter.
2. Revokes every Redis session record for the user (best effort; the token version already ended them).
3. Records `account.locked`, `account.suspended` or `account.reinstated` with `metadata.source` `admin`, `system` or `user`, plus any extra metadata the caller passes, such as a self-lock's `channel`. The extras never replace `source`, `previousStatus` or `reason`.
4. Queues an `account_locked`, `account_suspended` or `account_reinstated` email when the status actually moved. A hold the user placed themself queues `account_self_locked` instead. The email explains what the status means and what to do; it never includes the reason, which may be an internal note.

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

Rows are kept for `authAudit.retentionDays` (`AUTH_AUDIT_RETENTION_DAYS`), 180 days by default, and then deleted. Every event type and outcome follows the same period, including rows that [suspicious-activity detection](#suspicious-activity-detection) flagged.

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
