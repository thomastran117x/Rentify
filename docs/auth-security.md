# Authentication Audit Log

The backend records authentication activity in the `auth_audit_events` table and writes one structured log line for each event. The record answers "who tried to sign in to which account, from where, and what happened". Users read their own history through `GET /auth/audit/me` (see [Reading Your Own Activity](#reading-your-own-activity)). Administrators search every account's events through `GET /admin/auth/audit` and `GET /admin/users/:id/security` (see [Investigating Sign-in Activity](#investigating-sign-in-activity)).

Code lives in [backend/src/app/features/auth/audit](../backend/src/app/features/auth/audit). Flows write through `AuthAuditService.recordSafely`, which never fails or retries. If the insert fails, the error is logged and the authentication operation goes ahead unchanged.

## What Is Recorded

| Event type                       | Outcome              | Reason                                | Written when                                                                                                                                                                                  |
| -------------------------------- | -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login.succeeded`                | `success`            |                                       | A local password sign-in issues a session, in one step or through `POST /auth/login/mfa`. Carries `session_id`.                                                                               |
| `login.failed`                   | `failure`            | `bad_credentials`                     | The username is unknown or the password is wrong                                                                                                                                              |
| `login.failed`                   | `failure`            | `email_unverified`                    | The password is right but the email address was never verified                                                                                                                                |
| `login.failed`                   | `failure`            | `mfa_invalid`                         | The password is right but the authenticator code was rejected, sent with the password or to `POST /auth/login/mfa`                                                                            |
| `login.failed`                   | `failure`            | `token_invalid`                       | A login MFA challenge was presented from another device, or the account changed since it was issued                                                                                           |
| `login.failed`                   | `blocked`            | `account_locked`, `account_suspended` | The password is right but the account is locked or suspended. Answered with `423` or `403`; see [Account Status](#account-status).                                                            |
| `login.mfa_challenged`           | `success`            | `mfa_required`                        | The password or provider sign-in passed and the account needs an authenticator code that was not sent, so a login MFA challenge was issued. Carries the first step's method.                  |
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
| `oauth.login.failed`             | `failure`            | `mfa_invalid`                         | A linked OAuth account rejected its MFA code. A rejected code counts towards the username lockout.                                                                                            |
| `oauth.login.failed`             | `failure`            | `token_invalid`                       | An OAuth-started login MFA challenge was presented from another device, or the account changed since it was issued.                                                                           |
| `oauth.login.failed`             | `blocked`            | `account_locked`, `account_suspended` | The provider verified a linked account that is locked or suspended. Recorded before MFA.                                                                                                      |
| `oauth.signup.completed`         | `success`            |                                       | Direct or continued OAuth signup creates the user and session. Issuing a continuation token alone writes no event.                                                                            |
| `oauth.linked`                   | `success`            |                                       | A provider identity was newly linked. Carries the provider, user and acting session.                                                                                                          |
| `oauth.unlinked`                 | `success`            |                                       | A provider identity was actually removed. Carries the provider, user and acting session.                                                                                                      |
| `session.refresh_reuse_detected` | `blocked`            |                                       | A consumed refresh token was replayed outside its five-second grace period. Carries method `refresh`; the configured response revokes that session or every session for the user.             |
| `session.revoked`                | `success`            |                                       | Device removal or session management revoked an active session. One row is written per session; management metadata includes `scope` `one`, `others` or `all`.                                |
| `device.new_detected`            | `success`            |                                       | An unknown device was detected. Metadata records `emailNotification` as `sent` or `suppressed`. A sent alert's id is its lock link's `sourceEventId`.                                         |
| `password.changed`               | `success`            |                                       | A local password was replaced using the current password. Carries method `password` and the replacement session.                                                                              |
| `password.change_failed`         | `failure`            | `bad_credentials`                     | A wrong current password on `POST /auth/local/password/change`. Counts towards the username lockout; the fifth is recorded as `login.locked`.                                                 |
| `password.change_failed`         | `blocked`            | `locked`                              | A password change was refused, before the password was checked, because password sign-in is locked.                                                                                           |
| `password.reset`                 | `success`            |                                       | Password recovery completed. Also carries the normalized username HMAC.                                                                                                                       |
| `password.set`                   | `success`            |                                       | A social-only account added its first local password.                                                                                                                                         |
| `email.changed`                  | `success`            |                                       | Email change completed. Metadata contains only `oldEmailMasked`, `newEmailMasked` and `emailNotification`. Its id is the revert link's `sourceEventId`.                                       |
| `email.change_reverted`          | `success`            |                                       | An [emailed revert link](#undoing-an-email-change) restored the old address. Metadata contains only `oldEmailMasked`, `newEmailMasked` and `sourceEventId`.                                   |
| `mfa.totp_enabled`               | `success`            |                                       | A pending TOTP factor was activated.                                                                                                                                                          |
| `mfa.totp_disabled`              | `success`            |                                       | An active TOTP factor was removed; pending/missing factors do not emit it.                                                                                                                    |
| `mfa.recovery_code_used`         | `success`            |                                       | A [recovery code](#recovery-codes) was spent. Metadata contains only `remaining`, `stage` (`login` or `step_up`) and `emailNotification`. A sign-in's event carries its method, no session.   |
| `mfa.recovery_codes_regenerated` | `success`            |                                       | Every recovery code was replaced with a new set. Metadata contains only `remaining` and `emailNotification`.                                                                                  |
| `mfa.step_up_failed`             | `failure`            | `mfa_invalid` or blank                | A confirm code was invalid, or challenge delivery failed. Metadata contains only stage, scope, factor and result.                                                                             |
| `mfa.step_up_locked`             | `blocked`            | `rate_limited`                        | Challenge/confirm windows, OTP cooldown, repeated-code lock, and attempts during that lock.                                                                                                   |
| `pat.created`                    | `success`            |                                       | A personal access token was created. Carries method `pat` and metadata `{ "tokenId": ..., "emailNotification": ... }`, never the token.                                                       |
| `pat.revoked`                    | `success`            |                                       | A personal access token changed from active to revoked. Repeated revoke calls write no event.                                                                                                 |
| `rate_limit.exceeded`            | `blocked`            | `rate_limited`                        | A Redis-backed `auth-sensitive` or `auth-refresh` policy returned 429. See dedupe rules below.                                                                                                |
| `admin.audit_viewed`             | `success`            |                                       | An administrator read the audit log. `user_id` is null, `actor_user_id` is the reader and `metadata` holds the filters used.                                                                  |
| `admin.ip_unblocked`             | `success`            |                                       | An administrator lifted an IP block early. `user_id` is null, `actor_user_id` is the admin and `metadata` is `{ "ipAddress": ... }`.                                                          |
| `account.locked`                 | `success`            |                                       | An account was put on a security hold. `actor_user_id` is the admin, or else null. `metadata` is `{ "source", "previousStatus", "reason" }`, and more; see [Account Status](#account-status). |
| `account.suspended`              | `success`            |                                       | An account was suspended. Same `actor_user_id` and `metadata` as `account.locked`.                                                                                                            |
| `account.reinstated`             | `success`            |                                       | A locked or suspended account was set back to active, by an admin or by the user's own password reset (`metadata.source` `user`, no actor). Reinstating an active account writes nothing.     |
| `security.suspicious_activity`   | `blocked`, `failure` |                                       | A detection rule fired. `blocked` when enforce mode locked the account or blocked the IP. Always `flagged`. See [Suspicious Activity Detection](#suspicious-activity-detection).              |

Each local sign-in attempt writes exactly one event. The fifth failed attempt, the one that sets the lock, is recorded as `login.locked`, not as `login.failed`. A wrong current password on a password change counts towards the same lock and follows the same rule: `password.change_failed` until the attempt that sets the lock, which is `login.locked` with `metadata.triggered`, and so counts towards the repeated-lockouts detection rule. `password.change_failed` itself feeds no detection rule.

When the account has an authenticator app, a sign-in takes two requests: the first step records `login.mfa_challenged` with the password or provider method, and `POST /auth/login/mfa` records the outcome. Its events use the method of the first step, so a provider sign-in finished with a code is still `oauth.login.succeeded` with the provider method. Wrong codes count towards the same per-username lockout for both kinds of sign-in. An unknown or expired challenge names no account and writes no event.

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

| Category           | Event types                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sign_in`          | `login.*`, `oauth.login.succeeded`, `oauth.login.failed`, `oauth.signup.completed`, `mfa.step_up_failed`, `mfa.step_up_locked`, `password.change_failed`, `rate_limit.exceeded`                                                                                     |
| `security_changes` | `password.changed`, `password.reset`, `password.set`, `email.changed`, `email.change_reverted`, `mfa.totp_enabled`, `mfa.totp_disabled`, `mfa.recovery_code_used`, `mfa.recovery_codes_regenerated`, `oauth.linked`, `oauth.unlinked`, `pat.created`, `pat.revoked` |
| `sessions`         | `logout`, `session.revoked`, `session.refresh_reuse_detected`, `device.new_detected`                                                                                                                                                                                |

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

## Managing Sessions

Account → Security shows **Where you're signed in** separately from registered
devices. A device is a remembered client; a session is one particular sign-in
on that client. All session endpoints require a signed-in JWT session with a
recent `mfa-management` step-up, and reject personal access tokens.

- `GET /auth/sessions` lists active sessions, with the caller first. It returns
  coarse browser and operating-system names, platform, first and latest IP,
  creation and last-use times, and whether Remember me was selected. Raw user
  agents are not returned.
- `DELETE /auth/sessions/:id` signs out one session owned by the caller. An
  unknown or other user's ID is the same `404`. Deleting the current session
  also revokes its refresh token and clears the refresh and CSRF cookies.
- `POST /auth/sessions/revoke-others` takes `scope` `others` or `all`.
  `others` preserves the caller. `all` also increments `tokenVersion`, revokes
  active personal access tokens, and clears the caller's cookies.

Session records live under `auth:session:<id>`. Each account has a Redis set at
`auth:user-sessions:<userId>` containing its session IDs. Creation and updates
write the record and index atomically, and the index expires no sooner than its
longest session. Listing or bulk revocation reads only that set; it never scans
all users' session keys. A member whose session expired, was revoked, belongs
to another user, or carries an obsolete token version is removed lazily. A
revoked record remains until its original TTL so both the old access token and
refresh token continue to fail.

Successful JWT-authenticated HTTP requests update `lastUsedAt` and the latest
IP without extending the session lifetime. Sessions created before the index
was deployed join it on their next request or refresh. Older tokens with no
`sessionId` can use their current access token until it expires, but their next
refresh is rejected and they must sign in again.

Each revoked session writes `session.revoked` with `metadata.scope` `one`,
`others`, or `all`. A sign-out-everywhere operation also writes `pat.revoked`
for each PAT it changes. Reading the list is not recorded as a revocation.

## Step-Up Verification

A step-up is a fresh second-factor check on a session that is already signed in. It proves the person at the keyboard still controls a factor, not just the session. A proof lasts 15 minutes, belongs to one session and one scope, and stops counting when the account's email, token version or authenticator changes.

### What Needs One

These all need a recent proof, and return `401 MFA_VERIFICATION_REQUIRED` without one:

- changing or setting a password, and changing the email address
- listing and removing devices, and listing and ending sessions
- managing the authenticator app
- signing a session out with **This wasn't me**, and reading `/auth/audit/me`
- creating and revoking personal access tokens (listing them does not need one)
- linking and unlinking a Google, Microsoft or Apple sign-in
- `POST /auth/device/verify`
- changing an organization member's role and removing a member, whatever the role, since a proof lasts 15 minutes and a run of changes prompts only once

Personal access tokens can't complete a step-up, and none of these routes accept one.

Clients run the action, and on that error open [mfa-verification-dialog.tsx](../frontend/src/components/auth/mfa-verification-dialog.tsx) and retry. The panels share this through [use-mfa-step-up.tsx](../frontend/src/components/auth/use-mfa-step-up.tsx). A dismissed dialog changes nothing.

Starting a provider link (`POST /auth/oauth/{provider}/start`) needs no proof: it links nothing, and the provider popup has to open straight from the click. The link callback checks for a proof before it spends the state, so a client told to verify sends the same request again.

### Marking a Device Known

`POST /auth/device/verify` stops new-device alerts for a device and keeps it out of detection rule (c), so a stolen password or session must not be enough to call it. It accepts a recent proof from either scope: `device-login` from the sign-in check below, or `mfa-management` from anywhere else.

| Sign-in                                               | Check                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Unknown device on an unknown IP, password or provider | A code from the account's factor, then the device registers. Cancelling ends the sign-in. |
| Finished with an authenticator or recovery code       | The code counts as the `device-login` proof, so there is no second prompt.                |
| Unknown device on a known IP                          | No prompt. It stays unregistered unless the session already has a proof.                  |
| A provider sign-in that just created the account      | No prompt, and it stays unregistered. The check runs on the next sign-in.                 |
| No factor available                                   | No prompt, and it stays unregistered.                                                     |

A device left unregistered still works. The next sign-in from it on a new IP gets the usual new-device alert and check.

### Which Factors Count

An account can only step up with its strongest factors:

| Account                          | Accepted factors                               | Refused                             |
| -------------------------------- | ---------------------------------------------- | ----------------------------------- |
| Active authenticator app         | TOTP, and a recovery code while any are unused | Email: `400 MFA_FACTOR_UNAVAILABLE` |
| Verified email, no authenticator | Email                                          |                                     |
| Neither                          | None                                           | Everything; the dialog says so      |

The rule applies to the `mfa-management` and `device-login` scopes alike. Without it, step-up would only be as strong as the inbox. Running out of recovery codes never brings email back: such an account steps up with its authenticator or not at all. Passkeys (#465) will join the stronger factors when they land.

An authenticator code is good for one use, at sign-in and at step-up alike. Accepting one records its 30-second step in `user_mfa_totp.last_used_counter` with a conditional update that matches only an older step. So of two requests racing with the same code, exactly one succeeds, and the other gets the answer a wrong code gets.

A stored proof is checked against the factors it could have been made with, not only the ones still usable. A proof made with an account's last recovery code stays good for its 15 minutes, even though no code is left to offer.

Disabling the authenticator app signs out every other session on the account, and each one writes `session.revoked` alongside the `mfa.totp_disabled` event. The session that disabled it stays signed in. Personal access tokens are unaffected.

**A lost authenticator can't be removed with email.** Someone who has lost it signs in and steps up with [recovery codes](#recovery-codes) instead. Without one, the account needs support.

## Recovery Codes

Recovery codes are the way back in when an authenticator app is lost. They stand in for the app's code at sign-in and at step-up, and never for anything weaker.

- **Issued with the authenticator.** Confirming an authenticator app (`POST /auth/mfa/totp/confirm`) returns 10 codes along with it, in the same transaction, so the factor is never active with codes nobody saw. They are shown once, with Copy and Download, and cannot be read back. An account that enrolled before codes existed has none until it generates a set.
- **Format.** 10 characters grouped `XXXXX-XXXXX`, from 32 symbols that leave out `0`, `1`, `I` and `O`, so 50 random bits each. Case, spaces and hyphens are ignored when one is typed.
- **Storage.** Each row in `user_mfa_recovery_codes` holds an HMAC-SHA256 of the account id and the code, never the code. The key is derived from `MFA_TOTP_ENCRYPTION_KEY` with HKDF, so there is no extra secret to deploy. A fast keyed hash is enough for codes this random: guessing is limited online by the lockout below, and a copy of the table is useless without the key.
- **Single use.** A code is spent by a conditional update on `used_at IS NULL`, so of two concurrent attempts with the same code, exactly one succeeds. A wrong code and a used one get the same answer.
- **At sign-in.** The login MFA challenge lists `recovery_code` after `totp` while the account has unused codes. A wrong code counts towards the [username lockout](./api.md#authentication-security) exactly as a wrong authenticator code does, and a locked username never spends a code. The deprecated `totpCode` field only ever takes an authenticator code.
- **At step-up.** `recovery_code` is a factor of `/auth/mfa/verify/*` on the same terms, with the same per-session limits as the authenticator.
- **Every use is audited and emailed.** Spending a code writes `mfa.recovery_code_used` and sends `mfa_recovery_code_used`, which says how many are left. Both happen when the code is claimed, so a use is never lost even if the rest of the request fails.
- **Status.** `GET /auth/mfa/recovery-codes/status` returns `{ remaining, createdAt }`. `createdAt` is null for an account that never had a set. The account page counts the codes left, warns at 2 or fewer, and warns more strongly at none.
- **Regeneration.** `POST /auth/mfa/recovery-codes/regenerate` replaces every code, used or not, writes `mfa.recovery_codes_regenerated` and sends `mfa_recovery_codes_regenerated`. It needs a recent proof from the `mfa-management` scope, or from the `device-login` scope a sign-in leaves behind. It returns `409` without an active authenticator.
- **Turning the authenticator off deletes the codes**, in the same transaction.

### Using the Last Code

Someone who has lost their authenticator and signs in with their last code has no factor left to step up with. The Security tab is behind a step-up too. So:

1. The sign-in succeeds, and its response carries `recoveryCodesRemaining: 0`.
2. The code is recorded as the session's `device-login` proof, so the new-device check passes without asking for the lost app.
3. The sign-in page holds the redirect and asks the user to generate new codes, which that proof allows for its 15 minutes. It allows nothing else: changing the password or removing the authenticator still needs a management step-up, which one of the new codes provides.

A user who skips the prompt, or reloads the page, can still regenerate from the Security tab while they have their authenticator. Without it, once the proof expires, the account needs support.

## Password Policy

Every path that sets a local password applies the same rules: signup (`POST /auth/local/signup`), reset (`POST /auth/local/password/reset`), change (`POST /auth/local/password/change`) and adding a first password to a social-only account (`POST /auth/local/password/set`). Existing passwords are not re-checked at sign-in, and accounts that only sign in through a provider are unaffected.

| Rule         | Requirement                                                                                                                                                                                                                                                                                                                             | Message                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Minimum      | 12 characters, counted as Unicode code points, so an emoji is one character                                                                                                                                                                                                                                                             | Password must be at least 12 characters.                                                    |
| Maximum      | 72 UTF-8 bytes. bcrypt ignores everything after the first 72 bytes, so two longer passwords sharing that prefix would be the same password.                                                                                                                                                                                             | Password must be at most 72 bytes. Shorten it, or use fewer accented or special characters. |
| No markup    | The shared unsafe-input rule                                                                                                                                                                                                                                                                                                            | Input contains unsupported HTML or script content.                                          |
| Not common   | Not on the bundled list of the 10,000 most common passwords, including an entry with digits or symbols added at either end (`Password1234!`, `monkey123456`). Trivial runs (`aaaaaaaaaaaa`, `abcdefghijkl`, `123456789012`) and a short unit repeated (`abcdabcdabcd`, `trustno1trustno1`) count as common too.                         | This password is too common or easy to guess. Choose something less predictable.            |
| Not personal | Does not contain the username, the email's local part or a piece of it split on `.`, `_`, `-` or `+`, or the first or last name. Case and separators are ignored, so `Renter.One-2024` is caught for `renter-one`. Pieces shorter than four characters are skipped, so a name such as "Lee" does not rule out every word containing it. | Password must not contain your name, username or email address.                             |

There are no character-class rules. Following NIST SP 800-63B, length matters more than a mix of upper case, digits and symbols, and composition rules push people towards predictable patterns such as `Password1!`.

A rejected password returns `400 VALIDATION_ERROR` with every reason under the field name, `password` for signup and `newPassword` for the others. The shape rules live in `backend/src/app/features/auth/password/policy/password-rules.ts`. The common and personal checks need the account, so `PasswordPolicyService` runs them in the services rather than in the request schema. The list is `backend/resources/common-passwords.txt`, from SecLists under the MIT License.

Where each path runs the checks matters:

- **Signup** checks first, before the address is looked up. Signup answers a registered address exactly like a new one (see [Email enumeration](./api.md#authentication-security)), and a password refused only for new addresses would tell them apart. The context is what the request carries.
- **Reset** checks only once the emailed code has matched, so nobody can learn an account's name or email by guessing passwords at it. The check runs before the code is spent: a refused password leaves the code valid, and the user can try another password with it. The attempt still counts towards the code's limit. An unknown username is checked against the name sent.
- **Change** checks after the current password is proven, and **set** after the account is confirmed to have no password.

### Breached Passwords

A password that passes every rule above is then checked against [Have I Been Pwned's Pwned Passwords](https://haveibeenpwned.com/Passwords) range API, without disclosing it:

1. The backend hashes the password with SHA-1 and sends only the first five hex characters, `GET https://api.pwnedpasswords.com/range/{prefix}`, with `Add-Padding: true`.
2. The API returns every hash suffix in that range with a breach count, padded with decoy rows whose count is `0`, so the response size reveals nothing either.
3. The backend looks for the rest of the hash among them. A decoy never matches.

Neither the password, its full hash nor the suffix leaves the server or is logged. What happens on a match depends on `authSecurity.passwords.breachCheck.mode` (see [Password checks](./backend-configuration.md#password-checks)):

| Mode                | A breached password                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforce` (default) | Refused: "This password has appeared in a known data breach. Choose a different one."                                                                           |
| `warn`              | Accepted, with the warning "This password has appeared in a known data breach. Consider choosing a different one." where the form can show it before submitting |
| `off`               | Not checked                                                                                                                                                     |

The check **fails open**. When the API takes longer than `breachCheck.timeoutMs` (1.5 seconds by default), cannot be reached or returns an error, the password is accepted, since every other rule has already passed, and the backend logs `Breached-password check unavailable; accepting password.` with the reason (`timeout`, `network` or `http`). An outage at a third party must not block signups, resets or changes. A match is logged at info level with the mode and nothing that identifies the password or the account. Passwords that a local rule already refuses are not sent at all.

### Rehashing at Sign-In

New hashes use bcrypt at `authSecurity.passwords.hashCost` (12 by default; see [Password checks](./backend-configuration.md#password-checks)). When a sign-in proves a password whose stored hash has a lower cost, the backend rehashes it at the configured cost:

- It runs after the password, account status and email checks and before the login MFA step, because the password is not sent again with the authenticator code.
- It skips the new-password rules. A password set under the old 8-character rule still upgrades.
- The write is conditional on the stored hash still being the one that was verified, so a password changed or reset in between is never overwritten.
- It is not a security change: the token version is not rotated, and nothing is audited or emailed. A failed write is logged at warn and the sign-in carries on.

The timing-safe dummy hash that unknown usernames are compared against follows the configured cost too, so raising it does not make missing accounts answer faster.

Existing passwords are not checked at sign-in. Flagging a breached password at sign-in, which would have to be carried through the login MFA challenge, is a follow-up.

`frontend/src/lib/auth/password.ts` mirrors the shape and personal rules so the forms catch a bad password before it is sent, and the new-password fields show them as a checklist. Under it, a strength meter gives a rough grade (Fair to Very strong, from length and the mix of kinds of character), and once the local rules pass, `usePasswordCheck` asks `POST /auth/password/check` 400 ms after the user stops typing. Its reasons appear under the meter, which then reads "Too weak"; a `warn`-mode breach appears as an amber warning and caps the meter at "Fair". A password the check has already refused cannot be submitted. A failed check blocks nothing, since the server checks again on submit. The "doesn't contain your name, username or email" row appears once the form knows any of those. The forms show the server's reasons on the password field: signup returns to its first step to do so, and reset keeps them off the code field.

## One-Time Codes

The six-digit codes sent by email cover signup verification, password reset, login unlock, email change, and the `email` step-up factor. They all go through `OtpService`, keyed by a purpose and a subject (an email address, or the session and scope for step-up).

- **Storage.** Redis holds `{ codeHash }` at `auth:otp:<purpose>:<subject>`: an HMAC-SHA256 of `purpose|subject|code`, keyed by `OTP_HASH_SECRET`. Binding the purpose and subject means a stored hash is good for nothing else. A submitted code is compared with `timingSafeEqual`. A code lives 10 minutes by default.
- **Attempts.** Each subject gets 5 attempts by default, counted at `auth:otp:<purpose>:<subject>:attempts`. An attempt is spent before the code is compared, so concurrent guesses cannot overrun the count. A wrong code returns `400` with `details.attemptsRemaining`. The last wrong one discards the code.
- **Resending keeps the count.** A resend replaces the code but not the count. Once all of them are spent, no new code is issued until the count expires, which is one code lifetime after the last code was issued. A refused resend does not extend it. The public resends still answer `202`, so they reveal nothing. Email change answers `429 TOO_MANY_REQUESTS`, and step-up answers `429 MFA_CHALLENGE_RATE_LIMITED`. Both carry `details.retryAfterSeconds` and `details.reason: "otp-attempts-exhausted"`. The 60-second resend cooldown and the hourly per-email, per-IP and per-device caps on the public routes still apply on top. Every one of these numbers is configurable under `authSecurity.otp`; see [Auth security thresholds](./backend-configuration.md#auth-security-thresholds).
- **Single use.** Of two requests holding the right code, only the one whose delete removes it succeeds.
- **Previews outside production.** Local and test environments suppress mail to `@rentify.local`. So outside production, each code is also kept in plain text at `auth:otp-preview:<purpose>:<subject>`, for `GET /auth/email/change/dev/otp` and `GET /auth/mfa/verify/dev/otp`. Production never writes that key, and neither route is registered there.
- **Rotating `OTP_HASH_SECRET`** voids every outstanding code, and nothing else. The secret is required, must be at least 32 characters, and in production must differ from every other auth secret.
- **Codes from before hashing.** Codes issued before hashing was introduced held the code in plain text. They are refused and deleted when used. They live 10 minutes at most, so a user who held one simply asks for a new one.

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
- `lockout`, read live from the same Redis record sign-in uses: `locked`, `failedAttempts`, `lockedAt`, and `lockedUntil`, which is `lockedAt` plus `authSecurity.lockout.lockMinutes` (30 by default). Failed attempts that have not locked the account expire 15 minutes after the last one, so `failedAttempts` can be lower than the 24-hour count;
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
- **Blocked IP addresses.** Below the table, the addresses suspicious-activity detection has blocked, each with the time it lifts and an **Unblock** button. The button reads "Unblocking..." and every button is disabled while the request runs. Success shows "... is unblocked.", reloads the list and refreshes the events table so the `admin.ip_unblocked` row shows. A block that lifted on its own meanwhile reads "... was no longer blocked." **Refresh** reloads this list too. An empty list reads "No IP addresses are blocked."
- Loading skeletons, empty states ("No events match these filters", "No more events"), and errors with **Try again** are handled for the table, the drawer and the blocked addresses.

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

| Rule                         | Counts                                                                                                                                                     | Default threshold                | Enforce action                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| (a) `repeated_lockouts`      | `login.locked` with `metadata.triggered`, per account                                                                                                      | 3 in 24 hours                    | `AccountStatusService.lock` with `source: "system"`, then email |
| (b) `credential_stuffing`    | `login.failed` with outcome `failure`, as distinct `identifier_hash` values per IP                                                                         | 20 in 10 minutes                 | Block the IP on the `auth-sensitive` policy for 60 minutes      |
| (c) `success_after_failures` | Failed sign-ins per account (`login.failed` failures and the `login.locked` that set a lock), then a completed sign-in that recorded `device.new_detected` | 5 in the hour before the success | None beyond the email, which alert mode also sends              |
| (d) `refresh_reuse`          | `session.refresh_reuse_detected`                                                                                                                           | Any                              | None beyond the email, which alert mode also sends              |

- **(a)** counts only the attempt that set the lock, not later refusals of the locked account. Only an `active` account that can reset a local password (a verified email and a password) is locked: a held account is left alone, a suspension is never downgraded, and an account that signs in only through a provider, or has never verified its email, is never held. Lockouts against its username can still be recorded, but it has no password to reset, so a hold would leave it waiting for an admin. Its firing is still recorded and flagged, with action `skipped`. The hold sends the usual `account_locked` email, and the user recovers by [resetting their password](#recovering-from-a-security-hold). The hold's reason is `Repeated sign-in lockouts`, and its `account.locked` event carries `metadata.rule` and the `sourceEventId` of the detection event.
- **(b)** counts distinct names, so one person retrying their own password never fires it. It never locks an account. Attempts the rate limiter already refused never reach sign-in, so they are not counted: with the default 10 a minute, an address needs at least two minutes to reach 20.
- **(c)** fires on `login.succeeded` or `oauth.login.succeeded`, and only when the same request (same `request_id`) also wrote `device.new_detected`. A sign-in writes that only for a device the account has not used, on an IP address it has not used either, so it is the "new device and new IP" success. Refreshing a session can also write `device.new_detected`, but records no sign-in success, so it never fires (c).
- **(d)** fires on the first reuse. `refreshReuse.windowMinutes` only stops a
  second email for the same account within the window. The separate
  `auth.refreshReuseResponse` setting controls the immediate credential
  response: `session` revokes only the replayed session, while `user` increments
  `tokenVersion` and revokes every indexed session for the account. Production
  defaults to `user`; development and test default to `session`. PATs are not
  revoked by refresh reuse.

### What a Firing Does

1. **Dedupes.** It claims `auth:detection:fired:<rule>:<user or IP>` with `SET NX` for the rule's window. If the key exists, the rule already fired in this window, and nothing else happens: no second event, lock, block or email.
2. **Finds the events behind it.** The triggering event, plus the newest of what the rule counted in the window (by user for a, c and d; by IP for b), up to 50. The lookup uses the counter's own conditions, so a refusal recorded while an account is already locked is never flagged as a lockout. For (c), the sign-in's `device.new_detected` is included too.
3. **Acts**, as in the tables above. An action that throws is logged and recorded as `failed`; the firing is still recorded.
4. **Records `security.suspicious_activity`.** It is `flagged`, has the user (null for b) and the triggering request's IP and user agent, and `metadata` is `{ rule, mode, action, windowSeconds, count, threshold, relatedEventCount, relatedEventIds }`. `action` is `none` (alert mode, for a or b), `account_locked`, `ip_blocked`, `email_sent`, `skipped` (the account was already held or suspended, cannot reset a password, or no longer exists) or `failed`. `relatedEventIds` lists up to 20 ids, comma-joined, because metadata values are scalars.
5. **Flags** each related event, so the admin view finds them with `flagged=true`.
6. **Logs** `Suspicious activity detected.` at warn level, with the rule, mode, action, counts, user, IP and event ids.

The user sees the event on their [account page](#on-the-account-page) as "Suspicious sign-in activity detected", without its metadata.

### The `suspicious_login` Email

Rules (c) and (d) queue one `suspicious_login` email. It says what was seen, lists the time, IP address and user agent, and advises changing the password and reviewing devices and personal access tokens:

- (c): "Someone signed in to your account from a new device and a new location, right after several failed attempts to sign in."
- (d): "A sign-in session on your account was used from two places, which can
  mean someone copied it. We ended the affected sign-ins."

For an account that can reset a password, it carries the same "This wasn't you? Lock your account" link as the new-device alert, and the link's `sourceEventId` is the `security.suspicious_activity` event. See [Locking Your Own Account](#locking-your-own-account).

### IP Blocks

A block is the Redis key `auth:ip-block:<ip>`. It holds the time the block lifts and expires then. While it exists, every request on the `auth-sensitive` policy from that address gets `429 TOO_MANY_REQUESTS` with `Retry-After` and `details: { "policy": "auth-sensitive", "reason": "ip_blocked", "retryAfterSeconds": ... }`, before the sliding window is consulted.

- **It is by address**, whoever is signed in. Other policies, such as browsing or `/auth/refresh`, are unaffected, so a signed-in user behind the address stays signed in.
- **The rate limiter enforces it**, so `rateLimiter.enabled: false` turns blocks off too.
- **It fails open.** If the block list cannot be read, the request is allowed and the failure is logged at most once a minute.
- **Admins can see and lift it.** `GET /admin/auth/ip-blocks` lists live blocks with `expiresAt`, soonest first, and records an `admin.audit_viewed` event with `metadata.view` `ip_blocks`, failing if that write fails. `DELETE /admin/auth/ip-blocks/:ip` deletes the key and answers `204`, then records `admin.ip_unblocked`; an address that is not blocked is a `404` and one that is not an IP is a `400`. Both need an admin signed-in session, like the audit search.

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
2. **Credential stuffing (b).** Search with `ip` set to the address. Many unrelated names (`subject: null` rows) in a short window is an attack; a handful of real accounts from a known office or VPN is probably not. To lift a block early, press **Unblock** next to the address under **Blocked IP addresses** on the same page, or wait for it to expire. Raise the threshold if it recurs.
3. **Repeated lockouts (a).** Open the account and check the IPs first: lockouts from unfamiliar addresses are the attack the hold is for. If they came from the user's own devices and addresses, ask them to reset their password, which lifts the hold, or reinstate the account (see [Changing an Account's Status](#changing-an-accounts-status)).
4. **Success after failures (c) or refresh reuse (d).** These only emailed the user. If the user confirms it was them, nothing needs doing. If not, lock the account and ask them to reset their password.
5. **Flags stay.** A flag records that detection fired. It is not cleared when the cause is resolved, and it is deleted with its row by [retention](#retention).

## Security Emails

An account's owner is told about every security-relevant change, because someone who takes over an account would otherwise make these changes unnoticed. They are not a preference: security emails cannot be turned off.

Change emails go out through `SecurityNotificationService` ([security-notification.service.ts](../backend/src/app/features/auth/security-notification/security-notification.service.ts)):

| Kind                             | Sent when                                                       | Also says                                                                 |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `password_changed`               | A password is changed, reset or added                           | Which of the three happened                                               |
| `mfa_enabled`                    | An authenticator app is confirmed                               |                                                                           |
| `mfa_disabled`                   | An active authenticator app is removed                          |                                                                           |
| `mfa_recovery_code_used`         | A recovery code is spent, at sign-in or step-up                 | How many codes are left, and to generate more when none are               |
| `mfa_recovery_codes_regenerated` | Every recovery code is replaced                                 | That the old codes stopped working                                        |
| `personal_access_token_created`  | A personal access token is created                              | Its name, scopes and expiry                                               |
| `login_method_linked`            | A provider is newly linked                                      | The provider                                                              |
| `login_method_unlinked`          | A provider is actually removed                                  | The provider                                                              |
| `email_changed`                  | An email change completes, sent to the address the account left | The redacted new address, and the [revert link](#undoing-an-email-change) |

Each one states the time, a coarse device such as "Chrome on Windows" from `parseUserAgent`, and the IP address, and advises changing the password and reviewing devices and personal access tokens. An account that can reset a password also gets the "This wasn't you? Lock your account" link from [Locking Your Own Account](#locking-your-own-account), and the link's `sourceEventId` is the change's audit event. A social-only account gets no lock link, because it could not recover from the lock.

Other security emails come from where the event happens: `new_device`, `suspicious_login`, `account_locked`, `account_self_locked`, `account_suspended` and `account_reinstated`, `email_change_notice` to the old address when a change is requested, and the `login_unlock`, `password_reset`, `email_change_code`, `mfa_step_up` and `verification` codes.

### What Happens to Each Email

An email is queued after the change has succeeded, and failing to queue one never fails the change. The change's audit event records what happened in `metadata.emailNotification`:

| Value        | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `sent`       | The email was queued.                                                                 |
| `suppressed` | The rate limit below stopped it.                                                      |
| `skipped`    | The address was never verified, so nothing was sent.                                  |
| `failed`     | The email could not be queued, or the account could not be read. The error is logged. |

Password and email changes queue their email before the new session is issued, so a failure there cannot leave a committed change unannounced.

Each inbox gets at most 3 emails of a kind per hour, so repeated toggling cannot flood it. `mfa_recovery_code_used` gets 10, one set's worth, so every code of a set is announced however quickly it is spent. An allowance rather than a one-email cooldown means an attacker's change straight after the owner's own still arrives. The first email of a kind always goes out, and if Redis is down the limit is skipped rather than the email. The key is `auth:security-email:<kind>:<sha256 of the address>`, so an account moving between addresses is not limited across them.

### Undoing an Email Change

The `email_changed` email to the old address carries a link to `/auth/email-change/revert?token=...`, valid for 7 days. Opening it changes nothing, and it works once: the page ([page.tsx](../frontend/src/app/auth/email-change/revert/page.tsx), [email-change-revert-card.tsx](../frontend/src/components/auth/email-change-revert-card.tsx)) posts the token to the public `POST /auth/email/change/revert` only when the user clicks **Put my old email back**. The endpoint uses the `auth-sensitive` rate limit.

The link lives in the `email_change_reverts` table rather than in Redis with the shorter-lived auth tokens, because for a week it can be the owner's only way back in and must survive a cache flush. Only the token's SHA-256 hash is stored. The link is issued only for an email that goes out, and if it cannot be stored the email goes out without it.

Using the link restores the old address and bumps the token version, ending every session. What else happens depends on the account:

| Account        | Result                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has a password | The address and a [security hold](#account-status) are written together, so personal access tokens stop too. `nextStep` is `reset_password`, and the code goes to the restored address. The user gets `account_self_locked` there, unless the account was already locked. |
| Social-only    | No hold, since only an admin could lift it. `nextStep` is `sign_in`. Personal access tokens keep working, so the owner should review them.                                                                                                                                |
| Suspended      | The suspension stays, and is never downgraded to a hold. `nextStep` is `sign_in`.                                                                                                                                                                                         |

It records `email.change_reverted`, and a hold also records `account.locked` with `metadata.channel` `email_revert`.

| Situation                                                     | Result                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| An unknown, expired or already used token                     | `410 GONE`, "This link has expired or was already used."; nothing changes. |
| The account's email has changed again since the link was sent | The same `410`. The link stays spent.                                      |
| The address was taken regardless                              | `409`. The link can be retried.                                            |
| An email change is being confirmed at that moment             | `409`. The link can be retried.                                            |
| An unexpected failure, such as a database outage              | The error is returned, and the link can be retried.                        |

An account has one open link at most: a newer email change retires the older link, so an address the account left is never restored over a newer decision. Because that newer link restores only the address before it, an attacker who changes the email twice defeats the first link. The lock link in that first email still works for 24 hours.

While its link is open, the old address stays reserved. `EmailAvailabilityService.isEmailAvailable` reports it as `taken`, signup answers as it does for a taken address and sends no code, and provider sign-in refuses it with the usual conflict. The account itself may still move back. The unique index on `users.email` is the final word, which is the `409` above.

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
| `POST /auth/login/mfa`, before the code is checked        | `423 ACCOUNT_LOCKED`     | `403 ACCOUNT_SUSPENDED`                  |
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

- **An emailed link.** Every [new-device alert](#what-is-recorded), every [`suspicious_login` alert](#the-suspicious_login-email), and every [email about a change](#security-emails), to an account that can reset its password carries "This wasn't you? Lock your account", linking to `/auth/self-lock?token=...`. `DeviceService` picks the `device.new_detected` event's id before sending, so the token can name it; if Redis cannot store the token, the alert goes out without the link. The page posts the token to `POST /auth/account/self-lock` with `{ "token": "..." }`, which is public: the real user may already have been signed out. The token is 32 random bytes, valid for 24 hours, and stored in Redis only as `auth:self-lock:<sha256 of the token>`, mapping to `{ userId, sourceEventId }`. Redeeming it first claims it: a Lua script reads the key and renames it to `auth:self-lock:claimed:<hash>` in one step, keeping its expiry, so a link used twice, or by two racing requests, is acted on at most once. Once the lock is written, or there was nothing to change, the claimed key is deleted. If anything else fails, such as a database outage, the key is renamed back so the same link still works on retry. The event records `metadata.channel` `email_link` and the `sourceEventId` of the event whose email carried the link.
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

The same worker deletes `email_change_reverts` rows past their `expires_at`. They hold plain addresses, and past that point do nothing.

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

## Signing Key Rotation

Access JWTs, refresh tokens and personal access token (PAT) hashes each have a keyset: one `current` key that signs, and any number of `next` keys (staged for promotion) and `previous` keys (being retired) that only verify. Every token records the kid of the key that signed it, so a rotation logs nobody out. The format, and how each kind of token finds its key, are in [Token signing keys](./backend-configuration.md#token-signing-keys).

Rotate one purpose at a time. The steps are the same for `ACCESS_TOKEN_KEYS`, `REFRESH_TOKEN_KEYS` and `PERSONAL_ACCESS_TOKEN_KEYS`, and every backend process, workers included, needs the same keyset at each step.

### Runbook

0. **First rotation only: move to a keyset.** Replace the single-secret variable with a keyset that holds the same secret under kid `default`. Tokens issued before keysets carry no kid and are verified with `default`, so this kid must stay until step 4. Unset the old variable, because setting both stops startup.

   ```dotenv
   REFRESH_TOKEN_SECRET=
   REFRESH_TOKEN_KEYS=[{"kid":"default","status":"current","secret":"<old secret>"}]
   ```

1. **Add the new key as `next`, and deploy.** Generate a new secret of at least 32 characters (for example `openssl rand -base64 48`), give it a new kid such as the month, and add it with `"status":"next"`. Nothing is signed with it yet. Use `next` rather than `previous`: while step 2 rolls out, an instance still on this step must not move PATs off the new key that promoted instances have just moved them onto. Deploy this everywhere before step 2. This is "add before use": if step 2 is rolled back, the rolled-back instances can still verify the tokens it signed.
2. **Promote the new key.** Make the new key `current` and the old key `previous`, and deploy. New tokens, and every refreshed session, are now signed with the new key, and tokens signed with the old key keep working.
3. **Wait out the longest lifetime.** Remember-me refresh tokens last 90 days (`REMEMBER_ME_REFRESH_TOKEN_TTL_SECONDS`), other refresh tokens 30 days, and access tokens 15 minutes. A session that refreshes in the meantime moves onto the new key. PATs move to the new key the next time they are used, so before removing a PAT key, check how many live PATs still depend on it:

   ```sql
   SELECT secret_kid, COUNT(*)
   FROM personal_access_tokens
   WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
   GROUP BY secret_kid;
   ```

   A PAT still on the old kid stops working when the key is removed. Its owner has to create a new one.

4. **Remove the old key, and deploy.** Tokens still signed with it are rejected from now on: a refresh token sends its user back to sign in, and an access token answers `401` and is refreshed.

To revoke a key because it leaked, skip the wait in step 3: promote the new key and remove the leaked one in the same deploy. Everyone signed in with the leaked key is signed out.

### Rules

- `next` and `previous` keys never sign. Only the `current` key does, and startup requires exactly one. PATs move off `previous` keys only.
- An `ACCESS_TOKEN_KEYS` entry with `publicKey` is an `RS256` key, so moving from `HS256` to `RS256` is an ordinary rotation: in step 2, set `ACCESS_TOKEN_ALGORITHM=RS256` in the same deploy that promotes the `RS256` key, because startup requires the current key to use that algorithm. A `next` or `previous` `RS256` key needs only its `publicKey`.
- Do not roll back past the release that introduced keysets once a key other than `default` has been promoted. That release reads only `v1` refresh tokens, ignores an access token's kid, and hashes PATs only with `PERSONAL_ACCESS_TOKEN_SECRET`, so sessions refreshed and PATs used since the promotion stop working. Until the first promotion, every token is still issued in the old format, so a rollback is safe.
- In production, no two secrets may be equal across purposes, previous keys included. See [Issuer, audience, and production checks](./backend-configuration.md#issuer-audience-and-production-checks).

### Out of Scope

- `MFA_TOTP_ENCRYPTION_KEY` is an encryption key, not a signing key. Rotating it means re-encrypting every stored authenticator secret, which has no tooling yet. Replacing it without that breaks every enrolled authenticator app, and every [recovery code](#recovery-codes), whose hashing key is derived from it.
- `OTP_HASH_SECRET` has no keyset either. Replacing it only voids the emailed codes outstanding at the time, as [One-Time Codes](#one-time-codes) explains.
- `AUTH_AUDIT_IDENTIFIER_SECRET` has no keyset. Replacing it breaks correlation between audit rows written before and after the change, as [Why Identifiers Are Hashed](#why-identifiers-are-hashed) explains.
- There is no JWKS endpoint. No service other than the backend verifies these tokens.

## Client IP Behind a Proxy

`ip_address` is whatever the client-context middleware resolved. It is never re-parsed from headers. By default, the address is the socket peer and every proxy header is ignored. Behind a reverse proxy, that is the proxy's own address.

To see the client instead, configure which proxies to trust: either `http.trustedProxyHops` (`TRUSTED_PROXY_HOPS`) or `http.trustedProxyCidrs` (`TRUSTED_PROXY_CIDRS`). The middleware then walks `X-Forwarded-For` from the right, past the trusted proxies, and records the first address they did not add. A client can still prepend entries, but they land to the left of the address the proxy appended, so they are never chosen. Rate limits, IP blocks, and detection all key on the same value.

A vendor header such as `cf-connecting-ip` is read only when it is configured as `http.clientIpHeader`. The deprecated `TRUST_PROXY_HEADERS=true` means one hop. See [Client IP behind a reverse proxy](./backend-configuration.md#client-ip-behind-a-reverse-proxy).

## Inspecting Events Locally

With the stack running:

```bash
docker compose exec mysql mysql -urent -prent rent -e "
  SELECT created_at, event_type, outcome, reason_code, user_id, ip_address, request_id
  FROM auth_audit_events ORDER BY created_at DESC LIMIT 20;"
```

The matching log lines are emitted by `AuthAuditService` with the message `Auth event.`.
