# Auth Session Model

## Browser clients

Browser clients use a cookie-backed refresh session:

- The backend sets `refresh_token` as an HTTP-only cookie.
- The backend sets `csrf_token` as a readable same-site cookie.
- The frontend keeps access tokens only in memory.
- The frontend sends `x-csrf-token` with cookie-backed unsafe auth requests, including refresh and logout.
- Page reloads silently restore an access token through `POST /auth/refresh`.
- No auth session token is written to `localStorage`.
- Refresh tokens are stateful, server-tracked, and rotated on use.
- Browser logout revokes only the current server-side session, not every device on the account.

This applies to desktop and mobile browsers. Browser detection is based on browser request headers such as `Origin`, `Referer`, or `Sec-Fetch-Site`, not on the device user agent.

## Native mobile and API clients

Non-browser clients do not rely on cookies:

- `refreshToken` is returned in the JSON response body.
- The client stores refresh tokens in its platform credential store or API-client secret storage.
- The client sends refresh tokens in the `POST /auth/refresh` JSON body.
- The client sends access tokens with `Authorization: Bearer <token>`.
- CSRF headers are not required because cookies are not used as ambient credentials.

Native/API clients must not send browser CSRF cookies as their token source. Browser clients must not read or persist refresh tokens in JavaScript.

## Logout and refresh

Cookie-backed browser refresh and logout are protected by origin checks plus a double-submit CSRF token:

- Cookie: `csrf_token`
- Header: `x-csrf-token`

On logout, both `refresh_token` and `csrf_token` are cleared.

## Session revocation

- Every authenticated session is tracked server-side with a `sessionId`.
- Access tokens remain short-lived, but they are also checked against the live server-side session state.
- Replayed refresh tokens revoke the affected session chain after the short duplicate-request grace window.
- Removing a known device revokes any active sessions bound to that device.

## OAuth onboarding and the generated username

Local accounts sign in with a username; OAuth accounts get a username too. The first
time someone signs in with Google or Microsoft, the backend creates the account and
auto-generates a username from the email local part (`auth.repository.ts` →
`generateAvailableUsername`). OAuth-only accounts have no password (`passwordHash` is
`null`).

To make that generated identity visible instead of implicit:

- The OAuth authenticate responses (`POST /auth/oauth/{google,microsoft}`) include
  `isNewUser: true` **only** on the response that just created the account. It is absent
  for every returning sign-in and for all local flows. See `AuthSessionResponseData` in
  the committed OpenAPI spec.
- On the frontend, a first-time OAuth success opens a one-time welcome modal
  (`oauth-welcome-modal.tsx`) that shows the generated username and lets the user keep or
  customize it inline. Saving a change goes through the existing `PUT /profile/me`
  (`profilesApi.updateMine`); the redirect to the post-login destination is deferred until
  the modal closes. Returning users are redirected immediately with no modal.
- The username is always visible afterward under **Account → Profile**, where copy explains
  that it is the sign-in and recovery identity.

## Username recovery

Because local password reset is keyed by **username** and OAuth-only accounts have no
password, a social user who never learned their generated username would otherwise have no
recovery path. `POST /auth/local/username/forgot` closes that gap:

- The request is keyed by **email** (unlike password reset, which is keyed by username).
- If an account exists for that email, its username is emailed to the address on file
  (`username_reminder` email job). This works for OAuth-only accounts and local accounts
  alike.
- The endpoint always returns `202 { accepted: true }` regardless of whether an account
  exists (anti-enumeration), is captcha-protected, and is rate-limited with the same
  public-OTP mechanism and per-scope limits as password reset. The buckets are
  independent: rate-limit keys are namespaced by purpose (`username-reminder` vs
  `local-password-reset`), so the two flows do not share a counter.
- In the UI it lives in the sign-in "I can't log in" recovery dialog
  (`account-recovery-dialog.tsx` → `forgot-username-form.tsx`), alongside password reset.

Password reset (`/auth/local/password/*`) remains username-keyed and continues to reject
OAuth-only accounts with a clear "use your social provider" message — recovering a username
does not create or reset a password.
