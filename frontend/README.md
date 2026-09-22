# Rentify Frontend

The frontend is the Rentify web application built with Next.js App Router. It covers the public marketplace, authentication flows, owner dashboards, booking views, organization tooling, moderation screens, and supporting marketing pages.

## Stack

- `Next.js 16`
- `React 19`
- `Tailwind CSS 4`
- `Vitest` for unit tests
- `Playwright` for browser E2E tests

## Current App Areas

- public marketing pages such as home, about, FAQ, contact, privacy, and terms
- auth flows for login, signup, forgot password, email verification, and OAuth popup completion
- public postings search and posting detail pages
- owner posting creation and dashboard flows
- account, bookings, organizations, moderation, and analytics surfaces

## Recommended Startup

For the real local app, run the full stack from the repo root:

```bash
cp .env.example .env
docker compose up --build
```

That serves the frontend at `http://localhost:3040` and points it at the backend API running on `http://localhost:8040/api/v1`.

## Explicit Non-Docker Alternative

Use direct frontend startup only when a non-Docker workflow has been explicitly selected. Frontend-only scope does not replace the standard Compose validation runtime:

```bash
npm ci
npm run dev
```

The dev server runs on `http://localhost:3040`.

Environment loading:

- Docker Compose injects frontend env values from the repo-root `.env`
- local Next.js runs can use `frontend/.env.local`
- `INTERNAL_API_BASE_URL` is used for server-side requests
- `NEXT_PUBLIC_API_BASE_URL` is used in the browser and defaults to the local API route prefix

## Frontend Env Values

- `NEXT_PUBLIC_API_BASE_URL`: public API base URL; `http://localhost:8040/api/v1` is the recommended local value
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: enables Cloudflare Turnstile on auth pages
- `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID`: enables Google OAuth UI
- `NEXT_PUBLIC_MICROSOFT_OAUTH_CLIENT_ID`: enables Microsoft OAuth UI
- `NEXT_PUBLIC_MICROSOFT_OAUTH_TENANT`: Microsoft authority segment such as `consumers`, `organizations`, `common`, or a tenant ID
- `NEXT_PUBLIC_APPLE_OAUTH_CLIENT_ID`: Apple Services ID; enables Sign in with Apple UI. Apple's JS SDK opens the popup, and the backend verifies the returned ID token. Register `https://<your-domain>/auth/apple` as the Services ID return URL. Apple rejects `localhost`, so a full Apple round-trip needs a real HTTPS domain.
- `INTERNAL_API_BASE_URL`: server-side API base URL, typically `http://backend:8040/api/v1` in Docker

The frontend normalizes loopback API URLs and will add `/api/v1` when the configured pathname is `/` or `/api`, but using the full API base path is still the clearest option.

## Useful Scripts

```bash
npm run dev
npm run build
npm run start
npm run format
npm run format:diff
npm run lint
npm run typecheck
npm run test:unit
npm run test:unit:coverage
npm run test:unit:watch
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:ui
```

## Testing

Unit tests live alongside `src/**` files and run with Vitest. `npm run test:unit:coverage` enforces an 80% global threshold for statements, branches, functions, and lines across executable `src/app`, `src/components`, and `src/lib` code. HTML and LCOV reports are written to `coverage/`.

Browser tests live in `tests/e2e`. For normal validation, start Docker and set `PLAYWRIGHT_EXTERNAL_SERVER=1` before running them. Without that flag, current configuration starts a dev server on `http://127.0.0.1:3040`; use that mode only for an explicitly selected non-Docker workflow. See [testing-guide.md](../docs/testing-guide.md#playwright-tests) for Bash and PowerShell commands. Agent-owned real-flow validation additionally uses Playwright MCP.

## Auth and API Notes

- Google and Microsoft sign-in use authorization code + PKCE
- Apple sign-in uses Apple's JS SDK popup (loaded on demand from `appleid.cdn-apple.com`); the backend verifies the returned ID token, and the user's name is forwarded only on first consent because Apple never includes it in the token
- OAuth popup completion routes live at `/auth/google`, `/auth/microsoft`, and `/auth/apple`
- access JWTs remain memory-only and refresh silently before expiration while the page is active; a one-time request retry remains as a timing-race fallback
- refresh tokens remain in HttpOnly cookies, while the API client includes device headers and CSRF support for auth-related requests
- frontend API helpers expect the backend response envelope with `success`, `message`, `data`, `error`, and `meta`
