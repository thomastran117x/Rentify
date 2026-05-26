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
